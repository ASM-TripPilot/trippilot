"""LLM 결과 도메인 타입 (domain-entities.md §6).

CandidatePool = INV-1(closed-set)의 U1 강제 지점:
`poi_ids == {p.poi_id for p in pois}`를 post-init에서 검증 —
풀 내용과 id 인덱스가 어긋난 인스턴스는 존재 자체가 불가능하다 (business-rules.md §1).

TypedResult(관측 call_record 첨부)는 observability 모듈과 함께 후속 단계에서 추가.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Generic, TypeVar

from trippilot.domain.common import PoiId
from trippilot.domain.poi import Poi
from trippilot.domain.serialization import from_iso, to_iso

if TYPE_CHECKING:
    # 타입 힌트 전용 — TypedResult.call_record는 직렬화하지 않으므로 런타임 import 불필요.
    # (순환 import 방지: llm → observability → itinerary → llm 고리 차단)
    from trippilot.domain.observability import LlmCallRecord

T = TypeVar("T")


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
        }

    @classmethod
    def from_dict(cls, d: dict) -> "CandidatePool":
        return cls(
            poi_ids=frozenset(PoiId(x) for x in d["poi_ids"]),
            pois=tuple(Poi.from_dict(x) for x in d["pois"]),
            generated_at=from_iso(d["generated_at"]),
        )
