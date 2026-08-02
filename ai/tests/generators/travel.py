"""TravelEstimate generator (business-logic-model.md §4).

유효성 조건: 거리 범위 low ≤ high, low ≥ 0, internal_minutes ≥ 0.
"""

from __future__ import annotations

from hypothesis import strategies as st

from trippilot.domain.travel import TravelEstimate


@st.composite
def travel_estimates(draw) -> TravelEstimate:
    low = draw(st.floats(0, 100, allow_nan=False, allow_infinity=False))
    span = draw(st.floats(0, 50, allow_nan=False, allow_infinity=False))
    return TravelEstimate(
        distance_km_range=(low, low + span),
        internal_minutes=draw(st.integers(min_value=0, max_value=600)),
        is_estimated=draw(st.booleans()),
        source=draw(st.sampled_from(["haversine_fake", "kakao", "naver"])),
    )
