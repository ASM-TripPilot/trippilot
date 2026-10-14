"""Overture 주소 복원 — 약칭·시군구 접두·동 표·좌표 거부권.

이 모듈이 틀리면 **조용히 엉뚱한 여행에 POI 가 노출된다**(지역 코드는 주소 문자열이
유일한 근거다, TRIP-359). 그래서 "풀렸다"보다 **"틀리게 풀리지 않는다"**를 더 많이 건다.
"""

from __future__ import annotations

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.domain.common import GeoPoint
from trippilot.poi_curation.sourcing.overture_address import (  # noqa: I001
    SamePlaceIndex,
    SidoVeto,
    dong_table,
    expand_sido,
    resolve_address,
    sido_abbreviations,
)

# 카탈로그 축소판 — (code, name, sido_code, level, selectable).
# `중구` 를 **서울·부산 양쪽에** 둔다. 시군구 접두의 모호성이 여기서만 드러난다.
REGIONS = [
    ("11", "서울특별시", "11", "SIDO", False),
    ("11110", "종로구", "11", "SIGUNGU", True),
    ("11140", "중구", "11", "SIGUNGU", True),
    ("11545", "금천구", "11", "SIGUNGU", True),
    ("26", "부산광역시", "26", "SIDO", False),
    ("26110", "중구", "26", "SIGUNGU", True),
    ("26710", "기장군", "26", "SIGUNGU", True),
    ("50", "제주특별자치도", "50", "SIDO", False),
    ("50110", "제주시", "50", "SIGUNGU", True),
    ("50130", "서귀포시", "50", "SIGUNGU", True),
    ("48", "경상남도", "48", "SIDO", False),
    ("48125", "창원시 진해구", "48", "SIGUNGU", True),
    ("48250", "김해시", "48", "SIGUNGU", True),
]


def region_check(address: str, regions) -> str:
    """`collect_localdata.region_check` 와 같은 규칙 — 테스트는 스크립트를 import 하지 않는다."""
    tokens = address.split()
    if not tokens:
        return "unresolved"
    sido = next((c for c, n, _, lvl, _ in regions if lvl == "SIDO" and n == tokens[0]), None)
    if sido is None:
        return "unresolved"
    under = {n for _, n, sc, lvl, _ in regions if lvl == "SIGUNGU" and sc == sido}
    two = " ".join(tokens[1:3]) if len(tokens) >= 3 else None
    return "sigungu" if (two in under or (len(tokens) >= 2 and tokens[1] in under)) else "sido_only"


ABBREV = sido_abbreviations(REGIONS)


def resolve(address: str | None, dongs=None) -> str | None:
    return resolve_address(address, REGIONS, abbrev=ABBREV, dongs=dongs or {},
                           region_check=region_check)


# ── 1. 약칭 표는 카탈로그에서 유도한다 ──────────────────────────────────
def test_약칭은_카탈로그_이름에서_나온다() -> None:
    """세 꼴만 만든다 — 접미어 떼기 · 도 축약 · 축약+도. 다 실데이터에서 본 것이다."""
    assert ABBREV == {
        "서울": "서울특별시", "부산": "부산광역시",
        "제주": "제주특별자치도", "제주도": "제주특별자치도",      # `제주도 서귀포시 …`
        "경상남": "경상남도", "경남": "경상남도",                # `경남 김해시 …`
    }   # `경상남` + `도` = 정식 명칭이라 키에서 빠진다(자기를 또 확장하면 안 된다)


def test_없는_말은_안_만든다() -> None:
    """`…도` 꼴은 도에만 붙인다 — 전부 붙이면 `부산도`·`서울도` 가 생긴다."""
    assert "부산도" not in ABBREV
    assert "서울도" not in ABBREV


def test_약칭_표에_정식_명칭_자신은_안_들어간다() -> None:
    """`부산광역시` 가 키로 들어가면 확장이 자기를 또 확장한다."""
    assert not (set(ABBREV) & {n for _, n, _, lvl, _ in REGIONS if lvl == "SIDO"})


@pytest.mark.parametrize(
    "before,after",
    [
        # 실측 — Overture 가 실제로 주는 모양
        ("부산 중구 영주동 91-7", "부산광역시 중구 영주동 91-7"),
        ("제주 서귀포시 성산읍 섭지코지로 107", "제주특별자치도 서귀포시 성산읍 섭지코지로 107"),
        # 이미 정식이면 그대로
        ("서울특별시 금천구 벚꽃로 278", "서울특별시 금천구 벚꽃로 278"),
        # 약칭이 아닌 첫 토큰은 건드리지 않는다
        ("금천구 벚꽃로 278", "금천구 벚꽃로 278"),
        ("37-55 Yongdusan-gil", "37-55 Yongdusan-gil"),
        ("", ""),
    ],
)
def test_약칭_확장(before: str, after: str) -> None:
    assert expand_sido(before, ABBREV) == after


def test_약칭_확장은_뒤_토큰을_건드리지_않는다() -> None:
    """`부산` 이 뒤에 또 나와도 첫 토큰만 바꾼다 — 상호에 지명이 든다."""
    assert expand_sido("부산 중구 부산횟집앞", ABBREV) == "부산광역시 중구 부산횟집앞"


# ── 2. 복원 — 풀리는 것 ────────────────────────────────────────────────
@pytest.mark.parametrize(
    "address,expected",
    [
        ("서울특별시 금천구 벚꽃로 278", "서울특별시 금천구 벚꽃로 278"),
        ("부산 기장군 기장읍 기장해안로 147", "부산광역시 기장군 기장읍 기장해안로 147"),
        # 시군구 접두 — 그 이름을 가진 시도가 하나뿐일 때만
        ("금천구 벚꽃로 278", "서울특별시 금천구 벚꽃로 278"),
        ("기장군 기장읍 기장해안로 147", "부산광역시 기장군 기장읍 기장해안로 147"),
        # 두 토큰 시군구
        ("창원시 진해구 장천동 산1-2", "경상남도 창원시 진해구 장천동 산1-2"),
    ],
)
def test_복원되는_주소(address: str, expected: str) -> None:
    assert resolve(address) == expected


def test_동_표로_복원한다() -> None:
    dongs = {"벚꽃동": ("서울특별시", "금천구")}
    assert resolve("벚꽃동 278", dongs) == "서울특별시 금천구 벚꽃동 278"


# ── 3. 복원 — **틀리게 풀리지 않는 것**이 더 중요하다 ──────────────────
def test_같은_이름의_시군구가_여럿이면_포기한다() -> None:
    """`중구` 는 서울·부산 양쪽에 있다. 하나를 고르는 근거가 없으므로 안 고른다.

    고르면 그 POI 가 반대편 도시 여행에 조용히 끼어든다 — 안 넣는 것보다 나쁘다.
    """
    assert resolve("중구 영주동 91-7") is None


@pytest.mark.parametrize(
    "address",
    [
        None, "", "   ",
        "37-55 Yongdusan-gil",            # 로마자만 — 한글 음절 0
        "137 Oryukdo-ro",
        "2 Jungang-daero",
        "14",                              # 번지만
        "서울특별시",                        # 시도만 — 시군구가 없다
        "부산 어딘가",                       # 확장은 되지만 시군구가 없다
        "없는구 어딘가 1-2",
    ],
)
def test_못_푸는_주소는_None(address: str | None) -> None:
    assert resolve(address) is None


def test_동_표에_없는_동은_포기한다() -> None:
    assert resolve("모르는동 278", {"벚꽃동": ("서울특별시", "금천구")}) is None


@settings(max_examples=200, deadline=None)
@given(address=st.one_of(st.none(), st.text(max_size=40)))
def test_pbt_복원_결과는_None_이거나_시군구까지_풀린다(address: str | None) -> None:
    """치역 고정 — 반쯤 풀린 주소를 내보내면 백엔드가 시도 코드로 접어 전국에 노출된다."""
    got = resolve(address)
    assert got is None or region_check(got, REGIONS) == "sigungu"


@settings(max_examples=100, deadline=None)
@given(address=st.text(max_size=40))
def test_pbt_복원은_멱등이다(address: str) -> None:
    """한 번 풀린 주소를 다시 넣으면 같은 값이다 — 재병합이 주소를 흔들면 안 된다."""
    once = resolve(address)
    if once is not None:
        assert resolve(once) == once


# ── 4. 동 표 — 한 구에서만 쓰이는 동만 ─────────────────────────────────
def test_동_표는_쏠린_동만_담는다() -> None:
    addrs = ["서울특별시 금천구 벚꽃동 1"] * 20 + ["서울특별시 종로구 벚꽃동 2"]
    # 20/21 = 95.2% ≥ 95% — 들어간다
    assert dong_table(addrs, REGIONS) == {"벚꽃동": ("서울특별시", "금천구")}
    # 갈리면 빠진다
    half = ["서울특별시 금천구 갈린동 1"] * 10 + ["서울특별시 종로구 갈린동 2"] * 10
    assert dong_table(half, REGIONS) == {}


def test_동_표는_두_토큰_시군구를_잃지_않는다() -> None:
    """`창원시 진해구` 를 한 토큰으로 보면 `창원시` 가 카탈로그에 없어 표가 안 생긴다."""
    addrs = ["경상남도 창원시 진해구 장천동 1"] * 10
    assert dong_table(addrs, REGIONS) == {"장천동": ("경상남도", "창원시 진해구")}


def test_동_표는_안_풀리는_주소를_안_본다() -> None:
    assert dong_table(["없는시도 아무구 어떤동 1", "", "Yongdusan-gil"], REGIONS) == {}


def test_동_이름_뒤에_한글이_붙으면_동이_아니다() -> None:
    """`영주동길` 의 `영주동` 을 동으로 읽으면 엉뚱한 구가 붙는다."""
    assert dong_table(["서울특별시 금천구 영주동길 1"] * 10, REGIONS) == {}


# ── 5. 좌표 거부권 — 배정이 아니라 거부다 ──────────────────────────────
SEOUL = GeoPoint(37.5665, 126.9780)
BUSAN = GeoPoint(35.1796, 129.0756)


def test_좌표가_다른_시도면_거부한다() -> None:
    veto = SidoVeto([(SEOUL, "서울특별시"), (BUSAN, "부산광역시")])
    # 좌표는 부산인데 주소가 서울로 복원됐다 — 동 표가 깨진 주소에 걸린 모양
    assert veto.rejects("서울특별시 중구 어딘가", BUSAN.lat, BUSAN.lng)
    assert not veto.rejects("부산광역시 중구 어딘가", BUSAN.lat, BUSAN.lng)


def test_아는_POI_가_없으면_보류한다() -> None:
    """거부도 승인도 아니다 — 모르는 것을 근거로 버리지 않는다."""
    veto = SidoVeto([(SEOUL, "서울특별시")])
    assert veto.nearest_sido(33.4, 126.5) is None          # 제주 — 5km 안에 없다
    assert not veto.rejects("제주특별자치도 제주시 어딘가", 33.4, 126.5)


def test_거부권은_시도만_본다() -> None:
    """시군구는 보지 않는다 — 최근접은 경계에서 구를 틀린다(실측 87.8%)."""
    veto = SidoVeto([(SEOUL, "서울특별시")])
    near = GeoPoint(37.5666, 126.9781)   # 11m
    assert not veto.rejects("서울특별시 종로구 어딘가", near.lat, near.lng)
    assert not veto.rejects("서울특별시 중구 어딘가", near.lat, near.lng)


def test_빈_격자는_아무것도_거부하지_않는다() -> None:
    assert not SidoVeto([]).rejects("서울특별시 중구 어딘가", SEOUL.lat, SEOUL.lng)


# ── 6. 같은 곳 색인 — 게이트가 놓치는 쌍을 막는다 ──────────────────────
HWANGNYEONG = GeoPoint(35.1580544, 129.0826263)


def test_이름과_좌표가_같으면_카테고리가_달라도_같은_곳이다() -> None:
    """실측 — 공유본의 `황령산 봉수대`(NIGHT_VIEW)와 후보(SIGHT)가 좌표 0m 다.

    게이트 ㉠ 은 같은 카테고리만 병합하므로 재분류한 쪽과 짝이 안 맞아 통과했다.
    """
    index = SamePlaceIndex([("황령산 봉수대", HWANGNYEONG)])
    assert index.has("황령산 봉수대", HWANGNYEONG.lat, HWANGNYEONG.lng)


def test_29m_는_같은_곳이고_이름이_다르면_아니다() -> None:
    """실측 — `영주하늘눈전망대` TourAPI 와 Overture 가 29m 떨어져 있다."""
    tourapi = GeoPoint(35.1146102693, 129.0307259427)
    index = SamePlaceIndex([("영주하늘눈전망대", tourapi)])
    assert index.has("영주하늘눈전망대", 35.1147842, 129.0309601)
    assert not index.has("영주암", 35.1147842, 129.0309601)


def test_50m_를_넘으면_다른_곳으로_둔다() -> None:
    """같은 이름이 멀리 있으면 지점이 다를 수 있다 — 게이트 ㉠ 과 같은 반경을 쓴다."""
    index = SamePlaceIndex([("한라수목원", GeoPoint(33.4600, 126.4900))])
    assert not index.has("한라수목원", 33.4700, 126.4900)      # ~1.1km


def test_이름_앞뒤_공백은_같은_이름이다() -> None:
    index = SamePlaceIndex([(" 용두암 ", HWANGNYEONG)])
    assert index.has("용두암", HWANGNYEONG.lat, HWANGNYEONG.lng)


def test_빈_색인은_아무것도_같은_곳으로_보지_않는다() -> None:
    assert not SamePlaceIndex([]).has("용두암", 33.5, 126.5)


# ── 7. 하위 단위는 동뿐이 아니다 — 리·읍·면 (2026-10-14) ───────────────
# 동만 보면 군 지역 주소가 통째로 빠진다. 실측: 부산·제주 bbox 에서 "지역 못 붙임"
# 1,211 → 1,081 (−130), 게이트 후보 188 → 305.
def test_리_읍_면도_표의_키가_된다() -> None:
    addrs = ["제주특별자치도 서귀포시 남원읍 신례리 산 2-1"] * 10
    table = dong_table(addrs, REGIONS)
    assert table["신례리"] == ("제주특별자치도", "서귀포시")
    assert table["남원읍"] == ("제주특별자치도", "서귀포시")


def test_리로_복원한다() -> None:
    """실측 — `사라오름 전망대` 주소가 `남원읍 신례리 산 2-1` 로 시군구가 없다."""
    table = {"신례리": ("제주특별자치도", "서귀포시")}
    assert resolve("남원읍 신례리 산 2-1", table) == \
        "제주특별자치도 서귀포시 남원읍 신례리 산 2-1"


@pytest.mark.parametrize(
    "address",
    [
        # 뒤에 한글이 붙으면 단위가 아니다 — 느슨하면 상호가 지명이 된다
        "서울특별시 금천구 영주동길 1",
        "서울특별시 금천구 라면집 1",
        "서울특별시 금천구 면회실 1",
    ],
)
def test_하위_단위_뒤에_한글이_붙으면_키가_아니다(address: str) -> None:
    assert dong_table([address] * 10, REGIONS) == {}


def test_리_읍_면도_쏠림_기준을_따른다() -> None:
    """`신흥리` 처럼 전국에 여러 곳인 이름은 표에 안 넣는다 — 동과 같은 규칙이다."""
    split = (["제주특별자치도 제주시 어떤읍 신흥리 1"] * 10
             + ["제주특별자치도 서귀포시 다른읍 신흥리 2"] * 10)
    assert "신흥리" not in dong_table(split, REGIONS)


# ── 8. 지역이 두 번 적힌 주소를 만들지 않는다 (2026-10-14) ─────────────
# 실측 — 그냥 넣었으면 이 꼴로 공유본에 저장됐다:
#   용소웰빙공원   부산광역시 기장군 **대한민국 부산광역시 기장군** 기장읍 서부리 335
#   김해 롯데…     경상남도 김해시 **경남 김해시** 진례면 담안리 485-1
#   제주동백공방    제주특별자치도 서귀포시 **제주도 서귀포시** 성산읍 일출로269
@pytest.mark.parametrize(
    "address,expected",
    [
        # 나라 이름을 떼면 그대로 풀린다
        ("대한민국 부산광역시 기장군 기장읍 서부리 335",
         "부산광역시 기장군 기장읍 서부리 335"),
        # 도 축약을 펴면 그대로 풀린다
        ("경남 김해시 진례면 담안리 485-1", "경상남도 김해시 진례면 담안리 485-1"),
        # `제주도` 꼴도 같다
        ("제주도 서귀포시 성산읍 일출로269", "제주특별자치도 서귀포시 성산읍 일출로269"),
    ],
)
def test_머리를_정리하면_접두_경로에_가지_않는다(address: str, expected: str) -> None:
    got = resolve(address, {"담안리": ("경상남도", "김해시")})
    assert got == expected


@pytest.mark.parametrize(
    "address",
    [
        # 머리를 정리해도 지역명이 남아 있다 — 우리가 모르는 변종이므로 **포기한다**.
        # 접두를 붙이면 지역이 두 번 적힌 주소가 나온다.
        "기장군 대한민국 부산광역시 기장군 기장읍 서부리",
        "제주시 제주특별자치도 어딘가 1",
    ],
)
def test_지역명이_남아_있으면_접두를_붙이지_않는다(address: str) -> None:
    assert resolve(address) is None


@settings(max_examples=300, deadline=None)
@given(address=st.one_of(st.none(), st.text(max_size=50)))
def test_pbt_복원_결과에_시도_이름이_두_번_나오지_않는다(address: str | None) -> None:
    """치역 불변식 — 지역이 두 번 적힌 주소는 사람이 보기에도 틀렸고 뒤 파싱도 흔든다."""
    got = resolve(address)
    if got is None:
        return
    for name in {n for _, n, _, lvl, _ in REGIONS if lvl == "SIDO"}:
        assert got.count(name) <= 1, got


def test_나라_이름만_있는_주소는_None() -> None:
    assert resolve("대한민국") is None
    assert resolve("대한민국 ") is None
