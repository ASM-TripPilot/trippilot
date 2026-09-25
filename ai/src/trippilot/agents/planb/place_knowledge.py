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
from trippilot.poi_curation.place_docs import SOURCES
from trippilot.ports.embedding_port import EmbeddingPort
from trippilot.ports.vector_store_port import VectorStorePort

_logger = logging.getLogger("trippilot.planb.place_knowledge")

# 후보 한 건에 붙일 문서 길이 상한. 원천이 긴 산문을 주기도 해서(위키백과 실측 최대
# 433자, TourAPI overview 는 그보다 길다) 자르지 않으면 후보 30개에서 프롬프트가 터진다.
# 앞부분을 남기는 이유: 도입부가 "무엇인가"를 말하고 뒤로 갈수록 연혁·부가정보다.
MAX_DOC_CHARS = 160

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
# ⚠️ 상한이 상시 걸리는 규모라면 고칠 곳은 여기가 아니다. 프롬프트의 후보 목록
# (`alternative_selection._candidate_line`)에 상한이 없어 풀 전원이 줄로 실리는 것이
# 먼저다 — 그건 KB-5 이전부터 있던 문제이고 별건으로 다룬다.
MAX_DOCS = 40


def fetch_place_knowledge(
    pois: Sequence[Poi],
    query: str,
    embedding: EmbeddingPort,
    store: VectorStorePort,
    vector: Sequence[float] | None = None,
) -> tuple[Mapping[str, str], str]:
    """풀 전원의 장소 지식. 반환: ({source_ref: 문서}, 강등 사유).

    **예외를 올리지 않는다.** 장소 지식은 부가 정보라, 없으면 종전대로(세분류까지만
    아는 상태로) 도는 것이 정상 동작이지 실패가 아니다 (INV-4 — 다만 침묵하지 않고
    사유를 돌려준다).
    """
    refs = _pool_refs(pois)
    if not refs:
        return {}, ""
    # 스토어의 `item_id` 는 `doc_id`(`{출처}:{source_ref}`)다 — 한 장소에 출처가 여럿
    # 공존하기 때문이다. 그래서 조인 키만으로는 못 거르고 **출처 × 조인키**로 편다.
    # SOURCES 가 닫힌 목록(넷)이라 추측이 아니라 전개다.
    doc_ids = frozenset(f"{source}:{ref}" for source in SOURCES for ref in refs)
    try:
        hits = retrieve(
            KbKind.POI_DESC,
            query,
            embedding,
            store,
            # 장소당 문서가 최대 `len(SOURCES)` 건이므로, 서로 다른 장소 MAX_DOCS 개를
            # 확보하려면 문서는 그 배수까지 받아야 한다(최악: 한 장소가 넷을 다 가짐).
            # 장소 수 상한은 여기가 아니라 아래 dedupe 루프가 건다 — top_k 만으로는
            # "문서 몇 건"이 걸릴 뿐 "장소 몇 곳"은 안 걸린다.
            top_k=min(len(doc_ids), MAX_DOCS * len(SOURCES)),
            item_ids=doc_ids,
            vector=vector,  # 상황 질의와 같은 문자열이라 호출측이 이미 임베딩했다
        )
    except Exception as e:  # 임베딩·스토어 장애 — 문서 없이 진행한다
        _logger.warning("place_knowledge degraded: %s: %s", type(e).__name__, e)
        return {}, f"place_knowledge_unavailable: {type(e).__name__}"

    # 키는 `poi_ref`(= source_ref)다. `doc_id` 는 출처별 접두사가 붙어 있어 후보와
    # 직접 안 맞는다 — 한 장소에 여러 출처의 문서가 생길 수 있기 때문이다.
    out: dict[str, str] = {}
    for hit in hits:
        ref = hit.poi_ref
        text = _clip(hit.text)
        if not ref or not text or ref in out:
            continue  # 같은 장소에 문서가 여럿이면 점수 높은 쪽만 (스토어가 정렬해 준다)
        if len(out) >= MAX_DOCS:
            break
        out[ref] = text
    # 문서를 가진 장소가 상한보다 많았는지는 여기서만 알 수 있다 — 중복 제거 후의
    # 고유 장소 수라 hits 길이로는 못 센다. `hits` 자체도 top_k 에 잘려 있으므로
    # 이 수는 **하한**이다 — 그래서 노트에 "이상"이라 적는다(모르는 것을 아는 척하지 않는다).
    distinct = len({h.poi_ref for h in hits if h.poi_ref and h.text})
    if distinct > len(out):
        return out, (
            f"place_knowledge_truncated: {len(out)}곳 채택 / {distinct}곳 이상 해당 "
            f"(상한 {MAX_DOCS} · 나머지는 문서 없이 간다)"
        )
    return out, ""


def attach(poi: Poi, knowledge: Mapping[str, str]) -> str:
    """후보 한 건에 붙일 문서. 없으면 빈 문자열 — 호출측이 줄을 안 늘리면 된다."""
    return knowledge.get(poi.source_ref or "", "")


def _pool_refs(pois: Sequence[Poi]) -> frozenset[str]:
    """풀에서 조인 키를 모은다. `source_ref` 가 없는 POI 는 문서를 못 받는다.

    백엔드가 그 필드를 안 실어 보내던 시절의 캐시 항목이 섞일 수 있어(POI 캐시 TTL
    24시간) 전량이 비는 구간이 있다 — 그때도 조용히 빈 결과일 뿐 실패가 아니다.
    """
    return frozenset(p.source_ref for p in pois if p.source_ref)


def _clip(text: str) -> str:
    """줄바꿈을 접고 상한에서 자른다 — 원문 줄바꿈이 프롬프트 줄 구조를 깨뜨린다."""
    stripped = " ".join(text.split())
    if len(stripped) <= MAX_DOC_CHARS:
        return stripped
    return stripped[: MAX_DOC_CHARS - 1].rstrip() + "…"
