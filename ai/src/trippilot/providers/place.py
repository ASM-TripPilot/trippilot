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

    def __init__(self, pool_builder: CandidatePoolBuilder, ttl_sec: int = 86400) -> None:
        self._pool_builder = pool_builder
        self._ttl_sec = ttl_sec  # M7 스냅샷 유효 기준 — 기본 24시간
        self._pools: OrderedDict[str, CandidatePool] = OrderedDict()

    def fetch(self, params: dict) -> InfoPacket:
        now: datetime = params["now"]
        request: CandidatePoolRequest = params["pool_request"]
        try:
            pool = self._pool_builder.build(request, now)
        except Exception as e:  # 조립 실패 — 풀 없이는 일정이 없다 (호출측이 FAILED 판단)
            return InfoPacket(
                provider=ProviderKind.PLACE,
                status=ProviderStatus.NO_CANDIDATES,
                data={"reason": f"{type(e).__name__}: {e}"},
                freshness=None,
            )
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
                source="M7",
                fetched_at=now,
                cache_hit=False,
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
