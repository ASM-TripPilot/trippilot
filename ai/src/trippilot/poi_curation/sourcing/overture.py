"""Overture Maps places → SourcingCandidate (TRIP-684).

TourAPI 단일 출처의 구조적 한계를 메운다. 실측(2026-09-16, 릴리스
`2026-08-19.0`, DuckDB + S3 parquet, 한국 bbox):

    한국 POI      691,968건   (TourAPI 수집분 18,607건의 37배)
    한글 이름     439,468건 (63.5%)
    라이선스      CDLA Permissive 2.0 — **share-alike 없음**, 상업 이용 자유
    갱신          월 1회. 공개본은 최신 2릴리스(~60일)만 유지 → 정기 재수집 필수

**places 테마만 CDLA 다.** buildings·transportation 등은 OSM 기반 ODbL(share-alike)
이라 같은 테이블에 섞으면 의무가 생긴다 — 이 모듈은 places 만 읽는다.

## 화이트리스트로 거른다

69만 건을 그대로 제안하면 후보 풀이 망가진다. 실측 상위에 편의점 9,298 ·
미용실 9,972 · 치과 3,844 · ATM 4,487 · 주유소 4,029 같은 **여행지가 아닌 것**이
대거 섞여 있다(카테고리 317종 중 200건 이상만 추려도 64.8만). 그래서 배제
목록이 아니라 **채택 목록**으로 간다 — 새 카테고리가 생겨도 조용히 새어들지
않는다("모르는 것은 넣지 않는다").

## NIGHT_VIEW 는 이름으로 한 번 더 거른다

우리 경계 8종 중 유일하게 0건이던 축이다. `observatory`(100) 가 그 자리를
메울 후보인데 **천문대가 섞인다** — 실측 표본에 `용인어린이천문대`·
`경희대천문대`·`서산류방택천문기상과학관`이 있었고, 이들은 야경 명소가 아니다.
`night_market`(44) 도 `전라도여행맛집` 같은 오분류가 섞인다. 그래서 카테고리
통과 후 이름 규칙을 한 번 더 건다.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping

from trippilot.domain.poi import PoiCategory

SOURCE_NAME = "OVERTURE"

# ── 채택 목록: Overture category → 우리 8종 ────────────────────────────
# 실측 317종(200건 이상)에서 "여행자가 갈 만한 곳"만 골랐다. 여기 없는
# 카테고리는 전부 드롭된다 — 배제 목록이 아니라 채택 목록인 이유는 위 주석.
_CATEGORY_MAP: Mapping[str, PoiCategory] = {
    # FOOD — 업종이 갈리는 것이 강점이다. TourAPI 는 79%가 '한식' 한 태그였다.
    "korean_restaurant": PoiCategory.FOOD,
    "restaurant": PoiCategory.FOOD,
    "japanese_restaurant": PoiCategory.FOOD,
    "chinese_restaurant": PoiCategory.FOOD,
    "chicken_restaurant": PoiCategory.FOOD,
    "barbecue_restaurant": PoiCategory.FOOD,
    "seafood_restaurant": PoiCategory.FOOD,
    "sushi_restaurant": PoiCategory.FOOD,
    "italian_restaurant": PoiCategory.FOOD,
    "noodles_restaurant": PoiCategory.FOOD,
    "pizza_restaurant": PoiCategory.FOOD,
    "mexican_restaurant": PoiCategory.FOOD,
    "theme_restaurant": PoiCategory.FOOD,
    "bar_and_grill_restaurant": PoiCategory.FOOD,
    "fast_food_restaurant": PoiCategory.FOOD,
    "diner": PoiCategory.FOOD,
    "gastropub": PoiCategory.FOOD,
    # `bar`(11,950)는 뺐다 — 제주 실측 162건이 동네 호프·펍(드렁큰디제이·봉구비어
    # 노형점)이었다. 여행 일정의 식사 슬롯에 넣을 곳이 아니다.
    # CAFE — TourAPI 카페 1,771곳이 **전부 같은 태그 한 조합**이었다.
    "cafe": PoiCategory.CAFE,
    "coffee_shop": PoiCategory.CAFE,
    "bakery": PoiCategory.CAFE,
    "desserts": PoiCategory.CAFE,
    "smoothie_juice_bar": PoiCategory.CAFE,
    # SIGHT
    "landmark_and_historical_building": PoiCategory.SIGHT,
    "buddhist_temple": PoiCategory.SIGHT,
    "public_plaza": PoiCategory.SIGHT,
    # `church_cathedral`(8,633)은 뺐다 — 제주 실측 125건이 전부 동네 교회였다
    # (제주 오렐리 교회·성지교회 외도동·소망교회 목사관). 명동성당 같은 것은
    # `landmark_and_historical_building` 으로 따로 들어온다.
    # NATURE
    "park": PoiCategory.NATURE,
    "mountain": PoiCategory.NATURE,
    "national_park": PoiCategory.NATURE,
    "botanical_garden": PoiCategory.NATURE,
    "lake": PoiCategory.NATURE,
    "hot_springs": PoiCategory.NATURE,
    "onsen": PoiCategory.NATURE,
    # CULTURE — `art_gallery` 만. `arts_and_entertainment`(2,208)는 마술학원·
    # 사진관·유리공방이, `music_venue`(2,001)는 노래방이 대부분이었다(제주 실측).
    "art_gallery": PoiCategory.CULTURE,
    # SHOPPING — **여행 쇼핑**만. 처음엔 `shopping`(8,429)·`clothing_store`·
    # `outdoor_gear` 를 넣었다가 뺐다: 제주 실측에서 `shopping` 에 다이소·안경점·
    # 전자랜드가, `outdoor_gear` 에 수산조합·식품도매가 섞였고 이름 규칙으로
    # 쫓아가면 끝이 없었다. 카테고리 자체가 거친 것이다. 반면 `souvenir_shop`
    # 47건은 전부 여행 쇼핑이었다(샵제주·안녕제주·한국기념품백화점).
    # TourAPI 쇼핑(5일장·상설시장·백화점·면세점·공예)과 같은 결로 맞춘다.
    "souvenir_shop": PoiCategory.SHOPPING,
    "gift_shop": PoiCategory.SHOPPING,
    "duty_free_shop": PoiCategory.SHOPPING,
    "department_store": PoiCategory.SHOPPING,
    "outlet_store": PoiCategory.SHOPPING,
    "farmers_market": PoiCategory.SHOPPING,
    "flea_market": PoiCategory.SHOPPING,
    "seafood_market": PoiCategory.SHOPPING,
    "public_market": PoiCategory.SHOPPING,
    "antique_store": PoiCategory.SHOPPING,
    "arts_and_crafts": PoiCategory.SHOPPING,
    "craft_shop": PoiCategory.SHOPPING,
    # ACTIVITY
    "rock_climbing_spot": PoiCategory.ACTIVITY,
    "scuba_diving_center": PoiCategory.ACTIVITY,
    # `casino` 는 뺐다 — 제주 실측 1건이 "하나로 마트 제주양돈축협"이었다.
    "swimming_pool": PoiCategory.ACTIVITY,
    "bike_rentals": PoiCategory.ACTIVITY,
    # NIGHT_VIEW — 아래 이름 규칙을 추가로 통과해야 한다.
    "observatory": PoiCategory.NIGHT_VIEW,
    "lookout": PoiCategory.NIGHT_VIEW,
    # `night_market` 은 뺐다 — 아래 `야시장` 주석과 같은 이유다.
}

# 카테고리가 NIGHT_VIEW 로 왔을 때 **이름이 이걸 만족해야** 통과한다.
# 실측 표본에서 확인한 진짜 야경: 솔오름 전망대·거린사슴전망대·국사봉전망대.
#
# **`야시장` 은 뺐다**(2026-10-14). 야시장은 야경이 아니라 시장이고, 그 낱말이 이름에
# 들어간 것은 거의 전부 식당이다 — 공유본 19곳 중 `족발야시장` 7지점(전국 족발 체인)·
# `뉴욕야시장 소하점`·`상하이 야시장` 처럼. 실제로 야경 축에 들어와 있던 유일한 `야시장`
# 이 그 `뉴욕야시장 소하점`(경기 광명, 술집)이었다. `night_market` 카테고리도 같이
# 걷어냈다 — 그 코드가 야경으로 갈 길이 이름 규칙뿐이었고 그 길을 닫았으므로.
_NIGHT_OK = re.compile(r"전망대|전망|야경|展望|lookout|observation\s*deck",
                       re.IGNORECASE)
# 이름이 이걸 만족하면 **카테고리와 무관하게 야경에서 뺀다.** `observatory` 가
# 천문대를 함께 담고 있어서다 — 별을 보는 곳이지 야경을 보는 곳이 아니다.
_NIGHT_NO = re.compile(r"천문|천체|과학관|플라네타|planetarium|astronom",
                       re.IGNORECASE)

# ── 아파트 단지 — `landmark_and_historical_building` 이 실어 온다 ──────
# **이 카테고리는 거칠다.** 서울 실측(2026-10-14): SIGHT 2,408곳 중 **1,061곳(44%)**이
# 아파트 단지였다(`부천소사역푸르지오`·`일신주공아파트`·`항동하버라인 10단지`). `mapping`
# 의 기존 `apartment` 규칙은 `(아파트|오피스텔)$` 라 브랜드명으로 끝나는 것을 못 잡는다.
#
# **이름이 브랜드로 끝날 때만 건다.** 처음엔 브랜드를 어디서든 잡았다가 공유본 41,362곳
# 중 24곳을 죽였다 — 전부 **아파트 안의 가게**였다(`깐부치킨 용산푸르지오써밋점`,
# `족발예찬(금천롯데캐슬점)`). 지점명은 브랜드 뒤에 말이 더 붙으므로 끝 고정이 가른다.
# 보통명사로도 쓰이는 브랜드(`어울림`·`풍경채`·`하늘채`·`꿈에그린`)는 아예 뺐다 —
# 어울림캠핑장·꿈에그린짜장·하늘채 황금수라가 죽었다. 지금 규칙은 **공유본 오탐 0** 이다.
_APT_BRAND = (r"푸르지오|래미안|힐스테이트|롯데캐슬|센트레빌|수자인|리슈빌|엘크루|베르디움"
              r"|해링턴플레이스|아크로리버|트레지움|파밀리에|베르데카운티|아이파크|위브|자이")
# 단지 이름에 붙는 접미어 — `램킨푸르지오**시티**` · `롯데캐슬**파크**` · `천왕타운하우스**A**`.
# 처음엔 브랜드로 끝날 때만 잡아 이것들을 놓쳤다(실측 14곳). **지점명 `점` 은 넣지 않는다** —
# 그게 단지와 그 안의 가게를 가르는 유일한 표지다(`깐부치킨 용산푸르지오써밋점`).
_APT_SUFFIX = r"(?:시티|타워|파크|빌|뷰|힐즈|힐스|스테이트|카운티|타운|마을|단지|차|동|[A-Z])"
_APARTMENT = re.compile(
    rf"(?:{_APT_BRAND})\s*\d*\s*{_APT_SUFFIX}{{0,3}}\s*\d*$"
    r"|타운하우스\s*\d*\s*[A-Z]?$|주상복합|\d+단지$|아파트$|오피스텔$|빌라트$|하이엔드\s*\d*차$",
)

# ── 공원 출입구·주차장 — 장소가 아니라 그 장소의 **문**이다 ───────────
# `어린이대공원 정문`·`보라매공원 서문` 처럼 공원 이름을 달고 있어 NATURE 로 들어온다.
# FE 가 네이버 매칭본에서 '정크'로 표시한 223곳을 우리 규칙에 돌렸더니 **0곳**이 걸려
# 알았다 — 판별은 상호만으로 하므로 네이버 데이터는 쓰지 않는다.
#
# ⚠️ **방위문을 그냥 걸면 안 된다.** 처음엔 `(정|후|동|서|남|북)문$` 로 걸었다가 공유본에서
# `창덕궁 인정문`·`북악산 숙정문`·`금정산성 동문`·`서흥김씨삼강정문` 을 죽였다 — 전부
# 문화재다. 그래서 **공원 뒤에 올 때만** 건다. 같은 이유로 `사거리`·`삼거리`·`나들목`·
# `정류장` 도 뺐다(`전포 삼거리`·`나들목 가족공원`이 공유본에 있다). `주차장` 도 끝 고정이
# 아니면 `주차장식당`이 죽는다. 좁힌 결과 공유본 오탐 0.
_GATEWAY = re.compile(r"공원\s*(?:정|후|동|서|남|북)문$|주차장$|\d+번\s*출구$")

_HANGUL = re.compile(r"[가-힣]")


def _norm(name: str | None) -> str:
    """비교 전 정규화. **NFC 로 합친다** — `[가-힣]` 도 `전망대` 도 완성형만
    매칭하므로, 자모가 분해된(NFD) 이름은 한글이 아닌 것으로 보인다.

    Overture 는 레코드마다 원출처가 섞여 있어(Meta·Microsoft·Foursquare·
    AllThePlaces) 정규화 형태를 한 가지로 가정할 근거가 없다. 안 합치면 NFD 로
    적힌 한국 POI 가 통째로 드롭된다 — 새는 게 아니라 사라지는 쪽이라 조용하다.
    """
    return unicodedata.normalize("NFC", name or "")


def map_category(overture_category: str | None, name: str | None) -> PoiCategory | None:
    """Overture 카테고리 + 이름 → 우리 8종. 채택 목록 밖이면 None(드롭).

    NIGHT_VIEW 만 이름 규칙을 추가로 본다 — 카테고리가 야경과 천문대를 한
    바구니에 담고 있어 코드만으로는 못 가른다.
    """
    if not overture_category:
        return None
    cat = _CATEGORY_MAP.get(overture_category)
    if cat is None:
        return None
    n = _norm(name)   # None 도 받는다 — 호출자마다 정규화를 다시 짜게 하지 않는다
    # 아파트 단지와 출입구·주차장은 **카테고리와 무관하게** 뺀다. 거친 카테고리가
    # 실어 오는 것이라(`landmark_and_historical_building` → SIGHT 의 44%가 아파트)
    # 코드로는 못 가른다. 둘 다 공유본 41,362곳에 돌려 오탐 0 을 확인했다.
    if _APARTMENT.search(n) or _GATEWAY.search(n):
        return None
    if cat is not PoiCategory.NIGHT_VIEW:
        return cat
    if _NIGHT_NO.search(n):
        return None
    return cat if _NIGHT_OK.search(n) else None


def has_korean_name(name: str | None) -> bool:
    """한글 음절이 있는가. 로마자 상호는 사용자에게 보여줄 수 없어 제안하지 않는다.

    실측 채움률 63.5% — 나머지 36.5% 는 로마자이거나 이름이 부실하다.
    """
    return bool(_HANGUL.search(_norm(name)))
