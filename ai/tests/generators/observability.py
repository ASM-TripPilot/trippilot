"""[LLMOps] 관측 이벤트 generator (business-logic-model.md §4).

trace_events: 5종 Union 중 하나 — 직렬화 왕복(U5-P10) 대상.
"""

from __future__ import annotations

from datetime import timedelta, timezone

from hypothesis import strategies as st

from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.execution import AgentKind
from trippilot.domain.itinerary import SolveMode
from trippilot.domain.observability import (
    FallbackEvent,
    GateDropEvent,
    LlmCallRecord,
    ScoreChunkEvent,
    SolverRunRecord,
)
from trippilot.domain.prompt import PromptRef

_KST = timezone(timedelta(hours=9))


def _datetimes() -> st.SearchStrategy:
    return st.datetimes(timezones=st.just(_KST))


def prompt_refs() -> st.SearchStrategy[PromptRef]:
    return st.builds(
        PromptRef,
        prompt_id=st.text(min_size=1, max_size=30),
        version=st.from_regex(r"[0-9]\.[0-9]\.[0-9]", fullmatch=True),
        feature=st.text(min_size=1, max_size=20),
    )


def llm_call_records() -> st.SearchStrategy[LlmCallRecord]:
    return st.builds(
        LlmCallRecord,
        trace_id=st.builds(TraceId, st.text(min_size=1, max_size=12)),
        occurred_at=_datetimes(),
        component=st.text(min_size=1, max_size=15),
        feature=st.text(min_size=1, max_size=15),
        model_id=st.sampled_from(["claude-haiku-4-5", "claude-sonnet-5"]),
        prompt_ref=prompt_refs(),
        input_tokens=st.integers(0, 100000),
        output_tokens=st.integers(0, 100000),
        latency_ms=st.integers(0, 30000),
        success=st.booleans(),
        agent=st.one_of(st.none(), st.sampled_from(list(AgentKind))),
    )


def fallback_events() -> st.SearchStrategy[FallbackEvent]:
    return st.builds(
        FallbackEvent,
        trace_id=st.builds(TraceId, st.text(min_size=1, max_size=12)),
        occurred_at=_datetimes(),
        component=st.text(min_size=1, max_size=15),
        stage=st.sampled_from(["llm", "solver", "router", "agent"]),
        from_mode=st.text(min_size=1, max_size=15),
        to_mode=st.text(min_size=1, max_size=15),
        reason=st.text(max_size=40),
    )


def gate_drop_events() -> st.SearchStrategy[GateDropEvent]:
    @st.composite
    def _build(draw) -> GateDropEvent:
        dropped = tuple(
            PoiId(x)
            for x in draw(st.lists(st.text(min_size=1, max_size=10), max_size=5))
        )
        total = draw(st.integers(len(dropped), len(dropped) + 50))
        return GateDropEvent(
            trace_id=TraceId(draw(st.text(min_size=1, max_size=12))),
            occurred_at=draw(_datetimes()),
            component=draw(st.text(min_size=1, max_size=15)),
            feature=draw(st.text(min_size=1, max_size=15)),
            dropped_ids=dropped,
            total_count=total,
            dropped_count=len(dropped),
        )

    return _build()


def score_chunk_events() -> st.SearchStrategy[ScoreChunkEvent]:
    @st.composite
    def _build(draw) -> ScoreChunkEvent:
        chunk_count = draw(st.integers(1, 10))
        success = draw(st.integers(0, chunk_count))
        return ScoreChunkEvent(
            trace_id=TraceId(draw(st.text(min_size=1, max_size=12))),
            occurred_at=draw(_datetimes()),
            component=draw(st.text(min_size=1, max_size=15)),
            feature=draw(st.text(min_size=1, max_size=15)),
            pool_size=draw(st.integers(0, 300)),
            chunk_count=chunk_count,
            success_count=success,
            failure_count=chunk_count - success,
        )

    return _build()


def solver_run_records() -> st.SearchStrategy[SolverRunRecord]:
    return st.builds(
        SolverRunRecord,
        trace_id=st.builds(TraceId, st.text(min_size=1, max_size=12)),
        occurred_at=_datetimes(),
        component=st.text(min_size=1, max_size=15),
        solve_mode=st.sampled_from(list(SolveMode)),
        elapsed_ms=st.integers(0, 30000),
        violations_found=st.integers(0, 20),
        repaired=st.booleans(),
    )


def trace_events() -> st.SearchStrategy:
    return st.one_of(
        llm_call_records(),
        fallback_events(),
        gate_drop_events(),
        score_chunk_events(),
        solver_run_records(),
    )
