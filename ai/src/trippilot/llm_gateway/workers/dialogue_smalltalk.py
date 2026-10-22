"""DialogueSmalltalkWorker — 도우미의 인사·잡담 한마디 (BR-AO-26 개정 2026-10-22).

답변 워커와 같은 출력 모양({"text", "footnote"})이라 게이트는 `DialogueAnswerGate` 를 그대로 쓴다 — 호출측이
`GatewayFacade(llm, renderer, DialogueAnswerGate(), c1_config, trace)` 로 조립해 넘긴다. 프롬프트만 다르다
(prompts/dialogue_smalltalk.yaml): 사실(Facts)이 없는 자리라 답변 프롬프트의 "사실이 비면 확인할 수 없다고 말하라"를 타면 안 된다.

실패·게이트 드롭·시한 부족이면 폴백 TypedResult 그대로 — 고정 문장(GREETING_TEXT·CHAT_TEXT)의 사용은 호출측 몫(INV-4).
입력은 전부 제3자 문자열이라 `inline()` 으로 한 줄로 눌러 싣는다(분류 워커와 같은 전제).
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from datetime import datetime

from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature, TypedResult
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import inline
from trippilot.llm_gateway.workers.dialogue_intent import NO_TRIP, NONE, render_history


def build_dialogue_smalltalk_vars(
    utterance: str, recent_turns: Iterable, memory_lines: Sequence[str], trip_summary: str,
) -> dict[str, str]:
    """값 전부 str·결정론. 분류·답변 워커와 같은 자리표시자 사전(`$history`·`$memory`·`$trip`·`$utterance`)."""
    memory = [line for line in (inline(x) for x in memory_lines) if line]
    return {
        "utterance": inline(utterance) or NONE,
        "history": render_history(recent_turns),
        "memory": "\n".join(f"- {m}" for m in memory) or NONE,
        "trip": inline(trip_summary) or NO_TRIP,
    }


class DialogueSmalltalkWorker:
    def __init__(self, gateway: GatewayFacade) -> None:
        self._gateway = gateway

    def compose(
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
        """성공 value 는 `DialogueAnswerDraft`(text·footnote). `timeout_sec` 은 오케스트레이터가 내린 잔여 시한(DL-4)."""
        return self._gateway.call(
            LlmFeature.DIALOGUE_SMALLTALK,
            build_dialogue_smalltalk_vars(utterance, recent_turns, memory_lines, trip_summary),
            None,  # 후보 풀 없음 — 장소를 말할 자리가 아니다
            trace_id,
            now,
            timeout_sec=timeout_sec,
        )
