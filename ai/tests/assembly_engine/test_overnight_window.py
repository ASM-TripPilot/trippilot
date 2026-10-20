"""자정을 넘는 하루 창 — 밤 늦게 만든 오늘을 익일 01:00 까지 연다(2026-10-19 사용자).

밤 10시가 넘으면 23:59 까지 남는 창이 1시간 미만이라 야경 한 곳(60분)도 못 넣었다. 하루 창이 자정을
넘으면 조립·검증이 그날 0시부터의 분(1440 초과)으로 세야 하고, 00:30 방문은 전날 창(야경 16:00~익일
02:00)으로 영업시간을 본다.

증명하는 것:
  ① 경계: 끝이 시작 이하이고 04:00 이하면 다음 날 끝, 그 밖의 거꾸로 된 창은 여전히 거절
  ② HC1: 00:30 방문은 전날 창이 자정을 넘어 이어지면 영업 중, 그 창 밖(02:30)이면 아니다
  ③ OR·폴백 모두 23:00~01:00 창에 야경을 놓고 HC 위반이 0이다(종전엔 창 끝 01:00 이 그날 01:00 으로 읽혀 비었다)
  ④ HC4: 창 끝(01:00)을 넘는 방문은 위반이다
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

import pytest
from pydantic import ValidationError

from trippilot.api.schemas import TimeWindowSchema
from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.constraints import check_all, check_hc4, open_hours_ok
from trippilot.assembly_engine.fallback_assembler import RuleFallbackAssembler
from trippilot.assembly_engine.ortools_assembler import OrToolsAssembler
from trippilot.assembly_engine.travel import TravelEstimator
from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId, ScheduleId, TransportMode
from trippilot.domain.itinerary import ItineraryProblem, TimeWindow
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource

_KST = timezone(timedelta(hours=9))
_DAY = date(2026, 10, 20)                       # 화요일
_CFG = AssemblyConfig(or_tools_min_ms=50)
_EST = TravelEstimator(_CFG)
_ANCHOR = GeoPoint(37.5665, 126.9780)
_NIGHT_HOURS = tuple(OpenHour(day_of_week=d, open_min=16 * 60, close_min=26 * 60) for d in range(7))


def _at(day: date, hh: int, mm: int = 0) -> datetime:
    return datetime(day.year, day.month, day.day, hh, mm, tzinfo=_KST)


_NEXT = _DAY + timedelta(days=1)
_NIGHT = Poi(PoiId("night"), "night", PoiCategory.NIGHT_VIEW, GeoPoint(_ANCHOR.lat + 0.004, _ANCHOR.lng),
             _NIGHT_HOURS, None, None, DataQuality.FULL, PoiSource.SEED, None)


def _problem() -> ItineraryProblem:
    return ItineraryProblem(
        schedule_id=ScheduleId("overnight"), days=(_DAY,),
        candidates=(ScoredPoi(_NIGHT.poi_id, 0.9, True),),
        fixed_blocks=(), budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=TimeWindow(_at(_DAY, 23), _at(_NEXT, 1)),
        day_windows={_DAY: TimeWindow(_at(_DAY, 23), _at(_NEXT, 1))},
        seed=7, anchor=_ANCHOR)


# ① ─────────────────────────────────────────────────────────────────────────

def test_boundary_reads_an_early_morning_end_as_next_day() -> None:
    w = TimeWindowSchema(date=_DAY, start=time(23, 0), end=time(1, 0))
    assert w.overnight
    with pytest.raises(ValidationError):
        TimeWindowSchema(date=_DAY, start=time(10, 0), end=time(9, 0))   # 새벽이 아닌 거꾸로 된 창은 여전히 거절
    assert not TimeWindowSchema(date=_DAY, start=time(9, 0), end=time(21, 0)).overnight


# ② ─────────────────────────────────────────────────────────────────────────

def test_after_midnight_visit_uses_the_previous_days_window() -> None:
    assert open_hours_ok(_NIGHT, _at(_NEXT, 0, 10), _at(_NEXT, 0, 50))       # 전날 16:00~익일 02:00 안
    assert not open_hours_ok(_NIGHT, _at(_NEXT, 2, 30), _at(_NEXT, 3, 0))    # 그 창 밖


# ③ ─────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("engine", ["or", "fallback"])
def test_assemblers_place_a_night_view_in_a_window_past_midnight(engine) -> None:
    problem, index = _problem(), {_NIGHT.poi_id: _NIGHT}
    if engine == "or":
        solution = OrToolsAssembler(index, _EST, _CFG).solve(problem, remaining_ms=10_000)
    else:
        solution = RuleFallbackAssembler(index, _EST, _CFG).solve(problem)

    slots = [s for d in solution.days for s in d.slots]
    assert [str(s.poi_id) for s in slots] == ["night"]
    assert _at(_DAY, 23) <= slots[0].start_at and slots[0].end_at <= _at(_NEXT, 1)
    assert check_all(solution, problem, index, _EST) == []


# ④ ─────────────────────────────────────────────────────────────────────────

def test_a_visit_past_the_overnight_end_breaks_the_day_window() -> None:
    from dataclasses import replace

    problem, index = _problem(), {_NIGHT.poi_id: _NIGHT}
    base = RuleFallbackAssembler(index, _EST, _CFG).solve(problem)
    placed = base.days[0].slots[0]
    for start, broken in ((_at(_NEXT, 0, 30), True), (_at(_NEXT, 0, 0), False)):
        slot = replace(placed, start_at=start, end_at=start + timedelta(minutes=60))
        sol = replace(base, days=(replace(base.days[0], slots=(slot,)),))
        assert bool(check_hc4(sol, problem)) is broken, start
