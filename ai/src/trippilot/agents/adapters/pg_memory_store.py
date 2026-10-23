"""PgDialogueMemoryStore — MemoryStorePort 의 Postgres 실구현 (assistant-orchestrator FD DE §2.6·§4).

`ai_kb` 의 `dialogue_memory` 단일 테이블에 **DML 만** 한다 — DDL 정본은
`ai/docker/vector-init/02-dialogue-memory.sql` + `deploy/eks/bootstrap.sql`(ai_user 는 CREATE 권한이
없다, `PgVectorStore` 와 같은 규칙). 커넥션은 팩토리 주입(psycopg 3 호환 connection, `%s`
플레이스홀더)이고 본 모듈은 어떤 드라이버 패키지도 import 하지 않는다.

의미는 `InMemoryDialogueMemoryStore` 와 동형 — `put` 은 같은 트랜잭션에서 TTL 백스톱
`DELETE … WHERE expires_at <= updated_at` 한 번 + `ON CONFLICT (session_id) DO UPDATE` upsert,
`advance` 는 같은 백스톱 + 있는 행만 `UPDATE`(커질 때만) + 벡터 맞춤(`dialogue_memory_vectors`, 2026-10-23),
`search` 는 기억 행과 조인해 계정·만료·모델·"요약에 지금 있는 줄"을 거른 코사인 상위 k,
`recent_for_account` 는 updated_at DESC·동점 session_id 사전순. 만료 기준을 SQL `now()` 가 아니라
쓰는 기억의 `updated_at` 으로 잡는 것은 시계가 하나(오케스트레이터 주입 clock)여야 테스트가 결정론이기
때문이다 — 둘은 같은 순간이다.

# ponytail: 호출마다 커넥션 열고 닫음 — 턴당 읽기 1·쓰기 ≤1 이라 충분. 풀은 측정 뒤.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from datetime import datetime
from typing import Any

from trippilot.agents.adapters.pgvector_store import _vector_literal
from trippilot.ports.memory_store_port import DialogueMemory, MemoryHit, check_vectors, delete_selector

_TABLE = "dialogue_memory"
_VECTORS = "dialogue_memory_vectors"  # 줄 임베딩 — dialogue_memory 를 따라 지워진다(FK ON DELETE CASCADE, DDL 정본 둘)
_COLUMNS = "session_id, account_ref, trip_id, summary, summarized_turn_index, updated_at, expires_at"


def _summary_lines(raw: object) -> tuple[str, ...]:
    """jsonb 반환 변주 흡수 — psycopg 는 list, 다른 드라이버·fake 는 str 일 수 있다."""
    if isinstance(raw, str):
        raw = json.loads(raw)
    if not isinstance(raw, list):
        raise TypeError(f"summary 타입 해석 불가: {type(raw).__name__}")
    return tuple(raw)


def _prune(cur: Any, memory: DialogueMemory) -> None:
    """요약에 없는 줄의 벡터를 지운다 — 쓰기마다(임베딩이 실패해 새 벡터가 없어도). 안 지우면 요약에서 빠진 줄의 원문이 벡터 행에
    남아 내보내기에는 안 보이는 채 만료까지 남았다(2026-10-23 리뷰 재현)."""
    cur.execute(f"DELETE FROM {_VECTORS} WHERE session_id = %s AND NOT (line = ANY(%s))",
                (memory.session_id, list(memory.summary)))


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
            # 만료 행은 없는 것과 같다 — 정리(put 안의 DELETE)는 쓰기가 있어야 돈다(오케스트레이터 off 동안 무기한 남았다)
            cur.execute(f"SELECT {_COLUMNS} FROM {_TABLE} WHERE session_id = %s AND expires_at > now()", (session_id,))
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
            _prune(cur, memory)

    def advance(
        self, memory: DialogueMemory, vectors: Mapping[str, tuple[float, ...]] | None = None, *, model: str | None = None,
    ) -> bool:
        check_vectors(vectors, model)
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(f"DELETE FROM {_TABLE} WHERE expires_at <= %s", (memory.updated_at,))
            # INSERT 가 아니다 — 행이 없으면(그사이 지워졌다) 0행이고 되살리지 않는다. 커질 때만 — 늦게 끝난 옛 요약이 새 요약을 덮지 않게.
            # 계정·여행은 행을 만들 때 값을 지킨다(COALESCE) — 여행을 지운 직후 trip 없는 스냅샷으로 온 요약 턴이 trip_id 를 비우면
            # `DELETE ?trip_id=` 가 그 행을 놓친다(2026-10-23 리뷰 재현). 세션은 (계정, 여행) 하나에 묶인다
            cur.execute(
                f"UPDATE {_TABLE} SET account_ref = COALESCE(account_ref, %s), trip_id = COALESCE(trip_id, %s), "
                "summary = %s::jsonb, summarized_turn_index = %s, "
                "updated_at = %s, expires_at = %s WHERE session_id = %s AND summarized_turn_index < %s",
                (memory.account_ref, memory.trip_id, json.dumps(list(memory.summary)), memory.summarized_turn_index,
                 memory.updated_at, memory.expires_at, memory.session_id, memory.summarized_turn_index),
            )
            if cur.rowcount != 1:
                return False
            _prune(cur, memory)
            if vectors is not None:
                rows = [(memory.session_id, line, model, _vector_literal(vector))
                        for line, vector in vectors.items() if line in memory.summary]
                if rows:
                    cur.executemany(
                        f"INSERT INTO {_VECTORS} (session_id, line, model, embedding) VALUES (%s, %s, %s, %s::vector) "
                        "ON CONFLICT (session_id, line) DO UPDATE SET model = EXCLUDED.model, embedding = EXCLUDED.embedding",
                        rows,
                    )
        return True

    def search(
        self, vector: tuple[float, ...], *, session_id: str, account_ref: str | None, model: str, top_k: int,
    ) -> tuple[MemoryHit, ...]:
        if top_k < 1:
            return ()
        literal = _vector_literal(vector)
        with self._connect() as conn, conn.cursor() as cur:
            # account_ref 가 None 이면 `= NULL` 이 참이 되지 않아 이 세션만 남는다. `summary ? line` — 요약에 지금 있는 줄만
            # (put 이 요약을 갈아 끼운 행의 옛 줄 벡터가 남아 있어도 걸리지 않는다)
            cur.execute(
                f"SELECT v.session_id, v.line, 1 - (v.embedding <=> %s::vector) AS score FROM {_VECTORS} v "
                f"JOIN {_TABLE} m ON m.session_id = v.session_id "
                "WHERE (m.session_id = %s OR m.account_ref = %s) AND m.expires_at > now() AND v.model = %s "
                "AND m.summary ? v.line "
                "ORDER BY v.embedding <=> %s::vector, v.session_id, v.line LIMIT %s",
                (literal, session_id, account_ref, model, literal, top_k),
            )
            rows = cur.fetchall()
        return tuple(MemoryHit(sid, line, float(score)) for sid, line, score in rows)

    def recent_for_account(
        self, account_ref: str, *, exclude_session: str, limit: int
    ) -> tuple[DialogueMemory, ...]:
        if limit < 1:
            return ()
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                f"SELECT {_COLUMNS} FROM {_TABLE} WHERE account_ref = %s AND session_id <> %s AND expires_at > now() "
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
