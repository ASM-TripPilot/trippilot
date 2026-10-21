"""주차 거점 — 자차 여행에서 가까운 장소들은 차를 한 번 세우고 걸어서 돈다 (2026-10-21 사용자).

종전에는 자차 여행의 모든 구간을 운전으로 잤다. 500m 옆 장소도 차를 빼서 가고 주차 여유 15분을 또 썼다.
사용자: "매번 자차로 움직이지 않고 어느 정도 가까우면 걸어가게 하고 주차했던 곳으로 돌아가게."

모양 — **일정을 짜기 전에** 후보 장소를 걷는 거리 안으로 묶고 묶음마다 주차 거점(차를 세우는 장소) 하나를 둔다:
  · 같은 묶음 안 이동 = 걷기(주차 여유 없음)
  · 묶음을 떠날 때 = 거점까지 걸어 돌아가기 + 운전 + 주차 여유
  · 묶음에 들어갈 때 = 거점에 주차 + 첫 장소까지 걷기
이렇게 하면 "A→B 몇 분"이 둘의 거점만 알면 정해지는 **쌍별 값**이라 OR-Tools 시간표에 그대로 들어간다 — 솔버는
무변경이고, 다 짠 뒤 걷기로 바꾸는 방식의 "되돌아가는 시간이 뒤늦게 붙어 하루가 넘치는" 문제가 없다.
숙소(앵커)·고정 블록처럼 묶음에 없는 지점은 거점이 없다 — 종전처럼 운전으로 오간다.

묶는 규칙(결정론 — 같은 풀이면 같은 묶음, U5-P4):
  · 거점은 걷는 거리 안 이웃이 가장 많은 장소(동률은 좌표 순). 그 거점에서 `walk_max_km`(도로) 안의 장소를 붙인다.
  · 붙일 때 이미 붙은 다른 장소와 `WALK_HARD_MAX_KM`(1.1km 도로) 넘게 떨어지면 붙이지 않는다 — 거점 양쪽 끝의 두 장소를
    직접 걷게 되는 거리가 "어떤 설정으로도 1.1km 이상은 걷지 않는다"(config)를 넘지 않게.
  · 혼자 남은 장소는 자기 자신이 거점이다(걷는 구간이 생기지 않는다).
걷는 거리 기준은 대중교통 여행의 도보 상한과 같은 값이다(사용자 결정 — 숫자 하나). 거리는 도로 km(직선 × 우회계수)로 댄다.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field

from trippilot.assembly_engine.config import WALK_HARD_MAX_KM
from trippilot.assembly_engine.travel import haversine_km
from trippilot.domain.common import GeoPoint


@dataclass(frozen=True, slots=True)
class ParkingPlan:
    """장소 좌표 → 그 장소의 주차 거점 좌표. 없는 좌표는 거점이 없다(운전으로 오간다)."""

    hubs: Mapping[GeoPoint, GeoPoint] = field(default_factory=dict)

    def hub_of(self, point: GeoPoint) -> GeoPoint | None:
        return self.hubs.get(point)

    @property
    def walk_clusters(self) -> int:
        """둘 이상이 한 거점을 쓰는 묶음 수 — 로그·테스트용."""
        counts: dict[GeoPoint, int] = {}
        for hub in self.hubs.values():
            counts[hub] = counts.get(hub, 0) + 1
        return sum(1 for n in counts.values() if n > 1)


def plan_parking(points: Iterable[GeoPoint], *, walk_max_km: float, detour_factor: float) -> ParkingPlan:
    """후보 좌표들을 주차 거점으로 묶는다. `walk_max_km`·`WALK_HARD_MAX_KM` 는 도로 km, 좌표 비교는 직선이라 우회계수로 나눈다."""
    radius = walk_max_km / detour_factor
    hard = WALK_HARD_MAX_KM / detour_factor
    ordered = sorted(set(points), key=lambda p: (p.lat, p.lng))
    # 이웃 표를 한 번만 만든다 — 자차 풀(반경 20km)은 수백 곳이라 되풀이 계산하면 수십 초다
    near: dict[GeoPoint, list[GeoPoint]] = {
        p: [q for q in ordered if q != p and haversine_km(p, q) <= radius] for p in ordered
    }
    hubs: dict[GeoPoint, GeoPoint] = {}
    free = set(ordered)
    while free:
        hub = max(sorted(free, key=lambda p: (p.lat, p.lng)), key=lambda p: sum(1 for q in near[p] if q in free))
        members = [hub]
        for q in sorted((q for q in near[hub] if q in free), key=lambda q: haversine_km(hub, q)):
            if all(haversine_km(q, m) <= hard for m in members):
                members.append(q)
        for m in members:
            hubs[m] = hub
            free.discard(m)
    return ParkingPlan(hubs)
