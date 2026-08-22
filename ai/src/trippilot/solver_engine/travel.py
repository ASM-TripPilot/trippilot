"""TravelEstimator — U1 TravelPort의 c2 구현체 (정본 §4.4, U2 FD §2.6).

time = dist / SPEED[mode] × SAFETY[mode] + BUFFER (내부 전용, INV-3).
거리 원천 1차 = 하버사인 × 우회계수 (실 카카오/네이버 어댑터는 후속 — Port 뒤라 무영향).
동일 입력 → 동일 출력 (U5-P4 결정론).

**대중교통 짧은 구간은 걷는다** (TRIP-405 후속): BUFFER 는 정류장 대기·환승을
모델링한 것이라 걸어갈 땐 붙지 않는다. 그래서 가까운 구간은 대중교통보다 도보가
빠른데, 그대로 두면 500m 를 18분 걸리는 것으로 계산해 하루에 넣을 수 있는 장소가
줄어든다(실측: 해운대 리허설 6구간 전부 과대추정). 두 값을 재서 **빠른 쪽을 쓴다**
— 사람이 실제로 하는 선택이다. 임계 거리를 따로 두지 않는 이유는 손댈 상수가
하나 줄기 때문: 현재 상수에서 분기점은 도로거리 약 0.9km(직선 0.7km)이고,
속도·안전계수를 조정하면 분기점도 따라 움직인다.
"""

from __future__ import annotations

import math

from trippilot.solver_engine.config import SolverConfig
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
        minutes = self._minutes(road, mode) + self._cfg.buffer_min
        source = "haversine_x_detour"

        if mode is TransportMode.PUBLIC:
            # 걸어갈 땐 정류장 대기·환승이 없으므로 buffer 를 빼고 잰다.
            on_foot = self._minutes(road, TransportMode.WALK)
            # ① 600m 이하는 계산상 대중교통이 빨라도 걷는다 (config 주석 참조)
            # ② 그보다 멀어도 도보가 빠르면 도보 — 사람이 하는 선택
            if straight <= self._cfg.public_walk_max_km or on_foot < minutes:
                minutes, source = on_foot, "haversine_x_detour(walk)"

        return TravelEstimate(
            distance_km_range=(round(straight, 3), round(road, 3)),
            internal_minutes=minutes,
            is_estimated=True,
            source=source,
        )

    def _minutes(self, road_km: float, mode: TransportMode) -> int:
        return int(round(
            road_km / self._cfg.speeds_kmph[mode] * 60 * self._cfg.safety[mode]
        ))
