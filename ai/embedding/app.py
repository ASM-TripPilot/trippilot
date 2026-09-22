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

## 내부 구현은 둘, 표면은 하나

`EMBEDDING_BACKEND` 로 가른다 — 기본은 `sentence-transformers`(현행), `triton` 은
같은 모델을 ONNX 로 내보내 Triton(ORT 백엔드)에서 인코더만 돌린다. **바뀌는 것은
벡터를 구하는 방법뿐이고 `/embed` 의 계약도 `model`·`dim` 값도 같다.** 백엔드에 따라
`model` 을 다르게 실으면 호출측이 그걸 모델 교체로 읽고 전량 재적재를 요구한다.

## 이 서비스가 하지 않는 것

- 적재·검색 — 벡터 스토어는 `ai-vectordb` 소유다. 여기는 텍스트→벡터 변환만 한다.
- 폴백 — 모델 로드 실패는 기동 실패다(설정 버그). 런타임 실패는 호출측이 강등한다.
  여기서 0벡터 같은 걸 돌려주면 그게 바로 "조용한 엉터리"가 된다.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import urllib.request

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

# ## 백엔드 선택 — 표면은 그대로, 내부만 가른다 (임베딩 서빙 A/B)
#
# `sentence-transformers`(기본)는 지금 돌고 있는 경로다. `triton` 은 같은 모델을
# ONNX 로 내보내 Triton(ORT 백엔드)에서 인코더만 돌리고, **토크나이즈·풀링·정규화는
# 여기서** 한다. 어느 쪽이든 `/embed` 응답의 `model`·`dim` 은 같은 값이어야 한다 —
# 호출측(HttpEmbeddingAdapter)이 그걸 읽고 거부하는 것이 모델 불일치의 유일한 방벽이다.
BACKEND = os.environ.get("EMBEDDING_BACKEND") or "sentence-transformers"
if BACKEND not in ("sentence-transformers", "triton"):
    # 오타를 조용히 기본값으로 흘리지 않는다. `EMBEDDING_BACKEND=tirton` 이 기존
    # 경로로 떨어지면 "Triton 을 띄웠는데 아무것도 안 달라졌다"로 한참 헤맨다.
    raise RuntimeError(
        f"EMBEDDING_BACKEND={BACKEND!r} — 'sentence-transformers' 또는 'triton'"
    )
TRITON_URL = (os.environ.get("TRITON_URL") or "http://localhost:8000").rstrip("/")
TRITON_MODEL = os.environ.get("TRITON_MODEL") or "kure_encoder"
# config.pbtxt 의 max_batch_size 와 맞춘다 — 넘겨 보내면 Triton 이 요청을 거절한다.
TRITON_MAX_BATCH = int(os.environ.get("TRITON_MAX_BATCH") or "32")
TRITON_TIMEOUT = float(os.environ.get("TRITON_TIMEOUT") or "30")
# KURE-v1 `sentence_bert_config.json` 의 max_seq_length.
MAX_SEQ_LENGTH = int(os.environ.get("EMBEDDING_MAX_SEQ_LENGTH") or "8192")

_model = None
_tokenizer = None
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


def _load_tokenizer():
    """Triton 경로의 토크나이저 — 가중치는 안 읽는다(수십 MB).

    `MODEL_PATH` 가 있으면 거기서 읽는다. 구운 디렉토리에는 fp16 가중치와 함께
    토크나이저 파일도 들어 있고, 오프라인 이미지에서는 그 경로만 쓸 수 있다.
    """
    global _tokenizer
    with _lock:
        if _tokenizer is not None:
            return _tokenizer
        from transformers import AutoTokenizer

        source = MODEL_PATH or MODEL_NAME
        _tokenizer = AutoTokenizer.from_pretrained(source)
        logger.info("토크나이저 로드 완료: %s", source)
        return _tokenizer


def _triton_infer(input_ids, attention_mask):
    """Triton KServe v2 `infer` — **바이너리 텐서 확장**으로 부른다.

    JSON 으로 주고받으면 안 된다. 출력이 `last_hidden_state` [batch, seq, 1024]
    fp32 라 배치 32·길이 64 만 해도 800만 개 실수다 — JSON 직렬화가 추론보다
    오래 걸려서 "Triton 이 느리다"는 **측정 착시**가 생긴다.

    와이어: `JSON 헤더 + 원시 바이트`, 경계는 `Inference-Header-Content-Length`.
    """
    import numpy as np

    inputs, chunks = [], []
    for name, arr in (("input_ids", input_ids), ("attention_mask", attention_mask)):
        raw = np.ascontiguousarray(arr, dtype=np.int64).tobytes()
        chunks.append(raw)
        inputs.append(
            {
                "name": name,
                "shape": list(arr.shape),
                "datatype": "INT64",
                "parameters": {"binary_data_size": len(raw)},
            }
        )
    header = json.dumps(
        {
            "inputs": inputs,
            "outputs": [
                {"name": "last_hidden_state", "parameters": {"binary_data": True}}
            ],
        }
    ).encode()

    request = urllib.request.Request(
        f"{TRITON_URL}/v2/models/{TRITON_MODEL}/infer",
        data=header + b"".join(chunks),
        headers={
            "Inference-Header-Content-Length": str(len(header)),
            "Content-Type": "application/octet-stream",
        },
    )
    with urllib.request.urlopen(request, timeout=TRITON_TIMEOUT) as response:
        payload = response.read()
        header_len = int(response.headers["Inference-Header-Content-Length"])
    shape = json.loads(payload[:header_len])["outputs"][0]["shape"]
    return np.frombuffer(payload[header_len:], dtype=np.float32).reshape(shape)


def _embed_triton(texts: list[str]) -> list[list[float]]:
    """토크나이즈 → Triton(인코더) → **CLS 풀링** → L2 정규화.

    ## 풀링이 이 함수의 전부다

    KURE-v1 은 `1_Pooling/config.json` 이 `pooling_mode_cls_token: true` 인
    **CLS 풀링**이다(sentence-transformers 6.x 에서는 `pooling_mode: "cls"`).
    mean 으로 잘못 구현해도 차원은 1024 그대로라 `dim` 검사도, 호출측 검증도,
    어떤 테스트도 못 잡는다 — 검색 순위만 조용히 무너진다. 실측으로 mean 을 쓰면
    기존 경로와 코사인이 0.71 까지 떨어진다.

    ## 길이순 정렬

    sentence-transformers 의 `encode` 가 하는 것과 같다. 안 하면 짧은 문장이 같은
    배치의 긴 문장 길이만큼 패딩돼 **없는 연산을 한다** — 백엔드 비교가 패딩 낭비
    비교로 바뀐다. 정렬은 배치 구성에만 쓰고 결과는 원래 순서로 되돌린다.
    """
    import numpy as np

    tokenizer = _load_tokenizer()
    order = sorted(range(len(texts)), key=lambda i: -len(texts[i]))
    out: list[list[float]] = [[] for _ in texts]

    for start in range(0, len(order), TRITON_MAX_BATCH):
        slots = order[start : start + TRITON_MAX_BATCH]
        encoded = tokenizer(
            [texts[i] for i in slots],
            padding=True,
            truncation=True,
            max_length=MAX_SEQ_LENGTH,
            return_tensors="np",
        )
        hidden = _triton_infer(encoded["input_ids"], encoded["attention_mask"])
        if hidden.shape[-1] != EXPECTED_DIM:
            # 조용히 내보내면 적재 벡터와 공간이 어긋난 채로 서비스한다(BR-AF-09).
            raise RuntimeError(f"Triton 출력 차원 {hidden.shape[-1]} != {EXPECTED_DIM}")
        cls = hidden[:, 0]  # CLS = 0번 토큰
        vectors = cls / np.linalg.norm(cls, axis=1, keepdims=True)
        for slot, vector in zip(slots, vectors):
            out[slot] = [float(x) for x in vector]
    return out


def _encode(texts: list[str]) -> list[list[float]]:
    """백엔드 분기 지점 — 여기 말고는 두 경로가 만나지 않는다."""
    if BACKEND == "triton":
        return _embed_triton(texts)
    vectors = _load().encode(texts, normalize_embeddings=True, show_progress_bar=False)
    return [[float(x) for x in v] for v in vectors]


class EmbedRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    texts: list[str] = Field(min_length=1)


class EmbedResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    vectors: list[list[float]]
    dim: int
    model: str


app = FastAPI(title="TripPilot Embedding", version="1.0.0")


@app.on_event("startup")
def _warm() -> None:
    """기동 직후 백그라운드로 모델을 읽어 둔다 — **첫 요청이 손해 보지 않게.**

    실측(2026-09-02): 워밍 없이 띄우면 첫 alternatives 요청이 콜드스타트 3.5초를
    물어 임베딩 상한(3초)을 넘기고, KB 검색 하나가 `EmbeddingUnreachable: timed out`
    으로 강등됐다. 폴백이 받아 200 은 나가지만 **첫 사용자만 이유 없이 나쁜 답**을 본다.

    스레드로 도는 이유: 여기서 동기로 읽으면 컨테이너가 3.5초간 응답을 못 하고,
    그 사이 healthcheck 가 먼저 실패한다. `/health` 의 `loaded` 로 진행 상황이 보인다.
    실패해도 서비스는 뜬다 — 그때는 첫 요청이 다시 시도하고, 거기서도 실패하면
    호출측이 강등한다(INV-4). 여기서 기동을 죽이면 임베딩이 없어도 돌아야 하는
    AI 쪽 계약과 어긋난다.
    """

    def _run() -> None:
        try:
            # triton 경로는 여기서 2GB 짜리 torch 모델을 읽으면 안 된다 — 그걸 안
            # 읽는 것이 이 백엔드의 이유다. 토크나이저만 데우고 첫 추론을 한 번 돌려
            # ORT 의 지연 초기화까지 끝내 둔다.
            if BACKEND == "triton":
                _encode(["워밍업"])
            else:
                _load()
        except Exception:  # noqa: BLE001 — 기동을 막지 않는다
            logger.exception("모델 워밍 실패 — 첫 요청에서 다시 시도한다")

    threading.Thread(target=_run, name="embedding-warmup", daemon=True).start()


@app.get("/health")
def health() -> dict:
    """**모델 로드 완료를 기다리지 않는다** — 프로세스가 살아있는지만 본다.

    운영자 관측용이지 다른 서비스의 `depends_on` 대상이 아니다. AI 서비스는 임베딩
    없이도 돌아야 하고(UnwiredEmbedding 계약), 여기에 결합을 걸면 임베딩 컨테이너의
    재시작 루프가 일정 생성·회고까지 기동 실패로 끌고 간다.
    """
    loaded = _tokenizer is not None if BACKEND == "triton" else _model is not None
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "dim": EXPECTED_DIM,
        "loaded": loaded,
        "backend": BACKEND,
    }


@app.get("/model")
def model_info() -> dict:
    """호출측이 조립 시점에 대조할 수 있게 — 모델을 로드하지 않고 답한다."""
    return {"model": MODEL_NAME, "dim": EXPECTED_DIM}


@app.post("/embed", response_model=EmbedResponse)
def embed(request: EmbedRequest) -> EmbedResponse:
    if len(request.texts) > MAX_TEXTS:
        raise HTTPException(413, f"텍스트 {len(request.texts)}건 > 상한 {MAX_TEXTS}")
    # **백엔드가 무엇이든 model·dim 은 같은 값이다.** 이 둘이 백엔드에 따라 달라지면
    # 호출측 검증이 백엔드 교체를 "모델이 바뀌었다"로 읽고 전량 재적재를 요구한다.
    return EmbedResponse(
        vectors=_encode(request.texts),
        dim=EXPECTED_DIM,
        model=MODEL_NAME,
    )
