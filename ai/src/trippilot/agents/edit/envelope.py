"""EditOutcome → AgentResult (DL-1·DL-5). 형제 import 금지(L-2)라 패키지마다 둔다."""

from __future__ import annotations

from trippilot.agents.edit.agent import EditOutcome
from trippilot.agents.edit.commands import EditStatus
from trippilot.domain.delegation import AgentResult, AgentStatus, TaskError, TaskMetrics
from trippilot.domain.freshness import FreshnessMeta

_CODES = {
    EditStatus.REJECTED: "EDIT_REJECTED",
    EditStatus.TRANSLATION_FAILED: "EDIT_TRANSLATION_FAILED",
}


def to_agent_result(
    outcome: EditOutcome,
    *,
    task_id: str,
    trace_id: str,
    metrics: TaskMetrics,
    freshness: FreshnessMeta | None = None,
) -> AgentResult:
    """편집은 상태가 넷이고 **하나는 성공도 실패도 아니다**.

    `CONFIRM_REQUIRED` 는 사용자에게 되묻는 중간 상태다 — FAILED 로 내면 호출측이
    폴백을 태우고, SUCCESS 로 내면 적용된 줄 안다. `NEED_MORE_INFO` 가 그 자리다.
    """
    if outcome.status is EditStatus.APPLIED:
        return AgentResult.succeeded(
            task_id=task_id, trace_id=trace_id, metrics=metrics, freshness=freshness,
            payload={"solution": (outcome.solution.to_dict()
                                  if outcome.solution else None)},
        )

    if outcome.status is EditStatus.CONFIRM_REQUIRED:
        # 도메인이 `missing`(비어 있지 않은 목록)과 `reason` 을 강제한다.
        # 편집에서 모자란 것은 인자가 아니라 **사용자 확인** 하나다 — 그걸 그대로
        # 적는다. 빈 목록이나 자리표시자를 넣으면 호출측이 되물을 것을 못 고른다.
        return AgentResult(
            task_id=task_id, trace_id=trace_id,
            status=AgentStatus.NEED_MORE_INFO,
            payload={
                "missing": ["confirm"],
                "reason": outcome.reason or "적용 전 확인 필요",
                "apply_mode": outcome.apply_mode.value if outcome.apply_mode else None,
            },
            fallback_level=0, freshness=freshness, error=None, metrics=metrics,
        )

    return AgentResult.failed(
        task_id=task_id, trace_id=trace_id, metrics=metrics,
        error=TaskError(
            code=_CODES.get(outcome.status, "EDIT_FAILED"),
            message=outcome.reason or outcome.status.value,
            # 번역 실패는 같은 발화로 다시 해도 같다. 거절은 규칙 위반이라 더 그렇다.
            retryable=False,
        ),
    )
