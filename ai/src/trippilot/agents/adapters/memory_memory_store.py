"""InMemoryDialogueMemoryStore — MemoryStorePort 의 dict 구현 (assistant-orchestrator FD DE §2.6).

테스트 대역이자 **DSN 없는 로컬 기동의 실 구현**이다(`TRIPPILOT_VECTOR_DB_URL` 없으면 이것 + WARN,
브리프 §2.1 main.py 행). 프로세스가 죽으면 기억도 사라진다 — 운영은 `PgDialogueMemoryStore`.
FD DE §8: 별도 fake 를 두지 않고 이걸 그대로 쓴다.

의미는 Pg 구현과 동형으로 맞춘다 — 소비 측이 fake 와 실구현 사이에서 동작이 달라지면 안 된다:
`put` 은 upsert + 그 시각(updated_at) 기준 만료 행 정리, `recent_for_account` 는 updated_at DESC·
동점 session_id 사전순(결정론), `delete` 는 셋 중 정확히 하나.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from datetime import datetime, timezone

from trippilot.ports.memory_store_port import DialogueMemory, delete_selector


class InMemoryDialogueMemoryStore:
    def __init__(self, now: Callable[[], datetime] | None = None) -> None:
        self._rows: dict[str, DialogueMemory] = {}  # session_id → 기억
        self._lock = threading.Lock()  # 경계 스레드풀에서 턴이 동시에 들어온다
        # 읽기의 "지금" — Pg 의 now() 자리. 테스트는 고정 시각을 넘긴다(벽시계면 날짜가 지나며 깨진다)
        self._now = now or (lambda: datetime.now(timezone.utc))

    def get(self, session_id: str) -> DialogueMemory | None:
        with self._lock:
            memory = self._rows.get(session_id)
        return memory if memory is not None and memory.expires_at > self._now() else None  # 만료 행은 없는 것과 같다

    def put(self, memory: DialogueMemory) -> None:
        with self._lock:
            self._purge(memory.updated_at)  # TTL 백스톱 — Pg 와 같은 순서(정리 → upsert)
            self._rows[memory.session_id] = memory

    def recent_for_account(
        self, account_ref: str, *, exclude_session: str, limit: int
    ) -> tuple[DialogueMemory, ...]:
        if limit < 1:
            return ()
        with self._lock:
            now = self._now()
            rows = [
                m
                for m in self._rows.values()
                if m.account_ref == account_ref and m.session_id != exclude_session and m.expires_at > now
            ]
        rows.sort(key=lambda m: (-m.updated_at.timestamp(), m.session_id))
        return tuple(rows[:limit])

    def delete(
        self,
        *,
        session_id: str | None = None,
        trip_id: str | None = None,
        account_ref: str | None = None,
    ) -> int:
        field, value = delete_selector(
            session_id=session_id, trip_id=trip_id, account_ref=account_ref
        )  # 위반이면 여기서 ValueError — 상태는 건드리지 않는다
        with self._lock:
            victims = [sid for sid, m in self._rows.items() if getattr(m, field) == value]
            for sid in victims:
                del self._rows[sid]
        return len(victims)

    def purge_expired(self, now: datetime) -> int:
        with self._lock:
            return self._purge(now)

    def _purge(self, now: datetime) -> int:
        victims = [sid for sid, m in self._rows.items() if m.expires_at <= now]
        for sid in victims:
            del self._rows[sid]
        return len(victims)
