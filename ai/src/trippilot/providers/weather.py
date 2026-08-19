"""WeatherProvider — 일 단위 기상 정보 수집 (agent-structure-v2 §2, S7.2, TRIP-406).

실포트 `trippilot.ports.weather_port.WeatherPort`(TRIP-383)를 감싸 InfoPacket으로
승격한다. 트리거 판정(강수 80%↑)은 규칙 로직 — LLM 0회.

TTL: 기상청 발표 주기 1회분 (약 3h).
실패는 예외가 아니라 `ProviderStatus.WEATHER_UNKNOWN` (IO-7, INV-4 — 파이프라인
진행은 정상). 사유는 data["reason"]에 보존해 호출측 Degradation 기록에 쓴다.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import date, datetime
from typing import Sequence

from trippilot.domain.freshness import (
    FreshnessMeta,
    InfoPacket,
    ProviderKind,
    ProviderStatus,
)
from trippilot.ports.weather_port import WeatherPort


class WeatherProvider:
    """InfoCollector가 호출하는 날씨 수집 Provider. LLM 0회.

    params (정보 요구표의 GENERATE_SCHEDULE 공통 파라미터):
    - "anchor": GeoPoint — 조회 좌표
    - "days": Sequence[date] — 여행 날짜들
    - "now": datetime(tz-aware) — FreshnessMeta.fetched_at
    """

    PRECIPITATION_TRIGGER_THRESHOLD = 80  # 강수확률 % — 이상이면 Plan-B 트리거 후보

    def __init__(self, port: WeatherPort, ttl_sec: int = 10800) -> None:
        self._port = port
        self._ttl_sec = ttl_sec  # 기상청 발표 주기 1회분 ≈ 3시간

    def fetch(self, params: dict) -> InfoPacket:
        days: Sequence[date] = params["days"]
        now: datetime = params["now"]
        try:
            daily: Mapping[date, int] = self._port.daily_forecast(
                params["anchor"], days
            )
        except Exception as e:  # 포트 계약 밖 예외 포함 전부 상태값으로 수렴 (IO-7)
            return InfoPacket(
                provider=ProviderKind.WEATHER,
                status=ProviderStatus.WEATHER_UNKNOWN,
                data={"reason": f"{type(e).__name__}: {e}"},
                freshness=None,
            )
        # 예보 지평 밖 날짜는 키가 없는 부분 매핑이 정상 (정보 없음 ≠ 실패).
        # data는 JSON-safe 계약(InfoPacket) — 날짜는 ISO 문자열로 담는다.
        triggers = tuple(
            d.isoformat() for d, pop in daily.items()
            if pop >= self.PRECIPITATION_TRIGGER_THRESHOLD
        )
        return InfoPacket(
            provider=ProviderKind.WEATHER,
            status=ProviderStatus.OK,
            data={"daily": {d.isoformat(): pop for d, pop in daily.items()},
                  "triggers": triggers},
            freshness=FreshnessMeta(
                source="KMA",
                fetched_at=now,
                cache_hit=False,
                ttl_sec=self._ttl_sec,
                stale=False,
            ),
        )
