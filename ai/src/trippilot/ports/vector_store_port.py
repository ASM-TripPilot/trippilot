"""VectorStorePort + VectorHit — 벡터 검색 콘센트 (business-logic-model.md §4, domain-entities.md §4).

collection 초기 3종: `intent_bank`(EP-8, 질문뱅크) · `persona`(KB-2) · `poi_desc`.
실 구현은 pgvector (U6) — 포트는 stdlib만.
포트 모듈 내 dataclass 정의는 llm_port.py(LlmRequest/LlmResponse) 선례를 따른다.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class VectorHit:
    """PersonaContext.preference_vector_hits·질문뱅크 top-k가 공유하는 단일 히트 타입."""

    item_id: str
    score: float
    payload: dict


class VectorStorePort(Protocol):
    def upsert(self, collection: str, item_id: str, vector: tuple[float, ...], payload: dict) -> None: ...
    def search(self, collection: str, vector: tuple[float, ...], top_k: int) -> tuple[VectorHit, ...]: ...
    def delete(self, collection: str, item_id: str) -> None: ...
