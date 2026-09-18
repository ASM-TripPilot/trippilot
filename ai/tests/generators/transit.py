"""TransitRequest/TransitInfo/DelayTrigger generator (TRIP-410).

유효성 조건:
- TransitRequest: now tz-aware, expected_minutes ≥ 0 또는 None
- DelayTrigger: delay_minutes ≥ 0, threshold_minutes > 0
- TransitInfo: distance_m ≥ 0, internal_minutes ≥ 0
"""

from __future__ import annotations

from datetime import datetime, timezone

from hypothesis import strategies as st

from trippilot.domain.freshness import FreshnessMeta
from trippilot.domain.transit import (
    Confidence,
    DelayTrigger,
    TransitInfo,
    TransitPurpose,
    TransitRequest,
)

from tests.generators.geo import geo_points, transport_modes


def transit_purposes() -> st.SearchStrategy[TransitPurpose]:
    return st.sampled_from(list(TransitPurpose))


def confidences() -> st.SearchStrategy[Confidence]:
    return st.sampled_from(list(Confidence))


@st.composite
def tz_aware_datetimes(draw) -> datetime:
    """tz-aware datetime 생성 (UTC)."""
    ts = draw(st.floats(min_value=0, max_value=4_102_444_800, allow_nan=False, allow_infinity=False))
    return datetime.fromtimestamp(ts, tz=timezone.utc)


@st.composite
def transit_requests(draw) -> TransitRequest:
    return TransitRequest(
        origin=draw(geo_points()),
        destination=draw(geo_points()),
        mode=draw(transport_modes()),
        purpose=draw(transit_purposes()),
        now=draw(tz_aware_datetimes()),
        expected_minutes=draw(st.one_of(st.none(), st.integers(min_value=0, max_value=600))),
    )


@st.composite
def delay_triggers(draw) -> DelayTrigger:
    return DelayTrigger(
        delay_minutes=draw(st.integers(min_value=0, max_value=300)),
        threshold_minutes=draw(st.integers(min_value=1, max_value=120)),
    )


@st.composite
def freshness_metas(draw) -> FreshnessMeta:
    return FreshnessMeta(
        source=draw(st.sampled_from(["haversine_x_detour", "tmap_car", "tmap_transit", "naver"])),
        fetched_at=draw(tz_aware_datetimes()),
        cache_hit=draw(st.booleans()),
        ttl_sec=draw(st.integers(min_value=0, max_value=86400)),
        stale=draw(st.booleans()),
    )


@st.composite
def transit_infos(draw) -> TransitInfo:
    return TransitInfo(
        distance_m=draw(st.integers(min_value=0, max_value=500_000)),
        distance_range=draw(st.sampled_from(["약 1.2km", "약 500m", "약 3.5km"])),
        internal_minutes=draw(st.integers(min_value=0, max_value=600)),
        confidence=draw(confidences()),
        source=draw(st.sampled_from(["haversine_x_detour", "tmap_car", "tmap_transit"])),
        delay_trigger=draw(st.one_of(st.none(), delay_triggers())),
        freshness=draw(freshness_metas()),
    )
