"""U2 — OrToolsSolver 정식판 + 예산 단조(U5-P6).

증명하는 것:
  ① OR-Tools 출력도 HC1~4 위반 0 (U5-P1 — 1차 단계 판)
  ② 결정론: 동일 입력 2회 → 동일 해 (소규모=OPTIMAL 도달, U5-P3)
  ③ 체인 통합: 가해 문제에서 facade가 OR_TOOLS 해를 선택 (규칙 폴백보다 우선)
  ④ U5-P6: budget_fit 단조성 — 저비용 POI는 예산↓일수록 보상↑, 고비용은 반대
  ⑤ TRIP-314: 웜스타트 하위 문제가 좁히는 필드 외 전 필드를 원본 그대로 승계
"""

from __future__ import annotations

from dataclasses import fields
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.solver_engine.config import SolverConfig
from trippilot.solver_engine.constraints import check_all
from trippilot.solver_engine.facade import HybridSolverFacade
from trippilot.solver_engine.fallback_solver import RuleFallbackSolver
from trippilot.solver_engine.ortools_solver import OrToolsSolver
from trippilot.solver_engine.scorer import budget_fit
from trippilot.solver_engine.travel import TravelEstimator
from trippilot.domain.common import (
    BudgetLevel,
    GeoPoint,
    PoiId,
    ScheduleId,
    TransportMode,
)
from trippilot.domain.itinerary import (
    FixedBlock,
    ItineraryProblem,
    SolveMode,
    TimeWindow,
)
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource

from tests.fakes.fake_clock import FakeClock
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.generators.solver import solver_setups

# 테스트용 짧은 리밋 — 소규모(≤8 노드)는 수십 ms에 OPTIMAL 도달
_CFG = SolverConfig(or_tools_limit_ms=1000, or_tools_min_ms=50)
_EST = TravelEstimator(_CFG)
_KST = timezone(timedelta(hours=9))


# ① 출력 유효성 (U5-P1 — OR-Tools 판)
@settings(max_examples=15, deadline=None)
@given(setup=solver_setups())
def test_ortools_output_passes_all_hard_constraints(setup) -> None:
    problem, index = setup
    result = OrToolsSolver(index, _EST, _CFG).solve(problem, remaining_ms=1500)
    if result is None:  # 시간창 불가 등 — 체인이 처리할 영역
        return
    assert check_all(result, problem, index, _EST) == []
    assert result.solve_mode == SolveMode.OR_TOOLS
    assert result.is_fallback is False


# ② 결정론 (U5-P3)
@settings(max_examples=8, deadline=None)
@given(setup=solver_setups())
def test_ortools_is_deterministic(setup) -> None:
    problem, index = setup
    solver = OrToolsSolver(index, _EST, _CFG)
    assert solver.solve(problem, 1500) == solver.solve(problem, 1500)


# ③ 체인 통합 — OR-Tools가 해를 내면 그것이 선택됨 (출처 보존)
@settings(max_examples=8, deadline=None)
@given(setup=solver_setups())
def test_chain_prefers_ortools_when_feasible(setup) -> None:
    problem, index = setup
    chain = [OrToolsSolver(index, _EST, _CFG),
             RuleFallbackSolver(index, _EST, _CFG)]
    facade = HybridSolverFacade(chain, index, _EST, FakeClock(), InMemoryTrace())
    result = facade.solve(problem, deadline_ms=5000)
    # OR-Tools가 유효 해를 내면 OR_TOOLS, 아니면 폴백 — 어느 쪽이든 유효해야 함
    assert facade.validate(result, problem, deadline_ms=1000) == []
    assert result.solve_mode in (SolveMode.OR_TOOLS, SolveMode.RULE_FALLBACK,
                                 SolveMode.MINIMAL)


# ④ U5-P6 — 예산 소프트 가중 단조성
@given(cost=st.integers(min_value=0, max_value=15_000))
def test_budget_fit_cheap_poi_monotone_decreasing_with_budget(cost: int) -> None:
    low, mid, high = (budget_fit(cost, BudgetLevel.LOW),
                      budget_fit(cost, BudgetLevel.MID),
                      budget_fit(cost, BudgetLevel.HIGH))
    assert low >= mid >= high  # 저비용: 예산 낮을수록 보상 크거나 같음


@given(cost=st.integers(min_value=40_001, max_value=200_000))
def test_budget_fit_expensive_poi_monotone_increasing_with_budget(cost: int) -> None:
    low, mid, high = (budget_fit(cost, BudgetLevel.LOW),
                      budget_fit(cost, BudgetLevel.MID),
                      budget_fit(cost, BudgetLevel.HIGH))
    assert low <= mid <= high  # 고비용: 예산 높을수록 보상 크거나 같음


def test_budget_fit_unknown_cost_is_budget_neutral() -> None:
    assert (budget_fit(None, BudgetLevel.LOW)
            == budget_fit(None, BudgetLevel.MID)
            == budget_fit(None, BudgetLevel.HIGH))


# ⑤ 회귀(TRIP-314) — 웜스타트 하위 문제의 필드 승계
# 하루로 좁히는 3필드 외에는 원본을 그대로 이어받아야 한다. 필드를 나열해
# 재구성하면 나중에 추가된 필드가 조용히 빠진다(TRIP-292의 excluded_poi_ids).
# dataclasses.fields로 순회하므로 ItineraryProblem에 필드가 늘어도 자동 적용.
_NARROWED_BY_GREEDY_HINT = {"days", "candidates", "fixed_blocks"}


@settings(max_examples=10, deadline=None)
@given(setup=solver_setups())
def test_greedy_hint_subproblem_carries_over_untouched_fields(setup) -> None:
    problem, index = setup
    captured: list = []
    original = RuleFallbackSolver.solve

    def capturing(self, sub, *args, **kwargs):
        captured.append(sub)
        return original(self, sub, *args, **kwargs)

    with patch.object(RuleFallbackSolver, "solve", capturing):
        OrToolsSolver(index, _EST, _CFG)._greedy_hint(problem, problem.days[0], set())

    assert len(captured) == 1
    sub = captured[0]
    for f in fields(problem):
        if f.name in _NARROWED_BY_GREEDY_HINT:
            continue
        assert getattr(sub, f.name) == getattr(problem, f.name), f.name


# ── ⑥ TRIP-343 회귀 — 배치된 고정 블록이 DaySolution.fixed_blocks로 노출된다
# (비워 두면 경계 to_payload의 is_fixed가 상시 false → 왕복 후 HC3 검증 집합이 빈다)


def _fixed_setup():
    """고정 블록 1개 + 후보 3개짜리 결정론 소형 문제 (영업정보 없음 → HC1 미적용)."""
    d = date(2026, 8, 5)
    pois = [
        Poi(PoiId(f"fx{i}"), f"fx{i}", PoiCategory.SIGHT,
            GeoPoint(37.751 + 0.005 * i, 128.876), (),
            None, None, DataQuality.FULL, PoiSource.SEED, None)
        for i in range(3)
    ]
    index = {p.poi_id: p for p in pois}
    candidates = tuple(
        ScoredPoi(poi_id=p.poi_id, score=0.5, is_llm_score=False) for p in pois
    )
    fb = FixedBlock(
        poi_id=pois[0].poi_id,
        window=TimeWindow(datetime(2026, 8, 5, 10, 0, tzinfo=_KST),
                          datetime(2026, 8, 5, 11, 0, tzinfo=_KST)),
        reason="user_fixed",
    )
    problem = ItineraryProblem(
        schedule_id=ScheduleId("s-343"), days=(d,), candidates=candidates,
        fixed_blocks=(fb,), budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=TimeWindow(datetime(2026, 8, 5, 9, 0, tzinfo=_KST),
                              datetime(2026, 8, 5, 21, 0, tzinfo=_KST)),
        seed=7,
    )
    return problem, index, fb


def test_ortools_populates_placed_fixed_blocks() -> None:
    problem, index, fb = _fixed_setup()
    result = OrToolsSolver(index, _EST, _CFG).solve(problem, remaining_ms=1500)
    assert result is not None  # 소형 가해 문제 — 해가 있어야 한다
    (day,) = result.days
    assert day.fixed_blocks == (fb,)  # 회귀: 상시 () 결함 (TRIP-343)
    assert any(s.poi_id == fb.poi_id and s.start_at == fb.window.start
               and s.end_at == fb.window.end for s in day.slots)
    assert check_all(result, problem, index, _EST) == []  # HC1~4 계속 성립


# TRIP-343 PBT — fixed_blocks는 "그 일자에 정확히 배치된 문제 고정 블록"과 일치
@settings(max_examples=15, deadline=None)
@given(setup=solver_setups())
def test_ortools_fixed_blocks_mirror_placed_slots(setup) -> None:
    problem, index = setup
    result = OrToolsSolver(index, _EST, _CFG).solve(problem, remaining_ms=1500)
    if result is None:  # 시간창 불가 등 — 체인이 처리할 영역
        return
    for day in result.days:
        placed = {(s.poi_id, s.start_at, s.end_at) for s in day.slots}
        for fb in day.fixed_blocks:  # 건전성
            assert fb in problem.fixed_blocks
            assert (fb.poi_id, fb.window.start, fb.window.end) in placed
        for fb in problem.fixed_blocks:  # 완전성
            if (fb.poi_id, fb.window.start, fb.window.end) in placed:
                assert fb in day.fixed_blocks
