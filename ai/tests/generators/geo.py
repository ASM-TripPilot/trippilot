"""GeoPoint·TransportMode generator (business-logic-model.md §4).

geo_points: 한국 bounding box 내 유효 좌표만 생성.
"""

from __future__ import annotations

from hypothesis import strategies as st

from trippilot.domain.common import GeoPoint, TransportMode

# 한국 대략 bounding box (제주 남단 ~ 최북단, 서해 ~ 동해)
_KR_LAT = (33.0, 38.6)
_KR_LNG = (125.0, 131.0)


def geo_points() -> st.SearchStrategy[GeoPoint]:
    return st.builds(
        GeoPoint,
        lat=st.floats(*_KR_LAT, allow_nan=False, allow_infinity=False),
        lng=st.floats(*_KR_LNG, allow_nan=False, allow_infinity=False),
    )


def transport_modes() -> st.SearchStrategy[TransportMode]:
    return st.sampled_from(list(TransportMode))
