"""DialogueIntentWorker — 도우미 턴의 의도를 LLM 이 **직접** 분류한다 (assistant-orchestrator FD domain-entities §2.10·§6).

INTENT(3단 라우터의 3차)와 같은 출력·같은 게이트(`IntentGate`)지만 **별개 feature·별개 프롬프트**다: 3단
라우터는 섀도 측정 전용으로 그대로 돌아야 하고, 그 측정 대상(prompts/intent.yaml·재생 픽스처)은 변수 하나만
바뀌어도 전건 미스다. 여기는 최근 대화·기억·여행 상황을 더 싣는다 — 지시어("거기"·"다음 일정")를 푸는 참고
자료이고 현재 발화가 우선이다(프롬프트 규칙 줄).

입력 문자열은 전부 **제3자 문자열**(발화·이전 턴·요약)이라 `inline()` 으로 한 줄로 눌러 넣는다 — 줄바꿈으로
프롬프트 골격([의도와 인자] 절 등)을 위조하지 못하게(`prompts.inline` 독스트링). `normalize`(NFKC·500자 상한)는
호출측(오케스트레이터)이 라우터와 같은 함수로 한다 — c1 은 orchestrator 를 import 하지 않는다.

실패·시한 초과·`{"intent": null}` 은 폴백 `TypedResult` 그대로 돌려준다(BR-U4-09) — OUT_OF_SCOPE 수렴은
호출측 몫이다. 게이트를 통과한 `OUT_OF_SCOPE` 라벨도 그대로 넘긴다(위임 가능 여부 판정은 호출측 —
`IntentRouter._classify` 와 같은 분담).
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime

from trippilot.domain.common import TraceId
from trippilot.domain.dialogue import tool_specs_json
from trippilot.domain.llm import LlmFeature, TypedResult
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import inline

# 자리표시자·역할 라벨·이력 줄 렌더러의 **한 집** — 답변·요약 워커(`$history`·`$recent_turns`)와 결정론 압축
# (`orchestrator.dialogue_memory.compress_fallback`)이 여기 것을 import 한다. 따로 적으면 넷이 갈라진다.
NONE = "(없음)"
NO_TRIP = "(여행 없음)"
# 역할 라벨 — 백엔드 RecentTurn.role 두 값. 밖의 값은 그대로 적는다(입력 검증은 TurnInput 몫 — 여기서 죽지 않는다).
ROLE_LABELS = {"USER": "사용자", "ASSISTANT": "도우미"}
# 인자표 파생 의도별 스키마 — intent.yaml·IntentRouter 와 **같은 함수**(한 표, 드리프트 차단)
_INTENTS = tool_specs_json()


def history_lines(recent_turns: Iterable) -> list[str]:
    """턴마다 `- 사용자: …`/`- 도우미: …` 한 줄(오래된 것부터). 항목은 `.role`·`.text` 만 읽고(덕 타이핑), 본문을
    `inline()` 으로 한 줄로 눌러 비면 줄을 만들지 않는다 — 제3자 문자열이 프롬프트 골격을 늘리지 못한다."""
    lines: list[str] = []
    for turn in recent_turns:
        body = inline(turn.text)
        if body:
            lines.append(f"- {ROLE_LABELS.get(turn.role, turn.role)}: {body}")
    return lines


def render_history(recent_turns: Iterable) -> str:
    """`$history` — `history_lines` 를 `\n` 으로 이어 붙인다. 줄이 없으면 `(없음)`."""
    return "\n".join(history_lines(recent_turns)) or NONE


def build_dialogue_intent_vars(
    utterance: str,
    recent_turns: Iterable,
    memory_lines: Iterable[str] | str,
    trip_summary: str | None,
) -> dict[str, str]:
    """프롬프트 변수 — 전부 str · `inline()` · `(없음)` 기본 (FD §6). 결정론: 같은 입력 → 같은 dict.

    `memory_lines` 는 줄 목록이 기본이고, `dialogue_orchestrator._memory_lines()` 가 이미 합친
    문자열이 와도 줄 단위로 받는다 — 두 호출 모양이 같은 tasks 줄에서 나와 어느 쪽이 와도 맞게.
    """
    if isinstance(memory_lines, str):
        memory_lines = memory_lines.splitlines()
    memory = [line for line in (inline(x) for x in memory_lines) if line]
    return {
        "utterance": inline(utterance) or NONE,
        "intents": _INTENTS,
        "history": render_history(recent_turns),
        "memory": "\n".join(memory) or NONE,
        "trip": inline(trip_summary or "") or NO_TRIP,
    }


class DialogueIntentWorker:
    """게이트 = 기존 `IntentGate`(feature 인자만 다름) — 호출측이
    `GatewayFacade(llm, renderer, IntentGate(), c1_config, trace)` 로 조립해 넘긴다(게이트 1개 = 인스턴스 1개)."""

    def __init__(self, gateway: GatewayFacade) -> None:
        self._gateway = gateway

    def classify(
        self,
        utterance: str,
        recent_turns: Iterable,
        memory_lines: Iterable[str] | str,
        trip_summary: str | None,
        trace_id: TraceId,
        now: datetime,
        *,
        timeout_sec: float | None = None,
    ) -> TypedResult:
        """성공 value 는 `IntentDraft`; 실패·null 은 폴백 TypedResult 그대로(BR-U4-09).

        `timeout_sec` 는 호출측 잔여 예산(DL-4 — BLM 시한표 min(4.0s, 잔여×0.45) — 2026-10-18 실측 개정); None 이면 게이트웨이 기본 10s.
        """
        return self._gateway.call(
            LlmFeature.DIALOGUE_INTENT,
            build_dialogue_intent_vars(utterance, recent_turns, memory_lines, trip_summary),
            None,  # 후보 풀 없음 — 라벨 closed-set 은 게이트가 Intent enum 으로 본다
            trace_id,
            now,
            timeout_sec=timeout_sec,
        )
