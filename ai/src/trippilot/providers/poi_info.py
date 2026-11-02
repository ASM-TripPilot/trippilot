"""PoiInfoProvider — 장소 id 배치 조회 (assistant-orchestrator FD DE §2.9). LLM 0회.

`PoiDbPort.lookup_by_ids` 를 감싸 InfoPacket 으로 승격한다. "이 장소 정보 알려줘"
(GET_POI_INFO)는 PLACE Provider 가 받을 수 없다 — 그쪽은 후보풀 조립기라 날짜·예산·
교통이 전부 필수고, 지어내면 영업일 필터가 물어본 그 장소를 떨어뜨린다(요구표 註).
여기는 id 로 묻고 id 로 받는다 — 풀도 점수도 없다.

상태값(IO-7):
- OK — 요청 id 전부 찾음
- LOW — 일부(또는 전부) 못 찾음. 누락 id 는 data["misses"] — 조용한 차집합 금지 (TRIP-537)
- UNAVAILABLE — poi_db 예외, 사유는 data["reason"]

좌표(lat·lng)는 패킷 안에만 있다 — Weather anchor·Transit origin/destination·풀 anchor 의
재료다. 프롬프트·응답으로 내보내지 않는 것은 호출측 몫.
"""

from __future__ import annotations

from datetime import date, datetime

from trippilot.domain.common import PoiId
from trippilot.domain.freshness import (
    FreshnessMeta,
    InfoPacket,
    ProviderKind,
    ProviderStatus,
)
from trippilot.domain.poi import Poi, hours_label
from trippilot.poi_curation.place_fees import EMPTY, FeeTable
from trippilot.ports.poi_db_port import PoiDbPort


class PoiInfoProvider:
    """InfoCollector·오케스트레이터가 호출하는 장소 정보 Provider. LLM 0회.

    params:
    - "poi_ids": Iterable[PoiId | str] — 조회할 id (frozenset 이 기본형)
    - "on": date | None — 영업시간 요일 기준. 없으면 `now` 의 요일
    - "now": datetime(tz-aware) — FreshnessMeta.fetched_at
    """

    def __init__(self, poi_db: PoiDbPort, fees: FeeTable = EMPTY, ttl_sec: int = 86400) -> None:
        self._poi_db = poi_db
        self._fees = fees  # 기본 빈 표 = 전부 '모름'(None) — 켜지기 전과 같은 답
        self._ttl_sec = ttl_sec  # POI 정본은 하루 단위로 바뀐다 (M7 캐시 TTL 선례)

    def fetch(self, params: dict) -> InfoPacket:
        ids = frozenset(PoiId(p) for p in params["poi_ids"])
        on: date | None = params.get("on")
        now: datetime = params["now"]
        try:
            lookup = self._poi_db.lookup_by_ids(ids)
        except Exception as e:  # 포트 계약 밖 예외 포함 전부 상태값으로 수렴 (IO-7, DL-5)
            return InfoPacket(
                provider=ProviderKind.POI_INFO,
                status=ProviderStatus.UNAVAILABLE,
                data={"reason": f"{type(e).__name__}: {e}"},
                freshness=None,
            )
        weekday = (on or now).weekday()
        misses = [str(m.poi_id) for m in lookup.misses]
        return InfoPacket(
            provider=ProviderKind.POI_INFO,
            status=ProviderStatus.OK if not misses else ProviderStatus.LOW,
            data={
                "pois": [{
                    "poi_id": str(p.poi_id),
                    "name": p.name,
                    "category": p.category.value,
                    "lat": p.coord.lat,
                    "lng": p.coord.lng,
                    "hours_label": hours_label(p, weekday),
                    "fee": self._fees.of(p.source_ref),  # 0=무료 · None=불명
                    "source_ref": p.source_ref,
                } for p in lookup.pois],
                "misses": misses,
            },
            freshness=FreshnessMeta(
                source="M7",
                fetched_at=now,
                cache_hit=False,
                ttl_sec=self._ttl_sec,
                stale=False,
            ),
        )
