"""GeoPoint·TransportMode generator (business-logic-model.md §4).

geo_points: 한국 bounding box 내 유효 좌표만 생성.
coord_pairs_apart: 지정 거리만큼 떨어진 두 좌표 (출처별 좌표 흔들림 재현).
"""

from __future__ import annotations

import math

from hypothesis import strategies as st

from trippilot.domain.common import GeoPoint, TransportMode

# 한국 대략 bounding box (제주 남단 ~ 최북단, 서해 ~ 동해)
_KR_LAT = (33.0, 38.6)
_KR_LNG = (125.0, 131.0)
# 여기서 최대 10km 를 밀어도 위 bbox 를 벗어나지 않는 내륙 앵커 범위
_ANCHOR_LAT = (33.5, 37.5)
_ANCHOR_LNG = (126.5, 129.0)
_KM_PER_DEG_LAT = 111.32


def geo_points() -> st.SearchStrategy[GeoPoint]:
    return st.builds(
        GeoPoint,
        lat=st.floats(*_KR_LAT, allow_nan=False, allow_infinity=False),
        lng=st.floats(*_KR_LNG, allow_nan=False, allow_infinity=False),
    )


def transport_modes() -> st.SearchStrategy[TransportMode]:
    return st.sampled_from(list(TransportMode))


@st.composite
def coord_pairs_apart(
    draw, *, min_km: float = 0.0, max_km: float = 10.0
) -> tuple[GeoPoint, GeoPoint]:
    """한국 bbox 안에서 [min_km, max_km] 만큼 떨어진 두 좌표.

    **같은 장소가 출처마다 다른 좌표로 들어오는 것**을 재현하는 전략이다 (TRIP-682).
    실측(TourAPI × LOCALDATA 동일 가게 6,886쌍): 중앙값 7.8m·p95 52.0m·최대 8.4km —
    50m 반경 판정이 94.7% 에서 끊긴다. 좌표에 기대지 않는 동일성 판정(주소 키)을
    시험하려면 "둘이 얼마나 벌어져도 같은 가게"인 분포가 필요하다.

    거리는 등거리 근사(1도 ≈ 111.32km)로 밀어 넣는다 — 오차 0.1% 수준이라
    "50m 밖"(min_km=0.2 등) 같은 경계 주장에 안전하다.
    """
    lat0 = draw(st.floats(*_ANCHOR_LAT, allow_nan=False, allow_infinity=False))
    lng0 = draw(st.floats(*_ANCHOR_LNG, allow_nan=False, allow_infinity=False))
    km = draw(st.floats(min_km, max_km, allow_nan=False, allow_infinity=False))
    bearing = draw(st.floats(0.0, 360.0, allow_nan=False, allow_infinity=False))
    theta = math.radians(bearing)
    d_lat = km / _KM_PER_DEG_LAT * math.cos(theta)
    d_lng = km / (_KM_PER_DEG_LAT * math.cos(math.radians(lat0))) * math.sin(theta)
    return GeoPoint(lat0, lng0), GeoPoint(lat0 + d_lat, lng0 + d_lng)
