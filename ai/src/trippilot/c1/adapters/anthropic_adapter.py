"""AnthropicAdapter — LlmPort 플러그 (U4 FD §4, AI-D06: Anthropic API 직접).

client는 생성자 주입 — 테스트는 fake client 객체로 요청/응답 매핑만 검증하고,
실 API 스모크는 K-1(결제 승인 후). CI에서 실 호출 0건 (BR-U4-10, D37).
SDK 타임아웃은 LlmTimeoutError로 변환, 그 외 예외는 그대로 —
게이트웨이가 폴백 신호로 수렴시킨다 (BR-U4-02).
"""

from __future__ import annotations

import time

import anthropic

from trippilot.ports.llm_port import LlmRequest, LlmResponse, LlmTimeoutError


class AnthropicAdapter:
    """LlmPort Protocol 구현."""

    def __init__(self, client: anthropic.Anthropic) -> None:
        self._client = client

    def invoke(self, request: LlmRequest) -> LlmResponse:
        started = time.monotonic()
        try:
            resp = self._client.messages.create(
                model=request.model_id,
                max_tokens=request.max_tokens,
                temperature=request.temperature,
                timeout=request.timeout_sec,
                messages=[{"role": "user", "content": request.prompt}],
            )
        except anthropic.APITimeoutError as e:
            raise LlmTimeoutError(f"timeout > {request.timeout_sec}s: {e}") from e
        latency_ms = int((time.monotonic() - started) * 1000)
        raw_text = "".join(
            block.text
            for block in resp.content
            if getattr(block, "type", None) == "text"
        )
        return LlmResponse(
            raw_text=raw_text,
            input_tokens=resp.usage.input_tokens,
            output_tokens=resp.usage.output_tokens,
            latency_ms=latency_ms,
            model_id=resp.model,
        )
