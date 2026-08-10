"""OpenAIAdapter — LlmPort 플러그 (개발·검증용, TRIP-340 — AI-D06 부기).

프로덕션 기본은 AnthropicAdapter(AI-D06: Anthropic API 직접)로 **유지**된다.
이 어댑터는 결제 승인 전 실모델 스모크(K-2)를 돌리기 위한 대체 구현 —
멘토 제공 OpenAI 호환 엔드포인트(GPT-5.6)를 LlmPort 뒤에 꽂는다.

client는 생성자 주입 — anthropic_adapter와 동형. base_url 주입은 client 생성
시점의 몫(`openai.OpenAI(api_key=..., base_url=...)`) — 표준 OpenAI가 아닌
호환 게이트웨이도 같은 어댑터로 붙는다. 테스트는 fake client 객체로
요청/응답 매핑만 검증하고 CI에서 실 호출 0건 (BR-U4-10, D37).
SDK 타임아웃은 LlmTimeoutError로 변환, 그 외 예외는 그대로 —
게이트웨이가 폴백 신호로 수렴시킨다 (BR-U4-02).
"""

from __future__ import annotations

import time

import openai

from trippilot.ports.llm_port import LlmRequest, LlmResponse, LlmTimeoutError


class OpenAIAdapter:
    """LlmPort Protocol 구현 (OpenAI 호환 chat.completions)."""

    def __init__(self, client: openai.OpenAI) -> None:
        self._client = client

    def invoke(self, request: LlmRequest) -> LlmResponse:
        started = time.monotonic()
        try:
            resp = self._client.chat.completions.create(
                model=request.model_id,
                # GPT-5 계열은 구형 max_tokens 키를 거부한다 — 신형 키로 전달
                max_completion_tokens=request.max_tokens,
                temperature=request.temperature,
                timeout=request.timeout_sec,
                messages=[{"role": "user", "content": request.prompt}],
            )
        except openai.APITimeoutError as e:
            raise LlmTimeoutError(f"timeout > {request.timeout_sec}s: {e}") from e
        latency_ms = int((time.monotonic() - started) * 1000)
        content = resp.choices[0].message.content
        return LlmResponse(
            raw_text=content if content is not None else "",
            input_tokens=resp.usage.prompt_tokens,
            output_tokens=resp.usage.completion_tokens,
            latency_ms=latency_ms,
            model_id=resp.model,
        )
