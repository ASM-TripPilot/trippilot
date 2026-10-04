"""재계획이 `from_instant` 이전에 새 장소를 넣지 않는다 + 재계획 시드 결정론 (TRIP-1182).

`ReplanRequest.from_instant` 를 AI 어디서도 읽지 않아, 하루 창 전체가 열린 채로 풀렸다.
실측 두 건: ① FULL_DAY 재계획을 18:37 에 요청했는데 09:34 부터 다시 짰다. ② 오전 잠금
09:30-10:30·12:45-13:45, 현재 14:10 인데 OR 이 잠금 사이 10:47-12:02 에 새 장소를 넣었다.

방향(안티패턴 '지금 이후만'을 창 축소로 표현하지 말 것): 창·잠금은 그대로 두고, **잠기지 않은
방문의 시작 하한**만 `ItineraryProblem.not_before` 로 건다. OR·폴백 두 어셈블러가 같은 규칙,
체인 검증은 내부에서만 이를 위반으로 본다(INV-2 — 지난 시각이 화면에 나가지 않게).

증명하는 것 (실 LLM·실 API 0):
  ① 실측 시나리오 두 건 — OR·폴백 모두 새 방문 전부 ≥ from_instant, 잠금 유지, HC 0
  ①′ 하한 시각의 출발점은 앵커(지금 위치) — 새 방문은 ≥ from_instant + 앵커 이동 (리뷰 지적:
     하한이 앵커 이동을 지워 갈 수 없는 시각이 체인을 통과했다)
  ② PBT — 임의 잠금·from_instant 에서 같은 성질 + OR 이 해를 낸다(용량 컷이 해를 안 자른다)
  ③ 하한이 무의미한 값(None·창 시작 이전·다른 날)이면 해가 바이트 동일 (generate 무변경)
  ④ 체인 검증이 하한 위반 해를 거부한다 / 잠금이 창 앞쪽이어도 모순(409)이 아니다
  ⑤ 배선 — from_instant 가 그 일자면 하한, 아니면 None · 남은 시간이 없으면 정직한 빈 결과
  ⑥ 시드 — 요청 id(파이썬 hash, 프로세스 솔트) 가 아니라 trip_id crc32
"""

from __future__ import annotations

import os
import subprocess
import sys
import zlib
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from hypothesis import given, settings, strategies as st

from trippilot.api.wiring import build_dev_app, demo_poi_seed
from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.constraints import check_all
from trippilot.assembly_engine.facade import HybridAssemblyFacade
from trippilot.assembly_engine.fallback_assembler import RuleFallbackAssembler
from trippilot.assembly_engine.ortools_assembler import OrToolsAssembler
from trippilot.assembly_engine.travel import TravelEstimator
from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId, ScheduleId, TransportMode
from trippilot.domain.itinerary import (
    DaySolution,
    FixedBlock,
    ItineraryProblem,
    ItinerarySolution,
    SolveMode,
    TimeWindow,
    VisitSlot,
)
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource

from tests.fakes.fake_clock import FakeClock
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.generators.assembly import assembly_setups
from tests.test_api_replan_wired import _DIRECTIVES, _body
from tests.test_replan_via_planb import _SpyScheduleAgent

_CFG = AssemblyConfig(or_tools_limit_ms=1000, or_tools_min_ms=50)
_EST = TravelEstimator(_CFG)
_KST = timezone(timedelta(hours=9))
_DAY = date(2026, 10, 3)
_ANCHOR = GeoPoint(37.5665, 126.9780)
_CATS = (PoiCategory.SIGHT, PoiCategory.FOOD, PoiCategory.CAFE, PoiCategory.CULTURE,
         PoiCategory.SHOPPING)


def _at(h: int, m: int = 0, day: date = _DAY) -> datetime:
    return datetime(day.year, day.month, day.day, h, m, tzinfo=_KST)


def _pois(n: int) -> list[Poi]:
    # 앵커 근처 격자 (≤ ~1.5km) — 영업정보 없음(HC1 미적용)이라 가해성은 시간만 정한다
    return [
        Poi(PoiId(f"nb{i}"), f"nb{i}", _CATS[i % len(_CATS)],
            GeoPoint(_ANCHOR.lat + 0.002 * (i % 4), _ANCHOR.lng + 0.002 * (i // 4)), (),
            None, None, DataQuality.FULL, PoiSource.SEED, None)
        for i in range(n)
    ]


def _lock(poi: Poi, start: datetime, minutes: int = 60) -> FixedBlock:
    return FixedBlock(poi_id=poi.poi_id,
                      window=TimeWindow(start, start + timedelta(minutes=minutes)),
                      reason="current_slot_fixed")


def _problem(pois: list[Poi], locks: tuple[FixedBlock, ...],
             not_before: datetime | None, *, anchor: GeoPoint | None = _ANCHOR,
             seed: int = 11) -> ItineraryProblem:
    locked = {fb.poi_id for fb in locks}
    return ItineraryProblem(
        schedule_id=ScheduleId("s-1182"), days=(_DAY,),
        candidates=tuple(ScoredPoi(poi_id=p.poi_id, score=0.9 - 0.05 * i, is_llm_score=True)
                         for i, p in enumerate(pois) if p.poi_id not in locked),
        fixed_blocks=locks, budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=TimeWindow(_at(9), _at(21)), seed=seed, anchor=anchor,
        not_before=not_before,
    )


def _is_pinned(slot: VisitSlot, problem: ItineraryProblem) -> bool:
    return any(slot.poi_id == fb.poi_id and slot.start_at == fb.window.start
               and slot.end_at == fb.window.end for fb in problem.fixed_blocks)


def _earliest(slot: VisitSlot, problem, index) -> datetime:
    """비고정 슬롯이 시작할 수 있는 가장 이른 시각 — 하한 + 현재 위치(앵커)에서의 이동.

    재계획 앵커는 사용자의 지금 위치다(BE: GPS → 마지막 완료 방문 → 숙소). 하한 시각에
    거기 있는 사람이 이동 없이 새 장소에 도착할 수 없다. 하한이 창 시작 이하면 자르는 게
    없다 — 창 시작 출발 아크가 앵커 이동을 이미 센다(시험 대상 규칙과 같은 판정)."""
    nb = problem.not_before
    if problem.anchor is None or nb <= problem.day_window.start:
        return nb
    return nb + timedelta(minutes=_EST.estimate(
        problem.anchor, index[slot.poi_id].coord, problem.transport).internal_minutes)


def _assert_respects_not_before(result: ItinerarySolution, problem, index) -> None:
    assert check_all(result, problem, index, _EST) == []        # HC 0 (HC3 = 잠금 유지)
    for day in result.days:
        for slot in day.slots:
            if not _is_pinned(slot, problem):
                lo = _earliest(slot, problem, index)
                assert slot.start_at >= lo, (
                    f"{slot.poi_id} {slot.start_at:%H:%M} < 하한+앵커 이동 {lo:%H:%M}")


def _both(index):
    return (OrToolsAssembler(index, _EST, _CFG), RuleFallbackAssembler(index, _EST, _CFG))


# ── ① 실측 시나리오 ─────────────────────────────────────────────────────


def _morning_locks_case():
    """TRIP-1175 리뷰 실측: 오전 잠금 09:30-10:30·12:45-13:45, 현재 14:10."""
    pois = _pois(10)
    locks = (_lock(pois[0], _at(9, 30)), _lock(pois[1], _at(12, 45)))
    problem = _problem(pois, locks, _at(14, 10))
    return problem, {p.poi_id: p for p in pois}


def test_잠금_사이_빈칸에_새_장소를_넣지_않는다_OR() -> None:
    problem, index = _morning_locks_case()
    result = OrToolsAssembler(index, _EST, _CFG).solve(problem, remaining_ms=1500)

    assert result is not None, "하한을 걸었다고 OR 이 해를 잃으면 안 된다"
    _assert_respects_not_before(result, problem, index)
    free = [s for s in result.days[0].slots if not _is_pinned(s, problem)]
    assert free, "14:10~21:00 이 비어 있는데 새 방문이 0건이다"


def test_잠금_사이_빈칸에_새_장소를_넣지_않는다_폴백() -> None:
    problem, index = _morning_locks_case()
    result = RuleFallbackAssembler(index, _EST, _CFG).solve(problem)

    _assert_respects_not_before(result, problem, index)
    assert any(not _is_pinned(s, problem) for s in result.days[0].slots)


def test_체인이_OR_해를_그대로_낸다() -> None:
    """하한 때문에 OR 이 폴백으로 강등되면 안 된다(#843 뒤 이 경로가 OR 로 간다)."""
    problem, index = _morning_locks_case()
    facade = HybridAssemblyFacade(list(_both(index)), index, _EST, FakeClock(),
                                  InMemoryTrace())
    solved = facade.solve(problem, deadline_ms=5000)

    assert solved.solve_mode is SolveMode.OR_TOOLS
    _assert_respects_not_before(solved, problem, index)


@pytest.mark.parametrize("assembler", [0, 1], ids=["or", "fallback"])
def test_저녁_18시37분_FULL_DAY_는_그_이후만(assembler) -> None:
    """실측: 18:37 FULL_DAY 재계획이 09:34 부터 다시 짰다."""
    pois = _pois(8)
    problem = _problem(pois, (), _at(18, 37))
    index = {p.poi_id: p for p in pois}
    result = _both(index)[assembler].solve(problem, 1500)

    assert result is not None
    _assert_respects_not_before(result, problem, index)
    assert all(s.start_at >= _at(18, 37) for s in result.days[0].slots)


@pytest.mark.parametrize("assembler", [0, 1], ids=["or", "fallback"])
def test_창이_끝난_뒤면_새_방문_0건이고_잠금은_남는다(assembler) -> None:
    pois = _pois(6)
    locks = (_lock(pois[0], _at(9, 30)),)
    problem = _problem(pois, locks, _at(20, 50))
    index = {p.poi_id: p for p in pois}
    result = _both(index)[assembler].solve(problem, 1500)

    assert result is not None
    _assert_respects_not_before(result, problem, index)
    assert [s.poi_id for s in result.days[0].slots] == [pois[0].poi_id]


def test_초_단위_하한은_다음_분으로_올린다() -> None:
    """14:10:05 에 시작하는 14:10 슬롯은 이미 지났다 — 분 해상도 슬롯은 14:11 부터."""
    pois = _pois(6)
    problem = _problem(pois, (), _at(14, 10) + timedelta(seconds=5))
    index = {p.poi_id: p for p in pois}
    for assembly in _both(index):
        result = assembly.solve(problem, 1500)
        assert result is not None
        assert all(s.start_at >= _at(14, 11) for s in result.days[0].slots)


def test_후보이기도_한_잠금은_하한에_걸리지_않고_점수를_유지한다() -> None:
    """재계획은 원 일정 POI(잠금 포함)를 후보에 합류시킨다. 하한을 후보 노드에 걸면 잠금
    노드가 (하한이 그 노드 hi 를 넘을 때) 빠졌다가 고정 루프에서 점수 0 으로 다시 생겨
    슬롯 점수가 바뀐다 — 그래서 하한을 늦은 저녁(20:30)에 둔다."""
    problem, index = _morning_locks_case()
    problem = replace(problem, not_before=_at(20, 30))
    locked = [fb.poi_id for fb in problem.fixed_blocks]
    problem = replace(problem, candidates=problem.candidates + tuple(
        ScoredPoi(poi_id=pid, score=0.77, is_llm_score=True) for pid in locked))
    result = OrToolsAssembler(index, _EST, _CFG).solve(problem, remaining_ms=1500)

    assert result is not None
    _assert_respects_not_before(result, problem, index)
    scores = {s.poi_id: s.score for s in result.days[0].slots}
    assert all(scores[pid] == 0.77 for pid in locked), scores


# ── ①′ 하한 시각의 출발점은 지금 위치(앵커)다 — 리뷰 지적 ───────────────────

# 후보 격자에서 ~15km 떨어진 현재 위치 — 대중교통 ~100분 (리뷰 실측 96·100분)
_FAR = GeoPoint(_ANCHOR.lat + 0.13, _ANCHOR.lng)


@pytest.mark.parametrize("assembler", [0, 1], ids=["or", "fallback"])
def test_먼_곳에_있으면_하한에서_이동만큼_뒤에_시작한다(assembler) -> None:
    """종전: 하한이 앵커 이동을 지워 14:10 에 바로 시작(OR nb7 14:10, 폴백 nb0 14:10) —
    갈 수 없는 시각에 검증 도장이 찍혔다(INV-2). 하한 없는 같은 문제는 09:00+96분을 지킨다."""
    pois = _pois(12)
    index = {p.poi_id: p for p in pois}
    problem = _problem(pois, (), _at(14, 10), anchor=_FAR)
    result = _both(index)[assembler].solve(problem, 3000)

    assert result is not None
    assert result.days[0].slots, "14:10+이동 뒤에도 하루가 남는데 새 방문이 0건이다"
    _assert_respects_not_before(result, problem, index)
    assert min(s.start_at for s in result.days[0].slots) >= _at(15, 30)


@pytest.mark.parametrize("assembler", [0, 1], ids=["or", "fallback"])
def test_지난_잠금_뒤에도_지금_위치에서_출발한다(assembler) -> None:
    """잠금이 하한 앞에 있으면 종전엔 그 잠금 장소에서 이동을 셌다(13:45 + 몇 분 → 14:10).
    사용자는 이미 그곳을 떠나 지금 위치(앵커)에 있다."""
    pois = _pois(10)
    index = {p.poi_id: p for p in pois}
    problem = _problem(pois, (_lock(pois[0], _at(12, 45)),), _at(14, 10), anchor=_FAR)
    result = _both(index)[assembler].solve(problem, 3000)

    assert result is not None
    _assert_respects_not_before(result, problem, index)
    free = [s for s in result.days[0].slots if not _is_pinned(s, problem)]
    assert free and min(s.start_at for s in free) >= _at(15, 30)


class _NoTravelStage:
    """하한 시각에 바로 시작하는 단계 — 앵커 이동을 무시한 해가 체인을 통과하면 INV-2 위반."""

    name = "no_travel"
    required_ms = 0

    def __init__(self, poi: Poi) -> None:
        self._poi = poi

    def solve(self, problem, remaining_ms):
        slot = VisitSlot(poi_id=self._poi.poi_id, start_at=_at(14, 10), end_at=_at(15, 10),
                         stay_min=60, score=0.5, is_llm_score=False)
        return ItinerarySolution(
            schedule_id=problem.schedule_id,
            days=(DaySolution(date=_DAY, slots=(slot,), fixed_blocks=()),),
            is_fallback=False, solve_mode=SolveMode.OR_TOOLS, assembly_run=None)


def test_체인이_앵커_이동을_무시한_하한_해를_거부한다() -> None:
    pois = _pois(8)
    index = {p.poi_id: p for p in pois}
    problem = _problem(pois, (), _at(14, 10), anchor=_FAR)
    trace = InMemoryTrace()
    facade = HybridAssemblyFacade(
        [_NoTravelStage(pois[0]), RuleFallbackAssembler(index, _EST, _CFG)],
        index, _EST, FakeClock(), trace)

    solved = facade.solve(problem, deadline_ms=5000)

    assert solved.solve_mode is not SolveMode.OR_TOOLS, "갈 수 없는 시각이 체인을 통과했다"
    assert any(getattr(e, "reason", "").startswith("invalid:") for e in trace.events)
    _assert_respects_not_before(solved, problem, index)


# ── ② PBT — 임의 잠금·하한 ──────────────────────────────────────────────

# 잠금 후보 시각 — 서로 2시간 이상 떨어져 잠금끼리는 항상 이동 가능(≤ ~1.5km)
_LOCK_STARTS = ((9, 0), (11, 0), (13, 0), (15, 0), (17, 0), (19, 0))


@st.composite
def _locked_setups(draw):
    n = draw(st.integers(min_value=2, max_value=8))
    pois = _pois(n)
    k = draw(st.integers(min_value=0, max_value=min(2, n - 1)))
    starts = sorted(draw(st.lists(st.sampled_from(_LOCK_STARTS), min_size=k, max_size=k,
                                  unique=True)))
    locks = tuple(_lock(pois[i], _at(h, m)) for i, (h, m) in enumerate(starts))
    nb_min = draw(st.integers(min_value=8 * 60, max_value=21 * 60 + 30))
    not_before = _at(0) + timedelta(minutes=nb_min)
    anchor = draw(st.one_of(st.none(), st.just(_ANCHOR), st.just(_FAR)))
    seed = draw(st.integers(min_value=0, max_value=2**31))
    problem = _problem(pois, locks, not_before, anchor=anchor, seed=seed)
    return problem, {p.poi_id: p for p in pois}


@settings(max_examples=25, deadline=None)
@given(setup=_locked_setups())
def test_OR_은_임의_잠금_하한에서_해를_내고_하한을_지킨다(setup) -> None:
    """OR 이 None 이 아니라는 단언이 **용량 컷 유효성**의 증거다 — 영업정보 없는 풀이라
    그리디 해(잠금 + 하한 이후 말단 삽입)가 모델의 실행가능 해이고, 컷이 그걸 자르면
    INFEASIBLE 이 된다. (하한은 노드 정의역을 좁히기만 해서 원 모델의 해 집합의 부분집합이고,
    컷은 원 모델의 모든 해에 성립하므로 좁힌 모델에도 성립한다.)"""
    problem, index = setup
    result = OrToolsAssembler(index, _EST, _CFG).solve(problem, remaining_ms=1500)
    assert result is not None
    _assert_respects_not_before(result, problem, index)


@settings(max_examples=40, deadline=None)
@given(setup=_locked_setups())
def test_폴백은_임의_잠금_하한에서_하한을_지킨다(setup) -> None:
    problem, index = setup
    _assert_respects_not_before(
        RuleFallbackAssembler(index, _EST, _CFG).solve(problem), problem, index)


@settings(max_examples=15, deadline=None)
@given(setup=_locked_setups())
def test_체인은_임의_잠금_하한에서_모순이_아니다(setup) -> None:
    """잠금이 하한보다 앞(창 앞쪽)에 있어도 AssemblyConflictError(→409) 가 아니다."""
    problem, index = setup
    facade = HybridAssemblyFacade(list(_both(index)), index, _EST, FakeClock(),
                                  InMemoryTrace())
    _assert_respects_not_before(facade.solve(problem, deadline_ms=5000), problem, index)


# ── ③ 하한이 무의미하면 해가 바이트 동일 (generate 무변경) ─────────────


@settings(max_examples=8, deadline=None)
@given(setup=assembly_setups(), offset=st.integers(min_value=0, max_value=600),
       kind=st.sampled_from(("window_start", "earlier_day")))
def test_무의미한_하한은_해를_바꾸지_않는다(setup, offset, kind) -> None:
    problem, index = setup
    assert problem.not_before is None  # 기본값 — generate 경로는 하한이 없다
    ws = problem.day_window.start
    if kind == "window_start":  # 창 시작 이전 같은 날 — 아무것도 자르지 않는다
        nb = ws - timedelta(minutes=offset % (9 * 60))
    else:  # 첫 일자보다 앞 날짜 — 그날 하한이 아니다
        nb = ws - timedelta(days=1, minutes=offset)
    bounded = replace(problem, not_before=nb)
    for assembly in _both(index):
        assert assembly.solve(bounded, 1500) == assembly.solve(problem, 1500)


def test_직렬화_왕복과_하위호환() -> None:
    problem, _ = _morning_locks_case()
    assert ItineraryProblem.from_dict(problem.to_dict()) == problem
    legacy = problem.to_dict()
    del legacy["not_before"]
    assert ItineraryProblem.from_dict(legacy).not_before is None


# ── ④ 체인 검증 ──────────────────────────────────────────────────────────


class _PastSlotStage:
    """하한 이전에 비고정 슬롯을 놓는 단계 — 체인이 이걸 내보내면 INV-2 위반이다."""

    name = "past_slot"
    required_ms = 0

    def __init__(self, poi: Poi) -> None:
        self._poi = poi

    def solve(self, problem, remaining_ms):
        slot = VisitSlot(poi_id=self._poi.poi_id, start_at=_at(11), end_at=_at(12),
                         stay_min=60, score=0.5, is_llm_score=False)
        fixed = tuple(VisitSlot(poi_id=fb.poi_id, start_at=fb.window.start,
                                end_at=fb.window.end, stay_min=60, score=0.0,
                                is_llm_score=False) for fb in problem.fixed_blocks)
        slots = tuple(sorted((slot, *fixed), key=lambda s: s.start_at))
        return ItinerarySolution(
            schedule_id=problem.schedule_id,
            days=(DaySolution(date=_DAY, slots=slots, fixed_blocks=problem.fixed_blocks),),
            is_fallback=False, solve_mode=SolveMode.OR_TOOLS, assembly_run=None)


def test_체인이_하한_이전_비고정_슬롯을_거부한다() -> None:
    problem, index = _morning_locks_case()
    stray = index[PoiId("nb5")]
    trace = InMemoryTrace()
    facade = HybridAssemblyFacade(
        [_PastSlotStage(stray), RuleFallbackAssembler(index, _EST, _CFG)],
        index, _EST, FakeClock(), trace)

    solved = facade.solve(problem, deadline_ms=5000)

    assert solved.solve_mode is not SolveMode.OR_TOOLS, "하한 위반 해가 체인을 통과했다"
    assert any(getattr(e, "reason", "").startswith("invalid:") for e in trace.events)
    _assert_respects_not_before(solved, problem, index)


def test_고정_블록은_하한_이전이어도_위반이_아니다() -> None:
    """잠금은 이미 지난 시각에 있는 게 정상이다 — 위반으로 보면 잠금이 있는 재계획이 전부 거부된다."""
    problem, index = _morning_locks_case()
    facade = HybridAssemblyFacade([RuleFallbackAssembler(index, _EST, _CFG)],
                                  index, _EST, FakeClock(), InMemoryTrace())
    solved = facade.solve(problem, deadline_ms=5000)
    assert {s.poi_id for s in solved.days[0].slots} >= {fb.poi_id for fb in problem.fixed_blocks}


# ── ⑤ 배선 ──────────────────────────────────────────────────────────────


def _spy_post(**over):
    app = build_dev_app(directives=_DIRECTIVES)
    spy = _SpyScheduleAgent(app.state.orchestrator._schedule_agent)
    app.state.orchestrator._schedule_agent = spy
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post("/ai/v1/planb/replan", json=_body(**over))
    return response, spy


def _new_slots(body: dict) -> list[dict]:
    return [s for d in body["itinerary"]["days"] for s in d["slots"] if not s["is_fixed"]]


def test_그_일자의_from_instant_가_하한으로_실린다() -> None:
    response, spy = _spy_post(from_instant="2026-09-21T14:10:05+09:00")

    assert response.status_code == 200, response.text
    nb = spy.tasks[0].request.not_before
    # 값은 BE 가 보낸 그대로 싣는다 — 분 올림은 어셈블러 한 곳(`not_before_floor`)이 한다
    assert nb == datetime(2026, 9, 21, 14, 10, 5, tzinfo=_KST)


def test_다른_일자의_from_instant_는_하한이_아니다() -> None:
    """내일 하루를 오늘 다시 짜는 경우 — 하루 전체가 열려 있어야 한다."""
    response, spy = _spy_post(from_instant="2026-09-20T22:00:00+09:00")

    assert response.status_code == 200, response.text
    assert spy.tasks[0].request.not_before is None


def test_UTC_로_온_from_instant_도_현지_일자로_판정한다() -> None:
    """05:10Z = 14:10 KST — UTC 날짜가 같아도 시각을 현지로 옮기지 않으면 9시간 어긋난다."""
    response, spy = _spy_post(from_instant="2026-09-21T05:10:00Z")

    assert response.status_code == 200, response.text
    assert spy.tasks[0].request.not_before == datetime(2026, 9, 21, 14, 10, tzinfo=_KST)


def test_18시37분_재계획은_그_이후만_또는_정직한_빈_결과() -> None:
    response, _ = _spy_post(from_instant="2026-09-21T18:37:00+09:00")

    assert response.status_code == 200, response.text
    body = response.json()
    if body["itinerary"] is None:
        assert body["empty_reason"]["code"] == "NO_FEASIBLE_SLOT"
        return
    starts = [s["start_at"] for s in _new_slots(body)]
    assert starts and all(t >= "18:37" for t in starts), starts


def test_남은_시간이_없으면_잠금만_남은_일정이_아니라_빈_결과다() -> None:
    """잠금만 든 일정을 '재계획안'으로 내면 BE 가 남은 슬롯을 전부 지운 하루로 읽는다."""
    seed = demo_poi_seed()
    locked = str(seed[1].poi_id)  # 흑돼지거리 — 앵커 근처
    response, _ = _spy_post(
        from_instant="2026-09-21T20:50:00+09:00",
        locked_blocks=[{"poi_id": locked, "date": "2026-09-21", "start": "09:30",
                        "dwell_min": 60}],
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["itinerary"] is None, body
    assert body["empty_reason"] == {"code": "NO_FEASIBLE_SLOT",
                                    "params": {"from": "20:50"}}


def test_잠금이_창_앞쪽이어도_재계획이_실패하지_않는다() -> None:
    seed = demo_poi_seed()
    locked = str(seed[1].poi_id)
    response, _ = _spy_post(
        from_instant="2026-09-21T14:10:00+09:00",
        locked_blocks=[{"poi_id": locked, "date": "2026-09-21", "start": "09:00",
                        "dwell_min": 60}],
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["empty_reason"] is None, body["notes"]
    assert all(s["start_at"] >= "14:10" for s in _new_slots(body))


def test_지난_잠금끼리_이동이_안_맞아도_재계획은_된다() -> None:
    """지난 잠금은 **이력**이지 검증할 제약이 아니다 (2026-10-04 로컬 실측).

    PARTIAL_SLOTS 14:00 재계획 — BE 가 지난 슬롯을 전부 잠가 보낸다. 원 일정의
    09:00-10:00 → 10:00-11:15 처럼 지금 추정으로는 이동이 안 맞는 지난 잠금이 하나라도
    있으면 체인이 "고정 블록 모순"으로 하루를 통째로 포기했다(재계획 표본 4건 중 1건).
    지난 잠금은 솔버 밖에서 그대로 되싣는다 — 시각은 원 일정 값 그대로라 지어낸 시각이
    아니고(INV-2), BE 는 잠금 슬롯의 위반 표시를 원본에서 이어받는다(TRIP-839).
    """
    seed = demo_poi_seed()
    a, b = str(seed[0].poi_id), str(seed[3].poi_id)  # 성산일출봉 ↔ 한라산 — 30km 넘게 떨어져 있다
    response, spy = _spy_post(
        scope="PARTIAL_SLOTS",
        from_instant="2026-09-21T14:00:00+09:00",
        locked_blocks=[
            {"poi_id": a, "date": "2026-09-21", "start": "09:00", "dwell_min": 60},
            {"poi_id": b, "date": "2026-09-21", "start": "10:00", "dwell_min": 75},
        ],
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["empty_reason"] is None, body["notes"]
    slots = [s for d in body["itinerary"]["days"] for s in d["slots"]]
    pinned = {(s["poi_id"], s["start_at"][:5], s["end_at"][:5]) for s in slots if s["is_fixed"]}
    assert pinned == {(a, "09:00", "10:00"), (b, "10:00", "11:15")}
    assert all(s["start_at"] >= "14:00" for s in _new_slots(body))
    # 솔버에는 지난 잠금이 안 간다 — 다시 검증할 대상이 아니다
    assert spy.tasks[0].request.fixed_blocks == ()
    # 다녀온 곳을 새 방문으로 다시 넣지 않는다
    assert {a, b}.isdisjoint(s["poi_id"] for s in _new_slots(body))


def test_에이전트가_하한을_어셈블리_문제로_넘긴다() -> None:
    """요청에만 실리고 ItineraryProblem 으로 안 넘어가면 어셈블리는 하한을 모른다."""
    from tests.test_replan_via_planb import _agent, _case
    from tests.test_schedule_agent import _task

    pool, req = _case()
    nb = req.day_window.start + timedelta(hours=1)
    agent, _ = _agent()
    sink = agent._assembly_provider._sink
    agent.run(_task(pool, request=replace(req, not_before=nb)))
    assert sink.problems and sink.problems[-1].not_before == nb


# ── ⑥ 시드 결정론 ───────────────────────────────────────────────────────


def test_재계획_시드는_trip_id_crc32_이고_요청_id_와_무관하다() -> None:
    meta = _body()["request_meta"]
    _, first = _spy_post()
    _, second = _spy_post(request_meta={**meta, "request_id": "다른-요청-id"})

    seed = first.tasks[0].request.seed
    assert seed == zlib.crc32(b"trip-replan-wired")  # generate 의 _seed_from 과 같은 키
    assert second.tasks[0].request.seed == seed


def test_재계획_시드는_프로세스_해시_솔트와_무관하다() -> None:
    """종전 `abs(hash(request_id)) % 10_000` 은 PYTHONHASHSEED 마다 달랐다."""
    script = (
        "from tests.test_replan_not_before import _spy_post\n"
        "_, spy = _spy_post()\n"
        "print(spy.tasks[0].request.seed)\n"
    )
    seeds = set()
    for salt in ("1", "2"):
        out = subprocess.run(
            [sys.executable, "-c", script], capture_output=True, text=True, check=True,
            env={**os.environ, "PYTHONHASHSEED": salt},
            cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        seeds.add(out.stdout.strip().splitlines()[-1])
    assert len(seeds) == 1, seeds
