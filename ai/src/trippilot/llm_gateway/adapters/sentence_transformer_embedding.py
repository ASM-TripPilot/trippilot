"""SentenceTransformerEmbeddingAdapter — EmbeddingPort의 로컬 모델 구현 (KURE-v1 기본).

모델은 생성자 주입 — `SentenceTransformer` 로드는 조립 진입점(스모크 스크립트·main)
소유이고 본 모듈은 sentence_transformers 를 import 하지 않는다(벤더 SDK 격리,
Titan·OpenAI 어댑터와 동형). **sentence-transformers 는 프로젝트 의존성에 없다** —
로컬 임베딩을 켜는 환경만 설치한다(boto3 선례).

기본 모델 `nlpai-lab/KURE-v1`(MIT)을 고른 이유:
- **1024차원 네이티브** — `kb_vectors` DDL 의 `vector(1024)` 를 안 건드린다.
- **질의/문서 프리픽스가 없다** — `EmbeddingPort` 가 `embed(text)` 하나뿐이라 질의와
  문서를 구분할 자리가 없다. 프리픽스를 요구하는 모델(arctic-embed-l-v2.0-ko·
  Qwen3-Embedding 등)은 한국어 점수가 더 높아도 지금 포트에 못 들어간다 —
  포트에 질의/문서 구분이 생기면 그때 후보가 된다.
- bge-m3 를 한국어 질의-문서 200만 쌍으로 파인튜닝 → 베이스보다 한국어 recall 이 높다.

`normalize_embeddings=True` 로 단위 벡터를 받는다 — 코사인 검색 전제(Titan `normalize`,
InMemory fake 와 동형). 차원 위반(≠ dim)은 BR-AF-09 — 즉시 예외(조용히 자르거나
패딩하면 저장된 벡터 공간이 오염된다).
"""

from __future__ import annotations

from collections.abc import Sequence

DEFAULT_MODEL = "nlpai-lab/KURE-v1"


class SentenceTransformerEmbeddingAdapter:
    """EmbeddingPort Protocol 만족. `model`은 sentence_transformers.SentenceTransformer 호환."""

    def __init__(self, model, dim: int = 1024) -> None:
        self._model = model
        self.dim = dim

    def embed(self, text: str) -> tuple[float, ...]:
        return self.embed_batch([text])[0]

    def embed_batch(self, texts: Sequence[str]) -> tuple[tuple[float, ...], ...]:
        if not texts:
            return ()
        raw = self._model.encode(list(texts), normalize_embeddings=True)
        vectors = tuple(tuple(float(x) for x in vector) for vector in raw)
        if len(vectors) != len(texts):
            raise ValueError(f"임베딩 개수 불일치: {len(vectors)} != {len(texts)}")
        for vector in vectors:
            if len(vector) != self.dim:
                raise ValueError(f"임베딩 차원 위반(BR-AF-09): {len(vector)} != {self.dim}")
        return vectors
