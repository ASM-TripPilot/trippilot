"""특일 달력 — 공공데이터포털 특일정보 `getRestDeInfo` 어댑터 + 모드 출처 (상황 감지 H1). 실 HTTP 0건.

픽스처 두 벌은 **실응답 그대로**다(`tests/fixtures/holiday_calendar/`, 2026-10-19 실호출 — 개천절·대체공휴일·
한글날 / 설날 3일 + 대체공휴일(설날)). 키 오류 XML 은 포털 게이트웨이 오류 봉투의 문서 모양이다.

증명하는 것:
  ① 실표본 두 벌 → 태그: isHoliday Y = PUBLIC, `설날` 연속 3일 = 전날·당일·다음날, 대체공휴일 = PUBLIC 만.
  ② 연속 판정은 달 경계를 넘는다 — 앞뒤 2일을 덮는 달을 모두 읽는다(2022 설날 1/31~2/2).
  ③ 봉투 변주 — 1건이면 item 이 객체, 0건이면 items 가 빈 문자열. 성공은 resultCode "00" 표식 + 아는 봉투로만
     (items 키 없음·null·빈 목록·totalCount 와 행 수 불일치는 실패).
  ④ 실패(XML 30 본문·HTTP 401·비정상 코드·형식 깨짐) → None + WARN 은 상태가 바뀔 때 1번, 키는 어디에도 안 남는다.
  ⑤ 성공한 달만 캐시 — 24시간 TTL(임시공휴일 지정 반영), 실패는 다음 호출이 다시 묻는다.
  ⑥ 모드 출처 `HolidaySource` — off 면 None·조회 0회, on 이면 달력(없거나 실패면 빈 매핑 = 날짜 명시형만). 못 읽은
     빈 매핑은 `UNREAD_CALENDAR` 하나라 성공한 빈 달력과 갈린다 — 검증이 태그형 규칙을 못 본 곳을 미판정으로 싣는다.
"""

from __future__ import annotations

import json
import logging
import urllib.error
from datetime import date
from pathlib import Path

import pytest

from trippilot.domain.poi import UNREAD_CALENDAR
from trippilot.poi_curation.adapters.kasi_holiday_calendar import KasiHolidayCalendarAdapter
from trippilot.ports.holiday_calendar_port import HolidaySource

_FIX = Path(__file__).resolve().parents[1] / "fixtures" / "holiday_calendar"
_KEY = "SECRET-KEY-123+/="
_XML_30 = """<OpenAPI_ServiceResponse>
\t<cmmMsgHeader>
\t\t<errMsg>SERVICE ERROR</errMsg>
\t\t<returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg>
\t\t<returnReasonCode>30</returnReasonCode>
\t</cmmMsgHeader>
</OpenAPI_ServiceResponse>"""


def _envelope(items: object, code: str = "00", total: int | None = None) -> str:
    """실물 봉투 — totalCount 는 행 수다(0건 `""`, 1건 객체, n건 목록). `total` 로 어긋난 봉투를 만든다."""
    if total is None:
        rows = items.get("item") if isinstance(items, dict) else None
        total = len(rows) if isinstance(rows, list) else 1 if isinstance(rows, dict) else 0
    return json.dumps({"response": {"header": {"resultCode": code, "resultMsg": "NORMAL SERVICE."},
                                    "body": {"items": items, "numOfRows": 50, "pageNo": 1, "totalCount": total}}},
                      ensure_ascii=False)


def _item(locdate: int, name: str, holiday: str = "Y") -> dict:
    return {"dateKind": "01", "dateName": name, "isHoliday": holiday, "locdate": locdate, "seq": 1}


class _FakeHttp:
    """(연, 월) → 응답 본문(또는 예외). 없는 달은 0건 응답. 실물처럼 **본문 문자열**을 준다."""

    def __init__(self, months: dict[tuple[int, int], object] | None = None) -> None:
        self.months = months or {}
        self.calls: list[tuple[str, dict]] = []

    def get_text(self, url: str, params: dict) -> str:
        self.calls.append((url, dict(params)))
        got = self.months.get((int(params["solYear"]), int(params["solMonth"])), _envelope(""))
        if isinstance(got, Exception):
            raise got
        return got


class _Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def _adapter(http: _FakeHttp, clock: _Clock | None = None) -> KasiHolidayCalendarAdapter:
    return KasiHolidayCalendarAdapter(http, _KEY, monotonic=clock or _Clock())


# ── ① 실표본 ─────────────────────────────────────────────────────────


def test_2026년_10월_실표본은_공휴일_셋이다() -> None:
    http = _FakeHttp({(2026, 10): (_FIX / "spcde_rest_2026_10.json").read_text(encoding="utf-8")})
    got = _adapter(http).holidays_between(date(2026, 10, 1), date(2026, 10, 31))
    assert got == {date(2026, 10, 3): {"PUBLIC"}, date(2026, 10, 5): {"PUBLIC"},
                   date(2026, 10, 9): {"PUBLIC"}}
    assert sorted((p["solYear"], p["solMonth"]) for _, p in http.calls) == [
        ("2026", "09"), ("2026", "10"), ("2026", "11")]  # 앞뒤 2일을 덮는 달
    _, params = http.calls[0]
    assert params["_type"] == "json" and params["numOfRows"] == "50" and params["serviceKey"] == _KEY
    assert http.calls[0][0] == "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo"


def test_2027년_설날_실표본은_연속_3일에_전날_당일_다음날이_붙는다() -> None:
    http = _FakeHttp({(2027, 2): (_FIX / "spcde_rest_2027_02.json").read_text(encoding="utf-8")})
    got = _adapter(http).holidays_between(date(2027, 2, 6), date(2027, 2, 9))
    assert got == {
        date(2027, 2, 6): {"PUBLIC", "SEOLLAL_EVE"},
        date(2027, 2, 7): {"PUBLIC", "SEOLLAL_DAY"},
        date(2027, 2, 8): {"PUBLIC", "SEOLLAL_NEXT"},
        date(2027, 2, 9): {"PUBLIC"},  # 대체공휴일(설날) — 명절 태그가 아니다
    }


def test_추석과_부처님오신날() -> None:
    http = _FakeHttp({
        (2026, 9): _envelope({"item": [_item(20260924, "추석"), _item(20260925, "추석"),
                                       _item(20260926, "추석")]}),
        (2026, 5): _envelope({"item": [_item(20260505, "어린이날"), _item(20260524, "부처님오신날"),
                                       _item(20260525, "대체공휴일(부처님오신날)")]}),
    })
    cal = _adapter(http)
    assert cal.holidays_between(date(2026, 9, 24), date(2026, 9, 26)) == {
        date(2026, 9, 24): {"PUBLIC", "CHUSEOK_EVE"}, date(2026, 9, 25): {"PUBLIC", "CHUSEOK_DAY"},
        date(2026, 9, 26): {"PUBLIC", "CHUSEOK_NEXT"}}
    assert cal.holidays_between(date(2026, 5, 5), date(2026, 5, 25)) == {
        date(2026, 5, 5): {"PUBLIC"}, date(2026, 5, 24): {"PUBLIC", "BUDDHA"}, date(2026, 5, 25): {"PUBLIC"}}


def test_범위_밖_날짜는_싣지_않는다() -> None:
    http = _FakeHttp({(2026, 10): (_FIX / "spcde_rest_2026_10.json").read_text(encoding="utf-8")})
    assert _adapter(http).holidays_between(date(2026, 10, 4), date(2026, 10, 8)) == {date(2026, 10, 5): {"PUBLIC"}}


# ── ② 달 경계 ────────────────────────────────────────────────────────


def test_설날_연속이_달을_넘어도_자리가_맞다() -> None:
    """2022 설날 = 1/31·2/1·2/2. 2월만 읽으면 2/1 이 '첫날'(전날)로 잘못 붙는다."""
    http = _FakeHttp({(2022, 1): _envelope({"item": _item(20220131, "설날")}),
                      (2022, 2): _envelope({"item": [_item(20220201, "설날"), _item(20220202, "설날")]})})
    got = _adapter(http).holidays_between(date(2022, 2, 1), date(2022, 2, 2))
    assert got == {date(2022, 2, 1): {"PUBLIC", "SEOLLAL_DAY"}, date(2022, 2, 2): {"PUBLIC", "SEOLLAL_NEXT"}}
    assert ("2022", "01") in {(p["solYear"], p["solMonth"]) for _, p in http.calls}


def test_연속이_세_날이_아니면_명절_자리를_붙이지_않는다() -> None:
    """자리를 지어내지 않는다 — 공휴일인 것만 확실하다."""
    http = _FakeHttp({(2030, 2): _envelope({"item": [_item(20300202, "설날"), _item(20300203, "설날")]})})
    got = _adapter(http).holidays_between(date(2030, 2, 2), date(2030, 2, 3))
    assert got == {date(2030, 2, 2): {"PUBLIC"}, date(2030, 2, 3): {"PUBLIC"}}


# ── ③ 봉투 변주 ──────────────────────────────────────────────────────


def test_1건이면_item_이_객체다() -> None:
    http = _FakeHttp({(2026, 8): _envelope({"item": _item(20260815, "광복절")})})
    assert _adapter(http).holidays_between(date(2026, 8, 10), date(2026, 8, 20)) == {date(2026, 8, 15): {"PUBLIC"}}


def test_0건이면_빈_매핑이고_성공이다() -> None:
    http = _FakeHttp()  # 전부 items == ""
    assert _adapter(http).holidays_between(date(2026, 6, 10), date(2026, 6, 20)) == {}


def test_공휴일_아닌_특일은_싣지_않는다() -> None:
    http = _FakeHttp({(2026, 7): _envelope({"item": _item(20260717, "제헌절", holiday="N")})})
    assert _adapter(http).holidays_between(date(2026, 7, 10), date(2026, 7, 20)) == {}


# ── ④ 실패 ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("bad", [
    _XML_30,                                              # 키 미등록 — _type=json 이어도 XML 로 온다
    _envelope("", code="22"),                             # 한도 초과 등 비정상 코드
    "{}",                                                 # 빈 응답은 성공이 아니다
    json.dumps({"response": {"header": {"resultCode": "00"}}}),          # 본문 없음
    # 성공 코드여도 모르는 봉투는 '공휴일 0건'이 아니다 — 0건 성공으로 받으면 그 달 휴무가 24시간 지워진다(리뷰 재현)
    json.dumps({"response": {"header": {"resultCode": "00"}, "body": {}}}),  # items 키 없음
    _envelope(None),                                      # items null
    _envelope({"item": []}),                              # 빈 목록 — 실물 0건은 items == ""
    _envelope("", total=3),                               # 0건 봉투인데 totalCount 3
    _envelope({"item": [_item(20270206, "설날"), _item(20270207, "설날")]}, total=3),  # 행이 모자란다
    _envelope({"item": [{"dateName": "설날", "isHoliday": "Y", "locdate": "2027-02-07"}]}),  # 날짜 형식 깨짐
    urllib.error.HTTPError("https://apis.data.go.kr/x", 401, "Unauthorized", {}, None),
    TimeoutError("timed out"),
])
def test_실패는_None_이고_키를_남기지_않는다(bad, caplog) -> None:
    http = _FakeHttp({(2026, 10): bad})
    with caplog.at_level(logging.INFO):
        assert _adapter(http).holidays_between(date(2026, 10, 1), date(2026, 10, 31)) is None
    warns = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warns) == 1
    assert _KEY not in caplog.text and "SECRET" not in caplog.text


def test_XML_오류는_원인_코드를_남긴다(caplog) -> None:
    http = _FakeHttp({(2026, 10): _XML_30})
    with caplog.at_level(logging.WARNING):
        _adapter(http).holidays_between(date(2026, 10, 1), date(2026, 10, 31))
    assert "30" in caplog.text and "SERVICE_KEY_IS_NOT_REGISTERED_ERROR" in caplog.text
    # 배포 smoke `ai-wiring:` 표식(`deploy/eks/runtime_smoke._WIRING_MARKERS` 의 `공휴일 휴무`)에 걸린다 —
    # 키가 30 이면 기동 줄만으론 '켜졌다'로 보인다(기상청 실패 WARN 이 `기상청 단기예보` 를 싣는 것과 같다)
    assert "공휴일 휴무" in caplog.text


def test_WARN_은_상태가_바뀔_때_한_번(caplog) -> None:
    http = _FakeHttp({(2026, 10): _XML_30})
    cal = _adapter(http)
    with caplog.at_level(logging.INFO):
        for _ in range(3):
            assert cal.holidays_between(date(2026, 10, 1), date(2026, 10, 31)) is None
        assert sum(r.levelno == logging.WARNING for r in caplog.records) == 1
        http.months[(2026, 10)] = (_FIX / "spcde_rest_2026_10.json").read_text(encoding="utf-8")
        assert cal.holidays_between(date(2026, 10, 1), date(2026, 10, 31)) is not None  # 회복
        http.months[(2026, 12)] = _XML_30  # 아직 안 물은 달 — 9·11월은 위에서 성공으로 기억됐다
        assert cal.holidays_between(date(2026, 12, 10), date(2026, 12, 20)) is None
    assert sum(r.levelno == logging.WARNING for r in caplog.records) == 2  # 회복 뒤 다시 실패 = 새 상태


def test_한_달이라도_실패하면_전체가_실패다() -> None:
    """일부 달만 아는 매핑은 '그 날은 공휴일 아님'으로 읽힌다 — 모르는 것을 정상으로 만들지 않는다."""
    http = _FakeHttp({(2026, 9): _XML_30,
                      (2026, 10): (_FIX / "spcde_rest_2026_10.json").read_text(encoding="utf-8")})
    assert _adapter(http).holidays_between(date(2026, 10, 1), date(2026, 10, 9)) is None


# ── ⑤ 캐시 ───────────────────────────────────────────────────────────


def test_성공한_달만_24시간_기억한다() -> None:
    http = _FakeHttp({(2026, 10): (_FIX / "spcde_rest_2026_10.json").read_text(encoding="utf-8")})
    clock = _Clock()
    cal = _adapter(http, clock)
    first = cal.holidays_between(date(2026, 10, 3), date(2026, 10, 28))  # 앞뒤 2일(10/1~10/30)이 10월 안
    calls = len(http.calls)
    assert calls == 1
    assert cal.holidays_between(date(2026, 10, 3), date(2026, 10, 28)) == first
    assert len(http.calls) == calls  # 다시 안 묻는다
    clock.now += 24 * 3600 + 1
    cal.holidays_between(date(2026, 10, 3), date(2026, 10, 28))
    assert len(http.calls) == 2 * calls  # TTL 이 지나면 다시 — 임시공휴일 지정이 뒤에 들어온다


def test_실패한_달은_기억하지_않는다() -> None:
    http = _FakeHttp({(2026, 10): _XML_30})
    cal = _adapter(http)
    assert cal.holidays_between(date(2026, 10, 10), date(2026, 10, 20)) is None
    http.months[(2026, 10)] = (_FIX / "spcde_rest_2026_10.json").read_text(encoding="utf-8")
    assert cal.holidays_between(date(2026, 10, 10), date(2026, 10, 20)) == {}  # 다음 호출이 다시 물었다
    assert cal.holidays_between(date(2026, 10, 1), date(2026, 10, 31)) == {
        date(2026, 10, 3): {"PUBLIC"}, date(2026, 10, 5): {"PUBLIC"}, date(2026, 10, 9): {"PUBLIC"}}


# ── ⑥ 모드 출처 ──────────────────────────────────────────────────────


class _SpyCalendar:
    def __init__(self, result) -> None:
        self.result = result
        self.calls = 0

    def holidays_between(self, start: date, end: date):
        self.calls += 1
        return self.result


def test_모드_off_면_None_이고_달력을_부르지_않는다() -> None:
    spy = _SpyCalendar({date(2026, 10, 9): frozenset({"PUBLIC"})})
    assert HolidaySource(enabled=False, calendar=spy).between(date(2026, 10, 9), date(2026, 10, 9)) is None
    assert HolidaySource().between(date(2026, 10, 9), date(2026, 10, 9)) is None
    assert spy.calls == 0


def test_모드_on_이면_달력이고_없거나_실패면_빈_매핑이다() -> None:
    cal = {date(2026, 10, 9): frozenset({"PUBLIC"})}
    assert HolidaySource(enabled=True, calendar=_SpyCalendar(cal)).between(
        date(2026, 10, 9), date(2026, 10, 9)) == cal
    assert HolidaySource(enabled=True, calendar=_SpyCalendar(None)).between(
        date(2026, 10, 9), date(2026, 10, 9)) == {}
    assert HolidaySource(enabled=True, calendar=None).between(date(2026, 10, 9), date(2026, 10, 9)) == {}
    # 못 읽은 것(실패·키 미등록)은 `UNREAD_CALENDAR` 하나다 — 성공한 빈 달력(그 범위에 공휴일 없음)은 아니다(G-SA-22)
    assert HolidaySource(enabled=True, calendar=_SpyCalendar(None)).between(
        date(2026, 10, 9), date(2026, 10, 9)) is UNREAD_CALENDAR
    assert HolidaySource(enabled=True, calendar=None).between(
        date(2026, 10, 9), date(2026, 10, 9)) is UNREAD_CALENDAR
    assert HolidaySource(enabled=True, calendar=_SpyCalendar({})).between(
        date(2026, 10, 9), date(2026, 10, 9)) is not UNREAD_CALENDAR
