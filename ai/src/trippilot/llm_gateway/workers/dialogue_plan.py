"""DialoguePlanWorker — 분류가 "정해진 의도 없음"으로 닫은 말에 조회 도구 계획을 세운다
(assistant-orchestrator FD BLM §3 2‴ · BR-AO-28 · DE §2.10·§6).

출력은 닫힌 도구 이름과 짧은 문자열 인자뿐이다(`DialoguePlanGate`) — 사실은 고른 도구(정보 핸들러)가 등록 POI·스냅샷에서
모으고, 사용자에게 보일 문장은 DIALOGUE_ANSWER 가 그 사실로 짓는다. 이 워커는 도구 표를 모른다: `$tools` 문자열은 조립부가
배선된 도구로 만들어 생성자로 넣는다(L-1 — c1 은 orchestrator 를 import 하지 않는다). 배포마다 고정이라 고정부(벤더 캐시 접두)다.

변수는 넷 — 기억(`$memory`)은 싣지 않는다(토큰·자기 기억 오염), 최근 대화는 지시어 풀이에 충분한 4건(2왕복)만. 제3자 문자열은
분류 워커와 같은 렌더러(`render_history`·`inline`)로 한 줄씩 눌러 넣는다 — 골격 위조 차단.

실패·시한·깨진 출력·전량 드롭은 폴백 `TypedResult` 그대로(BR-U4-09) — 범위 밖 수렴은 호출측 몫이다. 도구 없음·거절은 성공이다.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime

from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature, TypedResult
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import inline
from trippilot.llm_gateway.workers.dialogue_intent import NO_TRIP, NONE, render_history

PLAN_HISTORY = 4  # 최근 4건(2왕복) — 지시어("거기") 풀이에 충분하고 토큰·지연을 줄인다


def build_dialogue_plan_vars(
    utterance: str,
    recent_turns: Iterable,
    trip_summary: str | None,
    tools_json: str,
) -> dict[str, str]:
    """프롬프트 변수 — 전부 str · 제3자 문자열은 `inline()` · `(없음)` 기본. 결정론: 같은 입력 → 같은 dict."""
    return {
        "utterance": inline(utterance) or NONE,
        "tools": tools_json,
        "history": render_history(tuple(recent_turns)[-PLAN_HISTORY:]),
        "trip": inline(trip_summary or "") or NO_TRIP,
    }


class DialoguePlanWorker:
    """게이트 = `DialoguePlanGate(노출 도구)` — 호출측이 `GatewayFacade(llm, renderer, gate, c1_config, trace)` 로 조립하고,
    같은 노출 도구로 만든 `$tools` 를 함께 넘긴다(둘이 갈리면 모델에게 보인 도구와 게이트가 받는 도구가 달라진다)."""

    def __init__(self, gateway: GatewayFacade, tools_json: str) -> None:
        self._gateway = gateway
        self._tools = tools_json

    def plan(
        self,
        utterance: str,
        recent_turns: Iterable,
        trip_summary: str | None,
        trace_id: TraceId,
        now: datetime,
        *,
        timeout_sec: float | None = None,
    ) -> TypedResult:
        """성공 value 는 `DialoguePlanDraft`(도구 ≤2 · 거절 · 도구 없음). `timeout_sec` 는 호출측 잔여 예산(DL-4)."""
        return self._gateway.call(
            LlmFeature.DIALOGUE_PLAN,
            build_dialogue_plan_vars(utterance, recent_turns, trip_summary, self._tools),
            None,  # 후보 풀 없음 — 닫힘은 게이트가 노출 도구·인자표로 본다
            trace_id,
            now,
            timeout_sec=timeout_sec,
        )
