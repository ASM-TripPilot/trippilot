"""U4-06 — AnthropicAdapter 매핑 검증 (fake client, 실 API 0건 — BR-U4-10, D37).

record-and-return fake client로 (요청 매핑, 응답 매핑, 타임아웃 변환)만 검증.
실 API 스모크는 K-1 (결제 승인 후 백로그).
"""

from __future__ import annotations

from types import SimpleNamespace

import anthropic
import httpx
import pytest

from trippilot.c1.adapters.anthropic_adapter import AnthropicAdapter
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

_HTTPX_REQ = httpx.Request("POST", "https://api.anthropic.com/v1/messages")


class RecordingClient:
    """messages.create 호출을 기록하고 준비된 응답을 돌려주는 fake."""

    def __init__(self, blocks=None) -> None:
        self.kwargs: dict | None = None
        self._blocks = (
            blocks
            if blocks is not None
            else [SimpleNamespace(type="text", text='{"scores": []}')]
        )
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kwargs):
        self.kwargs = kwargs
        return SimpleNamespace(
            content=self._blocks,
            usage=SimpleNamespace(input_tokens=12, output_tokens=7),
            model=kwargs["model"],
        )


def test_request_mapping_is_faithful() -> None:
    client = RecordingClient()
    AnthropicAdapter(client).invoke(_REQUEST)

    assert client.kwargs is not None
    assert client.kwargs["model"] == "model-under-test"
    assert client.kwargs["max_tokens"] == 1024
    assert client.kwargs["temperature"] == 0.0
    assert client.kwargs["timeout"] == 2.5  # BR-U4-04 타임아웃 전달
    assert client.kwargs["messages"] == [{"role": "user", "content": "점수를 매겨라"}]


def test_response_mapping_and_multi_block_join() -> None:
    client = RecordingClient(
        blocks=[
            SimpleNamespace(type="text", text='{"scores": '),
            SimpleNamespace(type="tool_use", text="무시되어야 함"),
            SimpleNamespace(type="text", text="[]}"),
        ]
    )
    response = AnthropicAdapter(client).invoke(_REQUEST)

    assert response.raw_text == '{"scores": []}'  # text 블록만 이어붙임
    assert response.input_tokens == 12 and response.output_tokens == 7
    assert response.model_id == "model-under-test"
    assert response.latency_ms >= 0


def test_sdk_timeout_becomes_llm_timeout_error() -> None:
    class TimeoutClient:
        def __init__(self) -> None:
            self.messages = SimpleNamespace(create=self._create)

        def _create(self, **kwargs):
            raise anthropic.APITimeoutError(request=_HTTPX_REQ)

    with pytest.raises(LlmTimeoutError):
        AnthropicAdapter(TimeoutClient()).invoke(_REQUEST)


def test_other_api_errors_propagate_for_gateway_to_convert() -> None:
    class BrokenClient:
        def __init__(self) -> None:
            self.messages = SimpleNamespace(create=self._create)

        def _create(self, **kwargs):
            raise anthropic.APIConnectionError(request=_HTTPX_REQ)

    # LlmTimeoutError로 둔갑시키지 않고 그대로 — 게이트웨이가 llm_error 폴백으로 수렴
    with pytest.raises(anthropic.APIConnectionError):
        AnthropicAdapter(BrokenClient()).invoke(_REQUEST)
