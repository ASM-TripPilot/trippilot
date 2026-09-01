"""AnthropicAdapter — LlmPort 플러그 (U4 FD §4, AI-D06: Anthropic API 직접).

client는 생성자 주입 — 테스트는 fake client 객체로 요청/응답 매핑만 검증하고,
실 API 스모크는 K-1(결제 승인 후). CI에서 실 호출 0건 (BR-U4-10, D37).
**client는 max_retries=0으로 생성할 것** (TRIP-381 — SDK 내부 재시도(기본 2회)가
타임아웃 계약을 3배로 왜곡, 조립 지점 책임).
SDK 타임아웃은 LlmTimeoutError로 변환, 그 외 예외는 그대로 —
게이트웨이가 폴백 신호로 수렴시킨다 (BR-U4-02).
"""

from __future__ import annotations

import base64
import time

import anthropic

from trippilot.ports.llm_port import LlmRequest, LlmResponse, LlmTimeoutError


def _content(request: LlmRequest):
    """messages content 조립 — 이미지 없으면 종전과 **같은 문자열**을 준다
    (기존 텍스트 호출의 와이어 모양 불변 — openai 어댑터 _responses_input과 동형).

    이미지가 있으면 블록 배열: image 블록(base64 source)들 뒤에 text 블록 —
    Anthropic 권장 순서(이미지 먼저)를 따른다. 사용자 결정(2026-09-01)으로
    vision 기능을 Claude에 배정하기 위해 미지원 명시 실패를 실제 변환으로 대체.
    """
    if not request.images:
        return request.prompt
    blocks: list = [
        {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": image.media_type,
                "data": base64.b64encode(image.data).decode(),
            },
        }
        for image in request.images
    ]
    blocks.append({"type": "text", "text": request.prompt})
    return blocks


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
                messages=[{"role": "user", "content": _content(request)}],
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
