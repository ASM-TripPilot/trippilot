"""임베딩 서빙 A/B — 현행(sentence-transformers) vs Triton(ONNX Runtime).

CI 밖 수동 실행 전용. 측정 규약은 `measure_embedding_precision.py`(TRIP-518)를
그대로 따른다 — **조건이 다르면 두 측정을 나란히 놓을 수 없다.**

- `torch.set_num_threads(4)` 고정. Triton 쪽도 같은 4스레드다
  (`config.pbtxt` 의 `intra_op_thread_count=4` · `instance_group.count=1`).
  이걸 안 맞추면 Triton 이 코어를 다 쓰고 "몇 배 빨라졌다"가 나오는데,
  그건 백엔드 비교가 아니라 스레드 수 비교다.
- 워밍업 2회 후 3회 중앙값.
- KB-3 시드(`data/planb_situation_kb.yaml`) 전건 인코딩 + 질의 6종.

## 채택 기준 — 동등성이 먼저다

지연이 아무리 좋아도 벡터가 다르면 채택 불가다. 적재된 벡터와 다른 공간으로
질의하면 검색이 **조용히** 엉터리가 된다(예외도 로그도 없다).
  - 문서벡터 코사인 ≥ 0.9999
  - top-4 순위 전부 동일

## 재현

    # 1) 임시 의존성 (프로젝트 의존성 아님 — pyproject 를 고치지 않는다)
    cd ai
    uv pip install sentence-transformers onnx onnxruntime

    # 2) ONNX 내보내기 + 모델 레포지토리 구성
    REPO=/tmp/kure_model_repo
    uv run python embedding/export_onnx.py "$REPO/kure_encoder/1"
    cp embedding/model_repo/kure_encoder/config.pbtxt "$REPO/kure_encoder/"

    # 3) Triton (arm64 네이티브 — 에뮬레이션으로 재면 숫자가 무의미하다)
    docker run -d --name trippilot-triton --platform linux/arm64 \
      -p 8000:8000 -v "$REPO":/models:ro \
      nvcr.io/nvidia/tritonserver:24.08-py3 \
      tritonserver --model-repository=/models

    # 4) 측정
    uv run python scripts/measure_triton_embedding.py

    # 5) 반드시 내린다 (이미지 20.7GB · 컨테이너가 메모리를 잡고 있다)
    docker rm -f trippilot-triton
"""

from __future__ import annotations

import os
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
# app.py 의 Triton 경로를 **그대로** 부른다 — 측정용으로 다시 구현하면 서비스가
# 쓰는 코드와 다른 것을 재게 된다(특히 풀링).
#
# **모델 레포지토리 디렉토리를 `triton` 으로 이름 짓지 마라.** sys.path 에 올라간
# 디렉토리 밑에 `triton/` 이 있으면 파이썬이 torch 가 쓰는 `triton` 패키지 대신
# 그걸 import 하고, 증상은 엉뚱한 곳에서 터진다
# (`AttributeError: module 'triton' has no attribute 'language'` → transformers 의
# `PreTrainedModel` 을 못 읽는다). 그래서 `embedding/model_repo/` 다.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "embedding"))

import numpy as np  # noqa: E402
import torch  # noqa: E402
import yaml  # noqa: E402

torch.set_num_threads(4)  # measure_embedding_precision.py 와 동일 — 흔들면 비교 무효

from sentence_transformers import SentenceTransformer  # noqa: E402

MODEL = os.environ.get("TRIPPILOT_EMBEDDING_MODEL") or "nlpai-lab/KURE-v1"
KB_PATH = Path(os.environ.get("KB_PATH") or "data/planb_situation_kb.yaml")
QUERIES = (
    "WEATHER 날씨 악화 상황",
    "CLOSURE 휴무·폐점 상황",
    "DELAY 지연 상황",
    "MANUAL 예약 취소 상황",
    "MANUAL 피로 상황",
    "MANUAL 사용자 요청 교체 상황",
)
TOP_K = 4  # kb_retrieval.DEFAULT_TOP_K
COSINE_FLOOR = 0.9999  # 채택 전제


def _measure(encode, texts: list[str], name: str) -> dict:
    """워밍업 2회 후 3회 중앙값 — 기존 하네스와 같은 규약."""
    for _ in range(2):
        encode(texts[:4])
    latencies = []
    for _ in range(3):
        start = time.perf_counter()
        docs = encode(texts)
        latencies.append((time.perf_counter() - start) * 1000)
    median = statistics.median(latencies)
    print(f"[{name}] {len(texts)}건 인코딩 {median:,.0f} ms  (3회 중앙값)")
    return {
        "name": name,
        "latency": median,
        "docs": np.asarray(docs, dtype=np.float32),
        "queries": np.asarray(encode(list(QUERIES)), dtype=np.float32),
    }


def _top_k(result: dict, doc_ids: list[str]) -> list[list[str]]:
    return [
        [doc_ids[i] for i in np.argsort(-(result["docs"] @ result["queries"][q]))[:TOP_K]]
        for q in range(len(QUERIES))
    ]


def main() -> int:
    kb = yaml.safe_load(KB_PATH.read_text(encoding="utf-8"))
    entries = [(d["doc_id"], d["text"]) for d in kb["documents"]]
    doc_ids = [i for i, _ in entries]
    texts = [t for _, t in entries]
    print(
        f"모델 {MODEL} · KB {len(texts)}건 · 질의 {len(QUERIES)}종 · "
        f"CPU {torch.get_num_threads()}스레드\n"
    )

    st = SentenceTransformer(MODEL, device="cpu")
    base = _measure(
        lambda t: st.encode(t, normalize_embeddings=True, show_progress_bar=False),
        texts,
        "sentence-transformers (현행)",
    )

    os.environ["EMBEDDING_BACKEND"] = "triton"
    import app  # noqa: E402 — env 를 먼저 세운 뒤 읽어야 BACKEND 가 잡힌다

    variant = _measure(app._embed_triton, texts, "Triton (ONNX Runtime)")

    cosine = np.sum(base["docs"] * variant["docs"], axis=1) / (
        np.linalg.norm(base["docs"], axis=1) * np.linalg.norm(variant["docs"], axis=1)
    )
    base_rank, variant_rank = _top_k(base, doc_ids), _top_k(variant, doc_ids)
    same = sum(a == b for a, b in zip(base_rank, variant_rank))
    positions = sum(
        1 for a, b in zip(base_rank, variant_rank) for x, y in zip(a, b) if x == y
    )

    print("\n## 현행 대비\n")
    print("| 백엔드 | 지연 | 지연비 | 코사인 최소 | top4 순위 |")
    print("|---|---:|---:|---:|---|")
    print(f"| {base['name']} | {base['latency']:,.0f} ms | 1.00× | 1.00000 | 기준 |")
    print(
        f"| {variant['name']} | {variant['latency']:,.0f} ms | "
        f"{variant['latency'] / base['latency']:.2f}× | {cosine.min():.5f} | "
        f"{same}/{len(QUERIES)} 질의 ({positions}/{len(QUERIES) * TOP_K} 위치) |"
    )
    for query, a, b in zip(QUERIES, base_rank, variant_rank):
        if a != b:
            print(f"    순위 차이 — {query}\n      현행: {a}\n      Triton: {b}")

    ok_cosine = bool(cosine.min() >= COSINE_FLOOR)
    ok_rank = same == len(QUERIES)
    print(
        f"\n동등성: 코사인 최소 {cosine.min():.5f} (기준 ≥ {COSINE_FLOOR}) "
        f"{'통과' if ok_cosine else '실패'} · "
        f"top-4 순위 {same}/{len(QUERIES)} {'통과' if ok_rank else '실패'}"
    )
    if not (ok_cosine and ok_rank):
        print("→ **채택 불가** — 벡터가 다르면 지연 이득은 의미가 없다.")
        return 1
    print("→ 동등성 전제 충족. 채택 판단은 지연·운영 비용으로 넘어간다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
