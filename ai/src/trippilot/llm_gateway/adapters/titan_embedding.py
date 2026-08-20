"""TitanEmbeddingAdapter — EmbeddingPort의 Titan Embeddings v2 구현 (TRIP-426, 정본 AI-D).

클라이언트는 생성자 주입 — boto3 bedrock-runtime 클라이언트 생성은 조립 진입점
소유이고 본 모듈은 boto3를 import하지 않는다(벤더 SDK 격리, BR-U4-10 동형).
boto3는 프로젝트 의존성에 없다 — Titan 배선을 켜는 환경만 설치한다.

Titan v2는 단건 API라 embed_batch는 순차 루프다(벤더 배치 API 없음).
`normalize: true`로 단위 벡터를 받는다 — 코사인 검색 전제(InMemory fake와 동형).
차원 위반(≠ dim)은 BR-AF-09 — 즉시 예외.
"""

from __future__ import annotations

import json
from collections.abc import Sequence

_DEFAULT_MODEL_ID = "amazon.titan-embed-text-v2:0"


class TitanEmbeddingAdapter:
    """EmbeddingPort Protocol 만족. `client`는 boto3 bedrock-runtime 호환."""

    def __init__(self, client, model_id: str = _DEFAULT_MODEL_ID, dim: int = 1024) -> None:
        self._client = client
        self._model_id = model_id
        self.dim = dim

    def embed(self, text: str) -> tuple[float, ...]:
        response = self._client.invoke_model(
            modelId=self._model_id,
            body=json.dumps(
                {"inputText": text, "dimensions": self.dim, "normalize": True}
            ),
            contentType="application/json",
            accept="application/json",
        )
        payload = json.loads(response["body"].read())
        vector = tuple(float(x) for x in payload["embedding"])
        if len(vector) != self.dim:
            raise ValueError(f"임베딩 차원 위반(BR-AF-09): {len(vector)} != {self.dim}")
        return vector

    def embed_batch(self, texts: Sequence[str]) -> tuple[tuple[float, ...], ...]:
        return tuple(self.embed(t) for t in texts)
