"""Plan-B RAG 지식베이스(KB) 도메인 타입 (planb-rag-design.md §2, epics S6.5).

정본이 규정한 KB는 3종이다:

| KB | 내용 | 정본상 저장 방식 |
|---|---|---|
| KB-1 SCHEDULE | 현재 일정 슬롯·고정 블록·방문 이력·변경 이력 | 구조화 DB (벡터 불필요) |
| KB-2 PERSONA | 저장 장소·방문 이력·선호 패턴·거절 이력 | 하이브리드 (집계 DB + 벡터) |
| KB-3 SITUATION | 트리거 사유·현재 위치·시각·날씨·POI 실시간 상태 | 실시간 API (짧은 캐시) |

**본 타입의 지위**: 3종 KB의 "검색 가능한 문서"를 하나의 모양으로 통일한 것.
1단계(TRIP-247)에서는 세 KB 모두 `VectorStorePort` 뒤의 collection으로 골격을 세우지만,
KB-1·KB-3의 정본 소스는 구조화 DB·실시간 API다 — 실 소스가 붙는 시점에도
`KbHit` 모양은 그대로 두어 파이프라인이 영향받지 않게 한다(교체 이음매).

**INV-1**: `poi_ref`는 `PoiId`가 아니라 **평문 str**이다. KB 검색 결과는 그 자체로
후보 자격을 만들지 않으며, `CandidatePool` 교차를 거쳐야만 `PoiId`가 된다
(교차 지점은 `agents/planb/rag.py`의 `closed_set_filter` 단 하나).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class KbKind(Enum):
    """Plan-B RAG의 KB 3종 (planb-rag-design.md §2)."""

    SCHEDULE = "SCHEDULE"  # KB-1
    PERSONA = "PERSONA"  # KB-2
    SITUATION = "SITUATION"  # KB-3


@dataclass(frozen=True, slots=True)
class KbDocument:
    """KB 적재 단위. `text`가 임베딩 대상, 나머지는 payload로 저장된다."""

    kb: KbKind
    doc_id: str
    text: str
    poi_ref: str | None  # POI 참조(있으면). PoiId 아님 — closed-set 교차 전에는 후보가 아니다
    metadata: dict  # JSON 원시값만

    def __post_init__(self) -> None:
        if not self.doc_id:
            raise ValueError("KbDocument.doc_id는 비어있을 수 없음")
        if not self.text.strip():
            raise ValueError(f"{self.doc_id}: 임베딩할 text가 비어있음")

    def payload(self) -> dict:
        """벡터 스토어 payload — 검색 측이 문서를 복원하는 데 필요한 것만."""
        return {
            "kb": self.kb.value,
            "text": self.text,
            "poi_ref": self.poi_ref,
            "metadata": dict(self.metadata),
        }

    def to_dict(self) -> dict:
        return {"doc_id": self.doc_id, **self.payload()}

    @classmethod
    def from_dict(cls, d: dict) -> "KbDocument":
        return cls(
            kb=KbKind(d["kb"]),
            doc_id=d["doc_id"],
            text=d["text"],
            poi_ref=d["poi_ref"],
            metadata=d["metadata"],
        )


@dataclass(frozen=True, slots=True)
class KbHit:
    """KB 검색 결과 1건. `kb`는 **요청한 KB**로 재태깅되어 있다 (collection 오염 방어)."""

    kb: KbKind
    doc_id: str
    score: float
    text: str
    poi_ref: str | None
    metadata: dict

    def to_dict(self) -> dict:
        return {
            "kb": self.kb.value,
            "doc_id": self.doc_id,
            "score": self.score,
            "text": self.text,
            "poi_ref": self.poi_ref,
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "KbHit":
        return cls(
            kb=KbKind(d["kb"]),
            doc_id=d["doc_id"],
            score=d["score"],
            text=d["text"],
            poi_ref=d["poi_ref"],
            metadata=d["metadata"],
        )
