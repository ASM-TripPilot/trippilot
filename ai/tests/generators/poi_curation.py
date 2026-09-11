"""M7 generator — 필터를 자극하는 POI 분포 + 풀 요청 (U3 FD §5).

§2(파일 하단) 는 **교차 출처 동일성 판정**(TRIP-682) 재료다 — 같은 가게가 출처마다
다르게 적히는 상호·주소 표기 변형을 조립한다.
§3 은 **지도 실재 확인**(TRIP-683) 재료다 — 조회 1건과, "없음"으로 읽히면 안 되는
형식 밖 응답들.
"""

from __future__ import annotations

from datetime import date, timedelta

from hypothesis import strategies as st

from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId, TransportMode
from trippilot.domain.poi_curation import CandidatePoolRequest
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource
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
