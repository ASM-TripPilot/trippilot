"""KB 3종 적재 + retrieve 3종 (epics S6.5 "KB retrieve 3종 — schedule·persona·situation").

구조는 `orchestrator/question_bank.py`(yaml 로더 + 벡터스토어 적재 + closed-set 검증)와
동형이다 — 같은 패턴을 쓰면 소비 측이 두 번 배우지 않는다.

**collection 분리**: KB마다 전용 collection을 쓰고, 그 배정은 `KB_COLLECTIONS` 한 곳에서만
정해진다. `persona`는 agent-foundation FD가 지정한 초기 3종 중 하나를 그대로 재사용하고
(`intent_bank`·`persona`·`poi_desc`), KB-1·KB-3은 정본에 collection 이름이 없어
`planb_` 접두로 신설한다.

**정본과의 차이(의도된 1단계 축소, 보고 대상)**: planb-rag-design §2는 KB-1을 "구조화 DB
조회(벡터 불필요)", KB-3을 "실시간 API 호출"로 규정한다. 실 DB·실시간 어댑터가 없는
1단계에서는 세 KB를 모두 `VectorStorePort` 뒤에 동형으로 세우고, 반환 타입(`KbHit`)만
고정해 둔다 — 실 소스가 붙을 때 이 모듈의 내부만 갈아끼우면 파이프라인은 무영향이다.

**INV-1**: retrieve 결과는 후보가 아니다. `KbHit.poi_ref`는 평문 str이며, 후보 자격은
`rag.closed_set_filter`가 `CandidatePool`과 교차한 뒤에만 생긴다.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from types import MappingProxyType

from trippilot.domain.kb import KbDocument, KbHit, KbKind
from trippilot.ports.embedding_port import EmbeddingPort
from trippilot.ports.vector_store_port import VectorStorePort

# KB → collection. 배정을 바꾸려면 여기만 고친다 (문자열이 코드 곳곳에 흩어지면 드리프트한다).
KB_COLLECTIONS: Mapping[KbKind, str] = MappingProxyType(
    {
        KbKind.SCHEDULE: "planb_schedule",
        KbKind.PERSONA: "persona",  # FD 지정 초기 collection 3종 중 하나 (KB-2)
        KbKind.SITUATION: "planb_situation",
    }
)

DEFAULT_TOP_K = 20  # planb-rag-design §9 미결 #4 — "20 (임시), 실험 후 조정"


class KbIndexError(ValueError):
    """KB 적재 구조·차원 위반 — 데이터/설정 버그라 폴백 대상이 아니다."""


def collection_for(kb: KbKind) -> str:
    return KB_COLLECTIONS[kb]


def index_documents(
    documents: Sequence[KbDocument],
    embedding: EmbeddingPort,
    store: VectorStorePort,
) -> int:
    """KB 문서를 임베딩해 각자의 collection에 적재하고 건수를 반환한다.

    차원 위반(BR-AF-09)은 조용히 넘기지 않는다 — `index_bank`와 동일한 판단.
    문서마다 자기 `kb`의 collection으로 들어가므로 혼합 목록을 한 번에 실을 수 있다.
    """
    if not documents:
        return 0
    vectors = embedding.embed_batch([d.text for d in documents])
    if len(vectors) != len(documents):
        raise KbIndexError("임베딩 개수가 문서 수와 불일치")
    seen: set[tuple[KbKind, str]] = set()
    for doc, vector in zip(documents, vectors):
        key = (doc.kb, doc.doc_id)
        if key in seen:  # 같은 collection 내 doc_id 중복은 조용한 덮어쓰기가 된다
            raise KbIndexError(f"{doc.kb.value}: doc_id 중복 {doc.doc_id!r}")
        seen.add(key)
        if len(vector) != embedding.dim:
            raise KbIndexError(f"{doc.doc_id}: 임베딩 차원 {len(vector)} != {embedding.dim}")
        store.upsert(collection_for(doc.kb), doc.doc_id, vector, doc.payload())
    return len(documents)


def retrieve(
    kb: KbKind,
    query: str,
    embedding: EmbeddingPort,
    store: VectorStorePort,
    *,
    top_k: int = DEFAULT_TOP_K,
) -> tuple[KbHit, ...]:
    """지정 KB의 collection에서 top-k 검색. 결과는 항상 요청한 KB 소속이다.

    - `top_k ≤ 0` 또는 빈 질의 → 빈 결과 (질의 자체가 없으면 검색도 없다).
    - payload의 `kb` 라벨이 요청 KB와 다른 문서는 **제외**한다 — collection 오염 방어
      (`IntentRouter._match_bank`의 closed-set 방어와 같은 취지).
    - 정렬·동점 처리는 스토어 계약(score 내림차순, 동점 item_id 사전순)을 그대로 신뢰한다.
    """
    if top_k <= 0 or not query.strip():
        return ()
    vector = embedding.embed(query)
    raw_hits = store.search(collection_for(kb), vector, top_k)
    hits: list[KbHit] = []
    for hit in raw_hits:
        payload = hit.payload if isinstance(hit.payload, Mapping) else {}
        if payload.get("kb") != kb.value:
            continue
        text = payload.get("text")
        poi_ref = payload.get("poi_ref")
        metadata = payload.get("metadata")
        hits.append(
            KbHit(
                kb=kb,
                doc_id=hit.item_id,
                score=hit.score,
                text=text if isinstance(text, str) else "",
                poi_ref=poi_ref if isinstance(poi_ref, str) else None,
                metadata=dict(metadata) if isinstance(metadata, Mapping) else {},
            )
        )
    return tuple(hits)


# ── retrieve 3종 (planb-rag-design §10 Tool 시그니처의 1단계 대응) ──────────
#
# 정본 Tool명 대응: kb.retrieve_schedule / kb.retrieve_persona / kb.retrieve_situation.
# 정본은 각각 ScheduleContext·PersonaContext·SituationContext를 반환하지만, 그 조립은
# 실 DB·Provider(U6 후속)가 붙어야 가능하다 — 1단계는 검색 계층(KbHit)까지만 세운다.


def retrieve_schedule(
    query: str,
    embedding: EmbeddingPort,
    store: VectorStorePort,
    *,
    top_k: int = DEFAULT_TOP_K,
) -> tuple[KbHit, ...]:
    """KB-1 — 영향받는 슬롯·고정 블록·방문 이력·변경 이력."""
    return retrieve(KbKind.SCHEDULE, query, embedding, store, top_k=top_k)


def retrieve_persona(
    query: str,
    embedding: EmbeddingPort,
    store: VectorStorePort,
    *,
    top_k: int = DEFAULT_TOP_K,
) -> tuple[KbHit, ...]:
    """KB-2 — 저장 장소·선호 패턴·거절 이력 (대안 소싱 1순위 신호)."""
    return retrieve(KbKind.PERSONA, query, embedding, store, top_k=top_k)


def retrieve_situation(
    query: str,
    embedding: EmbeddingPort,
    store: VectorStorePort,
    *,
    top_k: int = DEFAULT_TOP_K,
) -> tuple[KbHit, ...]:
    """KB-3 — 트리거 사유·위치·시각·날씨·POI 상태."""
    return retrieve(KbKind.SITUATION, query, embedding, store, top_k=top_k)
