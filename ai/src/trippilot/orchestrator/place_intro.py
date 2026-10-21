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
from dataclasses import dataclass

from trippilot.agents.planb.place_knowledge import MAX_DOC_CHARS, fetch_place_knowledge
from trippilot.llm_gateway.gates.dialogue_answer import _violates, clock_times
from trippilot.poi_curation.chunking import split_sentences
from trippilot.ports.embedding_port import EmbeddingPort
from trippilot.ports.vector_store_port import VectorStorePort

log = logging.getLogger(__name__)


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

    def intro(self, source_ref: str, query: str) -> str:
        """장소 하나(조인 키 = TourAPI contentid)의 소개 — 없거나 스토어 장애면 빈 문자열(부가 정보라 없이 간다, INV-4)."""
        knowledge, note = fetch_place_knowledge((_Ref(source_ref),), query, self._embedding, self._store)  # type: ignore[arg-type]
        if note:
            log.info("place_intro %s", note)
        return clean_intro(knowledge.get(source_ref, ""))
