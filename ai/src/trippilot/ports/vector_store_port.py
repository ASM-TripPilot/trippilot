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
    def search(
        self,
        collection: str,
        vector: tuple[float, ...],
        top_k: int,
        *,
        item_ids: frozenset[str] | None = None,
    ) -> tuple[VectorHit, ...]:
        """`item_ids` 가 주어지면 **그 집합 안에서만** 상위 top_k 를 고른다.

        닫힌 집합(INV-1) 때문에 필요하다 — `poi_desc` 처럼 POI 단위로 쌓이는 collection 은
        전역 검색하면 **지금 후보 풀에 없는 POI** 의 설명이 상위로 올라온다. 그걸 프롬프트에
        실으면 모델에게 풀 밖을 고르라고 권하는 셈이고(게이트가 잡아도 호출은 버려진다),
        애초에 줄 이유가 없는 정보다. 필터는 검색 **전에** 걸어야 top_k 가 풀 안에서 채워진다.

        `None` 이면 필터 없음. 빈 frozenset 은 "아무것도 안 맞음"이라 빈 결과다 —
        `None` 과 구분된다.
        """
        ...
    def delete(self, collection: str, item_id: str) -> None: ...
