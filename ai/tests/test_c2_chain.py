"""U2 — 시한 인지 하이브리드 체인 (AI-D07, DL-P1·DL-P2).

증명하는 것:
  ① DL-P2: 잔여 < 단계 요구 시간 → 그 단계 미실행 + FallbackEvent(reason=deadline)
  ② DL-P1: 체인 소비 시간 ≤ deadline (FakeClock 시나리오)
  ③ INV-2: 유효하지 않은 해(HC 위반)는 단계가 내놔도 반환되지 않음 → 다음 단계로
  ④ 관측: 성공 시 SolverRunRecord 발행, 강등마다 FallbackEvent (침묵 없음)
  ⑤ 모순 입력에서 SolverConflictError (전 단계 실패)
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

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
