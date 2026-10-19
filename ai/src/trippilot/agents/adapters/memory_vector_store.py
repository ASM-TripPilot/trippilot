"""InMemoryVectorStore — VectorStorePort 의 dict 기반 구현 (business-logic-model.md §4).

테스트 대역으로 시작했고 **운영에서도 쓴다** — 질문뱅크(485문장)는 기동 후 현재 임베딩 모델로
매번 새로 색인해 여기 담는다(`orchestrator/dialogue_interpreter.py`). 전수 스캔이 수백 건이면
질의당 1ms 남짓이고, 실 DB 에 쓰지 않으니 모델이 바뀌어도 섞인 벡터 공간이 생길 수 없다.

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

    def search(
        self,
        collection: str,
        vector: tuple[float, ...],
        top_k: int,
        *,
        item_ids: frozenset[str] | None = None,
    ) -> tuple[VectorHit, ...]:
        items = self._collections.get(collection, {})
        hits = [
            VectorHit(item_id=item_id, score=_cosine(vector, stored), payload=payload)
            for item_id, (stored, payload) in items.items()
            if item_ids is None or item_id in item_ids
        ]
        hits.sort(key=lambda h: (-h.score, h.item_id))  # score 내림차순, 동점은 item_id 사전순 (결정론)
        return tuple(hits[: max(top_k, 0)])

    def delete(self, collection: str, item_id: str) -> None:
        self._collections.get(collection, {}).pop(item_id, None)

    # 오프라인 적재 전용 — `PgVectorStore` 와 같은 의미(테스트가 적재 스크립트의 일괄 경로를 그대로 돈다).
    def upsert_many(self, collection: str, rows) -> None:
        for item_id, vector, payload in rows:
            self.upsert(collection, item_id, vector, payload)

    def delete_many(self, collection: str, item_ids) -> int:
        items = self._collections.get(collection, {})
        return sum(items.pop(i, None) is not None for i in list(item_ids))

    def item_ids_like(self, collection: str, pattern: str) -> frozenset[str]:
        import re
        rx = re.compile("^" + "".join(".*" if c == "%" else "." if c == "_" else re.escape(c)
                                      for c in pattern) + "$")
        return frozenset(i for i in self._collections.get(collection, {}) if rx.match(i))
