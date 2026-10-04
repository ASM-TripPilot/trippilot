"""FOOD→FOOD 인접 억제 — 식당 바로 다음 식당 (food_adjacent_penalty).

실측(QA 6회차 후속, 로컬 full 스택 10일): 태안 2일차 점심 12:26 식당 → 13:31 식당. 두 번째
식당은 끝이 점심창을 넘어 창 안 상쇄 대상이 아니고, 남는 비용이 인접 억제 0.2 뿐이라 점수
차가 크면 그대로 놓였다. 폴백은 이미 연속 FOOD 를 후순위로 미룬다 — OR 을 그 의미에 맞춘다.
하드 제약 아님(목적함수만) — HC1~4 해 집합 불변, 식당만 있는 풀도 비지 않는다.
실 API 호출 0 — 어셈블리·거리 추정 전부 로컬 결정론.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.constraints import check_all
from trippilot.assembly_engine.ortools_assembler import OrToolsAssembler
from trippilot.assembly_engine.travel import TravelEstimator
from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId, ScheduleId, TransportMode
from trippilot.domain.itinerary import ItineraryProblem, TimeWindow
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource

_KST = timezone(timedelta(hours=9))
_CFG = AssemblyConfig(or_tools_limit_ms=2000, or_tools_min_ms=50)
_EST = TravelEstimator(_CFG)
_F, _S = PoiCategory.FOOD, PoiCategory.SIGHT
_PAIR_AND_SIGHT = [("f0", _F, .9, None), ("f1", _F, .9, None), ("s0", _S, .3, None)]


def _solve(specs, *, start_h=9, end_h=21):
    """specs = [(id, 카테고리, 점수, 이름|None)] — 전부 같은 좌표(순서 자유)."""
    pois = [Poi(PoiId(pid), name or pid, cat, GeoPoint(37.751, 128.876), (),
                None, None, DataQuality.FULL, PoiSource.SEED, None)
            for pid, cat, _, name in specs]
    index = {p.poi_id: p for p in pois}
    problem = ItineraryProblem(
        schedule_id=ScheduleId("s-food-adj"), days=(date(2026, 8, 5),),
        candidates=tuple(ScoredPoi(PoiId(pid), sc, False) for pid, _, sc, _ in specs),
        fixed_blocks=(), budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=TimeWindow(datetime(2026, 8, 5, start_h, 0, tzinfo=_KST),
                              datetime(2026, 8, 5, end_h, 0, tzinfo=_KST)),
        seed=7)
    result = OrToolsAssembler(index, _EST, _CFG).solve(problem, 3000)
    assert result is not None
    assert check_all(result, problem, index, _EST) == []
    return [index[s.poi_id].category for d in result.days for s in d.slots]


def _adjacent_food_pairs(cats) -> int:
    return sum(a is _F and b is _F for a, b in zip(cats, cats[1:]))


def test_two_slot_day_prefers_sight_over_second_adjacent_food() -> None:
    """두 곳만 들어가는 날(11:00~14:00): 종전엔 FOOD 0.9 두 곳이 SIGHT 0.3 을 이겼다."""
    cats = _solve(_PAIR_AND_SIGHT, start_h=11, end_h=14)
    assert _adjacent_food_pairs(cats) == 0
    assert cats.count(_S) == 1


def test_long_day_keeps_both_food_with_something_between() -> None:
    cats = _solve(_PAIR_AND_SIGHT)
    assert cats.count(_F) == 2 and _adjacent_food_pairs(cats) == 0


def test_food_only_pool_still_places_food() -> None:
    """감점일 뿐 배제가 아니다 — 식당만 남아도 일정은 비지 않는다."""
    cats = _solve([(f"f{i}", _F, .9 - .05 * i, None) for i in range(7)])
    assert cats and set(cats) == {_F}


def test_config_rejects_negative_food_adjacent_penalty() -> None:
    with pytest.raises(ValueError):
        AssemblyConfig(food_adjacent_penalty=-0.1)
