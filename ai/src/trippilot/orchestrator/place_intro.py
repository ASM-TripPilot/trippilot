"""PlaceIntro — 장소 소개 한 조각(KB-5: 위키백과·관광공사 개요) → 도우미 답변 LLM 의 재료.

"경복궁 역사 알려줘"·"남산서울타워 어때?"가 GET_POI_INFO 카드(분류·영업시간·입장료)만으로는 "확인된 정보가 없어요"로 끝났다
(2026-10-20 관광 40문장 측정). KB-5 는 PlanB 대안 선택에 이미 쓰는 같은 스토어·같은 조회(`fetch_place_knowledge`)다.

**화면 카드에는 싣지 않는다** — 위키 원문을 그대로 보이면 출처 표기가 걸린다. `Facts.detail["intro"]` 로 답변 LLM 만 읽고 줄여
말한다(PlanB 대안 이유와 같은 쓰임). **걸러 넣는다**(도우미 답변 세션 합의 10-20) — 사실 칸의 시각은 답변의 시각 허용 집합에
들어가므로(`clock_times`) "매일 10:00 수문장 교대식" 같은 문장은 검증 없이 화면에 나갈 수 있다(INV-2). 소요("관람에 2시간",
INV-3)·연락처·주입 꼴도 같은 검사(`_violates`)로 문장째 뺀다. 남는 문장이 없으면 빈 문자열이다.
"""

from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from trippilot.agents.planb.place_knowledge import MAX_DOC_CHARS, fetch_place_knowledge
from trippilot.llm_gateway.gates.dialogue_answer import _violates, clock_times
from trippilot.poi_curation import place_fallback
from trippilot.poi_curation.chunking import split_sentences
from trippilot.ports.embedding_port import EmbeddingPort
from trippilot.ports.vector_store_port import VectorStorePort

log = logging.getLogger(__name__)

# 소개는 덧붙임이다 — 카드(분류·영업시간·입장료)를 팬아웃 시한 초과로 통째로 잃지 않게 호출측이 준 시한(`wait_s`)만 기다리고
# 빈 소개로 간다. 2026-10-21 로컬 실측: KB-5 조회 2.3~4.0s(조각 id 를 펼친 검색) → "남산서울타워 어떤 곳이야?"가 카드 없이
# TIMEOUT 이었다. 동시에 도는 소개 조회가 상한이면 새로 내지 않는다(시한을 넘겨 뒤에서 도는 조회가 느린 스토어에 쌓이지 않게).
INTRO_WAIT_S, INTRO_MAX_INFLIGHT = 2.0, 2


@dataclass(frozen=True, slots=True)
class _Ref:
    """`fetch_place_knowledge` 는 후보의 `source_ref` 만 읽는다 — 장소 하나를 Poi 전체 없이 넘기는 최소 모양."""

    source_ref: str


def clean_intro(text: str) -> str:
    """시각·소요·연락처·주입 꼴이 든 문장을 뺀 소개 — 남은 문장만 이어 붙인다(≤ `MAX_DOC_CHARS`)."""
    keep = []
    for sentence in split_sentences(text):
        times, unverifiable = clock_times(sentence)
        if times or unverifiable or _violates(sentence, MAX_DOC_CHARS):
            continue
        keep.append(sentence)
    return " ".join(keep)[:MAX_DOC_CHARS]


class PlaceIntro:
    def __init__(self, embedding: EmbeddingPort, store: VectorStorePort) -> None:
        self._embedding, self._store = embedding, store
        self._pool = ThreadPoolExecutor(INTRO_MAX_INFLIGHT, thread_name_prefix="place-intro")
        self._slots = threading.BoundedSemaphore(INTRO_MAX_INFLIGHT)

    def _fetch(self, source_ref: str, query: str) -> str:
        try:
            knowledge, note = fetch_place_knowledge((_Ref(source_ref),), query, self._embedding, self._store)  # type: ignore[arg-type]
        finally:
            self._slots.release()
        if note:
            log.info("place_intro %s", note)
        return clean_intro(knowledge.get(source_ref, ""))

    def intro(self, source_ref: str, query: str, *, wait_s: float = INTRO_WAIT_S) -> str:
        """장소 하나(조인 키 = TourAPI contentid)의 소개 — 없거나 스토어 장애·`wait_s` 초과면 빈 문자열(부가 정보라 없이 간다,
        INV-4). 시한을 넘긴 조회는 뒤에서 끝까지 돌고 버려진다. 대체 문서가 켜져 있으면 그 자리에 대체 문서 — 로컬 표라 기다리지 않는다.
        바쁠 때·시한을 넘겼을 때는 진짜 문서(위키·개요)가 있는 곳도 대체 문서를 받는다 — 진짜 문서가 있는지 알려면 그 조회를 기다려야
        해서다. 빈 소개보다 낫다는 판단이다(대체 문서도 같은 게이트를 지난 사실만이다)."""
        if not self._slots.acquire(blocking=False):
            log.info("place_intro skip reason=busy")
            return clean_intro(place_fallback.doc(source_ref))
        future = self._pool.submit(self._fetch, source_ref, query)
        try:
            return future.result(timeout=wait_s)
        except Exception as e:  # noqa: BLE001 — 시한(TimeoutError)·스토어 예외 — 소개 없이 카드만
            log.info("place_intro skip reason=%s", type(e).__name__)
            return clean_intro(place_fallback.doc(source_ref))
