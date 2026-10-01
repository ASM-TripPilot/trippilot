"""ReflectionTemplate → AgentResult (DL-1·DL-5).

형제 import 금지(L-2)라 패키지마다 둔다.
"""

from __future__ import annotations

from trippilot.domain.delegation import AgentResult, TaskMetrics
from trippilot.domain.freshness import FreshnessMeta
from trippilot.domain.reflection import ReflectionTemplate


def to_agent_result(
    template: ReflectionTemplate,
    *,
    task_id: str,
    trace_id: str,
    metrics: TaskMetrics,
    freshness: FreshnessMeta | None = None,
) -> AgentResult:
    """회고는 **실패 상태가 없다** — 규칙 템플릿이 최후 보루라 항상 산출이 나온다.

    그래서 갈리는 건 성공이냐 강등이냐 하나뿐이고, 판정 근거는 `is_fallback` 이다.
    계단 수를 세는 자리가 따로 없어 1로 둔다 — 회고 체인은 한 칸이다(LLM → 규칙).
    """
    payload = template.to_dict()
    if template.is_fallback:
        return AgentResult.degraded(
            task_id=task_id, trace_id=trace_id, payload=payload,
            fallback_level=1, metrics=metrics, freshness=freshness,
        )
    return AgentResult.succeeded(
        task_id=task_id, trace_id=trace_id, payload=payload,
        metrics=metrics, freshness=freshness,
    )
