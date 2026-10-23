"""PlaceFactStore 구현 2종 — InMemoryPlaceFactStore(로컬·테스트) · PgPlaceFactStore(운영, DML 만). `test_memory_stores.py` 선례.

증명하는 것 (실 DB 0 — Pg 는 fake connection):
  ① InMemory 계약 — put/get 왕복 · 같은 poi_id 는 upsert · 만료 행은 없는 것과 같다(`expires_at > now`, 경계 포함) · 못 찾음(facts None) 행도 저장
  ② Pg — 쓰기 때 만료 행 정리 + upsert(ON CONFLICT (poi_id)) · 읽기는 만료 전 것만 · 못 찾음 행은 facts NULL · 호출마다 connect · DDL 없음
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from trippilot.agents.adapters.memory_place_fact_store import InMemoryPlaceFactStore
from trippilot.agents.adapters.pg_place_fact_store import PgPlaceFactStore
from trippilot.ports.place_fact_store_port import FactRecord, PlaceFacts

_NOW = datetime(2026, 10, 22, 6, 0, tzinfo=timezone.utc)
_WEEK, _DAY = timedelta(days=7), timedelta(days=1)
_FACTS = PlaceFacts(hours="09:00~18:00", last_entry="17:00", closed="매주 화요일", fee="3,000원",
                    source_url="https://royal.khs.go.kr/a", source_host="royal.khs.go.kr")


def test_memory_store_round_trips_upserts_and_hides_expired_rows() -> None:
    store = InMemoryPlaceFactStore()
    assert store.get("p1", _NOW) is None
    store.put(FactRecord("p1", _FACTS, _NOW, _NOW + _WEEK))
    assert store.get("p1", _NOW + _WEEK - timedelta(seconds=1)).facts == _FACTS
    assert store.get("p1", _NOW + _WEEK) is None  # 만료 시각 자체도 없는 것과 같다 — Pg 의 `expires_at > now` 와 같은 경계
    store.put(FactRecord("p1", None, _NOW + _DAY, _NOW + 2 * _DAY))  # 같은 장소를 다시 쓰면 덮는다 — 못 찾음 행도 저장
    stored = store.get("p1", _NOW + _DAY)
    assert stored.facts is None and stored.expires_at == _NOW + 2 * _DAY
    assert store.get("p2", _NOW) is None  # 다른 장소와 섞이지 않는다


class _Cur:
    def __init__(self, conn) -> None:
        self.conn = conn

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params):
        self.conn.log.append((" ".join(sql.split()), params))

    def fetchone(self):
        return self.conn.row


class _Conn:
    def __init__(self, row=None) -> None:
        self.log, self.row = [], row

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def cursor(self):
        return _Cur(self)


def test_pg_store_writes_only_dml_and_reads_back_the_same_facts() -> None:
    conn = _Conn()
    PgPlaceFactStore(lambda: conn).put(FactRecord("p1", _FACTS, _NOW, _NOW + _WEEK))
    (delete, _), (insert, params) = conn.log
    assert delete.startswith("DELETE FROM place_fact_cache WHERE expires_at <=") and "ON CONFLICT (poi_id)" in insert
    doc = json.loads(params[1])
    read = _Conn(row=("p1", doc, _NOW, _NOW + _WEEK))
    assert PgPlaceFactStore(lambda: read).get("p1", _NOW).facts == _FACTS
    assert "expires_at > %s" in read.log[0][0]  # 만료 행은 없는 것과 같다


def test_pg_store_keeps_a_nothing_found_row_as_null() -> None:
    conn = _Conn()
    PgPlaceFactStore(lambda: conn).put(FactRecord("p1", None, _NOW, _NOW + _DAY))
    assert conn.log[1][1][1] is None
    assert PgPlaceFactStore(lambda: _Conn(row=("p1", None, _NOW, _NOW))).get("p1", _NOW).facts is None
