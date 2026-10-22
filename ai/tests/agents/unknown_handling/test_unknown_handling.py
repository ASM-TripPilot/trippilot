"""UnknownHandlingAgent — 먼저 답하고 뒤에서 찾기(2026-10-22 사용자 결정). `run(UnknownTask)` 하나로 찾았음·찾는 중·없음 셋이
갈리고, 저장·중복 제거·하루 상한·실패 미저장·장애 수렴, Pg 저장소 DML. (폴백 문장이 답변 검사를 넘는다는 PBT 는 핸들러 몫 —
`tests/orchestrator/test_web_sentence.py`)"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

import pytest

from trippilot.agents.adapters.memory_place_fact_store import InMemoryPlaceFactStore
from trippilot.agents.adapters.pg_place_fact_store import PgPlaceFactStore
from trippilot.agents.unknown_handling import agent as uh
from trippilot.agents.unknown_handling.agent import UnknownHandlingAgent, UnknownOutcome, UnknownTask
from trippilot.domain.common import TraceId
from trippilot.domain.llm import TypedResult
from trippilot.ports.place_fact_store_port import FactRecord, PlaceFacts

_NOW = datetime(2026, 10, 22, 6, 0, tzinfo=timezone.utc)
_ON = date(2026, 10, 22)
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


def _task(poi_id="p1", place="경복궁 서울 종로구", fields=("hours", "last_entry"), *, now=_NOW, trace="t") -> UnknownTask:
    return UnknownTask(poi_id, place, tuple(fields), _ON, TraceId(trace), now)


def test_run_says_pending_at_once_and_the_next_ask_sees_the_found_value() -> None:
    agent, later, _, worker = _agent(_ok(_FACTS))
    assert agent.run(_task()) == UnknownOutcome(pending=True)
    assert worker.calls == []  # 이번 턴은 찾기를 기다리지 않는다
    later.run()
    assert agent.run(_task(now=_NOW + timedelta(minutes=1))) == UnknownOutcome(facts=_FACTS)
    assert worker.calls == [("경복궁 서울 종로구", ("hours", "last_entry"), _ON)]  # 저장된 값을 돌려줬다 — 다시 찾지 않는다
    assert agent.run(_task(now=_NOW + uh.FOUND_TTL + timedelta(seconds=1))) == UnknownOutcome(pending=True)  # 일주일 뒤 다시 찾는다


def test_the_same_place_is_not_looked_up_twice_while_in_flight() -> None:
    agent, later, _, _ = _agent(_ok(_FACTS))
    assert agent.run(_task(trace="a")).pending
    assert agent.run(_task(trace="b")).pending  # 찾는 중 — "찾는 중"이라 답하는 것이 맞다
    assert len(later.jobs) == 1


def test_nothing_found_is_stored_briefly_and_a_failure_is_not_stored() -> None:
    agent, later, _, _ = _agent(_ok(None))
    agent.run(_task())
    later.run()
    assert agent.run(_task()) == UnknownOutcome() and later.jobs == []  # 못 찾음 — 하루는 다시 찾지 않고 종전대로 "미확인"
    assert agent.run(_task(now=_NOW + uh.MISS_TTL)).pending  # 하루 뒤 다시 찾는다
    failing, later2, _, _ = _agent(TypedResult(value=None, is_fallback=True, error="timeout", call_record=None))
    failing.run(_task("p2", "남산서울타워", ("hours",)))
    later2.run()
    assert failing.run(_task("p2", "남산서울타워", ("hours",), trace="t2")).pending  # 시한·형식·출처 없음은 저장하지 않는다
    assert len(later2.jobs) == 1  # 찾는 중 표시가 풀려 새로 냈다 — 다음에 물으면 다시 찾는다


def test_daily_cap_stops_new_lookups_until_the_next_day(monkeypatch) -> None:
    monkeypatch.setattr(uh, "DAILY_CAP", 2)
    agent, _, _, _ = _agent(_ok(_FACTS))
    assert agent.run(_task("a", "a", ("hours",))).pending and agent.run(_task("b", "b", ("hours",))).pending
    assert agent.run(_task("c", "c", ("hours",))) == UnknownOutcome()  # 상한 — "찾는 중"이라 말하지 않는다
    assert agent.run(_task("c", "c", ("hours",), now=_NOW + timedelta(days=1))).pending


def test_a_broken_store_reads_as_unknown_and_nothing_leaks_out() -> None:
    class _Broken(InMemoryPlaceFactStore):
        def get(self, poi_id, now):
            raise ConnectionError("db down")

        def put(self, record):
            raise ConnectionError("db down")

    later = _Later()
    agent = UnknownHandlingAgent(_Worker(_ok(_FACTS)), _Broken(), submit=later)
    assert agent.run(_task()) == UnknownOutcome(pending=True)  # 저장소 장애는 "없음"과 같다(INV-4) — 그래도 뒤에서 찾기는 낸다
    later.run()  # 저장 실패도 밖으로 새지 않는다 — 사유만 남긴다
    assert agent.run(_task(trace="t2")) == UnknownOutcome(pending=True)  # 찾는 중 표시가 풀려 다시 낼 수 있다


def test_a_refused_submit_is_not_pending() -> None:
    def refuse(fn, *args):
        raise RuntimeError("pool closed")

    agent = UnknownHandlingAgent(_Worker(_ok(_FACTS)), InMemoryPlaceFactStore(), submit=refuse)
    assert agent.run(_task()) == UnknownOutcome()  # 못 냈으면 "찾는 중"이라 말하지 않는다


def test_outcome_cannot_be_found_and_pending_at_once() -> None:
    with pytest.raises(ValueError):
        UnknownOutcome(facts=_FACTS, pending=True)


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
