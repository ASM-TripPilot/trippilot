"""GenerationOutcome → AgentResult (DL-1·DL-5).

## 왜 여기 있나

`agents` 형제는 서로 import 할 수 없다(L-2). 그래서 네 에이전트의 변환기를 한
모듈에 모을 수 없고, **각 패키지가 자기 산출 타입만 안다.** 공통 불변식 조합은
`AgentResult.succeeded/degraded/failed` 로 domain 에 있다.

## 입력 쪽은 여기 없다

`handle(AgentTask) -> AgentResult` 의 **입력** 절반(봉투 → 타입 Task)은 아직
계약이 없다: `GenerateItineraryRequest` 의 `anchor`·`day_window`·`principal`·
`persona_ref`·`seed` 는 슬롯에 대응이 없고, 담을 칸(`inline_context`·
`context_refs`)에 의도별로 무엇이 들어가는지가 미정이다(미결 #8). 출력 쪽은
그 계약과 무관해서 먼저 수렴시킨다.
"""

from __future__ import annotations

from trippilot.agents.schedule.outcome import GenerationOutcome, GenerationStatus
from trippilot.domain.delegation import AgentResult, TaskError, TaskMetrics
from trippilot.domain.freshness import FreshnessMeta

_FAILED_CODE = "SCHEDULE_NO_SOLUTION"


def to_agent_result(
    outcome: GenerationOutcome,
    *,
    task_id: str,
    trace_id: str,
    metrics: TaskMetrics,
    freshness: FreshnessMeta | None = None,
) -> AgentResult:
    """산출 → 봉투. **metrics 는 인자다** — 산출물이 LLM 호출 수·토큰을 모른다.

    여기서 0 을 기본값으로 두면 "호출 0회"와 "안 셌다"가 구분되지 않는다.
    `freshness` 도 같은 이유로 인자이고, 없으면 None 이다(지어내지 않는다).
    """
    if outcome.status is GenerationStatus.FAILED:
        return AgentResult.failed(
            task_id=task_id, trace_id=trace_id, metrics=metrics,
            error=TaskError(
                code=_FAILED_CODE,
                message=outcome.error or "일정 없음",
                # 재시도로 풀릴 성질이 아니다 — 후보가 없거나 하드 제약이 모순이다.
                retryable=False,
            ),
        )

    payload = _payload(outcome)
    if outcome.status is GenerationStatus.DEGRADED:
        # 계단 수 = 밟은 강등 칸 수. DEGRADED 인데 degradations 가 비면 산출이
        # 스스로 모순인 상태이므로, 0 으로 내려 SUCCESS 와 뭉개지 않고 1 로 둔다.
        return AgentResult.degraded(
            task_id=task_id, trace_id=trace_id, payload=payload,
            fallback_level=max(1, len(outcome.degradations)),
            metrics=metrics, freshness=freshness,
        )
    return AgentResult.succeeded(
        task_id=task_id, trace_id=trace_id, payload=payload,
        metrics=metrics, freshness=freshness,
    )


def _payload(outcome: GenerationOutcome) -> dict:
    """JSON 원시 타입만 (BR-AF-12) — 도메인 객체를 그대로 담지 않는다."""
    return {
        "solution": outcome.solution.to_dict() if outcome.solution else None,
        "scoring_mode": outcome.scoring_mode.value,
        "candidate_count": outcome.candidate_count,
        "degradations": [
            {"stage": d.stage, "reason": d.reason} for d in outcome.degradations
        ],
        "explanations": [e.to_dict() for e in outcome.explanations],
        "slot_alternatives": {
            key: [a.to_dict() for a in alts]
            for key, alts in outcome.slot_alternatives.items()
        },
    }
