"""U6-05 — TourApiAdapter 파싱 + 카테고리·영업시간 매핑 (TRIP-246). 실 호출 0."""

from __future__ import annotations

import pytest

from trippilot.poi_curation.sourcing.mapping import map_category, parse_open_hours
from trippilot.poi_curation.sourcing.tourapi import TourApiAdapter
from trippilot.domain.poi import OpenHour, PoiCategory
from trippilot.ports.poi_sourcing_port import SourcingError

from tests.fakes.fake_tourapi_http import (
    FakeTourApiHttp,
    envelope,
    error_envelope,
    intro_item,
    list_item,
)


def _adapter(http: FakeTourApiHttp) -> TourApiAdapter:
    return TourApiAdapter(http, "test-key")


# ── 어댑터: 목록 파싱 ─────────────────────────────────────────
def test_fetch_page_parses_records_and_coords() -> None:
    http = FakeTourApiHttp(pages={("12", 1): envelope(
        [list_item("100", "성산일출봉", mapx="126.9425", mapy="33.4620",
                   firstimage="http://img/100.jpg")], total_count=1)})
    page = _adapter(http).fetch_page("39", "12", 1, 100)
    assert page.total_count == 1
    (r,) = page.records
    assert r.source_ref == "100" and r.name == "성산일출봉"
    assert r.lat == pytest.approx(33.4620)   # mapy = 위도
    assert r.lng == pytest.approx(126.9425)  # mapx = 경도
    assert r.category_codes == ("A01", "A0101", "A01010400")
    assert r.image_url == "http://img/100.jpg"


def test_fetch_page_empty_items_string_variant() -> None:
    """빈 목록에서 items가 "" 로 오는 실 API 변주 — 방어적으로 빈 페이지."""
    http = FakeTourApiHttp(pages={("12", 1): envelope([], total_count=0)})
    page = _adapter(http).fetch_page("39", "12", 1, 100)
    assert page.records == () and page.total_count == 0


def test_fetch_page_error_code_raises_sourcing_error() -> None:
    http = FakeTourApiHttp(pages={("12", 1): error_envelope()})
    with pytest.raises(SourcingError):
        _adapter(http).fetch_page("39", "12", 1, 100)


def test_fetch_page_sends_common_params_once_per_call() -> None:
    http = FakeTourApiHttp(pages={("39", 2): envelope([], 0, page_no=2)})
    _adapter(http).fetch_page("39", "39", 2, 50)
    assert len(http.calls) == 1  # 메서드 1회 = HTTP 1건 (호출 예산 계약)
    _, params = http.calls[0]
    assert params["serviceKey"] == "test-key"
    assert params["MobileOS"] == "ETC" and params["MobileApp"] == "TripPilot"
    assert params["_type"] == "json"
    assert params["areaCode"] == "39" and params["contentTypeId"] == "39"
    assert params["numOfRows"] == "50" and params["pageNo"] == "2"


# ── 어댑터: 상세(영업시간) ────────────────────────────────────
def test_상시_개방은_24시간으로_읽는다() -> None:
    """"시각을 모른다"가 아니라 "항상 열려 있다" — 지어내기가 아니라 원문 그대로다.

    수집 8,043건 중 파싱 실패 3,475건의 절반(1,771건)이 이 한 문구였다.
    공원·해변·자연관광지가 대부분이라 NATURE 영업시간 보유율이 3%까지 떨어졌다.
    """
    hours = parse_open_hours("상시 개방", None)
    assert len(hours) == 7                                    # 요일 전부
    assert {(h.open_min, h.close_min) for h in hours} == {(0, 1440)}


def test_상시_개방은_해석_안되는_휴무_문구에_지지_않는다() -> None:
    """원문이 이미 휴무 없음을 말한다 — 명절 안내가 붙었다고 통째로 버리지 않는다."""
    assert len(parse_open_hours("상시 개방", "설날·추석 당일")) == 7


def test_상시_개방이라도_읽히는_휴무는_존중한다() -> None:
    assert len(parse_open_hours("상시개방", "매주 월요일")) == 6


@pytest.mark.parametrize("kind", ["12", "14", "39"])
def test_fetch_detail_reads_type_specific_fields(kind: str) -> None:
    http = FakeTourApiHttp(intros={
        "7": envelope([intro_item("7", kind, "10:00~18:00", "매주 월요일")], 1)})
    hours = _adapter(http).fetch_detail("7", kind)
    assert hours.hours_raw == "10:00~18:00"
    assert hours.rest_raw == "매주 월요일"


def test_fetch_detail_unknown_kind_returns_empty_without_call() -> None:
    """필드 매핑 없는 타입은 지어내지 않고 빈 원문 — HTTP 호출도 하지 않는다."""
    http = FakeTourApiHttp()
    hours = _adapter(http).fetch_detail("7", "25")
    assert hours.hours_raw is None and hours.rest_raw is None
    assert http.calls == []


# ── 상세 표시용 원문 (TRIP-683 2단계) — 같은 응답, HTTP 추가 0 ─────────

def test_fetch_detail_carries_whitelisted_display_fields_raw() -> None:
    """채택 목록의 필드만, 벤더 필드명 그대로, 비어 있으면 키 없음."""
    http = FakeTourApiHttp(intros={"7": envelope([intro_item(
        "7", "39", "11:00~21:00", "매주 월요일",
        firstmenu="고기국수", treatmenu="고기국수, 비빔국수", packing="",
        chkpet="불가")], 1)})
    d = _adapter(http).fetch_detail("7", "39")
    assert d.detail_raw == {"firstmenu": "고기국수", "treatmenu": "고기국수, 비빔국수"}
    assert len(http.calls) == 1


@pytest.mark.parametrize("kind", ["12", "14", "38", "39"])
def test_fetch_detail_never_carries_spendtime(kind: str) -> None:
    """소요시간은 채워져 와도 싣지 않는다 — INV-3(소요시간 미표시)의 수집 단 방어."""
    http = FakeTourApiHttp(intros={"7": envelope([intro_item(
        "7", kind, "09:00~18:00", "연중무휴",
        spendtime="약 2시간", spendtimeresting="1시간", usefee="무료", parking="가능")], 1)})
    d = _adapter(http).fetch_detail("7", kind)
    assert "spendtime" not in d.detail_raw and "spendtimeresting" not in d.detail_raw


def test_fetch_detail_kind_28_carries_nothing() -> None:
    """레포츠는 실측에서 상세가 비어 왔다 — 목록이 없으니 무엇이 와도 싣지 않는다."""
    http = FakeTourApiHttp(intros={"7": envelope([intro_item(
        "7", "28", "09:00~18:00", "", parkingleports="가능")], 1)})
    assert _adapter(http).fetch_detail("7", "28").detail_raw == {}


# ── 카테고리 매핑표 (8종 중 NIGHT_VIEW 제외 7종 도달 + 불가 드롭) ──
@pytest.mark.parametrize(
    ("kind", "cats", "expected"),
    [
        ("39", ("A05", "A0502", "A05020100"), PoiCategory.FOOD),
        ("39", ("A05", "A0502", "A05020900"), PoiCategory.CAFE),
        ("14", ("A02", "A0206", "A02060100"), PoiCategory.CULTURE),
        ("28", ("A03", "A0302", "A03021200"), PoiCategory.ACTIVITY),
        ("38", ("A04", "A0401", "A04010200"), PoiCategory.SHOPPING),
        ("12", ("A01", "A0101", "A01010400"), PoiCategory.NATURE),
        ("12", ("A02", "A0201", "A02010100"), PoiCategory.SIGHT),
        ("12", ("A02", "A0206", "A02060300"), PoiCategory.CULTURE),
        ("12", ("A02", "A0203", "A02030100"), PoiCategory.ACTIVITY),
        ("12", ("A03", "A0302", "A03021700"), PoiCategory.ACTIVITY),
        ("25", ("C01", "C0112", "C01120001"), None),  # 여행코스 — 매핑 불가
        ("32", ("B02", "B0201", "B02010100"), None),  # 숙박 — 경계 8종 밖(STAY는 내부 전용)
        ("12", (), None),                              # 분류 코드 부재
    ],
)
def test_category_mapping_table(kind, cats, expected) -> None:
    assert map_category(kind, cats) is expected


# ── 영업시간 파싱 — 파싱 가능한 것만, 지어내기 금지 ──────────────
def test_parse_open_hours_full_week() -> None:
    hours = parse_open_hours("10:00~22:00", "연중무휴")
    assert hours == tuple(OpenHour(d, 600, 1320) for d in range(7))


def test_parse_open_hours_weekly_rest_day_excluded() -> None:
    hours = parse_open_hours("09:30~18:00", "매주 월요일 휴무")
    assert {h.day_of_week for h in hours} == {1, 2, 3, 4, 5, 6}
    assert all(h.open_min == 570 and h.close_min == 1080 for h in hours)


def test_parse_open_hours_past_midnight() -> None:
    hours = parse_open_hours("18:00~02:00", None)
    assert hours[0].open_min == 1080 and hours[0].close_min == 26 * 60


@pytest.mark.parametrize(
    ("hours_raw", "rest_raw"),
    [
        (None, None),                                  # 정보 없음
        ("", ""),
        ("[3~10월] 09:00~19:00 [11~2월] 09:00~18:00", ""),  # 계절별 — 확정 불가
        ("09:00~18:00", "매월 첫째 월요일"),             # 주차 가변 휴무 — 표현 불가
        ("09:00~18:00", "설날·추석 당일"),               # 명절 — 표현 불가
        ("09:00~18:00", "동절기 휴장"),                  # 요일 아님 — 확신 없음
    ],
)
def test_parse_open_hours_unparseable_is_empty_not_fabricated(hours_raw, rest_raw) -> None:
    assert parse_open_hours(hours_raw, rest_raw) == ()


# ── 시각 3회 이상 — 종전엔 통째로 포기하던 것 (2026-09-26) ──────────────
# 실측: 공유본 결측 13,367건 중 4,764건이 원문에 시각을 갖고 있었다.
# 아래는 전부 **실 수집분에서 뽑은 원문**이다 — 지어낸 입력이 아니다.

@pytest.mark.parametrize("raw,want", [
    # 부가 안내가 뒤에 붙는 가장 흔한 모양 — 첫 범위가 답이다
    ("09:00~17:50 (입장 마감 17:00)", (9 * 60, 17 * 60 + 50)),
    ("- 09:00~17:00<br>- 휴게시간 12:00~13:00<br>- 입장 마감 16:30", (9 * 60, 17 * 60)),
    ("11:00~17:00 (마지막 주문 16:00)", (11 * 60, 17 * 60)),
    # 요일별 — 첫 범위(평일)를 쓴다
    ("- 평일 12:00~20:00<br>- 주말 12:00~21:00", (12 * 60, 20 * 60)),
    # 계절별 — 같은 개점의 **이른 폐점**을 쓴다 (넓게 잡으면 닫힌 시간에 배치된다)
    ("- 하절기 08:40~18:00<br>- 동절기 08:40~17:30", (8 * 60 + 40, 17 * 60 + 30)),
])
def test_시각_3회_이상도_읽는다(raw: str, want: tuple[int, int]) -> None:
    hours = parse_open_hours(raw, None)
    assert hours, f"못 읽음: {raw!r}"
    assert (hours[0].open_min, hours[0].close_min) == want


def test_준비시간을_영업시간으로_읽지_않는다() -> None:
    """**실데이터 라벨 1위가 `준비시간`(1,100건)이다.** 감으로 만든 목록에서 빠져
    `10:00~18:00 (준비시간 12:00~13:00)` 이 12~13시로 읽혔다."""
    hours = parse_open_hours("10:00~18:00 (준비시간 12:00~13:00)", None)
    assert (hours[0].open_min, hours[0].close_min) == (10 * 60, 18 * 60)
    # 띄어쓰기 변형도 같아야 한다 — 실물에 둘 다 있다
    hours = parse_open_hours("11:30~23:00 (준비 시간 15:00~17:00)", None)
    assert (hours[0].open_min, hours[0].close_min) == (11 * 60 + 30, 23 * 60)


@pytest.mark.parametrize("raw", [
    # 구역이 여럿 — 어느 것이 장소 전체인지 모른다
    "[사우나] 06:00~21:00<br>[아쿠아나]<br>- 실내 10:00~18:00<br>- 야외 12:00~17:00",
    # 회차 — 영업시간이 아니라 출발 시각이다
    "- 1회 10:00~11:30<br>- 2회 13:00~14:30<br>- 3회 14:30~16:00",
    # 교육 세션 — 창이 너무 좁으면 영업시간이 아니다
    "[교육시간]<br>- 평일 10:00~12:00 / 14:00~16:00",
])
def test_확신할_수_없으면_지어내지_않는다(raw: str) -> None:
    assert parse_open_hours(raw, None) == ()


def test_무관한_시설과_겹쳐_좁아지지_않는다() -> None:
    """교집합 규칙이 실패하던 실물 — 야시장(18~22시)과 겹쳐 18~19시로 좁아졌다.

    두 규칙을 실데이터 4,764건으로 비교해 첫 범위를 골랐다(의심 120건 → 4건).
    """
    raw = "09:00~19:00(입장 마감 18:00)<br>※ 수목원야시장, LED공원 18:00~22:00"
    hours = parse_open_hours(raw, None)
    assert (hours[0].open_min, hours[0].close_min) == (9 * 60, 19 * 60)
