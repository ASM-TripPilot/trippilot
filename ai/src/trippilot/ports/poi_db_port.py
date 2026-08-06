"""PoiDbPort — POI read-only 조회 콘센트 (business-logic-model.md §2.4).

POI 정본은 backend C7(place-data)이 단일 소유하고, 본 포트는 AI측
read-only 소비 콘센트다 (PR #76 결정3: AI write 제거). Protocol만 —
쓰기 메서드를 추가하지 않는다.
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
    def get_open_window(self, poi_id: PoiId, on: date) -> OpenHour | None: ...
    def batch_check_closed(
        self, poi_ids: frozenset[PoiId], on: date
    ) -> frozenset[PoiId]: ...
