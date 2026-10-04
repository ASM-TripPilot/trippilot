"""LOCALDATA 일반음식점 CSV 한 행 → 게이트 입력 (TRIP-1224).

식당 공백 지역을 메울 두 번째 FOOD 출처의 **입구 필터**를 고정한다(`sourcing/localdata.py`).
실 호출 0 — CSV·pyproj 없이 돈다. 좌표 변환(EPSG:5174 → WGS84)은 주입받는다.

증명하는 것:
- **채택 목록이지 배제 목록이 아니다.** 업태가 목록 밖이면 **무엇이든** 드롭이다 — 원본에 실제로
  있는 주점·카페·출장조리 업태(회귀 고정)와 임의 문자열 전부. 원본이 업태를 하나 늘려도 조용히
  새어들지 않는다("모르는 것은 넣지 않는다").
- **영업 중(`영업/정상`)만.** 그 밖의 상태값은 무엇이든 드롭이다.
- **관광과 무관한 식당은 이름으로 뺀다** — 구내·직원식당·급식·공사 현장·연수원 식당, 장례식장,
  예식장, 골프장 시설, 보신탕. 규칙마다 원본에서 뽑은 실제 상호로 걸리는 것과 **걸리면 안 되는
  것**(말장난 상호·지점명)을 함께 고정한다 — 생존자가 하나라도 걸리면 규칙이 넓어진 것이다.
- **고속도로 휴게소는 주소(도로명 '○○고속도로')로 뺀다** — 한쪽 방향에서만 들어간다. 이름이
  '고속도로'인 시내 도로·지방도와 국도변 휴게소는 남는다.
- **주소의 옛 시도 명칭은 카탈로그 정식 명칭으로** 바뀐다 — 백엔드 `RegionResolver` 는 첫
  토큰이 정식 명칭과 같아야 지역 코드를 붙인다.
- 좌표·주소·이름·관리번호가 없으면 사유별로 드롭한다(백엔드가 어차피 못 받는 것은 미리 끊는다).
"""

from __future__ import annotations

import math

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.domain.poi import PoiCategory
from trippilot.poi_curation.sourcing.localdata import (
    ADOPTED_TYPES,
    DROP_NO_ADDRESS,
    DROP_NO_COORD,
    DROP_NO_NAME,
    DROP_NO_REF,
    DROP_NOT_MEAL_STOP,
    DROP_NOT_OPEN,
    DROP_TYPE_NOT_ADOPTED,
    KIND,
    OPEN_STATUS,
    SOURCE,
    normalize_address,
    not_a_meal_stop,
    to_candidate,
)
from trippilot.poi_curation.sourcing.collection_gate import SourcingCandidate


def _to_wgs84(x: float, y: float) -> tuple[float, float]:
    """변환기 대역 — pyproj `Transformer.transform` 과 같은 (x, y) → (경도, 위도) 순서."""
    return 126.0 + x / 1e6, 37.0 + y / 1e6


def _row(**over: str) -> dict[str, str]:
    """CSV 한 행(쓰는 칸만). 값은 원본 표기 그대로 — 좌표 뒤 공백·주소 괄호 법정동까지."""
    row = {
        "관리번호": "3000000-101-1970-00526",
        "영업상태명": "영업/정상",
        "업태구분명": "한식",
        "사업장명": "경원집",
        "도로명주소": "서울특별시 종로구 사직로 133-6 (적선동)",
        "지번주소": "서울특별시 종로구 적선동 27-0 ",
        "좌표정보(X)": "197589.395081387    ",
        "좌표정보(Y)": "452654.995095917    ",
        "데이터갱신시점": "2026-01-14 14:26:29",
    }
    row.update(over)
    return row


def _candidate(**over: str) -> SourcingCandidate:
    out = to_candidate(_row(**over), _to_wgs84)
    assert isinstance(out, SourcingCandidate), out
    return out


# ── 정상 행 ─────────────────────────────────────────────────────────


def test_open_adopted_row_becomes_food_candidate() -> None:
    c = _candidate()
    assert c.source == SOURCE == "localdata"
    assert c.ref == ("localdata", "3000000-101-1970-00526")   # 출처 포함 키 — 번호 충돌 방어(TRIP-682)
    assert c.kind == KIND
    assert c.name == "경원집"
    assert c.category is PoiCategory.FOOD
    assert c.category_codes == ("한식",)                       # 업태 원문 — 제안 문서의 tags 가 된다
    assert c.address == "서울특별시 종로구 사직로 133-6 (적선동)"
    assert (c.lng, c.lat) == _to_wgs84(197589.395081387, 452654.995095917)
    # 원본에 없는 것은 비워 둔다 — 지어내지 않는다
    assert c.open_hours == () and c.hours_raw is None and c.image_url is None


# ── 영업 상태 ─────────────────────────────────────────────────────────


@settings(max_examples=200)
@given(st.one_of(st.sampled_from(["폐업", "휴업", "취소/말소/만료/정지/중지", "", "영업", "영업/정상 중"]),
                 st.text(max_size=12)))
def test_only_open_status_passes(status: str) -> None:
    out = to_candidate(_row(영업상태명=status), _to_wgs84)
    if status.strip() == OPEN_STATUS:
        assert isinstance(out, SourcingCandidate)
    else:
        assert out == DROP_NOT_OPEN


# ── 업태: 채택 목록 ───────────────────────────────────────────────────

# 원본(2026-09 내려받음)의 영업 중 행에 실제로 있는 업태 중 **채택하지 않은 것** — 회귀 고정.
# 주점(호프/통닭·정종/대포집/소주방·감성주점·라이브카페), 카페(까페·커피숍·전통찻집·키즈카페·
# 기타 휴게음식점), 자리가 없는 영업(출장조리·이동조리·푸드트럭), 뭐든 섞인 '기타'·빈 값.
_OBSERVED_NOT_ADOPTED = (
    "호프/통닭", "정종/대포집/소주방", "감성주점", "라이브카페", "키즈카페", "까페", "커피숍",
    "전통찻집", "기타", "기타 휴게음식점", "출장조리", "이동조리", "푸드트럭", "",
)


@pytest.mark.parametrize("kind", _OBSERVED_NOT_ADOPTED)
def test_observed_non_meal_types_are_dropped(kind: str) -> None:
    assert to_candidate(_row(업태구분명=kind), _to_wgs84) == DROP_TYPE_NOT_ADOPTED


@settings(max_examples=300)
@given(st.text(max_size=20))
def test_unknown_types_are_dropped(kind: str) -> None:
    """목록 밖은 **무엇이든** 드롭 — 원본이 업태를 새로 만들어도 새어들지 않는다."""
    out = to_candidate(_row(업태구분명=kind), _to_wgs84)
    if kind.strip() in ADOPTED_TYPES:
        assert isinstance(out, SourcingCandidate)
    else:
        assert out == DROP_TYPE_NOT_ADOPTED


@pytest.mark.parametrize("kind", sorted(ADOPTED_TYPES))
def test_every_adopted_type_passes_with_its_name_as_tag(kind: str) -> None:
    assert _candidate(업태구분명=kind).category_codes == (kind,)


def test_adopted_and_observed_not_adopted_are_disjoint() -> None:
    assert not ADOPTED_TYPES & set(_OBSERVED_NOT_ADOPTED)


# ── 이름: 관광과 무관한 식당 ─────────────────────────────────────────

# 원본에서 뽑은 실제 상호와 걸려야 하는 사유.
_NOT_MEAL_STOPS = (
    ("포항공항 구내식당", "cafeteria"),
    ("힐드로사이CC 직원식당", "cafeteria"),
    ("강원대학교강릉원주생협학생식당", "cafeteria"),
    ("파인푸드장로회신학대학교교직원식당", "cafeteria"),
    ("제2부두노무자급식소", "cafeteria"),
    ("단체급식 미소", "cafeteria"),
    ("윤셰프급식", "cafeteria"),
    ("철원병원식당", "cafeteria"),
    # 공사 현장·연수원·공단 구내 — 이하 사유별 추가분은 리뷰 반영(2026-10-04), 공백 보강분·원본의 실제 상호
    ("대상현장식당", "cafeteria"),
    ("영흥함바식당", "cafeteria"),
    ("공단구내", "cafeteria"),
    ("농협 구내매점분식", "cafeteria"),
    ("교촌에프앤비(주)포항연수원", "cafeteria"),
    ("지오에프에스 비콘힐스 직원점", "cafeteria"),
    ("예천장례식장식당", "funeral"),
    ("홍천농업협동조합(홍천군장례식장)", "funeral"),
    ("오페라웨딩홀뷔페", "wedding"),
    ("유유예식장 레스토랑", "wedding"),
    ("남서울컨트리클럽 10호그늘집", "golf"),
    ("힐드로사이CC 스타트하우스", "golf"),
    ("파주CC그늘집(서)", "golf"),
    ("남춘천씨씨대식당", "golf"),
    ("문막스크린골프", "golf"),
    ("육군남성대체력단련장(그늘집)", "golf"),
    ("(주)서윤푸드 화랑6홀그늘집", "golf"),        # 홀 번호
    ("나인브릿지그늘집15번", "golf"),              # 그늘집 번호
    ("(유)동부에프앤비 15그늘집", "golf"),
    ("어썸임페리얼레이크 14번그늘집", "golf"),
    ("오션힐스영천점 그늘집 - 3", "golf"),
    ("골드코스그늘집", "golf"),                    # 코스 그늘집
    ("고성CC레스토랑", "golf"),                    # CC 뒤 시설어
    ("벨포레CC연회장", "golf"),
    ("파주CC스타트", "golf"),
    ("(주)풀무원푸드앤컬처 석정힐CC마운틴", "golf"),
    ("(주)풀무원푸드앤컬처 석정힐cc클럽하우스", "golf"),  # 소문자
    ("플라밍고CC", "golf"),                        # CC 로 끝남
    ("옥과기안cc", "golf"),
    ("나인브릿지클럽하우스레스토랑", "golf"),       # 클럽하우스 + 식당류
    ("클럽하우스홀", "golf"),
    ("옛날보신탕", "dog_meat"),
    ("은행나무사철탕", "dog_meat"),
    ("안흥가마솥영양탕", "dog_meat"),
    ("원풍보양탕", "dog_meat"),
    ("내일촌 보양탕", "dog_meat"),
    ("성주집 흑염소&보양탕", "dog_meat"),           # 흑염소와 **같이** 파는 보양탕
)

# 걸리면 안 되는 실제 상호 — 넓은 규칙(학교·회사·병원·급식·예식·그늘집·CC)이 죽이는 진짜 식당들.
_SURVIVORS = (
    "특급식당",                    # '급식' 이 들어 있지만 특급 식당
    "국가대표급식육식당",            # 국가대표급 식육식당
    "상예식당",                    # '예식' 이 들어 있지만 상예 식당
    "육식사관학교 수원매교점",        # '학교' 는 규칙이 아니다 — 고깃집 체인
    "학교앞옛날떡볶이본점",
    "주식회사 을밀대",              # '회사' 는 규칙이 아니다 — 법인 식당
    "본죽&비빔밥 강동성심병원점",     # 병원 **앞·안의 일반 식당**은 손님을 받는다
    "시청앞그늘집",                 # 골프장 밖의 '그늘집' 상호
    "그늘집냉면 금천점",
    "캡틴클럽하우스 강정마을해군기지점(captainclub house)",
    "씨씨엘치킨팔복점",             # '씨씨' 가 상호의 일부
    "얌샘김밥사천케이씨씨점",
    "장수흑염소영양탕",             # 흑염소·오리 영양탕은 보신탕이 아니다
    "20년오리영양탕",
    "해병부대찌개",                 # '부대' 는 규칙이 아니다
    "청사포 감나무집",
    # 리뷰 반영(2026-10-04)으로 늘린 규칙이 죽이면 안 되는 실제 상호
    "제주팔레스호텔구내(한식)",      # 제주 호텔 식당의 등록 관행 — '구내' 단독은 규칙이 아니다
    "티엠티피자(T.M.T PIZZA) 대구내당점",
    "후쿠오카함바그 NC강서점",       # 함바그 = 함박스테이크
    "이찌방스시 지방행정연수원점",    # 연수원 **근처** 식당의 지점명
    "다발연수원관광농원",
    "현대종합연수원(주)스카이라운지",  # 호텔(블룸비스타) 운영 법인명
    "465그늘집",                    # 세 자리 수는 홀 번호가 아니다(시내 분식집)
    "홀통중앙횟집",                 # '홀' 은 번호가 붙을 때만 — 홀통은 무안 해변 이름
    "천서리막국수 레이크cc점",       # 'CC점' 은 골프장 근처 체인의 지점명
    "라멘 킥스타트",                # '스타트' 단독은 규칙이 아니다
    "흑염소 보양탕 전문",            # 바로 앞(띄어쓰기 무시)이 흑염소·장어·뼈면 그 재료의 탕
    "바다장어보양탕",
    "지리산 소 목뼈 보양탕식당",
)


@pytest.mark.parametrize(("name", "reason"), _NOT_MEAL_STOPS)
def test_not_meal_stop_names_are_dropped_with_reason(name: str, reason: str) -> None:
    assert not_a_meal_stop(name) == reason
    assert to_candidate(_row(사업장명=name), _to_wgs84) == f"{DROP_NOT_MEAL_STOP}:{reason}"


@pytest.mark.parametrize("name", _SURVIVORS)
def test_survivors_pass(name: str) -> None:
    assert not_a_meal_stop(name) is None
    assert _candidate(사업장명=name).name == name


@pytest.mark.parametrize("name", ["", "   "])
def test_missing_name_is_dropped(name: str) -> None:
    assert to_candidate(_row(사업장명=name), _to_wgs84) == DROP_NO_NAME


# ── 주소 ──────────────────────────────────────────────────────────────

# 옛 명칭 → 카탈로그(R__seed_region_catalog) 정식 명칭. 광주는 전남과 통합됐다.
_RENAMED = (
    ("강원도", "강원특별자치도"),
    ("전라북도", "전북특별자치도"),
    ("전라남도", "전남광주통합특별시"),
    ("광주광역시", "전남광주통합특별시"),
)
_CATALOG_SIDO = (
    "서울특별시", "전남광주통합특별시", "부산광역시", "대구광역시", "인천광역시", "대전광역시",
    "울산광역시", "세종특별자치시", "경기도", "충청북도", "충청남도", "경상북도", "경상남도",
    "제주특별자치도", "강원특별자치도", "전북특별자치도",
)
_TAILS = st.lists(st.sampled_from(["동구", "춘천시", "여수시", "중앙로", "12", "1층", "(초량동)", ","]),
                  max_size=5)


@settings(max_examples=200)
@given(st.sampled_from(_RENAMED), _TAILS)
def test_old_sido_names_become_catalog_names(pair: tuple[str, str], tail: list[str]) -> None:
    old, new = pair
    assert normalize_address(" ".join([old, *tail])) == " ".join([new, *tail])


@settings(max_examples=200)
@given(st.sampled_from(_CATALOG_SIDO), _TAILS)
def test_catalog_names_are_left_alone(sido: str, tail: list[str]) -> None:
    address = " ".join([sido, *tail])
    assert normalize_address(address) == address


@settings(max_examples=200)
@given(st.one_of(st.sampled_from([*_RENAMED[0], *_CATALOG_SIDO]).map(lambda s: s + " 중앙로  1"),
                 st.text(max_size=30)))
def test_normalize_address_is_idempotent(address: str) -> None:
    once = normalize_address(address)
    assert normalize_address(once) == once


def test_road_address_wins_and_jibun_is_the_fallback() -> None:
    assert _candidate().address.startswith("서울특별시 종로구 사직로")
    assert _candidate(도로명주소=" ").address == "서울특별시 종로구 적선동 27-0"
    assert _candidate(도로명주소="", 지번주소="강원도 춘천시 중앙로 1").address == "강원특별자치도 춘천시 중앙로 1"


def test_missing_address_is_dropped() -> None:
    """주소는 백엔드가 지역 코드를 정하는 유일한 근거다(TRIP-535 과 같은 이유로 미리 끊는다)."""
    assert to_candidate(_row(도로명주소="", 지번주소="  "), _to_wgs84) == DROP_NO_ADDRESS


# 고속도로 휴게소 — 원본의 실제 도로명주소. '광주대구'는 '구'로 끝나도 고속도로다.
_HIGHWAY_ADDRESSES = (
    "경상북도 구미시 옥성면 중부내륙고속도로 128 (외5필지 선산휴게소 상지점)",
    "강원특별자치도 홍천군 화촌면 서울양양고속도로 84",
    "경기도 오산시 수도권제2순환고속도로 13, 오산휴게소 (과천방향) 주1(휴게소), 주2(창고) (지곶동)",
    "대구광역시 달성군 논공읍 88올림픽고속도로 176, 1층",
    "전북특별자치도 순창군 순창읍 광주대구고속도로 27",
)
# 남아야 하는 것 — 이름만 '고속도로'인 시내 도로·지방도, 국도변 휴게소(한계령휴게소식당)
_NOT_HIGHWAY_ADDRESSES = (
    "대전광역시 서구 갑천도시고속도로 1913, 1, 2층 (월평동)",
    "경상남도 하동군 진교면 구고속도로 849",
    "강원특별자치도 양양군 서면 설악로 1",
)


@pytest.mark.parametrize("address", _HIGHWAY_ADDRESSES)
def test_highway_rest_areas_are_dropped(address: str) -> None:
    assert to_candidate(_row(도로명주소=address), _to_wgs84) == f"{DROP_NOT_MEAL_STOP}:highway"


@pytest.mark.parametrize("address", _NOT_HIGHWAY_ADDRESSES)
def test_roads_merely_named_highway_and_national_road_rest_areas_pass(address: str) -> None:
    assert _candidate(도로명주소=address).address == address


# ── 좌표·식별자 ───────────────────────────────────────────────────────


@pytest.mark.parametrize(("x", "y"), [("", "452654.9"), ("197589.3", "  "), ("abc", "452654.9")])
def test_missing_or_broken_coords_are_dropped(x: str, y: str) -> None:
    assert to_candidate(_row(**{"좌표정보(X)": x, "좌표정보(Y)": y}), _to_wgs84) == DROP_NO_COORD


@pytest.mark.parametrize("bad", [math.inf, math.nan])
def test_non_finite_conversion_is_dropped(bad: float) -> None:
    """변환기가 inf 를 돌려주는 입력이 있다(투영 범위 밖) — 거리 계산에 섞이면 비교가 전부 거짓이 된다."""
    assert to_candidate(_row(), lambda x, y: (bad, 37.0)) == DROP_NO_COORD


def test_missing_management_number_is_dropped() -> None:
    """관리번호가 멱등 키다 — 없으면 백엔드가 `no_source_ref` 로 버린다."""
    assert to_candidate(_row(관리번호=" "), _to_wgs84) == DROP_NO_REF
