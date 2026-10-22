"""TRIP-340 — OpenAIAdapter 매핑 검증 (fake client, 실 API 0건 — BR-U4-10, D37).

record-and-return fake client로 (요청 매핑, 응답 매핑, 타임아웃 변환)만 검증 —
test_c1_adapter.py(AnthropicAdapter)와 동형. 실 API 스모크는 scripts/smoke/smoke_llm.py
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
    assert "temperature" not in client.kwargs  # GPT-5 계열 거부 — 미전달 (TRIP-377)
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
    assert "temperature" not in client.kwargs  # GPT-5 계열 거부 — 미전달 (TRIP-377)
    assert client.kwargs["timeout"] == 2.5  # BR-U4-04 타임아웃 전달
    assert client.kwargs["input"] == "점수를 매겨라"


def test_responses_response_mapping_records_usage_tokens() -> None:
    response = OpenAIAdapter(RecordingResponsesClient(), api="responses").invoke(_REQUEST)

    assert response.raw_text == '{"scores": []}'
    assert response.input_tokens == 12 and response.output_tokens == 7
    assert response.model_id == "model-under-test"


def test_responses_carries_effort_as_reasoning() -> None:
    """기능별 effort(`C1Config.effort_for`)를 Responses `reasoning.effort` 로 싣는다.

    실측(2026-10-14): gpt-5.6-sol·terra·luna 모두 `low` 를 200 으로 받는다 — 거부 모델 없음.
    """
    from dataclasses import replace

    client = RecordingResponsesClient()
    OpenAIAdapter(client, api="responses").invoke(replace(_REQUEST, effort="low"))

    assert client.kwargs is not None
    assert client.kwargs["reasoning"] == {"effort": "low"}


def test_responses_without_effort_sends_no_reasoning() -> None:
    client = RecordingResponsesClient()
    OpenAIAdapter(client, api="responses").invoke(_REQUEST)

    assert client.kwargs is not None
    assert "reasoning" not in client.kwargs  # 미지정 = 모델 기본값


def test_chat_never_sends_effort() -> None:
    """chat 표면은 추론 파라미터를 싣지 않는다 — 로컬 서빙(MLX·vLLM)이 이 표면을 쓴다."""
    from dataclasses import replace

    client = RecordingClient()
    OpenAIAdapter(client).invoke(replace(_REQUEST, effort="low"))

    assert client.kwargs is not None
    assert "reasoning_effort" not in client.kwargs and "reasoning" not in client.kwargs


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


class _WebSearchClient(RecordingResponsesClient):
    """웹 검색 응답 꼴(멘토 게이트웨이 2026-10-22 실측) — 메시지 content 의 url_citation annotation."""

    def _create(self, **kwargs):
        self.kwargs = kwargs
        cite = lambda url: SimpleNamespace(type="url_citation", url=url)  # noqa: E731
        message = SimpleNamespace(type="message", content=[SimpleNamespace(
            type="output_text", text="{}", annotations=[cite("https://royal.khs.go.kr/a"), cite("https://blog.example.com/b"),
                                                       cite("https://royal.khs.go.kr/a")])])
        search = SimpleNamespace(type="web_search_call", action=SimpleNamespace(
            sources=[SimpleNamespace(url="https://gyeongbokgungtickets.com/g"), {"url": "https://royal.khs.go.kr/a"}]))
        return SimpleNamespace(output_text='{"hours": "09:00~18:00"}', output=[search, message],
                               usage=SimpleNamespace(input_tokens=12, output_tokens=7), model=kwargs["model"])


def test_responses_web_search_sends_the_tool_and_returns_cited_urls_only() -> None:
    from dataclasses import replace

    client = _WebSearchClient()
    response = OpenAIAdapter(client, api="responses").invoke(replace(_REQUEST, web_search=True))
    assert client.kwargs["tools"] == [{"type": "web_search"}]
    assert client.kwargs["include"] == ["web_search_call.action.sources"]  # JSON 만 내면 본문 인용이 안 붙는다
    # 본문 인용 먼저, 그다음 검색이 본 출처 — 순서 유지·중복 제거
    assert response.citations == ("https://royal.khs.go.kr/a", "https://blog.example.com/b", "https://gyeongbokgungtickets.com/g")


def test_responses_without_web_search_sends_no_tools_and_no_citations() -> None:
    client = _WebSearchClient()
    response = OpenAIAdapter(client, api="responses").invoke(_REQUEST)
    assert "tools" not in client.kwargs and "include" not in client.kwargs and response.citations == ()


def test_chat_surface_refuses_web_search_instead_of_silently_dropping_it() -> None:
    from dataclasses import replace

    import pytest

    from trippilot.ports.llm_port import LlmUnsupportedError

    with pytest.raises(LlmUnsupportedError):
        OpenAIAdapter(RecordingResponsesClient(), api="chat").invoke(replace(_REQUEST, web_search=True))
