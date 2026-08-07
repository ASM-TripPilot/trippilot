"""FakePlaces — PlacesPort의 고정 시드 fake (business-logic-model.md §3).

결정론 — 주입한 시드 데이터만 반환.
"""

from __future__ import annotations

from trippilot.domain.common import GeoPoint
from trippilot.domain.poi import PoiCategory, SourcedPoi


class FakePlaces:
    def __init__(
        self,
        by_category: dict[PoiCategory, tuple[SourcedPoi, ...]] | None = None,
        geocodes: dict[str, GeoPoint] | None = None,
    ) -> None:
        self._by_category = by_category or {}
        self._geocodes = geocodes or {}

    def search(
        self, region: str, category: PoiCategory, limit: int
    ) -> tuple[SourcedPoi, ...]:
        return self._by_category.get(category, ())[:limit]

    def geocode(self, name: str, region: str) -> GeoPoint | None:
        return self._geocodes.get(name)
