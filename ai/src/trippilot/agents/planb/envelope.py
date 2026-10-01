"""PlanBRagResult → AgentResult (DL-1·DL-5). 형제 import 금지(L-2)라 패키지마다 둔다."""

from __future__ import annotations

from trippilot.agents.planb.rag import PlanBRagResult
from trippilot.domain.delegation import AgentResult, TaskError, TaskMetrics
from trippilot.domain.freshness import FreshnessMeta

_EMPTY_CODE = "PLANB_NO_ALTERNATIVE"


def to_agent_result(
    result: PlanBRagResult,
    *,
    task_id: str,
    trace_id: str,
    metrics: TaskMetrics,
    freshness: FreshnessMeta | None = None,
) -> AgentResult:
    """대안 0개는 **실패다** — 빈 목록을 SUCCESS 로 내면 호출측이 정상 경로를 탄다.

    PlanB 는 `fallback_level` 을 자기가 이미 센다(0=LLM 정상 · 1=규칙 랭킹 ·
    2=후보 0). 그 값을 그대로 쓴다 — 여기서 다시 세면 두 숫자가 갈린다.
    """
    if not result.alternatives:
        return AgentResult.failed(
            task_id=task_id, trace_id=trace_id, metrics=metrics,
            error=TaskError(
                code=_EMPTY_CODE,
                message=result.empty_reason or "대안 없음",
                # 후보 풀이 비었거나 전부 closed-set 밖 — 다시 불러도 같다.
                retryable=False,
            ),
        )

    payload = {
        "alternatives": [
            {"label": a.label, "poi_ids": [str(p) for p in a.poi_ids],
             "rationale": a.rationale}
            for a in result.alternatives
        ],
        "notes": list(result.notes),
        "retrieved": dict(result.retrieved),
        "dropped_out_of_pool": list(result.dropped_out_of_pool),
    }
    if result.fallback_level > 0:
        return AgentResult.degraded(
            task_id=task_id, trace_id=trace_id, payload=payload,
            fallback_level=result.fallback_level, metrics=metrics,
            freshness=freshness,
        )
    return AgentResult.succeeded(
        task_id=task_id, trace_id=trace_id, payload=payload,
        metrics=metrics, freshness=freshness,
    )
