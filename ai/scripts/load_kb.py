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
멱등: 저장된 payload(본문 포함)가 seed 와 같은 문서는 건너뛰고, 새 문서·바뀐 문서만
임베딩해 upsert 한다 — 몇 번 실행해도 행이 늘지 않는다. seed 에서 지운 문서의 옛 행은
지우지 않는다(남는다).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import yaml

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from trippilot.agents.adapters.pgvector_store import PgVectorStore  # noqa: E402
from trippilot.agents.planb.kb_retrieval import index_documents, load_kb_file  # noqa: E402
from trippilot.agents.planb.directives import (  # noqa: E402
    directive_documents,
    load_directive_file,
)

# KB-5(장소 지식)도 기본이다 — 빠져 있어 DEV 에는 상황·지시어만 적재돼 있었고, 재계획
# 프롬프트의 후보 줄에 장소 설명이 한 건도 붙지 않았다(로컬은 손으로 넣어 1,470건).
_DEFAULT_SEEDS = (
    "data/planb_situation_kb.yaml", "data/replan_directives.yaml",
    # KB-5 는 이제 **본문 전문 원천**에서 조각을 만든다(`poi_curation/chunking`). 종전의
    # 도입부 통문서 `place_docs.json` 은 이 원천이 대체했다 — 적재가 그 옛 행을 지운다.
    "data/place_corpus_wiki.jsonl.gz",
)
# 지시 사전(KB-4)은 문서 형식이 다르다 — 루트가 `directives` 고 한 지시가 alias 만큼의
# 문서로 펼쳐진다. 파일 이름으로 가르지 않고 **루트 키를 보고** 고른다: 이름 규칙에
# 기대면 파일을 옮기는 순간 조용히 틀린 로더를 탄다.


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


def _documents_of(path: Path):
    """파일 하나 → KB 문서 목록. **루트 키로 형식을 가른다.**

    KB-1~3 seed 는 `documents:`, 지시 사전(KB-4)은 `directives:` 다. 후자는 한 지시가
    라벨 + alias 수만큼의 문서로 펼쳐진다 — 합쳐 한 문서로 넣으면 개별 표현의 신호가
    희석돼 자유 입력 매칭이 나빠진다.
    """
    if path.name.endswith(".jsonl.gz"):
        import gzip
        import json

        from trippilot.poi_curation.chunking import chunk_corpus

        with gzip.open(path, "rt", encoding="utf-8") as f:
            return chunk_corpus(json.loads(line) for line in f if line.strip())
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    if isinstance(raw, dict) and "directives" in raw:
        return directive_documents(load_directive_file(path, yaml.safe_load))
    return load_kb_file(path, yaml.safe_load)


def _skip_already_indexed(documents, embedding, url: str):
    """저장본과 같은 문서는 빼고 돌려준다 — 재실행 때 임베딩을 다시 하지 않는다.

    `index_documents` 의 중복 검사는 **목록 안의 doc_id 중복**을 잡는 것이지 DB 존재
    확인이 아니다. upsert 가 멱등이라 데이터는 안 깨지지만 **임베딩 비용은 전부 다시
    든다** — KB-5 2천 건대에서 OOM 으로 중간에 죽고 재실행했더니 이미 넣은 640건을
    15분 들여 다시 임베딩했다(2026-09-19 실측). 포트에 존재 조회를 더하지 않고 여기서
    직접 본다: 적재는 오프라인 작업이라 스크립트가 DB 를 알아도 된다.

    **같은지는 존재가 아니라 저장된 payload 로 본다.** 존재만 보던 때는 seed 에서 본문을
    고쳐도 매 배포 적재가 "기적재" 로 건너뛰어 옛 벡터·payload 가 영영 남았다. payload 의
    `text` 가 곧 임베딩 입력이라(`index_documents` 가 `d.text` 를 임베딩) 본문 변경이 여기서
    잡힌다. `poi_ref`·metadata 만 바뀐 문서도 다시 넣는다 — 검색이 payload 의 그 값을
    그대로 돌려주므로(`poi_ref` 는 closed-set 교차에 쓰인다) 낡으면 안 되고, 드문 일이라
    재임베딩 비용은 작다.
    """
    import psycopg

    from trippilot.agents.planb.kb_retrieval import collection_for

    wanted: dict[str, set[str]] = {}
    for d in documents:
        wanted.setdefault(collection_for(d.kb, embedding.model_id), set()).add(d.doc_id)
    stored: dict[tuple[str, str], dict] = {}
    with psycopg.connect(url) as conn:
        for collection, ids in wanted.items():
            rows = conn.execute(
                "select item_id, payload from kb_vectors"
                " where collection = %s and item_id = any(%s)",
                (collection, list(ids)),
            ).fetchall()
            stored |= {(collection, item_id): payload for item_id, payload in rows}
    return [
        d for d in documents
        if stored.get((collection_for(d.kb, embedding.model_id), d.doc_id)) != d.payload()
    ]


# 적재 임베딩 마감. 묶음(`INDEX_BATCH` 64건) 단위라 요청 경로 마감(기본 5초 — 검색 1회용)이
# 맞지 않는다. 로컬 실측 1,458건 4분 ≈ 건당 0.16초 → 64건 ≈ 10초.
LOAD_TIMEOUT_SEC = 180.0


def _use_load_timeout(environ) -> None:
    """적재 동안 임베딩 마감을 `LOAD_TIMEOUT_SEC` 이상으로 올린다 — 더 긴 값만 존중한다.

    `setdefault` 로는 안 된다: ai 파드(배포 적재 단계가 도는 곳) env 에는 요청 경로용 값이
    **빈 문자열로라도** 이미 들어 있어 키가 있으면 덮지 않고, 빈 값은 어댑터가 기본 5초로
    읽는다 — 첫 묶음에서 끊겨 배포 적재 단계가 8초 만에 실패했다(2026-10-04).
    """
    current = float(environ.get("TRIPPILOT_EMBEDDING_TIMEOUT_SEC") or 0)
    if current < LOAD_TIMEOUT_SEC:
        environ["TRIPPILOT_EMBEDDING_TIMEOUT_SEC"] = str(LOAD_TIMEOUT_SEC)


# 원천 조각 적재의 시간 예산(초). 배포의 KB 적재 Job 은 90분 제한(`runtime_kb.DEADLINE_SEC`)이고 같은
# 임베딩 파드가 실시간 질의도 받는다. 첫 적재(조각 수만 건)가 그 안에 다 안 들어갈 수 있어 **문서 단위로
# 끊고 정상 종료**한다 — upsert 가 멱등이고 저장본과 같은 조각은 건너뛰므로 다음 배포가 이어받는다.
# 실패로 끝내면 배포 전체가 빨강이 되고, 끊지 않으면 Job 이 죽어 마지막 묶음이 반쯤 남는다.
KB_LOAD_BUDGET_SEC = float(os.environ.get("TRIPPILOT_KB_LOAD_BUDGET_SEC") or 3600)


def _index_corpus(documents, embedding, store, budget_sec: float = KB_LOAD_BUDGET_SEC):
    """조각을 **원문 문서 단위**로 적재한다 — 예산을 넘기면 다음 문서부터 멈춘다. (적재 수, 끝난 원문 id)."""
    import time

    groups: dict[str, list] = {}
    for d in documents:
        groups.setdefault(d.doc_id.split("#", 1)[0], []).append(d)
    from trippilot.agents.planb.kb_retrieval import INDEX_BATCH

    start, count, done = time.monotonic(), 0, set()
    batch: list = []
    bases: list[str] = []
    for base, docs in groups.items():
        if time.monotonic() - start > budget_sec:
            break
        batch += docs
        bases.append(base)
        if len(batch) >= INDEX_BATCH:  # 문서 경계에서만 끊되 임베딩 요청은 꽉 채운다
            count += index_documents(batch, embedding, store)
            done.update(bases)
            batch, bases = [], []
    if batch:
        count += index_documents(batch, embedding, store)
        done.update(bases)
    return count, frozenset(done)


def main(argv: list[str]) -> int:
    # 대량 적재는 런타임 질의와 마감이 다르다. 어댑터 기본 5초는 **질의 1건** 기준이고,
    # 여기서는 한 요청에 수십 건을 태운다(로컬 KURE-v1 실측 건당 ~1.4초 — 기본 배치
    # 64건이면 90초대). 안 올리면 413 이 아니라 타임아웃으로 죽어서 원인이 엉뚱한
    # 곳을 가리킨다. 머신이 바쁘면 더 걸리므로 넉넉히 준다.
    _use_load_timeout(os.environ)
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
        documents = _documents_of(path)
        kinds = sorted({d.kb.value for d in documents})
        fresh = _skip_already_indexed(documents, embedding, url)
        if len(fresh) != len(documents):
            print(f"{path.name}: 기적재 {len(documents) - len(fresh)}건 건너뜀")
        if path.name.endswith(".jsonl.gz"):
            count, done = _index_corpus(fresh, embedding, store)
            # 청킹 전 통문서(`wiki:{ref}`)가 같은 collection 에 남아 있으면 지운다 — 이 스크립트는 seed 에서
            # 빠진 행을 안 지우므로(docstring) 여기서만 명시적으로. **조각이 다 들어간 문서만** 지운다:
            # 시간 예산에 걸려 멈춘 문서의 통문서를 먼저 지우면 그 장소는 다음 배포까지 아무 설명도 없다.
            from trippilot.agents.planb.kb_retrieval import collection_for
            from trippilot.poi_curation.chunking import base_ids

            pending = base_ids(fresh) - done
            stale = base_ids(documents) - pending
            for doc_id in stale:
                store.delete(collection_for(documents[0].kb, embedding.model_id), doc_id)
            print(f"{path.name}: {count}건 적재 · 청킹 전 통문서 {len(stale)}건 정리"
                  + (f" · 시간 예산으로 {len(pending)}건 다음 배포로" if pending else ""))
        else:
            count = index_documents(fresh, embedding, store)
            print(f"{path.name}: {count}건 적재 (KB: {', '.join(kinds)})")
        total += count
    provider = os.environ.get("TRIPPILOT_EMBEDDING_PROVIDER") or "openai"
    print(f"총 {total}건 (dim={embedding.dim}, provider={provider}, 멱등 upsert)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
