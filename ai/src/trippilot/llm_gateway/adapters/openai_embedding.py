"""OpenAiEmbeddingAdapter — EmbeddingPort의 OpenAI 호환 /embeddings 구현 (TRIP-426).

클라이언트는 생성자 주입 — SDK 클라이언트 생성은 조립 진입점(main.py) 소유
(OpenAIAdapter·TRIP-340과 동형). 본 모듈은 openai를 import하지 않는다.

차원은 1024 고정(AI-D06)이라 요청에 `dimensions`를 명시한다 — text-embedding-3
계열은 축소 차원을 지원한다. 응답 벡터 길이 ≠ dim은 BR-AF-09 위반이라 즉시
예외로 드러낸다(조용히 자르거나 패딩하면 저장된 벡터 공간이 오염된다).
"""

from __future__ import annotations

from collections.abc import Sequence

_DEFAULT_MODEL = "text-embedding-3-small"


class OpenAiEmbeddingAdapter:
    """EmbeddingPort Protocol 만족. `client`는 openai.OpenAI 호환."""

    def __init__(self, client, model: str = _DEFAULT_MODEL, dim: int = 1024) -> None:
        self._client = client
        self._model = model
        self.dim = dim

    def embed(self, text: str) -> tuple[float, ...]:
        return self.embed_batch([text])[0]

    def embed_batch(self, texts: Sequence[str]) -> tuple[tuple[float, ...], ...]:
        if not texts:
            return ()
        response = self._client.embeddings.create(
            model=self._model, input=list(texts), dimensions=self.dim
        )
        # index 기준 재정렬 — 계약상 입력 순서이지만 필드가 있는 이상 그것을 정본으로 쓴다.
        by_index = {item.index: item.embedding for item in response.data}
        if set(by_index) != set(range(len(texts))):
            raise ValueError(f"임베딩 응답 개수 불일치: {len(by_index)} != {len(texts)}")
        vectors = tuple(tuple(float(x) for x in by_index[i]) for i in range(len(texts)))
        for v in vectors:
            if len(v) != self.dim:
                raise ValueError(f"임베딩 차원 위반(BR-AF-09): {len(v)} != {self.dim}")
        return vectors
