"""PoiDbPort — M7 정본 저장소 콘센트 (business-logic-model.md §2.4).

Protocol만 — 실 구현(PostgreSQL/PostGIS)은 U3 소유.
"""

from __future__ import annotations

from datetime import date
from typing import Protocol

from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.poi import OpenHour, Poi, PoiCategory


class PoiDbPort(Protocol):
    def find_by_radius(self, center: GeoPoint, radius_km: float) -> tuple[Poi, ...]: ...
    def find_by_ids(self, ids: frozenset[PoiId]) -> tuple[Poi, ...]: ...
    def find_nearby(
        self, coord: GeoPoint, radius_m: int, category: PoiCategory
    ) -> tuple[Poi, ...]: ...
    def upsert(self, poi: Poi) -> PoiId: ...
    def get_open_window(self, poi_id: PoiId, on: date) -> OpenHour | None: ...
    def batch_check_closed(
        self, poi_ids: frozenset[PoiId], on: date
    ) -> frozenset[PoiId]: ...
