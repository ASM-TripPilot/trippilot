"""KasiHolidayCalendarAdapter — 공공데이터포털 특일정보 `getRestDeInfo` HolidayCalendarPort 구현 (상황 감지 H1).

한국천문연구원 특일정보(SpcdeInfoService)의 **공휴일 정보**만 읽는다. 위치 판단·HTTP 콘센트·봉투 판정·WARN 은
기상청 어댑터(`kma_weather.py`)의 선례를 따른다 — 같은 포털(apis.data.go.kr), 같은 디코딩 키 종류다.

실응답(2026-10-19 실호출, 테스트 픽스처 `tests/fixtures/holiday_calendar/`)의 모양:
`response.header.resultCode == "00"` · `response.body.items.item[]` — 항목은 `dateKind "01"`·`dateName`·
`isHoliday "Y"`·`locdate`(yyyymmdd 정수). 변주: **0건이면 `items` 가 빈 문자열**, **1건이면 `item` 이 객체**(목록
아님). 키 미등록·인증 오류는 `_type=json` 을 줘도 **XML 본문**(`returnReasonCode` 30 등)으로 오고, HTTP 401·403
으로 올 때도 있다. 성공은 resultCode "00" 표식으로만 판정한다 — 빈 응답·모르는 봉투를 "공휴일 없음"으로 읽으면
진짜 공휴일 휴무가 지워진다(BR-SA-17).

태그(`domain.poi`): isHoliday Y → PUBLIC. dateName 이 정확히 `설날`·`추석`인 **연속 3일** → (전날, 당일, 다음날)
자리(+PUBLIC), `부처님오신날` → BUDDHA. `대체공휴일(…)` 은 PUBLIC 만이다. 연속 판정이 달을 넘을 수 있어(2022 설날
1/31~2/2) 요청 범위 앞뒤 2일을 덮는 달을 모두 읽어 합친 뒤 자리를 매긴다. 연속이 3일이 아니면 자리를 지어내지
않는다(PUBLIC 만).

실패는 None 이다 — 한 달이라도 실패하면 전체가 실패다(일부 달만 아는 매핑은 모르는 날을 "공휴일 아님"으로
만든다). WARN 은 파드에서 상태가 바뀔 때 1번(원인 코드 포함, **키는 어디에도 남기지 않는다**). 캐시는 **성공한
달만** 24시간 — 임시공휴일 지정이 뒤에 들어온다. 실패는 기억하지 않는다(일시 장애를 굳히지 않는다, 기상청 #1135).
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping
from datetime import date, timedelta
from typing import Protocol

from trippilot.domain.poi import BUDDHA, CHUSEOK, PUBLIC_HOLIDAY, SEOLLAL

_URL = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo"
_OK_CODE = "00"
_TTL_SEC = 24 * 3600
_EDGE_DAYS = 2  # 연속 3일 판정이 달을 넘는다 — 앞뒤 2일을 덮는 달까지 읽는다
_RUN = {"설날": SEOLLAL, "추석": CHUSEOK}
_XML_CODE = re.compile(r"<returnReasonCode>\s*(\d+)\s*</returnReasonCode>")
_XML_AUTH = re.compile(r"<returnAuthMsg>\s*([A-Z_]+)\s*</returnAuthMsg>")

_log = logging.getLogger(__name__)


class HttpGetText(Protocol):
    """GET 1건 → 본문 문자열. 키 오류가 XML 로 오므로 JSON 파싱은 어댑터가 한다(원인 코드를 읽으려고)."""

    def get_text(self, url: str, params: Mapping[str, str]) -> str: ...


class UrllibTextClient:
    """표준 라이브러리 구현 — 테스트에서는 쓰지 않는다(실 호출 0)."""

    def __init__(self, timeout_sec: float) -> None:
        self._timeout = timeout_sec

    def get_text(self, url: str, params: Mapping[str, str]) -> str:
        with urllib.request.urlopen(f"{url}?{urllib.parse.urlencode(params)}",
                                    timeout=self._timeout) as resp:
            return resp.read().decode("utf-8")


class _Failed(Exception):
    """이 달은 못 읽었다 — 사유는 로그용 문자열(키·주소를 담지 않는다)."""


class KasiHolidayCalendarAdapter:
    """HolidayCalendarPort 구현. `service_key` 는 공공데이터포털 **디코딩 키**(urlencode 는 HTTP 클라이언트 1회).

    앱 수명 동안 공유된다(요청 스레드가 동시에 부른다) — 캐시·상태 변경은 잠금 안에서. 요청당 값은 지역 변수다.
    """

    def __init__(self, http: HttpGetText, service_key: str, *,
                 monotonic: Callable[[], float] = time.monotonic) -> None:
        self._http = http
        self._key = service_key
        self._now = monotonic
        self._lock = threading.Lock()
        self._months: dict[tuple[int, int], tuple[float, tuple[tuple[date, str, bool], ...]]] = {}
        self._healthy: bool | None = None  # None = 아직 모름 — 첫 실패도 WARN 한다

    def holidays_between(self, start: date, end: date) -> Mapping[date, frozenset[str]] | None:
        try:
            items = [item for month in _months_covering(start - timedelta(days=_EDGE_DAYS),
                                                        end + timedelta(days=_EDGE_DAYS))
                     for item in self._month(*month)]
        except _Failed as e:
            self._mark(False, str(e))
            return None
        self._mark(True, "")
        tags = _tags(items)
        return {d: t for d, t in tags.items() if start <= d <= end}

    def _month(self, year: int, month: int) -> tuple[tuple[date, str, bool], ...]:
        with self._lock:
            hit = self._months.get((year, month))
        if hit is not None and self._now() - hit[0] < _TTL_SEC:
            return hit[1]
        try:
            body = self._http.get_text(_URL, {
                "solYear": f"{year:04d}", "solMonth": f"{month:02d}",
                "_type": "json", "numOfRows": "50", "serviceKey": self._key,
            })
        except Exception as e:  # urllib·소켓 — 메시지 대신 종류·HTTP 코드만(주소에 키가 있다)
            code = getattr(e, "code", None)
            raise _Failed(f"{type(e).__name__}{f' HTTP {code}' if code else ''}") from None
        items = _parse(body)
        with self._lock:
            self._months[(year, month)] = (self._now(), items)  # 성공한 달만
        return items

    def _mark(self, healthy: bool, why: str) -> None:
        """상태가 바뀔 때만 한 줄 — 실패로 바뀌면 WARN(첫 실패 포함), 실패에서 돌아오면 INFO."""
        with self._lock:
            before, self._healthy = self._healthy, healthy
        if before is healthy:
            return
        if not healthy:
            _log.warning("특일정보(공휴일 달력) 조회 실패 %s — 날짜 명시형 휴일 규칙만 쓴다"
                         "(PUBLIC_DATA_API_KEY·WEATHER_API 활용신청·키 종류 확인). 같은 상태는 다시 알리지 않는다", why)
        elif before is False:
            _log.info("특일정보(공휴일 달력) 조회 회복 — 공휴일 휴일 규칙을 다시 쓴다")


def _months_covering(lo: date, hi: date) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    y, m = lo.year, lo.month
    while (y, m) <= (hi.year, hi.month):
        out.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def _parse(body: str) -> tuple[tuple[date, str, bool], ...]:
    """본문 → (날짜, 이름, 공휴일인가). 성공 표식이 없거나 모양이 어긋나면 `_Failed`."""
    try:
        doc = json.loads(body)
    except ValueError:
        code, auth = _XML_CODE.search(body or ""), _XML_AUTH.search(body or "")
        raise _Failed(f"JSON 아님(returnReasonCode={code.group(1) if code else '?'} "
                      f"{auth.group(1) if auth else ''})".rstrip()) from None
    resp = doc.get("response") if isinstance(doc, Mapping) else None
    header = resp.get("header") if isinstance(resp, Mapping) else None
    code = str(header.get("resultCode")) if isinstance(header, Mapping) else None
    if code != _OK_CODE:
        raise _Failed(f"resultCode={code}")
    payload = resp.get("body")
    if not isinstance(payload, Mapping):
        raise _Failed("body 없음")
    items = payload.get("items")
    if items == "" or items is None:
        return ()  # 0건 — 빈 문자열로 온다
    if not isinstance(items, Mapping):
        raise _Failed("items 모양")
    raw = items.get("item")
    rows = [raw] if isinstance(raw, Mapping) else raw if isinstance(raw, list) else None
    if rows is None:
        raise _Failed("item 모양")
    out: list[tuple[date, str, bool]] = []
    for row in rows:
        try:
            loc = str(row["locdate"])
            day = date(int(loc[:4]), int(loc[4:6]), int(loc[6:8])) if len(loc) == 8 and loc.isdigit() else None
        except (KeyError, TypeError, ValueError):
            day = None
        if day is None or not isinstance(row.get("dateName"), str):
            raise _Failed("항목 모양")
        out.append((day, row["dateName"], row.get("isHoliday") == "Y"))
    return tuple(out)


def _tags(items: list[tuple[date, str, bool]]) -> dict[date, frozenset[str]]:
    tags: dict[date, set[str]] = {}
    for day, _, holiday in items:
        if holiday:
            tags.setdefault(day, set()).add(PUBLIC_HOLIDAY)
    for name, triple in _RUN.items():
        days = sorted({d for d, n, holiday in items if holiday and n == name})
        run: list[date] = []
        for d in (*days, None):
            if run and d is not None and d - run[-1] == timedelta(days=1):
                run.append(d)
                continue
            if len(run) == 3:
                for slot, rd in zip(triple, run):
                    tags[rd].add(slot)
            run = [d] if d is not None else []
    for day, name, holiday in items:
        if holiday and name == "부처님오신날":
            tags[day].add(BUDDHA)
    return {d: frozenset(t) for d, t in tags.items()}
