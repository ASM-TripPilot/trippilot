"""EmbeddingPort — 텍스트 임베딩 콘센트 (agent-foundation business-logic-model.md §4).

차원은 1024 고정 (AI-D06 — e5-large/BGE-M3 계열). 반환 벡터 길이 ≠ dim은 BR-AF-09 위반.
실 구현은 U6 — 포트는 stdlib만 (test_architecture.py의 ports 순수성 규칙이 자동 커버).
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol


class EmbeddingPort(Protocol):
    dim: int  # 1024 고정 (AI-D06, BR-AF-09)
    # 이 구현이 쓰는 임베딩 모델의 식별자. **collection 이름에 들어간다** —
    # 모델이 바뀌면 다른 collection 에 쓰게 되어, 옛 색인을 새 모델로 질의하면
    # 엉터리 결과가 아니라 0건이 나온다(TRIP-519). 벡터 공간은 모델마다 달라서
    # 섞이면 검색이 조용히 무의미해지는데, 차원이 같으면 아무 검사도 이걸 못 잡는다.
    model_id: str

    def embed(self, text: str) -> tuple[float, ...]: ...  # len == dim 보장
    def embed_batch(self, texts: Sequence[str]) -> tuple[tuple[float, ...], ...]: ...
