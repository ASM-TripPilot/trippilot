"""trigger·edit·evals·execution generator (business-logic-model.md §4)."""

from __future__ import annotations

from datetime import date, timedelta, timezone

from hypothesis import strategies as st

from trippilot.domain.common import PoiId, ScheduleId, TraceId
from trippilot.domain.edit import ApplyMode, Dispatch, EditCommand, EditOp
from trippilot.domain.evals import EvalCase, EvalRun, EvalScore
from trippilot.domain.execution import AgentCall, AgentKind, ExecutionPlan, ExecutionStep
from trippilot.domain.trigger import (
    ReplanScope,
    TriggerEvalResult,
    TriggerKind,
    TriggerParams,
)

from tests.generators.observability import prompt_refs
from tests.generators.payloads import json_dicts

_KST = timezone(timedelta(hours=9))
_DATES = st.dates(min_value=date(2026, 1, 1), max_value=date(2026, 12, 31))
_POI_IDS = st.builds(PoiId, st.text(min_size=1, max_size=8))


# ── trigger ──
def trigger_params() -> st.SearchStrategy[TriggerParams]:
    return st.builds(
        TriggerParams,
        kind=st.sampled_from(list(TriggerKind)),
        schedule_id=st.builds(ScheduleId, st.text(min_size=1, max_size=10)),
        affected_date=_DATES,
        payload=json_dicts(),
    )


def trigger_eval_results() -> st.SearchStrategy[TriggerEvalResult]:
    return st.builds(
        TriggerEvalResult,
        should_replan=st.booleans(),
        scope=st.sampled_from(list(ReplanScope)),
        reason=st.text(max_size=30),
    )


# ── edit ──
def edit_commands() -> st.SearchStrategy[EditCommand]:
    return st.builds(
        EditCommand,
        op=st.sampled_from(list(EditOp)),
        params=json_dicts(),
        affected_slots=st.lists(_POI_IDS, max_size=4).map(tuple),
    )


def dispatches() -> st.SearchStrategy[Dispatch]:
    return st.builds(
        Dispatch,
        intent=st.text(min_size=1, max_size=15),
        slots=json_dicts(),
        agent=st.sampled_from(list(AgentKind)),
        apply_mode=st.sampled_from(list(ApplyMode)),
    )


# ── evals ──
def eval_cases() -> st.SearchStrategy[EvalCase]:
    return st.builds(
        EvalCase,
        case_id=st.text(min_size=1, max_size=12),
        feature=st.text(min_size=1, max_size=15),
        input_payload=json_dicts(),
        expected=json_dicts(),
        tags=st.lists(st.text(max_size=10), max_size=3).map(tuple),
    )


def eval_scores() -> st.SearchStrategy[EvalScore]:
    return st.builds(
        EvalScore,
        metric=st.sampled_from(
            ["hallucination_rate", "hc_pass_rate", "fallback_rate", "retrieval_relevance"]
        ),
        value=st.floats(0, 1, allow_nan=False, allow_infinity=False),
        passed=st.booleans(),
    )


@st.composite
def eval_runs(draw) -> EvalRun:
    case_results = tuple(
        (
            draw(st.text(min_size=1, max_size=10)),
            tuple(draw(st.lists(eval_scores(), max_size=3))),
        )
        for _ in range(draw(st.integers(min_value=0, max_value=3)))
    )
    return EvalRun(
        run_id=draw(st.text(min_size=1, max_size=12)),
        prompt_refs=tuple(draw(st.lists(prompt_refs(), max_size=3))),
        model_id=draw(st.sampled_from(["claude-haiku-4-5", "claude-sonnet-5"])),
        executed_at=draw(st.datetimes(timezones=st.just(_KST))),
        case_results=case_results,
    )


# ── execution ──
def agent_calls() -> st.SearchStrategy[AgentCall]:
    return st.builds(
        AgentCall,
        agent=st.sampled_from(list(AgentKind)),
        task=st.text(min_size=1, max_size=15),
        params=json_dicts(),
    )


def execution_plans() -> st.SearchStrategy[ExecutionPlan]:
    steps = st.lists(
        st.builds(
            ExecutionStep,
            agents=st.lists(agent_calls(), max_size=3).map(tuple),
            timeout_sec=st.floats(0.1, 30, allow_nan=False, allow_infinity=False),
        ),
        max_size=3,
    ).map(tuple)
    return st.builds(
        ExecutionPlan,
        steps=steps,
        trace_id=st.builds(TraceId, st.text(min_size=1, max_size=12)),
    )
