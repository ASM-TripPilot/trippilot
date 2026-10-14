"""피로·지연 재계획의 하루 방문 상한 "원 일정 − 1" (u4 business-rules BR-U4-47).

느긋한 속도(체류 ×1.4)만으로는 방문이 안 줄었다 — 경로 감점이 줄인 이동 시간과 긴 체류(액티비티·
자연)를 짧은 것으로 바꾼 회피가 늘어난 체류를 덮었다(실스택 부산: 원 6곳 → 피로 7곳).

증명하는 것 (실 LLM·실 API 0):
  ① 배선: 피로·지연이면 상한(남은 원 방문 − 1, 최소 1)이 에이전트 요청까지 실리고 노트가 남는다.
     우천·휴무·없음, 사용자 FILL_MORE, 원 일정 없음이면 상한 없음. 지난 잠금은 세지 않는다.
  ② PBT(OR·폴백): 자유 방문 ≤ 몫, 고정 블록은 그대로(HC3), 상한 없이 놓인 필수 방문은 상한을
     걸어도 놓인다 — 상한은 고정·필수를 세되 빼지 않는다.
  ③ 직렬화 왕복·음수 거부
"""

from __future__ import annotations

import random
from dataclasses import replace
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from hypothesis import assume, given, settings, strategies as st

from trippilot.api.wiring import build_dev_app
from trippilot.assembly_engine.constraints import check_all, free_visit_cap
from trippilot.assembly_engine.fallback_assembler import RuleFallbackAssembler
from trippilot.assembly_engine.ortools_assembler import OrToolsAssembler
from trippilot.domain.itinerary import FixedBlock, ItineraryProblem, RequiredVisit, TimeWindow

from tests.test_api_replan_wired import _DIRECTIVES, _body
from tests.test_assembly_engine_travel_weight import _CFG, _DAY, _EST, _KST, _pool

_DEMO = [f"e0000000-0000-4000-8000-00000000000{i}" for i in range(1, 5)]


def _slots(n: int) -> list[dict]:
    return [{"poi_id": p, "start_at": f"{10 + 2 * i:02d}:00", "end_at": f"{11 + 2 * i:02d}:00"}
            for i, p in enumerate(_DEMO[:n])]


def _spied(**over: object):
    app = build_dev_app(directives=_DIRECTIVES)
    orchestrator = app.state.orchestrator
    real = orchestrator._schedule_agent
    seen: list[object] = []

    class _Spy:
        def run(self, task):
            seen.append(task.request)
            return real.run(task)

    object.__setattr__(orchestrator, "_schedule_agent", _Spy())
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post("/ai/v1/planb/replan", json=_body(**over))
    assert response.status_code == 200, response.text
    return seen[0], response.json()


# ① ────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("reason", ["fatigue", "delay"])
def test_피로_지연은_원_일정_빼기_1_상한이_요청까지_실리고_해가_지킨다(reason) -> None:
    request, body = _spied(reasons=[reason], current_slots=_slots(4))
    assert request.max_visits_per_day == 3
    assert "planb_visit_cap: 3" in body["notes"], body["notes"]
    assert len(body["itinerary"]["days"][0]["slots"]) <= 3


@pytest.mark.parametrize("over", [
    {"reasons": ["weather"]},
    {"reasons": ["closed"]},
    {"reasons": ["none"]},
    {"reasons": ["fatigue"], "directives": ["FILL_MORE"]},  # 사용자 우선
])
def test_해당_사유가_아니거나_더_채워서면_상한이_없다(over) -> None:
    request, body = _spied(current_slots=_slots(4), **over)
    assert request.max_visits_per_day is None
    assert not any("planb_visit_cap" in n for n in body["notes"]), body["notes"]


def test_원_일정이_비면_상한이_없고_한_곳이면_최소_1() -> None:
    assert _spied(reasons=["fatigue"])[0].max_visits_per_day is None
    assert _spied(reasons=["fatigue"], current_slots=_slots(1))[0].max_visits_per_day == 1


def test_지난_잠금은_남은_구간에_세지_않는다() -> None:
    """09:00-10:00 다녀온 곳(지난 잠금)은 솔버 밖이다 — 남은 3곳 − 1 = 2."""
    slots = _slots(4)
    slots[0] = {"poi_id": _DEMO[0], "start_at": "09:00", "end_at": "10:00", "is_fixed": True}
    request, _ = _spied(reasons=["fatigue"], current_slots=slots,
                        from_instant="2026-09-21T11:00:00+09:00")
    assert request.max_visits_per_day == 2


def test_하한_전에_끝난_잠기지_않은_슬롯도_세지_않는다() -> None:
    """FULL_DAY 는 놓친 오전 슬롯이 잠기지 않은 채 온다 — 자유 방문은 하한 뒤에만 들어간다.
    _slots(4) 는 10·12·14·16시 시작 — 15시 기준 남은 것은 16시 1곳(14-15시는 15시에 끝남)."""
    request, _ = _spied(reasons=["delay"], current_slots=_slots(4),
                        from_instant="2026-09-21T15:00:00+09:00")
    assert request.max_visits_per_day == 1


# ② ────────────────────────────────────────────────────────────────────────

def _at(hour: int) -> datetime:
    return datetime(2026, 10, 14, hour, tzinfo=_KST)


@settings(max_examples=30, deadline=None)
@given(seed=st.integers(0, 10_000), n=st.integers(5, 9), cap=st.integers(0, 4),
       n_fixed=st.integers(0, 2), with_required=st.booleans(),
       engine=st.sampled_from(["or", "fb"]))
def test_상한은_자유_방문만_깎고_고정_필수는_빼지_않는다(seed, n, cap, n_fixed, with_required,
                                         engine) -> None:
    problem, index = _pool(random.Random(seed), n, 20)
    ids = list(index)
    fixed = tuple(FixedBlock(ids[i], TimeWindow(_at(10 + 3 * i), _at(11 + 3 * i)), "잠금")
                  for i in range(n_fixed))
    # 고정 쌍 사이 이동이 간격(120분)을 넘으면 입력부터 성립 불가다 — 상한 없이도 OR 은 None,
    # 폴백은 같은 HC2 위반을 낸다(seed=850). 상한의 속성이 아니므로 배제한다.
    assume(all(_EST.estimate(index[a.poi_id].coord, index[b.poi_id].coord, problem.transport)
               .internal_minutes <= int((b.window.start - a.window.end).total_seconds() // 60)
               for a, b in zip(fixed, fixed[1:])))
    required = (RequiredVisit(ids[n_fixed], _DAY, None, "필수"),) if with_required else ()
    base = replace(problem, fixed_blocks=fixed, required_visits=required, travel_weight=0.05)
    capped = replace(base, max_visits_per_day=cap)

    def solve(p):
        if engine == "or":
            return OrToolsAssembler(index, _EST, _CFG).solve(p, remaining_ms=10_000)
        return RuleFallbackAssembler(index, _EST, _CFG).solve(p)

    free_of = lambda sol: [s for s in sol.days[0].slots  # noqa: E731
                           if s.poi_id not in {f.poi_id for f in fixed}
                           and s.poi_id not in {r.poi_id for r in required}]
    before, after = solve(base), solve(capped)
    assert after is not None and before is not None
    assert len(free_of(after)) <= free_visit_cap(capped, _DAY)
    placed = {s.poi_id for s in after.days[0].slots}
    assert {f.poi_id for f in fixed} <= placed  # 고정은 그대로
    assert ({r.poi_id for r in required} & {s.poi_id for s in before.days[0].slots}) <= placed
    assert check_all(after, capped, index, _EST) == []  # INV-2 — 시각은 여전히 검증값


# ③ ────────────────────────────────────────────────────────────────────────

def test_직렬화_왕복과_음수_거부() -> None:
    problem, _ = _pool(random.Random(1), 4, 15)
    on = replace(problem, max_visits_per_day=3)
    assert ItineraryProblem.from_dict(on.to_dict()) == on
    old = problem.to_dict()
    old.pop("max_visits_per_day")  # 키 없는 기존 덤프도 읽힌다
    assert ItineraryProblem.from_dict(old).max_visits_per_day is None
    with pytest.raises(ValueError):
        replace(problem, max_visits_per_day=-1)
