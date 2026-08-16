"""OpenAIAdapter — LlmPort 플러그 (개발·검증용, TRIP-340 — AI-D06 부기).

프로덕션 기본은 AnthropicAdapter(AI-D06: Anthropic API 직접)로 **유지**된다.
이 어댑터는 결제 승인 전 실모델 스모크(K-2)를 돌리기 위한 대체 구현 —
멘토 제공 OpenAI 호환 엔드포인트(GPT-5.6)를 LlmPort 뒤에 꽂는다.

client는 생성자 주입 — anthropic_adapter와 동형. base_url 주입은 client 생성
시점의 몫(`openai.OpenAI(api_key=..., base_url=...)`) — 표준 OpenAI가 아닌
호환 게이트웨이도 같은 어댑터로 붙는다. **client는 max_retries=0으로 생성할 것**
(TRIP-381 — SDK 내부 재시도가 타임아웃 계약을 3배로 왜곡, 조립 지점 책임). 테스트는 fake client 객체로
요청/응답 매핑만 검증하고 CI에서 실 호출 0건 (BR-U4-10, D37).
SDK 타임아웃은 LlmTimeoutError로 변환, 그 외 예외는 그대로 —
게이트웨이가 폴백 신호로 수렴시킨다 (BR-U4-02).

api="responses"는 Responses API로 같은 계약(LlmRequest→LlmResponse)을 수행한다 —
멘토 게이트웨이가 chat.completions 경로를 라우팅하지 않아(500) 추가.
어느 쪽이든 게이트웨이·워커가 보는 계약은 동일하다.
"""

from __future__ import annotations

import time

import openai

from trippilot.ports.llm_port import LlmRequest, LlmResponse, LlmTimeoutError


class OpenAIAdapter:
    """LlmPort Protocol 구현 (OpenAI 호환 chat.completions | responses)."""

    def __init__(self, client: openai.OpenAI, api: str = "chat") -> None:
        if api not in ("chat", "responses"):
            raise ValueError(f"api는 chat|responses 중 하나: {api!r}")
        self._client = client
        self._api = api

    def invoke(self, request: LlmRequest) -> LlmResponse:
        started = time.monotonic()
        try:
            if self._api == "responses":
                # temperature 미전달 — GPT-5 계열은 파라미터째 거부(400,
                # "Unsupported parameter: 'temperature'"). 결정론 의도(0.0)는 이
                # 벤더에서 실현 불가 — 모델 기본값에 맡긴다 (TRIP-377).
                resp = self._client.responses.create(
                    model=request.model_id,
                    max_output_tokens=request.max_tokens,
                    timeout=request.timeout_sec,
                    input=request.prompt,
                )
                # output_text는 SDK 편의 속성 — reasoning만 나온 응답이면 "" (게이트가 드롭)
                raw_text = resp.output_text or ""
                input_tokens = resp.usage.input_tokens
                output_tokens = resp.usage.output_tokens
            else:
                resp = self._client.chat.completions.create(
                    model=request.model_id,
                    # GPT-5 계열은 구형 max_tokens 키를 거부한다 — 신형 키로 전달
                    max_completion_tokens=request.max_tokens,
                    # temperature 미전달 — responses와 동일 사유 (TRIP-377)
                    timeout=request.timeout_sec,
                    messages=[{"role": "user", "content": request.prompt}],
                )
                content = resp.choices[0].message.content
                raw_text = content if content is not None else ""
                input_tokens = resp.usage.prompt_tokens
                output_tokens = resp.usage.completion_tokens
        except openai.APITimeoutError as e:
            raise LlmTimeoutError(f"timeout > {request.timeout_sec}s: {e}") from e
        latency_ms = int((time.monotonic() - started) * 1000)
        return LlmResponse(
            raw_text=raw_text,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            latency_ms=latency_ms,
            model_id=resp.model,
        )
