"""CachingScoringWorker — 선호 점수 캐시 데코레이터 (TRIP-477).

2단계 생성(1차 day1 → 2차 잔여, TRIP-267·293)이 **같은 후보 풀을 두 번 점수
매기는** 중복을 없앤다 — 실측(2026-08-21): 1차 21.5s + 2차 22.1s vs 단일 30.9s.
점수는 (POI, 페르소나)의 함수라 키를 (persona 지문, poi_id)로 잡는다 — 같은
취향이면 여행·호출 경계와 무관하게 같은 점수다. 2차 풀은 1차 풀에서 배치분을
뺀 **부분집합**이므로 정상 경로는 전부 히트 = 점수 LLM 호출 0회.

원칙:
- **폴백·규칙 점수는 캐시하지 않는다** — 캐시가 강등을 고착화하면 다음 호출의
  실 LLM 재시도 기회가 사라진다(INV-4의 반대 방향 오염).
- 부분 미스는 **미스만** 부분 풀로 내부 워커에 넘기고 병합한다(TRIP-378 청크
  패턴 동형). 미스 호출이 폴백이면 히트만 부분 성공으로 내보낸다 — 오케스트레이터의
  기존 missing 규칙 채움이 나머지를 맡는다.
- 가격 캐싱 금지(business-rules §6) 무관 — ScoredPoi(poi_id·score)만 저장.
- PreferenceScoringWorker와 같은 `score()` 시그니처 — 오케스트레이터 무변경 주입.

# ponytail: 프로세스 로컬 dict 캐시(단일 컨테이너 전제) — AI 다중 인스턴스가
# 생기면 백엔드 라우팅 고정(sticky) 또는 외부 캐시로 올린다.
"""

from __future__ import annotations

import time
from collections import OrderedDict
from collections.abc import Callable
from datetime import datetime

from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.llm import CandidatePool, ScoredPoi, TypedResult
from trippilot.domain.persona import PersonaSummary
from trippilot.llm_gateway.workers.preference import PreferenceScoringWorker

_DEFAULT_TTL_SEC = 900.0  # 생성 세션(1차→2차 사이 수 초~수 분)만 감당하면 된다
_DEFAULT_MAX_ENTRIES = 4096  # POI 단위 — 풀 상한(수십)×동시 세션 수십이면 충분


def _persona_fingerprint(persona: PersonaSummary) -> tuple:
    return (persona.taste_tags, persona.companion, persona.budget)


class CachingScoringWorker:
    """PreferenceScoringWorker 데코레이터 — (persona, poi_id) 단위 LLM 점수 캐시."""

    def __init__(
        self,
        inner: PreferenceScoringWorker,
        *,
        ttl_sec: float = _DEFAULT_TTL_SEC,
        max_entries: int = _DEFAULT_MAX_ENTRIES,
        clock: Callable[[], float] = time.monotonic,  # 테스트 주입용 (DL-3 동형)
    ) -> None:
        if ttl_sec <= 0:
            raise ValueError("ttl_sec 양수 필요")
        if max_entries < 1:
            raise ValueError("max_entries ≥ 1")
        self._inner = inner
        self._ttl = ttl_sec
        self._max = max_entries
        self._clock = clock
        # key → (score, 적재 시각). OrderedDict = LRU (히트 시 뒤로 보낸다).
        self._store: OrderedDict[tuple, tuple[float, float]] = OrderedDict()

    def score(
        self,
        pool: CandidatePool,
        persona: PersonaSummary,
        trace_id: TraceId,
        now: datetime,
        *,
        timeout_sec: float | None = None,
    ) -> TypedResult[tuple[ScoredPoi, ...]]:
        fp = _persona_fingerprint(persona)
        hits: dict[PoiId, float] = {}
        for poi in pool.pois:
            cached = self._get(( fp, poi.poi_id))
            if cached is not None:
                hits[poi.poi_id] = cached

        misses = tuple(p for p in pool.pois if p.poi_id not in hits)
        if not misses:  # 전부 히트 — LLM 호출 0회 (2차 생성의 정상 경로)
            return TypedResult(
                value=self._merged(hits, ()), is_fallback=False,
                error=None, call_record=None,
            )

        sub_pool = CandidatePool(
            poi_ids=frozenset(p.poi_id for p in misses),
            pois=misses,
            generated_at=pool.generated_at,
            anchor=pool.anchor,
            radius_km=pool.radius_km,
        )
        result = self._inner.score(
            sub_pool, persona, trace_id, now, timeout_sec=timeout_sec)

        if result.is_fallback:
            if not hits:
                return result  # 캐시도 비고 호출도 폴백 — 그대로 (규칙 점수는 상위 몫)
            # 히트만 부분 성공으로 — 미스는 오케스트레이터의 missing 규칙 채움 몫.
            # 폴백 이벤트는 게이트웨이가 이미 발행했다 (이중 계수 없음, TRIP-378 동형).
            return TypedResult(
                value=self._merged(hits, ()), is_fallback=False,
                error=f"cache_partial_fallback: {result.error}",
                call_record=result.call_record,
            )

        fresh = tuple(result.value or ())
        stamp = self._clock()
        for sp in fresh:
            if sp.is_llm_score:  # 규칙 점수 혼입은 캐시하지 않는다 (강등 고착 금지)
                self._put((fp, sp.poi_id), sp.score, stamp)
        return TypedResult(
            value=self._merged(hits, fresh), is_fallback=False,
            error=result.error,  # 부분 청크 실패 표기는 그대로 관통 (TRIP-378)
            call_record=result.call_record,
        )

    # ── 내부 ─────────────────────────────────────────────────────────

    @staticmethod
    def _merged(
        hits: dict[PoiId, float], fresh: tuple[ScoredPoi, ...]
    ) -> tuple[ScoredPoi, ...]:
        """히트+신규 병합 — poi_id 오름차순 (결정론, 풀 빌더 tie-break와 동형)."""
        merged = {sp.poi_id: sp for sp in fresh}
        for poi_id, score in hits.items():
            merged[poi_id] = ScoredPoi(poi_id=poi_id, score=score, is_llm_score=True)
        return tuple(sorted(merged.values(), key=lambda sp: str(sp.poi_id)))

    def _get(self, key: tuple) -> float | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        score, stored_at = entry
        if self._clock() - stored_at > self._ttl:
            del self._store[key]
            return None
        self._store.move_to_end(key)  # LRU 갱신
        return score

    def _put(self, key: tuple, score: float, stamp: float) -> None:
        self._store[key] = (score, stamp)
        self._store.move_to_end(key)
        while len(self._store) > self._max:
            self._store.popitem(last=False)
