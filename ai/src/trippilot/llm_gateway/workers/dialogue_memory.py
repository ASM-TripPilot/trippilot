"""DialogueMemoryWorker — 세션 기억 요약 ≤20줄, 경량 티어 (assistant-orchestrator FD DE §2.6·§6, BR-AO-09).

오케스트레이터가 10턴마다 부른다: 이전 요약 + 최근 턴 → 갱신된 요약 줄. 발화 원문은 벤더 호출 본문에만
실리고(SEC-U8-06 이 허용하는 두 곳 중 하나) 저장되는 것은 산출 줄이다 — 그래서 프롬프트 규칙이 "원문 인용
금지"다.

실패·게이트 드롭이면 폴백 TypedResult 를 그대로 반환한다 (BR-U4-09). 결정론 압축
(`orchestrator.dialogue_memory.compress_fallback`)의 실행은 오케스트레이터 몫이고, 이 워커는 신호만 낸다.
시한은 호출측 잔여를 `timeout_sec` 로 관통한다 (DL-4) — 기본값을 두지 않아 잔여 없이 부르는 길을 막는다.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature, TypedResult
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import inline
from trippilot.llm_gateway.workers.dialogue_intent import NO_TRIP, NONE, render_history


def build_dialogue_memory_vars(
    previous_summary: Sequence[str],
    recent_turns: Sequence,
    trip_summary: str,
) -> dict[str, str]:
    """값 전부 str · 각 줄 `inline()`(프롬프트 골격 위조 차단) · 비면 `(없음)`.

    `recent_turns` 항목은 `.role`·`.text` 를 가진 객체(오케스트레이터 `RecentTurn` 모양) — `$recent_turns` 줄은 분류·답변
    워커의 `$history` 와 **같은 렌더러**(`render_history`)로 만든다. 순서는 입력 순서 그대로다 — 요약 줄과 턴은 순서가
    뜻이라 정렬하지 않는다(같은 입력 → 같은 출력은 유지). 좌표·account_ref 는 받지 않는다(G181 계열·로그 금지 값).
    """
    previous = [f"- {t}" for t in (inline(line) for line in previous_summary) if t]
    return {
        "previous_summary": "\n".join(previous) or NONE,
        "recent_turns": render_history(recent_turns),
        "trip": inline(trip_summary) or NO_TRIP,
    }


class DialogueMemoryWorker:
    def __init__(self, gateway: GatewayFacade) -> None:
        self._gateway = gateway

    def summarize(
        self,
        previous_summary: Sequence[str],
        recent_turns: Sequence,
        trip_summary: str,
        trace_id: TraceId,
        now: datetime,
        *,
        timeout_sec: float,
    ) -> TypedResult:
        return self._gateway.call(
            LlmFeature.DIALOGUE_MEMORY,
            build_dialogue_memory_vars(previous_summary, recent_turns, trip_summary),
            None,  # poi 선택 없음 — 풀 불필요
            trace_id,
            now,
            timeout_sec=timeout_sec,
        )
