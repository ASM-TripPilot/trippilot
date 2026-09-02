"""KB 3종 적재 + retrieve 3종 (epics S6.5 "KB retrieve 3종 — schedule·persona·situation").

구조는 `orchestrator/question_bank.py`(yaml 로더 + 벡터스토어 적재 + closed-set 검증)와
동형이다 — 같은 패턴을 쓰면 소비 측이 두 번 배우지 않는다.

**collection 분리**: KB마다 전용 collection을 쓰고, 그 배정은 `KB_COLLECTIONS` 한 곳에서만
정해진다. 실제 이름에는 **임베딩 모델이 붙는다**(`collection_for`) — 모델이 바뀌면 다른
collection 이 되어 옛 색인을 새 모델로 질의하는 사고가 0건으로 드러난다 (TRIP-519). `persona`는 agent-foundation FD가 지정한 초기 3종 중 하나를 그대로 재사용하고
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

from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
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

# planb-rag-design §9 미결 #4 "20 (임시), 실험 후 조정" — 2026-09-01 실측으로 확정.
# 20 은 KB 총량(24건)보다 커서 **정렬만 하고 한 건도 거르지 않는 no-op** 이었다.
#
# KB-3 24건 · 질의 6종 실측 (재현: `scripts/measure_kb_topk.py`):
#     top_k |  2     3     4     5     6     8    20
#     정밀도 | 1.000 0.833 0.708 0.600 0.528 0.438 0.208
#     길이   | 149   224   292   369   443   579  1398 자  (프롬프트 골격 630자 대비)
# 4 를 고른 이유: reason 버킷이 비대칭이라(weather 10건 ↔ delay·none 2건) 한 값이
# 모두를 만족시킬 수 없는데, 4 는 가장 큰 "전건이 필요한" 버킷(fatigue 4건)을 정확히
# 덮으면서 컨텍스트를 골격의 46% 로 유지한다. 6 이면 컨텍스트의 절반이 무관 문서다.
#
# **측정 범위는 KB-3(SITUATION) 뿐이다.** `PlanBRagPipeline._safe_retrieve` 가 세 KB 에
# 같은 값을 넘기므로 KB-1·KB-2 에도 걸리지만, 둘은 아직 적재 0건이라 측정 대상이
# 없었다 — 데이터가 붙으면 그때 KB별로 나눌지 판단한다(지금 나누면 근거 없는 상수가
# 둘 더 생긴다).
DEFAULT_TOP_K = 4


class KbIndexError(ValueError):
    """KB 적재 구조·차원 위반 — 데이터/설정 버그라 폴백 대상이 아니다."""


class KbLoadError(ValueError):
    """KB seed 파일 구조 위반 — question_bank.BankLoadError와 동형(데이터 버그, 폴백 아님)."""


def model_slug(model_id: str) -> str:
    """모델 식별자 → collection 이름에 쓸 수 있는 조각.

    이름을 **버리지 않고** 안전한 문자로만 바꾼다 — 해시로 줄이면 DB 를 열어 봤을 때
    어느 모델로 색인했는지 알 수 없다. `nlpai-lab/KURE-v1` → `nlpai_lab_kure_v1`.
    """
    slug = "".join(c if c.isalnum() else "_" for c in model_id.lower())
    while "__" in slug:  # 연속 구분자는 하나로 — 서로 다른 이름이 같은 슬러그가 되지 않게
        slug = slug.replace("__", "_")
    return slug.strip("_")


def collection_for(kb: KbKind, model_id: str) -> str:
    """KB × 임베딩 모델 → collection 이름.

    **모델을 이름에 넣는 것이 이 함수의 요점이다** (TRIP-519). 벡터 공간은 모델마다
    다르므로 다른 모델로 색인한 벡터를 섞어 검색하면 순위가 조용히 무의미해진다.
    차원이 같으면(우리는 전부 1024) DDL 도 어댑터의 BR-AF-09 검증도 이걸 못 잡는다.

    어댑터의 런타임 대조(`HttpEmbeddingAdapter` 가 서비스 응답의 model 을 확인)는
    **질의 쪽만** 본다 — 적재를 B 로, 질의를 A 로 했는데 양쪽이 각자 정합이면 통과한다.
    collection 을 갈라 두면 그 경우 옛 collection 질의가 **0건**으로 떨어져 시끄럽게
    드러난다. 둘은 보완 관계다.

    모델을 바꾸면 새 collection 이 비어 있으므로 **재적재가 강제된다** — 팀 결정
    (2026-08-22 "provider 를 바꾸면 전량 재적재")이 여기서 구조로 지켜진다.
    """
    return f"{KB_COLLECTIONS[kb]}__{model_slug(model_id)}"


def load_kb_documents(data: object) -> tuple[KbDocument, ...]:
    """seed 파일의 파싱 결과 → KbDocument 목록 (구조·위생 검증, TRIP-427).

    파일 형식: `ai/data/planb_situation_kb.yaml` — 루트 `kb`가 문서 전체의 KB이고
    `documents[*]`에는 kb를 다시 쓰지 않는다(문서마다 다르게 적을 수 있게 두면
    라벨과 collection이 어긋나는 드리프트 지점이 하나 늘어난다).
    """
    root = data if isinstance(data, Mapping) else None
    if root is None:
        raise KbLoadError(f"루트가 매핑이 아님 ({type(data).__name__})")
    try:
        kb = KbKind(root.get("kb"))
    except ValueError as e:
        raise KbLoadError(f"kb 라벨 해석 불가: {root.get('kb')!r}") from e
    entries = root.get("documents")
    if not isinstance(entries, Sequence) or isinstance(entries, str) or not entries:
        raise KbLoadError("documents가 비어있거나 목록이 아님")
    documents: list[KbDocument] = []
    seen: set[str] = set()
    for i, entry in enumerate(entries):
        if not isinstance(entry, Mapping):
            raise KbLoadError(f"documents[{i}]: 매핑이 아님")
        doc_id = entry.get("doc_id")
        if not isinstance(doc_id, str) or not doc_id:
            raise KbLoadError(f"documents[{i}]: doc_id 누락")
        if doc_id in seen:
            raise KbLoadError(f"doc_id 중복: {doc_id!r}")
        seen.add(doc_id)
        text = entry.get("text")
        if not isinstance(text, str):
            raise KbLoadError(f"{doc_id}: text 누락")
        poi_ref = entry.get("poi_ref")
        if poi_ref is not None and not isinstance(poi_ref, str):
            raise KbLoadError(f"{doc_id}: poi_ref는 문자열 또는 null")
        metadata = entry.get("metadata") or {}
        if not isinstance(metadata, Mapping):
            raise KbLoadError(f"{doc_id}: metadata는 매핑")
        try:
            documents.append(
                KbDocument(kb=kb, doc_id=doc_id, text=text,
                           poi_ref=poi_ref, metadata=dict(metadata))
            )
        except ValueError as e:  # KbDocument 불변식(빈 text 등)도 적재 오류로 승격
            raise KbLoadError(str(e)) from e
    return tuple(documents)


def load_kb_file(path: Path, parse: Callable[[str], object]) -> tuple[KbDocument, ...]:
    """파일 → 문서 목록. yaml 파서는 주입받는다 — yaml 의존은 llm_gateway/prompts.py
    한정(아키텍처 테스트 강제)이라 question_bank.load_bank_file과 같은 seam을 쓴다."""
    return load_kb_documents(parse(path.read_text(encoding="utf-8")))


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
        store.upsert(
            collection_for(doc.kb, embedding.model_id), doc.doc_id, vector, doc.payload()
        )
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
    raw_hits = store.search(collection_for(kb, embedding.model_id), vector, top_k)
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
