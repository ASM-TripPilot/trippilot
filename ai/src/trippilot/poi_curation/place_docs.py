"""KB-5 장소 지식 문서 조립 — 출처 넷을 한 모양으로 받는다.

한 장소에 **여러 출처의 문서가 공존한다.** 출처마다 강한 카테고리가 다르기 때문이다
(실측):

    위키백과      문화 25% · 자연 22% · 명소 20%  ↔  카페 2.5% · 음식점 5%
    detailIntro2  음식점·카페 100%(대표메뉴)      ↔  문화재 해설은 없음
    국가유산      문화재만 깊게                    ↔  나머지 없음
    overview      전 타입 (채움률 미측정)

**넷이 중복이 아니라 서로의 구멍을 메운다.** 하나만 고르면 절반이 빈다 — 그래서
`doc_id` 에 출처를 넣어 공존시키고, 검색이 점수로 고르게 둔다.

`doc_id` 규약: `{출처}:{source_ref}` — 한 출처가 한 장소에 문서 하나.
`poi_ref` 는 `source_ref` 그대로 (런타임 조인 키, `place_knowledge` 가 이걸로 붙인다).
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence

from trippilot.domain.kb import KbDocument, KbKind

# 출처 식별자 — `doc_id` 접두사이자 metadata 의 `source`. 새 출처를 더하면 여기 먼저 적는다.
SOURCE_INTRO = "intro"  # ② detailIntro2 잔여 필드 조립 (새 API 호출 0)
SOURCE_WIKI = "wiki"  # ③ 위키백과 (CC BY-SA — 출처 표기 필수)
SOURCE_OVERVIEW = "overview"  # ① TourAPI detailCommon
SOURCE_HERITAGE = "heritage"  # ④ 국가유산 해설문

SOURCES = (SOURCE_INTRO, SOURCE_WIKI, SOURCE_OVERVIEW, SOURCE_HERITAGE)

# 너무 짧은 문서는 넣지 않는다 — "정보 없음"·"문의" 같은 것이 문서로 들어가면
# 후보 줄만 길어지고 판단에 보태는 게 없다. 빈 문서보다 **없는 편이 정직**하다.
MIN_DOC_CHARS = 12


def make_doc(
    source: str,
    source_ref: str,
    text: str,
    *,
    metadata: Mapping[str, str] | None = None,
) -> KbDocument | None:
    """문서 1건. 너무 짧거나 비면 `None` — 호출측이 건너뛴다.

    `KbDocument.__post_init__` 이 빈 `text` 를 예외로 막으므로, 걸러내는 책임이
    여기 있다. 수집 스크립트가 원천마다 예외를 짜지 않게 한 곳으로 모은다.
    """
    if source not in SOURCES:
        raise ValueError(f"모르는 출처: {source!r} — SOURCES 에 먼저 등록하라")
    body = " ".join(text.split())
    if len(body) < MIN_DOC_CHARS:
        return None
    return KbDocument(
        kb=KbKind.POI_DESC,
        doc_id=f"{source}:{source_ref}",
        text=body,
        poi_ref=source_ref,
        metadata={"source": source, **(dict(metadata) if metadata else {})},
    )


# ── 출처 검증 — 그 문서가 **그 장소** 얘기인가 ────────────────────────
#
# 상호명 정확 일치만으로는 **표제어가 애초에 장소가 아닌 경우**를 못 거른다. 그리고
# 상호명이 일반명사면 위키백과에 거의 항상 동명 문서가 있어서, 정확 일치가 오히려
# 오매칭을 **보장**한다. 실측(2,053건 수기·자동 대조):
#
#   카페 '레이더'   ← "전파를 사용하여 물체의 거리를 결정하는 시스템"
#   식당 '하이브'   ← "방시혁이 2005년 설립한 엔터테인먼트"
#   식당 '경회루'   ← "경복궁 누각, 국보 제224호"
#   식당 '리원'     ← "중화민국의 군인 리원(1905~1977)"
#
# 그래서 **문서가 그 POI 의 지역을 언급하는지**를 본다(동음이의어는 `is_disambiguation`). 장소를 설명하는 백과 문서는
# 거의 항상 소재지를 적고, 동명의 인물·작품·개념은 안 적는다. 실측 통과율:
#
#   SIGHT 89.1% · NATURE 78.7% · CULTURE 91.0% · ACTIVITY 78.4% · SHOPPING 72.4%
#   FOOD 6.2% · CAFE 3.6%     ← 오매칭이 몰려 있던 바로 그 카테고리
#
# (두 필터 합산. 2,053 → 1,458건 — 동음이의어 299 · 지역불일치 296. 자연이 89%→79%로
#  가장 많이 빠지는데, 같은 이름의 산이 흔해서다: 청계산·축령산·우두산·화악산…)
#
# 음식점·카페가 거의 다 떨어지는 것이 **정상**이다 — 동네 가게는 위키백과에 없다.
# KB-5 가 그 둘을 메우려던 출처는 ②(대표메뉴)이지 ③이 아니다.
#
# **오기각을 받아들인다.** 본문이 소재지를 안 적는 진짜 장소가 섞여 떨어진다(실측:
# '중명전' — "덕수궁에 딸린 서양식 전각", '무등산 주상절리대' — "무등산에 있는").
# 상호명이 본문에 있는지를 OR 로 더하면 이것들이 살아나지만 카페 '레이더'도 같이
# 살아난다("레이더(radar)는 전파를…") — 같은 신호가 양쪽을 통과시킨다. 틀린 설명이
# 붙는 쪽이 설명이 없는 쪽보다 나쁘므로 지역 신호 하나만 쓴다.


# 동음이의어 문서는 **어느 장소도 설명하지 않는다** — 같은 이름의 여러 곳을 나열만
# 한다. 지역 필터를 통과해 버리는 것이 문제다: 나열된 지역 중 하나가 맞는 지역이라
# "언급한다"가 참이 된다(실측 '녹동서원' — 대구 달성군과 전남 영암군을 같이 적는다).
# 통과시키면 모델이 어느 쪽인지 모르는 채로 인용한다. 2,053건 중 299건(14.6%).
#
# **첫 문장만 본다.** 어법 변종을 정규식으로 쫓으면 끝이 없다 — 실측만 해도 "다음을
# 가리키는 말이다" · "다른 뜻은 다음과 같다" · "다음과 같은 뜻이 있다" · "다음과 같은
# 곳에 있다" · "다음과 같은 산이 있다" · "다음과 같은 동음이의어가 있다" 가 나왔다.
# 공통점은 어미가 아니라 **위치**다: 동음이의어 문서는 첫 문장이 곧 "여러 개가 있다"는
# 안내문이고, 설명 문서는 첫 문장이 그 장소의 정의다. 설명문에도 "다음과 같은 점에서"
# 같은 표현이 나오지만 그건 정의 문장 **뒤**다(실측 오탐이 정확히 이 모양이었다).
_FIRST_SENTENCE = re.compile(r"^.*?다\.\s|^[^.]*\.")


def is_disambiguation(text: str) -> bool:
    """동음이의어 문서인가 — 첫 문장에 '다음'이 있으면 그렇다."""
    m = _FIRST_SENTENCE.match(text.strip())
    return "다음" in (m.group(0) if m else text[:120])


def mentions_region(text: str, region: str, address: str) -> bool:
    """문서가 그 장소의 소재지를 언급하나. 검증 못 하면 **버린다**(빈 것이 낫다)."""
    tokens = [t for t in f"{region} {address}".split() if len(t) >= 2][:3]
    for token in tokens:
        stem = token.rstrip("시군구")  # '제주시' → '제주' — 본문 표기가 달라도 걸린다
        if len(stem) >= 2 and stem in text:
            return True
    return False


# ── ② detailIntro2 잔여 필드 → 문장 ────────────────────────────────
#
# 이미 항목당 1콜을 쓰고 받아 오면서 영업시간·휴무일 2필드만 읽고 버리던 것들이다.
# **새 API 호출이 0건**이라 넷 중 가장 싸고, 음식점·카페에서 채움률이 가장 높다.
#
# 필드명은 TourAPI 원문 그대로 — 우리 편의로 바꾸면 원천이 바뀔 때 대조가 안 된다.
# ⚠️ 소요시간 계열(`spendtime` 등)은 **넣지 않는다** — INV-3(소요시간 표시 금지).
#    사용자 노출 `reason` 으로 새면 위반이고, 문서에 있으면 모델이 인용한다.
_INTRO_LABELS: Mapping[str, str] = {
    "firstmenu": "대표메뉴",
    "treatmenu": "취급메뉴",
    "saleitem": "판매품목",
    "reservationfood": "예약",
    "reservation": "예약",
    "packing": "포장",
    "kidsfacility": "아이 시설",
    "parking": "주차",
    "parkingfood": "주차",
    "parkingculture": "주차",
    "chkpet": "반려동물",
    "chkbabycarriage": "유모차",
    "usefee": "이용료",
    "useseason": "이용시기",
    "fairday": "장날",
}

# 값이 이 중 하나면 문장에 안 넣는다 — "없음"을 적으면 모델이 그것을 결격으로 읽는다.
# 모르는 것과 없는 것은 다르고, 여기서는 **모르는 것으로 둔다**.
_INTRO_EMPTY = frozenset({"", "-", "없음", "없습니다", "해당없음", "미정", "문의"})


def intro_text(name: str, category: str, detail_raw: Mapping[str, str]) -> str:
    """detailIntro2 잔여 필드 → 한 문장. 쓸 게 없으면 빈 문자열.

    예) `성심당 — 음식점. 대표메뉴 튀김소보로. 주차 가능. 아이 시설 있음.`
    """
    parts: list[str] = []
    seen: set[str] = set()
    for field, label in _INTRO_LABELS.items():
        raw = str(detail_raw.get(field) or "").strip()
        if not raw or raw in _INTRO_EMPTY or label in seen:
            continue
        seen.add(label)
        parts.append(f"{label} {' '.join(raw.split())}")
    if not parts:
        return ""
    head = f"{name} — {category}" if category else name
    return f"{head}. " + ". ".join(parts) + "."


def intro_docs(proposals: Sequence[Mapping]) -> tuple[KbDocument, ...]:
    """수집 제안 목록 → ② 문서들. `provenance.detail` 이 없는 건은 건너뛴다.

    ⚠️ `detail` 은 **신규·변경분에만** 붙는다 — 증분 색인이 "변경 없음"이면 상세를
    다시 안 받기 때문이다. 공유본 전량에 붙어 있을 거라고 가정하면 0건이 나온다
    (2026-09-19 실측: 18,607건 중 0건이었다).
    """
    docs: list[KbDocument] = []
    for item in proposals:
        provenance = item.get("provenance") or {}
        detail = provenance.get("detail") or {}
        source_ref = provenance.get("content_id") or item.get("provisional_id")
        poi = item.get("poi") or {}
        if not detail or not source_ref:
            continue
        text = intro_text(str(poi.get("name") or ""), str(poi.get("category") or ""), detail)
        doc = make_doc(SOURCE_INTRO, str(source_ref), text)
        if doc is not None:
            docs.append(doc)
    return tuple(docs)
