"""M7 generator — 필터를 자극하는 POI 분포 + 풀 요청 (U3 FD §5)."""

from __future__ import annotations

from datetime import date, timedelta

from hypothesis import strategies as st

from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId, TransportMode
from trippilot.domain.poi_curation import CandidatePoolRequest
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource

_ANCHOR = GeoPoint(37.751, 128.876)


@st.composite
def pois_with_attrs(draw) -> Poi:
    """반경(±0.3도≈수십 km)·예산(None~고가)·영업요일·품질 전 분포."""
    i = draw(st.integers(min_value=0, max_value=10**6))
    open_hours: tuple[OpenHour, ...] = ()
    if draw(st.booleans()):
        dows = draw(st.sets(st.integers(0, 6), min_size=1, max_size=4))
        open_hours = tuple(OpenHour(d, 540, 1260) for d in sorted(dows))
    return Poi(
        poi_id=PoiId(f"m{i}"),
        name=draw(st.text(min_size=1, max_size=12)),
        category=draw(st.sampled_from(list(PoiCategory))),
        coord=GeoPoint(
            _ANCHOR.lat + draw(st.floats(-0.3, 0.3, allow_nan=False, allow_infinity=False)),
            _ANCHOR.lng + draw(st.floats(-0.3, 0.3, allow_nan=False, allow_infinity=False)),
        ),
        open_hours=open_hours,
        avg_cost=draw(st.one_of(st.none(), st.integers(0, 200_000))),
        rating=draw(st.one_of(st.none(), st.floats(0, 5, allow_nan=False, allow_infinity=False))),
        quality=draw(st.sampled_from(list(DataQuality))),
        source=PoiSource.SEED,
        confidence=None,
    )


@st.composite
def pool_requests(draw) -> CandidatePoolRequest:
    d0 = draw(st.dates(min_value=date(2026, 8, 1), max_value=date(2026, 8, 20)))
    n = draw(st.integers(min_value=1, max_value=3))
    return CandidatePoolRequest(
        anchor=_ANCHOR,
        dates=tuple(d0 + timedelta(days=k) for k in range(n)),
        budget=draw(st.sampled_from(list(BudgetLevel))),
        transport=draw(st.sampled_from(list(TransportMode))),
        radius_override_km=draw(st.one_of(
            st.none(), st.floats(0.5, 30, allow_nan=False, allow_infinity=False))),
    )
