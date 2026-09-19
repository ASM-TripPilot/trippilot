"""고정 예약 POI의 자유 배치 중복 방지 — 2026-08-21 제주 프로브 실측 회귀.

fixed_blocks 로 2일차에 예약된 POI 가 1일차 자유 슬롯으로도 배치돼 같은 곳이
두 번 나왔다(OR-Tools). 규칙 폴백은 더 나쁘다 — 1일차 자유 배치가 선점하면
2일차 고정 배치를 used 방어가 건너뛰어 HC3 가 깨진다.

수정: 각 어셈블리의 자유 후보 선정에서 (타일) 고정 예약 poi_id 를 제외한다.
고정 배치 자체는 기존 경로(오늘 fixed_ids 후보 유지 / fixed_by_day) 그대로.
"""

from __future__ import annotations

import pytest

from datetime import date, datetime, timedelta, timezone

from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.constraints import check_all
from trippilot.assembly_engine.fallback_assembler import RuleFallbackAssembler
from trippilot.assembly_engine.ortools_assembler import OrToolsAssembler
from trippilot.assembly_engine.travel import TravelEstimator
from trippilot.domain.common import (
    BudgetLevel,
    GeoPoint,
    PoiId,
    ScheduleId,
    TransportMode,
)
from trippilot.domain.itinerary import FixedBlock, ItineraryProblem, TimeWindow
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource

_KST = timezone(timedelta(hours=9))
_CFG = AssemblyConfig(or_tools_limit_ms=1000, or_tools_min_ms=50)
_EST = TravelEstimator(_CFG)


def _two_day_problem():
    """이틀 문제 — 후보 4곳, 그중 fx0 은 2일차 10시 고정 예약.

    fx0 점수를 최고로 둬서 '자유 경로가 가장 탐내는 POI' 로 만든다 —
    수정 전에는 1일차 자유 슬롯에 fx0 이 먼저 배치됐다.
    """
    d1, d2 = date(2026, 9, 1), date(2026, 9, 2)
    pois = [
        Poi(PoiId(f"fx{i}"), f"fx{i}", PoiCategory.SIGHT,
            GeoPoint(33.510 + 0.004 * i, 126.522), (),
            None, None, DataQuality.FULL, PoiSource.SEED, None)
        for i in range(4)
    ]
    index = {p.poi_id: p for p in pois}
    candidates = tuple(
        ScoredPoi(poi_id=p.poi_id, score=0.9 if i == 0 else 0.4, is_llm_score=False)
        for i, p in enumerate(pois)
    )
    fb = FixedBlock(
        poi_id=pois[0].poi_id,
        window=TimeWindow(datetime(2026, 9, 2, 10, 0, tzinfo=_KST),
                          datetime(2026, 9, 2, 11, 0, tzinfo=_KST)),
        reason="user_fixed",
    )
    problem = ItineraryProblem(
        schedule_id=ScheduleId("s-fixed-reserved"), days=(d1, d2),
        candidates=candidates, fixed_blocks=(fb,),
        budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=TimeWindow(datetime(2026, 9, 1, 9, 0, tzinfo=_KST),
                              datetime(2026, 9, 1, 21, 0, tzinfo=_KST)),
        seed=7,
    )
    return problem, index, fb


def _assert_fixed_placed_once(result, problem, index, fb) -> None:
    placements = [
        (day.date, s) for day in result.days for s in day.slots
        if s.poi_id == fb.poi_id
    ]
    # 정확히 1회 — 예약된 날의 예약된 시각에만
    assert len(placements) == 1, f"고정 POI 가 {len(placements)}회 배치됨: {placements}"
    day_placed, slot = placements[0]
    assert day_placed == fb.window.start.date()
    assert slot.start_at == fb.window.start and slot.end_at == fb.window.end
    assert check_all(result, problem, index, _EST) == []


def test_ortools_reserved_fixed_poi_not_free_placed_on_other_day() -> None:
    problem, index, fb = _two_day_problem()
    result = OrToolsAssembler(index, _EST, _CFG).solve(problem, remaining_ms=2000)
    assert result is not None
    _assert_fixed_placed_once(result, problem, index, fb)


def test_fallback_reserved_fixed_poi_not_free_placed_on_other_day() -> None:
    problem, index, fb = _two_day_problem()
    result = RuleFallbackAssembler(index, _EST, _CFG).solve(problem)
    _assert_fixed_placed_once(result, problem, index, fb)


# ── 고정 블록이 후보이기도 할 때의 시간창 (저녁 예약 회귀) ───────────────────

def _evening_fixed_problem(pin_hour: int):
    """하루 창 09~21시 · 후보 4곳 · 그중 fx0 을 `pin_hour` 에 고정.

    fx0 은 **후보이면서 동시에 고정 블록**이다 — 노드가 후보 경로에서 먼저 만들어지고
    고정 경로가 그것을 갱신한다. 그 갱신이 시각만 덮고 창을 안 덮으면, 후보 기준으로
    계산된 `hi`(= 닫힘 − 기본체류)가 남아 늦은 시각 고정이 정의역 밖으로 밀려난다.
    """
    pois = [
        Poi(PoiId(f"ev{i}"), f"ev{i}", PoiCategory.SIGHT,
            GeoPoint(33.510 + 0.004 * i, 126.522), (),
            None, None, DataQuality.FULL, PoiSource.SEED, None)
        for i in range(4)
    ]
    index = {p.poi_id: p for p in pois}
    candidates = tuple(
        ScoredPoi(poi_id=p.poi_id, score=0.9 if i == 0 else 0.4, is_llm_score=False)
        for i, p in enumerate(pois)
    )
    fb = FixedBlock(
        poi_id=pois[0].poi_id,
        window=TimeWindow(datetime(2026, 9, 1, pin_hour, 0, tzinfo=_KST),
                          datetime(2026, 9, 1, pin_hour + 1, 0, tzinfo=_KST)),
        reason="user_fixed",
    )
    problem = ItineraryProblem(
        schedule_id=ScheduleId("s-evening-fixed"), days=(date(2026, 9, 1),),
        candidates=candidates, fixed_blocks=(fb,),
        budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=TimeWindow(datetime(2026, 9, 1, 9, 0, tzinfo=_KST),
                              datetime(2026, 9, 1, 21, 0, tzinfo=_KST)),
        seed=7,
    )
    return problem, index, fb


@pytest.mark.parametrize("pin_hour", [10, 14, 18, 19, 20])
def test_late_fixed_block_that_is_also_a_candidate_still_solves(pin_hour: int) -> None:
    """저녁 예약 하나가 일정 **전체**를 폴백으로 떨어뜨리지 않는다.

    회귀 전: 하루 끝(21시) − SIGHT 기본체류(75분) = 19:45 를 넘는 고정(20:00)에서
    CP-SAT 이 INFEASIBLE → `_solve_day` None → `solve` 전체가 None. 에러가 아니라
    조용한 강등이라 아무도 못 알아챈다 — 사용자에게는 '왜 이렇게 대충 짜였지'로만 보인다.
    """
    problem, index, fb = _evening_fixed_problem(pin_hour)
    result = OrToolsAssembler(index, _EST, _CFG).solve(problem, remaining_ms=2000)

    assert result is not None, f"{pin_hour}시 고정에서 OR 단계가 해를 못 냈다 — 전체 강등"
    placed = [s for day in result.days for s in day.slots if s.poi_id == fb.poi_id]
    assert len(placed) == 1
    assert placed[0].start_at == fb.window.start, "고정 시각이 지켜지지 않았다(HC3)"
