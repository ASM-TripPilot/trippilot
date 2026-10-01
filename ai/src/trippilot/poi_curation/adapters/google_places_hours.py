"""PlaceHoursPort 구현 — Google Places (New) Place Details.

## 돈이 나가는 어댑터다 — 상한이 기능의 일부다

`regularOpeningHours` 는 Place Details **Enterprise** 티어다: **$20/1,000 · 월 1,000
무료**(2026-09-26 확인). 팀 결정은 **무료 한도 안에서만 쓴다**이므로 상한을 코드에
박는다. 두 겹이다:

  · `max_calls` — `fetch()` **1회당** 상한. 한 생성 요청이 곧 한 실행이다
    (`KakaoExistenceAdapter` 와 같은 규약 — 누적 예산이면 소진 후 영구히 죽는다)
  · `monthly_budget` — 인스턴스 수명 누적 상한. 넘으면 그 뒤 전부 포기한다

⚠️ **프로세스가 재시작하면 월 카운터는 0 으로 돌아간다.** 이 상한은 실수 방지용
이지 과금 방어의 정본이 아니다 — **정본은 GCP 콘솔의 API 할당량**이다. 배포 전에
콘솔에서 Places API 일/월 상한을 걸어야 한다. 코드만 믿으면 재시작 열 번에 열 배
쓴다.

## FieldMask 를 늘리지 마라 — 요금 티어가 거기서 정해진다

Places API 는 **요청한 필드 중 가장 비싼 티어**로 과금한다. `regularOpeningHours`
하나만 요청하면 Enterprise 1건이지만, 여기에 평점·사진을 더하면
Enterprise+Atmosphere 로 올라간다. 아래 `_FIELD_MASK` 는 그래서 딱 하나다.

## 저장하지 않는다

Google 정책상 `place_id` 를 제외한 Places 콘텐츠는 캐시·저장이 금지다. 이 어댑터는
받은 값을 `HoursVerdict` 로만 돌려주고 어디에도 적재하지 않는다.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Protocol

from trippilot.domain.poi import OpenHour
from trippilot.ports.place_hours_port import HoursQuery, HoursVerdict, PlaceHoursPort

_ENDPOINT = "https://places.googleapis.com/v1/places/"
# **이 하나만 요청한다** (위 주석 — 필드가 곧 요금 티어다).
_FIELD_MASK = "regularOpeningHours"
_ALL_DAY = (0, 24 * 60)


class HttpGetJson(Protocol):
    """GET + JSON 파싱 1건. 실패는 예외로 — 어댑터가 판정으로 감싼다.

    포트 계층을 거치지 않고 여기 두는 이유: 이 프로토콜은 이 어댑터의 **구현
    세부**이고, 다른 어댑터(카카오)는 다른 헤더 규약을 쓴다. 공용화하면 둘 중
    하나의 사정이 다른 쪽으로 샌다.
    """

    def get_json(self, url: str, headers: Mapping[str, str]) -> object: ...


class GooglePlacesHoursAdapter(PlaceHoursPort):
    """`place_id` → 영업시간. 미해결 id 는 아예 묻지 않는다(호출측 책임)."""

    def __init__(
        self,
        http: HttpGetJson,
        api_key: str,
        *,
        max_calls: int,
        monthly_budget: int,
        monotonic_ms: Callable[[], int],
    ) -> None:
        self._http = http
        self._headers = {
            "X-Goog-Api-Key": api_key,
            "X-Goog-FieldMask": _FIELD_MASK,
        }
        self._max_calls = max_calls
        self._monthly_budget = monthly_budget
        # **단조 시계여야 한다** — `time.time()*1000` 은 NTP 역행 한 번에 차분이
        # 음수가 되어 마감이 무력화된다 (KakaoExistenceAdapter 와 같은 이유).
        self._monotonic_ms = monotonic_ms
        self.calls_used = 0          # 이번 fetch() 에서 쓴 수
        self.calls_total = 0         # 인스턴스 누적 — 월 상한 판정용

    def fetch(
        self, queries: tuple[HoursQuery, ...], *, deadline_ms: int
    ) -> tuple[HoursVerdict, ...]:
        started = self._monotonic_ms()
        self.calls_used = 0
        out: list[HoursVerdict] = []
        for i, q in enumerate(queries):
            if self._monotonic_ms() - started >= deadline_ms:
                # 남은 전부를 같은 사유로 채운다 — 빠뜨리지 않는다(개수 보존).
                out.extend(HoursVerdict(r.poi_id, reason="deadline_exceeded")
                           for r in queries[i:])
                break
            out.append(self._fetch_one(q))
        return tuple(out)

    def _fetch_one(self, q: HoursQuery) -> HoursVerdict:
        if self.calls_total >= self._monthly_budget:
            return HoursVerdict(q.poi_id, reason="monthly_budget_exhausted")
        if self.calls_used >= self._max_calls:
            return HoursVerdict(q.poi_id, reason="call_budget_exhausted")
        self.calls_used += 1
        self.calls_total += 1
        try:
            payload = self._http.get_json(_ENDPOINT + q.place_id, self._headers)
        except Exception as e:   # noqa: BLE001 — 경계 밖으로 던지지 않는다(DL-5)
            return HoursVerdict(q.poi_id, reason=f"http_error:{type(e).__name__}")
        hours = parse_regular_opening_hours(payload)
        if not hours:
            return HoursVerdict(q.poi_id, reason="no_hours_in_response")
        return HoursVerdict(q.poi_id, hours=hours)


def parse_regular_opening_hours(payload: object) -> tuple[OpenHour, ...]:
    """`regularOpeningHours.periods` → 우리 `OpenHour`. 못 읽으면 () — 지어내지 않는다.

    변환 둘이 함정이다:

    · **요일 번호가 다르다.** Google 은 `0=일요일`, 우리는 `0=월요일`이다.
      그대로 쓰면 **일정이 하루씩 밀린다** — 월요일 휴무가 일요일 휴무가 된다.
    · **`close` 가 없으면 24시간 영업**이다. 빈 값으로 읽어 버리면 늘 열린 곳이
      늘 닫힌 곳이 된다.

    자정 넘김(금 22:00~토 02:00)은 `close_min` 을 1440 초과로 둔다 — `OpenHour`
    계약이 그렇게 정의돼 있고, 수집 파서도 같은 방식이다.
    """
    if not isinstance(payload, Mapping):
        return ()
    block = payload.get("regularOpeningHours")
    if not isinstance(block, Mapping):
        return ()
    periods = block.get("periods")
    if not isinstance(periods, list) or not periods:
        return ()

    out: list[OpenHour] = []
    for p in periods:
        if not isinstance(p, Mapping):
            continue
        opened = _point(p.get("open"))
        if opened is None:
            continue
        day, open_min = opened
        closed = _point(p.get("close"))
        if closed is None:
            # close 부재 = 24시간 영업. 한 요일만 오더라도 전 요일로 읽지 않는다 —
            # 원문이 말한 것은 "이 구간이 안 닫힌다"까지다.
            out.append(OpenHour(day_of_week=day, open_min=_ALL_DAY[0],
                                close_min=_ALL_DAY[1]))
            continue
        close_day, close_min = closed
        if close_day != day or close_min <= open_min:
            close_min += 24 * 60      # 자정 넘김 (시작일 귀속)
        if open_min < close_min:
            out.append(OpenHour(day_of_week=day, open_min=open_min,
                                close_min=close_min))
    return tuple(out)


def _point(raw: object) -> tuple[int, int] | None:
    """Google Point → (우리 요일, 분). 형식이 어긋나면 None."""
    if not isinstance(raw, Mapping):
        return None
    day, hour, minute = raw.get("day"), raw.get("hour"), raw.get("minute", 0)
    if not isinstance(day, int) or not isinstance(hour, int):
        return None
    if not isinstance(minute, int):
        minute = 0
    if not (0 <= day <= 6 and 0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    return (day + 6) % 7, hour * 60 + minute   # 일=0 → 월=0
