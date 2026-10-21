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
from typing import TYPE_CHECKING

from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.domain.common import GeoPoint, TransportMode
from trippilot.domain.travel import TravelEstimate

if TYPE_CHECKING:
    from trippilot.assembly_engine.parking import ParkingPlan

_EARTH_KM = 6371.0088
# 대중교통 요청에서 걸어가기로 한 구간의 출처 — `api.wiring._render_distance` 가 이것을 보고 "도보"라고 적는다
WALKED_SOURCE = "haversine_x_detour(walk)"
# 도보 요청에서 대중교통으로 가기로 한 구간의 출처 — 같은 곳이 이것을 보고 "대중교통"이라고 적는다
TRANSIT_SOURCE = "haversine_x_detour(transit)"
# 자차 요청에서 주차 거점을 오가는 운전 구간의 출처(걷는 꼬리가 붙었다) — 이름표는 "자가용" 그대로, 꼬리는 `walk_km`
PARKED_SOURCE = "haversine_x_detour(parked)"


def haversine_km(a: GeoPoint, b: GeoPoint) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (a.lat, a.lng, b.lat, b.lng))
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2)
    return 2 * _EARTH_KM * math.asin(math.sqrt(h))


class TravelEstimator:
    """TravelPort Protocol 만족."""

    def __init__(self, config: AssemblyConfig, parking: "ParkingPlan | None" = None) -> None:
        self._cfg = config
        self._parking = parking

    @property
    def parking(self) -> "ParkingPlan | None":
        """자차 여행의 주차 거점(없으면 None) — 화면 감싸개(`WalkFirst`)가 운전 구간을 거점 사이로 실측한다."""
        return self._parking

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
        walk_km = 0.0  # 운전 구간에 붙은 걷는 꼬리(주차 거점) — 걷는 구간 자체는 0

        if mode is TransportMode.PUBLIC:
            # 도로 `public_walk_max_km` 이하만 걷는다 — 계산상 대중교통이 빨라도 걷고, 그 밖은 계산상 도보가
            # 빨라도 대중교통이다(config 주석). 걸어갈 땐 정류장 대기·환승이 없으므로 buffer 를 빼고 잰다.
            if road <= self._cfg.public_walk_max_km:
                minutes, source = self._minutes(road, TransportMode.WALK), WALKED_SOURCE
        elif mode is TransportMode.WALK and road >= self._cfg.walk_transit_from_km:
            # 도보 여행의 먼 구간은 대중교통이다(config `walk_transit_from_km`) — 대중교통 추정으로 잰다.
            minutes = self._minutes(road, TransportMode.PUBLIC) + self._cfg.buffer_min
            source = TRANSIT_SOURCE
        elif mode is TransportMode.CAR and self._parking is None:
            # 계획 없는 자차(검증·수리·편집·힌트 — 생성의 주차 계획은 와이어에 실리지 않는다): 대중교통과 같은 "도로 700m 이하는
            # 걷기". 생성이 계획으로 잰 어떤 구간보다 **더 요구하지 않는다** — 같은 거점 구간은 같은 값이거나 생성이 더 보수적이고
            # (아래 max), 거점을 떠난 구간은 꼬리+거점 사이 운전 ≥ 직행 운전이다. 그래서 손 안 댄 구간이 HC2 위반이 되지 않는다.
            if road <= self._cfg.public_walk_max_km:
                minutes, source = self._minutes(road, TransportMode.WALK), WALKED_SOURCE
        elif mode is TransportMode.CAR:
            # 주차 거점(assembly_engine/parking) — 같은 거점이면 차를 세워 두고 걷고, 거점이 다르면 거점에서 거점으로
            # 운전하되 양 끝에 걷는 꼬리(장소↔거점)가 붙는다. 거점이 없는 지점(숙소·고정 블록)과 거점 자신은 꼬리 0.
            hub_from, hub_to = self._parking.hub_of(from_), self._parking.hub_of(to)
            if hub_from is not None and hub_from == hub_to:
                # 거점 양쪽의 두 장소는 걷는 상한을 넘을 수 있다(1.1km 까지) — 그때는 계획 없는 재검증(운전+주차 여유)이
                # 요구하는 만큼은 잡아 둔다. 1km 에 걷기 21분·운전 3분+15분이라 0.83km 아래 걷기가 더 짧다
                walk = self._minutes(road, TransportMode.WALK)
                minutes = walk if road <= self._cfg.public_walk_max_km else max(walk, minutes)
                source = WALKED_SOURCE
            else:
                start = from_ if hub_from is None else hub_from
                end = to if hub_to is None else hub_to
                tail = (haversine_km(from_, start) + haversine_km(end, to)) * self._cfg.detour_factor
                if tail >= 0.001:  # 1m 미만 꼬리(같은 자리의 두 좌표)는 꼬리가 아니다 — walk_km 가 0.0 으로 반올림되는 PARKED 를 내지 않는다
                    walk_km = tail
                    drive_km = haversine_km(start, end) * self._cfg.detour_factor
                    road = drive_km + walk_km
                    # 한 번에 반올림한다 — 항별 반올림은 직행 운전(계획 없는 재검증)보다 1분 모자랄 수 있다
                    minutes = round(self._hours(walk_km, TransportMode.WALK) * 60 * self._cfg.safety[TransportMode.WALK]
                                    + self._hours(drive_km, mode) * 60 * self._cfg.safety[mode]) + self._cfg.buffer_min
                    source = PARKED_SOURCE

        return TravelEstimate(
            distance_km_range=(round(straight, 3), round(road, 3)),
            internal_minutes=minutes,
            is_estimated=True,
            source=source,
            walk_km=round(walk_km, 3),
        )

    def _minutes(self, road_km: float, mode: TransportMode) -> int:
        return int(round(self._hours(road_km, mode) * 60 * self._cfg.safety[mode]))

    def _hours(self, road_km: float, mode: TransportMode) -> float:
        near = min(road_km, self._cfg.long_leg_km)
        return near / self._cfg.speeds_kmph[mode] + (road_km - near) / self._cfg.long_speeds_kmph[mode]


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
        if decided.source == PARKED_SOURCE:
            # 자차 주차 거점 — 실경로는 거점에서 거점까지의 운전만 잰다. 걷는 꼬리는 추정값을 거리에 더하고 `walk_km` 로 남겨
            # 문구가 "(주차장 도보 … 포함)"을 붙이게 한다. 두 번 돌리는 렌더(LegRecorder → 표)도 같은 거점 쌍을 본다.
            plan = self._walker.parking
            assert plan is not None
            start, end = plan.hub_of(from_) or from_, plan.hub_of(to) or to
            measured = self._port.estimate(start, end, TransportMode.CAR)
            low, high = measured.distance_km_range
            return replace(measured, distance_km_range=(round(low + decided.walk_km, 3), round(high + decided.walk_km, 3)),
                           walk_km=decided.walk_km)
        measured = self._port.estimate(from_, to, mode)
        if mode is TransportMode.WALK and measured.distance_km_range[1] >= self._walker.walk_transit_from_km:
            # 추정(직선 × 1.3)은 기준 아래였는데 실측 경로가 넘는 구간 — 화면의 "1.5km 이상은 대중교통"을 지킨다
            # (개발 서버 실측 2026-10-20: 추정과 실측이 ±0.3km 어긋났다). 시각은 걷기로 잡혀 있지만 대중교통이
            # 더 빠르므로 일정은 그대로 성립한다. 실경로가 없는 배선은 실측이 곧 추정이라 여기 걸리지 않는다.
            return replace(self._port.estimate(from_, to, TransportMode.PUBLIC), source=TRANSIT_SOURCE)
        return measured

