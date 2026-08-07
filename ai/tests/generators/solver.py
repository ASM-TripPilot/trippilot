"""U2 솔버용 generator — (problem, poi_index) 정합 세트 (U2 FD §3).

가해성(solvable) 보장 방침:
- POI 영업정보 없음(open_hours=()) → HC1 미적용, 좌표는 앵커 ±0.03도
- 고정 블록 0~1개: day[0]의 window 초반, 후보 풀 안 POI, 60분
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from hypothesis import strategies as st

from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId, ScheduleId, TransportMode
from trippilot.domain.itinerary import FixedBlock, ItineraryProblem, TimeWindow
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource

_KST = timezone(timedelta(hours=9))
_ANCHOR = GeoPoint(37.751, 128.876)


def _poi(i: int, lat_off: float, lng_off: float, category: PoiCategory) -> Poi:
    return Poi(
        poi_id=PoiId(f"sp{i}"),
        name=f"poi{i}",
        category=category,
        coord=GeoPoint(_ANCHOR.lat + lat_off, _ANCHOR.lng + lng_off),
        open_hours=(),  # 정보 없음 → HC1 미적용 (가해성 보장)
        avg_cost=None,
        rating=None,
        quality=DataQuality.FULL,
        source=PoiSource.SEED,
        confidence=None,
    )


@st.composite
def solver_setups(draw) -> tuple[ItineraryProblem, dict[PoiId, Poi]]:
    n = draw(st.integers(min_value=1, max_value=8))
    pois = [
        _poi(
            i,
            draw(st.floats(-0.03, 0.03, allow_nan=False, allow_infinity=False)),
            draw(st.floats(-0.03, 0.03, allow_nan=False, allow_infinity=False)),
            draw(st.sampled_from(list(PoiCategory))),
        )
        for i in range(n)
    ]
    index = {p.poi_id: p for p in pois}
    candidates = tuple(
        ScoredPoi(
            poi_id=p.poi_id,
            score=draw(st.floats(0, 1, allow_nan=False, allow_infinity=False)),
            is_llm_score=draw(st.booleans()),
        )
        for p in pois
    )
    d0 = draw(st.dates(min_value=date(2026, 8, 1), max_value=date(2026, 8, 20)))
    n_days = draw(st.integers(min_value=1, max_value=2))
    days = tuple(d0 + timedelta(days=k) for k in range(n_days))
    window = TimeWindow(
        start=datetime(d0.year, d0.month, d0.day, 9, 0, tzinfo=_KST),
        end=datetime(d0.year, d0.month, d0.day, 21, 0, tzinfo=_KST),
    )
    fixed: tuple[FixedBlock, ...] = ()
    if draw(st.booleans()) and pois:
        fb_poi = pois[0]
        fb_start = datetime(d0.year, d0.month, d0.day, 9, 30, tzinfo=_KST)
        fixed = (FixedBlock(
            poi_id=fb_poi.poi_id,
            window=TimeWindow(start=fb_start, end=fb_start + timedelta(minutes=60)),
            reason="user_fixed",
        ),)
    problem = ItineraryProblem(
        schedule_id=ScheduleId("s-bench"),
        days=days,
        candidates=candidates,
        fixed_blocks=fixed,
        budget=draw(st.sampled_from(list(BudgetLevel))),
        transport=draw(st.sampled_from(list(TransportMode))),
        day_window=window,
        seed=draw(st.integers(min_value=0, max_value=2**31)),
        anchor=draw(st.one_of(st.none(), st.just(_ANCHOR))),
    )
    return problem, index
