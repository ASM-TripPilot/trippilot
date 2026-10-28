"""InMemoryDialogueMemoryStore — MemoryStorePort 의 dict 구현 (assistant-orchestrator FD DE §2.6).

테스트 대역이자 **DSN 없는 로컬 기동의 실 구현**이다(`TRIPPILOT_VECTOR_DB_URL` 없으면 이것 + WARN,
브리프 §2.1 main.py 행). 프로세스가 죽으면 기억도 사라진다 — 운영은 `PgDialogueMemoryStore`.
FD DE §8: 별도 fake 를 두지 않고 이걸 그대로 쓴다.

의미는 Pg 구현과 동형으로 맞춘다 — 소비 측이 fake 와 실구현 사이에서 동작이 달라지면 안 된다:
`put` 은 upsert + 그 시각(updated_at) 기준 만료 행 정리, `advance` 는 같은 정리 + 있는 행만·커질 때만 + 벡터 맞춤,
`search` 는 계정·만료·모델·"요약에 지금 있는 줄" 거름 뒤 코사인 상위 k(동점 session_id·줄 사전순),
`recent_for_account` 는 updated_at DESC·동점 session_id 사전순(결정론), `delete` 는 셋 중 정확히 하나 —
벡터는 기억 행을 따라 지워진다(Pg 의 ON DELETE CASCADE 자리).
"""

from __future__ import annotations

import math
import threading
from collections.abc import Callable, Mapping
from dataclasses import replace
from datetime import datetime, timezone

from trippilot.ports.memory_store_port import DialogueMemory, MemoryHit, check_vectors, delete_selector


class InMemoryDialogueMemoryStore:
    def __init__(self, now: Callable[[], datetime] | None = None) -> None:
        self._rows: dict[str, DialogueMemory] = {}  # session_id → 기억
        self._vectors: dict[str, dict[str, tuple[str, tuple[float, ...]]]] = {}  # session_id → 줄 → (모델, 벡터)
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
            self._prune(memory)

    def advance(
        self, memory: DialogueMemory, vectors: Mapping[str, tuple[float, ...]] | None = None, *, model: str | None = None,
    ) -> bool:
        check_vectors(vectors, model)
        with self._lock:
            self._purge(memory.updated_at)
            old = self._rows.get(memory.session_id)
            if old is None or old.summarized_turn_index >= memory.summarized_turn_index:
                return False  # 없으면 되살리지 않는다 · 늦게 끝난 옛 요약은 새 요약을 덮지 않는다
            # 계정·여행은 행을 만들 때 값을 지킨다(Pg 의 COALESCE)
            memory = replace(memory, account_ref=old.account_ref or memory.account_ref, trip_id=old.trip_id or memory.trip_id)
            self._rows[memory.session_id] = memory
            self._prune(memory)
            if vectors is not None:
                self._vectors.setdefault(memory.session_id, {}).update(
                    {line: (model, tuple(vec)) for line, vec in vectors.items() if line in memory.summary})
        return True

    def search(
        self, vector: tuple[float, ...], *, session_id: str, account_ref: str | None, model: str, top_k: int,
    ) -> tuple[MemoryHit, ...]:
        if top_k < 1:
            return ()
        with self._lock:
            now = self._now()
            hits = [
                MemoryHit(sid, line, _cosine(vector, vec))
                for sid, m in self._rows.items()
                if m.expires_at > now and (sid == session_id or (account_ref is not None and m.account_ref == account_ref))
                for line, (used, vec) in self._vectors.get(sid, {}).items()
                if used == model and line in m.summary
            ]
        hits.sort(key=lambda h: (-h.score, h.session_id, h.line))
        return tuple(hits[:top_k])

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
                self._vectors.pop(sid, None)
        return len(victims)

    def purge_expired(self, now: datetime) -> int:
        with self._lock:
            return self._purge(now)

    def _prune(self, memory: DialogueMemory) -> None:
        """요약에 없는 줄의 벡터를 지운다 — 쓰기마다(Pg `_prune` 과 같다)."""
        kept = {line: v for line, v in self._vectors.get(memory.session_id, {}).items() if line in memory.summary}
        if kept:
            self._vectors[memory.session_id] = kept
        else:
            self._vectors.pop(memory.session_id, None)

    def _purge(self, now: datetime) -> int:
        victims = [sid for sid, m in self._rows.items() if m.expires_at <= now]
        for sid in victims:
            del self._rows[sid]
            self._vectors.pop(sid, None)
        return len(victims)


def _cosine(a: tuple[float, ...], b: tuple[float, ...]) -> float:
    """pgvector `1 - (a <=> b)` 와 같은 값 — 영벡터는 0."""
    norm = math.sqrt(sum(x * x for x in a) * sum(y * y for y in b))
    return sum(x * y for x, y in zip(a, b, strict=True)) / norm if norm else 0.0
