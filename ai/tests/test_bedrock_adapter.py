"""BedrockAdapter — Converse 응답을 LlmResponse 로 옮기는 계약.

boto3 없이 전부 돈다(생성자 주입) — CI 에 boto3 가 없어도 로직은 검증된다.

증명하는 것:
  ① 정상 응답에서 본문·토큰 수를 옮긴다
  ② **첫 블록이 텍스트가 아니어도** 텍스트를 찾아낸다(추론 블록 선행)
  ③ 이미지 입력은 조용히 버리지 않고 LlmUnsupportedError
  ④ 벤더 타임아웃은 LlmTimeoutError 로 좁힌다(폴백 계단이 이걸 본다)
  ⑤ 모델 id 는 요청 것을 돌려주고, 벤더로는 ARN 이 나간다
"""

from __future__ import annotations

import pytest

from trippilot.llm_gateway.adapters.bedrock_adapter import BedrockAdapter
from trippilot.ports.llm_port import (
    LlmImagePart,
    LlmRequest,
    LlmTimeoutError,
    LlmUnsupportedError,
)
from trippilot.llm_gateway.prompts import PromptRef

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


class _FakeClient:
    """boto3 bedrock-runtime 의 converse 표면만 흉내낸다."""

    def __init__(self, response=None, raises: Exception | None = None) -> None:
        self._response = response
        self._raises = raises
        self.calls: list[dict] = []

    def converse(self, **kwargs):
        self.calls.append(kwargs)
        if self._raises is not None:
            raise self._raises
        return self._response


def _ok(blocks, usage=None):
    return {
        "output": {"message": {"content": blocks}},
        "usage": usage if usage is not None else {"inputTokens": 12, "outputTokens": 34},
    }


def test_maps_text_and_usage() -> None:
    client = _FakeClient(_ok([{"text": '{"title":"오늘","body":"성산일출봉"}'}]))
    out = BedrockAdapter(client, ARN).invoke(_request())
    assert out.raw_text == '{"title":"오늘","body":"성산일출봉"}'
    assert (out.input_tokens, out.output_tokens) == (12, 34)
    assert out.latency_ms >= 0


def test_finds_text_after_non_text_block() -> None:
    """추론 블록이 먼저 와도 본문을 찾는다 — 인덱스로 집으면 여기서 죽는다."""
    client = _FakeClient(_ok([{"reasoningContent": {"text": "생각"}}, {"text": "본문"}]))
    assert BedrockAdapter(client, ARN).invoke(_request()).raw_text == "본문"


def test_no_text_block_yields_empty_not_crash() -> None:
    """텍스트가 하나도 없으면 빈 문자열 — 게이트가 빈 결과를 실패로 처리한다(INV-4)."""
    client = _FakeClient(_ok([{"reasoningContent": {"text": "생각만"}}]))
    assert BedrockAdapter(client, ARN).invoke(_request()).raw_text == ""


def test_missing_usage_defaults_to_zero() -> None:
    client = _FakeClient(_ok([{"text": "본문"}], usage={}))
    out = BedrockAdapter(client, ARN).invoke(_request())
    assert (out.input_tokens, out.output_tokens) == (0, 0)


def test_images_rejected_not_silently_dropped() -> None:
    client = _FakeClient(_ok([{"text": "본문"}]))
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


def test_non_timeout_vendor_error_propagates() -> None:
    """타임아웃이 아닌 벤더 오류까지 삼키지 않는다 — 원인이 지워진다."""

    class AccessDeniedException(Exception):
        pass

    client = _FakeClient(raises=AccessDeniedException("no perms"))
    with pytest.raises(AccessDeniedException):
        BedrockAdapter(client, ARN).invoke(_request())


def test_arn_goes_to_vendor_model_id_comes_back() -> None:
    """벤더로는 ARN 이 나가고, 응답의 model_id 는 요청 것이다(관측 일관성)."""
    client = _FakeClient(_ok([{"text": "본문"}]))
    out = BedrockAdapter(client, ARN).invoke(_request())
    assert client.calls[0]["modelId"] == ARN
    assert out.model_id == "local-reminder-qwen3-4b-v1"


def test_max_tokens_passed_temperature_not() -> None:
    """temperature 는 안 보낸다 — LlmRequest 에 없고, 거부하는 모델 세대가 있었다."""
    client = _FakeClient(_ok([{"text": "본문"}]))
    BedrockAdapter(client, ARN).invoke(_request(max_tokens=128))
    cfg = client.calls[0]["inferenceConfig"]
    assert cfg == {"maxTokens": 128}
