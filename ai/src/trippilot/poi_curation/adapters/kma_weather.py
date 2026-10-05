"""KmaWeatherAdapter — 기상청 단기예보(getVilageFcst) WeatherPort 구현 (TRIP-383).

위치 판단: 외부 공공데이터포털(apis.data.go.kr) 어댑터의 기존 선례(TourAPI —
`poi_curation/sourcing/tourapi.py`)가 이 패키지에 있고, 그 HTTP 콘센트
(HttpGetJson·UrllibHttpClient)를 그대로 재사용한다. assembly_engine/adapters는
이동 API 소관, llm_gateway/adapters는 벤더 SDK 한정(BR-U4-10) — 날씨 어댑터는
여기가 기존 관례와의 어긋남이 가장 작다.

HTTP 클라이언트는 생성자 주입 — 테스트는 fake, 실행 조립은 UrllibHttpClient
(tourapi와 동형). **daily_forecast 1회 = HTTP 호출 정확히 1건**, 재시도 없음
(공공데이터포털 일일 한도 아끼기 — poi_sourcing_port와 같은 호출 예산 계약).

응답 형태는 기상청 「단기예보 조회서비스 2.0」 문서 기준으로 고정했다 —
**실 응답과의 드리프트는 실키 실행에서 검증**한다 (serviceKey=env `WEATHER_API`,
CI·로컬 테스트 실 호출 0 — D37). 알려진 변주는 반영: 빈 목록에서 `items`가
객체가 아니라 빈 문자열 ""로 오는 것(tourapi와 동일 변주), fcstValue가 문자열로
오는 것.

**엔드포인트는 공공데이터포털(apis.data.go.kr, `serviceKey`)이다** — 키 종류와 짝이다.
기상청 API허브 키(apihub.kma.go.kr, `authKey`)를 넣으면 포털은 SERVICE_KEY_IS_NOT_REGISTERED
(HTTP 403)로 거절한다(2026-10-01 실측 — 이 사고로 날씨 보정이 매 생성 꺼져 있었다).
팀 결정(2026-10-02): 백엔드 weather-context 와 같은 포털 키 하나로 통일. 응답 JSON 계층
(`response.header/body.items.item[]`)은 두 엔드포인트가 같다(2026-10-02 실호출 대조).

격자 변환(`latlon_to_grid`)은 기상청 LCC(Lambert Conformal Conic) 공식의 결정론
구현 — 활용가이드 C 코드의 파라미터(지구반경 6371.00877km · 격자 5km ·
표준위도 30°/60° · 기준점 (38°N, 126°E)=(43, 136))를 그대로 옮겼다.
검증값: 서울 종로(가이드 예시 좌표) (60,127) · 부산 (98,76) · 인천 (55,124).
"""

from __future__ import annotations

import logging
import math
from collections.abc import Callable, Mapping, Sequence
from datetime import date, datetime, timedelta, timezone

from trippilot.domain.common import GeoPoint
from trippilot.poi_curation.sourcing.tourapi import HttpGetJson
from trippilot.ports.weather_port import WeatherError

_KST = timezone(timedelta(hours=9))
# 같은 「단기예보 조회서비스 2.0」을 두 곳이 서비스한다. 경로와 응답 JSON 계층은 같고
# **키 파라미터 이름과 키 종류만 다르다**(2026-10-02·10-05 실호출 대조).
_PORTAL_BASE = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0"
_APIHUB_BASE = "https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0"
_APIHUB_HOST = "apihub.kma.go.kr"
_BASE = _PORTAL_BASE  # 과거 이름 — 밖에서 참조하던 자리를 깨지 않는다
_OK_CODE = "00"  # NORMAL_SERVICE


def key_param_for(base_url: str) -> str:
    """주소에서 키 파라미터 이름을 고른다 — 이 둘은 **항상** 같이 간다.

    실제로 어긋나 날씨 보정이 두 번 조용히 꺼진 짝이다:
        포털(`apis.data.go.kr`) 은 ``serviceKey`` · 허브(`apihub.kma.go.kr`) 는 ``authKey``
        틀리면 403 SERVICE_KEY_IS_NOT_REGISTERED 또는 401 유효한 인증키가 아닙니다

    그래서 파라미터 이름을 설정값으로 두지 않는다 — 주소 하나만 맞으면 따라온다.

    **주소는 키 모양으로 맞히지 않는다.** 한 번 그렇게 만들었다가 틀렸다: 포털 키가
    base64 라 ``+ / =`` 를 담는다고 보고 "특수문자 없으면 허브"로 갈랐는데,
    2026-10-05 에 **64자 영숫자 포털 키**가 들어와 허브로 가서 401 이 났다(실측).
    키 형식은 발급처가 언제든 바꿀 수 있는 것이라 판별 근거가 못 된다 — 주소는
    `WEATHER_API_BASE` 로 **명시**하고, 기본값은 포털이다.
    """
    return "authKey" if _APIHUB_HOST in base_url else "serviceKey"
# 발표시각(base_time) 8회 고정 + API 제공은 발표 후 ~10분 (활용가이드)
_BASE_HOURS = (2, 5, 8, 11, 14, 17, 20, 23)
_PROVIDE_LAG_MIN = 10
# 단기예보 1개 발표분 ≈ 카테고리 12종 × 시간별 슬롯(+3일 일부) ≤ ~900건.
# 1페이지로 전부 받는다 (호출 1건 계약) — 상한 초과분은 지평 밖으로 취급.
_NUM_OF_ROWS = 1500

_log = logging.getLogger(__name__)
# 키·권한 오류(401/403)는 요청마다 반복되는데 폴백 로그는 INFO 라 운영에서 안 보인다 —
# 프로세스당 첫 1회만 WARN 으로 올리고 이후는 억제한다(로그 홍수 방지).
_AUTH_CODES = (401, 403)
_auth_warned = False

# ── 위경도 → 기상청 격자 (LCC 정격 변환, 결정론) ─────────────────────

_RE = 6371.00877     # 지구 반경 (km)
_GRID = 5.0          # 격자 간격 (km)
_SLAT1 = 30.0        # 표준위도 1 (deg)
_SLAT2 = 60.0        # 표준위도 2 (deg)
_OLON = 126.0        # 기준점 경도 (deg)
_OLAT = 38.0         # 기준점 위도 (deg)
_XO = 43             # 기준점 X좌표 (격자)
_YO = 136            # 기준점 Y좌표 (격자)


def latlon_to_grid(lat: float, lng: float) -> tuple[int, int]:
    """위경도 → (nx, ny). 기상청 활용가이드 C 코드(TO_GRID)와 동일 산식·반올림."""
    degrad = math.pi / 180.0
    re = _RE / _GRID
    slat1, slat2 = _SLAT1 * degrad, _SLAT2 * degrad
    olon, olat = _OLON * degrad, _OLAT * degrad
    sn = math.tan(math.pi * 0.25 + slat2 * 0.5) / math.tan(math.pi * 0.25 + slat1 * 0.5)
    sn = math.log(math.cos(slat1) / math.cos(slat2)) / math.log(sn)
    sf = math.tan(math.pi * 0.25 + slat1 * 0.5)
    sf = sf ** sn * math.cos(slat1) / sn
    ro = math.tan(math.pi * 0.25 + olat * 0.5)
    ro = re * sf / ro ** sn
    ra = math.tan(math.pi * 0.25 + lat * degrad * 0.5)
    ra = re * sf / ra ** sn
    theta = lng * degrad - olon
    if theta > math.pi:
        theta -= 2.0 * math.pi
    if theta < -math.pi:
        theta += 2.0 * math.pi
    theta *= sn
    nx = math.floor(ra * math.sin(theta) + _XO + 0.5)
    ny = math.floor(ro - ra * math.cos(theta) + _YO + 0.5)
    return int(nx), int(ny)


def base_datetime_for(now: datetime) -> tuple[str, str]:
    """조회 시점 → 가장 최근 이용 가능한 (base_date, base_time). 결정론.

    발표 후 제공까지의 지연(~10분)을 빼고 그 시점 이전의 마지막 발표시각을 고른다.
    당일 첫 발표(02:00+10분) 전이면 전일 23:00 발표분.
    """
    t = now - timedelta(minutes=_PROVIDE_LAG_MIN)
    hour = max((h for h in _BASE_HOURS if h <= t.hour), default=None)
    if hour is None:
        base_day = (t - timedelta(days=1)).date()
        hour = _BASE_HOURS[-1]
    else:
        base_day = t.date()
    return base_day.strftime("%Y%m%d"), f"{hour:02d}00"


def _warn_auth_once(code: int) -> None:
    global _auth_warned
    if _auth_warned:
        return
    _auth_warned = True
    _log.warning(
        "기상청 단기예보 키·권한 오류 HTTP %s — WEATHER_API 가 공공데이터포털 "
        "디코딩 키인지(API허브 키 아님)·활용신청 상태를 확인할 것. 날씨 보정 없이(no_adjust) 계속한다 "
        "(이후 같은 오류는 이 프로세스에서 다시 경고하지 않음)", code)


class KmaWeatherAdapter:
    """WeatherPort 구현. service_key는 **공공데이터포털 디코딩 키** (urlencode는 HTTP 클라이언트 1회).

    `now_fn` 주입은 base_date/base_time 선택의 결정론 격리용 — 테스트는 고정 시각을
    꽂는다. 기본은 KST 현재 시각 (어댑터는 I/O 경계라 DL-3 대상 밖).
    """

    def __init__(
        self,
        http: HttpGetJson,
        service_key: str,
        *,
        now_fn: Callable[[], datetime] | None = None,
        base_url: str | None = None,
    ) -> None:
        self._http = http
        self._key = service_key
        # 주소는 명시로 고르고(기본 포털), **키 파라미터 이름은 주소에서 따라온다** —
        # 주소만 바꾸고 파라미터를 안 바꾸는 실수를 만들 수 없게 한다.
        self._base = (base_url or _PORTAL_BASE).rstrip("/")
        self._key_param = key_param_for(self._base)
        _log.info("기상청 단기예보 = %s (키 파라미터 %s)", self._base, self._key_param)
        self._now = now_fn if now_fn is not None else lambda: datetime.now(_KST)
        # 같은 (좌표, 발표분) 응답을 기억한다 — 아래 `_fetch_body` 참고.
        self._last: tuple[tuple[float, float, str, str], object] | None = None

    def daily_forecast(
        self, coord: GeoPoint, days: Sequence[date]
    ) -> Mapping[date, int]:
        """날짜별 대표 강수확률(%) — 그 날짜 예보 슬롯 POP의 **최댓값** (보수적:
        하루 중 한 번이라도 임계 이상이면 우천일). 요청 날짜만 담고, 예보 지평 밖
        날짜는 키 없음. 요청이 비면 호출 없이 빈 매핑."""
        if not days:
            return {}
        pops: dict[date, int] = {}
        body = self._fetch_body(coord)
        for slot, pop in self._pop_slots(body, days):
            day = slot.date()
            pops[day] = max(pops.get(day, 0), pop)
        return pops

    def _fetch_body(self, coord: GeoPoint) -> object:
        """단기예보 1회 호출 — `daily_forecast`·`hourly_forecast` 공용.

        **호출 1건 = 응답 1건**이다. 시간별을 따로 부르는 것이 아니라 같은 응답을
        다르게 접을 뿐이라, 시간 단위 도입에 추가 API 비용이 없다.

        그 약속을 **마지막 응답 1건 기억**으로 지킨다. `WeatherProvider.fetch` 는
        `daily_forecast` 와 `hourly_forecast` 를 따로 부르므로, 기억이 없으면 요청당
        호출이 2건 나가 공공데이터포털 일일 한도를 문서값의 2배로 쓴다. 더 나쁜 쪽은
        값이다 — 두 호출이 발표시각 경계(02/05/08/11/14/17/20/23시 +10분)를 걸치면
        daily 와 hourly 가 **서로 다른 발표분**에서 나와, 같은 응답을 접은 것이라는
        전제가 깨진다. 그래서 키에 발표분을 넣는다(경계를 넘으면 다시 부른다).

        한 칸만 둔다. 한 요청이 한 좌표를 쓰고 어댑터 수명이 프로세스 수명이라
        LRU 가 필요한 자리가 아니고, 칸을 늘리면 오래된 발표분이 남는 쪽이 위험하다.
        실패는 기억하지 않는다 — 일시 장애를 굳히면 프로세스를 재시작해야 풀린다.
        """
        nx, ny = latlon_to_grid(coord.lat, coord.lng)
        base_date, base_time = base_datetime_for(self._now())
        key = (coord.lat, coord.lng, base_date, base_time)
        if self._last is not None and self._last[0] == key:
            return self._last[1]
        try:
            body = self._http.get_json(
                f"{self._base}/getVilageFcst",
                {
                    self._key_param: self._key,
                    "dataType": "JSON",
                    "pageNo": "1",
                    "numOfRows": str(_NUM_OF_ROWS),
                    "base_date": base_date,
                    "base_time": base_time,
                    "nx": str(nx),
                    "ny": str(ny),
                },
            )
        except Exception as e:
            code = getattr(e, "code", None)  # urllib HTTPError
            if code in _AUTH_CODES:
                _warn_auth_once(code)
            raise WeatherError(f"단기예보 호출 실패: {e}") from e
        self._last = (key, body)
        return body

    def hourly_forecast(
        self, coord: GeoPoint, days: Sequence[date]
    ) -> Mapping[datetime, int]:
        """슬롯 시각별 강수확률(%) — `daily_forecast` 가 접기 **전**의 값.

        같은 엔드포인트·같은 1회 호출이다(`HourlyWeatherPort` docstring 참조).
        재계획처럼 "지금부터 남은 시간"만 보고 싶을 때 쓴다 — 소비측이 시각으로
        자르면 된다. 아는 슬롯만 담고, 요청이 비면 호출 없이 빈 매핑.
        """
        if not days:
            return {}
        return dict(self._pop_slots(self._fetch_body(coord), days))

    def _pop_slots(
        self, body: object, days: Sequence[date]
    ) -> tuple[tuple[datetime, int], ...]:
        """응답 → (슬롯 시각, POP%) 목록. 요청 날짜만, 파싱 불가·범위 밖은 스킵.

        `daily_forecast`·`hourly_forecast` 가 **같은 파싱을 공유**한다 — 규칙을 두
        곳에 복사하면 한쪽만 고쳐져 값이 갈린다(안티패턴 로그 §전수 이관).
        """
        wanted = {d.strftime("%Y%m%d"): d for d in days}
        slots: list[tuple[datetime, int]] = []
        for item in self._items(body):
            if item.get("category") != "POP":
                continue
            day = wanted.get(str(item.get("fcstDate", "")))
            if day is None:
                continue
            try:
                pop = int(str(item.get("fcstValue")))
            except (TypeError, ValueError):
                continue  # 비정수 표기 — 지어내지 않고 스킵
            if not 0 <= pop <= 100:
                continue  # 범위 밖 값 — 도메인 불변식(0~100)을 지키는 쪽으로 스킵
            raw = str(item.get("fcstTime", ""))
            if len(raw) != 4 or not raw.isdigit():
                continue  # 시각 표기 이상 — 슬롯을 지어내지 않는다
            slots.append((
                datetime(day.year, day.month, day.day,
                         int(raw[:2]) % 24, int(raw[2:]), tzinfo=_KST),
                pop,
            ))
        return tuple(slots)

    @staticmethod
    def _items(body: object) -> tuple[Mapping, ...]:
        """응답 봉투 해체. resultCode != "00" 은 WeatherError (침묵 금지)."""
        if not isinstance(body, Mapping):
            raise WeatherError(f"응답이 객체가 아님: {type(body).__name__}")
        resp = body.get("response")
        if not isinstance(resp, Mapping):
            raise WeatherError("response 봉투 없음")
        header = resp.get("header")
        code = header.get("resultCode") if isinstance(header, Mapping) else None
        if code != _OK_CODE:
            msg = header.get("resultMsg") if isinstance(header, Mapping) else None
            raise WeatherError(f"비정상 응답 코드: {code!r} ({msg})")
        payload = resp.get("body")
        items = payload.get("items") if isinstance(payload, Mapping) else None
        if not isinstance(items, Mapping):
            return ()  # 빈 목록 변주: items == "" (tourapi와 동일)
        item = items.get("item")
        if isinstance(item, Mapping):
            return (item,)
        if isinstance(item, list):
            return tuple(x for x in item if isinstance(x, Mapping))
        return ()
