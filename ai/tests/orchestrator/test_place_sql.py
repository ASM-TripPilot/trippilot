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


def test_cache_key_includes_the_utterance_so_a_district_under_the_same_region_is_not_reused() -> None:
    worker = _Worker(_ok("SELECT poi_id FROM poi_public WHERE address LIKE '%망원%'"), _ok("SELECT poi_id FROM poi_public"),
                     _ok("SELECT poi_id FROM poi_public WHERE category = '카페'"))
    executor = _Executor()
    lookup = PlaceSqlLookup(worker, executor)
    args = {"region": "서울", "category": "카페"}
    for said in ("망원 카페", "서울 카페", ""):  # 같은 인자 · 다른 말(계획 경로는 발화 없음)
        lookup.lookup(said, args, TraceId("t"), _NOW, timeout_sec=2.0)
    assert worker.calls == 3 and "%망원%" not in executor.runs[1] and "%망원%" not in executor.runs[2]
    lookup.lookup("  서울   카페 ", args, TraceId("t"), _NOW, timeout_sec=2.0)  # 공백만 다른 같은 말은 캐시
    assert worker.calls == 3


# ── 미리 받기(prefetch) — 분류와 나란히 SQL 작성 ─────────────────────────────────

from concurrent.futures import Future, ThreadPoolExecutor  # noqa: E402
from types import SimpleNamespace  # noqa: E402

import pytest  # noqa: E402

from trippilot.orchestrator.place_sql import looks_like_place_query  # noqa: E402


def _now_submit(fn) -> Future:
    future: Future = Future()
    future.set_result(fn())
    return future


@pytest.mark.parametrize("said,expected", [
    ("서울 요즘 핫한 곳", True), ("강남역 근처 카페", True), ("부산 가볼만한 곳", True),
    ("다음 일정 뭐야", False), ("고마워!", False), ("근처 카페 있어?", False),  # 지역을 말하지 않았다 — 탐색도 SQL 을 안 쓴다
    ("서울 날씨 어때", False),
    ("홍대와 이태원 사이에 가볼만한 곳 알려줘", False),  # 두 곳 사이는 반경으로만 찾는다 — 미리 써 봐야 버린다
    ("홍대와 이태원사이😊 카페", False),  # 핸들러와 같게 정규화해서 본다
    ("서울이랑 부산 사이 가볼 만한 곳", False),  # 너무 먼 짝 — 핸들러는 찾지 않고 그렇다고 답한다
])
def test_place_query_needs_a_known_region_and_a_place_word(said: str, expected: bool) -> None:
    assert looks_like_place_query(said) is expected


def test_prefetched_sql_is_used_by_the_lookup_without_writing_again() -> None:
    worker, executor = _Worker(_ok()), _Executor()
    lookup = PlaceSqlLookup(worker, executor)
    lookup.prefetch("서울 요즘 핫한 곳", TraceId("t"), _NOW, _now_submit)
    assert worker.calls == 1
    assert lookup.lookup("서울 요즘 핫한 곳", {"region": "서울", "theme": "요즘 핫한"}, TraceId("t"), _NOW, timeout_sec=2.0) == [_ROW]
    assert worker.calls == 1 and len(executor.runs) == 1


def test_prefetch_is_skipped_for_non_place_talk_without_a_worker_or_when_cached() -> None:
    worker = _Worker(_ok())
    lookup = PlaceSqlLookup(worker, _Executor())
    lookup.prefetch("다음 일정 뭐야", TraceId("t"), _NOW, _now_submit)
    PlaceSqlLookup(None, _Executor()).prefetch("서울 요즘 핫한 곳", TraceId("t"), _NOW, _now_submit)
    assert worker.calls == 0
    lookup.prefetch("서울 요즘 핫한 곳", TraceId("a"), _NOW, _now_submit)
    lookup.lookup("서울 요즘 핫한 곳", {"region": "서울"}, TraceId("a"), _NOW, timeout_sec=2.0)
    lookup.prefetch("서울 요즘 핫한 곳", TraceId("b"), _NOW, _now_submit)  # 같은 말은 이미 캐시 — 다시 안 쓴다
    assert worker.calls == 1


def test_plan_path_lookup_without_the_utterance_ignores_the_prefetch_and_writes_from_arguments() -> None:
    worker = _Worker(_ok("SELECT poi_id FROM poi_public WHERE sido LIKE '서울%'"), _ok("SELECT poi_id FROM poi_public"))
    lookup = PlaceSqlLookup(worker, _Executor())
    lookup.prefetch("서울 요즘 핫한 곳", TraceId("t"), _NOW, _now_submit)
    lookup.lookup("", {"region": "서울"}, TraceId("t"), _NOW, timeout_sec=2.0)
    assert worker.calls == 2


def test_a_prefetch_that_does_not_finish_in_time_falls_back_to_the_radius_pool() -> None:
    worker, pending = _Worker(), Future()
    lookup = PlaceSqlLookup(worker, _Executor())
    lookup.prefetch("서울 요즘 핫한 곳", TraceId("t"), _NOW, lambda *a, **k: pending)
    assert lookup.lookup("서울 요즘 핫한 곳", {"region": "서울"}, TraceId("t"), _NOW, timeout_sec=0.05) is None
    assert worker.calls == 0  # 다시 쓰지 않는다 — 남은 시간이 없다


def test_orchestrator_submit_carries_the_llm_call_counter_into_pool_threads() -> None:
    from trippilot.orchestrator.dialogue_interpreter import _llm_calls, llm_call_counter
    from trippilot.orchestrator.dialogue_orchestrator import DialogueOrchestrator

    fake = SimpleNamespace(_pool=ThreadPoolExecutor(1))
    with llm_call_counter() as counter:
        seen = DialogueOrchestrator._submit(fake, _llm_calls.get).result(timeout=2)
    assert seen is counter  # 팬아웃·미리 받기 안의 LLM 호출도 턴의 llm_calls 에 든다
