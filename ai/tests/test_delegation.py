"""agent-foundation — 위임 봉투 PBT (business-rules §2 ENV-P1~P3).

증명하는 것:
  ① ENV-P1: 봉투 전 타입 직렬화 왕복 (BR-AF-12) — 신선도 타입은 test_freshness.py
  ② ENV-P2: spawn 반복 적용 시 deadline 단조 감소 ∧ trace_id 불변 ∧ parent 연결
     정확 ∧ 잔여 소진 시 항상 예외 (DL-4, BR-AF-03 — SPEED-P1 토대)
  ③ ENV-P3: AgentResult 상태-필드 정합 — 불변식 표(domain-entities §2)를
     위반하는 인스턴스는 생성 불가 (DL-5, BR-AF-04, INV-4)
"""

from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from trippilot.domain.delegation import (
    AgentResult,
    AgentStatus,
    AgentTask,
    DeadlineExhaustedError,
    TaskError,
    TaskIssuer,
    TaskMetrics,
)

from tests.generators.delegation import (
    agent_results,
    agent_tasks,
    context_refs,
    task_constraints,
    task_errors,
    task_metrics,
)
from tests.generators.payloads import json_dicts

_METRICS = TaskMetrics(
    elapsed_ms=10, llm_calls=0, tokens_in=0, tokens_out=0, tools_used=()
)
_ERROR = TaskError(code="INTERNAL", message="x", retryable=False)


def _result(
    status: AgentStatus,
    *,
    payload: dict | None = None,
    fallback_level: int = 0,
    error: TaskError | None = None,
    task_id: str = "t1",
    trace_id: str = "tr1",
) -> AgentResult:
    return AgentResult(
        task_id=task_id,
        trace_id=trace_id,
        status=status,
        payload=payload,
        fallback_level=fallback_level,
        freshness=None,
        error=error,
        metrics=_METRICS,
    )


# ── ① ENV-P1: 직렬화 왕복 ──
@given(x=st.one_of(context_refs(), task_constraints(), task_errors(), task_metrics()))
def test_small_types_serialization_roundtrip(x) -> None:
    assert x.__class__.from_dict(x.to_dict()) == x


@given(task=agent_tasks())
def test_agent_task_serialization_roundtrip(task: AgentTask) -> None:
    assert AgentTask.from_dict(task.to_dict()) == task


@given(result=agent_results())
def test_agent_result_serialization_roundtrip(result: AgentResult) -> None:
    assert AgentResult.from_dict(result.to_dict()) == result


# ── ② ENV-P2: spawn deadline ──
@given(
    task=agent_tasks(),
    elapsed_seq=st.lists(st.integers(0, 2000), min_size=1, max_size=8),
)
def test_spawn_deadline_monotonic_and_lineage(task: AgentTask, elapsed_seq) -> None:
    current = task
    for i, elapsed in enumerate(elapsed_seq):
        if elapsed >= current.deadline_ms:
            with pytest.raises(DeadlineExhaustedError):
                current.spawn(
                    elapsed,
                    task_id=f"child-{i}",
                    issued_by=TaskIssuer.SCHEDULE_AGENT,
                    intent=current.intent,
                    slots={},
                )
            return  # 소진 이후 자식 봉투는 존재할 수 없다
        child = current.spawn(
            elapsed,
            task_id=f"child-{i}",
            issued_by=TaskIssuer.SCHEDULE_AGENT,
            intent=current.intent,
            slots={},
        )
        assert child.deadline_ms == current.deadline_ms - elapsed  # 정확 차감
        assert child.deadline_ms <= current.deadline_ms  # 단조 감소
        assert child.trace_id == task.trace_id  # trace 불변 (상속)
        assert child.parent_task_id == current.task_id  # 부모 연결 정확
        assert child.requester == task.requester  # 권한 주체 상속
        assert child.priority == task.priority
        assert child.constraints == task.constraints
        current = child


@given(task=agent_tasks(), overshoot=st.integers(0, 1000))
def test_spawn_exhausted_always_raises(task: AgentTask, overshoot: int) -> None:
    """잔여 ≤ 0이면 발행 자체 불가 (BR-AF-03)."""
    with pytest.raises(DeadlineExhaustedError):
        task.spawn(
            task.deadline_ms + overshoot,
            task_id="child",
            issued_by=TaskIssuer.ORCHESTRATOR,
            intent=task.intent,
            slots={},
        )


def test_spawn_rejects_negative_elapsed() -> None:
    task = AgentTask.from_dict(_TASK_DICT)
    with pytest.raises(ValueError):
        task.spawn(
            -1,
            task_id="child",
            issued_by=TaskIssuer.ORCHESTRATOR,
            intent="EDIT_SCHEDULE",
            slots={},
        )


_TASK_DICT = {
    "task_id": "t1",
    "trace_id": "tr1",
    "parent_task_id": None,
    "issued_by": "ORCHESTRATOR",
    "intent": "EDIT_SCHEDULE",
    "slots": {},
    "utterance": None,
    "context_refs": [],
    "requester": {"user_id": "u1", "locale": "ko-KR"},
    "inline_context": {},
    "info": None,
    "deadline_ms": 1000,
    "priority": "INTERACTIVE",
    "constraints": {
        "max_llm_calls": 3,
        "allow_web_sourcing": False,
        "apply_mode_ceiling": None,
    },
    "idempotency_key": "k1",
}


def test_agent_task_rejects_empty_ids_and_nonpositive_deadline() -> None:
    AgentTask.from_dict(_TASK_DICT)  # 정상
    for patch in ({"task_id": ""}, {"trace_id": ""}, {"deadline_ms": 0}, {"deadline_ms": -5}):
        with pytest.raises(ValueError):
            AgentTask.from_dict({**_TASK_DICT, **patch})


# ── ③ ENV-P3: AgentResult 상태-필드 정합 ──
def _table_allows(status, payload, level, error, task_id, trace_id) -> bool:
    """불변식 표(domain-entities §2)의 참조 술어 — 구현과 독립 기술."""
    if not task_id or not trace_id or level < 0:
        return False
    if status in (AgentStatus.FAILED, AgentStatus.TIMEOUT):
        if error is None:
            return False
    elif error is not None:
        return False
    if status is AgentStatus.SUCCESS and (payload is None or level != 0):
        return False
    if status is AgentStatus.FALLBACK and level < 1:
        return False
    if status is AgentStatus.NEED_MORE_INFO:
        if payload is None:
            return False
        missing = payload.get("missing")
        if not isinstance(missing, list) or not missing or "reason" not in payload:
            return False
    return True


@given(
    status=st.sampled_from(list(AgentStatus)),
    payload=st.one_of(
        st.none(),
        json_dicts(),
        st.fixed_dictionaries(
            {"missing": st.lists(st.text(min_size=1, max_size=8), max_size=3), "reason": st.text(max_size=20)}
        ),
    ),
    level=st.integers(-1, 3),
    error=st.one_of(st.none(), task_errors()),
    task_id=st.text(max_size=6),
    trace_id=st.text(max_size=6),
)
def test_result_invariant_table_is_exhaustively_enforced(
    status, payload, level, error, task_id, trace_id
) -> None:
    expected_valid = _table_allows(status, payload, level, error, task_id, trace_id)
    try:
        _result(
            status,
            payload=payload,
            fallback_level=level,
            error=error,
            task_id=task_id,
            trace_id=trace_id,
        )
        created = True
    except ValueError:
        created = False
    assert created == expected_valid


# ── 불변식 표 전수 — 행별 명시 케이스 ──
def test_success_requires_payload_and_zero_fallback() -> None:
    _result(AgentStatus.SUCCESS, payload={"ok": True})  # 정상
    with pytest.raises(ValueError):
        _result(AgentStatus.SUCCESS, payload=None)
    with pytest.raises(ValueError):
        _result(AgentStatus.SUCCESS, payload={"ok": True}, fallback_level=1)


@pytest.mark.parametrize("status", [AgentStatus.FAILED, AgentStatus.TIMEOUT])
def test_failed_timeout_iff_error(status: AgentStatus) -> None:
    _result(status, error=_ERROR)  # 정상
    with pytest.raises(ValueError):
        _result(status, error=None)  # error 없는 실패 금지 (침묵 실패, INV-4)


@pytest.mark.parametrize(
    "status", [AgentStatus.SUCCESS, AgentStatus.FALLBACK, AgentStatus.PARTIAL, AgentStatus.NEED_MORE_INFO]
)
def test_non_failure_statuses_forbid_error(status: AgentStatus) -> None:
    payload = (
        {"missing": ["weather"], "reason": "x"}
        if status is AgentStatus.NEED_MORE_INFO
        else {"ok": True}
    )
    level = 1 if status is AgentStatus.FALLBACK else 0
    with pytest.raises(ValueError):
        _result(status, payload=payload, fallback_level=level, error=_ERROR)


def test_fallback_requires_level_at_least_one() -> None:
    _result(AgentStatus.FALLBACK, fallback_level=1)  # 정상 (payload 없어도 됨)
    with pytest.raises(ValueError):
        _result(AgentStatus.FALLBACK, fallback_level=0)


def test_need_more_info_requires_nonempty_missing_and_reason() -> None:
    _result(AgentStatus.NEED_MORE_INFO, payload={"missing": ["weather"], "reason": "no kma"})
    for bad in (None, {}, {"missing": [], "reason": "r"}, {"missing": ["w"]}, {"reason": "r"}):
        with pytest.raises(ValueError):
            _result(AgentStatus.NEED_MORE_INFO, payload=bad)


def test_common_rules_ids_and_level() -> None:
    with pytest.raises(ValueError):
        _result(AgentStatus.PARTIAL, task_id="")
    with pytest.raises(ValueError):
        _result(AgentStatus.PARTIAL, trace_id="")
    with pytest.raises(ValueError):
        _result(AgentStatus.PARTIAL, fallback_level=-1)
