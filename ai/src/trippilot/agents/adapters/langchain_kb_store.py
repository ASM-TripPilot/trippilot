"""KB 벡터 스토어의 LangChain `VectorStore` 표면 (TRIP-522).

정본이 지정한 부분 도입 범위 — `README.md` §"LangChain 적용 범위":
**PlanBAgent RAG 검색·벡터 스토어·임베딩까지만** LangChain 을 쓰고, Orchestrator·
Solver·후보 풀 생성·에이전트 로직은 직접 구현이다.

## 왜 `langchain_postgres.PGVector` 를 안 쓰는가

그쪽은 자기 테이블(`langchain_pg_collection`·`langchain_pg_embedding`)을 만든다.
우리 KB 는 `kb_vectors` 단일 테이블에 있고 DDL 정본이 `docker/vector-init/01-kb-vectors.sql`
이라, 갈아타면 **전량 재적재 + `load_kb.py`·`smoke_vector.py`·테스트 재작성**이 따라온다.
얻는 것은 없다 — 검색은 이미 돌고 있다. 그래서 **스키마는 우리 것을 그대로 두고
인터페이스만 LangChain 것을 입힌다.** 이 클래스는 `VectorStorePort`·`EmbeddingPort`
위의 얇은 표면이고, 실제 SQL 은 `PgVectorStore` 가 그대로 친다.

## 무엇을 얻는가

`as_retriever(...)` 한 줄로 LangChain 검색기 생태계가 열린다 — MMR(중복 억제),
score threshold, ensemble/hybrid, contextual compression, 리랭커. 지금 필요한 건
MMR 하나지만, 직접 짜면 그때마다 우리 코드가 는다.

## 무엇을 **안** 넘기는가 — 네 불변식은 여기 없다

이 클래스는 **검색만** 한다. 후보 자격(INV-1)은 `rag.closed_set_filter` 가 풀과
교차한 뒤에만 생기고, 시각·순서(INV-2)는 솔버, 결정론 폴백(INV-4)은
`PlanBRagPipeline._select` 소유다. `RetrievalQA` 같은 완제품 체인으로 파이프라인을
대체하지 않는 이유가 이것 — 그 체인에는 게이트·폴백·규칙 랭킹을 끼울 자리가 없다.

적재는 이 클래스가 하지 않는다(`add_texts`·`from_texts` 는 거부) — 적재 경로가 둘이
되면 차원·collection 라벨 검증(`kb_retrieval.index_documents`)을 우회하는 문이 생긴다.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from typing import Any

import numpy as np
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings
from langchain_core.vectorstores import VectorStore
from langchain_core.vectorstores.utils import maximal_marginal_relevance

from trippilot.domain.kb import KbHit, KbKind
from trippilot.ports.embedding_port import EmbeddingPort
from trippilot.ports.vector_store_port import VectorStorePort

# LangChain 이 `Document.metadata` 로 돌려주는 키. `KbHit` 필드명을 그대로 쓴다 —
# 소비 측이 두 이름을 배우지 않게.
DOC_ID = "doc_id"
POI_REF = "poi_ref"
SCORE = "score"


class PortEmbeddings(Embeddings):
    """`EmbeddingPort` → LangChain `Embeddings`.

    LangChain 이 자기 임베딩 구현(HuggingFaceEmbeddings 등)을 따로 갖게 두지 않는다.
    모델이 둘이 되면 적재 벡터와 질의 벡터의 공간이 갈라진다 — 팀 결정
    2026-08-22("provider 를 바꾸면 전량 재적재, 쿼리 단위 폴백 금지")과 같은 취지다.
    """

    def __init__(self, port: EmbeddingPort) -> None:
        self._port = port

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [list(v) for v in self._port.embed_batch(list(texts))]

    def embed_query(self, text: str) -> list[float]:
        return list(self._port.embed(text))


class KbVectorStore(VectorStore):
    """KB 한 종류(collection 하나)의 LangChain 표면. 읽기 전용."""

    def __init__(
        self, kb: KbKind, collection: str, embedding: EmbeddingPort, store: VectorStorePort
    ) -> None:
        """`collection` 은 주입받는다 — KB→collection 매핑 정본은
        `kb_retrieval.KB_COLLECTIONS` 한 곳이고, 여기서 다시 풀면 드리프트 지점이 는다.
        (형제 패키지 import 금지 규칙 L-2 도 같은 방향을 가리킨다.)"""
        self._kb = kb
        self._collection = collection
        self._store = store
        self._port_embedding = embedding
        self._embeddings = PortEmbeddings(embedding)

    @property
    def embeddings(self) -> Embeddings:
        return self._embeddings

    # ── 검색 ────────────────────────────────────────────────────────────
    def _search(self, vector: Sequence[float], k: int) -> list[tuple[Document, float]]:
        """collection 오염 방어는 `kb_retrieval.retrieve` 와 같은 기준으로 한다 —
        payload 의 `kb` 라벨이 요청 KB 와 다르면 제외."""
        out: list[tuple[Document, float]] = []
        for hit in self._store_search(vector, k):
            payload = hit.payload if isinstance(hit.payload, Mapping) else {}
            if payload.get("kb") != self._kb.value:
                continue
            text = payload.get("text")
            if not isinstance(text, str):
                continue
            metadata: dict[str, Any] = {
                DOC_ID: hit.item_id,
                POI_REF: payload.get("poi_ref"),
                SCORE: hit.score,
            }
            extra = payload.get("metadata")
            if isinstance(extra, Mapping):
                metadata.update(extra)
            out.append((Document(page_content=text, metadata=metadata), hit.score))
        return out

    def _store_search(self, vector: Sequence[float], k: int):
        return self._store.search(self._collection, tuple(float(x) for x in vector), k)

    def similarity_search(self, query: str, k: int = 4, **kwargs: Any) -> list[Document]:
        return [doc for doc, _ in self.similarity_search_with_score(query, k, **kwargs)]

    def similarity_search_with_score(
        self, query: str, k: int = 4, **kwargs: Any
    ) -> list[tuple[Document, float]]:
        if k < 1 or not query.strip():
            return []  # `retrieve` 와 같은 계약 — 질의가 없으면 검색도 없다
        return self._search(self._port_embedding.embed(query), k)

    def similarity_search_by_vector(
        self, embedding: list[float], k: int = 4, **kwargs: Any
    ) -> list[Document]:
        return [doc for doc, _ in self._search(embedding, k)]

    def max_marginal_relevance_search(
        self,
        query: str,
        k: int = 4,
        fetch_k: int = 20,
        lambda_mult: float = 0.5,
        **kwargs: Any,
    ) -> list[Document]:
        """중복을 억제한 k건. `fetch_k` 건을 받아 MMR 로 추린다.

        같은 reason 버킷 안에 수렴하는 문서가 여럿일 때(우리 KB 의 기상 문서군이
        그렇다) 유사도 상위가 서로 비슷한 말이 되는 걸 막는다.
        """
        if k < 1 or not query.strip():
            return []
        vector = self._port_embedding.embed(query)
        pool = self._search(vector, max(fetch_k, k))
        if not pool:
            return []
        picked = maximal_marginal_relevance(
            np.array(vector, dtype=np.float32),
            self._embeddings.embed_documents([doc.page_content for doc, _ in pool]),
            k=min(k, len(pool)),
            lambda_mult=lambda_mult,
        )
        return [pool[i][0] for i in picked]

    # ── 적재 금지 ────────────────────────────────────────────────────────
    def add_texts(self, texts: Iterable[str], metadatas: list[dict] | None = None, **kw: Any):
        raise NotImplementedError(
            "적재는 kb_retrieval.index_documents 소유 — 여기로 넣으면 차원·kb 라벨 검증을 우회한다"
        )

    @classmethod
    def from_texts(cls, texts: list[str], embedding: Embeddings, metadatas=None, **kw: Any):
        raise NotImplementedError("적재 경로는 scripts/load_kb.py 하나다")


def to_kb_hits(kb: KbKind, docs: Sequence[Document]) -> tuple[KbHit, ...]:
    """LangChain `Document` → 우리 `KbHit`. 파이프라인은 KbHit 만 안다.

    경계를 여기서 닫는 이유: `Document` 가 `rag.py` 안까지 들어오면 LangChain 이
    파이프라인 타입으로 승격되고, 나중에 검색기를 바꿀 때 소비 측이 같이 흔들린다.
    """
    return tuple(
        KbHit(
            kb=kb,
            doc_id=str(doc.metadata.get(DOC_ID, "")),
            text=doc.page_content,
            score=float(doc.metadata.get(SCORE, 0.0)),
            poi_ref=doc.metadata.get(POI_REF),
            metadata={
                k: v for k, v in doc.metadata.items() if k not in (DOC_ID, SCORE, POI_REF)
            },
        )
        for doc in docs
    )


class MmrKbRetriever:
    """`KbRetrieverPort` 구현 — LangChain 검색기 경유 MMR (TRIP-522).

    같은 reason 버킷 안에 수렴하는 문서가 여럿일 때(우리 KB 의 기상 문서군이 그렇다)
    유사도 상위가 서로 비슷한 말로 채워지는 걸 막는다. `lambda_mult` 1.0 이면
    유사도만 보므로 기본 검색과 같아진다 — 즉 이 값이 유일한 행동 스위치다.
    """

    def __init__(
        self,
        embedding: EmbeddingPort,
        store: VectorStorePort,
        collections: Mapping[KbKind, str],
        *,
        lambda_mult: float = 0.5,
        fetch_k: int = 12,
    ) -> None:
        if not 0.0 <= lambda_mult <= 1.0:
            raise ValueError("lambda_mult ∈ [0, 1]")
        if fetch_k < 1:
            raise ValueError("fetch_k ≥ 1")
        self._embedding = embedding
        self._store = store
        self._collections = dict(collections)
        self._lambda = lambda_mult
        self._fetch_k = fetch_k

    def retrieve(self, kb: KbKind, query: str, top_k: int) -> tuple[KbHit, ...]:
        collection = self._collections.get(kb)
        if collection is None:
            return ()
        store = KbVectorStore(kb, collection, self._embedding, self._store)
        docs = store.max_marginal_relevance_search(
            query, k=top_k, fetch_k=max(self._fetch_k, top_k), lambda_mult=self._lambda
        )
        return to_kb_hits(kb, docs)
