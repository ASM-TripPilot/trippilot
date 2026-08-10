"""TRIP-340 — OpenAIAdapter 매핑 검증 (fake client, 실 API 0건 — BR-U4-10, D37).

record-and-return fake client로 (요청 매핑, 응답 매핑, 타임아웃 변환)만 검증 —
test_c1_adapter.py(AnthropicAdapter)와 동형. 실 API 스모크는 scripts/smoke_llm.py
수동 실행(K-2) — pytest 대상이 아니다.
"""

from __future__ import annotations

from types import SimpleNamespace

import httpx
import openai
import pytest

from trippilot.llm_gateway.adapters.openai_adapter import OpenAIAdapter
from trippilot.domain.prompt import PromptRef
from trippilot.ports.llm_port import LlmRequest, LlmTimeoutError

_REQUEST = LlmRequest(
    model_id="model-under-test",
    prompt="점수를 매겨라",
    prompt_ref=PromptRef(
        prompt_id="prompts/test.yaml", version="0.0.1", feature="PREFERENCE_SCORING"
    ),
    max_tokens=1024,
    temperature=0.0,
    timeout_sec=2.5,
)

_HTTPX_REQ = httpx.Request("POST", "https://example.invalid/v1/chat/completions")


class RecordingClient:
    """chat.completions.create 호출을 기록하고 준비된 응답을 돌려주는 fake."""

    def __init__(self, content: str | None = '{"scores": []}') -> None:
        self.kwargs: dict | None = None
        self._content = content
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.kwargs = kwargs
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=self._content))],
            usage=SimpleNamespace(prompt_tokens=12, completion_tokens=7),
            model=kwargs["model"],
        )


def test_request_mapping_is_faithful() -> None:
    client = RecordingClient()
    OpenAIAdapter(client).invoke(_REQUEST)

    assert client.kwargs is not None
    assert client.kwargs["model"] == "model-under-test"
    assert client.kwargs["max_completion_tokens"] == 1024  # GPT-5 계열 신형 키
    assert client.kwargs["temperature"] == 0.0
    assert client.kwargs["timeout"] == 2.5  # BR-U4-04 타임아웃 전달
    assert client.kwargs["messages"] == [{"role": "user", "content": "점수를 매겨라"}]


def test_response_mapping_records_usage_tokens() -> None:
    response = OpenAIAdapter(RecordingClient()).invoke(_REQUEST)

    assert response.raw_text == '{"scores": []}'
    assert response.input_tokens == 12 and response.output_tokens == 7
    assert response.model_id == "model-under-test"
    assert response.latency_ms >= 0


def test_null_content_maps_to_empty_text() -> None:
    """content가 null인 응답(도구 호출 등)도 계약상 str — None을 새지 않게 한다."""
    response = OpenAIAdapter(RecordingClient(content=None)).invoke(_REQUEST)

    assert response.raw_text == ""


class RecordingResponsesClient:
    """responses.create 호출을 기록하고 준비된 응답을 돌려주는 fake."""

    def __init__(self, output_text: str = '{"scores": []}') -> None:
        self.kwargs: dict | None = None
        self._output_text = output_text
        self.responses = SimpleNamespace(create=self._create)

    def _create(self, **kwargs):
        self.kwargs = kwargs
        return SimpleNamespace(
            output_text=self._output_text,
            usage=SimpleNamespace(input_tokens=12, output_tokens=7),
            model=kwargs["model"],
        )


def test_responses_request_mapping_is_faithful() -> None:
    client = RecordingResponsesClient()
    OpenAIAdapter(client, api="responses").invoke(_REQUEST)

    assert client.kwargs is not None
    assert client.kwargs["model"] == "model-under-test"
    assert client.kwargs["max_output_tokens"] == 1024  # responses 쪽 토큰 상한 키
    assert client.kwargs["temperature"] == 0.0
    assert client.kwargs["timeout"] == 2.5  # BR-U4-04 타임아웃 전달
    assert client.kwargs["input"] == "점수를 매겨라"


def test_responses_response_mapping_records_usage_tokens() -> None:
    response = OpenAIAdapter(RecordingResponsesClient(), api="responses").invoke(_REQUEST)

    assert response.raw_text == '{"scores": []}'
    assert response.input_tokens == 12 and response.output_tokens == 7
    assert response.model_id == "model-under-test"


def test_unknown_api_is_rejected_at_construction() -> None:
    with pytest.raises(ValueError):
        OpenAIAdapter(RecordingClient(), api="grpc")


def test_sdk_timeout_becomes_llm_timeout_error() -> None:
    class TimeoutClient:
        def __init__(self) -> None:
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

        def _create(self, **kwargs):
            raise openai.APITimeoutError(request=_HTTPX_REQ)

    with pytest.raises(LlmTimeoutError):
        OpenAIAdapter(TimeoutClient()).invoke(_REQUEST)


def test_other_api_errors_propagate_for_gateway_to_convert() -> None:
    class BrokenClient:
        def __init__(self) -> None:
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

        def _create(self, **kwargs):
            raise openai.APIConnectionError(request=_HTTPX_REQ)

    # LlmTimeoutError로 둔갑시키지 않고 그대로 — 게이트웨이가 llm_error 폴백으로 수렴
    with pytest.raises(openai.APIConnectionError):
        OpenAIAdapter(BrokenClient()).invoke(_REQUEST)
