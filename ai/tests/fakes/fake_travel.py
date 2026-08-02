"""FakeTravel — TravelPort의 결정론 가짜 구현 (business-logic-model.md §3).

haversine 직선거리 × 우회계수 1.3. 실 API 없이 테스트 가능.
같은 입력이면 항상 같은 출력 (U5-P4 결정론 — 무작위성·실시간 의존 없음).
"""

from __future__ import annotations

import math

from trippilot.domain.common import GeoPoint, TransportMode
from trippilot.domain.travel import TravelEstimate

_DETOUR = 1.3  # 직선거리 우회계수 (G106)
_EARTH_KM = 6371.0088

# 이동수단별 평속(km/h) — remote config 초기값과 동일 (AI-D07)
# internal_minutes 합성용 (표시 안 됨, INV-3)
_SPEED_KMPH = {
    TransportMode.WALK: 4.0,
    TransportMode.PUBLIC: 20.0,
    TransportMode.CAR: 30.0,
}


def _haversine_km(a: GeoPoint, b: GeoPoint) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (a.lat, a.lng, b.lat, b.lng))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * _EARTH_KM * math.asin(math.sqrt(h))


class FakeTravel:
    """TravelPort Protocol을 만족 (상속 불필요)."""

    def estimate(
        self, from_: GeoPoint, to: GeoPoint, mode: TransportMode
    ) -> TravelEstimate:
        straight = _haversine_km(from_, to)
        road = straight * _DETOUR
        minutes = int(round(road / _SPEED_KMPH[mode] * 60))
        return TravelEstimate(
            distance_km_range=(round(straight, 3), round(road, 3)),
            internal_minutes=minutes,
            is_estimated=True,
            source="haversine_fake",
        )
