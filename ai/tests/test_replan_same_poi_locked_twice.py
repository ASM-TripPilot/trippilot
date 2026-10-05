"""같은 POI 가 하루에 두 번 잠겨도 둘 다 원 시각에 남는다 — 하나가 노트 없이 사라지지 않는다.

리뷰어 재현: 재계획에서 같은 카페를 09:00 과 13:30 에 잠그면(또는 같은 곳 예약 두 건) 응답에서
하나가 **노트도 없이** 빠졌다. BE 는 AI 응답 하루로 원 일정 하루를 통째로 바꾸므로 잠금 방문이
지워진다(INV-4 조용한 축소). "POI 하나당 고정 창 하나"를 가정한 곳이 셋이었다:
  ⓐ 배선 `_replan_fixed_blocks` — 중복 제거 키가 poi_id 라 두 번째 잠금을 버렸다
  ⓑ OR `_solve_day` — 두 번째 고정 블록을 첫 노드의 pin 덮어쓰기로 접었다
  ⓒ 폴백 — `fb.poi_id in used` 가 두 번째(다른 날 것까지)를 건너뛰었다

증명하는 것 (실 LLM·실 API 0):
  ① 와이어 — 지난 잠금 09:00 + 진행 중 잠금 13:30 (같은 POI) → 둘 다 원 시각·is_fixed
  ② 와이어 — FULL_DAY 미래 잠금 10:00·16:00 (같은 POI, BE 실모양: locked_blocks + is_fixed 슬롯)
  ③ 어셈블리 — OR·폴백 각각 같은 POI 고정 2개를 둘 다 배치, HC 0 (후보이기도 한 경우 포함)
     + OR 웜스타트 힌트가 두 핀을 한 노드로 접지 않는다(완전 힌트 유지, TRIP-1176)
  ④ 같은 블록이 `locked_blocks` 와 `current_slots[is_fixed]` 양쪽에 오면 여전히 한 번
  ⑤ PBT — 같은 POI 고정 k개는 전부 정확히 놓이거나, 겹치면 명시 실패(409)다
  ⑥ repair — 그렇게 저장된 일정의 HC2 를 고칠 때 두 고정을 서로의 창으로 옮기지 않는다
"""

from __future__ import annotations

from dataclasses import replace
from datetime import timedelta, timezone

import pytest
from hypothesis import given, settings, strategies as st

from trippilot.api import schemas
from trippilot.api.wiring import _replan_fixed_blocks, demo_poi_seed
from trippilot.assembly_engine.constraints import check_all
from trippilot.assembly_engine.facade import AssemblyConflictError, HybridAssemblyFacade
from trippilot.domain.common import PoiId
from trippilot.domain.itinerary import FixedBlock, TimeWindow
from trippilot.domain.llm import ScoredPoi

from tests.fakes.fake_clock import FakeClock
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.test_api_replan_wired import _body
from tests.test_assembly_engine_or_full_hint import _main, _solves
from tests.test_assembly_engine_repair_api import _facade, _setup, _slot, _sol
from tests.test_replan_not_before import (
    _EST,
    _LOCK_STARTS,
    _at,
    _both,
    _lock,
    _pois,
    _problem,
    _spy_post,
)

_KST = timezone(timedelta(hours=9))


def _slots(body: dict) -> list[tuple[str, str, str, bool]]:
    return [(s["poi_id"], s["start_at"][:5], s["end_at"][:5], s["is_fixed"])
            for d in body["itinerary"]["days"] for s in d["slots"]]


# ── ① 지난 잠금 + 진행 중 잠금 ─────────────────────────────────────────


def test_지난_잠금과_진행_중_잠금이_같은_POI_여도_둘_다_남는다() -> None:
    cafe = str(demo_poi_seed()[1].poi_id)  # 흑돼지거리 — 앵커 근처
    response, _ = _spy_post(
        scope="PARTIAL_SLOTS",
        from_instant="2026-09-21T14:00:00+09:00",
        locked_blocks=[
            {"poi_id": cafe, "date": "2026-09-21", "start": "09:00", "dwell_min": 60},
            {"poi_id": cafe, "date": "2026-09-21", "start": "13:30", "dwell_min": 90},
        ],
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["empty_reason"] is None, body["notes"]
    slots = _slots(body)
    assert (cafe, "09:00", "10:00", True) in slots, slots
    assert (cafe, "13:30", "15:00", True) in slots, slots


# ── ② 미래 잠금 둘 (FULL_DAY, 하한 없음) ───────────────────────────────


def test_같은_POI_예약_두_건이_둘_다_배치된다() -> None:
    """BE 실모양 — 예약 슬롯은 `locked_blocks` 로도, 원 일정 `is_fixed` 로도 온다."""
    cafe = str(demo_poi_seed()[1].poi_id)
    response, _ = _spy_post(
        scope="FULL_DAY",  # from_instant 09:00 = 창 시작 → 하한 없음
        locked_blocks=[
            {"poi_id": cafe, "date": "2026-09-21", "start": "10:00", "dwell_min": 60},
            {"poi_id": cafe, "date": "2026-09-21", "start": "16:00", "dwell_min": 60},
        ],
        current_slots=[
            {"poi_id": cafe, "start_at": "10:00", "end_at": "11:00", "is_fixed": True},
            {"poi_id": cafe, "start_at": "16:00", "end_at": "17:00", "is_fixed": True},
        ],
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["empty_reason"] is None, body["notes"]  # NO_FEASIBLE_SLOT 가 아니다
    fixed = [s for s in _slots(body) if s[0] == cafe]
    assert fixed == [(cafe, "10:00", "11:00", True), (cafe, "16:00", "17:00", True)], fixed


# ── ③ 어셈블리 단위 ─────────────────────────────────────────────────────


@pytest.mark.parametrize("as_candidate", [False, True], ids=["풀_밖", "후보이기도"])
@pytest.mark.parametrize("which", [0, 1], ids=["OR", "폴백"])
def test_어셈블러가_같은_POI_고정_둘을_둘_다_놓는다(which: int, as_candidate: bool) -> None:
    """후보이기도 하면 OR 은 첫 블록을 후보 노드에 합치고, 둘째는 새 핀 노드여야 한다."""
    pois = _pois(6)
    locks = (_lock(pois[0], _at(10)), _lock(pois[0], _at(16)))
    problem = _problem(pois, locks, None)
    if as_candidate:
        problem = replace(problem, candidates=(
            ScoredPoi(poi_id=pois[0].poi_id, score=0.95, is_llm_score=True),
            *problem.candidates))
    index = {p.poi_id: p for p in pois}

    result = _both(index)[which].solve(problem, 1500)

    assert result is not None
    assert check_all(result, problem, index, _EST) == []  # HC3 — 둘 다 정확한 시각
    placed = [(s.poi_id, s.start_at) for s in result.days[0].slots]
    assert placed.count((pois[0].poi_id, _at(10))) == 1
    assert placed.count((pois[0].poi_id, _at(16))) == 1
    assert len(result.days[0].fixed_blocks) == 2  # 사영 is_fixed 의 근거(TRIP-343)


def test_같은_POI_고정_둘이어도_OR_힌트가_완전하다() -> None:
    """그리디 순서를 POI 로만 노드에 대응시키면 두 핀이 한 노드로 접혀 경로 완성이 실패하고,
    부분 힌트로 내려간다 — TRIP-1176 이 고친 '힌트를 버린 탐색'으로 되돌아간다."""
    pois = _pois(6)
    problem = _problem(pois, (_lock(pois[0], _at(10)), _lock(pois[0], _at(16))), None)
    index = {p.poi_id: p for p in pois}

    with _solves() as log:
        result = _both(index)[0].solve(problem, 1500)

    assert result is not None
    mains = _main(log)
    assert mains
    for r in mains:
        assert set(r.hint_vars) == set(range(r.n_vars)), (
            f"불완전 힌트: {len(set(r.hint_vars))}/{r.n_vars}")


def test_폴백이_다른_날_같은_POI_고정을_건너뛰지_않는다() -> None:
    """종전 `used` 방어는 날을 가리지 않아 둘째 날 예약을 건너뛰었다(HC3 위반 → 409)."""
    pois = _pois(4)
    day2 = _at(0).date() + timedelta(days=1)
    locks = (_lock(pois[0], _at(12)), _lock(pois[0], _at(12, day=day2)))
    problem = replace(_problem(pois, locks, None), days=(_at(0).date(), day2))
    index = {p.poi_id: p for p in pois}

    result = _both(index)[1].solve(problem)

    assert check_all(result, problem, index, _EST) == []


def test_같은_블록이_두_번_와도_한_번만_놓는다() -> None:
    """중복 방어의 원래 목적(regenerate 가 잠근 슬롯 = 기존 블록)은 그대로다."""
    pois = _pois(4)
    lock = _lock(pois[0], _at(12))
    problem = _problem(pois, (lock, lock), None)
    index = {p.poi_id: p for p in pois}

    for assembly in _both(index):
        result = assembly.solve(problem, 1500)
        assert result is not None, assembly.name
        placed = [(s.poi_id, s.start_at) for s in result.days[0].slots]
        assert placed.count((pois[0].poi_id, _at(12))) == 1, assembly.name


# ── ④ 배선 중복 제거 ────────────────────────────────────────────────────


def _request(**over) -> schemas.ReplanRequest:
    return schemas.ReplanRequest.model_validate(_body(**over))


def test_양쪽에_온_같은_블록은_한_번만_고정된다() -> None:
    blocks = _replan_fixed_blocks(_request(
        locked_blocks=[{"poi_id": "p1", "date": "2026-09-21", "start": "10:00",
                        "dwell_min": 60}],
        current_slots=[{"poi_id": "p1", "start_at": "10:00", "end_at": "11:00",
                        "is_fixed": True}],
    ), _KST)

    assert [(b.poi_id, b.window.start.time().isoformat()) for b in blocks] == [
        ("p1", "10:00:00")]


def test_같은_POI_다른_시각_잠금은_각각_고정된다() -> None:
    blocks = _replan_fixed_blocks(_request(
        locked_blocks=[{"poi_id": "p1", "date": "2026-09-21", "start": "09:00",
                        "dwell_min": 60}],
        current_slots=[
            {"poi_id": "p1", "start_at": "09:00", "end_at": "10:00", "is_fixed": True},
            {"poi_id": "p1", "start_at": "13:30", "end_at": "15:00", "is_fixed": True},
        ],
    ), _KST)

    assert sorted(b.window.start.time().isoformat() for b in blocks) == [
        "09:00:00", "13:30:00"]


# ── ⑤ PBT ──────────────────────────────────────────────────────────────


@st.composite
def _same_poi_locks(draw):
    pois = _pois(draw(st.integers(min_value=1, max_value=8)))
    k = draw(st.integers(min_value=2, max_value=4))
    starts = sorted(draw(st.lists(st.sampled_from(_LOCK_STARTS), min_size=k, max_size=k,
                                  unique=True)))
    locks = tuple(_lock(pois[0], _at(h, m)) for h, m in starts)
    overlap = draw(st.booleans())
    if overlap:  # 같은 POI 에 30분 어긋난 잠금 — 동시에 두 곳에 있을 수 없다
        locks += (_lock(pois[0], locks[0].window.start + timedelta(minutes=30)),)
    problem = _problem(pois, locks, None, seed=draw(st.integers(0, 2**31)))
    if draw(st.booleans()):
        problem = replace(problem, candidates=(
            ScoredPoi(poi_id=pois[0].poi_id, score=0.95, is_llm_score=True),
            *problem.candidates))
    return problem, {p.poi_id: p for p in pois}, overlap


@settings(max_examples=25, deadline=None)
@given(setup=_same_poi_locks())
def test_같은_POI_고정_k개는_전부_놓이거나_명시_실패다(setup) -> None:
    problem, index, overlap = setup
    facade = HybridAssemblyFacade(list(_both(index)), index, _EST, FakeClock(),
                                  InMemoryTrace())
    if overlap:
        with pytest.raises(AssemblyConflictError):  # 조용히 하나를 버린 해가 아니다
            facade.solve(problem, deadline_ms=5000)
        return

    solved = facade.solve(problem, deadline_ms=5000)

    assert check_all(solved, problem, index, _EST) == []
    placed = [(s.poi_id, s.start_at, s.end_at) for d in solved.days for s in d.slots]
    for fb in problem.fixed_blocks:
        assert placed.count((fb.poi_id, fb.window.start, fb.window.end)) == 1, fb



# ── ⑥ repair ────────────────────────────────────────────────────────────


def test_repair_는_같은_POI_고정_둘을_각자_창에_둔다() -> None:
    """고정 창을 (날, POI) 하나로 보면 09:00 슬롯이 15:00 창으로 끌려가 수리 불가가 된다."""
    problem, index = _setup()  # a→b 이동 52분
    a = PoiId("a")
    problem = replace(problem, fixed_blocks=tuple(
        FixedBlock(a, TimeWindow(s.start_at, s.end_at), "locked")
        for s in (_slot("a", 9, 0, 10, 0), _slot("a", 15, 0, 16, 0))))
    broken = _sol(_slot("a", 9, 0, 10, 0), _slot("b", 10, 0, 11, 0),
                  _slot("a", 15, 0, 16, 0))  # b 가 이동 52분 없이 붙었다 — HC2

    result = _facade(index).repair(broken, problem, deadline_ms=1000)

    assert result.repaired is not None
    assert [(c.poi_id, f"{c.after:%H:%M}") for c in result.changes] == [
        (PoiId("b"), "10:52")]  # 고정 둘은 그대로, b 만 민다
