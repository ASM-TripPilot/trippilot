"""TRIP-426 — 실어댑터 3종: PgVectorStore · OpenAiEmbedding · TitanEmbedding.

증명하는 것 (DB·API 전부 fake — 실 호출 0, D37):
  ① PgVectorStore — SQL·파라미터 형태(upsert ON CONFLICT · search 캐스트·정렬 ·
     delete), 벡터 리터럴 직렬화, 행 → VectorHit 매핑(payload str/dict 변주 흡수)
  ② OpenAiEmbedding — dimensions 명시 호출, index 기준 재정렬, 차원 위반 즉시
     예외(BR-AF-09 — 조용한 절단·패딩 금지), 빈 배치 무호출
  ③ TitanEmbedding — invoke_model 본문(dimensions·normalize), 응답 파싱, 차원
     위반 예외, 배치 = 단건 루프(순서 보존)
"""

from __future__ import annotations

import json
from io import BytesIO
from types import SimpleNamespace

import pytest

from trippilot.agents.adapters.pgvector_store import PgVectorStore
from trippilot.llm_gateway.adapters.openai_embedding import OpenAiEmbeddingAdapter
from trippilot.llm_gateway.adapters.titan_embedding import TitanEmbeddingAdapter


# ── psycopg 3 호환 fake (with 컨텍스트 + cursor) ─────────────────────


class FakeCursor:
    def __init__(self, rows: list) -> None:
        self.rows = rows
        self.executed: list[tuple[str, tuple]] = []

    def execute(self, sql: str, params: tuple) -> None:
        self.executed.append((sql, params))

    def fetchall(self) -> list:
        return self.rows

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeConnection:
    def __init__(self, cursor: FakeCursor) -> None:
        self._cursor = cursor

    def cursor(self) -> FakeCursor:
        return self._cursor

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _store(rows: list = ()) -> tuple[PgVectorStore, FakeCursor]:
    cursor = FakeCursor(list(rows))
    return PgVectorStore(lambda: FakeConnection(cursor)), cursor


# ── ① PgVectorStore ─────────────────────────────────────────────────


def test_upsert_sends_on_conflict_with_vector_literal() -> None:
    store, cursor = _store()
    store.upsert("planb_situation", "doc-1", (1.0, 0.5), {"k": "v"})
    sql, params = cursor.executed[0]
    assert "ON CONFLICT (collection, item_id)" in sql
    assert "%s::vector" in sql and "%s::jsonb" in sql
    assert params == ("planb_situation", "doc-1", "[1.0,0.5]", '{"k": "v"}')


def test_search_orders_by_distance_then_item_id() -> None:
    store, cursor = _store(rows=[("b", 0.9, {"x": 1}), ("a", 0.9, '{"x": 2}')])
    hits = store.search("persona", (0.0, 1.0), top_k=2)
    sql, params = cursor.executed[0]
    assert "ORDER BY embedding <=> %s::vector, item_id" in sql  # 결정론 tie-break
    assert "1 - (embedding <=> %s::vector)" in sql  # score = 코사인 유사도 (fake 동형)
    assert params == ("[0.0,1.0]", "persona", "[0.0,1.0]", 2)
    # 행 → VectorHit + payload str/dict 변주 흡수
    assert [(h.item_id, h.score, h.payload) for h in hits] == [
        ("b", 0.9, {"x": 1}), ("a", 0.9, {"x": 2}),
    ]


def test_search_top_k_zero_returns_empty_without_query() -> None:
    store, cursor = _store()
    assert store.search("persona", (1.0,), top_k=0) == ()
    assert cursor.executed == []


def test_delete_targets_collection_and_item() -> None:
    store, cursor = _store()
    store.delete("persona", "doc-9")
    sql, params = cursor.executed[0]
    assert sql.startswith("DELETE FROM kb_vectors")
    assert params == ("persona", "doc-9")


def test_empty_vector_rejected() -> None:
    store, _ = _store()
    with pytest.raises(ValueError, match="빈 벡터"):
        store.upsert("persona", "doc-1", (), {})


# ── ② OpenAiEmbedding ───────────────────────────────────────────────


class FakeOpenAiClient:
    def __init__(self, data: list) -> None:
        self.calls: list[dict] = []
        self._data = data
        self.embeddings = SimpleNamespace(create=self._create)

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(data=self._data)


def _item(index: int, dim: int) -> SimpleNamespace:
    return SimpleNamespace(index=index, embedding=[float(index)] * dim)


def test_openai_embed_batch_requests_fixed_dim_and_reorders_by_index() -> None:
    client = FakeOpenAiClient([_item(1, 4), _item(0, 4)])  # 응답 역순 — index가 정본
    adapter = OpenAiEmbeddingAdapter(client, dim=4)
    vectors = adapter.embed_batch(["a", "b"])
    assert client.calls[0] == {
        "model": "text-embedding-3-small", "input": ["a", "b"], "dimensions": 4
    }
    assert vectors == ((0.0,) * 4, (1.0,) * 4)


def test_openai_wrong_dim_raises_not_truncates() -> None:
    client = FakeOpenAiClient([_item(0, 3)])
    with pytest.raises(ValueError, match="BR-AF-09"):
        OpenAiEmbeddingAdapter(client, dim=4).embed("a")


def test_openai_empty_batch_makes_no_call() -> None:
    client = FakeOpenAiClient([])
    assert OpenAiEmbeddingAdapter(client, dim=4).embed_batch([]) == ()
    assert client.calls == []


def test_openai_default_dim_is_1024() -> None:
    assert OpenAiEmbeddingAdapter(FakeOpenAiClient([])).dim == 1024  # AI-D06


# ── ③ TitanEmbedding ────────────────────────────────────────────────


class FakeBedrockClient:
    def __init__(self, dim: int) -> None:
        self.calls: list[dict] = []
        self._dim = dim

    def invoke_model(self, **kwargs):
        self.calls.append(kwargs)
        n = len(self.calls)
        return {"body": BytesIO(json.dumps({"embedding": [float(n)] * self._dim}).encode())}


def test_titan_embed_sends_dimensions_and_normalize() -> None:
    client = FakeBedrockClient(dim=4)
    vector = TitanEmbeddingAdapter(client, dim=4).embed("우천 대안")
    call = client.calls[0]
    assert call["modelId"] == "amazon.titan-embed-text-v2:0"
    assert json.loads(call["body"]) == {
        "inputText": "우천 대안", "dimensions": 4, "normalize": True
    }
    assert vector == (1.0,) * 4


def test_titan_wrong_dim_raises() -> None:
    client = FakeBedrockClient(dim=3)
    with pytest.raises(ValueError, match="BR-AF-09"):
        TitanEmbeddingAdapter(client, dim=4).embed("a")


def test_titan_batch_loops_preserving_order() -> None:
    client = FakeBedrockClient(dim=2)
    vectors = TitanEmbeddingAdapter(client, dim=2).embed_batch(["a", "b", "c"])
    assert len(client.calls) == 3  # 단건 API — 벤더 배치 없음
    assert vectors == ((1.0, 1.0), (2.0, 2.0), (3.0, 3.0))
