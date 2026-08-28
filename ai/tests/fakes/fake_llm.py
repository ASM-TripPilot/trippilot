"""LlmPort fake 3종 (business-logic-model.md §3).

FakeLlm  : seed 기반 결정론 응답. 토큰 수는 문자열 길이 비례로 합성
           → call_record 파이프라인까지 테스트 가능.
FailingLlm: 항상 실패 (폴백 경로·FallbackEvent 발행 테스트용).
SlowLlm  : 항상 타임아웃 유발 (LlmTimeoutError).
"""

from __future__ import annotations

from trippilot.ports.llm_port import LlmRequest, LlmResponse, LlmUnsupportedError, LlmTimeoutError


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


class VisionSpyLlm:
    """수신한 이미지를 기록하는 LlmPort — "동의 없이는 이미지가 실리지 않는다"를
    관측 가능하게 만든다 (VIS-P1). 응답은 FakeLlm과 동형(결정론)."""

    def __init__(self, canned: str | None = None) -> None:
        self._canned = canned
        self.seen_images: list[tuple] = []  # 호출별 images 튜플

    def invoke(self, request: LlmRequest) -> LlmResponse:
        self.seen_images.append(request.images)
        text = self._canned if self._canned is not None else f"echo:{request.prompt}"
        return LlmResponse(
            raw_text=text,
            input_tokens=len(request.prompt),
            output_tokens=len(text),
            latency_ms=0,
            model_id=request.model_id,
        )


class TextOnlyLlm:
    """이미지를 못 받는 어댑터의 대역 — images가 실리면 LlmUnsupportedError.

    실 어댑터(Anthropic·chat.completions 경로)와 같은 계약이라 강등 경로를
    fake로 재현할 수 있다 (VIS-P4).
    """

    def invoke(self, request: LlmRequest) -> LlmResponse:
        if request.images:
            raise LlmUnsupportedError("이미지 미지원 어댑터")
        return LlmResponse(
            raw_text="{}", input_tokens=1, output_tokens=1,
            latency_ms=0, model_id=request.model_id,
        )
