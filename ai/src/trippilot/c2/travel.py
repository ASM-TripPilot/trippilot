"""TravelEstimator — U1 TravelPort의 c2 구현체 (정본 §4.4, U2 FD §2.6).

time = dist / SPEED[mode] × SAFETY[mode] + BUFFER (내부 전용, INV-3).
거리 원천 1차 = 하버사인 × 우회계수 (실 카카오/네이버 어댑터는 후속 — Port 뒤라 무영향).
동일 입력 → 동일 출력 (U5-P4 결정론).
"""

from __future__ import annotations

import math

from trippilot.c2.config import SolverConfig
from trippilot.domain.common import GeoPoint, TransportMode
from trippilot.domain.travel import TravelEstimate

_EARTH_KM = 6371.0088


def haversine_km(a: GeoPoint, b: GeoPoint) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (a.lat, a.lng, b.lat, b.lng))
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2)
    return 2 * _EARTH_KM * math.asin(math.sqrt(h))


class TravelEstimator:
    """TravelPort Protocol 만족."""

    def __init__(self, config: SolverConfig) -> None:
        self._cfg = config

    def estimate(
        self, from_: GeoPoint, to: GeoPoint, mode: TransportMode
    ) -> TravelEstimate:
        straight = haversine_km(from_, to)
        road = straight * self._cfg.detour_factor
        minutes = int(round(
            road / self._cfg.speeds_kmph[mode] * 60 * self._cfg.safety[mode]
        )) + self._cfg.buffer_min
        return TravelEstimate(
            distance_km_range=(round(straight, 3), round(road, 3)),
            internal_minutes=minutes,
            is_estimated=True,
            source="haversine_x_detour",
        )
