"""LOCALDATA 휴게음식점 → 카페 등록 제안 (사용자 결정 2026-10-19).

일정에 카페가 거의 안 나오는 것은 데이터에 카페가 없어서다 — 서울시청 10km 안 공유본 CAFE 126곳
(FOOD 12,728곳). 인허가 대장의 휴게음식점 중 카페·찻집만 골라 넣는다(`sourcing/localcafe.py`).
실 호출 0 — CSV·pyproj 없이 돈다. 좌표 변환은 주입받는다.

고정하는 것:
- **채택 업태 셋(커피숍·전통찻집·떡카페)만.** 편의점·다방·패스트푸드·고속도로 같은 휴게음식점
  업태는 무엇이든 드롭이다.
- **영업 중만, 전국 카페 체인은 뺀다** — 식당과 같은 `is_franchise` 한 곳에서.
- **앵커마다 큰 곳(시설총규모)부터 K곳, 합집합.** 가까운 순이 아니다 — 동네 테이크아웃이 아니라
  찾아갈 만한 카페를 고르는 대리 지표다.
- **잠정 ID 가 식당 문서와 겹치지 않는다** — `localdata-cafe-<관리번호>`, 카테고리 CAFE.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from trippilot.domain.common import GeoPoint
from trippilot.domain.poi import PoiCategory
from trippilot.poi_curation.sourcing.collection_gate import SourcingCandidate
from trippilot.poi_curation.sourcing.localcafe import (
    CAFE_TYPES,
    KIND,
    SOURCE,
    pick_largest_near,
    to_cafe,
)
from trippilot.poi_curation.sourcing.localdata import (
    DROP_FRANCHISE,
    DROP_NOT_OPEN,
    DROP_TYPE_NOT_ADOPTED,
    SOURCE_NAME,
    gate_against_tourapi,
    to_candidate,
    to_output_document,
)
from trippilot.poi_curation.sourcing.localdata import (
    SOURCE as RESTAURANT_SOURCE,
)
from trippilot.poi_curation.sourcing.mapping import is_franchise

_CITY_HALL = GeoPoint(37.5665, 126.9780)


def _to_wgs84(x: float, y: float) -> tuple[float, float]:
    """변환기 대역 — pyproj `Transformer.transform` 과 같은 (x, y) → (경도, 위도) 순서."""
    return 126.0 + x / 1e6, 37.0 + y / 1e6


def _row(**over: str) -> dict[str, str]:
    """휴게음식점 CSV 한 행(쓰는 칸만). 관리번호 업종 칸이 `104`(휴게음식점)다 — 일반음식점은 `101`."""
    row = {
        "관리번호": "3000000-104-2019-00123",
        "영업상태명": "영업/정상",
        "업태구분명": "커피숍",
        "사업장명": "카페 공명",
        "도로명주소": "서울특별시 종로구 삼청로 101 (삼청동)",
        "지번주소": "서울특별시 종로구 삼청동 62-1",
        "좌표정보(X)": "197589.395081387    ",
        "좌표정보(Y)": "452654.995095917    ",
        "시설총규모": "120.50",
        "데이터갱신시점": "2026-01-14 14:26:29",
    }
    row.update(over)
    return row


def _cafe(ref: str, lat: float, lng: float, *, name: str = "카페 공명") -> SourcingCandidate:
    return SourcingCandidate(
        source_ref=ref, kind=KIND, name=name, address="서울특별시 종로구 삼청로 101 (삼청동)",
        lat=lat, lng=lng, category=PoiCategory.CAFE, category_codes=("커피숍",), open_hours=(),
        hours_raw=None, image_url=None, modified_at=None, source=SOURCE,
    )


# ── 행 판정 ──────────────────────────────────────────────────────────


@pytest.mark.parametrize("kind", sorted(CAFE_TYPES))
def test_채택_업태는_카페로_들어온다(kind: str) -> None:
    out = to_cafe(_row(업태구분명=kind), _to_wgs84)
    assert not isinstance(out, str), out
    cafe, size = out
    assert cafe.category is PoiCategory.CAFE
    assert cafe.kind == KIND == "휴게음식점"
    assert cafe.source == SOURCE
    assert cafe.category_codes == (kind,)
    assert size == 120.5


def test_채택_업태는_셋뿐이다() -> None:
    assert CAFE_TYPES == {"커피숍", "전통찻집", "떡카페"}


# 원본 영업 중 업태 전수(2026-09 원본) 중 카페가 아닌 것 — 무엇이든 드롭이다
@pytest.mark.parametrize("kind", [
    "기타 휴게음식점", "편의점", "일반조리판매", "패스트푸드", "다방", "푸드트럭", "아이스크림", "백화점",
    "고속도로", "키즈카페", "과자점", "철도역구내", "유원지", "극장", "관광호텔", "공항", "", "까페",
])
def test_채택_업태_밖은_드롭이다(kind: str) -> None:
    assert to_cafe(_row(업태구분명=kind), _to_wgs84) == DROP_TYPE_NOT_ADOPTED


@pytest.mark.parametrize("status", ["폐업", "휴업", ""])
def test_영업_중이_아니면_드롭이다(status: str) -> None:
    assert to_cafe(_row(영업상태명=status), _to_wgs84) == DROP_NOT_OPEN


@pytest.mark.parametrize("size, expected", [("", 0.0), ("abc", 0.0), ("  33.0 ", 33.0), ("-5", 0.0)])
def test_시설총규모를_못_읽으면_0_이다(size: str, expected: float) -> None:
    out = to_cafe(_row(시설총규모=size), _to_wgs84)
    assert not isinstance(out, str)
    assert out[1] == expected


# 사용자 지목 15개 체인 — 원본 상호의 표기 변주(법인 접두·영문 병기·띄어쓰기·붙여쓰기)대로
_CAFE_CHAINS = (
    "스타벅스 종로구청점", "(주)스타벅스커피코리아 망원역점", "투썸플레이스장안점",
    "A TWOSOME PLACE(투썸플레이스)  반포효성점", "이디야커피 강릉중앙점", "(주)이디야경희대캠퍼스점",
    "메가엠지씨커피 장안점", "MEGA COFFEE 메가커피 동소문점", "컴포즈커피 강릉포남점", "빽다방 신촌역점",
    "할리스 종로5가점", "(주)커피빈코리아 신촌점", "커피빈 경복궁역3번출구점", "폴바셋 광화문점",
    "카페파스쿠찌 남산점", "엔제리너스 대학로점", "탐앤탐스 군자역점", "매머드익스프레스경희대점",
    "매머드커피 연남점", "더벤티 홍제역점", "the Venti(더벤티) 홍제역점", "공차 수유역점",
    # 첫 산출에 남아 있던 표기 변주
    "엔젤리너스커피", "투썸 별내역점", "컴포즈 안양관양점", "TOM N TOMS(탐 앤 탐스)강남역사거리점",
    # 첫 산출에서 앵커 몫을 10곳 이상 차지한 전국 카페·디저트 체인(세라젬은 안마의자 매장)
    "설빙 수유역점", "요거프레소 평창점", "디저트39 동해북삼점", "하삼동커피 울산삼산점", "텐퍼센트커피 방학점",
    "에이바우트커피 구미인동점", "커피베이 강북수유점", "천씨씨커피 원주단계점", "더리터 군산점",
    "카페베네 미아사거리역점", "카페드롭탑 서여의도점", "세라젬 웰라운지 서울목동 직영점",
)


@pytest.mark.parametrize("name", _CAFE_CHAINS)
def test_전국_카페_체인은_뺀다(name: str) -> None:
    assert is_franchise(name), f"체인인데 남았다: {name}"
    assert to_cafe(_row(사업장명=name), _to_wgs84) == DROP_FRANCHISE


# 원본 영업 중 상호 — 체인 줄을 처음 걸었을 때 실제로 걸렸던 오탐(휴게음식점·일반음식점 전수 눈검사)
@pytest.mark.parametrize("name", [
    "서아이디야", "Jalisco(할리스코)", "커피빈스(Coffee Beans)", "커피빈's", "킹 Coffee Bean", "커피빈준스",
    "커피빈우", "달설빙수", "폼폼커피베이비", "컴바인커피베이커리", "카페베네치아", "투썸가든", "컴포즈파크에비뉴",
    "커피빈&현미와누룽지",   # 체인이 곁다리로 묶인 상호는 남긴다(식당과 같은 규칙)
])
def test_지역_가게는_카페_체인으로_오인하지_않는다(name: str) -> None:
    assert not is_franchise(name), f"지역 카페가 체인으로 걸렸다: {name}"


# ── 선별: 앵커마다 큰 곳부터 ─────────────────────────────────────────


def test_앵커마다_가까운_곳이_아니라_큰_곳부터_K곳() -> None:
    # 북쪽으로 0.001°(≈111m)씩 — 번호가 클수록 멀고, 크기도 크다
    cafes = [(_cafe(f"C-{i}", _CITY_HALL.lat + 0.001 * i, _CITY_HALL.lng), float(10 * i)) for i in range(10)]
    got = pick_largest_near([_CITY_HALL], cafes, per_anchor=3)
    assert {c.source_ref for c in got} == {"C-7", "C-8", "C-9"}


def test_반경_밖은_아무리_커도_안_가져온다() -> None:
    far = (_cafe("FAR", _CITY_HALL.lat + 0.03, _CITY_HALL.lng), 9999.0)   # ≈3.3km
    near = (_cafe("NEAR", _CITY_HALL.lat + 0.001, _CITY_HALL.lng), 1.0)
    assert [c.source_ref for c in pick_largest_near([_CITY_HALL], [far, near])] == ["NEAR"]


def test_크기가_같으면_가까운_곳부터() -> None:
    cafes = [(_cafe("A", _CITY_HALL.lat + 0.005, _CITY_HALL.lng), 50.0),
             (_cafe("B", _CITY_HALL.lat + 0.001, _CITY_HALL.lng), 50.0)]
    assert [c.source_ref for c in pick_largest_near([_CITY_HALL], cafes, per_anchor=1)] == ["B"]


def test_앵커끼리_겹친_카페는_한_번만_나온다() -> None:
    other = GeoPoint(_CITY_HALL.lat + 0.002, _CITY_HALL.lng)
    cafes = [(_cafe(f"C-{i}", _CITY_HALL.lat + 0.001 * i, _CITY_HALL.lng), float(100 - i)) for i in range(4)]
    got = pick_largest_near([_CITY_HALL, other], cafes, per_anchor=4)
    refs = [c.source_ref for c in got]
    assert sorted(refs) == ["C-0", "C-1", "C-2", "C-3"]          # 두 앵커가 넷을 다 고르지만 한 번씩
    assert len(refs) == len(set(refs))


def test_앵커_상한은_기본_8곳이다() -> None:
    cafes = [(_cafe(f"C-{i:02d}", _CITY_HALL.lat + 0.0005 * i, _CITY_HALL.lng), float(i)) for i in range(20)]
    assert len(pick_largest_near([_CITY_HALL], cafes)) == 8


# ── 게이트·문서: 식당 문서와 겹치지 않는다 ────────────────────────────


def test_잠정_ID는_식당과_다른_접두이고_문서는_수신_계약_그대로다() -> None:
    out = to_cafe(_row(), _to_wgs84)
    assert not isinstance(out, str)
    cafe, _ = out
    gated = gate_against_tourapi([], [cafe], keep_source=SOURCE)
    assert len(gated.passed) == 1, "keep_source 를 안 넘기면 카페가 '우리 몫'으로 안 잡혀 다 빠진다"
    doc = to_output_document(gated.passed, collected_at=datetime(2026, 10, 19, tzinfo=UTC), stats={})
    (p,) = doc["proposals"]
    assert doc["source"] == p["source"] == SOURCE_NAME == "LOCALDATA"
    assert p["provisional_id"] == p["poi"]["poi_id"] == "localdata-cafe-3000000-104-2019-00123"
    assert p["poi"]["category"] == "CAFE"
    assert p["tags"] == ["커피숍"]
    assert p["provenance"]["content_id"] == "3000000-104-2019-00123"   # 수신 멱등 키 = 관리번호

    # 같은 행을 식당으로 읽었다면 붙었을 ID 와 다르다
    restaurant = to_candidate(_row(업태구분명="한식"), _to_wgs84)
    assert isinstance(restaurant, SourcingCandidate) and restaurant.source == RESTAURANT_SOURCE
    assert f"{restaurant.source}-{restaurant.source_ref}" != p["provisional_id"]


def test_TourAPI_에_있는_같은_카페는_병합으로_빠진다() -> None:
    cafe = _cafe("3000000-104-2019-00123", 37.5759, 126.9707, name="카페 공명")
    tour = SourcingCandidate(
        source_ref="1000981", kind="39", name="카페 공명", address="서울특별시 종로구 삼청로 101 (삼청동)",
        lat=37.5759, lng=126.9707, category=PoiCategory.CAFE, category_codes=(), open_hours=(),
        hours_raw=None, image_url=None, modified_at=None,
    )
    gated = gate_against_tourapi([tour], [cafe], keep_source=SOURCE)
    assert gated.passed == () and gated.merged == 1
