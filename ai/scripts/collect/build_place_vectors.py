"""KB-5 장소 지식 조각 벡터를 미리 계산해 `data/place_corpus_wiki.vectors.json.gz` 로 저장한다 (2026-10-18 청킹).

배포 KB 적재(`scripts/load_kb.py`)는 이 파일의 벡터를 그대로 넣는다 — 운영 임베딩 파드(문서당 1.5~3초)로 조각
1만여 개를 매 배포 임베딩하면 몇 시간이고 실시간 질의와 파드를 나눠 쓴다. 지문이 다른 조각(원천·청킹 규칙이 바뀐
것)만 원격 임베딩으로 간다. **코퍼스나 청킹 규칙을 바꾸면 이 스크립트를 다시 돌린다** —
`test_committed_place_vectors_cover_the_corpus` 가 잊은 것을 CI 에서 잡는다.

벡터 공간은 질문뱅크(`scripts/intent/build_bank_vectors.py`)와 같은 경로다 — 배포 임베딩 서비스(`ai/embedding/app.py`)
처럼 KURE-v1 가중치를 fp16 으로 반올림한 뒤 fp32 로 연산, normalize. 끝에 BR-MLO-05 게이트(조각별 코사인 ≥ 0.9999 ·
질의별 top-k 동일)를 표본으로 확인하고 결과를 파일 머리에 남긴다.

**게이트의 기준은 서빙 이미지다**(원본 fp32 가중치가 아니라). 운영 질의 벡터는 그 이미지가 만든다 — 조각 벡터가 같은
공간이어야 할 상대가 그것이다. 원본 fp32 와 비교하면 서빙 이미지 자체의 fp16 반올림 몫(TRIP-518 에서 받아들인 것)을
재게 되어, 긴 조각에서는 0.99988 까지 내려가 같은 엔진인데도 떨어진다(2026-10-19 실측: 로컬 경로 vs 서빙 컨테이너
0.9999995 · 서빙 컨테이너 vs fp32 0.99998).

실행 (로컬 스택의 임베딩 컨테이너 = 배포 이미지):
    cd ai && uv pip install sentence-transformers && \
        TRIPPILOT_EMBEDDING_BASE_URL=http://localhost:8100 uv run python scripts/collect/build_place_vectors.py

**증분이 기본이다**(2026-10-22 — 관광공사 개요를 모이는 대로 나눠 올린다). 이미 있는 벡터 파일에서 본문 지문이 같은 조각은
그대로 쓰고 **파일에 적힌 순서도 그대로** 앞에 둔 뒤, 새·바뀐 조각만 계산해 뒤에 붙인다. 본체를 나눠 쓰므로
(`chunking.F16_SHARD_CHUNKS`) 앞쪽 몫 파일이 바이트까지 같아 git 이 다시 저장하지 않는다. 게이트는 새로 계산한 조각의
표본으로 본다. 모델 리비전이 바뀌었거나 `--full` 이면 전량을 다시 계산한다.
"""

from __future__ import annotations

import gzip
import json
import os
import random
import sys
from pathlib import Path

_AI_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_AI_ROOT / "src"))
sys.path.insert(0, str(_AI_ROOT / "scripts" / "measure"))
sys.path.insert(0, str(_AI_ROOT / "scripts" / "intent"))

from build_bank_vectors import _hf_revision  # noqa: E402 — 리비전 기록 한 벌
from embedding_ab_gate import COSINE_FLOOR, TOP_K  # noqa: E402 — 게이트 상수 한 벌
from trippilot.poi_curation.chunking import (  # noqa: E402
    chunk_corpus, dump_chunk_vectors, load_chunk_vectors, text_hash, vectors_path,
)

# 코퍼스는 인자로 고른다(기본 위키) — 관광공사 개요: `build_place_vectors.py data/place_corpus_overview.jsonl.gz`
_ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
_CORPUS = _AI_ROOT / (_ARGS[0] if _ARGS else "data/place_corpus_wiki.jsonl.gz")
_FULL = "--full" in sys.argv
_MODEL = "nlpai-lab/KURE-v1"
_GATE_SAMPLE = 400  # 게이트는 표본으로 — 원본 fp32 경로로 전량을 두 번 돌릴 이유가 없다
_GATE_QUERIES = ("WEATHER 날씨 악화 상황", "WEATHER 날씨 악화 상황 비 와서 실내로", "CLOSURE 휴무·폐점 상황",
                 "DELAY 지연 상황", "MANUAL 피로 상황 다리 아파서 덜 걷는 곳", "MANUAL 사용자 요청 교체 상황 아이랑")


def _cos(a, b) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    return dot / ((sum(x * x for x in a) ** 0.5) * (sum(y * y for y in b) ** 0.5))


def incremental_order(docs, previous):
    """(그대로 쓸 조각 — 이전 파일 순서, 새로 계산할 조각 — 코퍼스 순서). 지문이 같은 조각만 재사용한다."""
    if previous is None:
        return [], list(docs)
    by_id = {d.doc_id: d for d in docs}
    keep = [by_id[i] for i in previous.ids()
            if i in by_id and previous.hash_of(i) == text_hash(by_id[i].text)]
    kept = {d.doc_id for d in keep}
    return keep, [d for d in docs if d.doc_id not in kept]


def main() -> int:
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        raise SystemExit("sentence-transformers 미설치 — `uv pip install sentence-transformers`")

    if not os.environ.get("TRIPPILOT_EMBEDDING_BASE_URL"):
        raise SystemExit("게이트 기준(서빙 이미지)이 없다 — TRIPPILOT_EMBEDDING_BASE_URL=http://localhost:8100")
    from trippilot.llm_gateway.adapters.http_embedding_assembly import http_embedding
    from trippilot.poi_curation.adapters.backend_poi_db import UrllibJsonClient

    image = http_embedding(SystemExit, lambda t: UrllibJsonClient(timeout_sec=t), timeout_sec=180.0)
    with gzip.open(_CORPUS, "rt", encoding="utf-8") as f:
        docs = chunk_corpus(json.loads(line) for line in f if line.strip())
    out = vectors_path(_CORPUS)
    revision = _hf_revision(_MODEL)
    previous = None if _FULL else load_chunk_vectors(out)
    if previous is not None and (previous.model != _MODEL or _previous_revision(out) != revision):
        previous = None  # 다른 모델·리비전의 벡터는 섞지 않는다 — 전량 다시
    keep, todo = incremental_order(docs, previous)
    if not todo:
        print(f"조각 {len(docs)}개 모두 기존 벡터와 지문이 같다 — 할 일 없음")
        return 0
    texts = [d.text for d in todo]
    serving = SentenceTransformer(_MODEL, device="cpu")
    serving[0].auto_model.half().float()  # 서빙 이미지: 구운 fp16 가중치 → fp32 연산(ai/embedding/app.py)
    vectors = serving.encode(texts, normalize_embeddings=True, batch_size=64, show_progress_bar=True)

    # BR-MLO-05 — 다른 엔진(원본 fp32 가중치) 벡터와 같은 공간인가 (표본)
    idx = sorted(random.Random(20261018).sample(range(len(todo)), min(_GATE_SAMPLE, len(todo))))
    ref = []
    for i in range(0, len(idx), 32):
        ref.extend(image.embed_batch([texts[j] for j in idx[i:i + 32]]))
    sv = [vectors[i] for i in idx]
    min_cos = min(_cos(a, b) for a, b in zip(sv, ref))
    qv = image.embed_batch(list(_GATE_QUERIES))  # 운영에서 질의를 임베딩하는 것도 이 이미지다
    rank_diff = sum(
        sorted(range(len(idx)), key=lambda j: -_cos(q, sv[j]))[:TOP_K]
        != sorted(range(len(idx)), key=lambda j: -_cos(q, ref[j]))[:TOP_K]
        for q in qv
    )
    if min_cos < COSINE_FLOOR or rank_diff:
        raise SystemExit(f"BR-MLO-05 미달 — 코사인 최소 {min_cos:.6f}, top-{TOP_K} 불일치 {rank_diff}")

    ordered = [*keep, *todo]
    all_vectors = [*(previous.vector(d.doc_id) for d in keep), *(tuple(float(x) for x in v) for v in vectors)]
    dump_chunk_vectors(out, ordered, _MODEL, all_vectors, provenance={
        "engine": "sentence-transformers fp16 가중치 → fp32 연산, normalize (ai/embedding/app.py 기본 백엔드)",
        "model_revision": revision,
        "gate": f"BR-MLO-05 vs 서빙 이미지(새 조각 표본 {len(idx)}): 코사인 최소 {min_cos:.6f}, "
                f"top-{TOP_K} 불일치 0/{len(_GATE_QUERIES)}",
        "incremental": f"재사용 {len(keep)} · 새로 계산 {len(todo)}",
    })
    print(f"조각 {len(ordered)}개(재사용 {len(keep)} · 새로 {len(todo)}) → {out.relative_to(_AI_ROOT)} · "
          f"게이트 코사인 최소 {min_cos:.6f}, top-{TOP_K} 불일치 0")
    return 0


def _previous_revision(out) -> str | None:
    head = json.loads(gzip.decompress(out.read_bytes()))
    return (head.get("provenance") or {}).get("model_revision")


if __name__ == "__main__":
    raise SystemExit(main())
