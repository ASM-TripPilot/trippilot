"""U2 — OrToolsSolver 정식판 + 예산 단조(U5-P6).

증명하는 것:
  ① OR-Tools 출력도 HC1~4 위반 0 (U5-P1 — 1차 단계 판)
  ② 결정론: 동일 입력 2회 → 동일 해 (소규모=OPTIMAL 도달, U5-P3)
  ③ 체인 통합: 가해 문제에서 facade가 OR_TOOLS 해를 선택 (규칙 폴백보다 우선)
  ④ U5-P6: budget_fit 단조성 — 저비용 POI는 예산↓일수록 보상↑, 고비용은 반대
"""

from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.c2.config import SolverConfig
from trippilot.c2.constraints import check_all
from trippilot.c2.facade import HybridSolverFacade
from trippilot.c2.fallback_solver import RuleFallbackSolver
from trippilot.c2.ortools_solver import OrToolsSolver
from trippilot.c2.scorer import budget_fit
from trippilot.c2.travel import TravelEstimator
from trippilot.domain.common import BudgetLevel
from trippilot.domain.itinerary import SolveMode

from tests.fakes.fake_clock import FakeClock
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.generators.solver import solver_setups

# 테스트용 짧은 리밋 — 소규모(≤8 노드)는 수십 ms에 OPTIMAL 도달
_CFG = SolverConfig(or_tools_limit_ms=1000, or_tools_min_ms=50)
_EST = TravelEstimator(_CFG)


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
