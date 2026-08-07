"""itinerary generator (business-logic-model.md §4).

day_solutions는 시각 오름차순 슬롯을 생성(불변식 만족 보장).
itinerary_solutions는 is_fallback↔solve_mode 정합을 만족하게 생성.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from hypothesis import strategies as st

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
from trippilot.domain.llm import ScoredPoi

from tests.generators.geo import geo_points
from tests.generators.observability import solver_run_records

_KST = timezone(timedelta(hours=9))
_MIN_DATE = date(2026, 1, 1)
_MAX_DATE = date(2026, 12, 31)


def _dates() -> st.SearchStrategy[date]:
    return st.dates(min_value=_MIN_DATE, max_value=_MAX_DATE)


def _aware() -> st.SearchStrategy[datetime]:
    return st.datetimes(
        min_value=datetime(2026, 1, 1),
        max_value=datetime(2027, 1, 1),
        timezones=st.just(_KST),
    )


def _scored_pois() -> st.SearchStrategy[ScoredPoi]:
    return st.builds(
        ScoredPoi,
        poi_id=st.builds(PoiId, st.text(min_size=1, max_size=8)),
        score=st.floats(0, 1, allow_nan=False, allow_infinity=False),
        is_llm_score=st.booleans(),
    )


@st.composite
def time_windows(draw) -> TimeWindow:
    start = draw(_aware())
    span = draw(st.integers(min_value=1, max_value=720))
    return TimeWindow(start=start, end=start + timedelta(minutes=span))


@st.composite
def visit_slots(draw) -> VisitSlot:
    start = draw(_aware())
    dur = draw(st.integers(min_value=1, max_value=300))
    return VisitSlot(
        poi_id=PoiId(draw(st.text(min_size=1, max_size=8))),
        start_at=start,
        end_at=start + timedelta(minutes=dur),
        stay_min=draw(st.integers(min_value=0, max_value=300)),
        score=draw(st.floats(0, 1, allow_nan=False, allow_infinity=False)),
        is_llm_score=draw(st.booleans()),
    )


@st.composite
def fixed_blocks(draw) -> FixedBlock:
    return FixedBlock(
        poi_id=PoiId(draw(st.text(min_size=1, max_size=8))),
        window=draw(time_windows()),
        reason=draw(st.text(max_size=20)),
    )


@st.composite
def violations(draw) -> Violation:
    return Violation(
        code=draw(st.sampled_from(["HC1", "HC2", "HC3", "HC4"])),
        slot_ref=draw(
            st.one_of(st.none(), st.builds(PoiId, st.text(min_size=1, max_size=8)))
        ),
        detail=draw(st.text(max_size=30)),
    )


@st.composite
def day_solutions(draw) -> DaySolution:
    d = draw(_dates())
    n = draw(st.integers(min_value=0, max_value=4))
    cursor = datetime(d.year, d.month, d.day, 9, 0, tzinfo=_KST)
    slots = []
    for i in range(n):
        gap = draw(st.integers(min_value=0, max_value=120))
        dur = draw(st.integers(min_value=30, max_value=120))
        start = cursor + timedelta(minutes=gap)
        end = start + timedelta(minutes=dur)
        slots.append(
            VisitSlot(
                poi_id=PoiId(f"p{i}"),
                start_at=start,
                end_at=end,
                stay_min=dur,
                score=draw(st.floats(0, 1, allow_nan=False, allow_infinity=False)),
                is_llm_score=draw(st.booleans()),
            )
        )
        cursor = end
    return DaySolution(date=d, slots=tuple(slots), fixed_blocks=())


@st.composite
def itinerary_problems(draw) -> ItineraryProblem:
    n_days = draw(st.integers(min_value=1, max_value=3))
    d0 = draw(_dates())
    days = tuple(d0 + timedelta(days=i) for i in range(n_days))
    return ItineraryProblem(
        schedule_id=ScheduleId(draw(st.text(min_size=1, max_size=10))),
        days=days,
        candidates=tuple(draw(st.lists(_scored_pois(), max_size=5))),
        fixed_blocks=tuple(draw(st.lists(fixed_blocks(), max_size=2))),
        budget=draw(st.sampled_from(list(BudgetLevel))),
        transport=draw(st.sampled_from(list(TransportMode))),
        day_window=draw(time_windows()),
        seed=draw(st.integers(min_value=0, max_value=2**31)),
        anchor=draw(st.one_of(st.none(), geo_points())),
    )


@st.composite
def itinerary_solutions(draw) -> ItinerarySolution:
    is_fallback = draw(st.booleans())
    if is_fallback:
        mode = draw(st.sampled_from([SolveMode.RULE_FALLBACK, SolveMode.MINIMAL]))
    else:
        mode = draw(st.sampled_from([SolveMode.OR_TOOLS, SolveMode.LLM]))
    return ItinerarySolution(
        schedule_id=ScheduleId(draw(st.text(min_size=1, max_size=10))),
        days=tuple(draw(st.lists(day_solutions(), max_size=3))),
        is_fallback=is_fallback,
        solve_mode=mode,
        solver_run=draw(st.one_of(st.none(), solver_run_records())),
    )
