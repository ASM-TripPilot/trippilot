"""고정 예약 POI의 자유 배치 중복 방지 — 2026-08-21 제주 프로브 실측 회귀.

fixed_blocks 로 2일차에 예약된 POI 가 1일차 자유 슬롯으로도 배치돼 같은 곳이
두 번 나왔다(OR-Tools). 규칙 폴백은 더 나쁘다 — 1일차 자유 배치가 선점하면
2일차 고정 배치를 used 방어가 건너뛰어 HC3 가 깨진다.

수정: 각 솔버의 자유 후보 선정에서 (타일) 고정 예약 poi_id 를 제외한다.
고정 배치 자체는 기존 경로(오늘 fixed_ids 후보 유지 / fixed_by_day) 그대로.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from trippilot.solver_engine.config import SolverConfig
from trippilot.solver_engine.constraints import check_all
from trippilot.solver_engine.fallback_solver import RuleFallbackSolver
from trippilot.solver_engine.ortools_solver import OrToolsSolver
from trippilot.solver_engine.travel import TravelEstimator
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
_CFG = SolverConfig(or_tools_limit_ms=1000, or_tools_min_ms=50)
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
    result = OrToolsSolver(index, _EST, _CFG).solve(problem, remaining_ms=2000)
    assert result is not None
    _assert_fixed_placed_once(result, problem, index, fb)


def test_fallback_reserved_fixed_poi_not_free_placed_on_other_day() -> None:
    problem, index, fb = _two_day_problem()
    result = RuleFallbackSolver(index, _EST, _CFG).solve(problem)
    _assert_fixed_placed_once(result, problem, index, fb)
