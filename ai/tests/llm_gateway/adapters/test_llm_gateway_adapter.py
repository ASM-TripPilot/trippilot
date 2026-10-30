"""U4-06 — AnthropicAdapter 매핑 검증 (fake client, 실 API 0건 — BR-U4-10, D37).

record-and-return fake client로 (요청 매핑, 응답 매핑, 타임아웃 변환)만 검증.
실 API 스모크는 K-1 (결제 승인 후 백로그).
"""

from __future__ import annotations

from dataclasses import replace
from types import SimpleNamespace

import anthropic
import httpx
import pytest

from trippilot.llm_gateway.adapters.anthropic_adapter import AnthropicAdapter
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
    # temperature 미전달 — Claude 5 계열이 0.0 을 400 으로 거부 (2026-09-08, TRIP-377 과 같은 처방)
    assert "temperature" not in client.kwargs
    assert client.kwargs["timeout"] == 2.5  # BR-U4-04 타임아웃 전달
    assert client.kwargs["messages"] == [{"role": "user", "content": "점수를 매겨라"}]


def test_effort_unset_keeps_wire_shape() -> None:
    """effort 를 안 받는 모델(haiku-4-5)이 있다 — 미지정이면 파라미터째 안 보낸다."""
    client = RecordingClient()
    AnthropicAdapter(client).invoke(_REQUEST)

    assert "output_config" not in client.kwargs


def test_effort_goes_out_as_output_config() -> None:
    client = RecordingClient()
    AnthropicAdapter(client).invoke(replace(_REQUEST, effort="low"))

    assert client.kwargs["output_config"] == {"effort": "low"}


def test_gpt_only_effort_values_are_floored_to_low() -> None:
    """`none`·`minimal` 은 GPT 전용 — Anthropic 은 400 으로 거부한다(운영 PREFERENCE_SCORING 20/20 폴백)."""
    for gpt_only in ("none", "minimal"):
        client = RecordingClient()
        AnthropicAdapter(client).invoke(replace(_REQUEST, effort=gpt_only))

        assert client.kwargs["output_config"] == {"effort": "low"}


def test_anthropic_native_effort_values_pass_through() -> None:
    for native in ("low", "medium", "high", "xhigh", "max"):
        client = RecordingClient()
        AnthropicAdapter(client).invoke(replace(_REQUEST, effort=native))

        assert client.kwargs["output_config"] == {"effort": native}


def test_haiku_4_drops_effort_even_when_the_table_sets_one() -> None:
    """haiku-4-5 는 effort 를 **파라미터째** 거부한다 — 값을 낮추는 것으로는 안 된다."""
    for effort in ("none", "minimal", "low", "medium", "high", "xhigh", "max"):
        client = RecordingClient()
        AnthropicAdapter(client).invoke(
            replace(_REQUEST, model_id="claude-haiku-4-5", effort=effort)
        )

        assert "output_config" not in client.kwargs, effort


def test_haiku_5_5_keeps_effort() -> None:
    """5.5 세대는 effort 를 받는다(운영 파드 실호출) — 가드가 세대 접두로 좁혀 있는지 못박는다.

    접두를 `claude-haiku-` 로 넓히면 이 기능들의 effort 가 조용히 빠져 기본 사고로 돈다.
    """
    client = RecordingClient()
    AnthropicAdapter(client).invoke(
        replace(_REQUEST, model_id="claude-haiku-5-5", effort="low")
    )

    assert client.kwargs["output_config"] == {"effort": "low"}


def test_effort_none_or_unset_turns_thinking_off_only_where_the_model_can() -> None:
    """표의 `none`(사고 끔)·미지정은 haiku-5 에서 thinking disabled 로 나간다 — effort low 만으로는 적응형 사고가 켜져 도우미
    답변이 상한 512 를 사고로 다 썼고(2026-10-30 개발 4/4), 미지정이면 기본(더 깊은) 사고로 돈다. 표가 low 이상을 고른 기능은
    그대로. sonnet·opus 5.5 는 disabled 를 400 으로 거부하므로 보내지 않는다."""
    for model, effort, off in (("claude-haiku-5-5", "none", True), ("claude-haiku-5-5", None, True),
                               ("claude-haiku-5-5", "low", False), ("claude-sonnet-5-5", "none", False),
                               ("claude-sonnet-5-5", None, False), ("claude-opus-5-5", "none", False),
                               ("claude-haiku-4-5", "none", False), ("claude-haiku-4-5", None, False)):
        client = RecordingClient()
        AnthropicAdapter(client).invoke(replace(_REQUEST, model_id=model, effort=effort))

        assert (client.kwargs.get("thinking") == {"type": "disabled"}) is off, (model, effort)


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


# ── 이미지 입력 (2026-09-01 — vision 기능 Claude 배정에 따른 변환 구현) ─────


def test_no_images_keeps_plain_string_content() -> None:
    """이미지 없는 기존 호출의 와이어 모양 불변 — content는 종전처럼 문자열."""
    client = RecordingClient()
    AnthropicAdapter(client).invoke(_REQUEST)
    assert client.kwargs["messages"][0]["content"] == "점수를 매겨라"


def test_images_become_base64_blocks_before_text() -> None:
    """이미지는 base64 source 블록으로, 텍스트 앞에(권장 순서). 바이트 왕복 무손실."""
    import base64
    from dataclasses import replace as dc_replace

    from trippilot.ports.llm_port import LlmImagePart

    data = b"\x89PNG fake-bytes"
    part = LlmImagePart(media_type="image/png", data=data)
    client = RecordingClient()
    AnthropicAdapter(client).invoke(dc_replace(_REQUEST, images=(part, part)))

    content = client.kwargs["messages"][0]["content"]
    assert [b["type"] for b in content] == ["image", "image", "text"]
    for block in content[:2]:
        assert block["source"]["type"] == "base64"
        assert block["source"]["media_type"] == "image/png"
        assert base64.b64decode(block["source"]["data"]) == data
    assert content[2] == {"type": "text", "text": "점수를 매겨라"}


# ── 웹 검색 (2026-10-30 — PLACE_FACT_LOOKUP 벤더 폴백, OpenAI responses 표면과 같은 자리) ─────


class _WebSearchClient(RecordingClient):
    """웹 검색 응답 꼴 — 본문 인용(TextBlock.citations)과 검색 결과 블록(web_search_tool_result) 둘 다 낸다."""

    def __init__(self) -> None:
        cite = lambda url: SimpleNamespace(type="web_search_result_location", url=url)  # noqa: E731
        result = lambda url: SimpleNamespace(type="web_search_result", url=url)  # noqa: E731
        super().__init__(blocks=[
            SimpleNamespace(type="web_search_tool_result", content=[
                result("https://gyeongbokgungtickets.com/g"), result("https://royal.khs.go.kr/a")]),
            SimpleNamespace(type="text", text='{"hours": "09:00~18:00"}',
                             citations=[cite("https://royal.khs.go.kr/a"), cite("https://blog.example.com/b"),
                                        cite("https://royal.khs.go.kr/a")]),
        ])


def test_web_search_sends_the_server_tool_and_returns_cited_urls_only() -> None:
    client = _WebSearchClient()
    response = AnthropicAdapter(client).invoke(replace(_REQUEST, web_search=True))

    assert client.kwargs["tools"] == [{"type": "web_search_20250305", "name": "web_search"}]
    # 본문 인용 먼저, 그다음 검색이 본 결과 블록 — 순서 유지·중복 제거 (openai_adapter._citations 와 동형)
    assert response.citations == (
        "https://royal.khs.go.kr/a", "https://blog.example.com/b", "https://gyeongbokgungtickets.com/g",
    )


def test_without_web_search_sends_no_tool_and_no_citations() -> None:
    client = _WebSearchClient()
    response = AnthropicAdapter(client).invoke(_REQUEST)

    assert "tools" not in client.kwargs and response.citations == ()


def test_web_search_text_blocks_without_citations_still_join() -> None:
    """검색이 아무것도 못 찾았을 때도(citations 없는 text 블록) 본문은 그대로 이어붙는다 — 폭 보수."""
    client = RecordingClient(blocks=[SimpleNamespace(type="text", text="{}", citations=None)])
    response = AnthropicAdapter(client).invoke(replace(_REQUEST, web_search=True))

    assert response.raw_text == "{}" and response.citations == ()
