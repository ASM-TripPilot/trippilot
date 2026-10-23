"""PlaceProvider — POI 후보 풀 수집 (agent-structure-v2 §2, S7.1, TRIP-407).

M7 CandidatePoolBuilder를 래핑해 closed-set 후보 풀을 조립한다 — INV-1의
유일한 후보 공급 경로("후보 공급 = PlaceProvider→M7 단일 경로").
LLM 0회. 필터링은 전부 M7 규칙 로직(반경·예산·영업·품질·상한) 소관.

대형 데이터 규칙(DL-2): 풀(최대 수천 건)은 packet.data에 싣지 않고 **참조 키**
(`pool_ref`)만 담는다 — 실체는 Provider의 요청 스코프 캐시에 있고 호출측이
`resolve(pool_ref)`로 꺼낸다 (InfoCollector.resolve_pool 경유).

상태값(IO-7):
- OK — 풀 1건 이상
- NO_CANDIDATES — 빈 풀(pool_ref는 있음 — 최소 일정 경로가 풀 객체를 쓴다)
  또는 조립 예외(pool_ref 없음, 사유는 data["reason"])
"""

from __future__ import annotations

import uuid
from collections import OrderedDict
from datetime import datetime

from trippilot.domain.freshness import (
    FreshnessMeta,
    InfoPacket,
    ProviderKind,
    ProviderStatus,
)
from trippilot.domain.llm import CandidatePool
from trippilot.domain.poi_curation import CandidatePoolRequest
from trippilot.poi_curation.pool_builder import CandidatePoolBuilder


class PlaceProvider:
    """InfoCollector가 호출하는 장소 후보 수집 Provider. LLM 0회.

    params:
    - "pool_request": CandidatePoolRequest — 조립 조건 (앵커·날짜·예산·수단·반경)
    - "now": datetime(tz-aware)
    """

    # 동시 요청 상한(anyio 스레드풀 기본 40)보다 넉넉하면 충분 — 초과분은 오래된 것부터 축출.
    # resolve 가 꺼내 가므로 실제로 차는 것은 fetch~resolve 사이에 있는 요청 수뿐이다.
    _CACHE_MAX = 64
    # 풀 스냅샷 캐시 상한 — 같은 조건(앵커·요일·예산·수단·반경)의 풀은 TTL(D13, `ttl_sec`) 안에서 다시 짓지 않는다.
    # 2026-10-22 개발 실측: 후보 조회(PLACE)가 파서 캐시(#1553) 뒤에도 2.0~2.4s 로 m7_overrun 전부였고, 그만큼
    # 점수 예산이 줄어 1일차 LLM 풀이 50 에 묶였다(15s 산수: m7≈0 이어야 100). 같은 여행의 재생성·다시 짜기는
    # 조건이 같아 적중한다. 풀·Poi 가 frozen 이라 공유해도 안전하고, 한 풀(≤5,000곳)은 수 MB 다.
    # ponytail: 키는 요청 조건 그대로 — 숙소 좌표가 조금만 달라도 새 풀. 적중률이 모자라면 앵커 격자 반올림.
    _SNAPSHOT_MAX = 16

    def __init__(self, pool_builder: CandidatePoolBuilder, ttl_sec: int = 86400) -> None:
        self._pool_builder = pool_builder
        self._ttl_sec = ttl_sec  # M7 스냅샷 유효 기준 — 기본 24시간
        self._pools: OrderedDict[str, CandidatePool] = OrderedDict()
        self._snapshots: OrderedDict[tuple, tuple[datetime, CandidatePool]] = OrderedDict()

    def fetch(self, params: dict) -> InfoPacket:
        now: datetime = params["now"]
        request: CandidatePoolRequest = params["pool_request"]
        key = _snapshot_key(request)
        cached = self._snapshots.get(key)
        hit = cached is not None and (now - cached[0]).total_seconds() < self._ttl_sec
        if hit:
            built_at, pool = cached
            self._snapshots.move_to_end(key)
        else:
            try:
                pool = self._pool_builder.build(request, now)
            except Exception as e:  # 조립 실패 — 풀 없이는 일정이 없다 (호출측이 FAILED 판단)
                return InfoPacket(
                    provider=ProviderKind.PLACE,
                    status=ProviderStatus.NO_CANDIDATES,
                    data={"reason": f"{type(e).__name__}: {e}"},
                    freshness=None,
                )
            built_at = now
            self._snapshots[key] = (now, pool)
            self._snapshots.move_to_end(key)
            while len(self._snapshots) > self._SNAPSHOT_MAX:
                self._snapshots.popitem(last=False)
        ref = uuid.uuid4().hex
        self._pools[ref] = pool
        while len(self._pools) > self._CACHE_MAX:
            self._pools.popitem(last=False)
        return InfoPacket(
            provider=ProviderKind.PLACE,
            # 빈 풀은 실패가 아니라 "후보 없음" — 최소 일정으로 수렴하는 정상 경로
            status=(ProviderStatus.OK if pool.pois else ProviderStatus.NO_CANDIDATES),
            data={"pool_ref": ref, "pool_size": len(pool.pois)},
            freshness=FreshnessMeta(
                source="M7_CACHE" if hit else "M7",
                fetched_at=built_at,
                cache_hit=hit,
                ttl_sec=self._ttl_sec,
                stale=False,
            ),
        )

    def resolve(self, pool_ref: str) -> CandidatePool | None:
        """참조 키 → 풀 실체. **한 번만 꺼낼 수 있다** — 축출됐거나 이미 꺼냈으면 None
        (호출측이 실패로 판단).

        꺼내면서 지운다. 종전엔 get 만 해서 끝난 요청의 풀이 상한까지 남았고, 동시 요청이
        상한을 넘으면 아직 resolve 전인 요청의 풀이 밀려나 `pool_unavailable` 이 됐다.
        호출처(코디네이터 생성·wiring 대안·재계획·편집)는 전부 collect 직후 1회만 꺼낸다.
        """
        return self._pools.pop(pool_ref, None)


def _snapshot_key(request: CandidatePoolRequest) -> tuple:
    """빌더가 실제로 읽는 조건 전부 — 날짜는 요일 집합(③ 영업일)과 다일 여부(① 반경)로만 읽힌다.

    날짜 자체를 키에 넣으면 같은 여행의 다른 날 재계획이 매번 새 풀이 된다(풀은 날짜가 아니라 요일의 함수).
    """
    return (request.anchor, request.budget, request.transport, request.radius_override_km,
            len(request.dates) > 1, frozenset(d.weekday() for d in request.dates), request.region_codes)
