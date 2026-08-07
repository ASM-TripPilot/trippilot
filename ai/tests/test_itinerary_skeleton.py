"""U1 — itinerary + 솔버 계약 절편 PBT (INV-2).

증명하는 것:
  ① 직렬화 왕복 (U5-P10): TimeWindow·VisitSlot·DaySolution·ItineraryProblem·
                          ItinerarySolution·Violation 모두 왕복 동일
  ② 시각 정합         : TimeWindow/VisitSlot start<end, DaySolution 슬롯 시간순 강제
  ③ INV-2 출처 정합    : is_fallback=True인데 폴백 모드가 아니면 생성 거부
  ④ SolverPort 체인    : None(해 없음) → 다음 전략 → 성공 해의 solve_mode(출처) 보존
"""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest
from hypothesis import given

from trippilot.domain.common import BudgetLevel, PoiId, ScheduleId, TransportMode
from trippilot.domain.itinerary import (
    DaySolution,
    FixedBlock,
    ItineraryProblem,
    ItinerarySolution,
    SolveMode,
    TimeWindow,
    Violation,
    VisitSlot,
)

from tests.fakes.fake_solver import FixedSolver, NoSolutionSolver
from tests.generators.itinerary import (
    day_solutions,
    fixed_blocks,
    itinerary_problems,
    itinerary_solutions,
    time_windows,
    violations,
    visit_slots,
)

_KST = timezone.utc


# ① 직렬화 왕복
@given(tw=time_windows())
def test_time_window_roundtrip(tw: TimeWindow) -> None:
    assert TimeWindow.from_dict(tw.to_dict()) == tw


@given(ds=day_solutions())
def test_day_solution_roundtrip(ds: DaySolution) -> None:
    assert DaySolution.from_dict(ds.to_dict()) == ds


@given(prob=itinerary_problems())
def test_itinerary_problem_roundtrip(prob: ItineraryProblem) -> None:
    assert ItineraryProblem.from_dict(prob.to_dict()) == prob


@given(sol=itinerary_solutions())
def test_itinerary_solution_roundtrip(sol: ItinerarySolution) -> None:
    assert ItinerarySolution.from_dict(sol.to_dict()) == sol


@given(v=violations())
def test_violation_roundtrip(v: Violation) -> None:
    assert Violation.from_dict(v.to_dict()) == v


# 보강: 부모 통해서만 검증되던 타입 단독 왕복
@given(vs=visit_slots())
def test_visit_slot_roundtrip(vs: VisitSlot) -> None:
    assert VisitSlot.from_dict(vs.to_dict()) == vs


@given(fb=fixed_blocks())
def test_fixed_block_roundtrip(fb: FixedBlock) -> None:
    assert FixedBlock.from_dict(fb.to_dict()) == fb


# ② 시각 정합 — 잘못된 시각 관계는 생성 불가
def test_time_window_rejects_reversed() -> None:
    t0 = datetime(2026, 7, 21, 10, 0, tzinfo=_KST)
    t1 = datetime(2026, 7, 21, 9, 0, tzinfo=_KST)
    with pytest.raises(ValueError):
        TimeWindow(start=t0, end=t1)


def test_time_window_rejects_naive() -> None:
    with pytest.raises(ValueError):
        TimeWindow(start=datetime(2026, 7, 21, 9), end=datetime(2026, 7, 21, 10))


def test_day_solution_rejects_unsorted_slots() -> None:
    def _slot(hour: int) -> VisitSlot:
        return VisitSlot(
            poi_id=PoiId(f"p{hour}"),
            start_at=datetime(2026, 7, 21, hour, 0, tzinfo=_KST),
            end_at=datetime(2026, 7, 21, hour, 30, tzinfo=_KST),
            stay_min=30,
            score=0.5,
            is_llm_score=False,
        )

    with pytest.raises(ValueError):
        # 11시 슬롯이 9시보다 앞에 옴 → 시간순 위반
        DaySolution(date=date(2026, 7, 21), slots=(_slot(11), _slot(9)), fixed_blocks=())


# ③ INV-2 출처 정합 — 폴백인데 폴백 모드가 아니면 거부
def test_solution_rejects_dishonest_fallback() -> None:
    with pytest.raises(ValueError):
        ItinerarySolution(
            schedule_id=ScheduleId("s1"),
            days=(),
            is_fallback=True,
            solve_mode=SolveMode.OR_TOOLS,  # 폴백인데 정상 모드 → 거짓말
            solver_run=None,
        )


# ④ SolverPort 체인 — None이면 다음 전략, 성공 해의 출처(solve_mode) 보존
def _solve_chain(strategies, problem):
    """U2 HybridSolverFacade 축소 대역: 첫 non-None 해 반환."""
    for s in strategies:
        result = s.solve(problem)
        if result is not None:
            return result
    return None


@given(sol=itinerary_solutions())
def test_solver_chain_skips_none_and_keeps_provenance(sol: ItinerarySolution) -> None:
    problem = _dummy_problem()
    chain = [NoSolutionSolver(), NoSolutionSolver(), FixedSolver(sol)]

    result = _solve_chain(chain, problem)

    assert result is sol  # 앞 전략이 None이라 세 번째로 넘어감
    assert result.solve_mode == sol.solve_mode  # 출처 보존 (INV-2)


def _dummy_problem() -> ItineraryProblem:
    return ItineraryProblem(
        schedule_id=ScheduleId("s1"),
        days=(date(2026, 7, 21),),
        candidates=(),
        fixed_blocks=(),
        budget=BudgetLevel.MID,
        transport=TransportMode.PUBLIC,
        day_window=TimeWindow(
            start=datetime(2026, 7, 21, 9, 0, tzinfo=_KST),
            end=datetime(2026, 7, 21, 21, 0, tzinfo=_KST),
        ),
        seed=42,
    )
