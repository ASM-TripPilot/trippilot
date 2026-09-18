"""로컬 KURE 임베딩 조립 — 수동 스크립트 공용 (trace_intents · check_intent_bank).

라우터·뱅크·평가셋이 같은 모델로 임베딩돼야 점수가 비교 가능하다(적재와 질의가 다른 모델이면
1024차원이 같아도 공간이 다르다 — 팀 결정 2026-08-22). 그래서 조립 규칙을 한 곳에 둔다.
sentence-transformers 는 의존성에 없다(의도) — `uv pip install sentence-transformers`, uv sync 하면 지워진다.
"""

from __future__ import annotations

import os


def build_local_embedding():
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        raise SystemExit("sentence-transformers 미설치 — `uv pip install sentence-transformers`")
    from trippilot.llm_gateway.adapters.sentence_transformer_embedding import (
        DEFAULT_MODEL,
        SentenceTransformerEmbeddingAdapter,
    )

    model = os.environ.get("TRIPPILOT_EMBEDDING_MODEL") or DEFAULT_MODEL
    return SentenceTransformerEmbeddingAdapter(SentenceTransformer(model), model_id=model)
