"""위임 봉투·신선도 generator (agent-foundation FD business-rules §2, ENV-P1~P4).

전략은 post-init 불변식을 만족하는 인스턴스만 생성한다 —
불변식 위반 조합의 생성 불가 검증은 test_delegation.py ENV-P3이 담당.
"""

from __future__ import annotations

from datetime import timedelta, timezone

from hypothesis import strategies as st

from trippilot.domain.delegation import (
    AgentResult,
    AgentStatus,
    AgentTask,
    ContextRef,
    Requester,
    TaskConstraints,
    TaskError,
    TaskIssuer,
    TaskMetrics,
    TaskPriority,
)
from trippilot.domain.freshness import (
    FreshnessMeta,
    InfoBundle,
    InfoPacket,
    ProviderKind,
    ProviderStatus,
)

from tests.generators.payloads import json_dicts

_KST = timezone(timedelta(hours=9))
_IDS = st.text(min_size=1, max_size=12)

_FAILURE_STATUSES = [
    ProviderStatus.NO_CANDIDATES,
    ProviderStatus.WEATHER_UNKNOWN,
    ProviderStatus.COLD_START,
    ProviderStatus.UNAVAILABLE,
]


# ── freshness ──
def freshness_metas() -> st.SearchStrategy[FreshnessMeta]:
    return st.builds(
        FreshnessMeta,
        source=st.sampled_from(["KMA", "KAKAO_MOBILITY", "NAVER", "M7_CACHE", "PGVECTOR"]),
        fetched_at=st.datetimes(timezones=st.just(_KST)),
        cache_hit=st.booleans(),
        ttl_sec=st.integers(0, 86400),
        stale=st.booleans(),
    )


def info_packets() -> st.SearchStrategy[InfoPacket]:
    ok_low = st.builds(
        InfoPacket,
        provider=st.sampled_from(list(ProviderKind)),
        status=st.sampled_from([ProviderStatus.OK, ProviderStatus.LOW]),
        data=json_dicts(),
        freshness=freshness_metas(),  # OK·LOW는 필수 (BR-AF-06)
    )
    failure = st.builds(
        InfoPacket,
        provider=st.sampled_from(list(ProviderKind)),
        status=st.sampled_from(_FAILURE_STATUSES),
        data=json_dicts(),
        freshness=st.one_of(st.none(), freshness_metas()),
    )
    return st.one_of(ok_low, failure)


def info_bundles() -> st.SearchStrategy[InfoBundle]:
    return st.builds(
        InfoBundle,
        packets=st.lists(info_packets(), max_size=3).map(tuple),
        pool_ref=st.one_of(st.none(), _IDS),
    )


# ── task ──
def context_refs() -> st.SearchStrategy[ContextRef]:
    return st.builds(
        ContextRef,
        kind=st.sampled_from(["trip", "itinerary", "schedule", "poi", "persona"]),
        ref_id=_IDS,
    )


def requesters() -> st.SearchStrategy[Requester]:
    return st.builds(
        Requester, user_id=_IDS, locale=st.sampled_from(["ko-KR", "en-US", "ja-JP"])
    )


def task_constraints() -> st.SearchStrategy[TaskConstraints]:
    return st.builds(
        TaskConstraints,
        max_llm_calls=st.integers(0, 10),
        allow_web_sourcing=st.booleans(),
        apply_mode_ceiling=st.one_of(st.none(), st.sampled_from(["AUTO", "CONFIRM"])),
    )


def task_errors() -> st.SearchStrategy[TaskError]:
    return st.builds(
        TaskError,
        code=st.sampled_from(["LLM_TIMEOUT", "NO_CANDIDATES", "DEADLINE", "INTERNAL"]),
        message=st.text(max_size=40),
        retryable=st.booleans(),
    )


def task_metrics() -> st.SearchStrategy[TaskMetrics]:
    return st.builds(
        TaskMetrics,
        elapsed_ms=st.integers(0, 60000),
        llm_calls=st.integers(0, 10),
        tokens_in=st.integers(0, 100000),
        tokens_out=st.integers(0, 100000),
        tools_used=st.lists(st.text(min_size=1, max_size=15), max_size=4).map(tuple),
    )


def agent_tasks() -> st.SearchStrategy[AgentTask]:
    return st.builds(
        AgentTask,
        task_id=_IDS,
        trace_id=_IDS,
        parent_task_id=st.one_of(st.none(), _IDS),
        issued_by=st.sampled_from(list(TaskIssuer)),
        intent=st.sampled_from(
            ["GENERATE_SCHEDULE", "PLAN_B", "REFLECT", "EDIT_SCHEDULE"]
        ),
        slots=json_dicts(),
        utterance=st.one_of(st.none(), st.text(max_size=40)),
        context_refs=st.lists(context_refs(), max_size=3).map(tuple),
        requester=requesters(),
        inline_context=json_dicts(),
        info=st.one_of(st.none(), info_bundles()),
        deadline_ms=st.integers(1, 60000),
        priority=st.sampled_from(list(TaskPriority)),
        constraints=task_constraints(),
        idempotency_key=_IDS,
    )


# ── result (상태별 불변식 표 준수 — domain-entities §2) ──
def _need_more_info_payloads() -> st.SearchStrategy[dict]:
    return st.fixed_dictionaries(
        {
            "missing": st.lists(st.text(min_size=1, max_size=15), min_size=1, max_size=4),
            "reason": st.text(max_size=40),
        }
    )


@st.composite
def agent_results(draw) -> AgentResult:
    status = draw(st.sampled_from(list(AgentStatus)))
    if status is AgentStatus.SUCCESS:
        payload, level, error = draw(json_dicts()), 0, None
    elif status is AgentStatus.FALLBACK:
        payload = draw(st.one_of(st.none(), json_dicts()))
        level, error = draw(st.integers(1, 3)), None
    elif status in (AgentStatus.FAILED, AgentStatus.TIMEOUT):
        payload = draw(st.one_of(st.none(), json_dicts()))
        level, error = draw(st.integers(0, 3)), draw(task_errors())
    elif status is AgentStatus.NEED_MORE_INFO:
        payload = draw(_need_more_info_payloads())
        level, error = draw(st.integers(0, 3)), None
    else:  # PARTIAL
        payload = draw(st.one_of(st.none(), json_dicts()))
        level, error = draw(st.integers(0, 3)), None
    return AgentResult(
        task_id=draw(_IDS),
        trace_id=draw(_IDS),
        status=status,
        payload=payload,
        fallback_level=level,
        freshness=draw(st.one_of(st.none(), freshness_metas())),
        error=error,
        metrics=draw(task_metrics()),
    )
