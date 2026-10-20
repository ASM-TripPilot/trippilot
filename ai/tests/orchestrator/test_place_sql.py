"""PlaceSqlLookup — LLM 폴백·DB 오류는 None(반경 탐색으로), 같은 조건의 SQL 은 캐시(행은 매번 DB)."""

from __future__ import annotations

from datetime import datetime, timezone

from trippilot.domain.common import TraceId
from trippilot.domain.llm import TypedResult
from trippilot.orchestrator import place_sql as ps
from trippilot.orchestrator.place_sql import PlaceSqlLookup
from trippilot.poi_curation.adapters.pg_place_sql import PlaceRow

_NOW = datetime(2026, 10, 20, 9, 0, tzinfo=timezone.utc)
_ROW = PlaceRow("p1", "경복궁", "명소", "서울특별시", "종로구", True, False)


class _Worker:
    def __init__(self, *results: TypedResult) -> None:
        self.results, self.calls = list(results), 0

    def write(self, utterance, arguments, trace_id, now, *, timeout_sec):
        self.calls += 1
        return self.results.pop(0)


class _Executor:
    def __init__(self, fail: bool = False) -> None:
        self.fail, self.runs = fail, []

    def run(self, sql: str):
        self.runs.append(sql)
        if self.fail:
            raise TimeoutError("statement timeout")
        return [_ROW]


def _ok(sql: str = "SELECT poi_id FROM poi_public") -> TypedResult:
    return TypedResult(value=sql, is_fallback=False, error=None, call_record=None)


def _look(lookup: PlaceSqlLookup, args: dict | None = None):
    return lookup.lookup("서울 요즘 핫한 곳", args if args is not None else {"region": "서울", "theme": "요즘 핫한"},
                         TraceId("t"), _NOW, timeout_sec=2.0)


def test_rows_come_back_and_the_same_conditions_reuse_the_sql_but_not_the_rows() -> None:
    worker, executor = _Worker(_ok()), _Executor()
    lookup = PlaceSqlLookup(worker, executor)
    assert _look(lookup) == [_ROW] and _look(lookup) == [_ROW]
    assert worker.calls == 1 and len(executor.runs) == 2  # SQL 은 한 번, 조회는 매번


def test_cache_expires_after_the_ttl() -> None:
    now = [0.0]
    worker = _Worker(_ok(), _ok())
    lookup = PlaceSqlLookup(worker, _Executor(), clock=lambda: now[0])
    _look(lookup)
    now[0] = ps.CACHE_TTL_S + 1
    _look(lookup)
    assert worker.calls == 2


def test_cache_holds_at_most_cache_max_entries(monkeypatch) -> None:
    monkeypatch.setattr(ps, "CACHE_MAX", 2)
    worker = _Worker(*(_ok() for _ in range(4)))
    lookup = PlaceSqlLookup(worker, _Executor())
    for region in ("서울", "부산", "제주"):
        _look(lookup, {"region": region})
    _look(lookup, {"region": "서울"})  # 가장 먼저 넣은 서울은 밀려났다
    assert worker.calls == 4 and len(lookup._cache) == 2


def test_llm_fallback_or_not_a_place_query_is_none_and_not_cached() -> None:
    worker = _Worker(TypedResult(value=None, is_fallback=True, error="timeout", call_record=None), _ok(""), _ok())
    lookup = PlaceSqlLookup(worker, _Executor())
    assert _look(lookup) is None and _look(lookup) is None and _look(lookup) == [_ROW]
    assert worker.calls == 3


def test_db_error_is_none_so_the_handler_falls_back_to_the_radius_pool() -> None:
    assert _look(PlaceSqlLookup(_Worker(_ok()), _Executor(fail=True))) is None


def test_without_a_worker_nl2sql_is_off_but_the_lookup_object_still_exists() -> None:
    lookup = PlaceSqlLookup(None, _Executor())
    assert not lookup.writes_sql and _look(lookup) is None
