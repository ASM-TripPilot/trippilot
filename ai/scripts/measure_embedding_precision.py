"""임베딩 모델 정밀도 측정 (TRIP-518) — CI 밖 수동 실행 전용.

컨테이너 이미지에 가중치를 어떤 형태로 올릴지 정하기 위한 측정. 결론과 해석은
`ai/docs/임베딩-정밀도-측정.md`.

실행:
    uv pip install sentence-transformers   # 프로젝트 의존성 아님 (load_kb.py 와 동일)
    uv run python scripts/measure_embedding_precision.py

측정하는 것:
- **이미지 크기** = `state_dict` 직렬화 바이트. `parameters()` 로 재면 안 된다 —
  양자화 모듈의 packed params 는 `nn.Parameter` 가 아니라 안 잡힌다.
- **지연** = KB 전건 인코딩 중앙값. 변형끼리 비교하려면 **전부 같은 device** 여야
  한다(기본 CPU 고정 — 배포 대상이 CPU 컨테이너다). `SentenceTransformer` 는
  device 를 자동 선택하므로 한쪽만 MPS/CUDA 로 가면 비교가 통째로 무효다.
- **품질** = fp32 대비 문서벡터 코사인 + top-k 순위 일치. 검색이 소비처라
  절대 점수가 아니라 **순위가 바뀌는지**가 유일하게 중요하다.

변환이 실제로 걸렸는지 **모듈을 세어 assert 한다.** `Transformer.auto_model` 은
setter 없는 property 라 `st[0].auto_model = 변환결과` 가 예외 없이 무시된다 —
그러면 원본 fp32 가 그대로 돌면서 "양자화했는데 손실이 없다"로 읽힌다.
올바른 경로는 `st[0].model = ...` 이다.
"""

from __future__ import annotations

import os
import statistics
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import numpy as np  # noqa: E402
import torch  # noqa: E402
import torch.nn as nn  # noqa: E402
import yaml  # noqa: E402

torch.set_num_threads(4)  # 컨테이너 CPU 할당 가정 — 스레드 수가 흔들리면 지연도 흔들린다

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
TOP_K = 4  # kb_retrieval.DEFAULT_TOP_K — 순위 비교는 실제로 쓰는 깊이에서 한다


def _load() -> SentenceTransformer:
    return SentenceTransformer(MODEL, device="cpu")


def _disk_mb(state_dict: dict) -> float:
    with tempfile.NamedTemporaryFile(suffix=".pt", delete=False) as f:
        torch.save(state_dict, f.name)
        size = os.path.getsize(f.name)
    os.unlink(f.name)
    return size / 1e6


def _measure(model: SentenceTransformer, texts: list[str], name: str) -> dict:
    for _ in range(2):  # 워밍업 — 첫 호출에 지연 로딩이 섞인다
        model.encode(texts[:4], show_progress_bar=False)
    latencies = []
    for _ in range(3):
        start = time.perf_counter()
        docs = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        latencies.append((time.perf_counter() - start) * 1000)
    queries = model.encode(list(QUERIES), normalize_embeddings=True, show_progress_bar=False)
    median = statistics.median(latencies)
    print(f"[{name}] {len(texts)}건 인코딩 {median:,.0f} ms")
    return {
        "name": name,
        "latency": median,
        "size": _disk_mb(model[0].auto_model.state_dict()),
        "docs": np.asarray(docs, dtype=np.float32),
        "queries": np.asarray(queries, dtype=np.float32),
    }


def _top_k(result: dict, doc_ids: list[str]) -> list[list[str]]:
    return [
        [doc_ids[i] for i in np.argsort(-(result["docs"] @ result["queries"][q]))[:TOP_K]]
        for q in range(len(QUERIES))
    ]


def _report(base: dict, variant: dict, doc_ids: list[str], size_override: float | None = None) -> None:
    cosine = np.sum(base["docs"] * variant["docs"], axis=1) / (
        np.linalg.norm(base["docs"], axis=1) * np.linalg.norm(variant["docs"], axis=1)
    )
    base_rank, variant_rank = _top_k(base, doc_ids), _top_k(variant, doc_ids)
    same = sum(a == b for a, b in zip(base_rank, variant_rank))
    positions = sum(1 for a, b in zip(base_rank, variant_rank) for x, y in zip(a, b) if x == y)
    size = variant["size"] if size_override is None else size_override
    print(
        f"| {variant['name']} | {size:,.0f} MB | {size / base['size']:.2f}× | "
        f"{variant['latency']:,.0f} ms | {variant['latency'] / base['latency']:.2f}× | "
        f"{cosine.min():.5f} | {same}/{len(QUERIES)} 질의 "
        f"({positions}/{len(QUERIES) * TOP_K} 위치) |"
    )
    for query, a, b in zip(QUERIES, base_rank, variant_rank):
        if a != b:
            print(f"    순위 차이 — {query}\n      기준: {a}\n      변형: {b}")


def _int8_model() -> SentenceTransformer:
    """int8 동적 양자화 모델. 교체가 실제로 먹었는지 확인하고 못 먹으면 멈춘다.

    `st[0].auto_model = ...` 은 property 라 조용히 무시된다 — `st[0].model` 이 실경로다.
    이 assert 가 없으면 fp32 를 재면서 int8 이라고 보고하게 된다(실제로 그럴 뻔했다).
    """
    if "qnnpack" in torch.backends.quantized.supported_engines:
        torch.backends.quantized.engine = "qnnpack"  # arm64 는 기본 미설정
    model = _load()
    converted = torch.ao.quantization.quantize_dynamic(
        model[0].auto_model, {nn.Linear}, dtype=torch.qint8
    )
    model[0].model = converted
    linear = sum(1 for m in model[0].auto_model.modules() if isinstance(m, nn.Linear))
    quantized = sum(
        1
        for m in model[0].auto_model.modules()
        if type(m).__module__.startswith("torch.ao.nn.quantized")
    )
    print(f"  int8 교체 검증 — nn.Linear {linear} · 양자화 모듈 {quantized}")
    if quantized == 0:
        raise SystemExit(
            "int8 교체 실패 — 이 측정은 무효다. sentence_transformers 가 backbone 속성 이름을 "
            "바꿨는지 확인할 것(현재 경로: Transformer.model)."
        )
    return model


def main() -> None:
    kb = yaml.safe_load(KB_PATH.read_text(encoding="utf-8"))
    entries = [(d["doc_id"], d["text"]) for d in kb["documents"]]
    doc_ids = [i for i, _ in entries]
    texts = [t for _, t in entries]
    print(f"모델 {MODEL} · KB {len(texts)}건 · 질의 {len(QUERIES)}종 · CPU {torch.get_num_threads()}스레드\n")

    base = _measure(_load(), texts, "fp32 (현행)")

    # fp16 으로 저장했다가 fp32 로 되올린다 — 이미지에는 fp16 파일만 들어가고
    # 연산은 fp32 경로 그대로. 손실은 반올림 한 번뿐이다.
    model = _load()
    half = {
        k: (v.half() if v.is_floating_point() else v)
        for k, v in model[0].auto_model.state_dict().items()
    }
    half_size = _disk_mb(half)
    probe = next(k for k, v in half.items() if v.is_floating_point() and v.numel() > 1000)
    original = model[0].auto_model.state_dict()[probe].clone()
    model[0].auto_model.load_state_dict(
        {k: (v.float() if v.is_floating_point() else v) for k, v in half.items()}
    )
    delta = (original - model[0].auto_model.state_dict()[probe]).abs()
    print(
        f"  fp16 왕복 검증 — {probe} 원소 {(delta > 0).sum():,}/{original.numel():,} 변경, "
        f"최대 절대오차 {delta.max():.3e}"
    )
    stored_fp16 = _measure(model, texts, "fp16 저장 → fp32 로드")

    print("\n## fp32(CPU) 대비\n")
    print("| 변형 | 이미지 크기 | 크기비 | 지연 | 지연비 | 코사인 최소 | top4 순위 |")
    print("|---|---:|---:|---:|---:|---:|---|")
    print(f"| {base['name']} | {base['size']:,.0f} MB | 1.00× | {base['latency']:,.0f} ms | 1.00× | 1.00000 | 기준 |")
    _report(base, stored_fp16, doc_ids, size_override=half_size)
    _report(base, _measure(_int8_model(), texts, "int8 동적"), doc_ids)


if __name__ == "__main__":
    main()
