"""assistant-orchestrator T008 — MemoryStorePort 구현 2종 (FD DE §2.6·§4).

증명하는 것 (실 DB 0 — Pg 는 psycopg 3 호환 fake connection):
  ① InMemoryDialogueMemoryStore 계약 — put/get 왕복·upsert·recent_for_account(DESC·제외·limit·
     account None 행 제외)·delete 배타(셋 중 정확히 하나, 위반 시 ValueError + 무변경)·멱등·purge
  ② InMemory PBT — 임의 put 열에서 세션당 마지막 put 만 보인다, delete(account_ref) 뒤 그 계정은 비고
     다른 계정은 그대로, purge 는 expires_at ≤ now 인 행만 정확히 지운다
  ③ PgDialogueMemoryStore — SQL 문자열·파라미터(upsert ON CONFLICT (session_id) DO UPDATE · 같은
     커넥션에서 TTL 백스톱 DELETE · ORDER BY updated_at DESC, session_id LIMIT · delete 열 선택 ·
     purge) · 행 → DialogueMemory(jsonb list/str 변주 흡수) · 호출마다 connect · DDL 없음
  ④ 기억 줄 벡터(2026-10-23) — `advance` 는 있는 행만·커질 때만 고치고(지워진 대화를 되살리지 않는다) 벡터를 새 요약에
     맞춘다 · `search` 는 이 세션 + 같은 계정만, 만료·다른 모델·요약에서 빠진 줄은 안 나온다 · 지우기·만료는 벡터도 지운다
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
from trippilot.ports.memory_store_port import DialogueMemory, MemoryHit

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

    def executemany(self, sql: str, seq: list) -> None:
        self.executed.append((sql, tuple(seq)))

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
    (purge_sql, purge_params), (upsert_sql, upsert_params), (prune_sql, prune_params) = cursor.executed
    assert prune_sql == "DELETE FROM dialogue_memory_vectors WHERE session_id = %s AND NOT (line = ANY(%s))"  # 요약에 없는 줄 벡터
    assert prune_params == ("s-1", ["제주 2박", "- 사용자: 비 오면?"])
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
    vector_store, vector_cursor, _ = _store(rowcount=1)  # 벡터 쪽 — 검색 행 모양이 달라 커서를 따로 둔다
    vector_store.advance(_memory(idx=11), {"제주 2박": (1.0, 0.0)}, model="m")
    vector_store.search((1.0, 0.0), session_id="s-1", account_ref="acct-a", model="m", top_k=3)
    for sql, _ in cursor.executed + vector_cursor.executed:
        assert sql.split()[0] in {"SELECT", "INSERT", "UPDATE", "DELETE"}


def test_inmemory_reads_treat_expired_rows_as_absent() -> None:
    """만료 행은 없는 것과 같다 — 정리(put 안의 DELETE)는 쓰기가 있어야 돈다. 오케스트레이터가 꺼진 동안 쓰기가 멈추면
    만료 행이 무기한 읽히고 내보내기에도 나왔다(2026-10-18 리뷰 재현). Pg 는 같은 조건을 SQL `expires_at > now()` 로 건다."""
    now = _T0 + timedelta(days=91)
    store = InMemoryDialogueMemoryStore(now=lambda: now)
    store.put(_memory("old", at=_T0))  # 만료 = _T0 + 90일 < now
    store.put(_memory("fresh", at=_T0 + timedelta(days=60)))
    assert store.get("old") is None and store.get("fresh") is not None
    assert [m.session_id for m in store.recent_for_account("acct-a", exclude_session="", limit=5)] == ["fresh"]


# ── ④ 기억 줄 벡터 (2026-10-23) ─────────────────────────────────────────

_NEAR, _MID, _FAR = (1.0, 0.0, 0.0), (0.8, 0.6, 0.0), (0.0, 0.0, 1.0)


def _seeded() -> InMemoryDialogueMemoryStore:
    """s-1·s-2 = acct-a, s-9 = acct-b. 줄마다 벡터를 둔다(advance 로)."""
    store = InMemoryDialogueMemoryStore(now=_long_ago)
    for sid, acct, lines in (("s-1", "acct-a", ("선호: 카페", "요약: 부산 2박")), ("s-2", "acct-a", ("제약: 아이 동반",)),
                             ("s-9", "acct-b", ("선호: 남의 줄",))):
        store.put(_memory(sid, account_ref=acct, summary=(), idx=0))
        vectors = {line: (_NEAR if "카페" in line or "남의" in line else _MID if "아이" in line else _FAR) for line in lines}
        assert store.advance(_memory(sid, account_ref=acct, summary=lines, idx=3), vectors, model="m")
    return store


def test_inmemory_advance_updates_only_an_existing_row_with_a_larger_index() -> None:
    store = InMemoryDialogueMemoryStore(now=_long_ago)
    assert store.advance(_memory(idx=3)) is False and store.get("s-1") is None  # 없으면 되살리지 않는다(그사이 지워졌다)
    store.put(_memory(summary=(), idx=0))
    newer = _memory(summary=("선호: 카페",), idx=6)
    assert store.advance(newer) is True and store.get("s-1") == newer
    assert store.advance(_memory(summary=("선호: 옛 요약",), idx=3)) is False  # 늦게 끝난 옛 요약은 새 요약을 덮지 않는다
    assert store.advance(_memory(summary=("선호: 같은 차례",), idx=6)) is False
    assert store.get("s-1") == newer


def test_inmemory_search_is_scoped_to_the_session_and_its_account_and_ordered() -> None:
    store = _seeded()
    hits = store.search(_NEAR, session_id="s-1", account_ref="acct-a", model="m", top_k=10)
    assert [(h.session_id, h.line) for h in hits] == [("s-1", "선호: 카페"), ("s-2", "제약: 아이 동반"), ("s-1", "요약: 부산 2박")]
    assert hits[0].score == pytest.approx(1.0) and hits[1].score == pytest.approx(0.8) and hits[2].score == pytest.approx(0.0)
    assert all(h.session_id != "s-9" for h in hits)  # 남의 계정은 안 나온다
    only_mine = store.search(_NEAR, session_id="s-1", account_ref=None, model="m", top_k=10)
    assert {h.session_id for h in only_mine} == {"s-1"}  # account_ref 가 없으면 이 세션만
    assert store.search(_NEAR, session_id="s-1", account_ref="acct-a", model="m", top_k=1) == (hits[0],)
    assert store.search(_NEAR, session_id="s-1", account_ref="acct-a", model="other-model", top_k=10) == ()
    assert store.search(_NEAR, session_id="s-1", account_ref="acct-a", model="m", top_k=0) == ()


def test_inmemory_search_never_returns_a_line_that_left_the_summary() -> None:
    store = _seeded()
    assert store.advance(_memory("s-1", summary=("선호: 바다",), idx=6), {"선호: 바다": _FAR}, model="m")
    lines = {h.line for h in store.search(_NEAR, session_id="s-1", account_ref=None, model="m", top_k=10)}
    assert lines == {"선호: 바다"}
    store.put(_memory("s-1", summary=("결정: 새 줄",), idx=7))  # put 은 벡터를 손대지 않는다 — 옛 줄 벡터가 남아도 안 걸린다
    assert store.search(_NEAR, session_id="s-1", account_ref=None, model="m", top_k=10) == ()


def test_inmemory_advance_without_vectors_keeps_them_and_vectors_need_a_model() -> None:
    store = _seeded()
    assert store.advance(_memory("s-1", summary=("선호: 카페",), idx=6))  # vectors=None — 벡터는 그대로(줄이 남은 것만 걸린다)
    assert [h.line for h in store.search(_NEAR, session_id="s-1", account_ref=None, model="m", top_k=5)] == ["선호: 카페"]
    with pytest.raises(ValueError, match="model"):
        store.advance(_memory("s-1", summary=("선호: 카페",), idx=9), {"선호: 카페": _NEAR})


def test_inmemory_delete_and_expiry_take_the_vectors_with_them() -> None:
    """파기 3호출·TTL 이 벡터에도 걸린다(Pg 는 FK ON DELETE CASCADE) — 지운 대화의 줄이 다른 대화의 꺼내기로 나오면 안 된다."""
    store = _seeded()
    assert store.delete(session_id="s-2") == 1
    assert all(h.session_id != "s-2" for h in store.search(_MID, session_id="s-1", account_ref="acct-a", model="m", top_k=10))
    store.delete(account_ref="acct-a")
    assert store.search(_NEAR, session_id="s-1", account_ref="acct-a", model="m", top_k=10) == ()
    store = _seeded()
    store.purge_expired(_T0 + timedelta(days=365))
    assert store.search(_NEAR, session_id="s-9", account_ref="acct-b", model="m", top_k=10) == ()
    store = _seeded()
    store._now = lambda: _T0 + timedelta(days=365)  # 읽기의 "지금"이 만료 뒤 — 정리 전이라도 안 나온다
    assert store.search(_NEAR, session_id="s-1", account_ref="acct-a", model="m", top_k=10) == ()


@settings(max_examples=60, deadline=None)
@given(vectors=st.lists(st.tuples(st.floats(-1, 1), st.floats(-1, 1)), min_size=1, max_size=6),
       query=st.tuples(st.floats(-1, 1), st.floats(-1, 1)), top_k=st.integers(1, 8))
def test_pbt_inmemory_search_hits_are_summary_lines_sorted_and_capped(vectors, query, top_k: int) -> None:
    store = InMemoryDialogueMemoryStore(now=_long_ago)
    lines = tuple(f"선호: 줄 {i}" for i in range(len(vectors)))
    store.put(_memory(summary=(), idx=0))
    store.advance(_memory(summary=lines, idx=3), dict(zip(lines, vectors, strict=True)), model="m")
    hits = store.search(query, session_id="s-1", account_ref=None, model="m", top_k=top_k)
    assert len(hits) == min(top_k, len(lines)) and {h.line for h in hits} <= set(lines)
    keys = [(-h.score, h.session_id, h.line) for h in hits]
    assert keys == sorted(keys)


def test_pg_advance_updates_only_an_existing_row_and_syncs_vectors_in_one_connection() -> None:
    memory = _memory(summary=("선호: 카페", "요약: 부산 2박"), idx=6)
    store, cursor, opened = _store(rowcount=1)
    assert store.advance(memory, {"선호: 카페": (0.5, 0.25), "제외: 요약에 없는 줄": (1.0, 0.0)}, model="kure") is True
    assert len(opened) == 1
    (purge_sql, _), (update_sql, update_params), (drop_sql, drop_params), (insert_sql, insert_rows) = cursor.executed
    assert purge_sql == "DELETE FROM dialogue_memory WHERE expires_at <= %s"
    assert update_sql.startswith("UPDATE dialogue_memory SET ")  # INSERT 가 아니다 — 지워진 행을 되살리지 않는다
    # 계정·여행은 행을 만들 때 값을 지킨다 — 여행 삭제 직후 trip 없는 스냅샷 턴이 trip_id 를 비우면 ?trip_id= 파기가 놓친다
    assert "account_ref = COALESCE(account_ref, %s), trip_id = COALESCE(trip_id, %s)" in update_sql
    assert update_sql.endswith("WHERE session_id = %s AND summarized_turn_index < %s")
    assert update_params == ("acct-a", "trip-1", json.dumps(["선호: 카페", "요약: 부산 2박"]), 6, memory.updated_at,
                             memory.expires_at, "s-1", 6)
    assert drop_sql == "DELETE FROM dialogue_memory_vectors WHERE session_id = %s AND NOT (line = ANY(%s))"
    assert drop_params == ("s-1", ["선호: 카페", "요약: 부산 2박"])
    assert "ON CONFLICT (session_id, line) DO UPDATE SET model = EXCLUDED.model, embedding = EXCLUDED.embedding" in insert_sql
    assert insert_rows == (("s-1", "선호: 카페", "kure", "[0.5,0.25]"),)  # 요약에 없는 줄은 넣지 않는다


def test_pg_advance_on_a_missing_row_touches_no_vectors_and_without_vectors_still_prunes() -> None:
    store, cursor, _ = _store(rowcount=0)
    assert store.advance(_memory(), {"제주 2박": (1.0,)}, model="m") is False
    assert [sql.split()[0] for sql, _ in cursor.executed] == ["DELETE", "UPDATE"]
    store, cursor, _ = _store(rowcount=1)
    assert store.advance(_memory()) is True  # 임베딩 실패·미배선 — 새 벡터는 없어도 요약에서 빠진 줄 벡터는 지운다(리뷰 재현)
    assert [sql.split()[0] for sql, _ in cursor.executed] == ["DELETE", "UPDATE", "DELETE"]
    assert cursor.executed[2][0].startswith("DELETE FROM dialogue_memory_vectors")


def test_pg_search_joins_memory_rows_for_scope_expiry_model_and_current_lines() -> None:
    store, cursor, opened = _store(rows=[("s-1", "선호: 카페", 0.91), ("s-2", "제약: 아이 동반", 0.5)])
    hits = store.search((0.5, 0.25), session_id="s-1", account_ref="acct-a", model="kure", top_k=4)
    assert hits == (MemoryHit("s-1", "선호: 카페", 0.91), MemoryHit("s-2", "제약: 아이 동반", 0.5))
    sql, params = cursor.executed[0]
    assert "FROM dialogue_memory_vectors v JOIN dialogue_memory m ON m.session_id = v.session_id" in sql
    assert "WHERE (m.session_id = %s OR m.account_ref = %s) AND m.expires_at > now() AND v.model = %s" in sql
    assert "AND m.summary ? v.line" in sql  # 요약에 지금 있는 줄만
    assert sql.endswith("ORDER BY v.embedding <=> %s::vector, v.session_id, v.line LIMIT %s")
    assert params == ("[0.5,0.25]", "s-1", "acct-a", "kure", "[0.5,0.25]", 4)
    assert len(opened) == 1
    store, cursor, opened = _store()
    assert store.search((1.0,), session_id="s-1", account_ref=None, model="m", top_k=0) == () and opened == []


def test_inmemory_every_write_drops_vectors_of_lines_that_left_the_summary() -> None:
    """임베딩이 실패해 새 벡터 없이 저장돼도(vectors=None) 요약에서 빠진 줄의 벡터(원문 줄 칸 포함)는 남지 않는다 — 내보내기에는 안
    보이는 개인정보를 만료까지 들고 있게 된다(2026-10-23 리뷰 재현). put 도 같다."""
    store = _seeded()
    assert store.advance(_memory("s-1", summary=("선호: 카페",), idx=6))  # 요약 LLM 이 "요약: 부산 2박"을 뺐다 · 임베딩 실패
    assert set(store._vectors["s-1"]) == {"선호: 카페"}  # 남은 줄의 기존 벡터는 그대로
    store.put(_memory("s-1", summary=("결정: 새 줄",), idx=7))
    assert "s-1" not in store._vectors


def test_inmemory_advance_keeps_the_account_and_trip_the_row_was_made_with() -> None:
    store = InMemoryDialogueMemoryStore(now=_long_ago)
    store.put(_memory(summary=(), idx=0, trip_id="trip-1"))
    assert store.advance(_memory(summary=("선호: 카페",), idx=3, trip_id=None, account_ref=None))  # 여행 삭제 직후 trip 없는 스냅샷
    kept = store.get("s-1")
    assert (kept.trip_id, kept.account_ref, kept.summary) == ("trip-1", "acct-a", ("선호: 카페",))
    assert store.delete(trip_id="trip-1") == 1  # 여행 삭제 파기가 놓치지 않는다

