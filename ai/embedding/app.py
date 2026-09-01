"""임베딩 서비스 — KURE-v1 을 AI 컨테이너 밖으로 뺀다 (TRIP-517).

## 왜 분리하나

임베딩 모델은 2.1GB 다. 그걸 AI 이미지에 넣으면 FastAPI 경계 하나 고칠 때마다
2GB 이미지를 다시 굽는다. 그리고 실제로 안 넣어서 **KB 검색 3종이 컨테이너에서
404 로 죽어 있었다**(2026-09-01 발견) — 넣기도 안 넣기도 애매한 크기라 분리가 답이다.

## 계약

    POST /embed  {"texts": ["...", ...]}
      → {"vectors": [[...], ...], "dim": 1024, "model": "nlpai-lab/KURE-v1"}

**응답에 `model` 과 `dim` 을 반드시 싣는다.** 적재된 벡터와 다른 모델로 질의하면
검색이 조용히 엉터리가 되는데(팀 결정 2026-08-22 "provider 를 바꾸면 전량 재적재"),
컨테이너가 분리되면 호출측이 그걸 알 방법이 이것뿐이다. 싣기만 해서는 부족하고
**호출측(HttpEmbeddingAdapter)이 읽고 거부해야** 규칙이 강제된다.

## 이 서비스가 하지 않는 것

- 적재·검색 — 벡터 스토어는 `ai-vectordb` 소유다. 여기는 텍스트→벡터 변환만 한다.
- 폴백 — 모델 로드 실패는 기동 실패다(설정 버그). 런타임 실패는 호출측이 강등한다.
  여기서 0벡터 같은 걸 돌려주면 그게 바로 "조용한 엉터리"가 된다.
"""

from __future__ import annotations

import logging
import os
import threading

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger(__name__)

MODEL_NAME = os.environ.get("EMBEDDING_MODEL") or "nlpai-lab/KURE-v1"
# 이미지에 구워둔 fp16 가중치 경로. 있으면 그걸 쓰고(오프라인), 없으면 모델명으로
# 내려받는다 — 로컬 개발에서 Dockerfile 없이 돌릴 때를 위한 경로다.
MODEL_PATH = os.environ.get("EMBEDDING_MODEL_PATH") or ""
EXPECTED_DIM = int(os.environ.get("EMBEDDING_DIM") or "1024")  # BR-AF-09
# 한 요청의 텍스트 수 상한 — 무제한이면 한 호출이 워커를 오래 점유한다.
MAX_TEXTS = int(os.environ.get("EMBEDDING_MAX_TEXTS") or "256")

_model = None
_lock = threading.Lock()


def _load():
    """모델을 지연 로드한다 — import 시점에 1GB 를 읽으면 healthcheck 가 먼저 죽는다.

    가중치는 **이미지에 fp16 으로 구워져 있고**(Dockerfile `bake_model.py`), 여기서
    **fp32 로 되올려** 쓴다. CPU 에 fp16 고속 경로가 없어 그대로 쓰면 19배 느리다
    (TRIP-518 실측). 이 왕복의 손실은 검색 순위에 영향이 없다 — 코사인 1.00000,
    top4 24/24 위치 동일.
    """
    global _model
    with _lock:
        if _model is not None:
            return _model
        from sentence_transformers import SentenceTransformer

        source = MODEL_PATH or MODEL_NAME
        logger.info("모델 로드 시작: %s", source)
        model = SentenceTransformer(source, device="cpu")
        # 구워진 가중치는 fp16 이다 — 연산은 fp32 로 올린다.
        model[0].auto_model.float()
        dim = model.get_sentence_embedding_dimension()
        if dim != EXPECTED_DIM:
            # 설정 버그 — 조용히 뜨면 적재 벡터와 차원이 어긋난 채로 서비스한다.
            raise RuntimeError(f"모델 차원 {dim} != 기대 {EXPECTED_DIM} (BR-AF-09)")
        _model = model
        logger.info("모델 로드 완료: %s (dim=%d)", source, dim)
        return _model


class EmbedRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    texts: list[str] = Field(min_length=1)


class EmbedResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    vectors: list[list[float]]
    dim: int
    model: str


app = FastAPI(title="TripPilot Embedding", version="1.0.0")


@app.get("/health")
def health() -> dict:
    """**모델 로드 완료를 기다리지 않는다** — 프로세스가 살아있는지만 본다.

    운영자 관측용이지 다른 서비스의 `depends_on` 대상이 아니다. AI 서비스는 임베딩
    없이도 돌아야 하고(UnwiredEmbedding 계약), 여기에 결합을 걸면 임베딩 컨테이너의
    재시작 루프가 일정 생성·회고까지 기동 실패로 끌고 간다.
    """
    return {"status": "ok", "model": MODEL_NAME, "dim": EXPECTED_DIM, "loaded": _model is not None}


@app.get("/model")
def model_info() -> dict:
    """호출측이 조립 시점에 대조할 수 있게 — 모델을 로드하지 않고 답한다."""
    return {"model": MODEL_NAME, "dim": EXPECTED_DIM}


@app.post("/embed", response_model=EmbedResponse)
def embed(request: EmbedRequest) -> EmbedResponse:
    if len(request.texts) > MAX_TEXTS:
        raise HTTPException(413, f"텍스트 {len(request.texts)}건 > 상한 {MAX_TEXTS}")
    vectors = _load().encode(
        request.texts, normalize_embeddings=True, show_progress_bar=False
    )
    return EmbedResponse(
        vectors=[[float(x) for x in v] for v in vectors],
        dim=EXPECTED_DIM,
        model=MODEL_NAME,
    )
