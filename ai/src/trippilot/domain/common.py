"""공통 도메인 타입 (domain-entities.md §0).

domain 계층은 외부 의존 0 — 표준 라이브러리만 사용.
모든 값 타입은 frozen + slots, 검증은 __post_init__에서 (business-rules.md §2).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import NewType

# ID 타입 — NewType 문자열. 교차 대입은 타입 체커가 차단 (business-rules.md §2)
PoiId = NewType("PoiId", str)
ScheduleId = NewType("ScheduleId", str)
UserId = NewType("UserId", str)
TraceId = NewType("TraceId", str)


class TransportMode(Enum):
    """이동 수단. radius_km = 후보 풀 반경 기준 (domain-entities.md §0)."""

    WALK = "WALK"
    PUBLIC = "PUBLIC"
    CAR = "CAR"

    @property
    def radius_km(self) -> float:
        return {
            TransportMode.WALK: 2.0,
            TransportMode.PUBLIC: 10.0,
            TransportMode.CAR: 20.0,
        }[self]


class BudgetLevel(Enum):
    """예산 등급 — 소프트 제약 (필터·가중치 입력, HC 아님. business-rules.md §6)."""

    LOW = "LOW"
    MID = "MID"
    HIGH = "HIGH"


@dataclass(frozen=True, slots=True)
class GeoPoint:
    """좌표. 범위를 벗어난 인스턴스는 생성 자체가 불가능."""

    lat: float
    lng: float

    def __post_init__(self) -> None:
        if not -90.0 <= self.lat <= 90.0:
            raise ValueError(f"lat out of range [-90, 90]: {self.lat}")
        if not -180.0 <= self.lng <= 180.0:
            raise ValueError(f"lng out of range [-180, 180]: {self.lng}")

    def to_dict(self) -> dict:
        return {"lat": self.lat, "lng": self.lng}

    @classmethod
    def from_dict(cls, d: dict) -> "GeoPoint":
        return cls(lat=d["lat"], lng=d["lng"])
