"""PlaceSearch — KB-5 열린 검색의 I/O·시한·동시성. 실 호출 0 (임베딩·스토어 대역).

증명하는 것:
  ① 범위가 비면(조각이 있는 장소 0) 스토어·임베딩을 부르지 않고 EMPTY — `item_ids` 가 None(필터 없음 = 전역 검색)으로 새지 않는다
  ② 스토어에는 범위의 실재 조각 id 만, 비지 않은 frozenset 으로 한 번 · top_k = id 수
  ③ id 상한을 넘으면 규칙 순서 앞 장소부터 통째로 담고 멈춘다(결정론)
  ④ 예외 → ERROR · 시한 초과 → TIMEOUT · 동시 상한 → BUSY · 근거 없음 → NO_EVIDENCE — 늘 상태값(예외를 올리지 않는다).
     조회 전 구간(색인 읽기·일꾼 내기)의 예외도 ERROR 이고, 내지 못한 조회는 동시 상한 자리를 돌려준다
  ⑤ 결과 ⊆ 범위 — 스토어가 범위 밖 poi_ref 를 내도 버린다(INV-1)
  ⑥ warm 과 search 가 같은 질의를 두 번 임베딩하지 않는다
"""

from __future__ import annotations

import threading
import time

from trippilot.agents.planb import place_search as ps
from trippilot.agents.planb.kb_retrieval import collection_for
from trippilot.agents.planb.place_search import PlaceSearch, scope_ids
from trippilot.domain.kb import KbKind
from trippilot.poi_curation.hybrid_rank import OpenQuery
from trippilot.ports.vector_store_port import VectorHit

_Q = OpenQuery(("실내", "전시"), "실내 전시")
_INDEX = {"r0": ("overview:r0#0", "overview:r0#1"), "r1": ("overview:r1#0",), "r2": ("wiki:r2#0",)}


class _Embedding:
    dim, model_id = 3, "fake-emb"

    def __init__(self, *, fail: bool = False, delay: float = 0.0) -> None:
        self.calls: list[str] = []
        self._fail, self._delay = fail, delay

    def embed(self, text: str):
        self.calls.append(text)
        time.sleep(self._delay)
        if self._fail:
            raise RuntimeError("embedding down")
        return (1.0, 0.0, 0.0)

    def embed_batch(self, texts):
        return tuple(self.embed(t) for t in texts)


class _Store:
    """VectorStorePort 대역 — 호출을 기록하고 정해 둔 조각을 item_ids 로 거른다. `extra` 는 필터를 무시하고 섞는 행(오염 방어 시험)."""

    def __init__(self, docs: dict[str, tuple[str, str]], *, extra=(), delay: float = 0.0, fail: bool = False) -> None:
        self.calls: list[dict] = []
        self._docs, self._extra, self._delay, self._fail = docs, tuple(extra), delay, fail
        self.release = threading.Event()

    def search(self, collection, vector, top_k, *, item_ids=None):
        self.calls.append({"collection": collection, "top_k": top_k, "item_ids": item_ids})
        if self._delay:
            self.release.wait(self._delay)
        if self._fail:
            raise ConnectionError("store down")
        rows = [(i, ref, text) for i, (ref, text) in self._docs.items() if item_ids is not None and i in item_ids]
        rows += list(self._extra)
        return tuple(VectorHit(i, 0.9 - n * 0.01, {"kb": "POI_DESC", "text": t, "poi_ref": r, "metadata": {}})
                     for n, (i, r, t) in enumerate(rows))


_DOCS = {"overview:r0#0": ("r0", "야외 공원"), "overview:r0#1": ("r0", "잔디 광장"),
         "overview:r1#0": ("r1", "실내 전시관이 있다"), "wiki:r2#0": ("r2", "전시 체험")}


def _search(store=None, embedding=None, *, refs=("r0", "r1", "r2"), wait: float = 2.0, max_ids: int = ps.MAX_IDS):
    store = store if store is not None else _Store(_DOCS)
    embedding = embedding if embedding is not None else _Embedding()
    searcher = PlaceSearch(embedding, store, index=lambda: _INDEX, max_ids=max_ids)
    return searcher.search(_Q, list(refs), wait, trace="t"), store, embedding, searcher


def test_empty_scope_never_calls_the_store_or_the_embedding() -> None:
    for refs in ((), ("nope", "also-nope"), ("",)):
        (status, ranks), store, embedding, _ = _search(refs=refs)
        assert (status, ranks) == ("EMPTY", {}) and store.calls == [] and embedding.calls == []


def test_store_gets_only_the_real_chunk_ids_of_the_scope_as_a_non_empty_frozenset() -> None:
    (status, ranks), store, _, _ = _search(refs=("r1", "ghost", "r2", "r1"))
    (call,) = store.calls
    assert isinstance(call["item_ids"], frozenset) and call["item_ids"] == {"overview:r1#0", "wiki:r2#0"}
    assert call["top_k"] == 2 and call["collection"] == collection_for(KbKind.POI_DESC, "fake-emb")
    assert status == "OK" and ranks == {"r1": 1, "r2": 2}


def test_id_cap_cuts_whole_places_in_rule_order() -> None:
    refs, ids = scope_ids(["r1", "r0", "r2"], _INDEX, cap=2)
    assert refs == ["r1"] and ids == {"overview:r1#0"}  # r0 은 두 조각이라 넘친다 — 거기서 멈춘다(반쪽 장소 없음)
    assert scope_ids(["r1", "r0", "r2"], _INDEX, cap=4) == (["r1", "r0", "r2"], frozenset({*_INDEX["r0"], *_INDEX["r1"], *_INDEX["r2"]}))
    assert scope_ids(["r0"], _INDEX, cap=1) == ([], frozenset())


def test_store_or_embedding_failure_is_an_error_status() -> None:
    assert _search(_Store(_DOCS, fail=True))[0] == ("ERROR", {})
    assert _search(embedding=_Embedding(fail=True))[0] == ("ERROR", {})


def test_failures_before_the_query_are_an_error_status_too() -> None:
    def broken_index():
        raise TypeError("ids is null")

    store, embedding = _Store(_DOCS), _Embedding()
    searcher = PlaceSearch(embedding, store, index=broken_index)
    searcher.warm(_Q)
    assert searcher.search(_Q, ["r1"], 1.0) == ("ERROR", {}) and store.calls == []
    # 일꾼을 못 낸다(풀이 닫혔다) — 미리 임베딩은 조용히 건너뛰고, 검색은 ERROR 이며 자리를 돌려준다(상한만큼 불러도 BUSY 가 아니다)
    closed = PlaceSearch(_Embedding(), _Store(_DOCS), index=lambda: _INDEX)
    closed._pool.shutdown()
    closed.warm(_Q)
    assert [closed.search(_Q, ["r1"], 1.0)[0] for _ in range(ps.SEARCH_MAX_INFLIGHT + 1)] == ["ERROR"] * (ps.SEARCH_MAX_INFLIGHT + 1)


def test_slow_store_is_a_timeout_status_within_the_wait() -> None:
    store = _Store(_DOCS, delay=5.0)
    t0 = time.monotonic()
    (status, ranks), *_ = _search(store, wait=0.2)
    assert (status, ranks) == ("TIMEOUT", {}) and time.monotonic() - t0 < 1.5
    store.release.set()


def test_busy_when_the_inflight_cap_is_taken() -> None:
    store = _Store(_DOCS, delay=5.0)
    searcher = PlaceSearch(_Embedding(), store, index=lambda: _INDEX)
    try:
        assert [searcher.search(_Q, ["r1"], 0.1)[0] for _ in range(ps.SEARCH_MAX_INFLIGHT)] == ["TIMEOUT"] * ps.SEARCH_MAX_INFLIGHT
        assert searcher.search(_Q, ["r1"], 0.1) == ("BUSY", {})
        assert len(store.calls) == ps.SEARCH_MAX_INFLIGHT  # 바쁠 때는 스토어에 새로 내지 않는다
    finally:
        store.release.set()
    time.sleep(0.2)
    assert searcher.search(_Q, ["r1"], 1.0)[0] == "OK"  # 뒤에서 끝난 조회가 자리를 돌려준다


def test_no_keyword_evidence_is_its_own_status() -> None:
    store = _Store({"overview:r0#0": ("r0", "야외 공원")})
    assert _search(store, refs=("r0",))[0] == ("NO_EVIDENCE", {})


def test_results_never_leave_the_scope() -> None:
    store = _Store(_DOCS, extra=[("overview:zz#0", "zz", "실내 전시 실내 전시"), ("x", None, "실내")])
    (status, ranks), *_ = _search(store, refs=("r1",))
    assert status == "OK" and set(ranks) <= {"r1"}


def test_warm_and_search_embed_the_same_query_once() -> None:
    embedding = _Embedding(delay=0.2)
    searcher = PlaceSearch(embedding, _Store(_DOCS), index=lambda: _INDEX)
    searcher.warm(_Q)
    searcher.warm(_Q)  # 같은 질의를 다시 미리 보내지 않는다
    assert searcher.search(_Q, ["r1"], 2.0)[0] == "OK"
    assert embedding.calls == ["실내 전시"]
