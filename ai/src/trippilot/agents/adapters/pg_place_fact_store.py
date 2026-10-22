"""PgPlaceFactStore — UnknownHandlingAgent 저장소의 Postgres 실구현(ai_kb `place_fact_cache`).

`PgDialogueMemoryStore` 와 같은 규칙: **DML 만** 한다 — DDL 정본은 `ai/docker/vector-init/03-place-fact-cache.sql` +
`deploy/eks/bootstrap.sql`(ai_user 는 CREATE 권한이 없다). 커넥션은 팩토리 주입이고 드라이버 패키지를 import 하지 않는다.
만료 행 정리는 쓰기 때 같은 트랜잭션에서 한 번(백스톱) — 읽기는 만료 전 것만 본다.

# ponytail: 호출마다 커넥션 열고 닫음 — 장소 정보 질문 1회에 읽기 1·(뒤에서) 쓰기 ≤1 이라 충분.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import datetime
from typing import Any

from trippilot.ports.place_fact_store_port import FIELDS, FactRecord, PlaceFacts

_TABLE = "place_fact_cache"


def _facts(raw: object) -> PlaceFacts | None:
    if raw is None:
        return None
    data = json.loads(raw) if isinstance(raw, str) else raw
    return PlaceFacts(**{f: data.get(f) for f in FIELDS}, source_url=data["source_url"], source_host=data["source_host"])


class PgPlaceFactStore:
    """PlaceFactStore Protocol 만족. `connect` 는 psycopg 3 호환 connection 팩토리."""

    def __init__(self, connect: Callable[[], Any]) -> None:
        self._connect = connect

    def get(self, poi_id: str, now: datetime) -> FactRecord | None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(f"SELECT poi_id, facts, fetched_at, expires_at FROM {_TABLE} WHERE poi_id = %s AND expires_at > %s",
                        (poi_id, now))
            row = cur.fetchone()
        return FactRecord(row[0], _facts(row[1]), row[2], row[3]) if row else None

    def put(self, record: FactRecord) -> None:
        f = record.facts
        doc = None if f is None else json.dumps({**{k: getattr(f, k) for k in FIELDS}, "source_url": f.source_url,
                                                 "source_host": f.source_host}, ensure_ascii=False)
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(f"DELETE FROM {_TABLE} WHERE expires_at <= %s", (record.fetched_at,))
            cur.execute(
                f"INSERT INTO {_TABLE} (poi_id, facts, fetched_at, expires_at) VALUES (%s, %s::jsonb, %s, %s) "
                "ON CONFLICT (poi_id) DO UPDATE SET facts = EXCLUDED.facts, fetched_at = EXCLUDED.fetched_at, "
                "expires_at = EXCLUDED.expires_at",
                (record.poi_id, doc, record.fetched_at, record.expires_at))
