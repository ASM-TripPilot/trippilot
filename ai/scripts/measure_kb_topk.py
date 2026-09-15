"""KB-3 검색 top_k 측정 (TRIP-508) — CI 밖 수동 실행 전용.

`kb_retrieval.DEFAULT_TOP_K` 의 근거를 재현한다. 상수를 다시 만질 사람이
같은 수치를 다시 뽑을 수 있어야 해서 스크립트로 남긴다 — 주석에 숫자만 적어두면
KB 가 바뀐 뒤엔 검증할 방법이 없다.

실행:
    docker compose --profile full up -d ai-vectordb
    TRIPPILOT_EMBEDDING_PROVIDER=local \
    TRIPPILOT_VECTOR_DB_URL=postgresql://ai_kb:ai_kb@localhost:5433/ai_kb \
        uv run python scripts/load_kb.py          # 먼저 적재 (멱등)
    TRIPPILOT_VECTOR_DB_URL=... uv run python scripts/measure_kb_topk.py

지표:
- **정밀도** = top_k 안에서 질의 reason 을 태그로 가진 문서 비율. 재현율은
  목표로 삼지 않는다 — 한 reason 에 문서가 여러 건이면 "전건 회수"는 애초에
  프롬프트가 원하는 게 아니다(무관 문서로 컨텍스트를 채우게 된다).
- **컨텍스트 길이** = `rag._join()` 산출 문자 수. 프롬프트 골격과 비교하기 위한 값.
"""

from __future__ import annotations

import os
import time
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from trippilot.agents.adapters.pgvector_store import PgVectorStore  # noqa: E402
from trippilot.agents.planb.kb_retrieval import retrieve  # noqa: E402
from trippilot.agents.planb.rag import _REASON_KO  # noqa: E402
from trippilot.domain.kb import KbKind  # noqa: E402

# `_situation_query` 가 만들 수 있는 조합 전부 (TriggerKind × reason 실사용 짝)
QUERIES = [
    ("WEATHER", "weather"),
    ("CLOSURE", "closed"),
    ("DELAY", "delay"),
    ("MANUAL", "canceled"),
    ("MANUAL", "fully_booked"),
    ("MANUAL", "fatigue"),
    ("MANUAL", "none"),
]
CANDIDATE_K = (2, 3, 4, 5, 6, 8, 10, 12, 15, 20)
PROMPT_SKELETON_CHARS = 630  # prompts/alternative_selection.yaml 의 변수 제외 골격


def _embedding():
    """`load_kb.py._embedding` 과 같은 규칙 — 적재와 다른 모델로 재면 무의미하다.

    `http` 를 받는다 (2026-09-12). 임베딩 컨테이너 분리(TRIP-517) 전에 쓰인 스크립트라
    `local` 만 허용했는데, 적재가 `http` 로 넘어간 뒤로는 **측정을 아예 돌릴 수 없었다** —
    운영과 같은 경로로 재라는 규칙이 운영 경로를 막고 있었던 셈이다. 둘 다 같은 KURE-v1
    이라 벡터 공간은 같고, collection 도 `model_id` 로 같은 이름이 된다.
    """
    provider = os.environ.get("TRIPPILOT_EMBEDDING_PROVIDER") or "local"
    if provider == "http":
        from trippilot.llm_gateway.adapters.http_embedding_assembly import http_embedding
        from trippilot.poi_curation.adapters.backend_poi_db import UrllibJsonClient

        return http_embedding(SystemExit, lambda t: UrllibJsonClient(timeout_sec=t))
    if provider != "local":
        raise SystemExit(
            f"측정은 적재와 같은 모델이어야 한다 (provider={provider}) — http 또는 local")
    from sentence_transformers import SentenceTransformer

    from trippilot.llm_gateway.adapters.sentence_transformer_embedding import (
        SentenceTransformerEmbeddingAdapter,
    )

    model = os.environ.get("TRIPPILOT_EMBEDDING_MODEL") or "nlpai-lab/KURE-v1"
    # 적재와 같은 collection 을 봐야 측정이 성립한다 — model_id 필수 (TRIP-519 ①).
    return SentenceTransformerEmbeddingAdapter(SentenceTransformer(model), model_id=model)


def main() -> None:
    dsn = os.environ.get("TRIPPILOT_VECTOR_DB_URL")
    if not dsn:
        raise SystemExit("TRIPPILOT_VECTOR_DB_URL 미설정")
    import psycopg

    embedding = _embedding()
    store = PgVectorStore(lambda: psycopg.connect(dsn))
    max_k = max(CANDIDATE_K)

    per_query = {}
    elapsed_ms: list[float] = []
    for kind, reason in QUERIES:
        query = f"{kind} {_REASON_KO.get(reason, reason)} 상황"
        # 검색 소요를 같이 잰다 — HNSW 도입 시점(TRIP-838 조건 ②)을 감이 아니라
        # 그래프로 정하려면 "몇 건부터 느려지는지"의 기준선이 필요하다. 지금은
        # 벡터 인덱스가 아예 없어(PK btree 뿐) 매 질의가 전건 스캔이다.
        # **임베딩 왕복이 포함된 값**이다 — 스캔만 분리하려면 SQL 을 직접 재야 한다.
        t0 = time.perf_counter()
        hits = retrieve(KbKind.SITUATION, query, embedding, store, top_k=max_k)
        elapsed_ms.append((time.perf_counter() - t0) * 1000)
        relevant = [reason in (h.metadata or {}).get("reasons", ()) for h in hits]
        per_query[query] = (hits, relevant)
        first_bad = next((i + 1 for i, r in enumerate(relevant) if not r), None)
        print(f"\n### {query} — 첫 무관 문서 {first_bad or '없음'}위")
        for i, (hit, rel) in enumerate(zip(hits, relevant), 1):
            if i > 8:
                break
            print(f"  {i:2d}. {hit.score:.4f} {'O' if rel else 'X'} "
                  f"{hit.doc_id:20s} {hit.text[:40]}")

    print("\n## top_k 별 정밀도 · 컨텍스트 길이\n")
    print("| top_k | 정밀도 | 평균 길이 | 골격 대비 |")
    print("|---:|---:|---:|---:|")
    for k in CANDIDATE_K:
        precisions, lengths = [], []
        for hits, relevant in per_query.values():
            top = relevant[:k]
            if not top:
                continue
            precisions.append(sum(top) / len(top))
            lengths.append(len("\n".join(f"- {h.text}" for h in hits[:k])))
        avg_len = sum(lengths) / len(lengths)
        print(f"| {k} | {sum(precisions)/len(precisions):.3f} | {avg_len:.0f}자 | "
              f"{avg_len / PROMPT_SKELETON_CHARS:.0%} |")

    # HNSW 판정용 기준선 (TRIP-838)
    ordered = sorted(elapsed_ms)
    print("\n## 검색 소요 (임베딩 왕복 포함, 인덱스 없음 = 전건 스캔)\n")
    print(f"질의 {len(ordered)}건 · 중앙값 {ordered[len(ordered) // 2]:.0f}ms · "
          f"최소 {ordered[0]:.0f} · 최대 {ordered[-1]:.0f}ms")
    print("검색 몫은 요청 예산의 15%(25초 기준 3.75초)다 — 그 조각을 유의미하게 "
          "먹기 시작하면 HNSW 를 본다.")


if __name__ == "__main__":
    main()
