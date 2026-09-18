"""FakeEmbedding — EmbeddingPort의 결정론 해시 벡터 fake (business-logic-model.md §4).

sha256(text) → random.Random(seed) → 가우시안 dim개 → L2 정규화.
성질: ① 같은 텍스트 → 같은 벡터 ② 차원 = dim(기본 1024, AI-D06) ③ 단위 노름
④ 외부 의존 0 — stdlib 해시만, 실 API 호출 0건 (D37).

한계 (필독): 해시 기반이라 **의미 유사도 없음** — 비슷한 문장이 비슷한 벡터가 되지 않는다.
유사도 시나리오 테스트(질문뱅크 T_high/T_mid 판정 등)는 InMemoryVectorStore에
**벡터를 직접 주입**해 구성한다. FakeEmbedding은 동일 텍스트 매칭·왕복·차원 검증 전용.
"""

from __future__ import annotations

import hashlib
import math
import random
from collections.abc import Sequence


class FakeEmbedding:
    """EmbeddingPort Protocol 만족. 같은 텍스트 → 같은 벡터 (결정론)."""

    model_id = "fake-hash"  # collection 이름에 들어간다 — 실모델과 절대 안 섞이게

    def __init__(self, dim: int = 1024) -> None:
        self.dim = dim

    def embed(self, text: str) -> tuple[float, ...]:
        seed = int.from_bytes(hashlib.sha256(text.encode("utf-8")).digest(), "big")
        rng = random.Random(seed)
        raw = [rng.gauss(0.0, 1.0) for _ in range(self.dim)]
        norm = math.sqrt(sum(x * x for x in raw))
        if norm == 0.0:  # dim개 가우시안이 전부 0일 확률은 사실상 0이지만 0-나눗셈은 구조적으로 차단
            raw[0] = 1.0
            norm = 1.0
        return tuple(x / norm for x in raw)

    def embed_batch(self, texts: Sequence[str]) -> tuple[tuple[float, ...], ...]:
        return tuple(self.embed(t) for t in texts)
