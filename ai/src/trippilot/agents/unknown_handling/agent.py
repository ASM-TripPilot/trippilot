"""UnknownHandlingAgent — 도우미가 "미확인"으로 답하던 칸을 벤더 웹 검색으로 그때그때 찾는다(2026-10-22 사용자 결정).

에이전트는 **워커를 감싸는 객체**다 — 조회 워커(`PlaceFactLookupWorker`)와 저장소를 생성자로 받아 들고 있고, 경계는
`run(UnknownTask)` 하나만 안다. "저장된 값을 보고 → 없으면 뒤에서 찾기를 낸다"는 순서 판단은 경계가 아니라 에이전트 몫이다
(2026-10-22 넷과 같은 꼴로 편입 — 종전 `orchestrator/unknown_handling.py` 의 `known`·`request` 두 진입점을 하나로).

웹 검색은 7~12s 라(2026-10-22 실측) 도우미 턴 시한(9s, 팬아웃 ≤3s) 안에 못 끝난다. 그래서 **먼저 답하고 뒤에서 찾는다**
(사용자 선택): 물은 칸이 미확인이면 이번 턴은 "찾아보는 중"으로 답하고 조회를 뒤에서 낸다. 결과는 저장소(ai_kb
`place_fact_cache` — 파드가 둘이라 프로세스 메모리로는 다시 물은 턴이 다른 파드에 가면 못 찾는다)에 두고, 다시 물으면 그 값을
출처와 함께 답한다.

```
UnknownTask ─▶ ① 저장된 결과 조회   찾음 → facts / 못 찾음(하루 보관) → 없음 / 저장소 장애 → 없는 것으로 보고 ② (INV-4)
            ─▶ ② 뒤에서 찾기 제출   냈거나 이미 찾는 중 → pending / 하루 상한·제출 실패 → 없음 (이번 턴은 기다리지 않는다)
            ─▶ (뒤에서) 워커 lookup → 출처 있는 값만 저장(찾음 7일·못 찾음 1일) · 시한·형식·출처 없음은 저장하지 않고 다음에 다시 찾는다
```

지키는 것:
- 장소는 이미 등록된 곳(poi_id)이다 — 새 장소를 고르지 않는다(INV-1). 값은 도우미 답에만 쓰고 일정 조립에는 넣지 않는다(INV-2).
- 출처는 검색이 단 인용 URL 에서만(게이트) — 출처 없는 값은 저장하지 않는다. 못 찾음도 짧게 저장해 같은 곳을 거듭 찾지 않는다.
- 조회는 뒤에서 돌아 턴 `llm_calls` 에 들지 않는다 — 대신 프로세스당 하루 상한(`DAILY_CAP`)과 장소별 중복 제거로 묶는다.
- `run()` 은 예외를 밖으로 던지지 않는다 — 저장소·제출 실패는 "없음"으로 수렴한다(DL-5, INV-4).
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from trippilot.domain.common import TraceId
from trippilot.llm_gateway.workers.place_fact_lookup import PlaceFactLookupWorker
from trippilot.ports.place_fact_store_port import FactRecord, PlaceFacts, PlaceFactStore

log = logging.getLogger(__name__)

FOUND_TTL, MISS_TTL = timedelta(days=7), timedelta(days=1)  # 찾은 값은 일주일, 못 찾음은 하루 뒤 다시 찾는다
# ponytail: 프로세스당 상한·중복 제거 — 파드 둘이면 상한도 둘. 비용이 문제면 저장소에 하루 사용량 행을 둔다.
DAILY_CAP, MAX_INFLIGHT, LOOKUP_TIMEOUT_S = 300, 2, 25.0


@dataclass(frozen=True, slots=True)
class UnknownTask:
    """경계 → UnknownHandlingAgent 재료 봉투 (ReflectTask·EditTask 선례 — 시각·추적도 필드로).

    - `fields`: 물은 칸 중 카드가 모르는 것만(`hours`·`last_entry`·`closed`·`fee`) — 고르는 건 상류(핸들러)다.
    - `on`: 영업 여부를 물은 날 — 워커가 그날 기준으로 찾는다.
    """

    poi_id: str
    place: str
    fields: tuple[str, ...]
    on: date
    trace_id: TraceId
    now: datetime


@dataclass(frozen=True, slots=True)
class UnknownOutcome:
    """`run()` 의 결과 — 셋 중 하나이고 서로 거짓말하지 못한다(핸들러가 각주·칩을 이걸로 가른다).

    - 찾았음: `facts` 있음 — 저장된 값이다, 이번 턴에 찾은 것이 아니다
    - 찾는 중: `facts` 없음 · `pending` — 이번 턴에 냈거나 이미 돌고 있다 → "찾아보는 중" 각주와 [다시 묻기] 칩
    - 없음:   `facts` 없음 · `pending` 아님 — 못 찾음이 저장돼 있거나 하루 상한·제출 실패 → 종전대로 "미확인"
    """

    facts: PlaceFacts | None = None
    pending: bool = False

    def __post_init__(self) -> None:
        if self.facts is not None and self.pending:
            raise ValueError("찾은 값이 있으면 찾는 중일 수 없다")


class UnknownHandlingAgent:
    def __init__(self, worker: PlaceFactLookupWorker, store: PlaceFactStore, *,
                 submit: Callable[..., object] | None = None) -> None:
        self._worker, self._store = worker, store
        self._pool = ThreadPoolExecutor(MAX_INFLIGHT, thread_name_prefix="unknown-handling") if submit is None else None
        self._submit = submit or self._pool.submit  # type: ignore[union-attr]
        self._inflight: set[str] = set()
        self._spent: tuple[date, int] = (date.min, 0)
        self._lock = threading.Lock()

    def run(self, task: UnknownTask) -> UnknownOutcome:
        """저장된 값이 있으면 그것, 없으면 뒤에서 찾기를 내고 "찾는 중". 이번 턴은 기다리지 않는다.
        예외를 던지지 않는다 (INV-4 · DL-5 — 저장소·제출 실패는 "없음"으로 수렴)."""
        stored = self._known(task.poi_id, task.now)
        if stored is not None:  # 찾았거나 못 찾음이 저장돼 있다 — 못 찾음이면 하루는 다시 찾지 않는다
            return UnknownOutcome(facts=stored.facts)
        return UnknownOutcome(pending=self._request(task))

    def _known(self, poi_id: str, now: datetime) -> FactRecord | None:
        """저장된 결과(만료 전). 저장소 장애는 없는 것과 같다 — 카드는 종전대로 "미확인"(INV-4)."""
        try:
            return self._store.get(poi_id, now)
        except Exception as e:  # noqa: BLE001
            log.warning("unknown_handling store_get_failed error=%s", type(e).__name__)
            return None

    def _request(self, task: UnknownTask) -> bool:
        """뒤에서 찾기를 낸다 — 이미 찾는 중이거나 오늘 상한이면 내지 않는다(False). 이번 턴은 기다리지 않는다."""
        with self._lock:
            day, spent = self._spent if self._spent[0] == task.now.date() else (task.now.date(), 0)
            if task.poi_id in self._inflight or spent >= DAILY_CAP:
                return task.poi_id in self._inflight  # 찾는 중이면 "찾는 중"이 맞다 — 상한이면 아니다
            self._inflight.add(task.poi_id)
            self._spent = (day, spent + 1)
        try:
            self._submit(self._lookup, task)
        except Exception as e:  # noqa: BLE001 — 풀이 닫혔다 등. 못 냈으면 "찾는 중"이라 말하지 않는다
            with self._lock:
                self._inflight.discard(task.poi_id)
            log.warning("unknown_handling submit_failed error=%s", type(e).__name__)
            return False
        log.info("unknown_handling lookup_started trace=%s fields=%s", task.trace_id, ",".join(task.fields))
        return True

    def _lookup(self, task: UnknownTask) -> None:
        try:
            result = self._worker.lookup(task.place, task.fields, task.on, task.trace_id, task.now, timeout_sec=LOOKUP_TIMEOUT_S)
            if result.is_fallback:  # 시한·형식·출처 없음 — 저장하지 않고 다음에 물으면 다시 찾는다
                log.info("unknown_handling lookup_failed trace=%s reason=%s", task.trace_id, result.error)
                return
            facts = result.value if isinstance(result.value, PlaceFacts) and result.value.any() else None
            self._store.put(FactRecord(task.poi_id, facts, task.now, task.now + (FOUND_TTL if facts else MISS_TTL)))
            log.info("unknown_handling lookup_done trace=%s found=%s source=%s", task.trace_id, facts is not None,
                     facts.source_host if facts else "-")
        except Exception as e:  # noqa: BLE001 — 뒤에서 도는 일이라 위로 던질 곳이 없다. 사유만 남긴다
            log.warning("unknown_handling lookup_error trace=%s error=%s", task.trace_id, type(e).__name__)
        finally:
            with self._lock:
                self._inflight.discard(task.poi_id)
