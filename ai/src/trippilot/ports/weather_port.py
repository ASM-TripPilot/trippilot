"""WeatherPort — 일별 강수확률 조회 콘센트 (TRIP-383).

조회 전용 — 쓰기 메서드를 추가하지 않는다. 반환은 **아는 날짜만** 담는 부분
매핑이다: 예보 지평(기상청 단기예보 ~3일) 밖 날짜는 키 자체가 없다 — 정보 없음을
0%로 지어내지 않는다("정보 없음 ≠ 배제"와 같은 정신 — 무보정이 정직한 값).

값은 그 날짜의 대표 강수확률(POP %) — 대표값 산출 규칙(예: 일중 최댓값)은
어댑터 소관이고, 소비측(오케스트레이터→솔버 소프트 항)은 % 정수만 본다.
동일 입력 → 동일 출력 (U5-P4 결정론 — 시각 의존은 어댑터 생성자 주입으로 격리).
"""

from __future__ import annotations

from datetime import date
from typing import Mapping, Protocol, Sequence

from trippilot.domain.common import GeoPoint


class WeatherError(Exception):
    """예보 조회 실패 (HTTP 오류·비정상 응답 봉투). 호출측이 무보정으로 강등(INV-4)."""


class WeatherPort(Protocol):
    def daily_forecast(
        self, coord: GeoPoint, days: Sequence[date]
    ) -> Mapping[date, int]: ...
