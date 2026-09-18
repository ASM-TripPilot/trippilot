"""PlacesPort — 외부 장소 검색 콘센트 (business-logic-model.md §2.3).

실 구현(Places API 벤더)은 U6 웹 소싱에서. 반환 SourcedPoi는 M7 게이트 전 원시 후보.
"""

from __future__ import annotations

from typing import Protocol

from trippilot.domain.common import GeoPoint
from trippilot.domain.poi import PoiCategory, SourcedPoi


class PlacesPort(Protocol):
    def search(
        self, region: str, category: PoiCategory, limit: int
    ) -> tuple[SourcedPoi, ...]: ...
    def geocode(self, name: str, region: str) -> GeoPoint | None: ...
