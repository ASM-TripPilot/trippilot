"""LlmPort fake 3종 (business-logic-model.md §3).

FakeLlm  : seed 기반 결정론 응답. 토큰 수는 문자열 길이 비례로 합성
           → call_record 파이프라인까지 테스트 가능.
FailingLlm: 항상 실패 (폴백 경로·FallbackEvent 발행 테스트용).
SlowLlm  : 항상 타임아웃 유발 (LlmTimeoutError).
"""

from __future__ import annotations

from trippilot.ports.llm_port import LlmRequest, LlmResponse, LlmTimeoutError


class FakeLlm:
    """LlmPort Protocol 만족. 같은 요청 → 같은 응답 (결정론)."""

    def __init__(self, canned: str | None = None) -> None:
        self._canned = canned

    def respond_with(self, text: str) -> "FakeLlm":
        return FakeLlm(canned=text)

    def invoke(self, request: LlmRequest) -> LlmResponse:
        text = self._canned if self._canned is not None else f"echo:{request.prompt}"
        return LlmResponse(
            raw_text=text,
            input_tokens=len(request.prompt),
            output_tokens=len(text),
            latency_ms=len(request.prompt) % 50,
            model_id=request.model_id,
        )


class FailingLlm:
    def invoke(self, request: LlmRequest) -> LlmResponse:
        raise RuntimeError("LLM unavailable (fake)")


class SlowLlm:
    def invoke(self, request: LlmRequest) -> LlmResponse:
        raise LlmTimeoutError(f"timeout > {request.timeout_sec}s (fake)")
