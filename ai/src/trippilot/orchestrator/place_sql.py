"""PlaceSqlLookup — 도우미 장소 탐색의 NL2SQL 한 번: 말 → (DIALOGUE_SQL) 검사된 SELECT → (PgPlaceSql) 보여 줄 칸만 담은 행.

핸들러(`dialogue_handlers._plan_explore`)는 이 객체를 `HandlerPorts.place_sql` 로 받아 반경 탐색과 **나란히** 부른다 — 이쪽이
실패·0건이면 반경 결과를 쓴다(INV-4). 실패는 삼키지 않고 한 줄 남긴다(SQL·발화 원문은 싣지 않는다 — 사유 라벨·행 수·시간만).
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Mapping
from datetime import datetime

from trippilot.domain.common import TraceId
from trippilot.llm_gateway.workers.dialogue_sql import DialogueSqlWorker
from trippilot.poi_curation.adapters.pg_place_sql import PgPlaceSql, PlaceRow

log = logging.getLogger(__name__)

# 같은 말·같은 조건(발화 + 분류 인자 region·category·theme)의 SQL 은 다시 쓰지 않는다 — "서울 요즘 핫한 곳"처럼 사용자마다 같은 말이 잦고,
# 키에 발화를 넣는 이유: 인자만으로는 넓은 지역 아래의 동네("망원 카페" ↔ "서울 카페", 둘 다 {서울, 카페})·"~말고" 제외·개수가 갈리지
# 않는다 — 앞 사용자의 SQL 이 1시간 동안 다른 사용자 말에 실렸다(2026-10-20 Codex 리뷰 확정, 재현).
# NL2SQL LLM 은 실측 1.2~1.5s 에 꼬리가 2.8s 를 넘는다(2026-10-20 테스트 화면 6회 중 2회). 행은 캐시하지 않는다(DB 는 30ms 미만·늘 최신).
# ponytail: 프로세스 메모리 캐시 — 파드·워커마다 따로 데워진다. 공유가 필요하면 Redis.
CACHE_TTL_S, CACHE_MAX = 3600, 512


class PlaceSqlLookup:
    def __init__(self, worker: DialogueSqlWorker | None, executor: PgPlaceSql, *, clock=time.monotonic) -> None:
        # worker 없음 = DIALOGUE_SQL 미배정 — NL2SQL 탐색은 끄고 이름 찾기(`find_place`, LLM 없음)만 쓴다
        self._worker, self._executor, self._clock = worker, executor, clock
        self._cache: dict[tuple, tuple[float, str]] = {}
        self._lock = threading.Lock()

    @property
    def writes_sql(self) -> bool:
        return self._worker is not None

    def _cached(self, key: tuple) -> str | None:
        with self._lock:
            hit = self._cache.get(key)
            if hit is None or hit[0] <= self._clock():
                self._cache.pop(key, None)
                return None
            return hit[1]

    def _remember(self, key: tuple, sql: str) -> None:
        with self._lock:
            if len(self._cache) >= CACHE_MAX:
                self._cache.pop(next(iter(self._cache)))  # 가장 먼저 넣은 것부터
            self._cache[key] = (self._clock() + CACHE_TTL_S, sql)

    def lookup(self, utterance: str, arguments: Mapping[str, str], trace_id: TraceId, now: datetime,
               *, timeout_sec: float) -> list[PlaceRow] | None:
        """None = 쓸 결과 없음(LLM 폴백·장소 조회 아님·DB 오류) — 호출측은 반경 탐색 결과로 간다. 빈 목록 = 조회는 됐고 0건."""
        started = time.monotonic()
        args = tuple(sorted((k, v) for k, v in arguments.items() if v))
        key = (" ".join(utterance.split()), *args) if args else ()  # 계획 경로(발화 "")는 인자만 — 발화 키와 따로 산다
        sql = self._cached(key) if key else None
        if sql is None:
            if self._worker is None:
                return None
            result = self._worker.write(utterance, arguments, trace_id, now, timeout_sec=timeout_sec)
            if result.is_fallback or not result.value:
                log.info("place_sql skip trace=%s reason=%s", trace_id, result.error or "not_a_place_query")
                return None
            sql = result.value
            if key:
                self._remember(key, sql)
        try:
            rows = self._executor.run(sql)
        except Exception as e:  # noqa: BLE001 — DB 오류·시한은 반경 탐색으로 수렴(INV-4), 사유는 예외 타입까지(키·SQL 비노출)
            log.warning("place_sql db_error trace=%s error=%s — 반경 탐색으로", trace_id, type(e).__name__)
            return None
        log.info("place_sql ok trace=%s rows=%d ms=%d", trace_id, len(rows), int((time.monotonic() - started) * 1000))
        return rows

    def find_place(self, name: str, sido_prefix: str | None, trace_id: TraceId) -> PlaceRow | None:
        """일정 밖 장소를 이름으로 — LLM 없이 매개변수 SQL 한 번. DB 오류는 None(일정 안내로 수렴, INV-4) + 한 줄."""
        try:
            return self._executor.find_by_name(name, sido_prefix)
        except Exception as e:  # noqa: BLE001 — 사유는 예외 타입까지(이름 원문 비노출)
            log.warning("place_find db_error trace=%s error=%s", trace_id, type(e).__name__)
            return None
