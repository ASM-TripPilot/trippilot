"""LLM 결과 도메인 타입 (domain-entities.md §6).

CandidatePool = INV-1(closed-set)의 U1 강제 지점:
`poi_ids == {p.poi_id for p in pois}`를 post-init에서 검증 —
풀 내용과 id 인덱스가 어긋난 인스턴스는 존재 자체가 불가능하다 (business-rules.md §1).

TypedResult(관측 call_record 첨부)는 observability 모듈과 함께 후속 단계에서 추가.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Generic, TypeVar

from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.poi import Poi
from trippilot.domain.serialization import from_iso, to_iso

if TYPE_CHECKING:
    # 타입 힌트 전용 — TypedResult.call_record는 직렬화하지 않으므로 런타임 import 불필요.
    # (순환 import 방지: llm → observability → itinerary → llm 고리 차단)
    from trippilot.domain.observability import LlmCallRecord

T = TypeVar("T")


class LlmFeature(Enum):
    """LLM에 허용된 기능 자체가 closed-set (U4 FD domain-entities §1).

    이 enum 밖의 LLM 호출은 존재할 수 없다 (BR-U4-05) — "제한된 소형 LLM"
    4겹 장치의 1겹. 게이트웨이가 호출 진입에서 타입 검증한다.
    """

    PREFERENCE_SCORING = "PREFERENCE_SCORING"  # U4
    INTENT = "INTENT"  # U5
    PARAPHRASE = "PARAPHRASE"  # U5
    REASON_INTERPRETATION = "REASON_INTERPRETATION"  # U5
    EXPLANATION = "EXPLANATION"  # U5
    ALTERNATIVE_SELECTION = "ALTERNATIVE_SELECTION"  # U5
    REFLECTION = "REFLECTION"  # U6
    PLACE_EXTRACTION = "PLACE_EXTRACTION"  # U6 (백그라운드)


class ModelTier(Enum):
    """모델 티어 (AI-D06). 실제 model_id 문자열은 항상 C1Config 설정값 —
    코드 하드코딩 금지 (BR-U4-08). OFFLINE은 배치·회귀 전용."""

    LIGHT = "LIGHT"
    HEAVY = "HEAVY"
    OFFLINE = "OFFLINE"


@dataclass(frozen=True, slots=True)
class ScoredPoi:
    """선호 점수가 매겨진 POI. poi_id ∈ candidate_pool (INV-1, 게이트가 강제)."""

    poi_id: PoiId
    score: float
    is_llm_score: bool

    def to_dict(self) -> dict:
        return {
            "poi_id": str(self.poi_id),
            "score": self.score,
            "is_llm_score": self.is_llm_score,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ScoredPoi":
        return cls(
            poi_id=PoiId(d["poi_id"]),
            score=d["score"],
            is_llm_score=d["is_llm_score"],
        )


@dataclass(frozen=True, slots=True)
class PoiExplanation:
    """슬롯별 추천 이유 (프롬프트 정본 §2.2). poi_id ∈ pool (게이트가 강제, INV-1)."""

    poi_id: PoiId
    text: str

    def to_dict(self) -> dict:
        return {"poi_id": str(self.poi_id), "text": self.text}

    @classmethod
    def from_dict(cls, d: dict) -> "PoiExplanation":
        return cls(poi_id=PoiId(d["poi_id"]), text=d["text"])


class Mood(Enum):
    """회고 무드 (프롬프트 정본 §2.3 OutputSchema)."""

    GREAT = "GREAT"
    GOOD = "GOOD"
    OKAY = "OKAY"
    TIRED = "TIRED"


@dataclass(frozen=True, slots=True)
class ReflectionDraft:
    """당일 회고 초안 (프롬프트 정본 §2.3). 실패 시 FallbackCard 구성은 호출측."""

    title: str
    body: str
    highlights: tuple[str, ...]
    mood: Mood

    def to_dict(self) -> dict:
        return {
            "title": self.title,
            "body": self.body,
            "highlights": list(self.highlights),
            "mood": self.mood.value,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ReflectionDraft":
        return cls(
            title=d["title"],
            body=d["body"],
            highlights=tuple(d["highlights"]),
            mood=Mood(d["mood"]),
        )


@dataclass(frozen=True, slots=True)
class TypedResult(Generic[T]):
    """LLM 호출 결과 래퍼. 성공/폴백 무관 call_record 첨부 (NFR-7.1) —
    소비 측이 계측 여부를 선택할 수 없게 한다.

    불변식: is_fallback=True → value=None (business-rules.md §1).
    """

    value: T | None
    is_fallback: bool
    error: str | None
    call_record: LlmCallRecord | None

    def __post_init__(self) -> None:
        if self.is_fallback and self.value is not None:
            raise ValueError("is_fallback=True면 value는 None이어야 함 (INV-4)")


@dataclass(frozen=True, slots=True)
class CandidatePool:
    """closed-set 후보 풀. frozenset으로 O(1) 멤버십 (INV-1 판정 기반)."""

    poi_ids: frozenset[PoiId]
    pois: tuple[Poi, ...]
    generated_at: datetime  # tz-aware
    anchor: GeoPoint | None = None      # 풀 생성 기준점 (ai-data-design §3.3, U3 보강)
    radius_km: float | None = None      # 적용 반경 (다일 ×0.7 반영 후)

    def __post_init__(self) -> None:
        if self.generated_at.tzinfo is None:
            raise ValueError("generated_at는 tz-aware여야 함")
        if self.poi_ids != {p.poi_id for p in self.pois}:
            raise ValueError(
                "INV-1 위반: poi_ids 인덱스와 pois의 실제 id 집합이 불일치"
            )

    def contains(self, poi_id: PoiId) -> bool:
        """O(1) 멤버십 — 게이트가 이걸로 화이트리스트 교차 (INV-1)."""
        return poi_id in self.poi_ids

    def to_dict(self) -> dict:
        return {
            "poi_ids": sorted(str(x) for x in self.poi_ids),
            "pois": [p.to_dict() for p in self.pois],
            "generated_at": to_iso(self.generated_at),
            "anchor": self.anchor.to_dict() if self.anchor else None,
            "radius_km": self.radius_km,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "CandidatePool":
        return cls(
            poi_ids=frozenset(PoiId(x) for x in d["poi_ids"]),
            pois=tuple(Poi.from_dict(x) for x in d["pois"]),
            generated_at=from_iso(d["generated_at"]),
            anchor=GeoPoint.from_dict(d["anchor"]) if d.get("anchor") else None,
            radius_km=d.get("radius_km"),
        )
