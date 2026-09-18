"""M7 generator — 필터를 자극하는 POI 분포 + 풀 요청 (U3 FD §5).

§2(파일 하단) 는 **교차 출처 동일성 판정**(TRIP-682) 재료다 — 같은 가게가 출처마다
다르게 적히는 상호·주소 표기 변형을 조립한다.
§3 은 **지도 실재 확인**(TRIP-683) 재료다 — 조회 1건과, "없음"으로 읽히면 안 되는
형식 밖 응답들.
§5 는 **Overture 매핑**(TRIP-684) 재료다 — 채택 목록 밖 카테고리와, 야경 이름
규칙의 양쪽(천문대 vs 진짜 전망대)을 가르는 실측 이름들.
§6 은 **OSM 매핑**(TRIP-685) 재료다 — Overpass 태그 dict 모양 그대로. 이름 어휘는
§5 를 그대로 재사용하고(같은 야경 규칙이다), 여기서는 태그 쪽만 새로 짠다.
§7 은 **비여행지 이름 규칙**(TRIP-686 · 게이트 5단 정책) 재료다 — 규칙이 걸어야
하는 실측 진양성과, 규칙이 **절대 걸면 안 되는** 실측 오탐 생존자(말장난 상호·
기관명 붙은 역사 건물). 오탐 0 이 원칙이라 생존자 쪽이 더 중요하다.
"""

from __future__ import annotations

from datetime import date, timedelta

from hypothesis import strategies as st

from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId, TransportMode
from trippilot.domain.poi_curation import CandidatePoolRequest
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource
from trippilot.poi_curation.sourcing.osm import _SHOP_TRAVEL
from trippilot.ports.place_existence_port import ExistenceQuery

from tests.generators.geo import geo_points

_ANCHOR = GeoPoint(37.751, 128.876)


@st.composite
def pois_with_attrs(draw) -> Poi:
    """반경(±0.3도≈수십 km)·예산(None~고가)·영업요일·품질 전 분포."""
    i = draw(st.integers(min_value=0, max_value=10**6))
    open_hours: tuple[OpenHour, ...] = ()
    if draw(st.booleans()):
        dows = draw(st.sets(st.integers(0, 6), min_size=1, max_size=4))
        open_hours = tuple(OpenHour(d, 540, 1260) for d in sorted(dows))
    return Poi(
        poi_id=PoiId(f"m{i}"),
        name=draw(st.text(min_size=1, max_size=12)),
        category=draw(st.sampled_from(list(PoiCategory))),
        coord=GeoPoint(
            _ANCHOR.lat + draw(st.floats(-0.3, 0.3, allow_nan=False, allow_infinity=False)),
            _ANCHOR.lng + draw(st.floats(-0.3, 0.3, allow_nan=False, allow_infinity=False)),
        ),
        open_hours=open_hours,
        avg_cost=draw(st.one_of(st.none(), st.integers(0, 200_000))),
        rating=draw(st.one_of(st.none(), st.floats(0, 5, allow_nan=False, allow_infinity=False))),
        quality=draw(st.sampled_from(list(DataQuality))),
        source=PoiSource.SEED,
        confidence=None,
    )


@st.composite
def pool_requests(draw) -> CandidatePoolRequest:
    d0 = draw(st.dates(min_value=date(2026, 8, 1), max_value=date(2026, 8, 20)))
    n = draw(st.integers(min_value=1, max_value=3))
    return CandidatePoolRequest(
        anchor=_ANCHOR,
        dates=tuple(d0 + timedelta(days=k) for k in range(n)),
        budget=draw(st.sampled_from(list(BudgetLevel))),
        transport=draw(st.sampled_from(list(TransportMode))),
        radius_override_km=draw(st.one_of(
            st.none(), st.floats(0.5, 30, allow_nan=False, allow_infinity=False))),
    )


# ── §2 교차 출처 동일성 재료 (TRIP-682) ──────────────────────────────
# 무작위 유니코드를 쓰지 않는다 — 반례가 나왔을 때 **실데이터의 한 줄**이어야
# 재현·수정이 된다. 아래 어휘는 전부 실측 수집분(TourAPI·LOCALDATA)에서 본 표기다.

# (시도, 시군구, 읍면 후보, 도로명 후보). 읍면은 한쪽 출처에만 있는 일이 흔하고,
# 그 차이를 넘는 것이 주소 매칭률을 35.5% → 83.3% 로 올린 조각이다.
_REGIONS: tuple[tuple[str, str, tuple[str, ...], tuple[str, ...]], ...] = (
    ("제주특별자치도", "제주시", ("구좌읍", "애월읍", "한림읍"),
     ("해맞이해안로", "월랑로", "세화14길")),
    ("제주특별자치도", "서귀포시", ("성산읍", "안덕면"), ("중문관광로", "일주동로")),
    ("서울특별시", "종로구", (), ("사직로", "인사동길")),
    ("경기도", "성남시 분당구", (), ("판교로", "황새울로")),
    ("부산광역시", "해운대구", (), ("달맞이길", "구남로")),
    ("강원특별자치도", "고성군", ("토성면",), ("미시령옛길",)),
)
# 주소 꼬리 — 쉼표 뒤 상세주소·괄호 법정동·층 표기 (LOCALDATA 도로명주소 실제 형태)
_ADDR_TAILS = ("", ",", ", 1층", ", A동", ", 지하1층 (적선동)", " (세화리)", " 2층")

# 서로 어느 쪽으로도 포함되지 않는 상호만 고른다 — "다른 가게는 안 붙는다" 를
# 주장하려면 어휘 자체가 그 전제를 만족해야 한다(전제는 생성기 유효성 테스트가 고정).
_STORE_NAMES = (
    "고집돌우럭", "우진해장국", "오픈커피", "김밥천국", "교촌치킨",
    "명진전복", "스타벅스", "올레국수", "돈사돈", "네거리식당",
)
# 지점명 — 정규화가 **떼지 않는다**(떼면 50m 안의 다른 지점이 병합된다).
# 한 가게에는 지점명이 하나뿐이므로 쌍의 양쪽은 같은 라벨만 쓴다.
_BRANCH_LABELS = ("중문점", "판교점", "서면점", "제주점")
# 꼬리표 — 정규화가 떼는 것. 중첩(" 본점 1호점")은 만들지 않는다: 절단이 1회라
# 두 번 적용하면 값이 달라진다(멱등 반례). 실제 상호에 없는 형태라 분포에서 뺀다.
_NAME_TAILS = ("", " 본점", " 직영점", " 1호점", " 2호점")
_PAREN_NOTES = ("", "(제주점)", "(1층)", "(세화리)")

# addr_key 가 None 이 되는 주소 — "다르다"가 아니라 **"모른다"** 인 입력.
# 지번 주소·도로명 결손·읍면까지만 있는 주소, 그리고 세종처럼 시군구 계층이 아예
# 없는 도로명주소(정규식이 시군구를 요구한다)가 여기 떨어진다.
_UNRESOLVABLE_ADDRESSES = (
    None,
    "",
    "제주특별자치도 제주시 한경면 청수리 1234-5",
    "제주특별자치도 서귀포시 성산읍",
    "서울특별시 종로구 사직로",
    "세종특별자치시 한누리대로 2130",
    "번지 미상",
)


def _spaced(draw, tokens: list[str]) -> str:
    """토큰을 1~3칸 공백으로 잇는다 — 중복 공백 표기 변형."""
    out = tokens[0]
    for t in tokens[1:]:
        out += " " * draw(st.integers(min_value=1, max_value=3)) + t
    return out


@st.composite
def _address_form(draw, sido: str, sgg: str, eups: tuple[str, ...],
                  road: str, bldg: str) -> str:
    """한 출처가 적는 주소 표기 하나 (읍면 유무·괄호·꼬리 상세·공백 흔들림)."""
    tokens = [sido, sgg]
    if eups and draw(st.booleans()):
        eup = draw(st.sampled_from(eups))
        tokens.append(f"({eup})" if draw(st.booleans()) else eup)
    tokens += [road, bldg]
    return _spaced(draw, tokens) + draw(st.sampled_from(_ADDR_TAILS))


@st.composite
def road_addresses(draw, *, bldg: str | None = None) -> str:
    """도로명주소 1건 (임의 표기 변형 포함)."""
    sido, sgg, eups, roads = draw(st.sampled_from(_REGIONS))
    road = draw(st.sampled_from(roads))
    number = bldg if bldg is not None else draw(_building_numbers())
    return draw(_address_form(sido, sgg, eups, road, number))


@st.composite
def road_address_pairs(draw, *, bldg: str | None = None) -> tuple[str, str]:
    """**같은 건물**의 두 출처 표기 — addr_key 가 같아야 한다.

    bldg 를 주면 건물번호를 고정한다(여러 가게를 만들 때 키 충돌을 막는 용도).
    """
    sido, sgg, eups, roads = draw(st.sampled_from(_REGIONS))
    road = draw(st.sampled_from(roads))
    number = bldg if bldg is not None else draw(_building_numbers())
    return (draw(_address_form(sido, sgg, eups, road, number)),
            draw(_address_form(sido, sgg, eups, road, number)))


def _building_numbers() -> st.SearchStrategy[str]:
    """건물번호 — 부번 포함(133 과 133-10 은 다른 건물이다)."""
    return st.one_of(
        st.integers(min_value=1, max_value=1999).map(str),
        st.tuples(st.integers(min_value=1, max_value=1999),
                  st.integers(min_value=1, max_value=99)).map(lambda t: f"{t[0]}-{t[1]}"),
    )


@st.composite
def _name_form(draw, base: str, branch: str) -> str:
    """한 출처가 적는 상호 표기 하나 (지점명 유무·꼬리표·괄호 주기·띄어쓰기)."""
    name = base
    if branch and draw(st.booleans()):
        name += " " + branch
    name += draw(st.sampled_from(_NAME_TAILS))
    return name + draw(st.sampled_from(_PAREN_NOTES))


def store_names() -> st.SearchStrategy[str]:
    """상호 어휘 (서로 포함 관계가 없는 집합) — 여러 가게를 만들 때 base 로 쓴다."""
    return st.sampled_from(_STORE_NAMES)


@st.composite
def same_store_name_pairs(draw, *, base: str | None = None) -> tuple[str, str]:
    """**같은 가게**의 두 출처 상호 표기 — 반드시 같은 가게로 판정돼야 한다."""
    name = base if base is not None else draw(st.sampled_from(_STORE_NAMES))
    branch = draw(st.sampled_from(("",) + _BRANCH_LABELS))
    return draw(_name_form(name, branch)), draw(_name_form(name, branch))


@st.composite
def distinct_store_name_pairs(draw) -> tuple[str, str]:
    """**서로 다른 가게**의 상호 — 어떤 표기 변형에도 붙으면 안 된다(오병합 방지)."""
    a, b = draw(st.lists(st.sampled_from(_STORE_NAMES),
                         min_size=2, max_size=2, unique=True))
    return (draw(_name_form(a, draw(st.sampled_from(("",) + _BRANCH_LABELS)))),
            draw(_name_form(b, draw(st.sampled_from(("",) + _BRANCH_LABELS)))))


def unresolvable_addresses() -> st.SearchStrategy[str | None]:
    """addr_key 가 None 인 주소 — 동일성 근거로 써서는 안 되는 입력."""
    return st.sampled_from(_UNRESOLVABLE_ADDRESSES)


# ── §3 실재 확인 재료 (TRIP-683 · PlaceExistencePort) ─────────────────
# 지도 실재 검사(폐업·유령 POI 걸러내기)를 자극하는 입력 두 종류:
#   existence_queries — 조회 1건 (상호는 §2 실측 어휘 재사용, 무작위 유니코드 금지)
#   malformed_payloads — 카카오 응답 **형식 밖** payload. 이것들이 "없음"으로
#       수렴하면 벤더 응답 한 번 바뀔 때 전 POI 가 폐업이 된다.


@st.composite
def existence_queries(draw) -> ExistenceQuery:
    """실재 확인 조회 1건. poi_id 는 유일, 좌표는 한국 bbox 안."""
    i = draw(st.integers(min_value=0, max_value=10**9))
    base = draw(st.sampled_from(_STORE_NAMES))
    branch = draw(st.sampled_from(("",) + _BRANCH_LABELS))
    return ExistenceQuery(
        poi_id=PoiId(f"e{i}"),
        name=f"{base} {branch}".strip(),
        coord=draw(geo_points()),
    )


# `documents` 가 리스트로 오지 않는 응답들 — 전부 "모른다"여야 한다.
# 실측·문서 기반 형태: 카카오 오류 봉투(errorType/message), 필드 개명·오타,
# 봉투 한 겹 추가, 그리고 **파싱 안 된 원문 문자열**(클라이언트가 text 를 그대로
# 돌려주는 사고 — 내용은 정상 응답이라 눈으로는 구분이 안 된다).
_MALFORMED_BODIES: tuple[object, ...] = (
    None,
    True,
    False,
    0,
    1,
    -1,
    3.14,
    "",
    "documents",
    '{"documents": [{"place_name": "고집돌우럭"}]}',   # 파싱 전 원문
    [],
    [{"place_name": "우진해장국"}],
    (),
    {},
    {"x": 1},
    {"errorType": "AccessDeniedError", "message": "app disabled"},
    {"errorType": "RequestThrottled", "message": "quota exceeded"},
    {"meta": {"total_count": 0}},                      # documents 누락
    {"documents": None},
    {"documents": {}},
    {"documents": "없음"},
    {"documents": 0},
    {"documents": ()},                                  # 튜플 — 리스트 아님
    {"document": []},                                   # 필드 오타/개명
    {"result": {"documents": []}},                      # 봉투 한 겹
    {"body": {"items": []}},                            # 다른 벤더 봉투
)


def malformed_payloads() -> st.SearchStrategy[object]:
    """`documents: list` 가 없는 응답. 어떤 것도 NOT_FOUND 로 읽히면 안 된다."""
    return st.sampled_from(_MALFORMED_BODIES)


def kakao_documents(n: int) -> dict:
    """정상 응답 봉투 — n 건의 검색 결과. n=0 이면 진짜 "없음"(NOT_FOUND)."""
    return {
        "meta": {"total_count": n, "is_end": True},
        "documents": [
            {"place_name": f"가게{k}", "x": "126.5", "y": "33.5"} for k in range(n)
        ],
    }


# ── §4 지도 미검출 강등 재료 (TRIP-683 · pool_builder ⑤) ─────────────
# 필터(①~④)를 **전부 통과하도록 고정한** POI 다 — 좌표는 앵커, 예산 미확인(None),
# 품질 FULL·PARTIAL, 영업요일은 있으면 전 요일. 흔드는 것은 ⑤ 정렬 키 4종
# (영업시간 보유·saved_count·rating·poi_id)뿐이다.
# 필터 탈락이 섞이면 "순서가 왜 이런가"가 두 원인으로 갈려 반례를 못 읽는다.

_ALL_WEEK = tuple(OpenHour(d, 540, 1260) for d in range(7))


@st.composite
def sortable_pois(draw) -> Poi:
    """⑤ 정렬만 자극하는 POI. saved_count·rating 은 **동률이 잦게** 좁은 분포다.

    동률이 있어야 새 키(지도 미검출)가 실제로 순서를 가르는 자리가 생긴다 —
    전부 유일값이면 saved_count 하나로 순서가 결정돼 신규 키가 무동작이 된다.
    """
    i = draw(st.integers(min_value=0, max_value=10**6))
    return Poi(
        poi_id=PoiId(f"s{i:07d}"),
        name=draw(st.sampled_from(_STORE_NAMES)),
        category=draw(st.sampled_from(list(PoiCategory))),
        coord=_ANCHOR,
        open_hours=_ALL_WEEK if draw(st.booleans()) else (),
        avg_cost=None,
        rating=draw(st.sampled_from([None, 0.0, 3.5, 5.0])),
        quality=draw(st.sampled_from([DataQuality.FULL, DataQuality.PARTIAL])),
        source=PoiSource.SEED,
        confidence=None,
        saved_count=draw(st.integers(min_value=0, max_value=3)),
    )


# ── §5 Overture 카테고리·이름 어휘 (TRIP-684 · sourcing/overture.py) ──
# `map_category` / `has_korean_name` 재료. 여기도 무작위 유니코드가 아니라
# **실측 표기 조립**이다 — 반례가 Overture 한 줄이어야 재현·수정이 된다
# (릴리스 2026-08-19.0, 한국 bbox 691,968건 표본).

# `observatory` 로 들어오지만 **야경이 아닌 것** — 별·천체를 보는 시설이다.
# 실측 표본에서 그대로 뽑았다(용인어린이천문대·서산류방택천문기상과학관 등).
_ASTRONOMY_KO = (
    "용인어린이천문대",
    "대전시민천문대",
    "별아띠천문대",
    "서산류방택천문기상과학관",
    "만행산천문체험관",
    "사량도천문대",
    "경희대천문대",
    "조경철천문대",
    "국립과천과학관 천체투영관",
    "김해천문대 플라네타륨",
)
# 같은 천문 시설의 **로마자 표기**. 한글 이름이 없어 수집 대상은 아니지만,
# 이름 규칙의 영문 분기(planetarium·astronom)를 자극하는 유일한 입력이다.
_ASTRONOMY_EN = (
    "Gwacheon National Science Museum Planetarium",
    "Bohyunsan Optical Astronomy Observatory",
)
_ASTRONOMY_NAMES = _ASTRONOMY_KO + _ASTRONOMY_EN
# **진짜 야경** — 전망대·전망타워·야시장·야경 명소. 앞 여섯은 실측 표본의 관측치다.
_LOOKOUT_NAMES = (
    "솔오름 전망대",
    "거린사슴전망대",
    "국사봉전망대",
    "넓은드르 전망대",
    "북악산 하늘전망대",
    "오두산통일전망타워",
    "서문시장 야시장",
    "남산 야경 명소",
    "부산타워 전망층",
)
# 야경 규칙 어느 쪽에도 안 걸리는 평범한 한글 이름. `night_market`(44) 에 섞여
# 있던 오분류(`전라도여행맛집`)를 포함한다 — 카테고리만 믿으면 이게 야경이 된다.
_PLAIN_NAMES = _STORE_NAMES + (
    "성산일출봉", "전라도여행맛집", "제주시청", "개심사", "한라수목원",
)
# 한글 음절이 **없는** 이름 — 로마자·숫자·기호·타 문자권·자모 단독·빈 문자열.
# 실측 채움률 63.5% 의 바깥쪽이다. 자모("ㅋㅋ")는 음절이 아니므로 여기 속한다.
_NON_KOREAN_NAMES: tuple[str | None, ...] = (
    None, "", "   ", "\t\n",
    "Starbucks", "GS25", "7-Eleven", "CU", "Jeju Olle Trail",
    "Café de Paris", "N Seoul Tower", "Observatory",
    "123-45", "#@!", "...", "1st Ave.",
    "スターバックス", "星巴克", "ﾊﾝｸﾞﾙ",      # 타 문자권 — 한글이 아니다
    "ㅋㅋ", "ᄀᄁᄂ",                           # 자모 단독 — 음절이 아니다
    "𝕂𝕠𝕣𝕖𝕒",                                  # 수학 기호 문자
)
# 한글 + 로마자 병기 — 실측에 흔한 형태(`사라오름 전망대 Sara Observatory`).
_ROMAN_TAILS = (
    "Sara Observatory", "Observatory", "Night Market", "Cafe", "Restaurant",
    "Trail", "Museum",
)
# 실측 상위에 있으나 **여행지가 아닌** 카테고리 — 채택 목록에 절대 들어오면 안 된다
# (편의점 9,298 · 미용실 9,972 · 치과 3,844 · ATM 4,487 · 주유소 4,029 …).
_NON_TRAVEL_CATEGORIES = (
    "convenience_store", "hair_salon", "dentist", "atm", "gas_station",
    "pharmacy", "bank_credit_union", "real_estate_agent", "hospital",
    "beauty_salon", "car_wash", "elementary_school", "parking", "laundry_service",
    "veterinarian", "insurance_agency", "accountant", "funeral_services",
    "hotel", "motel", "apartment_building", "office_supplies",
)
# 채택 목록 키와 **한 글자 차이**인 것들. 조회는 정확 일치여야 한다 — 대소문자·
# 공백·복수형·상위어가 새어 들어오면 화이트리스트가 화이트리스트가 아니다.
_NEAR_MISS_CATEGORIES = (
    "Korean_Restaurant", "KOREAN_RESTAURANT", " korean_restaurant",
    "korean_restaurant ", "korean_restaurants", "korean restaurant",
    "church", "cathedral", "observatory_deck", "observatories", "Observatory",
    "night_markets", "Park", "park\n", "cafe ", "CAFE", "shopping_mall",
)


def astronomy_names() -> st.SearchStrategy[str]:
    """천문·천체·과학관 이름. 카테고리가 무엇이든 NIGHT_VIEW 가 되면 안 된다."""
    return st.sampled_from(_ASTRONOMY_NAMES)


def lookout_names() -> st.SearchStrategy[str]:
    """진짜 야경 이름(전망대·야시장·야경). 야경 카테고리로 오면 통과해야 한다."""
    return st.sampled_from(_LOOKOUT_NAMES)


def plain_place_names() -> st.SearchStrategy[str]:
    """야경 이름 규칙의 양쪽(_NIGHT_OK·_NIGHT_NO) 어디에도 안 걸리는 한글 이름."""
    return st.sampled_from(_PLAIN_NAMES)


@st.composite
def mixed_script_names(draw) -> str:
    """한글 + 로마자 병기 이름 — 한글 판정은 True 여야 한다(기저는 한글 이름)."""
    base = draw(st.one_of(st.sampled_from(_ASTRONOMY_KO), lookout_names(),
                          plain_place_names()))
    return f"{base} {draw(st.sampled_from(_ROMAN_TAILS))}"


def korean_place_names() -> st.SearchStrategy[str]:
    """한글 음절이 **반드시 있는** 이름 전 분포 (천문·전망·평범·병기).

    로마자 전용 천문 표기(`_ASTRONOMY_EN`)는 여기 들어오지 않는다 — 이 전략의
    계약이 "한글이 있다" 이기 때문이다. 그쪽은 `astronomy_names()` 로 간다.
    """
    return st.one_of(st.sampled_from(_ASTRONOMY_KO), lookout_names(),
                     plain_place_names(), mixed_script_names())


def non_korean_names() -> st.SearchStrategy[str | None]:
    """한글 음절이 **없는** 이름 (None·빈 문자열·타 문자권·자모 단독 포함)."""
    return st.sampled_from(_NON_KOREAN_NAMES)


def non_travel_categories() -> st.SearchStrategy[str]:
    """실측 상위의 비여행 카테고리 — 드롭되는 것이 이 모듈의 존재 이유다."""
    return st.sampled_from(_NON_TRAVEL_CATEGORIES)


def unknown_overture_categories() -> st.SearchStrategy[str | None]:
    """채택 목록 밖 카테고리 후보 — 비여행 · 근접 오타 · 임의 텍스트 · None.

    임의 텍스트가 섞여 있으므로 쓰는 쪽에서 `assume(cat not in _CATEGORY_MAP)` 를
    건다(이론상 충돌 대비). 새 카테고리가 목록에 추가돼도 이 전략은 그대로 유효하다.
    """
    return st.one_of(
        st.none(),
        st.just(""),
        non_travel_categories(),
        st.sampled_from(_NEAR_MISS_CATEGORIES),
        st.text(max_size=16),
    )


# ── §6 OSM 태그 재료 (TRIP-685 · sourcing/osm.py) ─────────────────────
# `map_tags` 재료. Overpass 가 돌려주는 태그 dict 모양 그대로 조립한다.
# §5 와 같은 원칙 — 어휘는 **실측 OSM 태그**이지 무작위 유니코드가 아니다.
# 다만 "채택 목록 밖은 전부 드롭"은 주장 자체가 '모르는 입력'이라 임의 유니코드
# 키/값도 한 전략에 섞는다(쓰는 쪽에서 `assume` 로 이론상 충돌을 뺀다).

# 채택 목록 밖의 실측 태그 — OSM 한국에 대량으로 있고 여행 일정에 넣을 것이 아니다.
# `man_made=observatory` 가 여기 있는 것이 중요하다: OSM 이 천문대에 쓰는 실제
# 태그이고, 우리는 그것을 **태그로도 이름으로도** 받지 않는다.
_OSM_UNADOPTED_TAGS: tuple[tuple[str, str], ...] = (
    ("amenity", "fast_food"), ("amenity", "bank"), ("amenity", "pharmacy"),
    ("amenity", "fuel"), ("amenity", "parking"), ("amenity", "school"),
    ("amenity", "hospital"), ("amenity", "toilets"), ("amenity", "bench"),
    ("amenity", "place_of_worship"), ("amenity", "kindergarten"),
    ("amenity", "atm"), ("amenity", "post_office"), ("amenity", "clinic"),
    ("tourism", "hotel"), ("tourism", "guest_house"), ("tourism", "motel"),
    ("tourism", "hostel"), ("tourism", "information"), ("tourism", "artwork"),
    ("tourism", "picnic_site"), ("tourism", "camp_site"), ("tourism", "gallery"),
    ("natural", "tree"), ("natural", "water"), ("natural", "wood"),
    ("natural", "scrub"), ("natural", "wetland"), ("natural", "spring"),
    ("natural", "cliff"), ("natural", "sand"), ("natural", "bare_rock"),
    ("natural", "coastline"), ("natural", "grassland"),
    ("highway", "bus_stop"), ("highway", "residential"), ("highway", "footway"),
    ("highway", "crossing"), ("highway", "street_lamp"), ("highway", "path"),
    ("building", "yes"), ("building", "apartments"), ("building", "house"),
    ("leisure", "park"), ("leisure", "pitch"), ("leisure", "playground"),
    ("leisure", "garden"), ("leisure", "fitness_centre"),
    ("man_made", "tower"), ("man_made", "surveillance"),
    ("man_made", "observatory"), ("man_made", "water_tower"),
    ("office", "company"), ("office", "estate_agent"),
    ("railway", "station"), ("railway", "subway_entrance"),
    ("landuse", "residential"), ("place", "suburb"), ("barrier", "gate"),
    ("healthcare", "dentist"), ("craft", "carpenter"),
    ("emergency", "fire_hydrant"), ("power", "pole"), ("waterway", "stream"),
)
# 채택 태그와 **한 글자 차이** — 조회는 정확 일치여야 한다. 대소문자·공백·복수형·
# 근접 철자, 그리고 라이프사이클 접두(`disused:`·`was:`·`abandoned:`·`proposed:`).
# 접두가 붙은 것은 **지금 거기 없는 것**이다 — 관대하게 받으면 유령 POI 가 된다.
_OSM_NEAR_MISS_TAGS: tuple[tuple[str, str], ...] = (
    ("tourism", "viewpoints"), ("tourism", "Viewpoint"), ("tourism", "VIEWPOINT"),
    ("tourism", "view_point"), ("tourism", " viewpoint"), ("tourism", "viewpoint "),
    ("Tourism", "viewpoint"), ("TOURISM", "viewpoint"), ("tourism ", "viewpoint"),
    ("natural", "peaks"), ("natural", "Peak"), ("natural", "peak "),
    ("natural", "beaches"), ("natural", "Beach"), ("natural", "beach_resort"),
    ("Natural", "peak"), ("natural ", "peak"), ("natural", "beach\n"),
    ("disused:tourism", "viewpoint"), ("abandoned:natural", "peak"),
    ("was:tourism", "viewpoint"), ("proposed:natural", "beach"),
    ("demolished:tourism", "viewpoint"), ("removed:natural", "peak"),
)
# `shop` 이 아닌데 `shop` 처럼 보이는 키. 값이 채택 목록 안이어도 SHOPPING 이 되면
# 안 된다 — `disused:shop=gift` 는 **닫힌 기념품점**이지 쇼핑 명소가 아니다.
_OSM_SHOP_NEAR_MISS_KEYS: tuple[str, ...] = (
    "Shop", "SHOP", "shops", "shop ", " shop", "shop:type", "shop_1",
    "disused:shop", "was:shop", "abandoned:shop", "proposed:shop", "second_hand",
)
# 채택 목록 밖의 **실측 비여행** shop 값 — 제주 실측에서 배제 목록으로 쫓다가
# 끝이 없어 채택 목록으로 뒤집게 만든 것들(편의점·차량·미용·다이소·안경·휴대폰·
# 문구·철물). `vacant`(공실)·`no`(가게 아님)·`yes`(정보 없음)는 배제 목록 시절에
# 새어들던 유령 값이다. 전부 None 이어야 한다 — 배제가 아니라 **미채택**으로.
_OSM_NON_TRAVEL_SHOP_VALUES: tuple[str, ...] = (
    "convenience", "supermarket", "car", "car_repair", "car_parts", "tyres",
    "hairdresser", "beauty", "pharmacy", "chemist", "optician", "mobile_phone",
    "computer", "stationery", "hardware", "doityourself", "variety_store",
    "laundry", "dry_cleaning", "funeral_directors", "estate_agent", "insurance",
    "kiosk", "tobacco", "e-cigarette", "alcohol", "newsagent", "bookmaker",
    "greengrocer", "butcher", "fishmonger", "pet", "frozen_food",
    "vacant", "no", "yes",
)
# 채택 값과 **한 글자 차이** — 조회는 정확 일치여야 한다. 대소문자·공백·복수형·
# 합성어(`gift_shop`·`duty_free_shop`)가 새어 들어오면 채택 목록이 채택 목록이 아니다.
_OSM_SHOP_NEAR_MISS_VALUES: tuple[str, ...] = (
    "Gift", "GIFT", "gifts", "gift ", " gift", "gift_shop", "giftshop",
    "Souvenir", "souvenirs", "souvenir_shop", "Mall", "malls", "shopping_mall",
    "duty_free_shop", "dutyfree", "department_stores", "Department_Store",
    "outlets", "Art", "arts", "crafts", "teas", "jewellery", "Jewelry",
)
# Overture 가 실측에서 **더 많이 주는** 네 축. OSM 으로는 일부러 안 받는다 —
# 겹치는 축까지 받으면 얻는 것 없이 ODbL 노출만 커진다(osm.py 모듈 주석 비교표).
_OVERTURE_OWNED_TAGS: tuple[tuple[str, str], ...] = (
    ("amenity", "restaurant"), ("amenity", "cafe"),
    ("tourism", "attraction"), ("tourism", "museum"),
)
# 판정에 **영향을 주면 안 되는** 부가 태그. `name` 은 일부러 넣지 않는다(야경
# 이름 규칙의 유일한 입력이다). `description`·`note`·`name:en` 에 천문 어휘를
# 심어 둔 것이 핵심이다 — 이름 규칙이 `name` 밖을 읽으면 여기서 걸린다.
_OSM_NOISE_TAGS: tuple[tuple[str, str], ...] = (
    ("addr:full", "제주특별자치도 제주시 애월읍 애월로 1"),
    ("addr:city", "제주시"), ("addr:postcode", "63000"),
    ("opening_hours", "Mo-Su 09:00-18:00"), ("website", "https://example.kr"),
    ("phone", "+82-64-000-0000"), ("wheelchair", "yes"), ("ele", "1950"),
    ("source", "Bing"), ("operator", "제주특별자치도"), ("wikidata", "Q123"),
    ("name:en", "Bohyunsan Astronomy Observatory"),
    ("name:ja", "ソンサンイルチュルボン"),
    ("description", "천문대 바로 옆"), ("note", "planetarium 공사중"),
    ("tourism:type", "viewpoint"), ("old_name", "대전시민천문대"),
)


# ── 제주 실호출 42건(2026-09-16) — `tourism=viewpoint` 의 실제 내용물 ──
# OSM 의 `viewpoint` 는 "전망이 좋은 지점" 전반이라 **우리 NIGHT_VIEW(야경)와
# 개념이 다르다.** 42건 중 진짜 전망대는 15건(36%)뿐이었고 나머지가 아래다 —
# 동굴·갤러리·기념비·촬영지. 걸러내지 않으면 야경 보러 갔다가 동굴을 만난다.
_OSM_NON_VIEWPOINT_NAMES: tuple[str, ...] = (
    "구린굴", "중동굴", "검멀레동굴",
    "김영갑갤러리", "우도해녀항일기념비", "산신각",
    "용두암", "쇠소깍", "유채꽃촬영지", "인어공주 촬영장소",
)
# 같은 42건의 **통과분** — 이름이 전망 근거를 댄다. 뒤 네 줄은 OSM 쪽에만 있는
# 어휘다(일출·일몰·낙조·로마자 viewpoint/lookout): `viewpoint` 태그가 야경뿐
# 아니라 해돋이·낙조 명소도 담기 때문이다.
_OSM_VIEWPOINT_NAMES: tuple[str, ...] = (
    "성산일출봉 정상전망대", "거린사슴전망대", "산지천 전망대", "사라오름전망대",
    "솔오름 전망대", "국사봉전망대", "넓은드르 전망대", "북악산 하늘전망대",
    "오두산통일전망타워", "부산타워 전망층", "남산 야경 명소",
    "제주 일출 명소", "정방폭포 낙조", "한라산 일몰 포인트",
    "Seongsan Viewpoint", "Sara Oreum Lookout",
)


def osm_viewpoint_names() -> st.SearchStrategy[str]:
    """`tourism=viewpoint` 로 와서 **통과해야** 하는 이름(전망·야경·일출·낙조)."""
    return st.sampled_from(_OSM_VIEWPOINT_NAMES)


def osm_non_viewpoint_names() -> st.SearchStrategy[str]:
    """`tourism=viewpoint` 로 오지만 야경이 **아닌** 이름 — 실측 동굴·갤러리·
    기념비 + 전망 어휘가 없는 평범한 상호. 전부 드롭돼야 한다."""
    return st.sampled_from(_OSM_NON_VIEWPOINT_NAMES + _STORE_NAMES
                           + ("제주시청", "개심사", "한라수목원", "전라도여행맛집"))


def osm_travel_shop_values() -> st.SearchStrategy[str]:
    """`_SHOP_TRAVEL` 채택 목록의 shop 값 — 표에서 **유도**하므로 값이 늘어도 덮인다."""
    return st.sampled_from(sorted(_SHOP_TRAVEL))


def osm_non_travel_shop_values() -> st.SearchStrategy[str]:
    """채택 목록 밖의 실측 비여행 shop 값(`vacant`·`no` 포함) — None 대조군."""
    return st.sampled_from(_OSM_NON_TRAVEL_SHOP_VALUES)


def osm_shop_near_miss_values() -> st.SearchStrategy[str]:
    """채택 값의 대소문자·공백·복수형·합성어 변형. 정확 일치가 아니면 None."""
    return st.sampled_from(_OSM_SHOP_NEAR_MISS_VALUES)


def osm_shop_near_miss_keys() -> st.SearchStrategy[str]:
    """`shop` 이 아닌 키(대소문자·공백·라이프사이클 접두). 채택되면 안 된다."""
    return st.sampled_from(_OSM_SHOP_NEAR_MISS_KEYS)


def osm_unadopted_pairs() -> st.SearchStrategy[tuple[str, str]]:
    """채택 목록 밖의 (키, 값) 1건 — 실측 비채택 + 근접 오타·라이프사이클 접두."""
    return st.sampled_from(_OSM_UNADOPTED_TAGS + _OSM_NEAR_MISS_TAGS)


def overture_owned_tags() -> st.SearchStrategy[dict[str, str]]:
    """Overture 가 이기는 네 축의 OSM 태그 — `map_tags` 는 None 이어야 한다."""
    return st.sampled_from(_OVERTURE_OWNED_TAGS).map(lambda kv: {kv[0]: kv[1]})


@st.composite
def osm_noise_tags(draw) -> dict[str, str]:
    """결과를 바꾸면 안 되는 부가 태그 dict (`name` 없음, 채택 키 없음)."""
    pairs = draw(st.lists(st.sampled_from(_OSM_NOISE_TAGS),
                          max_size=4, unique_by=lambda kv: kv[0]))
    return dict(pairs)


@st.composite
def osm_unadopted_tags(draw) -> dict[str, str]:
    """채택 목록에도 없고 `shop` 값도 채택 밖인 태그 dict — **항상** 드롭돼야 한다.

    다섯 갈래를 한 dict 에 섞는다: 실측 비채택 태그 · 근접 오타/라이프사이클 접두 ·
    `shop` 을 닮은 키 · **채택 목록 밖 `shop` 값**(비여행·근접 변형·임의) · 임의
    유니코드 키/값. 빈 dict 도 나온다(태그 없는 요소).

    임의 유니코드가 이론상 채택 쌍을 만들 수 있으므로 쓰는 쪽에서
    `assume(...)` 로 뺀다 — §5 `unknown_overture_categories` 와 같은 규약이다.
    """
    tags: dict[str, str] = {}
    for k, v in draw(st.lists(osm_unadopted_pairs(), max_size=3)):
        tags[k] = v
    if draw(st.booleans()):
        tags[draw(osm_shop_near_miss_keys())] = draw(osm_travel_shop_values())
    if draw(st.booleans()):
        tags["shop"] = draw(st.one_of(osm_non_travel_shop_values(),
                                      osm_shop_near_miss_values(),
                                      st.text(max_size=10)))
    tags.update(draw(st.dictionaries(st.text(max_size=8), st.text(max_size=8),
                                     max_size=3)))
    if draw(st.booleans()):
        tags.update(draw(osm_noise_tags()))
    if draw(st.booleans()):
        tags["name"] = draw(st.one_of(korean_place_names(), st.text(max_size=12)))
    return tags


# ── §7 비여행지 이름 규칙 재료 (TRIP-686 · 게이트 5단 정책) ──────────────
# `mapping.non_travel_reason` 을 자극하는 두 어휘. 전부 실측(제주·강릉 수집분 —
# Overture `shopping` 에 실려 온 편의점·대형마트·통신, `landmark_and_historical_
# building` 에 실려 온 아파트)이다. 무작위 유니코드로 만들지 않는다 — 반례가
# 실데이터 한 줄이어야 규칙을 좁힐지 넓힐지 판단이 선다.

# 규칙이 **절대 걸면 안 되는** 이름 — 전부 진짜 여행지·식당이다. 한국 상호는 말장난이
# 많고(면사무소·의원·꿀단지 — 식당) 역사 건물은 기관명을 단다(우체국·대학교 본관 —
# 등록문화재). 이 목록에서 하나라도 걸리면 규칙이 넓어진 것이다. 넓은 규칙
# (`학원|대학교|사무소|의원|단지|주공`)이 **일부러 없는** 근거가 이 목록이다.
_NON_TRAVEL_SURVIVORS: tuple[str, ...] = (
    "아파트 카페",                  # 카페 상호 — '아파트'가 이름 끝이 아니다
    "오랑우탄면사무소",             # 면 요리집
    "돈사무소 노형점",              # 돼지고기집
    "조은미의원",                   # 식당 (의원이 아니다)
    "꿀단지",                       # 식당 ('단지'는 관광단지에도 걸린다 — 폐기 근거)
    "곰나루국민관광단지",
    "구 인천우체국",                # 등록문화재
    "서울 고려대학교 본관",         # 사적
    "인하대학교 박물관",            # 대학 박물관 — `대학교` 규칙 26건이 거의 이거였다
    "봉채국수 탑동이마트점",        # 마트 **안** 식당 — 체인명이 앞에 없다
    "애슐리 제주롯데마트점",
    "이마트 제주점 문화센터",       # '점'으로 끝나지 않는다
    "귤품은흑돼지 제주공항점",      # '주공' 규칙이 제주**공**항점에 걸린 근거
    "가야산국립공원 치인자동차야영장",
    "거장산오토캠핑장",
    "하이원리조트 알파인코스터",
)
# 규칙이 걸어야 하는 이름과 그 사유 — `_NON_TRAVEL` 표의 사유 문자열과 같다.
_NON_TRAVEL_HITS: tuple[tuple[str, str], ...] = (
    ("노형 e편한세상 아파트", "apartment"),
    ("정든마을주공1단지아파트", "apartment"),
    ("GS25 연동바다점", "convenience_store"),
    ("CU 제주서광로점", "convenience_store"),
    ("이마트24 강릉여고점", "convenience_store"),
    ("꽃사슴복권마트(슈퍼맨편의점)", "convenience_store"),
    ("이마트 서귀포점", "hypermarket"),
    ("T world 제주지점", "telecom"),
    ("KT 동원텔레콤한림점", "telecom"),
    ("Sk텔레콤 제주As센터", "telecom"),
    ("산삼배양근대리점", "dealership"),
    ("Lacoste 제주 대리점", "dealership"),
)
# 앞뒤 여백 — 규칙은 strip 뒤에 판정하므로 결과를 바꾸면 안 된다.
# U+3000(전각 공백)도 `str.strip` 이 떼는 공백이다.
_NAME_PADDING_ALPHABET = " \t\n　"


def non_travel_survivors() -> st.SearchStrategy[str]:
    """실측 오탐 생존자 — `non_travel_reason` 이 **반드시 None** 이어야 하는 이름."""
    return st.sampled_from(_NON_TRAVEL_SURVIVORS)


def non_travel_hits() -> st.SearchStrategy[tuple[str, str]]:
    """실측 진양성 (이름, 사유) — `non_travel_reason` 이 그 사유를 내야 한다."""
    return st.sampled_from(_NON_TRAVEL_HITS)


def travel_names() -> st.SearchStrategy[str]:
    """비여행 규칙 어디에도 안 걸려야 하는 이름 전 분포 — 오탐 생존자 + §2 상호 +
    §5 한글 장소명(천문·전망·평범·병기). 대조군으로 쓴다."""
    return st.one_of(non_travel_survivors(), store_names(), korean_place_names())


def name_padding() -> st.SearchStrategy[str]:
    """이름 앞뒤에 붙일 공백 문자열 (빈 문자열 포함)."""
    return st.text(alphabet=_NAME_PADDING_ALPHABET, max_size=3)
