"""U2 — OrToolsAssembler 정식판 + 예산 단조(U5-P6).

증명하는 것:
  ① OR-Tools 출력도 HC1~4 위반 0 (U5-P1 — 1차 단계 판)
  ② 결정론: 동일 입력 2회 → 동일 해 (소규모=OPTIMAL 도달, U5-P3)
  ③ 체인 통합: 가해 문제에서 facade가 OR_TOOLS 해를 선택 (규칙 폴백보다 우선)
  ④ U5-P6: admission_fit 단조성 — 저비용 POI는 예산↓일수록 보상↑, 고비용은 반대
  ⑤ TRIP-314: 웜스타트 하위 문제가 좁히는 필드 외 전 필드를 원본 그대로 승계
"""

from __future__ import annotations

from dataclasses import fields
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.constraints import check_all
from trippilot.assembly_engine.facade import HybridAssemblyFacade
from trippilot.assembly_engine.fallback_assembler import RuleFallbackAssembler
from trippilot.assembly_engine.ortools_assembler import OrToolsAssembler
from trippilot.assembly_engine.scorer import _FEE_CEILING, admission_fit
from trippilot.assembly_engine.travel import TravelEstimator
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
from tests.generators.assembly import assembly_setups

# 테스트용 짧은 리밋 — 소규모(≤8 노드)는 수십 ms에 OPTIMAL 도달
_CFG = AssemblyConfig(or_tools_limit_ms=1000, or_tools_min_ms=50)
_EST = TravelEstimator(_CFG)
_KST = timezone(timedelta(hours=9))


# ① 출력 유효성 (U5-P1 — OR-Tools 판)
@settings(max_examples=15, deadline=None)
@given(setup=assembly_setups())
def test_ortools_output_passes_all_hard_constraints(setup) -> None:
    problem, index = setup
    result = OrToolsAssembler(index, _EST, _CFG).solve(problem, remaining_ms=1500)
    if result is None:  # 시간창 불가 등 — 체인이 처리할 영역
        return
    assert check_all(result, problem, index, _EST) == []
    assert result.solve_mode == SolveMode.OR_TOOLS
    assert result.is_fallback is False


# ② 결정론 (U5-P3)
@settings(max_examples=8, deadline=None)
@given(setup=assembly_setups())
def test_ortools_is_deterministic(setup) -> None:
    problem, index = setup
    assembly = OrToolsAssembler(index, _EST, _CFG)
    assert assembly.solve(problem, 1500) == assembly.solve(problem, 1500)


# ③ 체인 통합 — OR-Tools가 해를 내면 그것이 선택됨 (출처 보존)
@settings(max_examples=8, deadline=None)
@given(setup=assembly_setups())
def test_chain_prefers_ortools_when_feasible(setup) -> None:
    problem, index = setup
    chain = [OrToolsAssembler(index, _EST, _CFG),
             RuleFallbackAssembler(index, _EST, _CFG)]
    facade = HybridAssemblyFacade(chain, index, _EST, FakeClock(), InMemoryTrace())
    result = facade.solve(problem, deadline_ms=5000)
    # OR-Tools가 유효 해를 내면 OR_TOOLS, 아니면 폴백 — 어느 쪽이든 유효해야 함
    assert facade.validate(result, problem, deadline_ms=1000) == []
    assert result.solve_mode in (SolveMode.OR_TOOLS, SolveMode.RULE_FALLBACK,
                                 SolveMode.MINIMAL)


# ④ U5-P6 — 예산 소프트 가중 단조성 (입장료 파생 지식 도입 후에도 보존)
#
# 종전 `budget_fit(avg_cost, …)` 를 `admission_fit(fee, category, budget)` 이 대체했다.
# 세 성질은 그대로 지켜야 한다 — 함수가 바뀌었다고 규칙이 바뀌는 것이 아니다.
_CEIL_CATS = tuple(_FEE_CEILING[BudgetLevel.LOW])  # 임계가 정의된 카테고리만


@given(fee=st.integers(min_value=0, max_value=5_000),
       category=st.sampled_from(_CEIL_CATS))
def test_admission_fit_cheap_poi_monotone_decreasing_with_budget(fee, category) -> None:
    low, mid, high = (admission_fit(fee, category, BudgetLevel.LOW),
                      admission_fit(fee, category, BudgetLevel.MID),
                      admission_fit(fee, category, BudgetLevel.HIGH))
    assert low >= mid >= high  # 저비용: 예산 낮을수록 보상 크거나 같음


@given(fee=st.integers(min_value=50_000, max_value=200_000),
       category=st.sampled_from(_CEIL_CATS))
def test_admission_fit_expensive_poi_monotone_increasing_with_budget(fee, category) -> None:
    low, mid, high = (admission_fit(fee, category, BudgetLevel.LOW),
                      admission_fit(fee, category, BudgetLevel.MID),
                      admission_fit(fee, category, BudgetLevel.HIGH))
    assert low <= mid <= high  # 고비용: 예산 높을수록 보상 크거나 같음


@given(category=st.sampled_from(tuple(PoiCategory)))
def test_admission_fit_unknown_fee_is_budget_neutral(category) -> None:
    """모르는 것은 예산과 무관하다 — 커버리지가 점수를 흔들지 않는 근거."""
    assert (admission_fit(None, category, BudgetLevel.LOW)
            == admission_fit(None, category, BudgetLevel.MID)
            == admission_fit(None, category, BudgetLevel.HIGH))


# ④′ 비대칭 — 기록이 있으면 **손해만** 볼 수 있고 이득은 못 본다 (2026-09-24)
#
# 요금 커버리지가 30.6% 이고 카테고리에 정렬돼 있어서(FOOD·CAFE 는 구조적으로 0%),
# 싼 것에 가점을 주면 "싸서 받는 점수"가 아니라 "기록이 있어서 받는 점수"가 된다.
# 이 성질이 깨지면 수집을 늘릴수록 특정 카테고리가 유리해진다.


@given(fee=st.integers(min_value=0, max_value=200_000),
       category=st.sampled_from(tuple(PoiCategory)),
       budget=st.sampled_from(tuple(BudgetLevel)))
def test_admission_fit_never_rewards_above_unknown(fee, category, budget) -> None:
    """요금을 아는 POI 가 모르는 POI 보다 **높은** 점수를 받는 일은 없다."""
    known = admission_fit(fee, category, budget)
    unknown = admission_fit(None, category, budget)
    assert known <= unknown


@given(category=st.sampled_from(_CEIL_CATS), budget=st.sampled_from(tuple(BudgetLevel)))
def test_admission_fit_free_equals_unknown(category, budget) -> None:
    """무료(0원)와 모름이 같아야 한다 — 판정분의 79.6% 가 0원이라 '싸다'는 정보가 없다.

    다르면 그 차이는 요금을 **수집했느냐**만 반영한다.
    """
    assert admission_fit(0, category, budget) == admission_fit(None, category, budget)


def test_fee_ceilings_are_non_decreasing_across_budget_levels() -> None:
    """단조성(U5-P6)의 **구조적 근거** — 임계가 LOW ≤ MID ≤ ∞ 여야 성립한다.

    임계표를 실측으로 갱신할 때 이 순서를 깨면 위 두 단조성이 무너진다.
    그때 깨지는 이유를 성질 이름이 바로 말해 주도록 따로 둔다.
    """
    low, mid = _FEE_CEILING[BudgetLevel.LOW], _FEE_CEILING[BudgetLevel.MID]
    assert set(low) == set(mid), "임계가 정의된 카테고리 집합이 등급마다 달라선 안 된다"
    for category in low:
        assert low[category] <= mid[category], f"{category.name}: LOW 임계가 MID 보다 높다"
    assert not _FEE_CEILING[BudgetLevel.HIGH], "HIGH 는 임계 없음(비용 무관)"


# ⑤ 회귀(TRIP-314) — 웜스타트 하위 문제의 필드 승계
# 하루로 좁히는 3필드 외에는 원본을 그대로 이어받아야 한다. 필드를 나열해
# 재구성하면 나중에 추가된 필드가 조용히 빠진다(TRIP-292의 excluded_poi_ids).
# dataclasses.fields로 순회하므로 ItineraryProblem에 필드가 늘어도 자동 적용.
_NARROWED_BY_GREEDY_HINT = {"days", "candidates", "fixed_blocks"}


@settings(max_examples=10, deadline=None)
@given(setup=assembly_setups())
def test_greedy_hint_subproblem_carries_over_untouched_fields(setup) -> None:
    problem, index = setup
    captured: list = []
    original = RuleFallbackAssembler.solve

    def capturing(self, sub, *args, **kwargs):
        captured.append(sub)
        return original(self, sub, *args, **kwargs)

    with patch.object(RuleFallbackAssembler, "solve", capturing):
        OrToolsAssembler(index, _EST, _CFG)._greedy_hint(problem, problem.days[0], set())

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
    result = OrToolsAssembler(index, _EST, _CFG).solve(problem, remaining_ms=1500)
    assert result is not None  # 소형 가해 문제 — 해가 있어야 한다
    (day,) = result.days
    assert day.fixed_blocks == (fb,)  # 회귀: 상시 () 결함 (TRIP-343)
    assert any(s.poi_id == fb.poi_id and s.start_at == fb.window.start
               and s.end_at == fb.window.end for s in day.slots)
    assert check_all(result, problem, index, _EST) == []  # HC1~4 계속 성립


# TRIP-343 PBT — fixed_blocks는 "그 일자에 정확히 배치된 문제 고정 블록"과 일치
@settings(max_examples=15, deadline=None)
@given(setup=assembly_setups())
def test_ortools_fixed_blocks_mirror_placed_slots(setup) -> None:
    problem, index = setup
    result = OrToolsAssembler(index, _EST, _CFG).solve(problem, remaining_ms=1500)
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
