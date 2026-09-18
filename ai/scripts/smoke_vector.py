"""벡터 스토어·임베딩 실연동 스모크 (TRIP-426) — CI 밖 수동 실행 전용 (D37).

실행:
    docker compose --profile full up -d ai-vectordb
    TRIPPILOT_VECTOR_DB_URL=postgresql://ai_kb:ai_kb@localhost:5433/ai_kb \
        uv run python scripts/smoke_vector.py

검증: ① upsert→search 왕복 + score 내림차순·동점 item_id 순 ② 멱등 upsert(중복 없음)
③ delete 반영. OPENAI_API_KEY 설정 시 ④ 실임베딩 의미 유사도(비슷한 문장 쌍이
다른 문장보다 높은 score)까지 확인한다.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from trippilot.agents.adapters.pgvector_store import PgVectorStore  # noqa: E402

_COLLECTION = "smoke_vector"


def main() -> int:
    url = os.environ.get("TRIPPILOT_VECTOR_DB_URL")
    if not url:
        print("TRIPPILOT_VECTOR_DB_URL 미설정 — 스모크 불가", file=sys.stderr)
        return 2
    import psycopg

    store = PgVectorStore(lambda: psycopg.connect(url))
    dim = 1024

    def axis(i: int) -> tuple[float, ...]:
        return tuple(1.0 if j == i else 0.0 for j in range(dim))

    # ① 왕복 + 정렬 — b가 질의와 동일(1.0), a는 직교(0.0)
    store.upsert(_COLLECTION, "a", axis(0), {"kind": "smoke"})
    store.upsert(_COLLECTION, "b", axis(1), {"kind": "smoke"})
    hits = store.search(_COLLECTION, axis(1), top_k=2)
    assert [h.item_id for h in hits] == ["b", "a"], hits
    assert abs(hits[0].score - 1.0) < 1e-6, hits[0]
    assert hits[0].payload == {"kind": "smoke"}, hits[0]

    # ② 멱등 upsert
    store.upsert(_COLLECTION, "b", axis(1), {"kind": "smoke", "v": 2})
    hits = store.search(_COLLECTION, axis(1), top_k=10)
    assert len(hits) == 2 and hits[0].payload.get("v") == 2, hits

    # ③ delete
    store.delete(_COLLECTION, "a")
    store.delete(_COLLECTION, "b")
    assert store.search(_COLLECTION, axis(0), top_k=10) == ()
    print("pgvector 왕복 OK (upsert·search·정렬·멱등·delete)")

    # ④ 실임베딩 (선택)
    api_key = os.environ.get("OPENAI_API_KEY")
    if api_key:
        import openai

        from trippilot.llm_gateway.adapters.openai_embedding import OpenAiEmbeddingAdapter

        emb = OpenAiEmbeddingAdapter(
            openai.OpenAI(api_key=api_key, base_url=os.environ.get("OPENAI_BASE_URL") or None)
        )
        v_rain1, v_rain2, v_food = emb.embed_batch(
            ["비가 와서 실내 일정으로 바꾸고 싶어", "우천 시 갈 만한 실내 장소", "제주 흑돼지 맛집"]
        )
        for i, v in enumerate((v_rain1, v_rain2, v_food)):
            store.upsert(_COLLECTION, f"e{i}", v, {})
        hits = store.search(_COLLECTION, v_rain1, top_k=3)
        assert hits[0].item_id == "e0" and hits[1].item_id == "e1", hits  # 유사쌍 > 이질문장
        for i in range(3):
            store.delete(_COLLECTION, f"e{i}")
        print(f"실임베딩 의미 유사도 OK (dim={emb.dim}, 우천쌍 score {hits[1].score:.3f} > 맛집 {hits[2].score:.3f})")
    else:
        print("OPENAI_API_KEY 미설정 — 실임베딩 단계 생략")
    return 0


if __name__ == "__main__":
    sys.exit(main())
