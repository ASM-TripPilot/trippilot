"""DialogueKnowledgeWorker — 조회 도구로 답할 게 없는 여행 일반 지식을 LLM 일반 지식으로 즉답 (BR-AO-32, 2026-10-23 사용자 결정).

"부산은 언제 가는 게 좋아?"처럼 2‴ 계획이 gap KNOWLEDGE 로 닫은 말 — UnknownHandlingAgent 의 손이다. 웹 검색 없이 이번 턴에
답한다(~2s). 출력 모양은 답변과 같아({"text", "footnote"}) 게이트는 답변 게이트를 감싼 `DialogueKnowledgeGate`(가격·특정 날짜·연도
금지, `{"text": null}` = 모른다고 닫음)다 — 호출측이 `GatewayFacade(llm, renderer, DialogueKnowledgeGate(), c1_config, trace)` 로 조립한다.
입력은 전부 제3자 문자열이라 `inline()` 으로 한 줄로 눌러 싣는다(분류·잡담 워커와 같은 자리표시자 사전·같은 렌더러).
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from datetime import datetime

from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature, TypedResult
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import inline
from trippilot.llm_gateway.workers.dialogue_intent import NO_TRIP, NONE, render_history


def build_dialogue_knowledge_vars(
    utterance: str, recent_turns: Iterable, memory_lines: Sequence[str], trip_summary: str,
) -> dict[str, str]:
    """값 전부 str·결정론. 잡담 워커와 같은 자리표시자(`$utterance`·`$history`·`$memory`·`$trip`). 최근 대화 창은 오케스트레이터가
    잘라 넘긴다(최근 3턴 + 기억이 덮지 못한 턴) — 워커는 받은 대로 렌더한다."""
    memory = [line for line in (inline(x) for x in memory_lines) if line]
    return {
        "utterance": inline(utterance) or NONE,
        "history": render_history(recent_turns),
        "memory": "\n".join(f"- {m}" for m in memory) or NONE,
        "trip": inline(trip_summary) or NO_TRIP,
    }


class DialogueKnowledgeWorker:
    def __init__(self, gateway: GatewayFacade) -> None:
        self._gateway = gateway

    def answer(
        self,
        utterance: str,
        recent_turns: Iterable,
        memory_lines: Sequence[str],
        trip_summary: str,
        trace_id: TraceId,
        now: datetime,
        *,
        timeout_sec: float,
    ) -> TypedResult:
        """성공 value 는 `DialogueAnswerDraft`(text) 또는 None(모른다고 닫음). `timeout_sec` 은 오케스트레이터가 내린 잔여 시한(DL-4)."""
        return self._gateway.call(
            LlmFeature.DIALOGUE_KNOWLEDGE,
            build_dialogue_knowledge_vars(utterance, recent_turns, memory_lines, trip_summary),
            None,  # 후보 풀 없음 — 장소를 고르는 자리가 아니다(등록되지 않은 장소 이름은 오케스트레이터가 막는다)
            trace_id,
            now,
            timeout_sec=timeout_sec,
        )
