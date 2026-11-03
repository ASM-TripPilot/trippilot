"""PlaceSearch — KB-5 열린 검색: 질의 → **범위(호출측 규칙 순서의 장소들) 안의 조각 전부** → 장소별 문서 순위.

`place_knowledge.fetch_place_knowledge` 와 같은 스토어·같은 조회(`retrieve(item_ids=…, top_k=len(ids))`)지만 쓰임이 다르다 — 그쪽은
"후보마다 붙일 조각 하나"를 고르고, 이쪽은 "질의에 근거가 있는 장소의 순서"를 낸다. 순위 규칙(게이트·BM25·RRF)은
`poi_curation.hybrid_rank` 한 곳이고, 이 모듈은 I/O(임베딩·스토어)·시한·동시성만 진다. 도우미 탐색(`dialogue_handlers`)이 먼저 쓰고,
PlanB 후보 추출이 같은 모듈을 쓸 자리다 — 그래서 도우미 타입에 기대지 않는다(입력은 질의·장소 키·시한뿐).

**INV-1** — 결과는 넘겨받은 범위의 부분집합이다(범위 밖 `poi_ref` 는 버린다). 순위일 뿐 후보 자격을 만들지 않는다.
**INV-4** — 예외를 올리지 않는다. 결과는 닫힌 상태값(`STATUSES`)이고, OK 가 아니면 호출측은 규칙 순서 그대로 간다.
**대체 문서(`place_fallback`)는 쓰지 않는다**(2026-11-03 결정) — 짧은 카드 글이 긴 개요 조각을 점수로 밀어낸다.
로그는 한 줄(`place_search status=… places=… chunks=… ms=… trace=…`) — 질의 원문은 남기지 않는다(SEC-U8-06).
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import Future, ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout

from trippilot.agents.planb.kb_retrieval import retrieve
from trippilot.domain.kb import KbKind
from trippilot.poi_curation.hybrid_rank import OpenQuery, chunk_index, doc_rank
from trippilot.ports.embedding_port import EmbeddingPort
from trippilot.ports.vector_store_port import VectorStorePort

log = logging.getLogger(__name__)

STATUSES = frozenset({"OK", "EMPTY", "NO_EVIDENCE", "TIMEOUT", "BUSY", "ERROR"})
# 동시에 도는 검색 상한 — 넘으면 새로 내지 않는다(BUSY). 시한을 넘겨 뒤에서 도는 조회가 느린 스토어에 쌓이지 않게(`PlaceIntro` 와 같은 꼴)
SEARCH_MAX_INFLIGHT = 2
# 한 번에 넘기는 조각 id 상한 — 넘으면 규칙 순서 앞 장소부터 결정론으로 자른다(장소를 반쪽만 넣지 않는다).
# 결정론 측정(`scripts/measure/measure_assistant_open_search.py`, 2026-11-04 · 37사례): 범위(규칙 정렬을 지난 장소 중 조각이 있는 곳)
# 장소 p50 122 · p95 541곳, 조각 id p50 246 · p95 2,077(서울 반경 5km 가 최대). p95 를 올림한 값 — 측정 사례는 하나도 안 잘린다.
# pgvector 에서 이 크기의 `item_ids` 필터가 시한(≤2.45s) 안에 드는지는 실 스택 측정(3단계)에서 본다.
MAX_IDS = 2_100


def scope_ids(scope_refs: Sequence[str], index: Mapping[str, tuple[str, ...]],
              cap: int = MAX_IDS) -> tuple[list[str], frozenset[str]]:
    """규칙 순서의 장소 키 → (조각이 있어 범위에 든 장소, 그 조각 id). 순서대로 담다가 다음 장소가 상한을 넘기면 멈춘다."""
    refs: list[str] = []
    ids: list[str] = []
    for ref in dict.fromkeys(r for r in scope_refs if r):
        chunks = index.get(ref, ())
        if not chunks:
            continue
        if len(ids) + len(chunks) > cap:
            break
        refs.append(ref)
        ids.extend(chunks)
    return refs, frozenset(ids)


class PlaceSearch:
    def __init__(self, embedding: EmbeddingPort, store: VectorStorePort, *,
                 index: Callable[[], Mapping[str, tuple[str, ...]]] = chunk_index, max_ids: int = MAX_IDS) -> None:
        self._embedding, self._store = embedding, store
        self._index, self._max_ids = index, max_ids
        # 일꾼은 검색 몫 + 미리 임베딩 몫 — 검색이 미리 임베딩한 결과를 기다려도 줄 서지 않게
        self._pool = ThreadPoolExecutor(2 * SEARCH_MAX_INFLIGHT, thread_name_prefix="place-search")
        self._slots = threading.BoundedSemaphore(SEARCH_MAX_INFLIGHT)
        self._lock = threading.Lock()
        self._warming: dict[str, Future] = {}

    def warm(self, query: OpenQuery) -> None:
        """질의 임베딩을 미리 시작한다 — 풀 조립과 겹쳐 돌게. 끝난 결과는 임베딩 래퍼(`CachingEmbedding`)에 들고, 아직 도는 것은
        검색이 그 결과를 기다린다(같은 질의를 두 번 보내지 않게). 이미 둘 이상 돌고 있으면 내지 않는다 — 검색이 직접 임베딩한다."""
        with self._lock:
            self._warming = {q: f for q, f in self._warming.items() if not f.done()}
            if query.text in self._warming or len(self._warming) >= SEARCH_MAX_INFLIGHT:
                return
            self._warming[query.text] = self._pool.submit(self._embedding.embed, query.text)

    def search(self, query: OpenQuery, scope_refs: Sequence[str], wait_s: float, *,
               trace: str = "") -> tuple[str, dict[str, int]]:
        """(상태, {source_ref: 문서 순위}). 범위에 조각이 없으면 스토어를 부르지 않고 EMPTY. 바쁘면 BUSY, `wait_s` 를 넘기면 TIMEOUT
        (조회는 뒤에서 끝까지 돌고 버려진다), 임베딩·스토어 예외는 ERROR, 근거(BM25 > 0)가 없으면 NO_EVIDENCE."""
        t0 = time.monotonic()
        refs, ids = scope_ids(scope_refs, self._index(), self._max_ids)
        status, ranks = "EMPTY", {}
        if ids and not self._slots.acquire(blocking=False):
            status = "BUSY"
        elif ids:
            future = self._pool.submit(self._run, query, refs, ids)
            try:
                status, ranks = future.result(timeout=wait_s)
            except FutureTimeout:
                status = "TIMEOUT"
            except Exception as e:  # noqa: BLE001 — 임베딩·스토어 장애 — 규칙 순서로 간다(INV-4), 사유는 예외 타입까지
                status = "ERROR"
                log.info("place_search error=%s trace=%s", type(e).__name__, trace)
        log.info("place_search status=%s places=%d chunks=%d ms=%d trace=%s",
                 status, len(refs), len(ids), int((time.monotonic() - t0) * 1000), trace)
        return status, ranks

    def _vector(self, text: str):
        with self._lock:
            pending = self._warming.pop(text, None)
        return pending.result() if pending is not None else self._embedding.embed(text)

    def _run(self, query: OpenQuery, refs: list[str], ids: frozenset[str]) -> tuple[str, dict[str, int]]:
        try:
            hits = retrieve(KbKind.POI_DESC, query.text, self._embedding, self._store, top_k=len(ids), item_ids=ids,
                            vector=self._vector(query.text))
        finally:
            self._slots.release()
        order = {r: i for i, r in enumerate(refs)}
        ranks = doc_rank([h for h in hits if h.poi_ref in order], query.words, order)  # 범위 밖 poi_ref 는 버린다(INV-1)
        return ("OK" if ranks else "NO_EVIDENCE"), ranks
