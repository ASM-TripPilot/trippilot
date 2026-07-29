"""U2 — HC 검증기 + 규칙 폴백 솔버 PBT.

증명하는 것:
  ① U5-P1(그리디판): 임의 problem에서 RuleFallbackSolver 출력은 HC1~4 위반 0
  ② U5-P3        : 동일 입력 → 동일 출력 (결정론)
  ③ HC 검증기     : 위반을 실제로 잡는다 (4종 각각 음성 케이스)
  ④ INV-4        : 폴백 해는 폴백 모드로 정직하게 태깅됨 (U1 정합 규칙과 결합)
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from hypothesis import given, settings

from trippilot.c2.config import SolverConfig
from trippilot.c2.constraints import check_all, check_hc1, check_hc2, check_hc3, check_hc4
from trippilot.c2.fallback_solver import RuleFallbackSolver
from trippilot.c2.travel import TravelEstimator
from trippilot.domain.common import (
    BudgetLevel,
    GeoPoint,
    PoiId,
    ScheduleId,
    TransportMode,
)
from trippilot.domain.itinerary import (
    DaySolution,
    FixedBlock,
    ItineraryProblem,
    ItinerarySolution,
    SolveMode,
    TimeWindow,
    VisitSlot,
)
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource

from tests.generators.solver import solver_setups

_KST = timezone(timedelta(hours=9))
_CFG = SolverConfig()
_EST = TravelEstimator(_CFG)


# ① 폴백 솔버 출력은 항상 HC 통과 (U5-P1 그리디판)
@settings(max_examples=60)
@given(setup=solver_setups())
def test_fallback_solution_passes_all_hard_constraints(setup) -> None:
    problem, index = setup
    solution = RuleFallbackSolver(index, _EST, _CFG).solve(problem)
    assert check_all(solution, problem, index, _EST) == []


# ② 결정론 (U5-P3)
@settings(max_examples=30)
@given(setup=solver_setups())
def test_fallback_is_deterministic(setup) -> None:
    problem, index = setup
    solver = RuleFallbackSolver(index, _EST, _CFG)
    assert solver.solve(problem) == solver.solve(problem)


# ④ 폴백 정직성 — is_fallback=True + 폴백 모드 (U1 출처 정합과 맞물림)
@settings(max_examples=30)
@given(setup=solver_setups())
def test_fallback_mode_is_honest(setup) -> None:
    problem, index = setup
    solution = RuleFallbackSolver(index, _EST, _CFG).solve(problem)
    assert solution.is_fallback is True
    assert solution.solve_mode in (SolveMode.RULE_FALLBACK, SolveMode.MINIMAL)


# ③ HC 검증기 음성 케이스 — 위반을 만들면 잡아야 한다
def _fixture():
    d = date(2026, 8, 5)
    poi_a = Poi(PoiId("a"), "A", PoiCategory.SIGHT, GeoPoint(37.75, 128.87),
                (OpenHour(d.weekday(), 600, 1080),),  # 10:00~18:00
                None, None, DataQuality.FULL, PoiSource.SEED, None)
    poi_b = Poi(PoiId("b"), "B", PoiCategory.CAFE, GeoPoint(37.79, 128.92),
                (), None, None, DataQuality.FULL, PoiSource.SEED, None)
    window = TimeWindow(datetime(2026, 8, 5, 9, 0, tzinfo=_KST),
                        datetime(2026, 8, 5, 21, 0, tzinfo=_KST))
    problem = ItineraryProblem(
        schedule_id=ScheduleId("s"), days=(d,), candidates=(),
        fixed_blocks=(), budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=window, seed=1)
    index = {poi_a.poi_id: poi_a, poi_b.poi_id: poi_b}
    return d, poi_a, poi_b, problem, index


def _slot(pid, h1, m1, h2, m2):
    return VisitSlot(PoiId(pid),
                     datetime(2026, 8, 5, h1, m1, tzinfo=_KST),
                     datetime(2026, 8, 5, h2, m2, tzinfo=_KST),
                     stay_min=60, score=0.5, is_llm_score=False)


def _solution(*slots):
    return ItinerarySolution(
        schedule_id=ScheduleId("s"),
        days=(DaySolution(date(2026, 8, 5), tuple(slots), ()),),
        is_fallback=True, solve_mode=SolveMode.RULE_FALLBACK, solver_run=None)


def test_hc1_catches_out_of_hours() -> None:
    _, _, _, problem, index = _fixture()
    sol = _solution(_slot("a", 9, 0, 10, 0))  # A는 10시 영업 시작 — 위반
    assert any(v.code == "HC1" for v in check_hc1(sol, index))


def test_hc2_catches_impossible_travel() -> None:
    _, _, _, problem, index = _fixture()
    # a(~11:00) 종료 직후 11:01에 b 시작 — 4.7km 이동 불가
    sol = _solution(_slot("a", 10, 0, 11, 0), _slot("b", 11, 1, 12, 0))
    assert any(v.code == "HC2" for v in check_hc2(sol, index, _EST, problem))


def test_hc3_catches_missing_fixed_block() -> None:
    d, poi_a, _, problem, index = _fixture()
    fb = FixedBlock(poi_a.poi_id,
                    TimeWindow(datetime(2026, 8, 5, 10, 0, tzinfo=_KST),
                               datetime(2026, 8, 5, 11, 0, tzinfo=_KST)), "user")
    problem2 = ItineraryProblem(
        schedule_id=problem.schedule_id, days=problem.days,
        candidates=problem.candidates, fixed_blocks=(fb,),
        budget=problem.budget, transport=problem.transport,
        day_window=problem.day_window, seed=problem.seed)
    sol = _solution()  # 고정 블록 슬롯 없음 — 위반
    assert any(v.code == "HC3" for v in check_hc3(sol, problem2))


def test_hc4_catches_outside_day_window() -> None:
    _, _, _, problem, index = _fixture()
    sol = _solution(_slot("b", 8, 0, 9, 0))  # day window(09~21) 이전 시작 — 위반
    assert any(v.code == "HC4" for v in check_hc4(sol, problem))
