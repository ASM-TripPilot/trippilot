"""M7 도메인 타입 (U3 FD domain-entities §2·§3, ai-data-design §3·§8).

CandidatePoolRequest = 풀 생성 입력 (여행 조건).
EntityMatch = 엔티티 해소 결과 (AI-D04 — 결정론 fuzzy, LLM 아님).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum

from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId, TransportMode


@dataclass(frozen=True, slots=True)
class CandidatePoolRequest:
    anchor: GeoPoint
    dates: tuple[date, ...]
    budget: BudgetLevel
    transport: TransportMode
    radius_override_km: float | None = None

    def __post_init__(self) -> None:
        if not self.dates:
            raise ValueError("dates는 최소 1일")
        if self.radius_override_km is not None and self.radius_override_km <= 0:
            raise ValueError("radius_override_km 양수 필요")

    def to_dict(self) -> dict:
        return {
            "anchor": self.anchor.to_dict(),
            "dates": [d.isoformat() for d in self.dates],
            "budget": self.budget.value,
            "transport": self.transport.value,
            "radius_override_km": self.radius_override_km,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "CandidatePoolRequest":
        return cls(
            anchor=GeoPoint.from_dict(d["anchor"]),
            dates=tuple(date.fromisoformat(x) for x in d["dates"]),
            budget=BudgetLevel(d["budget"]),
            transport=TransportMode(d["transport"]),
            radius_override_km=d.get("radius_override_km"),
        )


class MatchDecision(Enum):
    AUTO = "AUTO"            # 자동 확정 (조용히 고치는 게 아니라 임계 이상 확신)
    CONFIRM = "CONFIRM"      # 사용자 확인 필요 ("'강능'을 강릉으로 이해했는데 맞나요?")
    UNRESOLVED = "UNRESOLVED"  # M7에 없음 → 웹 소싱(AI-D03, U6)으로 위임


@dataclass(frozen=True, slots=True)
class EntityMatch:
    poi_id: PoiId | None
    matched_name: str | None
    confidence: float  # 0.0 ~ 1.0
    decision: MatchDecision

    def __post_init__(self) -> None:
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError(f"confidence 범위 밖: {self.confidence}")
        if (self.poi_id is None) != (self.decision is MatchDecision.UNRESOLVED):
            raise ValueError("poi_id=None ⇔ decision=UNRESOLVED (정합 위반)")

    def to_dict(self) -> dict:
        return {
            "poi_id": str(self.poi_id) if self.poi_id is not None else None,
            "matched_name": self.matched_name,
            "confidence": self.confidence,
            "decision": self.decision.value,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "EntityMatch":
        return cls(
            poi_id=PoiId(d["poi_id"]) if d["poi_id"] is not None else None,
            matched_name=d["matched_name"],
            confidence=d["confidence"],
            decision=MatchDecision(d["decision"]),
        )
