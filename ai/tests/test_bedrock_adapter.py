"""BedrockAdapter — InvokeModel(OpenAI ChatCompletion) 응답을 LlmResponse 로 옮기는 계약.

스키마는 **실측**이다(2026-09-24, 임포트된 qwen3 모델):
    응답 {"choices":[{"message":{"content": ...}}],
          "usage":{"prompt_tokens":N,"completion_tokens":N}}

boto3 없이 전부 돈다(생성자 주입) — CI 에 boto3 가 없어도 로직은 검증된다.

증명하는 것:
  ① 정상 응답에서 본문·토큰 수를 옮긴다
  ② content 가 None·choices 가 빈 응답에서 죽지 않고 빈 문자열로 수렴(게이트가 실패 처리)
  ③ 이미지 입력은 조용히 버리지 않고 LlmUnsupportedError
  ④ 타임아웃과 **콜드스타트(ModelNotReady)** 를 LlmTimeoutError 로 좁힌다
  ⑤ 벤더로는 ARN 이 나가고 요청 본문은 OpenAI 형식이다
"""

from __future__ import annotations

import json

import pytest

from trippilot.llm_gateway.adapters.bedrock_adapter import BedrockAdapter
from trippilot.llm_gateway.prompts import PromptRef
from trippilot.ports.llm_port import (
    LlmImagePart,
    LlmRequest,
    LlmTimeoutError,
    LlmUnsupportedError,
)

ARN = "arn:aws:bedrock:us-east-1:111122223333:imported-model/abc123"
REF = PromptRef(prompt_id="reminder_copy", version="0.3.0", feature="REMINDER_COPY")


def _request(**kw) -> LlmRequest:
    base = dict(
        model_id="local-reminder-qwen3-4b-v1",
        prompt="오늘 일정을 알려줘",
        prompt_ref=REF,
        max_tokens=300,
    )
    base.update(kw)
    return LlmRequest(**base)


class _Body:
    def __init__(self, payload) -> None:
        self._raw = json.dumps(payload).encode()

    def read(self):
        return self._raw


class _FakeClient:
    """boto3 bedrock-runtime 의 invoke_model 표면만 흉내낸다."""

    def __init__(self, payload=None, raises: Exception | None = None) -> None:
        self._payload = payload
        self._raises = raises
        self.calls: list[dict] = []

    def invoke_model(self, **kwargs):
        self.calls.append(kwargs)
        if self._raises is not None:
            raise self._raises
        return {"body": _Body(self._payload)}


def _ok(content, usage=None):
    return {
        "choices": [{"message": {"content": content}, "finish_reason": "stop"}],
        "usage": usage if usage is not None
        else {"prompt_tokens": 12, "completion_tokens": 34},
    }


def test_maps_text_and_usage() -> None:
    client = _FakeClient(_ok('{"title":"오늘","body":"성산일출봉"}'))
    out = BedrockAdapter(client, ARN).invoke(_request())
    assert out.raw_text == '{"title":"오늘","body":"성산일출봉"}'
    assert (out.input_tokens, out.output_tokens) == (12, 34)
    assert out.latency_ms >= 0


def test_null_content_yields_empty_not_crash() -> None:
    """content: null 이 와도 죽지 않는다 — 빈 결과는 게이트가 실패로 처리한다(INV-4)."""
    client = _FakeClient(_ok(None))
    assert BedrockAdapter(client, ARN).invoke(_request()).raw_text == ""


def test_empty_choices_yields_empty_not_crash() -> None:
    client = _FakeClient({"choices": [], "usage": {}})
    assert BedrockAdapter(client, ARN).invoke(_request()).raw_text == ""


def test_missing_usage_defaults_to_zero() -> None:
    client = _FakeClient(_ok("본문", usage={}))
    out = BedrockAdapter(client, ARN).invoke(_request())
    assert (out.input_tokens, out.output_tokens) == (0, 0)


def test_images_rejected_not_silently_dropped() -> None:
    client = _FakeClient(_ok("본문"))
    req = _request(images=(LlmImagePart(media_type="image/jpeg", data=b"\xff\xd8\xff"),))
    with pytest.raises(LlmUnsupportedError):
        BedrockAdapter(client, ARN).invoke(req)
    assert client.calls == []  # 벤더를 부르지도 않는다


def test_vendor_timeout_narrowed() -> None:
    class ReadTimeoutError(Exception):
        pass

    client = _FakeClient(raises=ReadTimeoutError("read timed out"))
    with pytest.raises(LlmTimeoutError):
        BedrockAdapter(client, ARN).invoke(_request())


def test_cold_start_narrowed_to_timeout() -> None:
    """5분 무호출 뒤 스케일업 대기는 일시 장애다 — 폴백 계단이 받아야 한다."""

    class ModelNotReadyException(Exception):
        pass

    client = _FakeClient(raises=ModelNotReadyException("model is scaling up"))
    with pytest.raises(LlmTimeoutError):
        BedrockAdapter(client, ARN).invoke(_request())


def test_non_timeout_vendor_error_propagates() -> None:
    """설정 오류까지 삼키지 않는다 — 원인이 지워진다."""

    class AccessDeniedException(Exception):
        pass

    client = _FakeClient(raises=AccessDeniedException("no perms"))
    with pytest.raises(AccessDeniedException):
        BedrockAdapter(client, ARN).invoke(_request())


def test_request_shape_is_openai_chat() -> None:
    """벤더로는 ARN 이 나가고 본문은 OpenAI ChatCompletion 형식이다(실측 스키마)."""
    client = _FakeClient(_ok("본문"))
    out = BedrockAdapter(client, ARN).invoke(_request(max_tokens=128))
    call = client.calls[0]
    assert call["modelId"] == ARN
    body = json.loads(call["body"])
    assert body == {
        "messages": [{"role": "user", "content": "오늘 일정을 알려줘"}],
        "max_tokens": 128,
    }
    assert out.model_id == "local-reminder-qwen3-4b-v1"
