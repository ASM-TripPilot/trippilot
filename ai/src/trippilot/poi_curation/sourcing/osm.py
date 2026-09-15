"""OpenStreetMap → SourcingCandidate (TRIP-685).

**세 번째 출처. Overture 를 대체하지 않고 Overture 가 약한 네 축만 메운다.**

실측(2026-09-16, Overpass `out count`, 한국 bbox 33.0~39.5N/124.0~132.0E)으로
Overture 와 정면 비교했다:

    태그                우리 축        OSM      Overture   판정
    tourism=viewpoint   NIGHT_VIEW    2,692        101    OSM 27배
    natural=peak        NATURE       18,488      2,417    OSM 7.6배
    shop=*              SHOPPING     59,221      6,527    OSM 9.1배
    natural=beach       NATURE        1,525          0    OSM 단독
    ────────────────────────────────────────────────────
    amenity=restaurant  FOOD         82,123    130,760    Overture 우세
    amenity=cafe        CAFE         13,126     45,309    Overture 우세
    tourism=attraction  SIGHT         2,488     15,879    Overture 우세
    tourism=museum      CULTURE       2,021      4,060    Overture 우세

**아래 네 줄만 가져온다.** 겹치는 축까지 OSM 으로 받으면 얻는 것 없이 ODbL
노출만 커진다 — 음식점·카페는 Overture 가 이미 더 많이 준다.

⚠️ **`viewpoint` 2,692 은 그대로 야경이 아니다.** 제주 실측(42건)에서 진짜
전망대는 **36%** 뿐이었고 나머지는 동굴·갤러리·기념비였다. OSM 의 `viewpoint`
는 "전망이 좋은 지점" 전반이라 우리 NIGHT_VIEW(야경)와 개념이 다르다 — 이름
규칙을 통과한 것만 싣는다. 전국 실효 건수는 그만큼 줄어든다.

## ODbL 을 받아들인 결정 (2026-09-16)

OSM 은 **ODbL 1.0** 이고 share-alike 가 있다. OSMF 자신의 Collective Database
Guideline 이 우리 경우를 예시로 들어 "해당 안 됨"이라고 못박는다:

> "You have a proprietary list of restaurants... complement your list with
> corresponding data from OpenStreetMap **removing any duplicate objects in the
> process**. The resulting, combined database would **not** be covered."

즉 다른 출처와 한 테이블에서 중복제거하면 병합 DB 전체가 Derivative Database 가
되어 §4.4(ODbL 호환으로 재배포)·§4.6(기계가독 사본 제공)이 걸린다. 팀이 그
의무를 **알고 받아들이기로 했다**. 실무적으로 해야 하는 것 셋:

1. **§4.3 출처 표시** — 앱 화면에 `© OpenStreetMap contributors`. **프론트엔드
   작업이고 이 패키지 밖이다.** 빠지면 라이선스 위반이다.
2. **§4.4 share-alike** — 병합 결과를 독점으로 잠글 수 없다. 우리 제안 문서는
   이미 public 리포에 있다.
3. **§4.6 사본 제공** — 위와 같은 이유로 실질 충족.

한글 이름 보유율은 강남 표본 1,956건 중 **90%** 로 Overture(63.5%)보다 높다.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping

from trippilot.domain.poi import PoiCategory

SOURCE_NAME = "OSM"

# 라이선스 고지 — 산출 문서에 싣는다. 데이터를 받는 쪽이 의무를 모를 수 없게.
ATTRIBUTION = "© OpenStreetMap contributors"
LICENSE = "ODbL-1.0"

# ── 채택 목록: (키, 값) → 우리 8종 ─────────────────────────────────────
# Overture 가 이기는 축(restaurant·cafe·attraction·museum)은 **일부러 뺐다** —
# 위 모듈 주석의 비교표 참조. 여기 없는 태그는 전부 드롭된다.
_TAG_MAP: Mapping[tuple[str, str], PoiCategory] = {
    ("tourism", "viewpoint"): PoiCategory.NIGHT_VIEW,
    ("natural", "peak"): PoiCategory.NATURE,
    ("natural", "beach"): PoiCategory.NATURE,
}
# `shop` 은 값이 수백 종이라 키 존재만 본다 — 다만 여행지가 아닌 것을 뺀다.
_SHOP_KEY = "shop"
_SHOP_EXCLUDE = frozenset({
    # **가게가 아닌 것** — 취향이 아니라 오류다. `vacant` 는 OSM 에서 "비어 있는
    # 점포 자리"를 뜻하는 문서화된 값이고 `no` 는 "가게 아님"의 명시다. 이걸
    # 통과시키면 TRIP-683 실재 검증이 걸러내려는 바로 그 대상을 수집이
    # 생산한다 — 유령 POI 를 우리 손으로 만드는 셈이다.
    "vacant", "no",
    # 생필품·차량·주거 — 여행자가 일정에 넣을 곳이 아니다
    "convenience", "supermarket", "car", "car_repair", "car_parts", "tyres",
    "hardware", "doityourself", "trade", "builder", "electrical", "paint",
    "funeral_directors", "pawnbroker", "insurance", "estate_agent",
    "hairdresser", "beauty", "laundry", "dry_cleaning", "optician",
    "medical_supply", "hearing_aids", "chemist", "pharmacy", "storage_rental",
    "mobile_phone", "computer", "copyshop", "printing", "locksmith",
})

_HANGUL = re.compile(r"[가-힣]")
# 야경 축은 Overture 와 **같은 규칙**을 쓴다. 처음엔 "OSM 은 `viewpoint` 태그
# 자체가 근거"라고 보고 이름 규칙을 안 걸었는데, 제주 실측이 그걸 뒤집었다 —
# 42건 중 진짜 전망대는 **15건(36%)** 뿐이고 나머지는 동굴·갤러리·기념비다:
#     구린굴 · 용두암 · 김영갑갤러리 · 우도해녀항일기념비 · 산신각 · 중동굴
# OSM 의 `tourism=viewpoint` 는 "전망이 좋은 지점" 전반이라 **우리 NIGHT_VIEW
# (야경)와 다른 개념**이다. 걸러내지 않으면 야경 보러 갔다가 동굴을 만난다.
_NIGHT_OK = re.compile(r"전망대|전망|야경|일출|일몰|낙조|展望|viewpoint|lookout"
                       r"|observation\s*deck", re.IGNORECASE)
_NIGHT_NO = re.compile(r"천문|천체|과학관|플라네타|planetarium|astronom", re.IGNORECASE)


def _norm(name: str | None) -> str:
    """NFC 로 합친다 — `[가-힣]` 은 완성형만 매칭한다 (overture._norm 과 동형).

    OSM 은 기여자가 직접 입력하므로 정규화 형태가 더 섞인다. 안 합치면 자모
    분해로 적힌 이름이 통째로 드롭된다.
    """
    return unicodedata.normalize("NFC", name or "")


def map_tags(tags: Mapping[str, str]) -> PoiCategory | None:
    """OSM 태그 → 우리 8종. 채택 목록 밖이면 None(드롭).

    NIGHT_VIEW 는 이름 규칙을 추가로 본다 — `tourism=viewpoint` 에도 천문대가
    섞이고, 별을 보는 곳은 야경 명소가 아니다.
    """
    name = _norm(tags.get("name"))
    night_rejected = False
    for (k, v), cat in _TAG_MAP.items():
        if tags.get(k) != v:
            continue
        if cat is PoiCategory.NIGHT_VIEW:
            # 태그만으로는 부족하다 — 위 _NIGHT_OK 주석의 실측 참조.
            #
            # **드롭이 아니라 다음 태그로 넘어간다.** 여기서 `return None` 하면
            # `tourism=viewpoint` 를 함께 단 봉우리·해변이 NATURE 로도 못 가고
            # 통째로 사라진다 — 전망 좋은 정상은 OSM 에서 흔히 공동 태깅되는데,
            # NATURE 는 Overture 대비 7.6배라는 OSM 채택 근거 그 자체다.
            # 조용한 손실이라 더 나쁘다(`collect_osm` 의 seen 은 채택분만 담아
            # peak 쿼리에서 다시 와도 같은 이유로 또 드롭된다).
            if _NIGHT_NO.search(name) or not _NIGHT_OK.search(name):
                night_rejected = True
                continue
        return cat
    # **shop 으로는 안 흘린다.** 위 `continue` 는 `_TAG_MAP` 안에서만 유효하다 —
    # peak·beach 는 강한 단일 태그라 야경 탈락이 그 주장까지 무르게 할 이유가
    # 없지만, `shop` 은 값이 수백 종인 catch-all 키다. 야경 이름 규칙이 떨어뜨린
    # 레코드(동굴·기념비)를 `shop=gift` 하나로 쇼핑에 다시 들이면, 배제해 놓고
    # 뒷문으로 넣는 꼴이 된다. 이름이 그 가게가 아니라 동굴을 가리키는 것도
    # 문제다 — "구린굴" 이 쇼핑 후보가 된다. 약한 신호 쪽은 fail-closed 로 둔다.
    if night_rejected:
        return None
    shop = tags.get(_SHOP_KEY)
    if shop and shop not in _SHOP_EXCLUDE:
        return PoiCategory.SHOPPING
    return None


def has_korean_name(name: str | None) -> bool:
    """한글 음절이 있는가. 로마자 상호는 사용자에게 보여줄 수 없다.

    실측 보유율 90%(강남 표본 1,956건) — Overture 63.5% 보다 높다.
    """
    return bool(_HANGUL.search(_norm(name)))
