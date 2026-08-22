"""KB seed → 실 벡터 스토어 적재 (TRIP-427) — CI 밖 수동 실행 전용 (D37).

실행:
    docker compose --profile full up -d ai-vectordb
    TRIPPILOT_VECTOR_DB_URL=postgresql://ai_kb:ai_kb@localhost:5433/ai_kb \
    OPENAI_API_KEY=... \
        uv run python scripts/load_kb.py [data/planb_situation_kb.yaml ...]

임베딩 선택 (TRIPPILOT_EMBEDDING_PROVIDER, 기본 openai):
- openai: OPENAI_API_KEY 필수 (+ OPENAI_BASE_URL 선택)
- titan:  boto3 설치 + AWS 자격 필요 (bedrock-runtime, AWS_REGION)

FakeEmbedding 적재는 지원하지 않는다 — 해시 벡터는 의미 유사도가 없어서
"적재는 됐는데 검색이 엉터리"인 오염 상태를 만든다 (침묵 실패 금지).
멱등: 같은 doc_id는 upsert로 갱신된다 — 몇 번 실행해도 행이 늘지 않는다.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import yaml

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from trippilot.agents.adapters.pgvector_store import PgVectorStore  # noqa: E402
from trippilot.agents.planb.kb_retrieval import index_documents, load_kb_file  # noqa: E402

_DEFAULT_SEEDS = ("data/planb_situation_kb.yaml",)


def _embedding():
    provider = os.environ.get("TRIPPILOT_EMBEDDING_PROVIDER") or "openai"
    if provider == "openai":
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise SystemExit("OPENAI_API_KEY 미설정 — 실임베딩 없이는 적재하지 않는다")
        import openai

        from trippilot.llm_gateway.adapters.openai_embedding import OpenAiEmbeddingAdapter

        return OpenAiEmbeddingAdapter(
            openai.OpenAI(api_key=api_key, base_url=os.environ.get("OPENAI_BASE_URL") or None)
        )
    if provider == "titan":
        import boto3

        from trippilot.llm_gateway.adapters.titan_embedding import TitanEmbeddingAdapter

        return TitanEmbeddingAdapter(boto3.client("bedrock-runtime"))
    raise SystemExit(f"TRIPPILOT_EMBEDDING_PROVIDER 미지원 값: {provider!r} (openai|titan)")


def main(argv: list[str]) -> int:
    url = os.environ.get("TRIPPILOT_VECTOR_DB_URL")
    if not url:
        print("TRIPPILOT_VECTOR_DB_URL 미설정 — 적재 불가", file=sys.stderr)
        return 2
    import psycopg

    store = PgVectorStore(lambda: psycopg.connect(url))
    embedding = _embedding()
    root = Path(__file__).resolve().parent.parent
    paths = [Path(p) for p in (argv or [str(root / s) for s in _DEFAULT_SEEDS])]
    total = 0
    for path in paths:
        documents = load_kb_file(path, yaml.safe_load)
        count = index_documents(documents, embedding, store)
        kinds = sorted({d.kb.value for d in documents})
        print(f"{path.name}: {count}건 적재 (KB: {', '.join(kinds)})")
        total += count
    print(f"총 {total}건 (dim={embedding.dim}, 멱등 upsert)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
