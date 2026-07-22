"""POI 도메인 타입 (domain-entities.md §1).

가격 캐싱 금지 (business-rules.md §6): `to_cacheable_dict()`는 avg_cost를 제외 —
CachePort에 저장되는 직렬화 경로에서 구조적으로 차단.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from trippilot.domain.common import GeoPoint, PoiId


class PoiCategory(Enum):
    FOOD = "FOOD"
    CAFE = "CAFE"
    SIGHT = "SIGHT"
    ACTIVITY = "ACTIVITY"
    SHOPPING = "SHOPPING"
    STAY = "STAY"
    ETC = "ETC"


class DataQuality(Enum):
    """MINIMAL은 후보 풀에서 제외 (M7 필터). 순서 = 품질 오름차순."""

    MINIMAL = "MINIMAL"
    PARTIAL = "PARTIAL"
    FULL = "FULL"


class PoiSource(Enum):
    SEED = "SEED"
    PLACES_API = "PLACES_API"
    WEB = "WEB"  # WEB은 confidence 필수 (아래 Poi.__post_init__)


@dataclass(frozen=True, slots=True)
class OpenHour:
    """영업시간. close_min은 1440 초과 허용(자정 초과 방문, 시작일 귀속)."""

    day_of_week: int  # 0~6 (월=0)
    open_min: int
    close_min: int

    def __post_init__(self) -> None:
        if not 0 <= self.day_of_week <= 6:
            raise ValueError(f"day_of_week 범위 밖 [0,6]: {self.day_of_week}")
        if self.open_min < 0:
            raise ValueError(f"open_min 음수: {self.open_min}")
        if not self.open_min < self.close_min:
            raise ValueError(f"open<close 위반: {self.open_min} !< {self.close_min}")

    def to_dict(self) -> dict:
        return {
            "day_of_week": self.day_of_week,
            "open_min": self.open_min,
            "close_min": self.close_min,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "OpenHour":
        return cls(
            day_of_week=d["day_of_week"],
            open_min=d["open_min"],
            close_min=d["close_min"],
        )


@dataclass(frozen=True, slots=True)
class Poi:
    poi_id: PoiId
    name: str
    category: PoiCategory
    coord: GeoPoint
    open_hours: tuple[OpenHour, ...]
    avg_cost: int | None  # None → 예산 필터 통과. 가격 캐싱 금지 대상 필드
    rating: float | None
    quality: DataQuality
    source: PoiSource
    confidence: float | None

    def __post_init__(self) -> None:
        if not self.poi_id:
            raise ValueError("poi_id는 비어있을 수 없음")
        if self.source is PoiSource.WEB and self.confidence is None:
            raise ValueError("WEB 소스는 confidence 필수 (INV-1 수집 게이트)")
        if self.avg_cost is not None and self.avg_cost < 0:
            raise ValueError(f"avg_cost 음수: {self.avg_cost}")

    def to_dict(self) -> dict:
        return {
            "poi_id": str(self.poi_id),
            "name": self.name,
            "category": self.category.value,
            "coord": self.coord.to_dict(),
            "open_hours": [oh.to_dict() for oh in self.open_hours],
            "avg_cost": self.avg_cost,
            "rating": self.rating,
            "quality": self.quality.value,
            "source": self.source.value,
            "confidence": self.confidence,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Poi":
        return cls(
            poi_id=PoiId(d["poi_id"]),
            name=d["name"],
            category=PoiCategory(d["category"]),
            coord=GeoPoint.from_dict(d["coord"]),
            open_hours=tuple(OpenHour.from_dict(x) for x in d["open_hours"]),
            avg_cost=d["avg_cost"],
            rating=d["rating"],
            quality=DataQuality(d["quality"]),
            source=PoiSource(d["source"]),
            confidence=d["confidence"],
        )

    def to_cacheable_dict(self) -> dict:
        """캐시 저장용 — 가격(avg_cost) 제외 (business-rules.md §6)."""
        d = self.to_dict()
        del d["avg_cost"]
        return d


@dataclass(frozen=True, slots=True)
class SourcedPoi:
    """웹 소싱 원시 후보 (PlacesPort 반환, M7 수집 게이트 전 단계).

    ※ domain-entities.md의 PlacesPort(§2.3) 시그니처가 참조하나 엔티티 표엔 미정의 —
    U1에서 최소 형태로 도입. M7 등록 게이트(U6)를 통과해야 Poi로 승격.
    """

    name: str
    coord: GeoPoint
    category: PoiCategory
    source_url: str | None
    raw_confidence: float | None

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "coord": self.coord.to_dict(),
            "category": self.category.value,
            "source_url": self.source_url,
            "raw_confidence": self.raw_confidence,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "SourcedPoi":
        return cls(
            name=d["name"],
            coord=GeoPoint.from_dict(d["coord"]),
            category=PoiCategory(d["category"]),
            source_url=d["source_url"],
            raw_confidence=d["raw_confidence"],
        )
