"""EmbeddingPort — 텍스트 임베딩 콘센트 (agent-foundation business-logic-model.md §4).

차원은 1024 고정 (AI-D06 — e5-large/BGE-M3 계열). 반환 벡터 길이 ≠ dim은 BR-AF-09 위반.
실 구현은 U6 — 포트는 stdlib만 (test_architecture.py의 ports 순수성 규칙이 자동 커버).
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol


class EmbeddingPort(Protocol):
    dim: int  # 1024 고정 (AI-D06, BR-AF-09)

    def embed(self, text: str) -> tuple[float, ...]: ...  # len == dim 보장
    def embed_batch(self, texts: Sequence[str]) -> tuple[tuple[float, ...], ...]: ...
