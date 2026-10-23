"""WeatherPort — 일별 강수확률 조회 콘센트 (TRIP-383).

조회 전용 — 쓰기 메서드를 추가하지 않는다. 반환은 **아는 날짜만** 담는 부분
매핑이다: 예보 지평(기상청 단기예보 ~3일) 밖 날짜는 키 자체가 없다 — 정보 없음을
0%로 지어내지 않는다("정보 없음 ≠ 배제"와 같은 정신 — 무보정이 정직한 값).

값은 그 날짜의 대표 강수확률(POP %) — 대표값 산출 규칙(예: 일중 최댓값)은
어댑터 소관이고, 소비측(오케스트레이터→어셈블리 소프트 항)은 % 정수만 본다.
동일 입력 → 동일 출력 (U5-P4 결정론 — 시각 의존은 어댑터 생성자 주입으로 격리).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Mapping, Protocol, Sequence

from trippilot.domain.common import GeoPoint


class WeatherError(Exception):
    """예보 조회 실패 (HTTP 오류·비정상 응답 봉투). 호출측이 무보정으로 강등(INV-4)."""


class WeatherPort(Protocol):
    def daily_forecast(
        self, coord: GeoPoint, days: Sequence[date]
    ) -> Mapping[date, int]: ...


class HourlyWeatherPort(Protocol):
    """시간대별 강수확률 — **선택 능력**이다 (`hasattr` 로 확인, `fetch_typed` 선례).

    왜 필요한가: `daily_forecast` 는 그 날짜 슬롯의 **최댓값**이라 "오늘 80%" 가
    아침 한 시간의 소나기여도 하루 전체를 우천일로 만든다. 하루를 통째로 짜는
    `generate` 에는 보수적인 그 값이 맞지만, **재계획은 여행 중 특정 시점에
    일어난다** — 오후 3시에 "오늘 80%" 를 주면 이미 그친 비에 반응한다.

    구현 비용이 낮은 이유: 기상청 단기예보 응답이 이미 **시간별 슬롯**(`fcstTime`)로
    오고 어댑터가 그것을 일 최댓값으로 접을 뿐이다 — 추가 HTTP 호출 없이 접기 전
    값을 그대로 내보내면 된다.

    반환은 tz-aware `datetime`(슬롯 시각) → POP %. `daily_forecast` 와 같은 규약:
    **아는 슬롯만** 담는 부분 매핑이고, 예보 지평 밖은 키 자체가 없다(0%로 지어내지
    않는다). 미구현 포트는 이 메서드를 갖지 않으며, 소비측은 일 단위로 되돌아간다.
    """

    def hourly_forecast(
        self, coord: GeoPoint, days: Sequence[date]
    ) -> Mapping[datetime, int]: ...


@dataclass(frozen=True, slots=True)
class DayWeather:
    """하루 날씨 요약 — 기상청 단기예보 코드 **그대로**(해석은 소비측).

    sky: 하늘 상태 코드(1 맑음·3 구름많음·4 흐림) — 그 날 낮 슬롯(06~21시)의 최다값, 동률이면 더 흐린 쪽.
    pty: 강수 형태 코드(0 없음·1 비·2 비/눈·3 눈·4 소나기) — 그 날 슬롯 중 가장 큰 코드(한 번이라도 오면 그 형태).
    tmn/tmx: 최저·최고 기온(℃, 정수 반올림) — TMN/TMX 카테고리, 없으면 시간별 TMP 의 최소·최대.
    모르는 칸은 None — 지어내지 않는다.
    """

    sky: int | None
    pty: int | None
    tmn: int | None
    tmx: int | None


class DailyWeatherDetailPort(Protocol):
    """하늘·강수 형태·기온 — **선택 능력**(`hasattr` 로 확인, `HourlyWeatherPort` 와 같은 방식).

    왜 필요한가: 도우미 "오늘 날씨" 가 강수확률 하나만 말했다(사용자 2026-10-21). 단기예보 응답에는
    SKY·PTY·TMP·TMN·TMX 가 같은 1회 호출에 이미 실려 있어, 접기 전 값을 날짜별로 요약만 하면 된다.
    `daily_forecast` 와 같은 규약 — 아는 날짜만 담는 부분 매핑.
    """

    def daily_detail(
        self, coord: GeoPoint, days: Sequence[date]
    ) -> Mapping[date, DayWeather]: ...
