"""InMemoryVectorStore — VectorStorePort의 dict 기반 fake (business-logic-model.md §4).

코사인 전수 스캔. top-k는 score 내림차순, 동점은 item_id 사전순 — 결정론.
실 구현은 pgvector (U6). 차원 불일치 벡터는 ValueError로 즉시 드러낸다 (침묵 실패 금지, INV-4).
"""

from __future__ import annotations

import math

from trippilot.ports.vector_store_port import VectorHit


def _cosine(a: tuple[float, ...], b: tuple[float, ...]) -> float:
    if len(a) != len(b):
        raise ValueError(f"벡터 차원 불일치: {len(a)} != {len(b)}")
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


class InMemoryVectorStore:
    def __init__(self) -> None:
        # collection → item_id → (vector, payload)
        self._collections: dict[str, dict[str, tuple[tuple[float, ...], dict]]] = {}

    def upsert(self, collection: str, item_id: str, vector: tuple[float, ...], payload: dict) -> None:
        self._collections.setdefault(collection, {})[item_id] = (tuple(vector), payload)

    def search(self, collection: str, vector: tuple[float, ...], top_k: int) -> tuple[VectorHit, ...]:
        items = self._collections.get(collection, {})
        hits = [
            VectorHit(item_id=item_id, score=_cosine(vector, stored), payload=payload)
            for item_id, (stored, payload) in items.items()
        ]
        hits.sort(key=lambda h: (-h.score, h.item_id))  # score 내림차순, 동점은 item_id 사전순 (결정론)
        return tuple(hits[: max(top_k, 0)])

    def delete(self, collection: str, item_id: str) -> None:
        self._collections.get(collection, {}).pop(item_id, None)
