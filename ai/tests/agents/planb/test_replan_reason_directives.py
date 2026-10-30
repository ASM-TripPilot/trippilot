"""재계획 사유 → 암시 지시 (u4 business-rules BR-U4-47).

사유(`reasons`)는 종전에 PlanB 트리거·KB 질의에만 닿고 일정 조립엔 0이었다 — "체력이 떨어졌어요"를
골라도 이동거리·방문 수가 그대로였다. 이제 사유가 지시 사전 키(LESS_MOVE·RELAX·INDOOR …)로
**사용자 지시와 같은 기구**를 탄다.

증명하는 것 (실 LLM·실 API 0):
  ① 사유별 암시 지시가 에이전트 요청까지 실린다 (이음매 — 스파이로 본다)
  ② 사용자 지시가 같은 축을 정했으면 사용자 것이 이긴다 · 해석분은 사용자 것뿐이다
  ③ 다중 사유는 합집합이다 (PBT — 임의 사유·칩 조합)
  ④ 효과: 같은 풀·같은 시드에서 피로·지연은 총 이동·방문이 줄고, 우천은 실내가 는다
     — **집계로** 본다. 점마다는 성립하지 않는다(가까운 후보가 하필 야외면 회피가 더 먼 곳을
     부른다; 200풀 실측 피로 거리 위반 ~10%). 개별 보장이 아니라 방향이 규칙이다.
"""

from __future__ import annotations

import math
import random
from dataclasses import replace
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from hypothesis import given, settings, strategies as st

from trippilot.agents.schedule.agent import ScheduleAgent
from trippilot.api import schemas
from trippilot.api.wiring import _REASON_IMPLIED_DIRECTIVES, _route_weight, build_dev_app
from trippilot.domain.common import GeoPoint, Pace, TraceId
from trippilot.domain.itinerary import TimeWindow
from trippilot.domain.poi import PoiCategory
from trippilot.domain.poi_curation import CandidatePoolRequest
from trippilot.llm_gateway.gates.scoring import ClosedSetGate
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.workers.preference import PreferenceScoringWorker
from trippilot.poi_curation.config import M7Config
from trippilot.poi_curation.pool_builder import CandidatePoolBuilder

from tests.fakes.fake_clock import FakeClock
from tests.fakes.fake_llm import FakeLlm
from tests.fakes.in_memory_poi import InMemoryPoi
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.api.test_api_replan_wired import _DIRECTIVES, _body
from tests.agents.schedule.test_schedule_agent import _task
from tests.orchestrator.schedule.test_schedule_coordinator import (
    _ANCHOR,
    _C1CFG,
    _KST,
    _NOW,
    _AssemblyProvider,
    _Renderer,
    _Sink,
    _poi,
    _request,
    _scores_json,
)

_INDOOR = frozenset({PoiCategory.CULTURE, PoiCategory.CAFE, PoiCategory.SHOPPING})
_STRENUOUS = frozenset({PoiCategory.ACTIVITY, PoiCategory.NATURE})
# "실내로"는 실외 회피도 싣는다(2026-10-14) — AVOID_OUTDOOR·RAIN_OUTDOOR 와 같은 집합
_OUTDOOR = frozenset({PoiCategory.NATURE, PoiCategory.NIGHT_VIEW, PoiCategory.ACTIVITY})
_APP = build_dev_app(directives=_DIRECTIVES)


def _directives(**over: object):
    """배선의 사유·지시 해석만 돌린다 → (해석분, 미지분, 선호, 회피, 가까이, 한곳, 여유), 노트."""
    notes: list[str] = []
    out = _APP.state.orchestrator._replan_directives(
        schemas.ReplanRequest.model_validate(_body(**over)), notes,
        trace_id=TraceId("t"), now=_NOW, deadline_ms=20_000)
    return out, notes


# ── ① 사유별 암시 지시가 에이전트 요청까지 실린다 ─────────────────────────


def _spied_request(**over: object):
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


@pytest.mark.parametrize("reason,near,avoid,prefer,pace,route,implied", [
    ("fatigue", True, _STRENUOUS, frozenset(), Pace.SLOW, 0.05, "LESS_MOVE,AVOID_STRENUOUS,RELAX"),
    ("delay", True, frozenset(), frozenset(), Pace.SLOW, 0.05, "LESS_MOVE,RELAX"),
    ("weather", True, _OUTDOOR, _INDOOR, None, 0.02, "INDOOR,LESS_MOVE"),
    ("closed", True, frozenset(), frozenset(), None, 0.0, "NEARBY"),
    ("fully_booked", True, frozenset(), frozenset(), None, 0.0, "NEARBY"),
    ("canceled", True, frozenset(), frozenset(), None, 0.0, "NEARBY"),
    ("none", False, frozenset(), frozenset(), None, 0.0, None),
])
def test_사유별_암시_지시가_에이전트_요청에_실린다(reason, near, avoid, prefer, pace, route,
                                       implied) -> None:
    request, body = _spied_request(reasons=[reason])

    assert request.prefer_near is near
    assert request.travel_weight == route  # 경로 길이 감점 — 조립 선택(A)에 이동이 들어간다
    assert request.avoid_categories == avoid
    assert request.prefer_categories == prefer
    assert request.pace is pace
    # 암시분은 해석분(사용자 지시)에 섞지 않고 노트로 밝힌다
    assert body["resolved_directives"] == []
    if implied is None:
        assert not any("planb_reason_implied" in n for n in body["notes"]), body["notes"]
    else:
        assert f"planb_reason_implied: {implied}" in body["notes"], body["notes"]


def test_경로_감점은_사유_중_최댓값이고_사용자_이동_짧게_칩도_켠다() -> None:
    assert _route_weight(["weather", "fatigue"], []) == 0.05
    assert _route_weight(["none"], ["LESS_MOVE"]) == 0.05
    assert _route_weight(["closed", "none", "모름"], ["NEARBY"]) == 0.0
    request, _ = _spied_request(reasons=["none"], directives=["LESS_MOVE"])
    assert request.travel_weight == 0.05


def test_더_채워서_칩은_알차게_속도로_집행되고_여유와_같이면_상쇄한다() -> None:
    request, body = _spied_request(reasons=["none"], directives=["FILL_MORE"])
    assert request.pace is Pace.PACKED
    assert not any("directives_unwired" in n for n in body["notes"]), body["notes"]
    (*_, pace), notes = _directives(reasons=["none"], directives=["FILL_MORE", "RELAX"])
    assert pace is None and "directives_conflict: pace" in notes
    # 사용자가 속도 축을 정했으면 피로의 RELAX 는 얹히지 않는다
    (*_, pace), notes = _directives(reasons=["fatigue"], directives=["FILL_MORE"])
    assert pace is Pace.PACKED
    assert "planb_reason_implied_skipped: RELAX (사용자 지시 우선)" in notes, notes


def test_야외_피하기_칩은_실외_세_종을_회피한다() -> None:
    """FE 칩 AVOID_OUTDOOR 가 사전에 없어 unknown 으로 버려졌다(DEV 로그)."""
    (resolved, unknown, _, avoid, _, _, _), _ = _directives(
        reasons=["none"], directives=["AVOID_OUTDOOR"])
    assert resolved == ["AVOID_OUTDOOR"] and unknown == []
    assert avoid == frozenset({PoiCategory.NATURE, PoiCategory.NIGHT_VIEW, PoiCategory.ACTIVITY})


def test_여유_지시는_칩으로도_느긋한_속도로_집행된다() -> None:
    """RELAX 는 종전 `unwired` 였다 — 이제 Pace.SLOW(체류 ×1.4)로 방문 수를 줄인다."""
    request, body = _spied_request(reasons=["none"], directives=["RELAX"])
    assert request.pace is Pace.SLOW
    assert not any("directives_unwired" in n for n in body["notes"]), body["notes"]


# ── ② 사용자 지시 우선 ─────────────────────────────────────────────────


def test_우천이어도_사용자가_야외를_고르면_야외다() -> None:
    (_, _, prefer, _, _, _, _), notes = _directives(reasons=["weather"], directives=["OUTDOOR"])
    assert prefer == frozenset({PoiCategory.NATURE, PoiCategory.SIGHT})
    assert "planb_reason_implied_skipped: INDOOR (사용자 지시 우선)" in notes, notes


def test_피로여도_사용자가_액티비티를_고르면_회피하지_않는다() -> None:
    (_, _, prefer, avoid, near, _, slow), _ = _directives(
        reasons=["fatigue"], directives=["ACTIVITY_FOCUS"])
    assert PoiCategory.ACTIVITY in prefer and avoid == frozenset()
    assert near and slow  # 다른 축(거리·속도)은 그대로 얹힌다


def test_우천_실내가_사용자의_카페_한_곳을_먹지_않는다() -> None:
    """INDOOR 가 카페 전원을 올리면 `add_one -= prefer` 로 "카페 한 곳"이 지워진다."""
    (_, _, prefer, _, _, add_one, _), _ = _directives(reasons=["weather"], directives=["ADD_CAFE"])
    assert add_one == frozenset({PoiCategory.CAFE})
    assert prefer == _INDOOR - {PoiCategory.CAFE}


def test_무효한_사용자_칩은_축을_잡지_않는다() -> None:
    """숙소 근처 마무리·저녁 유지·시간 당기기·일찍 마무리(하루 모양 — 거리·속도 축이 아니다)가 축을 잡으면
    피로의 거리·속도 암시가 빠지고 사용자 칩도 안 먹는다(리뷰 재현)."""
    (_, _, _, _, near, _, slow), notes = _directives(
        reasons=["fatigue"], directives=["END_NEAR_STAY", "KEEP_DINNER", "SHORTER_DAY"])
    assert near and slow
    assert not any("implied_skipped" in n for n in notes), notes


def test_못_푼_부정문이_있으면_카테고리_암시는_보류한다() -> None:
    """우천 + "카페는 이제 그만" — 못 읽은 채 INDOOR 로 카페를 올리면 원문과 정반대다."""
    (_, _, prefer, _, _, _, _), notes = _directives(reasons=["weather"], free_text="카페는 이제 그만")
    assert prefer == frozenset()
    assert "planb_reason_implied_skipped: INDOOR (사용자 지시 우선)" in notes, notes


# ── ③ 다중 사유 합집합 (PBT) ─────────────────────────────────────────────

_REASONS = st.lists(st.sampled_from(
    ["weather", "closed", "fully_booked", "canceled", "delay", "fatigue", "none", "모름"]),
    max_size=4)
_CHIPS = st.lists(st.sampled_from([s.key for s in _DIRECTIVES]), max_size=3, unique=True)


@settings(max_examples=60, deadline=None)
@given(reasons=_REASONS, chips=_CHIPS)
def test_사유는_사용자_지시를_줄이지_않고_합집합으로만_얹힌다(reasons, chips) -> None:
    (r0, u0, p0, a0, n0, o0, s0), _ = _directives(reasons=[], directives=chips)
    (r1, u1, p1, a1, n1, o1, s1), notes = _directives(reasons=reasons, directives=chips)

    assert (r1, u1) == (r0, u0)            # 해석분·미지분은 사용자 것뿐
    assert o1 == o0                        # 사용자 "한 곳 추가"는 그대로
    assert p0 <= p1 and a0 <= a1           # 줄이지 않는다
    assert n1 >= n0
    assert s0 is None or s1 == s0          # 사용자가 정한 속도는 사유가 못 바꾼다
    expected = {k for r in reasons for k in _REASON_IMPLIED_DIRECTIVES.get(r, ())}
    lit = {k for n in notes if n.startswith("planb_reason_implied: ")
           for k in n.split(": ")[1].split(",")}
    assert lit <= expected
    if not chips:  # 사용자 지시가 없으면 표 그대로 전부 걸린다
        assert lit == expected
    # 사용자가 하루 방향(PROMPT·DAY)을 골랐으면 카테고리 축은 사용자 것 그대로다
    user_prompt = any(s.key in chips and s.enforced_by == "PROMPT" and s.cardinality == "DAY"
                      for s in _DIRECTIVES)
    if user_prompt:
        assert (p1, a1) == (p0, a0)


# ── ④ 효과 — 같은 풀·같은 시드에서 집계로 ──────────────────────────────

_CATS = [c for c in PoiCategory if c is not PoiCategory.STAY]


def _km(a: GeoPoint, b: GeoPoint) -> float:
    return math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 88)


def _measure(seed: int, reasons: dict[str, list[str]]) -> dict[str, tuple[int, float, int]]:
    """임의 풀 하나에서 사유별 (방문 수, 직선 경로 km, 실내 방문 수)."""
    rnd = random.Random(seed)
    n = rnd.randint(6, 12)
    pois = tuple(replace(
        _poi(i), category=rnd.choice(_CATS),
        coord=GeoPoint(_ANCHOR.lat + rnd.uniform(-.04, .04), _ANCHOR.lng + rnd.uniform(-.04, .04)),
    ) for i in range(1, n + 1))
    base = replace(_request(), day_window=TimeWindow(
        start=datetime(2026, 8, 5, 9, 0, tzinfo=_KST),
        end=datetime(2026, 8, 5, rnd.randint(13, 20), 0, tzinfo=_KST)))
    pool = CandidatePoolBuilder(InMemoryPoi(pois), M7Config()).build(
        CandidatePoolRequest(anchor=base.anchor, dates=base.days,
                             budget=base.budget, transport=base.transport), _NOW)
    by_id = {p.poi_id: p for p in pois}
    out = {}
    for label, rs in reasons.items():
        # 배선이 실제로 내는 필드를 그대로 쓴다 — 표와 효과가 한 줄로 이어진다
        (resolved, _, prefer, avoid, near, add_one, pace), _ = _directives(reasons=rs)
        req = replace(base, prefer_categories=prefer, avoid_categories=avoid, prefer_near=near,
                      add_one_categories=add_one, pace=pace,
                      travel_weight=_route_weight(rs, resolved))
        trace = InMemoryTrace()
        gateway = GatewayFacade(FakeLlm(_scores_json(*[f"p{i}" for i in range(1, n + 1)])),
                                _Renderer(), ClosedSetGate(), _C1CFG, trace)
        agent = ScheduleAgent(PreferenceScoringWorker(gateway),
                              _AssemblyProvider(trace, _Sink(), primary=True), FakeClock(), trace)
        ids = [s.poi_id for d in agent.run(_task(pool, request=req)).solution.days for s in d.slots]
        pts = [_ANCHOR, *(by_id[i].coord for i in ids)]
        out[label] = (len(ids), sum(_km(a, b) for a, b in zip(pts, pts[1:])),
                      sum(1 for i in ids if by_id[i].category in _INDOOR))
    return out


def test_피로_지연은_이동과_방문을_줄이고_우천은_실내를_늘린다() -> None:
    """30풀 집계. 실측(200풀): 거리 피로 −38%·지연 −47%, 방문 −13%·−17%, 실내 311→536."""
    runs = [_measure(s, {"none": ["none"], "fatigue": ["fatigue"], "delay": ["delay"],
                         "weather": ["weather"]}) for s in range(30)]

    def total(label: str, k: int) -> float:
        return sum(r[label][k] for r in runs)

    assert total("fatigue", 1) < total("none", 1)
    assert total("delay", 1) < total("none", 1)
    assert total("fatigue", 0) < total("none", 0)
    assert total("delay", 0) < total("none", 0)
    assert total("weather", 2) > total("none", 2)
