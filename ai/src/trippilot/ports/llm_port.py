"""LlmPort — 계측 가능한 LLM 호출 콘센트 (business-logic-model.md §2.1).

벤더 중립 (NFR-6.3). 실 어댑터(Anthropic API — AI-D06)는 U4에서 구현.
- 타임아웃 초과 → LlmTimeoutError (침묵 실패 금지 — 소비 측이 FallbackEvent 발행)
- LlmResponse의 토큰·레이턴시 메타가 LlmCallRecord 생성의 원천 (계측이 구조적으로 가능)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from trippilot.domain.prompt import PromptRef


class LlmTimeoutError(Exception):
    """타임아웃 초과. 소비 측이 잡아서 FallbackEvent 발행."""


@dataclass(frozen=True, slots=True)
class LlmRequest:
    model_id: str
    prompt: str
    prompt_ref: PromptRef  # 버전 없는 호출은 타입상 불가능 (NFR-7.3)
    max_tokens: int
    temperature: float
    timeout_sec: float = 2.5  # NFR-1.2 기본값


@dataclass(frozen=True, slots=True)
class LlmResponse:
    raw_text: str
    input_tokens: int  # 사용량 메타 필수 반환
    output_tokens: int
    latency_ms: int
    model_id: str


class LlmPort(Protocol):
    def invoke(self, request: LlmRequest) -> LlmResponse: ...
