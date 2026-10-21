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
from dataclasses import replace

from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.domain.common import GeoPoint, TransportMode
from trippilot.domain.travel import TravelEstimate

_EARTH_KM = 6371.0088
# 대중교통 요청에서 걸어가기로 한 구간의 출처 — `api.wiring._render_distance` 가 이것을 보고 "도보"라고 적는다
WALKED_SOURCE = "haversine_x_detour(walk)"
# 도보 요청에서 대중교통으로 가기로 한 구간의 출처 — 같은 곳이 이것을 보고 "대중교통"이라고 적는다
TRANSIT_SOURCE = "haversine_x_detour(transit)"


def haversine_km(a: GeoPoint, b: GeoPoint) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (a.lat, a.lng, b.lat, b.lng))
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2)
    return 2 * _EARTH_KM * math.asin(math.sqrt(h))


class TravelEstimator:
    """TravelPort Protocol 만족."""

    def __init__(self, config: AssemblyConfig) -> None:
        self._cfg = config

    @property
    def walk_transit_from_km(self) -> float:
        """도보 여행에서 대중교통으로 바꾸는 도로 km — 화면 감싸개(`WalkFirst`)가 실측 거리에도 같은 기준을 댄다."""
        return self._cfg.walk_transit_from_km

    def estimate(
        self, from_: GeoPoint, to: GeoPoint, mode: TransportMode
    ) -> TravelEstimate:
        straight = haversine_km(from_, to)
        road = straight * self._cfg.detour_factor
        minutes = self._minutes(road, mode) + self._cfg.buffer_min
        source = "haversine_x_detour"

        if mode is TransportMode.PUBLIC:
            # 도로 `public_walk_max_km` 이하만 걷는다 — 계산상 대중교통이 빨라도 걷고, 그 밖은 계산상 도보가
            # 빨라도 대중교통이다(config 주석). 걸어갈 땐 정류장 대기·환승이 없으므로 buffer 를 빼고 잰다.
            if road <= self._cfg.public_walk_max_km:
                minutes, source = self._minutes(road, TransportMode.WALK), WALKED_SOURCE
        elif mode is TransportMode.WALK and road >= self._cfg.walk_transit_from_km:
            # 도보 여행의 먼 구간은 대중교통이다(config `walk_transit_from_km`) — 대중교통 추정으로 잰다.
            minutes = self._minutes(road, TransportMode.PUBLIC) + self._cfg.buffer_min
            source = TRANSIT_SOURCE

        return TravelEstimate(
            distance_km_range=(round(straight, 3), round(road, 3)),
            internal_minutes=minutes,
            is_estimated=True,
            source=source,
        )

    def _minutes(self, road_km: float, mode: TransportMode) -> int:
        near = min(road_km, self._cfg.long_leg_km)
        hours = (near / self._cfg.speeds_kmph[mode]
                 + (road_km - near) / self._cfg.long_speeds_kmph[mode])
        return int(round(hours * 60 * self._cfg.safety[mode]))


class WalkFirst:
    """TravelPort — 구간 수단을 조립과 같은 추정기로 정하고 화면 거리를 잰다.

    대중교통 여행의 도보 상한 안 구간은 걷기로(액티비티 취향 상향, 2026-10-19), 도보 여행의 먼 구간은
    대중교통으로(2026-10-20) — 조립은 요청별 추정기(`ChainAssemblyProvider.walker`)로 그렇게 계산한다. 화면 거리도
    같은 판정이어야 시각과 "도보·대중교통" 이름표가 어긋나지 않는다. 걷는 구간은 실경로(ODsay)를 부르지 않는다.
    """

    def __init__(self, port, walker: TravelEstimator) -> None:
        self._port = port
        self._walker = walker

    def estimate(self, from_: GeoPoint, to: GeoPoint, mode: TransportMode) -> TravelEstimate:
        decided = self._walker.estimate(from_, to, mode)
        if decided.source == WALKED_SOURCE:
            return decided
        if decided.source == TRANSIT_SOURCE:
            # 실경로는 대중교통으로 재되 출처를 표식으로 바꿔 이름표가 "대중교통"이 되게 한다(화면 전용 감싸개)
            return replace(self._port.estimate(from_, to, TransportMode.PUBLIC), source=TRANSIT_SOURCE)
        measured = self._port.estimate(from_, to, mode)
        if mode is TransportMode.WALK and measured.distance_km_range[1] >= self._walker.walk_transit_from_km:
            # 추정(직선 × 1.3)은 기준 아래였는데 실측 경로가 넘는 구간 — 화면의 "1.5km 이상은 대중교통"을 지킨다
            # (개발 서버 실측 2026-10-20: 추정과 실측이 ±0.3km 어긋났다). 시각은 걷기로 잡혀 있지만 대중교통이
            # 더 빠르므로 일정은 그대로 성립한다. 실경로가 없는 배선은 실측이 곧 추정이라 여기 걸리지 않는다.
            return replace(self._port.estimate(from_, to, TransportMode.PUBLIC), source=TRANSIT_SOURCE)
        return measured

