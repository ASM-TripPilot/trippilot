"""UnknownHandlingAgent — 도우미가 "미확인"으로 답하던 칸을 벤더 웹 검색으로 그때그때 찾는다(2026-10-22 사용자 결정).

웹 검색은 7~12s 라(2026-10-22 실측) 도우미 턴 시한(9s, 팬아웃 ≤3s) 안에 못 끝난다. 그래서 **먼저 답하고 뒤에서 찾는다**
(사용자 선택): 물은 칸이 미확인이면 이번 턴은 "찾아보는 중"으로 답하고 조회를 뒤에서 낸다. 결과는 저장소(ai_kb
`place_fact_cache` — 파드가 둘이라 프로세스 메모리로는 다시 물은 턴이 다른 파드에 가면 못 찾는다)에 두고, 다시 물으면 그 값을
출처와 함께 답한다.

지키는 것:
- 장소는 이미 등록된 곳(poi_id)이다 — 새 장소를 고르지 않는다(INV-1). 값은 도우미 답에만 쓰고 일정 조립에는 넣지 않는다(INV-2).
- 출처는 검색이 단 인용 URL 에서만(게이트) — 출처 없는 값은 저장하지 않는다. 못 찾음도 짧게 저장해 같은 곳을 거듭 찾지 않는다.
- 조회는 뒤에서 돌아 턴 `llm_calls` 에 들지 않는다 — 대신 프로세스당 하루 상한(`DAILY_CAP`)과 장소별 중복 제거로 묶는다.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta

from trippilot.domain.common import TraceId
from trippilot.llm_gateway.workers.place_fact_lookup import PlaceFactLookupWorker
from trippilot.ports.place_fact_store_port import FactRecord, PlaceFacts, PlaceFactStore

__all__ = ["FactRecord", "InMemoryPlaceFactStore", "PlaceFactStore", "UnknownHandlingAgent"]

log = logging.getLogger(__name__)

FOUND_TTL, MISS_TTL = timedelta(days=7), timedelta(days=1)  # 찾은 값은 일주일, 못 찾음은 하루 뒤 다시 찾는다
# ponytail: 프로세스당 상한·중복 제거 — 파드 둘이면 상한도 둘. 비용이 문제면 저장소에 하루 사용량 행을 둔다.
DAILY_CAP, MAX_INFLIGHT, LOOKUP_TIMEOUT_S = 300, 2, 25.0


class InMemoryPlaceFactStore:
    """프로세스 안 저장소 — 벡터 DB DSN 이 없을 때(로컬·테스트). 운영은 Pg."""

    def __init__(self) -> None:
        self._rows: dict[str, FactRecord] = {}
        self._lock = threading.Lock()

    def get(self, poi_id: str, now: datetime) -> FactRecord | None:
        with self._lock:
            row = self._rows.get(poi_id)
        return row if row is not None and row.expires_at > now else None

    def put(self, record: FactRecord) -> None:
        with self._lock:
            self._rows[record.poi_id] = record


class UnknownHandlingAgent:
    def __init__(self, worker: PlaceFactLookupWorker, store: PlaceFactStore, *,
                 submit: Callable[..., object] | None = None) -> None:
        self._worker, self._store = worker, store
        self._pool = ThreadPoolExecutor(MAX_INFLIGHT, thread_name_prefix="unknown-handling") if submit is None else None
        self._submit = submit or self._pool.submit  # type: ignore[union-attr]
        self._inflight: set[str] = set()
        self._spent: tuple[date, int] = (date.min, 0)
        self._lock = threading.Lock()

    def known(self, poi_id: str, now: datetime) -> FactRecord | None:
        """저장된 결과(만료 전). 저장소 장애는 없는 것과 같다 — 카드는 종전대로 "미확인"(INV-4)."""
        try:
            return self._store.get(poi_id, now)
        except Exception as e:  # noqa: BLE001
            log.warning("unknown_handling store_get_failed error=%s", type(e).__name__)
            return None

    def request(self, poi_id: str, place: str, fields: Sequence[str], on: date, trace_id: TraceId, now: datetime) -> bool:
        """뒤에서 찾기를 낸다 — 이미 찾는 중이거나 오늘 상한이면 내지 않는다(False). 이번 턴은 기다리지 않는다."""
        with self._lock:
            day, spent = self._spent if self._spent[0] == now.date() else (now.date(), 0)
            if poi_id in self._inflight or spent >= DAILY_CAP:
                return poi_id in self._inflight  # 찾는 중이면 "찾는 중"이 맞다 — 상한이면 아니다
            self._inflight.add(poi_id)
            self._spent = (day, spent + 1)
        try:
            self._submit(self._run, poi_id, place, tuple(fields), on, trace_id, now)
        except Exception as e:  # noqa: BLE001 — 풀이 닫혔다 등. 못 냈으면 "찾는 중"이라 말하지 않는다
            with self._lock:
                self._inflight.discard(poi_id)
            log.warning("unknown_handling submit_failed error=%s", type(e).__name__)
            return False
        log.info("unknown_handling lookup_started trace=%s fields=%s", trace_id, ",".join(fields))
        return True

    def _run(self, poi_id: str, place: str, fields: tuple[str, ...], on: date, trace_id: TraceId, now: datetime) -> None:
        try:
            result = self._worker.lookup(place, fields, on, trace_id, now, timeout_sec=LOOKUP_TIMEOUT_S)
            if result.is_fallback:  # 시한·형식·출처 없음 — 저장하지 않고 다음에 물으면 다시 찾는다
                log.info("unknown_handling lookup_failed trace=%s reason=%s", trace_id, result.error)
                return
            facts = result.value if isinstance(result.value, PlaceFacts) and result.value.any() else None
            self._store.put(FactRecord(poi_id, facts, now, now + (FOUND_TTL if facts else MISS_TTL)))
            log.info("unknown_handling lookup_done trace=%s found=%s source=%s", trace_id, facts is not None,
                     facts.source_host if facts else "-")
        except Exception as e:  # noqa: BLE001 — 뒤에서 도는 일이라 위로 던질 곳이 없다. 사유만 남긴다
            log.warning("unknown_handling lookup_error trace=%s error=%s", trace_id, type(e).__name__)
        finally:
            with self._lock:
                self._inflight.discard(poi_id)
