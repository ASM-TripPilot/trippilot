"""assistant-orchestrator T008 — MemoryStorePort 구현 2종 (FD DE §2.6·§4).

증명하는 것 (실 DB 0 — Pg 는 psycopg 3 호환 fake connection):
  ① InMemoryDialogueMemoryStore 계약 — put/get 왕복·upsert·recent_for_account(DESC·제외·limit·
     account None 행 제외)·delete 배타(셋 중 정확히 하나, 위반 시 ValueError + 무변경)·멱등·purge
  ② InMemory PBT — 임의 put 열에서 세션당 마지막 put 만 보인다, delete(account_ref) 뒤 그 계정은 비고
     다른 계정은 그대로, purge 는 expires_at ≤ now 인 행만 정확히 지운다
  ③ PgDialogueMemoryStore — SQL 문자열·파라미터(upsert ON CONFLICT (session_id) DO UPDATE · 같은
     커넥션에서 TTL 백스톱 DELETE · ORDER BY updated_at DESC, session_id LIMIT · delete 열 선택 ·
     purge) · 행 → DialogueMemory(jsonb list/str 변주 흡수) · 호출마다 connect · DDL 없음
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.agents.adapters.memory_memory_store import InMemoryDialogueMemoryStore
from trippilot.agents.adapters.pg_memory_store import PgDialogueMemoryStore
from trippilot.orchestrator.dialogue_memory import expires_at_for
from trippilot.ports.memory_store_port import DialogueMemory

_KST = timezone(timedelta(hours=9))
_T0 = datetime(2026, 10, 18, 9, 0, tzinfo=_KST)


def _long_ago() -> datetime:
    """읽기 만료와 무관한 테스트의 "지금" — 모든 행보다 이르다(벽시계면 날짜가 지나며 깨진다)."""
    return _T0 - timedelta(days=3650)


def _memory(session_id: str = "s-1", *, account_ref: str | None = "acct-a", trip_id: str | None = "trip-1",
            summary: tuple[str, ...] = ("제주 2박",), idx: int = 10, at: datetime = _T0,
            ttl_days: int = 90) -> DialogueMemory:
    return DialogueMemory(
        session_id=session_id,
        account_ref=account_ref,
        trip_id=trip_id,
        summary=summary,
        summarized_turn_index=idx,
        updated_at=at,
        expires_at=expires_at_for(at, ttl_days=ttl_days),
    )


# ── ① InMemory 계약 ──────────────────────────────────────────────────────


def test_inmemory_put_get_roundtrip_and_missing_is_none() -> None:
    store = InMemoryDialogueMemoryStore(now=_long_ago)
    assert store.get("s-1") is None
    memory = _memory()
    store.put(memory)
    assert store.get("s-1") == memory


def test_inmemory_put_is_upsert_latest_wins() -> None:
    store = InMemoryDialogueMemoryStore(now=_long_ago)
    store.put(_memory(summary=("첫 요약",), idx=10))
    later = _memory(summary=("둘째 요약",), idx=20, at=_T0 + timedelta(minutes=5))
    store.put(later)
    assert store.get("s-1") == later
    assert store.recent_for_account("acct-a", exclude_session="none", limit=10) == (later,)


def test_inmemory_recent_for_account_orders_desc_excludes_session_and_limits() -> None:
    store = InMemoryDialogueMemoryStore(now=_long_ago)
    old = _memory("s-old", at=_T0 - timedelta(days=3))
    mid = _memory("s-mid", at=_T0 - timedelta(days=1))
    new = _memory("s-new", at=_T0)
    other = _memory("s-other", account_ref="acct-b", at=_T0)
    anon = _memory("s-anon", account_ref=None, at=_T0)
    for m in (old, new, mid, other, anon):
        store.put(m)
    assert store.recent_for_account("acct-a", exclude_session="s-new", limit=10) == (mid, old)
    assert store.recent_for_account("acct-a", exclude_session="s-zzz", limit=2) == (new, mid)
    assert store.recent_for_account("acct-a", exclude_session="s-zzz", limit=0) == ()
    assert store.recent_for_account("acct-c", exclude_session="s-zzz", limit=5) == ()


def test_inmemory_recent_for_account_ties_break_by_session_id() -> None:
    store = InMemoryDialogueMemoryStore(now=_long_ago)
    for sid in ("s-b", "s-a", "s-c"):
        store.put(_memory(sid))  # 같은 updated_at
    got = store.recent_for_account("acct-a", exclude_session="x", limit=3)
    assert [m.session_id for m in got] == ["s-a", "s-b", "s-c"]  # 결정론 — Pg ORDER BY 와 동형


@pytest.mark.parametrize(
    "kwargs",
    [{}, {"session_id": "s-1", "trip_id": "trip-1"}, {"session_id": "s-1", "trip_id": "trip-1", "account_ref": "acct-a"}],
)
def test_inmemory_delete_requires_exactly_one_selector(kwargs: dict) -> None:
    store = InMemoryDialogueMemoryStore(now=_long_ago)
    store.put(_memory())
    with pytest.raises(ValueError, match="정확히 하나"):
        store.delete(**kwargs)
    assert store.get("s-1") is not None  # 위반 호출은 아무것도 지우지 않는다


def test_inmemory_delete_by_each_selector_counts_and_is_idempotent() -> None:
    store = InMemoryDialogueMemoryStore(now=_long_ago)
    store.put(_memory("s-1", trip_id="trip-1"))
    store.put(_memory("s-2", trip_id="trip-1"))
    store.put(_memory("s-3", trip_id="trip-2"))
    store.put(_memory("s-4", account_ref="acct-b", trip_id="trip-3"))
    assert store.delete(session_id="s-3") == 1
    assert store.delete(session_id="s-3") == 0  # 멱등 — 없으면 0
    assert store.delete(trip_id="trip-1") == 2
    assert store.delete(account_ref="acct-a") == 0  # 이미 다 지워짐
    assert store.delete(account_ref="acct-b") == 1
    assert all(store.get(s) is None for s in ("s-1", "s-2", "s-3", "s-4"))


def test_inmemory_purge_expired_removes_only_rows_at_or_before_now() -> None:
    store = InMemoryDialogueMemoryStore(now=_long_ago)
    store.put(_memory("s-dead", at=_T0 - timedelta(days=91)))  # expires = T0 - 1일
    store.put(_memory("s-edge", at=_T0 - timedelta(days=90)))  # expires = T0 정확히 → 만료
    store.put(_memory("s-live", at=_T0 - timedelta(days=89)))  # expires = T0 + 1일
    assert store.purge_expired(_T0) == 2
    assert store.purge_expired(_T0) == 0
    assert store.get("s-dead") is None and store.get("s-edge") is None
    assert store.get("s-live") is not None


def test_inmemory_put_purges_rows_expired_as_of_its_updated_at() -> None:
    """TTL 백스톱 (FD DE §4) — 쓰기마다 만료 행을 같이 치운다. Pg 와 동형."""
    store = InMemoryDialogueMemoryStore(now=_long_ago)
    store.put(_memory("s-dead", at=_T0 - timedelta(days=100)))
    store.put(_memory("s-live", at=_T0 - timedelta(days=1)))
    store.put(_memory("s-now", at=_T0))
    assert store.get("s-dead") is None
    assert store.get("s-live") is not None and store.get("s-now") is not None


# ── ② InMemory PBT ───────────────────────────────────────────────────────

_sids = st.sampled_from([f"s-{i}" for i in range(6)])
_accts = st.sampled_from(["acct-a", "acct-b", None])
_puts = st.lists(
    st.tuples(_sids, _accts, st.integers(min_value=-200, max_value=200)), max_size=20
)


def _apply(puts: list[tuple[str, str | None, int]]) -> tuple[InMemoryDialogueMemoryStore, dict[str, DialogueMemory]]:
    store = InMemoryDialogueMemoryStore(now=_long_ago)
    expected: dict[str, DialogueMemory] = {}
    for sid, acct, offset_days in puts:
        memory = _memory(sid, account_ref=acct, at=_T0 + timedelta(days=offset_days))
        store.put(memory)
        expected[sid] = memory
        # put 의 TTL 백스톱이 치운 행은 기대값에서도 뺀다 (expires_at ≤ 이번 updated_at)
        expected = {s: m for s, m in expected.items() if m.expires_at > memory.updated_at}
    return store, expected


@settings(max_examples=100, deadline=None)
@given(puts=_puts)
def test_inmemory_latest_put_per_session_is_what_get_returns(puts) -> None:
    store, expected = _apply(puts)
    for i in range(6):
        assert store.get(f"s-{i}") == expected.get(f"s-{i}")


@settings(max_examples=100, deadline=None)
@given(puts=_puts, acct=st.sampled_from(["acct-a", "acct-b"]))
def test_inmemory_delete_by_account_empties_that_account_only(puts, acct: str) -> None:
    store, expected = _apply(puts)
    victims = {s for s, m in expected.items() if m.account_ref == acct}
    assert store.delete(account_ref=acct) == len(victims)
    assert store.recent_for_account(acct, exclude_session="none", limit=10) == ()
    for sid, memory in expected.items():
        assert store.get(sid) == (None if sid in victims else memory)


@settings(max_examples=100, deadline=None)
@given(puts=_puts, now_offset=st.integers(min_value=-300, max_value=300))
def test_inmemory_purge_removes_exactly_expired_rows(puts, now_offset: int) -> None:
    store, expected = _apply(puts)
    now = _T0 + timedelta(days=now_offset)
    expired = {s for s, m in expected.items() if m.expires_at <= now}
    assert store.purge_expired(now) == len(expired)
    for sid, memory in expected.items():
        assert store.get(sid) == (None if sid in expired else memory)


@settings(max_examples=60, deadline=None)
@given(puts=_puts, limit=st.integers(min_value=0, max_value=8))
def test_inmemory_recent_for_account_is_sorted_desc_and_capped(puts, limit: int) -> None:
    store, expected = _apply(puts)
    got = store.recent_for_account("acct-a", exclude_session="s-0", limit=limit)
    assert len(got) <= limit
    assert all(m.account_ref == "acct-a" and m.session_id != "s-0" for m in got)
    stamps = [(m.updated_at, m.session_id) for m in got]
    assert stamps == sorted(stamps, key=lambda p: (-p[0].timestamp(), p[1]))
    eligible = [m for m in expected.values() if m.account_ref == "acct-a" and m.session_id != "s-0"]
    assert len(got) == min(limit, len(eligible))


# ── ③ Pg — psycopg 3 호환 fake (with 컨텍스트 + cursor) ──────────────────


class FakeCursor:
    def __init__(self, rows: list, rowcount: int) -> None:
        self.rows = rows
        self.rowcount = rowcount
        self.executed: list[tuple[str, tuple]] = []

    def execute(self, sql: str, params: tuple) -> None:
        self.executed.append((sql, params))

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self) -> list:
        return self.rows

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeConnection:
    def __init__(self, cursor: FakeCursor) -> None:
        self._cursor = cursor

    def cursor(self) -> FakeCursor:
        return self._cursor

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _store(rows: list = (), rowcount: int = 0) -> tuple[PgDialogueMemoryStore, FakeCursor, list[int]]:
    cursor = FakeCursor(list(rows), rowcount)
    opened: list[int] = []

    def connect() -> FakeConnection:
        opened.append(1)
        return FakeConnection(cursor)

    return PgDialogueMemoryStore(connect), cursor, opened


_COLUMNS = "session_id, account_ref, trip_id, summary, summarized_turn_index, updated_at, expires_at"


def _row(memory: DialogueMemory, summary_as: str = "list") -> tuple:
    summary = list(memory.summary) if summary_as == "list" else json.dumps(list(memory.summary))
    return (
        memory.session_id, memory.account_ref, memory.trip_id, summary,
        memory.summarized_turn_index, memory.updated_at, memory.expires_at,
    )


def test_pg_get_selects_by_session_and_maps_row() -> None:
    memory = _memory()
    store, cursor, opened = _store(rows=[_row(memory)])
    assert store.get("s-1") == memory
    sql, params = cursor.executed[0]
    assert sql == f"SELECT {_COLUMNS} FROM dialogue_memory WHERE session_id = %s AND expires_at > now()"
    assert params == ("s-1",)
    assert len(opened) == 1


def test_pg_get_returns_none_without_row_and_absorbs_jsonb_as_str() -> None:
    store, _, _ = _store(rows=[])
    assert store.get("s-missing") is None
    memory = _memory(summary=("한 줄", "두 줄"))
    store, _, _ = _store(rows=[_row(memory, summary_as="str")])
    assert store.get("s-1") == memory


def test_pg_put_upserts_on_session_id_and_purges_in_same_connection() -> None:
    memory = _memory(summary=("제주 2박", "- 사용자: 비 오면?"))
    store, cursor, opened = _store()
    store.put(memory)
    assert len(opened) == 1  # 백스톱 DELETE 와 upsert 가 같은 트랜잭션
    (purge_sql, purge_params), (upsert_sql, upsert_params) = cursor.executed
    assert purge_sql == "DELETE FROM dialogue_memory WHERE expires_at <= %s"
    assert purge_params == (memory.updated_at,)
    assert upsert_sql.startswith(f"INSERT INTO dialogue_memory ({_COLUMNS}) VALUES (%s, %s, %s, %s::jsonb, %s, %s, %s)")
    assert "ON CONFLICT (session_id) DO UPDATE SET" in upsert_sql
    for col in ("account_ref", "trip_id", "summary", "summarized_turn_index", "updated_at", "expires_at"):
        assert f"{col} = EXCLUDED.{col}" in upsert_sql
    assert upsert_params == (
        "s-1", "acct-a", "trip-1", json.dumps(["제주 2박", "- 사용자: 비 오면?"]), 10, memory.updated_at, memory.expires_at,
    )


def test_pg_recent_for_account_orders_desc_then_session_id_with_limit() -> None:
    newer = _memory("s-2", at=_T0)
    older = _memory("s-3", at=_T0 - timedelta(days=1))
    store, cursor, opened = _store(rows=[_row(newer), _row(older)])
    assert store.recent_for_account("acct-a", exclude_session="s-1", limit=2) == (newer, older)
    sql, params = cursor.executed[0]
    assert sql == (
        f"SELECT {_COLUMNS} FROM dialogue_memory WHERE account_ref = %s AND session_id <> %s AND expires_at > now() "
        "ORDER BY updated_at DESC, session_id LIMIT %s"
    )
    assert params == ("acct-a", "s-1", 2)
    assert len(opened) == 1


def test_pg_recent_for_account_limit_below_one_skips_query() -> None:
    store, cursor, opened = _store()
    assert store.recent_for_account("acct-a", exclude_session="s-1", limit=0) == ()
    assert cursor.executed == [] and opened == []


@pytest.mark.parametrize(
    ("kwargs", "column", "value"),
    [
        ({"session_id": "s-1"}, "session_id", "s-1"),
        ({"trip_id": "trip-7"}, "trip_id", "trip-7"),
        ({"account_ref": "acct-z"}, "account_ref", "acct-z"),
    ],
)
def test_pg_delete_targets_selected_column_and_returns_rowcount(kwargs: dict, column: str, value: str) -> None:
    store, cursor, _ = _store(rowcount=3)
    assert store.delete(**kwargs) == 3
    sql, params = cursor.executed[0]
    assert sql == f"DELETE FROM dialogue_memory WHERE {column} = %s"
    assert params == (value,)


@pytest.mark.parametrize("kwargs", [{}, {"session_id": "s-1", "account_ref": "acct-a"}])
def test_pg_delete_rejects_zero_or_many_selectors_before_connecting(kwargs: dict) -> None:
    store, cursor, opened = _store()
    with pytest.raises(ValueError, match="정확히 하나"):
        store.delete(**kwargs)
    assert cursor.executed == [] and opened == []


def test_pg_purge_expired_deletes_at_or_before_now() -> None:
    store, cursor, _ = _store(rowcount=5)
    assert store.purge_expired(_T0) == 5
    assert cursor.executed[0] == ("DELETE FROM dialogue_memory WHERE expires_at <= %s", (_T0,))


def test_pg_adapter_issues_dml_only() -> None:
    """ai_user 는 CREATE 권한이 없다 — DDL 은 vector-init·bootstrap.sql 소유 (FD DE §4)."""
    memory = _memory()
    store, cursor, _ = _store(rows=[_row(memory)], rowcount=1)
    store.get("s-1")
    store.put(memory)
    store.recent_for_account("acct-a", exclude_session="s-1", limit=2)
    store.delete(trip_id="trip-1")
    store.purge_expired(_T0)
    for sql, _ in cursor.executed:
        assert sql.split()[0] in {"SELECT", "INSERT", "DELETE"}


def test_inmemory_reads_treat_expired_rows_as_absent() -> None:
    """만료 행은 없는 것과 같다 — 정리(put 안의 DELETE)는 쓰기가 있어야 돈다. 오케스트레이터가 꺼진 동안 쓰기가 멈추면
    만료 행이 무기한 읽히고 내보내기에도 나왔다(2026-10-18 리뷰 재현). Pg 는 같은 조건을 SQL `expires_at > now()` 로 건다."""
    now = _T0 + timedelta(days=91)
    store = InMemoryDialogueMemoryStore(now=lambda: now)
    store.put(_memory("old", at=_T0))  # 만료 = _T0 + 90일 < now
    store.put(_memory("fresh", at=_T0 + timedelta(days=60)))
    assert store.get("old") is None and store.get("fresh") is not None
    assert [m.session_id for m in store.recent_for_account("acct-a", exclude_session="", limit=5)] == ["fresh"]
