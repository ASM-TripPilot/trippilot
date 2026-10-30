"""KB-5 장소 지식 — 후보 풀 전원의 문서를 가져와 후보에 붙인다.

FD 가 지정한 초기 collection 3종(`intent_bank`·`persona`·`poi_desc`) 중 마지막이고,
여기까지 한 번도 구현된 적이 없었다. 이름만 docstring 과 fake 테스트에 있었다.

**왜 필요한가.** 모델이 후보에 대해 아는 것이 `poi_id | 카테고리(·세분류) | 상호명`
뿐이었다. 세분류가 붙어 많이 나아졌지만 그것으로도 안 갈리는 곳이 남는다 — 카페
1,771곳은 태그 조합이 **하나**고, 음식점은 79%가 `한식` 이다. 하필 하루에 가장 많고
가장 자주 교체되는 슬롯이다.

**앞 넷(KB-1~4)과 검색 방식이 다르다.** 그쪽은 "상황에 맞는 문서 몇 건"을 찾는다.
이쪽은 **후보 풀 전원의 문서**를 가져온다 — `retrieve(item_ids=)` 로 풀 안으로 좁히고
`top_k` 를 풀 크기로 준다. 단 `MAX_DOCS` 아래에서만 그렇다(그 상수 옆의 실측표 참조) —
풀이 그보다 크면 전원이 아니고, 그 사실이 노트로 나간다.

그 이유가 이 모듈의 핵심이다: **일부에게만 설명이 붙으면 편향이 생긴다.** 후보 30개
중 4개에만 문서가 붙으면 그 4개만 "내가 적합하다"고 말할 수 있고 나머지 26개는 말할
방법이 없다. 그러면 임베딩 유사도가 **아무도 랭커로 설계하지 않았는데**
`_rule_ranking`(앵커 정렬)을 조용히 덮는다.

**그래도 문서가 없는 후보는 남는다** — 원천 커버리지가 균일하지 않다(위키백과 실측:
문화 25% ↔ 카페 2.5%). 검색 전략으로 못 고치므로 **프롬프트가 그 사실을 말한다** —
"문서가 없는 것은 정보가 없다는 뜻이지 부적합하다는 뜻이 아니다."
**[2026-10-23] 그 자리는 대체 문서로 채울 수 있다**(`poi_curation.place_fallback` — 장소 카드 + 웹 확인 사실, 기본 꺼짐). 진짜
문서가 붙은 뒤 남은 자리에만, 숏리스트 순서대로 진짜 문서와 합쳐 `MAX_DOCS` 까지. 점수로 겨루지 않는다 — 짧은 글이 긴 개요 조각을
밀어낸다. 건수(`retrieved.POI_DESC`)는 진짜 문서만 센다 — 대체 문서는 `POI_DESC_FALLBACK` 으로 따로(`kb5_counts`).

**조인 키는 `source_ref`**(TourAPI contentid)다. POI 정본은 백엔드 단독 소유이므로
(PR #76) AI 는 파생 지식을 자기 스토어에 들고 이 번호로 런타임 후보에 붙인다 —
속성이 늘 때마다 백엔드 스키마를 늘리지 않는다.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence

from trippilot.agents.planb.kb_retrieval import retrieve
from trippilot.domain.kb import KbKind
from trippilot.domain.poi import Poi
from trippilot.poi_curation import place_fallback
from trippilot.poi_curation.chunking import chunk_ids, split_sentences
from trippilot.poi_curation.place_docs import SOURCE_OVERVIEW, SOURCE_WIKI, SOURCES
from trippilot.ports.embedding_port import EmbeddingPort
from trippilot.ports.vector_store_port import VectorStorePort

_logger = logging.getLogger("trippilot.planb.place_knowledge")

# 후보 한 건에 붙일 문서 길이 상한. 원천이 긴 산문을 주기도 해서(위키백과 실측 최대
# 433자, TourAPI overview 는 그보다 길다) 자르지 않으면 후보 30개에서 프롬프트가 터진다.
# 앞부분을 남기는 이유: 도입부가 "무엇인가"를 말하고 뒤로 갈수록 연혁·부가정보다.
# 160 → 300 (2026-10-18 청킹): 이제 붙는 것은 문서 앞부분이 아니라 **질의에 맞은 조각 하나**다.
# 조각은 절 제목 + 최대 280자(`chunking.MAX_CHARS`)라 자르지 않고 통째로 들어가게 잡는다 —
# 맞은 조각을 다시 자르면 검색이 고른 근거가 잘려 나간다.
MAX_DOC_CHARS = 300
# 맞은 조각이 본문 뒤쪽이면 도입부 첫 문장을 이만큼까지 앞에 붙인다 — 조각만으로는 "이곳이 무엇인지"가 빠진다.
# 실측(2026-10-19, 장소 120 × Plan-B 상황 질의 6 = 720판, LLM 판정·순서 섞음, `measure_kb5_chunking.py`):
#     맞은 조각만        vs 도입부 앞 160자   53.9% : 40.3% (같음 5.8%)
#     첫 문장 + 조각     vs 맞은 조각만       66.0% : 24.0% (같음 10.0%)
#     첫 문장 + 조각     vs 도입부 앞 300자   59.9% : 31.7% (같음 8.5%) ← 같은 글자 예산(길이 편향 통제)
INTRO_HEAD_CHARS = 100
# 조각으로 적재되는 출처 — 이 출처는 통문서 id 대신 조각 id 범위로 펼쳐 찾는다. 한 장소에 위키·개요가 둘 다
# 있으면 **둘을 합쳐** 가장 맞는 조각 하나를 고른다(아래 장소별 중복 제거).
CHUNKED_SOURCES = frozenset({SOURCE_WIKI, SOURCE_OVERVIEW})

# 문서를 받는 **장소** 수 상한 — 예산 방어. 40 × 160자 ≈ 6,400자가 프롬프트 증가분이다.
#
# **상한은 예외가 아니라 상시 걸린다.** 수집 POI 18,607건 좌표로 반경별 실측
# (2026-09-19):
#
#     기준점        도보 2km   대중교통 10km   자차 20km
#     서울 시청         261         1,346        2,361
#     부산 서면          21           345          580
#     제주 시청          58           203          354
#     경주 황리단길      54           166          226
#
# **다만 모든 후보가 문서를 갖는 것은 아니다** — 커버리지 실측 1,458/18,607 = 7.8%
# (무작위 풀 표본으로도 30곳 중 4 · 60곳 중 5 · 120곳 중 12로 같은 비율이 나온다).
# 그래서 실제로 상한에 닿는 것은 "후보 수"가 아니라 "문서 가진 후보 수"다:
# 서울 10km 1,346곳이면 문서 보유가 약 105곳이고, 그중 40곳이 붙는다(38%). 갈림은 **임베딩 유사도 순**
# 이라, 이 모듈이 없애려던 바로 그 편향이 상한 위에서 되살아난다. 없앨 수 없어서
# **보이게 한다**: 걸릴 때마다 `place_knowledge_truncated` 노트를 남긴다
# (INV-4 — 조용한 축소 금지). 위 docstring 의 "풀 전원"은 **상한 아래에서만** 참이다.
#
# 2026-10-04 부터 호출측(`rag._shortlist`)이 LLM 후보를 규칙 랭킹 앞 60곳(+ 원 일정)으로
# 좁힌 뒤 그 후보 것만 묻는다 — 문서 보유 ≈ 5곳이라 이 상한에 닿지 않고 위 "풀 전원"이
# 다시 참이 된다. 풀 전원이 후보 줄로 실려 입력 63k 토큰이던 문제가 그 숏리스트로 풀렸다.
#
# 대체 문서도 이 상한 안이다(진짜 + 대체 합계 — KB-5 담당 세션 조건, 2026-10-30). 숏리스트(60)+원 일정이 다 받지는 못하고,
# 규칙 랭킹 앞쪽부터 받는다(임베딩 유사도가 아니라 숏리스트 순서라 이 모듈이 막으려던 편향은 아니다).
MAX_DOCS = 40
POI_DESC_FALLBACK = "POI_DESC_FALLBACK"


class PlaceKnowledge(dict):
    """`{source_ref: 문서}` — 그중 대체 문서 수를 `fallback` 에 든다(건수 집계가 진짜 문서와 가른다)."""

    def __init__(self, docs: Mapping[str, str] | None = None, fallback: int = 0) -> None:
        super().__init__(docs or {})
        self.fallback = fallback


def kb5_counts(knowledge: Mapping[str, str]) -> dict[str, int]:
    """`retrieved` 의 KB-5 칸. POI_DESC = 진짜 문서가 붙은 후보 수(적재 전·스토어 장애를 보는 칸이라 대체 문서를 섞지 않는다),
    대체 문서는 붙었을 때만 `POI_DESC_FALLBACK` 으로 — 꺼져 있으면 종전 응답과 같다."""
    fallback = getattr(knowledge, "fallback", 0)
    return {KbKind.POI_DESC.value: len(knowledge) - fallback, **({POI_DESC_FALLBACK: fallback} if fallback else {})}


def fetch_place_knowledge(
    pois: Sequence[Poi],
    query: str,
    embedding: EmbeddingPort,
    store: VectorStorePort,
    vector: Sequence[float] | None = None,
    *,
    fallback: Mapping[str, str] | None = None,
) -> tuple[Mapping[str, str], str]:
    """풀 전원의 장소 지식. 반환: ({source_ref: 문서}, 강등 사유).

    **예외를 올리지 않는다.** 장소 지식은 부가 정보라, 없으면 종전대로(세분류까지만
    아는 상태로) 도는 것이 정상 동작이지 실패가 아니다 (INV-4 — 다만 침묵하지 않고
    사유를 돌려준다).
    """
    refs = _pool_refs(pois)
    if not refs:
        return {}, ""
    extra = (place_fallback.fallback_docs() if fallback is None else fallback) if place_fallback.enabled() else {}
    # 스토어의 `item_id` 는 `doc_id`(`{출처}:{source_ref}`)다 — 한 장소에 출처가 여럿
    # 공존하기 때문이다. 그래서 조인 키만으로는 못 거르고 **출처 × 조인키**로 편다.
    # SOURCES 가 닫힌 목록(넷)이라 추측이 아니라 전개다.
    # 청킹된 출처는 **조각 id 범위**로 편다(`{출처}:{ref}#0..`) — 장소마다 조각 수가 달라 미리 모르므로
    # 적재 상한(`MAX_CHUNKS_PER_DOC`)까지 펼친다. 없는 id 는 그냥 안 맞는다. **청킹 전 통문서 id 도 같이 둔다** —
    # 조각이 아직 안 들어온 장소(배포 롤아웃 직후·적재 예산에 밀린 문서·코퍼스에 없는 옛 문서)는 그 통문서가
    # 대신 붙는다. 조각이 다 들어간 문서의 통문서는 적재가 지우므로(`load_kb`) 둘이 오래 겹치지 않고,
    # 겹쳐도 아래 장소별 중복 제거가 점수 높은 하나만 남긴다(리뷰: 빼면 KB-5 가 배포 창 동안 통째로 빈다).
    doc_ids = frozenset(
        i for source in SOURCES for ref in refs
        for i in ((f"{source}:{ref}", *chunk_ids(f"{source}:{ref}")) if source in CHUNKED_SOURCES
                  else (f"{source}:{ref}",)))
    try:
        hits = retrieve(
            KbKind.POI_DESC,
            query,
            embedding,
            store,
            # 장소 수 상한은 여기가 아니라 아래 dedupe 루프가 건다. 장소마다 **가장 맞는 조각 하나**를 골라야 하므로 후보 장소의 조각 전부를 점수순으로
            # 받는다(필터가 검색 전에 걸려 행 수는 후보 장소의 조각 수뿐이다).
            top_k=len(doc_ids),
            item_ids=doc_ids,
            vector=vector,  # 상황 질의와 같은 문자열이라 호출측이 이미 임베딩했다
        )
    except Exception as e:  # 임베딩·스토어 장애 — 진짜 문서 없이(대체 문서만) 진행한다
        _logger.warning("place_knowledge degraded: %s: %s", type(e).__name__, e)
        return _fill({}, pois, extra), f"place_knowledge_unavailable: {type(e).__name__}"

    # 키는 `poi_ref`(= source_ref)다. `doc_id` 는 출처별 접두사가 붙어 있어 후보와
    # 직접 안 맞는다 — 한 장소에 여러 출처의 문서가 생길 수 있기 때문이다.
    # 도입부(#0)는 **같은 출처**의 것 — 위키 첫 문장 + 개요 조각처럼 다른 글을 이어 붙이지 않는다.
    intro = {(h.poi_ref, h.metadata.get("source")): h for h in hits
             if h.poi_ref and h.metadata.get("chunk") == 0}
    out: dict[str, str] = {}
    for hit in hits:
        ref = hit.poi_ref
        text = _clip(_with_intro(hit, intro.get((ref, hit.metadata.get("source")))))
        if not ref or not text or ref in out:
            continue  # 같은 장소에 문서가 여럿이면 점수 높은 쪽만 (스토어가 정렬해 준다)
        if len(out) >= MAX_DOCS:
            break
        out[ref] = text
    # 문서를 가진 장소가 상한보다 많았는지는 여기서만 알 수 있다 — 중복 제거 후의
    # 고유 장소 수라 hits 길이로는 못 센다. `hits` 자체도 top_k 에 잘려 있으므로
    # 이 수는 **하한**이다 — 그래서 노트에 "이상"이라 적는다(모르는 것을 아는 척하지 않는다).
    distinct = len({h.poi_ref for h in hits if h.poi_ref and h.text})
    truncated = distinct > len(out)
    note = (f"place_knowledge_truncated: {len(out)}곳 채택 / {distinct}곳 이상 해당 "
            f"(상한 {MAX_DOCS} · 나머지는 문서 없이 간다)") if truncated else ""
    return _fill(out, pois, extra), note


def _fill(out: dict[str, str], pois: Sequence[Poi], extra: Mapping[str, str]) -> PlaceKnowledge:
    """진짜 문서가 없는 자리에 대체 문서 — 숏리스트 순서대로, 진짜 문서와 합쳐 `MAX_DOCS` 까지."""
    filled = PlaceKnowledge(out)
    for p in pois:
        ref = p.source_ref or ""
        if len(filled) >= MAX_DOCS:
            break
        if ref and ref not in filled and extra.get(ref):
            filled[ref] = _clip(extra[ref])
            filled.fallback += 1
    return filled


def attach(poi: Poi, knowledge: Mapping[str, str]) -> str:
    """후보 한 건에 붙일 문서. 없으면 빈 문자열 — 호출측이 줄을 안 늘리면 된다."""
    return knowledge.get(poi.source_ref or "", "")


def _pool_refs(pois: Sequence[Poi]) -> frozenset[str]:
    """풀에서 조인 키를 모은다. `source_ref` 가 없는 POI 는 문서를 못 받는다.

    백엔드가 그 필드를 안 실어 보내던 시절의 캐시 항목이 섞일 수 있어(POI 캐시 TTL
    24시간) 전량이 비는 구간이 있다 — 그때도 조용히 빈 결과일 뿐 실패가 아니다.
    """
    return frozenset(p.source_ref for p in pois if p.source_ref)


def _with_intro(hit, intro) -> str:
    """맞은 조각이 도입부(#0)가 아니면 도입부 첫 문장 + " … " + 조각 본문. 통문서(조각 번호 없음)·도입부 조각 자체·
    도입부를 못 찾은 장소는 그대로 — 실측 형식(`measure_kb5_chunking.py combo300`)과 같다."""
    if not hit.metadata.get("chunk") or intro is None:
        return hit.text
    head = split_sentences(_body(intro))[0][:INTRO_HEAD_CHARS]
    return f"{head} … {_body(hit)}"


def _body(hit) -> str:
    """조각 글은 `"{절 제목}: {본문}"`(`chunking.chunk_document`) — 절 제목을 뗀다."""
    section = hit.metadata.get("section") or ""
    return hit.text[len(section) + 2:] if section and hit.text.startswith(f"{section}: ") else hit.text


def _clip(text: str) -> str:
    """줄바꿈을 접고 상한에서 자른다 — 원문 줄바꿈이 프롬프트 줄 구조를 깨뜨린다."""
    stripped = " ".join(text.split())
    if len(stripped) <= MAX_DOC_CHARS:
        return stripped
    return stripped[: MAX_DOC_CHARS - 1].rstrip() + "…"
