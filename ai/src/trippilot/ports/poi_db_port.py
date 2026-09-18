"""PoiDbPort — POI read-only 조회 콘센트 (business-logic-model.md §2.4).

POI 정본은 backend C7(place-data)이 단일 소유하고, 본 포트는 AI측
read-only 소비 콘센트다 (PR #76 결정3: AI write 제거). Protocol만 —
쓰기 메서드를 추가하지 않는다.

`lookup_by_ids`(TRIP-537)는 `find_by_ids`와 같은 조회를 하되 **요청 대비 누락을
값으로 함께 낸다**. `find_by_ids`는 "찾은 것"만 돌려주므로 호출자는 N건을 물어
M건을 받고도 왜 빠졌는지 모른다 — 그 조용한 차집합이 검증 경계에서 "위반 0 =
통과"로 읽혔다(INV-4 침묵 실패). 기존 메서드는 그대로 둔다: 누락을 안 쓰는
호출자(거리 렌더·설명)가 더 많다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Literal, Protocol

from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.poi import OpenHour, Poi, PoiCategory

MissReason = Literal["not_found", "mapping_failed"]


@dataclass(frozen=True, slots=True)
class PoiMiss:
    """요청했는데 Poi로 못 받은 id 1건.

    - `not_found`: 정본이 그 행을 안 돌려줬다(미등록·비ACTIVE·삭제).
    - `mapping_failed`: 돌려줬는데 우리가 못 읽었다 — `detail`이 원인 필드명이다
      (좌표 null·모르는 category/data_quality 등). 이 둘을 뭉뚱그리면 "백엔드에
      없다"와 "백엔드가 값을 늘렸다"가 같은 얼굴이 된다.
    """

    poi_id: PoiId
    reason: MissReason
    detail: str = ""


@dataclass(frozen=True, slots=True)
class PoiLookup:
    """`lookup_by_ids` 결과. `misses`가 비었으면 요청 id 전부를 Poi로 해석했다."""

    pois: tuple[Poi, ...]
    misses: tuple[PoiMiss, ...] = ()


def lookup_from(pois: tuple[Poi, ...], ids: frozenset[PoiId]) -> PoiLookup:
    """사유를 구분할 수 없는 구현(인메모리 등)의 기본 — 차집합은 전부 not_found.

    매핑 실패라는 개념이 없는 저장소(이미 Poi를 들고 있다)에서는 이게 정확하다.
    """
    found = {p.poi_id for p in pois}
    return PoiLookup(
        tuple(pois),
        tuple(PoiMiss(i, "not_found") for i in sorted(ids - found, key=str)),
    )


class PoiDbPort(Protocol):
    def find_by_radius(self, center: GeoPoint, radius_km: float) -> tuple[Poi, ...]: ...
    def find_by_ids(self, ids: frozenset[PoiId]) -> tuple[Poi, ...]: ...
    def lookup_by_ids(self, ids: frozenset[PoiId]) -> PoiLookup: ...
    def find_nearby(
        self, coord: GeoPoint, radius_m: int, category: PoiCategory
    ) -> tuple[Poi, ...]: ...
    def get_open_window(self, poi_id: PoiId, on: date) -> OpenHour | None: ...
    def batch_check_closed(
        self, poi_ids: frozenset[PoiId], on: date
    ) -> frozenset[PoiId]: ...
