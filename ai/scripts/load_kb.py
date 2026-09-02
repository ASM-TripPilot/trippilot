r"""KB seed → 실 벡터 스토어 적재 (TRIP-427) — CI 밖 수동 실행 전용 (D37).

실행:
    docker compose --profile full up -d ai-vectordb
    TRIPPILOT_VECTOR_DB_URL=postgresql://ai_kb:ai_kb@localhost:5433/ai_kb \
    OPENAI_API_KEY=... \
        uv run python scripts/load_kb.py [data/planb_situation_kb.yaml ...]

임베딩 선택 (TRIPPILOT_EMBEDDING_PROVIDER, 기본 openai):
- openai: OPENAI_API_KEY 필수 (+ OPENAI_BASE_URL 선택)
- titan:  boto3 설치 + AWS 자격 필요 (bedrock-runtime, AWS_REGION)
- local:  sentence-transformers 설치 필요 (기본 KURE-v1, TRIPPILOT_EMBEDDING_MODEL 로 변경)
- http:   별도 임베딩 서비스 (TRIPPILOT_EMBEDDING_BASE_URL 필수, TRIP-517)
          **서비스를 http 로 돌리면 적재도 http 로 해야 한다** — 안 그러면 적재와
          질의가 다른 모델 인스턴스를 타고, 모델이 같아도 검증할 방법이 없다.

전환 규칙(팀 결정 2026-08-22): 임베딩 모델 간 벡터 공간이 비호환이라 쿼리 단위 폴백은
금지 — provider 를 바꾸면 이 스크립트로 **전량 재적재**한다(멱등 upsert라 안전).

**이 규칙은 이제 구조로 강제된다** (TRIP-519): collection 이름에 모델이 들어간다
(`planb_situation__nlpai_lab_kure_v1`). 모델을 바꾸면 새 collection 이 비어 있어
재적재를 안 하면 검색이 **0건**으로 떨어진다 — 옛 벡터를 새 모델로 뒤져 엉터리
순위를 내는 일이 원천적으로 안 생긴다.

**기존 색인 이전** (모델 없는 옛 이름 → 새 이름). 둘 중 하나를 쓴다:

  1) 그냥 다시 적재한다 (권장 — 24건 규모라 몇 초다)
       uv run python scripts/load_kb.py
     그리고 옛 collection 을 지운다:
       DELETE FROM kb_vectors WHERE collection NOT LIKE '%\_\_%';

  2) 이름만 바꾼다 (재임베딩 없이. **적재에 쓴 모델을 확실히 알 때만**)
       UPDATE kb_vectors SET collection = collection || '__nlpai_lab_kure_v1'
        WHERE collection IN ('planb_situation', 'planb_schedule', 'persona');

  2)는 "그 색인이 정말 그 모델로 만들어졌나"를 사람이 보증하는 것이다 — 확신이
  없으면 1)을 쓴다. 그 불확실성이 이 변경을 하게 된 이유다.

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
    if provider == "local":
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as e:  # 의존성에 없다(의도) — 복구 명령을 바로 준다
            raise SystemExit(
                "sentence-transformers 미설치 — `uv pip install sentence-transformers`.\n"
                "  프로젝트 의존성이 아니라서 `uv sync` 하면 다시 지워진다 (boto3 선례)."
            ) from e
        from trippilot.llm_gateway.adapters.sentence_transformer_embedding import (
            DEFAULT_MODEL,
            SentenceTransformerEmbeddingAdapter,
        )

        model_name = os.environ.get("TRIPPILOT_EMBEDDING_MODEL") or DEFAULT_MODEL
        print(f"임베딩 모델: {model_name} (최초 실행은 내려받느라 오래 걸린다)")
        # `model_id` 없이 만들면 어댑터 기본값(KURE-v1)을 쓴다 — 다른 모델을
        # 지정했을 때 엉뚱한 collection 을 보게 된다 (TRIP-519 ①).
        return SentenceTransformerEmbeddingAdapter(
            SentenceTransformer(model_name), model_id=model_name
        )
    if provider == "http":
        # **main.py 와 같은 함수를 쓴다.** 여기서 복사하면 서비스는 HTTP 로, 적재는
        # 로컬 모델로 임베딩하게 되고 두 벡터 공간이 조용히 섞인다 — 둘 다 1024
        # 차원이라 DDL 도 어댑터 검증도 못 잡는다 (TRIP-517 조사에서 드러난 함정).
        from trippilot.llm_gateway.adapters.http_embedding_assembly import http_embedding
        from trippilot.poi_curation.adapters.backend_poi_db import UrllibJsonClient

        return http_embedding(SystemExit, lambda t: UrllibJsonClient(timeout_sec=t))
    raise SystemExit(
        f"TRIPPILOT_EMBEDDING_PROVIDER 미지원 값: {provider!r} (openai|titan|local|http)"
    )


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
    provider = os.environ.get("TRIPPILOT_EMBEDDING_PROVIDER") or "openai"
    print(f"총 {total}건 (dim={embedding.dim}, provider={provider}, 멱등 upsert)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
