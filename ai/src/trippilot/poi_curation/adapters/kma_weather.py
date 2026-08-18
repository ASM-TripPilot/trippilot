"""KmaWeatherAdapter — 기상청 단기예보(getVilageFcst) WeatherPort 구현 (TRIP-383).

위치 판단: 외부 공공데이터포털(apis.data.go.kr) 어댑터의 기존 선례(TourAPI —
`poi_curation/sourcing/tourapi.py`)가 이 패키지에 있고, 그 HTTP 콘센트
(HttpGetJson·UrllibHttpClient)를 그대로 재사용한다. solver_engine/adapters는
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

격자 변환(`latlon_to_grid`)은 기상청 LCC(Lambert Conformal Conic) 공식의 결정론
구현 — 활용가이드 C 코드의 파라미터(지구반경 6371.00877km · 격자 5km ·
표준위도 30°/60° · 기준점 (38°N, 126°E)=(43, 136))를 그대로 옮겼다.
검증값: 서울 종로(가이드 예시 좌표) (60,127) · 부산 (98,76) · 인천 (55,124).
"""

from __future__ import annotations

import math
from collections.abc import Callable, Mapping, Sequence
from datetime import date, datetime, timedelta, timezone

from trippilot.domain.common import GeoPoint
from trippilot.poi_curation.sourcing.tourapi import HttpGetJson
from trippilot.ports.weather_port import WeatherError

_KST = timezone(timedelta(hours=9))
_BASE = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0"
_OK_CODE = "00"  # NORMAL_SERVICE
# 발표시각(base_time) 8회 고정 + API 제공은 발표 후 ~10분 (활용가이드)
_BASE_HOURS = (2, 5, 8, 11, 14, 17, 20, 23)
_PROVIDE_LAG_MIN = 10
# 단기예보 1개 발표분 ≈ 카테고리 12종 × 시간별 슬롯(+3일 일부) ≤ ~900건.
# 1페이지로 전부 받는다 (호출 1건 계약) — 상한 초과분은 지평 밖으로 취급.
_NUM_OF_ROWS = 1500

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


class KmaWeatherAdapter:
    """WeatherPort 구현. service_key는 **디코딩 키** (urlencode는 HTTP 클라이언트 1회).

    `now_fn` 주입은 base_date/base_time 선택의 결정론 격리용 — 테스트는 고정 시각을
    꽂는다. 기본은 KST 현재 시각 (어댑터는 I/O 경계라 DL-3 대상 밖).
    """

    def __init__(
        self,
        http: HttpGetJson,
        service_key: str,
        *,
        now_fn: Callable[[], datetime] | None = None,
    ) -> None:
        self._http = http
        self._key = service_key
        self._now = now_fn if now_fn is not None else lambda: datetime.now(_KST)

    def daily_forecast(
        self, coord: GeoPoint, days: Sequence[date]
    ) -> Mapping[date, int]:
        """날짜별 대표 강수확률(%) — 그 날짜 예보 슬롯 POP의 **최댓값** (보수적:
        하루 중 한 번이라도 임계 이상이면 우천일). 요청 날짜만 담고, 예보 지평 밖
        날짜는 키 없음. 요청이 비면 호출 없이 빈 매핑."""
        if not days:
            return {}
        nx, ny = latlon_to_grid(coord.lat, coord.lng)
        base_date, base_time = base_datetime_for(self._now())
        try:
            body = self._http.get_json(
                f"{_BASE}/getVilageFcst",
                {
                    "serviceKey": self._key,
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
            raise WeatherError(f"단기예보 호출 실패: {e}") from e
        wanted = {d.strftime("%Y%m%d"): d for d in days}
        pops: dict[date, int] = {}
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
            pops[day] = max(pops.get(day, 0), pop)
        return pops

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
