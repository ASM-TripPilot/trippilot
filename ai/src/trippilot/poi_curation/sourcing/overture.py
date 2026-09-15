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
    "bar": PoiCategory.FOOD,
    # CAFE — TourAPI 카페 1,771곳이 **전부 같은 태그 한 조합**이었다.
    "cafe": PoiCategory.CAFE,
    "coffee_shop": PoiCategory.CAFE,
    "bakery": PoiCategory.CAFE,
    "desserts": PoiCategory.CAFE,
    "smoothie_juice_bar": PoiCategory.CAFE,
    # SIGHT
    "landmark_and_historical_building": PoiCategory.SIGHT,
    "buddhist_temple": PoiCategory.SIGHT,
    "church_cathedral": PoiCategory.SIGHT,
    "public_plaza": PoiCategory.SIGHT,
    # NATURE
    "park": PoiCategory.NATURE,
    "mountain": PoiCategory.NATURE,
    "national_park": PoiCategory.NATURE,
    "botanical_garden": PoiCategory.NATURE,
    "lake": PoiCategory.NATURE,
    "hot_springs": PoiCategory.NATURE,
    "onsen": PoiCategory.NATURE,
    # CULTURE
    "art_gallery": PoiCategory.CULTURE,
    "music_venue": PoiCategory.CULTURE,
    "arts_and_entertainment": PoiCategory.CULTURE,
    # SHOPPING — 우리가 640건뿐인 축이다.
    "shopping": PoiCategory.SHOPPING,
    "clothing_store": PoiCategory.SHOPPING,
    "souvenir_shop": PoiCategory.SHOPPING,
    "outdoor_gear": PoiCategory.SHOPPING,
    "hobby_shop": PoiCategory.SHOPPING,
    # ACTIVITY
    "rock_climbing_spot": PoiCategory.ACTIVITY,
    "scuba_diving_center": PoiCategory.ACTIVITY,
    "casino": PoiCategory.ACTIVITY,
    "swimming_pool": PoiCategory.ACTIVITY,
    "bike_rentals": PoiCategory.ACTIVITY,
    # NIGHT_VIEW — 아래 이름 규칙을 추가로 통과해야 한다.
    "observatory": PoiCategory.NIGHT_VIEW,
    "lookout": PoiCategory.NIGHT_VIEW,
    "night_market": PoiCategory.NIGHT_VIEW,
}

# 카테고리가 NIGHT_VIEW 로 왔을 때 **이름이 이걸 만족해야** 통과한다.
# 실측 표본에서 확인한 진짜 야경: 솔오름 전망대·거린사슴전망대·국사봉전망대.
_NIGHT_OK = re.compile(r"전망대|전망|야시장|야경|展望|lookout|observation\s*deck",
                       re.IGNORECASE)
# 이름이 이걸 만족하면 **카테고리와 무관하게 야경에서 뺀다.** `observatory` 가
# 천문대를 함께 담고 있어서다 — 별을 보는 곳이지 야경을 보는 곳이 아니다.
_NIGHT_NO = re.compile(r"천문|천체|과학관|플라네타|planetarium|astronom",
                       re.IGNORECASE)

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
    if cat is not PoiCategory.NIGHT_VIEW:
        return cat
    n = _norm(name)   # None 도 받는다 — 호출자마다 정규화를 다시 짜게 하지 않는다
    if _NIGHT_NO.search(n):
        return None
    return cat if _NIGHT_OK.search(n) else None


def has_korean_name(name: str | None) -> bool:
    """한글 음절이 있는가. 로마자 상호는 사용자에게 보여줄 수 없어 제안하지 않는다.

    실측 채움률 63.5% — 나머지 36.5% 는 로마자이거나 이름이 부실하다.
    """
    return bool(_HANGUL.search(_norm(name)))
