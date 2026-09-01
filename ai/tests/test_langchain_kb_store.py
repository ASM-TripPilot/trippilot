"""LangChain 이음매 (TRIP-522) — 표면이 우리 계약을 지키는지.

MMR 의 검색 품질은 여기서 재지 않는다(실 임베딩·실 KB 필요, 결과는
`ai/docs/langchain-도입-측정.md`). 여기서 막는 것은 **계약 위반**이다:
kb 라벨 오염 통과, 적재 경로 우회, KbHit 왕복 손실.
"""

from __future__ import annotations

import pytest

from tests.fakes.fake_embedding import FakeEmbedding
from tests.fakes.in_memory_vector_store import InMemoryVectorStore
from trippilot.agents.adapters.langchain_kb_store import (
    KbVectorStore,
    MmrKbRetriever,
    PortEmbeddings,
    to_kb_hits,
)
from trippilot.agents.planb.kb_retrieval import KB_COLLECTIONS, collection_for
from trippilot.domain.kb import KbKind

_COLLECTION = collection_for(KbKind.SITUATION)


def _seed(store: InMemoryVectorStore, embedding: FakeEmbedding, docs, kb_label="SITUATION"):
    for doc_id, text in docs:
        store.upsert(
            _COLLECTION,
            doc_id,
            embedding.embed(text),
            {"kb": kb_label, "doc_id": doc_id, "text": text, "poi_ref": None,
             "metadata": {"reasons": ["weather"]}},
        )


def _store() -> tuple[KbVectorStore, InMemoryVectorStore, FakeEmbedding]:
    emb, raw = FakeEmbedding(), InMemoryVectorStore()
    return KbVectorStore(KbKind.SITUATION, _COLLECTION, emb, raw), raw, emb


def test_similarity_search_returns_documents_with_metadata() -> None:
    lc, raw, emb = _store()
    _seed(raw, emb, [("d1", "우천 시 실내"), ("d2", "폭염 시 냉방")])
    docs = lc.similarity_search("우천", k=2)
    assert {d.page_content for d in docs} == {"우천 시 실내", "폭염 시 냉방"}
    assert {d.metadata["doc_id"] for d in docs} == {"d1", "d2"}
    assert all("score" in d.metadata for d in docs)
    # payload 의 metadata 가 평평하게 합쳐진다 (소비 측이 두 겹을 안 파게)
    assert all(d.metadata["reasons"] == ["weather"] for d in docs)


def test_foreign_kb_label_is_excluded() -> None:
    """collection 오염 방어 — `kb_retrieval.retrieve` 와 같은 기준.

    이게 빠지면 다른 KB 문서가 상황 컨텍스트로 섞여 들어가고, 라벨이 틀린 채로
    프롬프트까지 간다.
    """
    lc, raw, emb = _store()
    _seed(raw, emb, [("ok", "맞는 라벨")])
    _seed(raw, emb, [("bad", "틀린 라벨")], kb_label="PERSONA")
    docs = lc.similarity_search("라벨", k=5)
    assert [d.metadata["doc_id"] for d in docs] == ["ok"]


def test_blank_query_or_nonpositive_k_returns_empty() -> None:
    """`retrieve` 와 같은 계약 — 질의가 없으면 검색도 없다."""
    lc, raw, emb = _store()
    _seed(raw, emb, [("d1", "무언가")])
    assert lc.similarity_search("   ", k=3) == []
    assert lc.similarity_search("질의", k=0) == []
    assert lc.max_marginal_relevance_search("  ", k=3) == []


def test_ingest_paths_are_refused() -> None:
    """적재 경로가 둘이 되면 차원·kb 라벨 검증(index_documents)을 우회하는 문이 생긴다."""
    lc, _, emb = _store()
    with pytest.raises(NotImplementedError, match="index_documents"):
        lc.add_texts(["x"])
    with pytest.raises(NotImplementedError, match="load_kb"):
        KbVectorStore.from_texts(["x"], PortEmbeddings(emb))


def test_to_kb_hits_round_trips() -> None:
    """LangChain Document → KbHit. 경계를 여기서 닫는다 — Document 가 rag.py 로
    들어가면 LangChain 이 파이프라인 타입으로 승격된다."""
    lc, raw, emb = _store()
    _seed(raw, emb, [("d1", "본문")])
    hits = to_kb_hits(KbKind.SITUATION, lc.similarity_search("본문", k=1))
    assert len(hits) == 1
    hit = hits[0]
    assert (hit.kb, hit.doc_id, hit.text) == (KbKind.SITUATION, "d1", "본문")
    assert hit.metadata == {"reasons": ["weather"]}  # 내부 키(score·doc_id)는 안 샌다


def test_port_embeddings_delegate_to_our_port() -> None:
    """LangChain 이 자기 임베딩 구현을 갖게 두지 않는다 — 모델이 둘이 되면
    적재 벡터와 질의 벡터의 공간이 갈라진다(팀 결정 2026-08-22)."""
    emb = FakeEmbedding()
    lc_emb = PortEmbeddings(emb)
    assert lc_emb.embed_query("가") == list(emb.embed("가"))
    assert lc_emb.embed_documents(["가", "나"]) == [list(v) for v in emb.embed_batch(["가", "나"])]


def test_mmr_retriever_returns_empty_for_unmapped_kb() -> None:
    emb, raw = FakeEmbedding(), InMemoryVectorStore()
    retriever = MmrKbRetriever(emb, raw, {})  # 매핑 비어 있음
    assert retriever.retrieve(KbKind.SITUATION, "질의", 3) == ()


def test_mmr_retriever_returns_kb_hits() -> None:
    emb, raw = FakeEmbedding(), InMemoryVectorStore()
    _seed(raw, emb, [("d1", "우천 실내"), ("d2", "폭염 냉방"), ("d3", "강풍 저지대")])
    retriever = MmrKbRetriever(emb, raw, KB_COLLECTIONS, lambda_mult=1.0, fetch_k=3)
    hits = retriever.retrieve(KbKind.SITUATION, "우천", 2)
    assert len(hits) == 2
    assert all(h.kb is KbKind.SITUATION for h in hits)


@pytest.mark.parametrize("bad", [-0.1, 1.1])
def test_mmr_lambda_is_validated(bad: float) -> None:
    with pytest.raises(ValueError, match="lambda_mult"):
        MmrKbRetriever(FakeEmbedding(), InMemoryVectorStore(), KB_COLLECTIONS, lambda_mult=bad)
