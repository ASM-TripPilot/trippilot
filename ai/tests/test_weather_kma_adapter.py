"""TRIP-383 — KmaWeatherAdapter (기상청 단기예보 getVilageFcst). 실 HTTP 호출 0건.

증명하는 것:
  ① 격자 변환 결정론: 알려진 좌표 → (nx, ny) 검증값 (기상청 활용가이드 예시 포함)
  ② base_date/base_time 선택 결정론: 발표시각 8회 + 제공 지연 10분 규칙
  ③ POP 파싱: 날짜별 최댓값 집계·요청 날짜 한정·비정수/범위 밖 값 스킵
  ④ 응답 변주·실패: items 빈 문자열, 비정상 resultCode, HTTP 예외 → WeatherError
  ⑤ 호출 예산: daily_forecast 1회 = HTTP 정확히 1건, 빈 날짜 요청은 0건

실 응답과의 드리프트는 실키 실행에서 검증한다 (여기서는 문서 기준 fake 픽스처만).
"""

from __future__ import annotations

import logging
import urllib.error
from datetime import date, datetime, timedelta, timezone

import pytest

from trippilot.poi_curation.adapters import kma_weather

from trippilot.poi_curation.adapters.kma_weather import (
    KmaWeatherAdapter,
    base_datetime_for,
    latlon_to_grid,
)
from trippilot.ports.weather_port import WeatherError
from trippilot.domain.common import GeoPoint

_KST = timezone(timedelta(hours=9))
_COORD = GeoPoint(33.4362, 126.5255)  # 제주 데모 앵커 (wiring.DEMO_ANCHOR와 동일값)
_NOW = datetime(2026, 8, 5, 8, 0, tzinfo=_KST)
_D1, _D2 = date(2026, 8, 5), date(2026, 8, 6)


class _FakeHttp:
    """호출 기록 + 준비 응답(또는 예외) 회신. 실 HTTP 0건."""

    def __init__(self, body: object = None, error: Exception | None = None) -> None:
        self._body = body
        self._error = error
        self.calls: list[tuple[str, dict]] = []

    def get_json(self, url: str, params: dict) -> object:
        self.calls.append((url, dict(params)))
        if self._error is not None:
            raise self._error
        return self._body


def _body(items: object) -> dict:
    return {
        "response": {
            "header": {"resultCode": "00", "resultMsg": "NORMAL_SERVICE"},
            "body": {"items": items, "numOfRows": 1500, "pageNo": 1,
                     "totalCount": 3},
        }
    }


def _item(fcst_date: str, category: str, value: str) -> dict:
    return {"baseDate": "20260805", "baseTime": "0500", "category": category,
            "fcstDate": fcst_date, "fcstTime": "1200", "fcstValue": value,
            "nx": 53, "ny": 37}


def _adapter(http: _FakeHttp, now: datetime = _NOW) -> KmaWeatherAdapter:
    return KmaWeatherAdapter(http, "test-key+/=", now_fn=lambda: now)


# ── ① 격자 변환 — 알려진 검증값 (기상청 LCC 공식) ─────────────────────


def test_grid_known_values() -> None:
    # 서울 종로 — 활용가이드 예시 좌표 (60, 127)
    assert latlon_to_grid(37.579871128849334, 126.98935225645432) == (60, 127)
    # 부산 (98, 76) · 인천 (55, 124) — 기상청 격자 지점표 값
    assert latlon_to_grid(35.1796, 129.0756) == (98, 76)
    assert latlon_to_grid(37.4563, 126.7052) == (55, 124)


def test_grid_deterministic_and_int() -> None:
    a = latlon_to_grid(_COORD.lat, _COORD.lng)
    b = latlon_to_grid(_COORD.lat, _COORD.lng)
    assert a == b
    assert all(isinstance(v, int) for v in a)


# ── ② base_date/base_time 선택 결정론 ────────────────────────────────


def test_base_time_picks_latest_available_announcement() -> None:
    # 08:00 조회: 제공 지연 10분을 빼면 07:50 → 마지막 발표는 05:00
    assert base_datetime_for(_NOW) == ("20260805", "0500")
    # 11:20 조회: 11:10 → 11:00 발표분 이용 가능
    assert base_datetime_for(
        datetime(2026, 8, 5, 11, 20, tzinfo=_KST)) == ("20260805", "1100")
    # 11:05 조회: 10:55 → 아직 11:00 미제공, 08:00 발표분
    assert base_datetime_for(
        datetime(2026, 8, 5, 11, 5, tzinfo=_KST)) == ("20260805", "0800")


def test_base_time_before_first_announcement_uses_previous_day_2300() -> None:
    assert base_datetime_for(
        datetime(2026, 8, 5, 0, 30, tzinfo=_KST)) == ("20260804", "2300")
    assert base_datetime_for(
        datetime(2026, 8, 5, 2, 5, tzinfo=_KST)) == ("20260804", "2300")


# ── ③ POP 파싱 ───────────────────────────────────────────────────────


def test_pop_day_max_aggregation_and_requested_days_only() -> None:
    http = _FakeHttp(_body({"item": [
        _item("20260805", "POP", "30"),
        _item("20260805", "POP", "80"),   # 같은 날짜 — 최댓값 채택
        _item("20260805", "TMP", "27"),   # POP 아님 — 무시
        _item("20260806", "POP", "20"),
        _item("20260807", "POP", "90"),   # 요청 날짜 밖 — 버림
    ]}))
    result = _adapter(http).daily_forecast(_COORD, (_D1, _D2))
    assert result == {_D1: 80, _D2: 20}


def test_pop_non_integer_and_out_of_range_values_skipped() -> None:
    http = _FakeHttp(_body({"item": [
        _item("20260805", "POP", "강수없음"),  # 비정수 표기 — 스킵
        _item("20260805", "POP", "120"),       # 범위 밖 — 스킵
        _item("20260806", "POP", "60"),
    ]}))
    result = _adapter(http).daily_forecast(_COORD, (_D1, _D2))
    assert result == {_D2: 60}  # D1은 유효값 0건 — 키 자체가 없다 (0% 지어내기 금지)


def test_single_item_object_variant_parsed() -> None:
    # item이 리스트가 아니라 단일 객체로 오는 변주
    http = _FakeHttp(_body({"item": _item("20260805", "POP", "70")}))
    assert _adapter(http).daily_forecast(_COORD, (_D1,)) == {_D1: 70}


def test_request_params_carry_grid_base_and_key() -> None:
    http = _FakeHttp(_body({"item": []}))
    _adapter(http).daily_forecast(_COORD, (_D1,))
    url, params = http.calls[0]
    # 공공데이터포털 엔드포인트·serviceKey (팀 결정 2026-10-02 — 백엔드와 같은 포털 키 하나).
    assert url == ("https://apis.data.go.kr/1360000/"
                   "VilageFcstInfoService_2.0/getVilageFcst")
    assert params["serviceKey"] == "test-key+/="
    assert "authKey" not in params
    assert (int(params["nx"]), int(params["ny"])) \
        == latlon_to_grid(_COORD.lat, _COORD.lng)
    assert params["base_date"] == "20260805" and params["base_time"] == "0500"
    assert params["dataType"] == "JSON"


# ── ④ 응답 변주·실패 → WeatherError (침묵 금지) ──────────────────────


def test_empty_items_string_variant_returns_empty_mapping() -> None:
    http = _FakeHttp(_body(""))  # 빈 목록 변주: items == "" (tourapi와 동일)
    assert _adapter(http).daily_forecast(_COORD, (_D1,)) == {}


def test_bad_result_code_raises_weather_error() -> None:
    http = _FakeHttp({"response": {"header": {
        "resultCode": "30", "resultMsg": "SERVICE_KEY_IS_NOT_REGISTERED_ERROR"}}})
    with pytest.raises(WeatherError):
        _adapter(http).daily_forecast(_COORD, (_D1,))


def test_http_failure_wrapped_as_weather_error() -> None:
    http = _FakeHttp(error=TimeoutError("connect timeout"))
    with pytest.raises(WeatherError):
        _adapter(http).daily_forecast(_COORD, (_D1,))


def test_non_object_body_raises_weather_error() -> None:
    http = _FakeHttp(body="<html>error</html>")
    with pytest.raises(WeatherError):
        _adapter(http).daily_forecast(_COORD, (_D1,))


# ── ⑤ 호출 예산 — 1회 = HTTP 1건 ─────────────────────────────────────


def test_one_call_per_forecast_and_zero_for_empty_days() -> None:
    http = _FakeHttp(_body({"item": []}))
    adapter = _adapter(http)
    adapter.daily_forecast(_COORD, (_D1, _D2))
    assert len(http.calls) == 1
    assert adapter.daily_forecast(_COORD, ()) == {}
    assert len(http.calls) == 1  # 빈 요청은 호출 없음


def test_key_param_follows_the_host() -> None:
    """키 파라미터 이름은 **주소에서** 따라온다 — 이 둘은 항상 같이 간다.

    틀리면 403(포털) 또는 401(허브)이고, 둘 다 조용히 날씨만 꺼진다.
    """
    from trippilot.poi_curation.adapters.kma_weather import key_param_for

    assert key_param_for("https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0") == "serviceKey"
    assert key_param_for("https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0") == "authKey"


def test_default_is_the_portal_whatever_the_key_looks_like() -> None:
    """**키 모양으로 주소를 맞히지 않는다.** 한 번 그렇게 했다가 틀렸다.

    포털 키가 base64 라 `+ / =` 를 담는다고 보고 "특수문자 없으면 허브"로 갈랐는데,
    2026-10-05 에 **64자 영숫자 포털 키**가 들어와 허브로 가서 401 이 났다(실측).
    키 형식은 발급처가 바꿀 수 있는 것이라 판별 근거가 못 된다.
    """
    for key in ("AbC+dEf/123=", "a" * 64, "dfJ3o3pTRqiyd6N6Uyao5A"):
        http = _FakeHttp(_body({"item": []}))
        KmaWeatherAdapter(http, key).daily_forecast(_COORD, (_D1,))
        url, params = http.calls[0]
        assert "apis.data.go.kr" in url, f"{key[:4]}…: 기본은 포털이어야 한다"
        assert params["serviceKey"] == key
        assert "authKey" not in params


def test_explicit_hub_base_switches_both_host_and_param() -> None:
    """허브로 보내려면 주소를 **명시**한다 — 그러면 파라미터도 함께 바뀐다.

    주소만 바꾸고 파라미터를 안 바꾸는 조합이 두 번의 사고였다 — 만들 수 없게 한다.
    """
    http = _FakeHttp(_body({"item": []}))
    hub = "https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0"
    KmaWeatherAdapter(http, "huBkey1234567890abcdef", base_url=hub).daily_forecast(_COORD, (_D1,))
    url, params = http.calls[0]
    assert url.startswith(hub)
    assert params["authKey"] == "huBkey1234567890abcdef"
    assert "serviceKey" not in params


def test_daily_and_hourly_together_stay_one_call() -> None:
    """`WeatherProvider.fetch` 가 부르는 방식 그대로 — 둘을 합쳐도 HTTP 1건이다.

    종전에는 2건이었다. 각 메서드가 `_fetch_body` 를 따로 불렀고, 테스트는
    `daily_forecast` 단독만 세서 어긋남이 안 보였다. 그 사이 docstring 두 곳은
    "호출 1건 = 응답 1건 … 시간 단위 도입에 추가 API 비용이 없다"고 적어 두고
    있었다 — 공공데이터포털 일일 한도를 문서값의 2배로 쓰는 상태였다.
    """
    http = _FakeHttp(_body({"item": []}))
    adapter = _adapter(http)
    adapter.daily_forecast(_COORD, (_D1, _D2))
    adapter.hourly_forecast(_COORD, (_D1, _D2))
    assert len(http.calls) == 1


def test_a_new_publication_slot_refetches() -> None:
    """기억은 발표분까지 키다 — 경계를 넘으면 다시 부른다.

    두 호출이 발표시각 경계(02/05/08/11/14/17/20/23시 +10분)를 걸칠 때 낡은 응답을
    돌려주면 daily 와 hourly 가 서로 다른 발표분에서 나온 줄도 모른다. 호출 수를
    아끼려고 값을 틀리게 하지 않는다.
    """
    http = _FakeHttp(_body({"item": []}))
    now = _NOW
    adapter = KmaWeatherAdapter(http, "test-key+/=", now_fn=lambda: now)
    adapter.daily_forecast(_COORD, (_D1,))
    assert len(http.calls) == 1
    now = _NOW.replace(hour=8, minute=15)  # 0800 발표분이 열렸다
    assert base_datetime_for(now) != base_datetime_for(_NOW)
    adapter.daily_forecast(_COORD, (_D1,))
    assert len(http.calls) == 2


def test_a_failed_call_is_not_remembered() -> None:
    """실패를 굳히면 프로세스를 재시작해야 풀린다 — 다음 호출은 다시 나간다."""
    http = _FakeHttp(error=urllib.error.URLError("boom"))
    adapter = _adapter(http)
    for _ in range(2):
        with pytest.raises(WeatherError):
            adapter.daily_forecast(_COORD, (_D1,))
    assert len(http.calls) == 2


# ── ⑥ 키·권한 오류(401/403)는 프로세스당 1회 WARN — 운영에서 보이게 ────────


def _http_error(code: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError(
        "https://apis.data.go.kr/x", code, "Forbidden", hdrs=None, fp=None)


def test_auth_error_warns_once_per_process(monkeypatch, caplog) -> None:
    """403 이 매번 와도 WARN 은 첫 1회 — 동작(WeatherError → no_adjust)은 그대로."""
    monkeypatch.setattr(kma_weather, "_auth_warned", False)
    http = _FakeHttp(error=_http_error(403))
    with caplog.at_level(logging.INFO, logger="trippilot"):
        for _ in range(3):
            with pytest.raises(WeatherError):
                _adapter(http).daily_forecast(_COORD, (_D1,))
    warns = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warns) == 1
    assert "403" in warns[0].getMessage() and "활용신청" in warns[0].getMessage()
    assert "test-key+/=" not in caplog.text  # 키 값 출력 금지


def test_non_auth_failure_does_not_warn(monkeypatch, caplog) -> None:
    monkeypatch.setattr(kma_weather, "_auth_warned", False)
    http = _FakeHttp(error=_http_error(500))
    with caplog.at_level(logging.INFO, logger="trippilot"):
        with pytest.raises(WeatherError):
            _adapter(http).daily_forecast(_COORD, (_D1,))
    assert not [r for r in caplog.records if r.levelno == logging.WARNING]
