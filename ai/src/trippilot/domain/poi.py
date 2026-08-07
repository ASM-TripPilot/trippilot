"""POI 도메인 타입 (domain-entities.md §1).

가격 캐싱 금지 (business-rules.md §6): `to_cacheable_dict()`는 avg_cost를 제외 —
CachePort에 저장되는 직렬화 경로에서 구조적으로 차단.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from trippilot.domain.common import GeoPoint, PoiId


class PoiCategory(Enum):
    """경계 카테고리 8종 + 내부 전용 STAY (TRIP-281).

    앞 8종은 백엔드 `/internal/pois` read 포트가 내보내는 경계 코드와 값·집합이 동일하다
    (`backend/.../placedata/domain/Poi.kt` 한글 정본 ↔ `PoiInternalController.boundaryCode()`:
    명소=SIGHT · 맛집=FOOD · 카페=CAFE · 야경=NIGHT_VIEW · 자연=NATURE · 쇼핑=SHOPPING ·
    문화=CULTURE · 액티비티=ACTIVITY).

    한↔영 매핑은 **백엔드 리버스 read 포트(BE-5)가 이미 수행**해 영문 코드로 내보내므로
    이 모듈에는 매핑이 필요 없다. 다만 한글 값을 그대로 받는 다른 경계(예: DB 직접 조회·
    레거시 응답)가 생기면 매핑 어댑터가 필요하며, 그 위치는 U5 경계 어댑터 소관이다.
    """

    FOOD = "FOOD"
    CAFE = "CAFE"
    SIGHT = "SIGHT"
    NIGHT_VIEW = "NIGHT_VIEW"
    NATURE = "NATURE"
    CULTURE = "CULTURE"
    ACTIVITY = "ACTIVITY"
    SHOPPING = "SHOPPING"
    # 내부 전용(숙소 앵커·체류시간 계산). 경계 카테고리 8종에 포함되지 않으며
    # `/internal/pois` 응답에 등장하지 않는다 (PR #104 회신).
    STAY = "STAY"


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
class ExtractedPlace:
    """자유 웹 추출 원시 후보 (프롬프트 정본 §2.5, 수집 게이트 전 단계).

    SourcedPoi(coord·category 필수)보다 앞선 형태 — 문서에 없는 필드는 null 보존
    ("추측·창작 금지" 가드레일). 수집 게이트(U6 sourcing)가 지오코딩·검증 후 승격.
    """

    name: str
    address: str | None
    coord: GeoPoint | None  # 좌표 임의 생성 금지 — 주소만 있으면 None
    hours: str | None
    category_raw: str | None  # PoiCategory 매핑은 게이트 몫
    confidence: float  # 0.0~1.0 (게이트에서 클램프)
    source_url: str

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "address": self.address,
            "coord": self.coord.to_dict() if self.coord else None,
            "hours": self.hours,
            "category_raw": self.category_raw,
            "confidence": self.confidence,
            "source_url": self.source_url,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ExtractedPlace":
        return cls(
            name=d["name"],
            address=d["address"],
            coord=GeoPoint.from_dict(d["coord"]) if d.get("coord") else None,
            hours=d["hours"],
            category_raw=d["category_raw"],
            confidence=d["confidence"],
            source_url=d["source_url"],
        )


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
