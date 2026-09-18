"""InMemoryPoi — PoiDbPort의 dict 기반 fake (business-logic-model.md §3).

find_by_radius/find_nearby는 haversine 필터. 결정론 (실 DB·네트워크 없음).
"""

from __future__ import annotations

import math
from datetime import date

from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.poi import OpenHour, Poi, PoiCategory
from trippilot.ports.poi_db_port import PoiLookup, lookup_from

_EARTH_KM = 6371.0088


def _haversine_km(a: GeoPoint, b: GeoPoint) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (a.lat, a.lng, b.lat, b.lng))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * _EARTH_KM * math.asin(math.sqrt(h))


class InMemoryPoi:
    """PoiDbPort Protocol 만족 (상속 불필요)."""

    def __init__(self, seed: tuple[Poi, ...] = ()) -> None:
        self._store: dict[PoiId, Poi] = {p.poi_id: p for p in seed}

    def _sorted(self) -> tuple[Poi, ...]:
        # 결정론적 순서 (id 정렬) — 같은 상태면 같은 반환
        return tuple(self._store[k] for k in sorted(self._store, key=str))

    def find_by_radius(self, center: GeoPoint, radius_km: float) -> tuple[Poi, ...]:
        return tuple(
            p for p in self._sorted() if _haversine_km(center, p.coord) <= radius_km
        )

    def find_by_ids(self, ids: frozenset[PoiId]) -> tuple[Poi, ...]:
        return tuple(self._store[i] for i in sorted(ids, key=str) if i in self._store)

    def lookup_by_ids(self, ids: frozenset[PoiId]) -> PoiLookup:
        return lookup_from(self.find_by_ids(ids), ids)  # 인메모리 — 매핑 실패 없음

    def find_nearby(
        self, coord: GeoPoint, radius_m: int, category: PoiCategory
    ) -> tuple[Poi, ...]:
        radius_km = radius_m / 1000.0
        return tuple(
            p
            for p in self._sorted()
            if p.category is category and _haversine_km(coord, p.coord) <= radius_km
        )

    def get_open_window(self, poi_id: PoiId, on: date) -> OpenHour | None:
        poi = self._store.get(poi_id)
        if poi is None:
            return None
        dow = on.weekday()
        for oh in poi.open_hours:
            if oh.day_of_week == dow:
                return oh
        return None

    def batch_check_closed(
        self, poi_ids: frozenset[PoiId], on: date
    ) -> frozenset[PoiId]:
        dow = on.weekday()
        closed = set()
        for pid in poi_ids:
            poi = self._store.get(pid)
            if poi is None or not any(oh.day_of_week == dow for oh in poi.open_hours):
                closed.add(pid)
        return frozenset(closed)
