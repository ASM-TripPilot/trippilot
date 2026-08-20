"""EventProvider — 행사 정보 수집 (agent-structure-v2 §2, TRIP-421). LLM 0회.

행사 저장소(EventPort — 실체는 웹소싱 새벽 배치가 채운다, 배치는 후속)를 읽어
**여행 날짜와 겹치고 앵커에서 최대 반경 안**인 행사만 InfoPacket으로 승격한다.

여기는 관대한 1차 필터만 한다 — 페르소나 기반 반경 공식·POI 근접 부착·거리
감쇠 보너스는 풀과 페르소나를 함께 아는 호출측(orchestrator/event_affinity.py)
소관이다. Provider끼리는 서로의 데이터를 보지 못한다(수집·판단 분리, v2 §3).

상태값(IO-7):
- OK — 정상 (행사 0건 포함 — "없음"은 실패가 아니다)
- LOW — 저장소 페이지 절단으로 일부만 반환됐을 수 있음 (침묵 절단 금지)
- UNAVAILABLE — 조회 실패, 사유는 data["reason"]
"""

from __future__ import annotations

import math
from datetime import date, datetime
from typing import Sequence

from trippilot.domain.common import GeoPoint
from trippilot.domain.event import EventInfo
from trippilot.domain.freshness import (
    FreshnessMeta,
    InfoPacket,
    ProviderKind,
    ProviderStatus,
)
from trippilot.ports.event_port import EventPort

# 1차 필터 최대 반경 — 이동수단·취향별 실효 반경(event_affinity.event_radius_km,
# 상한 40km)을 전부 덮는 관대한 값. 실효 반경 적용은 호출측.
MAX_RADIUS_KM = 40.0


def _haversine_km(a: GeoPoint, b: GeoPoint) -> float:
    """대원거리 — c2(solver_engine.travel)와 동일 공식의 지역 사본.

    providers는 설비 계층(c2)을 import하지 않는다 — 6줄 중복이 계층 위반보다 싸다.
    """
    lat1, lng1, lat2, lng2 = map(math.radians, (a.lat, a.lng, b.lat, b.lng))
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2)
    return 2 * 6371.0 * math.asin(math.sqrt(h))


class EventProvider:
    """InfoCollector가 호출하는 행사 수집 Provider.

    params:
    - "anchor": GeoPoint — 여행 기준점
    - "days": Sequence[date] — 여행 날짜들
    - "now": datetime(tz-aware)
    """

    def __init__(self, port: EventPort, ttl_sec: int = 86400) -> None:
        self._port = port
        self._ttl_sec = ttl_sec  # 새벽 배치 주기 = 24시간

    def fetch(self, params: dict) -> InfoPacket:
        anchor: GeoPoint = params["anchor"]
        days: Sequence[date] = params["days"]
        now: datetime = params["now"]
        try:
            events, truncated = self._port.search_events(min(days), max(days))
        except Exception as e:  # 포트 계약 밖 예외 포함 전부 상태값으로 (IO-7)
            return InfoPacket(
                provider=ProviderKind.EVENT,
                status=ProviderStatus.UNAVAILABLE,
                data={"reason": f"{type(e).__name__}: {e}"},
                freshness=None,
            )
        trip_days = tuple(days)
        kept = tuple(
            e for e in events
            if e.overlaps(trip_days)
            and (e.coord is None or _haversine_km(anchor, e.coord) <= MAX_RADIUS_KM)
        )
        return InfoPacket(
            provider=ProviderKind.EVENT,
            status=(ProviderStatus.LOW if truncated else ProviderStatus.OK),
            data={"events": [e.to_dict() for e in kept]},
            freshness=FreshnessMeta(
                source="EVENT_STORE",
                fetched_at=now,
                cache_hit=False,
                ttl_sec=self._ttl_sec,
                stale=False,
            ),
        )
