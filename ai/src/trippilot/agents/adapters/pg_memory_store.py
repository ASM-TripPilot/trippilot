"""PgDialogueMemoryStore — MemoryStorePort 의 Postgres 실구현 (assistant-orchestrator FD DE §2.6·§4).

`ai_kb` 의 `dialogue_memory` 단일 테이블에 **DML 만** 한다 — DDL 정본은
`ai/docker/vector-init/02-dialogue-memory.sql` + `deploy/eks/bootstrap.sql`(ai_user 는 CREATE 권한이
없다, `PgVectorStore` 와 같은 규칙). 커넥션은 팩토리 주입(psycopg 3 호환 connection, `%s`
플레이스홀더)이고 본 모듈은 어떤 드라이버 패키지도 import 하지 않는다.

의미는 `InMemoryDialogueMemoryStore` 와 동형 — `put` 은 같은 트랜잭션에서 TTL 백스톱
`DELETE … WHERE expires_at <= updated_at` 한 번 + `ON CONFLICT (session_id) DO UPDATE` upsert,
`recent_for_account` 는 updated_at DESC·동점 session_id 사전순. 만료 기준을 SQL `now()` 가 아니라
쓰는 기억의 `updated_at` 으로 잡는 것은 시계가 하나(오케스트레이터 주입 clock)여야 테스트가 결정론이기
때문이다 — 둘은 같은 순간이다.

# ponytail: 호출마다 커넥션 열고 닫음 — 턴당 읽기 1·쓰기 ≤1 이라 충분. 풀은 측정 뒤.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import datetime
from typing import Any

from trippilot.ports.memory_store_port import DialogueMemory, delete_selector

_TABLE = "dialogue_memory"
_COLUMNS = "session_id, account_ref, trip_id, summary, summarized_turn_index, updated_at, expires_at"


def _summary_lines(raw: object) -> tuple[str, ...]:
    """jsonb 반환 변주 흡수 — psycopg 는 list, 다른 드라이버·fake 는 str 일 수 있다."""
    if isinstance(raw, str):
        raw = json.loads(raw)
    if not isinstance(raw, list):
        raise TypeError(f"summary 타입 해석 불가: {type(raw).__name__}")
    return tuple(raw)


def _to_memory(row: tuple) -> DialogueMemory:
    session_id, account_ref, trip_id, summary, summarized_turn_index, updated_at, expires_at = row
    return DialogueMemory(
        session_id=session_id,
        account_ref=account_ref,
        trip_id=trip_id,
        summary=_summary_lines(summary),
        summarized_turn_index=summarized_turn_index,
        updated_at=updated_at,
        expires_at=expires_at,
    )


class PgDialogueMemoryStore:
    """MemoryStorePort Protocol 만족. `connect` 는 psycopg 3 호환 connection 팩토리."""

    def __init__(self, connect: Callable[[], Any]) -> None:
        self._connect = connect

    def get(self, session_id: str) -> DialogueMemory | None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(f"SELECT {_COLUMNS} FROM {_TABLE} WHERE session_id = %s", (session_id,))
            row = cur.fetchone()
        return _to_memory(row) if row else None

    def put(self, memory: DialogueMemory) -> None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(f"DELETE FROM {_TABLE} WHERE expires_at <= %s", (memory.updated_at,))
            cur.execute(
                f"INSERT INTO {_TABLE} ({_COLUMNS}) VALUES (%s, %s, %s, %s::jsonb, %s, %s, %s) "
                "ON CONFLICT (session_id) DO UPDATE SET "
                "account_ref = EXCLUDED.account_ref, trip_id = EXCLUDED.trip_id, "
                "summary = EXCLUDED.summary, summarized_turn_index = EXCLUDED.summarized_turn_index, "
                "updated_at = EXCLUDED.updated_at, expires_at = EXCLUDED.expires_at",
                (
                    memory.session_id,
                    memory.account_ref,
                    memory.trip_id,
                    json.dumps(list(memory.summary)),
                    memory.summarized_turn_index,
                    memory.updated_at,
                    memory.expires_at,
                ),
            )

    def recent_for_account(
        self, account_ref: str, *, exclude_session: str, limit: int
    ) -> tuple[DialogueMemory, ...]:
        if limit < 1:
            return ()
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                f"SELECT {_COLUMNS} FROM {_TABLE} WHERE account_ref = %s AND session_id <> %s "
                "ORDER BY updated_at DESC, session_id LIMIT %s",
                (account_ref, exclude_session, limit),
            )
            rows = cur.fetchall()
        return tuple(_to_memory(row) for row in rows)

    def delete(
        self,
        *,
        session_id: str | None = None,
        trip_id: str | None = None,
        account_ref: str | None = None,
    ) -> int:
        column, value = delete_selector(
            session_id=session_id, trip_id=trip_id, account_ref=account_ref
        )  # column 은 고정 셋에서 나온 이름 — 사용자 입력이 SQL 에 들어가지 않는다
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(f"DELETE FROM {_TABLE} WHERE {column} = %s", (value,))
            return cur.rowcount

    def purge_expired(self, now: datetime) -> int:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(f"DELETE FROM {_TABLE} WHERE expires_at <= %s", (now,))
            return cur.rowcount
