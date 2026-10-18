"""KB-5 장소 지식 조각 벡터를 미리 계산해 `data/place_corpus_wiki.vectors.json.gz` 로 저장한다 (2026-10-18 청킹).

배포 KB 적재(`scripts/load_kb.py`)는 이 파일의 벡터를 그대로 넣는다 — 운영 임베딩 파드(문서당 1.5~3초)로 조각
1만여 개를 매 배포 임베딩하면 몇 시간이고 실시간 질의와 파드를 나눠 쓴다. 지문이 다른 조각(원천·청킹 규칙이 바뀐
것)만 원격 임베딩으로 간다. **코퍼스나 청킹 규칙을 바꾸면 이 스크립트를 다시 돌린다** —
`test_committed_place_vectors_cover_the_corpus` 가 잊은 것을 CI 에서 잡는다.

벡터 공간은 질문뱅크(`scripts/intent/build_bank_vectors.py`)와 같은 경로다 — 배포 임베딩 서비스(`ai/embedding/app.py`)
처럼 KURE-v1 가중치를 fp16 으로 반올림한 뒤 fp32 로 연산, normalize. 끝에 BR-MLO-05 게이트(원본 fp32 가중치와
조각별 코사인 ≥ 0.9999 · 질의별 top-k 동일)를 표본으로 확인하고 결과를 파일 머리에 남긴다.

실행:
    cd ai && uv pip install sentence-transformers && uv run python scripts/collect/build_place_vectors.py
"""

from __future__ import annotations

import gzip
import json
import random
import sys
from pathlib import Path

_AI_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_AI_ROOT / "src"))
sys.path.insert(0, str(_AI_ROOT / "scripts" / "measure"))
sys.path.insert(0, str(_AI_ROOT / "scripts" / "intent"))

from build_bank_vectors import _hf_revision  # noqa: E402 — 리비전 기록 한 벌
from embedding_ab_gate import COSINE_FLOOR, TOP_K  # noqa: E402 — 게이트 상수 한 벌
from trippilot.poi_curation.chunking import chunk_corpus, dump_chunk_vectors, vectors_path  # noqa: E402

_CORPUS = _AI_ROOT / "data" / "place_corpus_wiki.jsonl.gz"
_MODEL = "nlpai-lab/KURE-v1"
_GATE_SAMPLE = 400  # 게이트는 표본으로 — 원본 fp32 경로로 전량을 두 번 돌릴 이유가 없다
_GATE_QUERIES = ("WEATHER 날씨 악화 상황", "WEATHER 날씨 악화 상황 비 와서 실내로", "CLOSURE 휴무·폐점 상황",
                 "DELAY 지연 상황", "MANUAL 피로 상황 다리 아파서 덜 걷는 곳", "MANUAL 사용자 요청 교체 상황 아이랑")


def _cos(a, b) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    return dot / ((sum(x * x for x in a) ** 0.5) * (sum(y * y for y in b) ** 0.5))


def main() -> int:
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        raise SystemExit("sentence-transformers 미설치 — `uv pip install sentence-transformers`")

    with gzip.open(_CORPUS, "rt", encoding="utf-8") as f:
        docs = chunk_corpus(json.loads(line) for line in f if line.strip())
    texts = [d.text for d in docs]
    serving = SentenceTransformer(_MODEL, device="cpu")
    serving[0].auto_model.half().float()  # 서빙 이미지: 구운 fp16 가중치 → fp32 연산(ai/embedding/app.py)
    vectors = serving.encode(texts, normalize_embeddings=True, batch_size=64, show_progress_bar=True)

    # BR-MLO-05 — 다른 엔진(원본 fp32 가중치) 벡터와 같은 공간인가 (표본)
    idx = sorted(random.Random(20261018).sample(range(len(docs)), min(_GATE_SAMPLE, len(docs))))
    reference = SentenceTransformer(_MODEL, device="cpu")
    ref = reference.encode([texts[i] for i in idx], normalize_embeddings=True, show_progress_bar=False)
    sv = [vectors[i] for i in idx]
    min_cos = min(_cos(a, b) for a, b in zip(sv, ref))
    qv = serving.encode(list(_GATE_QUERIES), normalize_embeddings=True, show_progress_bar=False)
    rank_diff = sum(
        sorted(range(len(idx)), key=lambda j: -_cos(q, sv[j]))[:TOP_K]
        != sorted(range(len(idx)), key=lambda j: -_cos(q, ref[j]))[:TOP_K]
        for q in qv
    )
    if min_cos < COSINE_FLOOR or rank_diff:
        raise SystemExit(f"BR-MLO-05 미달 — 코사인 최소 {min_cos:.6f}, top-{TOP_K} 불일치 {rank_diff}")

    out = vectors_path(_CORPUS)
    dump_chunk_vectors(out, docs, _MODEL, [tuple(float(x) for x in v) for v in vectors], provenance={
        "engine": "sentence-transformers fp16 가중치 → fp32 연산, normalize (ai/embedding/app.py 기본 백엔드)",
        "model_revision": _hf_revision(_MODEL),
        "gate": f"BR-MLO-05 vs fp32 가중치(표본 {len(idx)}): 코사인 최소 {min_cos:.6f}, "
                f"top-{TOP_K} 불일치 0/{len(_GATE_QUERIES)}",
    })
    print(f"조각 {len(docs)}개 → {out.relative_to(_AI_ROOT)} ({out.stat().st_size // 1024}KB) · "
          f"게이트 코사인 최소 {min_cos:.6f}, top-{TOP_K} 불일치 0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
