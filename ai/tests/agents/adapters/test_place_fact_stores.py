"""PlaceFactStore 구현 2종 — InMemoryPlaceFactStore(로컬·테스트) · PgPlaceFactStore(운영, DML 만). `test_memory_stores.py` 선례.

증명하는 것 (실 DB 0 — Pg 는 fake connection):
  ① InMemory 계약 — put/get 왕복 · 같은 poi_id 는 upsert · 다시 찾을 때(`expires_at`)가 지나도 기록을 돌려준다(쌓기, 2026-11-08) ·
     못 찾음(facts None) 행도 저장
  ② Pg — upsert(ON CONFLICT (poi_id)) 만 · 지우지 않는다 · 읽기는 만료와 무관하게 마지막 기록 · 찾아본 칸(searched)도 왕복 — 못 찾음 행은
     {searched} 만, 2026-10-30 전 행(NULL·searched 없음)은 찾아본 칸 모름(빈 값) · 호출마다 connect · DDL 없음
"""

from __future__ import annotations

import json
from dataclasses import replace
from datetime import datetime, timedelta, timezone

from trippilot.agents.adapters.memory_place_fact_store import InMemoryPlaceFactStore
from trippilot.agents.adapters.pg_place_fact_store import PgPlaceFactStore
from trippilot.ports.place_fact_store_port import FactRecord, PlaceFacts

_NOW = datetime(2026, 10, 22, 6, 0, tzinfo=timezone.utc)
_WEEK, _DAY = timedelta(days=7), timedelta(days=1)
_FACTS = PlaceFacts(hours="09:00~18:00", last_entry="17:00", closed="매주 화요일", fee="3,000원",
                    source_url="https://royal.khs.go.kr/a", source_host="royal.khs.go.kr")


def test_memory_store_round_trips_upserts_and_keeps_records_past_their_refresh_time() -> None:
    store = InMemoryPlaceFactStore()
    assert store.get("p1", _NOW) is None
    store.put(FactRecord("p1", _FACTS, _NOW, _NOW + _WEEK))
    assert store.get("p1", _NOW + _WEEK - timedelta(seconds=1)).facts == _FACTS
    assert store.get("p1", _NOW + 30 * _WEEK).facts == _FACTS  # 다시 찾을 때가 지나도 쌓아 둔 기록 — 묵었는지는 에이전트가 가른다
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


def test_pg_store_writes_only_dml_and_reads_back_the_same_record() -> None:
    conn, record = _Conn(), FactRecord("p1", _FACTS, _NOW, _NOW + _WEEK, ("hours", "last_entry"))
    PgPlaceFactStore(lambda: conn).put(record)
    ((insert, params),) = conn.log  # 쓰기는 upsert 한 문장뿐 — 지우지 않고 쌓는다(2026-11-08)
    assert insert.startswith("INSERT INTO place_fact_cache") and "ON CONFLICT (poi_id)" in insert
    doc = json.loads(params[1])
    read = _Conn(row=("p1", doc, _NOW, _NOW + _WEEK))
    assert PgPlaceFactStore(lambda: read).get("p1", _NOW) == record  # 찾아본 칸까지 그대로
    assert "expires_at" not in read.log[0][0].split("WHERE", 1)[1]  # 읽기는 만료로 거르지 않는다 — 묵었는지는 에이전트가 가른다
    old = {k: v for k, v in doc.items() if k != "searched"}  # 2026-10-30 전 행 — 찾아본 칸을 몰라 빈 값(값 있는 칸은 에이전트가 안다)
    assert PgPlaceFactStore(lambda: _Conn(row=("p1", old, _NOW, _NOW + _WEEK))).get("p1", _NOW) == replace(record, searched=())


def test_pg_store_keeps_what_a_miss_looked_up_and_reads_an_old_null_row_as_a_miss() -> None:
    conn, miss = _Conn(), FactRecord("p1", None, _NOW, _NOW + _DAY, ("fee",))
    PgPlaceFactStore(lambda: conn).put(miss)
    doc = json.loads(conn.log[0][1][1])
    assert doc == {"searched": ["fee"]}  # 출처 있는 값이 없어도 찾아본 칸은 남긴다 — 안 찾아본 칸 물음까지 하루 막지 않게
    assert PgPlaceFactStore(lambda: _Conn(row=("p1", doc, _NOW, _NOW + _DAY))).get("p1", _NOW) == miss
    old = PgPlaceFactStore(lambda: _Conn(row=("p1", None, _NOW, _NOW + _DAY))).get("p1", _NOW)  # 2026-10-30 전 못 찾음 행
    assert old.facts is None and old.searched == ()
