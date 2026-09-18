"""ReplanDirectiveTranslationWorker — 재계획 자유 입력 → 지시 키 (경량 티어).

PlanBAgent 전속 도구. **임베딩 매칭이 놓친 발화만** 받는다 —
`agents/planb/directives.match_free_text`(임계 0.74, 실측 정확일치 18/23)가 1차를
처리하고, 임계 미달이거나 빈 결과일 때 이 워커가 2차로 온다. 그래서 호출 빈도가 낮고
경량 티어로 충분하다.

**지시 목록은 서버가 주입한다**(`$directives`) — 사전(KB-4)이 20→30종이 되어도 프롬프트
파일은 안 바뀐다. `EDIT_TRANSLATION` 의 `$edit_ops` 와 같은 규약이다.

실패·게이트 드롭이면 폴백 `TypedResult` 를 그대로 반환한다(BR-U4-09) — 실행은 호출측
몫이고, 이 경우의 "실행"은 **칩 선택분만으로 진행**이다. 사유(reason)와 칩은 이 경로와
무관하게 살아 있어 재계획 자체는 정상으로 돈다(폴백 모드 `chips_only`).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature, TypedResult
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.gates.replan_directive_translation import DirectiveContext

# 한 발화에서 뽑을 지시 수 상한 — 임베딩 경로(`directives.MAX_RESOLVED`)와 같은 값이다.
# 두 경로가 다른 상한을 가지면 "같은 발화인데 통로에 따라 지시 수가 다르다"가 된다.
MAX_DIRECTIVES = 4


@dataclass(frozen=True, slots=True)
class DirectiveTranslationInput:
    """번역 입력. `options` 는 (키, 한국어 뜻) — 프롬프트에 렌더할 닫힌 목록이다."""

    utterance: str
    options: tuple[tuple[str, str], ...]
    max_directives: int = MAX_DIRECTIVES

    def __post_init__(self) -> None:
        if self.max_directives < 1:
            raise ValueError("max_directives ≥ 1")
        if not self.options:
            # 목록이 비면 모델이 고를 수 있는 값이 없다 — 호출 자체가 버그다.
            raise ValueError("options 가 비어 있으면 번역할 대상이 없다")


def build_directive_translation_vars(inp: DirectiveTranslationInput) -> dict[str, str]:
    """값 전부 str·결정론(키 정렬). 사전 순서가 프롬프트 순서를 흔들지 않게 정렬한다."""
    lines = "\n".join(f"- {key} | {label}" for key, label in sorted(inp.options))
    return {
        "utterance": inp.utterance.strip() or "(발화 없음)",
        "directives": lines,
        "max_directives": str(inp.max_directives),
    }


def context_of(inp: DirectiveTranslationInput) -> DirectiveContext:
    """게이트 대조 집합 — 프롬프트에 렌더한 것과 **같은 목록**에서 만든다.

    따로 만들면 "모델이 본 목록"과 "게이트가 허용하는 목록"이 어긋날 수 있다.
    """
    return DirectiveContext(keys=frozenset(key for key, _ in inp.options))


class ReplanDirectiveTranslationWorker:
    def __init__(self, gateway: GatewayFacade) -> None:
        self._gateway = gateway

    def translate(
        self,
        inp: DirectiveTranslationInput,
        trace_id: TraceId,
        now: datetime,
        *,
        timeout_sec: float | None = None,
    ) -> TypedResult:
        """`timeout_sec` 는 호출측이 요청 예산에서 떼어 넘긴다 (TRIP-376 관통).

        미관통이면 게이트웨이 기본(10s)에 얹혀 간다 — 그 상태로 두면 예산이 빠듯한
        경로에서 **조용히 폴백만 타는** 상태가 된다(sol 이 기본 2.5s 에 걸려 PlanB 가
        100% 타임아웃했던 TRIP-522 와 같은 모양).
        """
        return self._gateway.call(
            LlmFeature.REPLAN_DIRECTIVE_TRANSLATION,
            build_directive_translation_vars(inp),
            context_of(inp),  # pool 자리 = 게이트 대조 집합
            trace_id,
            now,
            timeout_sec=timeout_sec,
        )


def options_from(specs: Sequence[object]) -> tuple[tuple[str, str], ...]:
    """`DirectiveSpec` 목록 → 프롬프트 옵션. 사전 타입을 여기서 import 하지 않는다.

    `llm_gateway` 는 `agents` 를 모른다(L-2 취지 — 의존 방향은 agents → llm_gateway).
    호출측이 spec 을 넘기면 `key`·`label` 만 읽는다. 덕 타이핑이라 테스트에서 가벼운
    대역을 쓸 수 있고, 사전 스키마가 늘어도 이 워커는 안 바뀐다.
    """
    return tuple((getattr(s, "key"), getattr(s, "label")) for s in specs)
