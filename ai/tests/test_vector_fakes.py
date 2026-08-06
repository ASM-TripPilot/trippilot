"""agent-foundation ⓪ — FakeEmbedding·InMemoryVectorStore PBT (EMB-P1·EMB-P2, business-rules.md §2).

EMB-P1: 같은 텍스트 → 같은 벡터 ∧ len=dim ∧ L2 노름 ≈ 1.0 ∧ 다른 텍스트 → (사실상) 다른 벡터
EMB-P2: 저장 벡터 자신으로 검색 시 top1 = 자신 ∧ score 내림차순 ∧ top_k 상한 준수 ∧ 동점 시 item_id 사전순
"""

from __future__ import annotations

import math

from hypothesis import given, settings
from hypothesis import strategies as st

from tests.fakes.fake_embedding import FakeEmbedding
from tests.fakes.in_memory_vector_store import InMemoryVectorStore

_EMB = FakeEmbedding()  # 기본 dim=1024 (AI-D06, BR-AF-09)
_SMALL_EMB = FakeEmbedding(dim=8)  # 스토어 PBT용 — 결정론 유지, 예제당 비용 절감

_texts = st.text(max_size=50)
_item_ids = st.lists(
    st.text(alphabet="abcdefghij0123456789", min_size=1, max_size=8),
    min_size=1,
    max_size=10,
    unique=True,
)


def _norm(v: tuple[float, ...]) -> float:
    return math.sqrt(sum(x * x for x in v))


# ── EMB-P1 — FakeEmbedding ──────────────────────────────────────────────


@settings(max_examples=30)
@given(text=_texts)
def test_embedding_deterministic_dim_unit_norm(text: str) -> None:
    v1 = _EMB.embed(text)
    v2 = _EMB.embed(text)
    assert v1 == v2  # 결정론 — 같은 텍스트 → 같은 벡터
    assert len(v1) == _EMB.dim == 1024  # BR-AF-09
    assert math.isclose(_norm(v1), 1.0, abs_tol=1e-9)


@settings(max_examples=30)
@given(pair=st.lists(_texts, min_size=2, max_size=2, unique=True))
def test_embedding_distinct_texts_distinct_vectors(pair: list[str]) -> None:
    assert _EMB.embed(pair[0]) != _EMB.embed(pair[1])


@settings(max_examples=20)
@given(texts=st.lists(_texts, max_size=5))
def test_embed_batch_matches_individual(texts: list[str]) -> None:
    assert _EMB.embed_batch(texts) == tuple(_EMB.embed(t) for t in texts)


# ── EMB-P2 — InMemoryVectorStore ────────────────────────────────────────


def _seeded_store(item_ids: list[str]) -> tuple[InMemoryVectorStore, dict[str, tuple[float, ...]]]:
    store = InMemoryVectorStore()
    vectors = {iid: _SMALL_EMB.embed(f"t:{iid}") for iid in item_ids}
    for iid, vec in vectors.items():
        store.upsert("intent_bank", iid, vec, {"id": iid})
    return store, vectors


@settings(max_examples=40)
@given(item_ids=_item_ids)
def test_search_top1_is_self_and_scores_descending(item_ids: list[str]) -> None:
    store, vectors = _seeded_store(item_ids)
    target = item_ids[0]
    hits = store.search("intent_bank", vectors[target], top_k=len(item_ids))
    assert hits[0].item_id == target
    assert math.isclose(hits[0].score, 1.0, abs_tol=1e-9)
    scores = [h.score for h in hits]
    assert scores == sorted(scores, reverse=True)
    for prev, nxt in zip(hits, hits[1:]):
        if prev.score == nxt.score:
            assert prev.item_id < nxt.item_id  # 동점 → item_id 사전순


@settings(max_examples=40)
@given(item_ids=_item_ids, k=st.integers(min_value=0, max_value=15))
def test_search_respects_top_k_including_overflow(item_ids: list[str], k: int) -> None:
    store, vectors = _seeded_store(item_ids)
    hits = store.search("intent_bank", vectors[item_ids[0]], top_k=k)
    assert len(hits) == min(k, len(item_ids))  # k > 보유량 → 전량 반환, k=0 → 빈 튜플


def test_upsert_search_delete_roundtrip() -> None:
    store = InMemoryVectorStore()
    vec = (1.0, 0.0, 0.0)
    store.upsert("persona", "u1", vec, {"tag": "old"})
    store.upsert("persona", "u1", vec, {"tag": "new"})  # 같은 id 재삽입 = 덮어쓰기
    hits = store.search("persona", vec, top_k=10)
    assert len(hits) == 1
    assert hits[0].payload == {"tag": "new"}

    store.delete("persona", "u1")
    assert store.search("persona", vec, top_k=10) == ()
    store.delete("persona", "missing")  # 없는 id 삭제는 무해 (멱등)
    store.delete("no_such_collection", "u1")  # 없는 collection도 무해


def test_collections_are_isolated() -> None:
    store = InMemoryVectorStore()
    vec = (0.0, 1.0)
    store.upsert("intent_bank", "i1", vec, {})
    assert store.search("poi_desc", vec, top_k=5) == ()


def test_tie_breaks_by_item_id_lexicographic() -> None:
    store = InMemoryVectorStore()
    vec = (1.0, 0.0, 0.0)
    for iid in ("banana", "apple", "cherry"):  # 동일 벡터 → 전부 동점(score=1.0)
        store.upsert("poi_desc", iid, vec, {})
    hits = store.search("poi_desc", vec, top_k=3)
    assert [h.item_id for h in hits] == ["apple", "banana", "cherry"]
