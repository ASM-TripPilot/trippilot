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
    # ── 나이트라이프 → ACTIVITY (사용자 결정 2026-10-15) ────────────────
    # 우리 경계 8종에 나이트라이프 축이 없어 ACTIVITY 로 받고, **`tags` 의
    # `나이트라이프`** 가 밤 장소라는 표지다(AI 가 그 태그로 밤 시간대를 다룬다).
    #
    # **왜 필요한가.** "클럽 가고 싶다"는 재계획이 엉뚱하게 나왔다 — 후보 데이터
    # (공유본 57,205 + localdata 22,283)에 **댄스 클럽이 0곳**이었다. 이름에 `클럽`이
    # 든 68곳은 전부 클럽케이서울(예식장)·대게클럽·타코사운즈클럽 같은 식당이다.
    #
    # **특정적인 축만 연다.** 실측(2026-08-19.0, 서울권·부산·제주·대구 bbox, 한글이름):
    #   dance_club 250 · wine_bar 506 · cocktail_bar 185 · lounge 180 ·
    #   beer_garden 40 · speakeasy 8  →  1,169곳
    # `bar` 3,059 · `pub` 681 · `sake_bar` 553 · `beer_bar` 332 · `brewery` 96 은
    # **뺐다** — 번화가 명소가 아니라 동네 술집이 주종이고, 그건 우리 LOCALDATA 판정이
    # "술집·호프·바는 끼니가 아니다"로 이미 쫓아낸 부류다. 5,890곳을 넣으면 공유본의
    # 10% 가 술집이 된다. 후보가 얇다고 드러나면 그때 연다.
    #
    # `jazz_club`·`rooftop_bar`·`whisky_bar`·`night_club` 은 **Overture 분류에 없다**
    # (0건) — 재즈바·루프탑바는 이 경로로 안 들어온다.
    "dance_club": PoiCategory.ACTIVITY,
    "cocktail_bar": PoiCategory.ACTIVITY,
    "wine_bar": PoiCategory.ACTIVITY,
    "speakeasy": PoiCategory.ACTIVITY,
    "beer_garden": PoiCategory.ACTIVITY,
    "lounge": PoiCategory.ACTIVITY,
}

# ── 나이트라이프 태그 ──────────────────────────────────────────────────
# 원천 카테고리 → 세부 태그. `나이트라이프` 는 이 표에 걸린 전건에 **반드시** 붙는다.
NIGHTLIFE_TAG = "나이트라이프"
NIGHTLIFE_DETAIL: dict[str, str] = {
    "dance_club": "클럽",
    "cocktail_bar": "칵테일바",
    "wine_bar": "와인바",
    "speakeasy": "스피크이지",
    "beer_garden": "비어가든",
    "lounge": "라운지바",
    # Overture 에 없는 칸 — 웹 큐레이션 전용(`collect_curated_kakao.py`, 2026-10-18). 제주는 혼술바가
    # 여행 코스로 따로 꼽힌다(사용자). 세부 태그 표를 한 곳에 두어야 병합 소급이 같은 이름 규칙을 건다.
    "solo_bar": "혼술바",
}

# 나이트라이프에서 **빼야 할 것** — 이름으로 거른다(사용자 결정의 제외 목록).
# 유흥주점·성인업소는 여행 제안에 올릴 수 없고, `클럽`·`라운지` 는 엉뚱한 데 붙는 낱말이다
# (골프/컨트리클럽·클럽하우스·스포츠클럽·독서클럽, 공항/호텔 라운지, 카페 라운지).
_NOT_NIGHTLIFE = re.compile(
    r"유흥|룸살롱|호스트바|호스트빠|단란주점|안마|마사지|성인|키스방|립카페"
    # `피트니스`·`휘트니스` 는 같은 말의 다른 표기다 — 둘 다 실제로 쓰인다(테스트가 잡았다)
    r"|골프|컨트리|클럽하우스|스포츠\s*클럽|헬스|[피휘핏]트니스|요가|독서\s*클럽|북\s*클럽"
    r"|공항\s*라운지|비즈니스\s*라운지|라운지\s*카페|카페\s*&?\s*라운지"
    r"|예식|웨딩|컨벤션|장례|병원|의원|약국|학원|교습"
    # ── 아래는 실측으로 붙였다(2026-10-15, 419곳 전수 눈검사) ──────────
    # Overture `dance_club` 이 한국에서 **노래주점·나이트클럽·호프집**에 많이 붙는다.
    # 그건 여행 제안에 올릴 밤 장소가 아니다.
    r"|노래주점|노래방|노래연습|코인노래|가라오케"
    r"|나이트\s*크?클?럽|나이트$"                         # 샴푸나이트크럽·호박나이트
    r"|주점$"                                            # 희주점 — 상호가 주점으로 끝난다
    # 전국 호프·맥주 체인 — `is_franchise` 는 치킨·버거 목록이라 이쪽을 모른다
    r"|투다리|생활맥주|봉구비어|역전할머니|압구정\s*몽키|치어스|밤과음악사이"
    # `오늘,? 와인한잔` — 전국 와인바 체인. 실측 4곳(당산·창경궁로·대구 수성·부산 서면).
    # LLM 도 `체인와인바` 로 기각했지만, 체인은 규칙으로 잡는 게 맞다(판정 비용이 공짜가 아니다).
    r"|오늘\s*,?\s*와인\s*한잔"
    # **사교댄스 강습·동호회 장소** — `dance_club` 으로 오지만 밤에 놀러 가는 곳이 아니다.
    # 여행자가 "클럽"이라 할 때 탱고 수업을 뜻하지 않는다. 실측 4곳(보니따 살사클럽·
    # Luz Tango·살사&바차타 댄스 클럽·강남홍대 스카이라틴, 전부 홍대·강남 강습소).
    r"|살사|바차타|탱고|땅고|라틴\s*댄스|스카이라틴|사교\s*댄스|댄스\s*스포츠"
    # 꼬치·포차는 끼니 쪽이고 FOOD 가 담당한다
    r"|꼬치|포차|포장마차",
    re.IGNORECASE)


def nightlife_tags(overture_category: str | None, name: str | None) -> tuple[str, ...] | None:
    """나이트라이프면 `(나이트라이프, 세부)`, 아니면 None. 제외 목록에 걸리면 None.

    `map_category` 가 ACTIVITY 를 돌려줬어도 이 함수가 None 이면 **싣지 않는다** —
    태그 없이 들어가면 AI 가 밤 장소로 다루지 못해 ACTIVITY 풀만 오염시킨다.
    """
    detail = NIGHTLIFE_DETAIL.get(overture_category or "")
    if detail is None:
        return None
    if _NOT_NIGHTLIFE.search(_norm(name)):
        return None
    return (NIGHTLIFE_TAG, detail)

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
