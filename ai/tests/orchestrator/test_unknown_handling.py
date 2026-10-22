"""UnknownHandlingAgent — 먼저 답하고 뒤에서 찾기(2026-10-22 사용자 결정). 저장·중복 제거·하루 상한·실패 미저장, Pg 저장소 DML."""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

from trippilot.agents.adapters.pg_place_fact_store import PgPlaceFactStore
from trippilot.domain.common import TraceId
from trippilot.domain.llm import TypedResult
from trippilot.orchestrator import unknown_handling as uh
from trippilot.orchestrator.unknown_handling import InMemoryPlaceFactStore, UnknownHandlingAgent
from trippilot.ports.place_fact_store_port import FactRecord, PlaceFacts

_NOW = datetime(2026, 10, 22, 6, 0, tzinfo=timezone.utc)
_FACTS = PlaceFacts(hours="09:00~18:00", last_entry="17:00", closed="매주 화요일", fee="3,000원",
                    source_url="https://royal.khs.go.kr/a", source_host="royal.khs.go.kr")


class _Worker:
    def __init__(self, result: TypedResult) -> None:
        self.result, self.calls = result, []

    def lookup(self, place, fields, on, trace_id, now, *, timeout_sec):
        self.calls.append((place, fields, on))
        return self.result


class _Later:
    """뒤에서 돌 일을 모아 두었다가 테스트가 원할 때 돌린다 — 이번 턴이 기다리지 않는다는 것을 보인다."""

    def __init__(self) -> None:
        self.jobs: list = []

    def __call__(self, fn, *args):
        self.jobs.append((fn, args))

    def run(self) -> None:
        jobs, self.jobs = self.jobs, []
        for fn, args in jobs:
            fn(*args)


def _ok(value) -> TypedResult:
    return TypedResult(value=value, is_fallback=False, error=None, call_record=None)


def _agent(result: TypedResult):
    later, store, worker = _Later(), InMemoryPlaceFactStore(), _Worker(result)
    return UnknownHandlingAgent(worker, store, submit=later), later, store, worker


def test_request_returns_at_once_and_the_next_ask_sees_the_found_value() -> None:
    agent, later, _, worker = _agent(_ok(_FACTS))
    assert agent.known("p1", _NOW) is None
    assert agent.request("p1", "경복궁 서울 종로구", ("hours", "last_entry"), date(2026, 10, 22), TraceId("t"), _NOW)
    assert worker.calls == []  # 이번 턴은 찾기를 기다리지 않는다
    later.run()
    stored = agent.known("p1", _NOW + timedelta(minutes=1))
    assert stored.facts == _FACTS and stored.expires_at == _NOW + uh.FOUND_TTL
    assert agent.known("p1", _NOW + uh.FOUND_TTL + timedelta(seconds=1)) is None  # 일주일 뒤 다시 찾는다


def test_the_same_place_is_not_looked_up_twice_while_in_flight() -> None:
    agent, later, _, _ = _agent(_ok(_FACTS))
    on = date(2026, 10, 22)
    assert agent.request("p1", "경복궁", ("hours",), on, TraceId("a"), _NOW)
    assert agent.request("p1", "경복궁", ("hours",), on, TraceId("b"), _NOW)  # 찾는 중 — "찾는 중"이라 답해도 맞다
    assert len(later.jobs) == 1


def test_nothing_found_is_stored_briefly_and_a_failure_is_not_stored() -> None:
    agent, later, _, _ = _agent(_ok(None))
    agent.request("p1", "경복궁", ("hours",), date(2026, 10, 22), TraceId("t"), _NOW)
    later.run()
    assert agent.known("p1", _NOW).facts is None  # 못 찾음 — 하루는 다시 찾지 않는다
    assert agent.known("p1", _NOW + uh.MISS_TTL) is None
    failing, later2, _, _ = _agent(TypedResult(value=None, is_fallback=True, error="timeout", call_record=None))
    failing.request("p2", "남산서울타워", ("hours",), date(2026, 10, 22), TraceId("t"), _NOW)
    later2.run()
    assert failing.known("p2", _NOW) is None  # 시한·형식·출처 없음은 저장하지 않는다 — 다음에 물으면 다시 찾는다
    assert failing.request("p2", "남산서울타워", ("hours",), date(2026, 10, 22), TraceId("t2"), _NOW)  # 찾는 중 표시도 풀렸다


def test_daily_cap_stops_new_lookups_until_the_next_day(monkeypatch) -> None:
    monkeypatch.setattr(uh, "DAILY_CAP", 2)
    agent, later, _, _ = _agent(_ok(_FACTS))
    on = date(2026, 10, 22)
    assert agent.request("a", "a", ("hours",), on, TraceId("t"), _NOW) and agent.request("b", "b", ("hours",), on, TraceId("t"), _NOW)
    assert not agent.request("c", "c", ("hours",), on, TraceId("t"), _NOW)  # 상한 — "찾는 중"이라 말하지 않는다
    assert agent.request("c", "c", ("hours",), on, TraceId("t"), _NOW + timedelta(days=1))


def test_a_broken_store_reads_as_unknown() -> None:
    class _Broken(InMemoryPlaceFactStore):
        def get(self, poi_id, now):
            raise ConnectionError("db down")

    agent = UnknownHandlingAgent(_Worker(_ok(_FACTS)), _Broken(), submit=_Later())
    assert agent.known("p1", _NOW) is None


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
    PgPlaceFactStore(lambda: conn).put(FactRecord("p1", _FACTS, _NOW, _NOW + uh.FOUND_TTL))
    (delete, _), (insert, params) = conn.log
    assert delete.startswith("DELETE FROM place_fact_cache WHERE expires_at <=") and "ON CONFLICT (poi_id)" in insert
    doc = json.loads(params[1])
    read = _Conn(row=("p1", doc, _NOW, _NOW + uh.FOUND_TTL))
    assert PgPlaceFactStore(lambda: read).get("p1", _NOW).facts == _FACTS
    assert "expires_at > %s" in read.log[0][0]  # 만료 행은 없는 것과 같다


def test_pg_store_keeps_a_nothing_found_row_as_null() -> None:
    conn = _Conn()
    PgPlaceFactStore(lambda: conn).put(FactRecord("p1", None, _NOW, _NOW + uh.MISS_TTL))
    assert conn.log[1][1][1] is None
    assert PgPlaceFactStore(lambda: _Conn(row=("p1", None, _NOW, _NOW))).get("p1", _NOW).facts is None
