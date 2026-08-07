"""U2 — 시한 인지 하이브리드 체인 (AI-D07, DL-P1·DL-P2).

증명하는 것:
  ① DL-P2: 잔여 < 단계 요구 시간 → 그 단계 미실행 + FallbackEvent(reason=deadline)
  ② DL-P1: 체인 소비 시간 ≤ deadline (FakeClock 시나리오)
  ③ INV-2: 유효하지 않은 해(HC 위반)는 단계가 내놔도 반환되지 않음 → 다음 단계로
  ④ 관측: 성공 시 SolverRunRecord 발행, 강등마다 FallbackEvent (침묵 없음)
  ⑤ 모순 입력에서 SolverConflictError (전 단계 실패)
  ⑥ TRIP-261: solve()의 모든 반환 경로(폴백 강등 포함)에 QualityScore 부착
     — 성분 [0,1] + 결정론(같은 입력 2회 → 같은 score)
  ⑦ TRIP-291: 시한이 완전히 소진(잔여 ≤ 0)돼도 required_ms=0 최후 보루는 실행되어
     solve()가 SolverConflictError 없이 결정론 폴백을 반환(INV-4) — 임의 deadline PBT 포함
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.c2.config import SolverConfig
from trippilot.c2.facade import HybridSolverFacade, SolverConflictError
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
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.observability import FallbackEvent, SolverRunRecord
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource

from tests.fakes.fake_clock import FakeClock
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.generators.solver import solver_setups

_KST = timezone(timedelta(hours=9))
_CFG = SolverConfig()
_EST = TravelEstimator(_CFG)


def _setup():
    d = date(2026, 8, 5)
    poi = Poi(PoiId("a"), "A", PoiCategory.SIGHT, GeoPoint(37.75, 128.87),
              (), None, None, DataQuality.FULL, PoiSource.SEED, None)
    problem = ItineraryProblem(
        schedule_id=ScheduleId("s"), days=(d,),
        candidates=(ScoredPoi(poi.poi_id, 0.9, False),),
        fixed_blocks=(), budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=TimeWindow(datetime(2026, 8, 5, 9, 0, tzinfo=_KST),
                              datetime(2026, 8, 5, 21, 0, tzinfo=_KST)),
        seed=7)
    return problem, {poi.poi_id: poi}


class SlowNoSolutionStage:
    """시간을 소모하고 해 없음 — OR-Tools 타임아웃 흉내."""

    name = "slow_stage"

    def __init__(self, clock: FakeClock, consume_ms: int, required_ms: int = 500):
        self._clock, self._consume = clock, consume_ms
        self.required_ms = required_ms
        self.calls = 0

    def solve(self, problem, remaining_ms):
        self.calls += 1
        self._clock.advance(self._consume)
        return None


class ExpensiveStage:
    """요구 시간이 큰 단계 — 잔여 부족 시 스킵 대상 (LLM 2차 흉내)."""

    name = "llm_stage"
    required_ms = 2500

    def __init__(self):
        self.calls = 0

    def solve(self, problem, remaining_ms):
        self.calls += 1
        return None


class InvalidResultStage:
    """HC 위반 해를 내놓는 단계 — INV-2 반환 차단 검증용."""

    name = "invalid_stage"
    required_ms = 0

    def solve(self, problem, remaining_ms):
        bad_slot = VisitSlot(PoiId("a"),
                             datetime(2026, 8, 5, 7, 0, tzinfo=_KST),   # day window 밖
                             datetime(2026, 8, 5, 8, 0, tzinfo=_KST),
                             stay_min=60, score=0.9, is_llm_score=False)
        return ItinerarySolution(
            schedule_id=ScheduleId("s"),
            days=(DaySolution(date(2026, 8, 5), (bad_slot,), ()),),
            is_fallback=False, solve_mode=SolveMode.OR_TOOLS, solver_run=None)


def test_dl2_stage_skipped_when_budget_short_and_dl1_deadline_kept() -> None:
    problem, index = _setup()
    clock, trace = FakeClock(), InMemoryTrace()
    slow = SlowNoSolutionStage(clock, consume_ms=4600)   # 4.6초 소모 후 해 없음
    llm = ExpensiveStage()                               # 요구 2.5초 — 잔여 0.4초라 스킵돼야
    chain = [slow, llm, RuleFallbackSolver(index, _EST, _CFG)]
    facade = HybridSolverFacade(chain, index, _EST, clock, trace)

    t0 = clock.monotonic_ms()
    result = facade.solve(problem, deadline_ms=5000)

    assert llm.calls == 0                                 # DL-P2: 미실행
    reasons = [e.reason for e in trace.of_type(FallbackEvent)]
    assert "deadline" in reasons                          # 스킵이 관측됨
    assert clock.monotonic_ms() - t0 <= 5000              # DL-P1: 예산 내 반환
    assert result.solve_mode == SolveMode.RULE_FALLBACK   # 규칙 폴백으로 강등


def test_invalid_stage_result_is_rejected_inv2() -> None:
    problem, index = _setup()
    clock, trace = FakeClock(), InMemoryTrace()
    chain = [InvalidResultStage(), RuleFallbackSolver(index, _EST, _CFG)]
    facade = HybridSolverFacade(chain, index, _EST, clock, trace)

    result = facade.solve(problem, deadline_ms=5000)

    assert result.solve_mode == SolveMode.RULE_FALLBACK   # 위반 해는 반환 안 됨
    assert facade.validate(result, problem) == []
    assert any(e.reason.startswith("invalid") for e in trace.of_type(FallbackEvent))


def test_success_emits_solver_run_record() -> None:
    problem, index = _setup()
    clock, trace = FakeClock(), InMemoryTrace()
    facade = HybridSolverFacade(
        [RuleFallbackSolver(index, _EST, _CFG)], index, _EST, clock, trace)

    result = facade.solve(problem, deadline_ms=5000)

    records = trace.of_type(SolverRunRecord)
    assert len(records) == 1
    assert records[0].solve_mode == result.solve_mode     # 출처 보존
    assert records[0].violations_found == 0


def test_empty_chain_raises_conflict() -> None:
    problem, index = _setup()
    facade = HybridSolverFacade([], index, _EST, FakeClock(), InMemoryTrace())
    try:
        facade.solve(problem, deadline_ms=5000)
        assert False, "SolverConflictError가 나야 함"
    except SolverConflictError:
        pass


# ── ⑥ TRIP-261: QualityScore 배선 ──

def test_solve_attaches_quality_score_with_unit_range_components() -> None:
    problem, index = _setup()
    facade = HybridSolverFacade(
        [RuleFallbackSolver(index, _EST, _CFG)], index, _EST,
        FakeClock(), InMemoryTrace())

    result = facade.solve(problem, deadline_ms=5000)

    assert result.score is not None
    for v in (result.score.preference_fit, result.score.constraint_satisfaction,
              result.score.route_efficiency, result.score.composite):
        assert 0.0 <= v <= 1.0


def test_solve_quality_score_is_deterministic() -> None:
    problem, index = _setup()

    def run() -> ItinerarySolution:
        facade = HybridSolverFacade(
            [RuleFallbackSolver(index, _EST, _CFG)], index, _EST,
            FakeClock(), InMemoryTrace())
        return facade.solve(problem, deadline_ms=5000)

    assert run().score == run().score            # 같은 입력 2회 → 같은 score


def test_degraded_fallback_path_also_gets_quality_score() -> None:
    """강등 끝의 RULE_FALLBACK 해에도 score 부착 (INV-4: 폴백도 동급 산출물)."""
    problem, index = _setup()
    chain = [InvalidResultStage(), RuleFallbackSolver(index, _EST, _CFG)]
    facade = HybridSolverFacade(chain, index, _EST, FakeClock(), InMemoryTrace())

    result = facade.solve(problem, deadline_ms=5000)

    assert result.solve_mode == SolveMode.RULE_FALLBACK
    assert result.score is not None
    assert result.score.constraint_satisfaction == 1.0  # 반환 해는 HC 위반 0건


# ── ⑦ TRIP-291: 시한 소진 상태에서도 최후 보루 실행 (INV-4) ──

def test_last_resort_runs_even_when_deadline_fully_exhausted() -> None:
    """잔여가 음수여도 required_ms=0 단계는 실행 — 예외 대신 결정론 폴백."""
    problem, index = _setup()
    clock, trace = FakeClock(), InMemoryTrace()
    slow = SlowNoSolutionStage(clock, consume_ms=8000)   # 5초 예산을 3초 초과 소모
    llm = ExpensiveStage()                               # 요구 2.5초 — 잔여 음수라 스킵
    chain = [slow, llm, RuleFallbackSolver(index, _EST, _CFG)]
    facade = HybridSolverFacade(chain, index, _EST, clock, trace)

    result = facade.solve(problem, deadline_ms=5000)     # SolverConflictError 금지

    assert result.is_fallback is True
    assert result.solve_mode in {SolveMode.RULE_FALLBACK, SolveMode.MINIMAL}
    assert result.score is not None
    assert llm.calls == 0                                # 상위 단계는 여전히 스킵(DL-2 유지)
    reasons = [e.reason for e in trace.of_type(FallbackEvent)]
    assert "deadline" in reasons                         # 상위 단계 스킵 흔적
    assert "deadline_exhausted:last_resort" in reasons   # 초과 실행 흔적 (침묵 금지)


def test_negative_deadline_still_returns_deterministic_fallback() -> None:
    """호출자가 이미 시한을 다 쓴 상태(음수 deadline)로 들어와도 해를 낸다."""
    problem, index = _setup()
    trace = InMemoryTrace()
    facade = HybridSolverFacade(
        [RuleFallbackSolver(index, _EST, _CFG)], index, _EST, FakeClock(), trace)

    result = facade.solve(problem, deadline_ms=-1)

    assert result.is_fallback is True
    assert result.solve_mode in {SolveMode.RULE_FALLBACK, SolveMode.MINIMAL}
    assert facade.validate(result, problem) == []        # 폴백도 유효 해 (INV-2)
    assert any(e.reason == "deadline_exhausted:last_resort"
               for e in trace.of_type(FallbackEvent))


@settings(max_examples=60, deadline=None)
@given(setup=solver_setups(),
       budget_ms=st.integers(min_value=-10_000, max_value=10_000),
       consume_ms=st.integers(min_value=0, max_value=20_000))
def test_pbt_solve_never_raises_conflict_for_any_deadline(
        setup, budget_ms: int, consume_ms: int) -> None:
    """DL-P3(신규): 임의 (문제, deadline, 소모시간)에서 solve()는 빈손으로 끝나지 않는다.

    체인에 RuleFallback이 있으면 시한이 아무리 부족해도 SolverConflictError는 없다 —
    예외는 '입력 모순'만의 신호로 남는다 (INV-4).
    """
    problem, index = setup
    clock, trace = FakeClock(), InMemoryTrace()
    chain = [SlowNoSolutionStage(clock, consume_ms=consume_ms),
             ExpensiveStage(),
             RuleFallbackSolver(index, _EST, _CFG)]
    facade = HybridSolverFacade(chain, index, _EST, clock, trace)

    result = facade.solve(problem, deadline_ms=budget_ms)   # 예외 발생 = 실패

    assert result.is_fallback is True
    assert result.solve_mode in {SolveMode.RULE_FALLBACK, SolveMode.MINIMAL}
    assert result.score is not None
    assert facade.validate(result, problem) == []


def test_contradictory_fixed_blocks_still_raise_conflict() -> None:
    """시한이 넉넉해도 모순 입력(겹치는 고정 블록)은 여전히 SolverConflictError (d08 보존)."""
    a = Poi(PoiId("a"), "A", PoiCategory.SIGHT, GeoPoint(37.75, 128.87),
            (), None, None, DataQuality.FULL, PoiSource.SEED, None)
    b = Poi(PoiId("b"), "B", PoiCategory.SIGHT, GeoPoint(37.20, 127.10),  # 멀리
            (), None, None, DataQuality.FULL, PoiSource.SEED, None)
    index = {a.poi_id: a, b.poi_id: b}
    d = date(2026, 8, 5)
    overlapping = (
        FixedBlock(poi_id=a.poi_id,
                   window=TimeWindow(datetime(2026, 8, 5, 10, 0, tzinfo=_KST),
                                     datetime(2026, 8, 5, 11, 0, tzinfo=_KST)),
                   reason="user_fixed"),
        FixedBlock(poi_id=b.poi_id,
                   window=TimeWindow(datetime(2026, 8, 5, 10, 30, tzinfo=_KST),
                                     datetime(2026, 8, 5, 11, 30, tzinfo=_KST)),
                   reason="user_fixed"),
    )
    problem = ItineraryProblem(
        schedule_id=ScheduleId("s"), days=(d,),
        candidates=(ScoredPoi(a.poi_id, 0.9, False), ScoredPoi(b.poi_id, 0.8, False)),
        fixed_blocks=overlapping, budget=BudgetLevel.MID,
        transport=TransportMode.PUBLIC,
        day_window=TimeWindow(datetime(2026, 8, 5, 9, 0, tzinfo=_KST),
                              datetime(2026, 8, 5, 21, 0, tzinfo=_KST)),
        seed=7)
    facade = HybridSolverFacade(
        [RuleFallbackSolver(index, _EST, _CFG)], index, _EST,
        FakeClock(), InMemoryTrace())

    try:
        facade.solve(problem, deadline_ms=60_000)         # 시한은 충분
        assert False, "모순 입력에는 SolverConflictError가 나야 함"
    except SolverConflictError:
        pass
