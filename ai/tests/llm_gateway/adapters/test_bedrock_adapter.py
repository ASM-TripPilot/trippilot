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


class ConnectionClosedError(Exception):
    """botocore 이름 그대로 — 어댑터는 이름으로 판정한다(벤더 격리)."""


class SSLError(Exception):
    pass


class _FlakyClient(_FakeClient):
    """첫 호출만 `first` 를 던지고 그다음은 성공 — 쉬는 동안 끊긴 keep-alive 연결."""

    def __init__(self, first: Exception) -> None:
        super().__init__(_ok("본문"))
        self._first = first

    def invoke_model(self, **kwargs):
        self.calls.append(kwargs)
        if len(self.calls) == 1:
            raise self._first
        return {"body": _Body(self._payload)}


@pytest.mark.parametrize("first", [
    ConnectionClosedError("Connection was closed before we received a valid response from endpoint URL"),
    SSLError("SSL validation failed ... [SSL: UNEXPECTED_EOF_WHILE_READING] EOF occurred in violation of protocol"),
])
def test_stale_keepalive_connection_is_retried_once(first) -> None:
    """배치 첫 요청이 끊긴 재사용 연결로 1~2ms 만에 실패하던 것(2026-11-02 운영 46건) — 새 연결로 한 번만 다시 보낸다."""
    client = _FlakyClient(first)
    out = BedrockAdapter(client, ARN).invoke(_request())
    assert out.raw_text == "본문" and len(client.calls) == 2


def test_stale_connection_that_fails_twice_is_not_retried_again() -> None:
    client = _FakeClient(raises=ConnectionClosedError("closed"))
    with pytest.raises(ConnectionClosedError):
        BedrockAdapter(client, ARN).invoke(_request())
    assert len(client.calls) == 2  # 한 번만 더 — 재시도 사다리를 만들지 않는다(09-29 504)


def test_slow_connection_failure_is_not_retried(monkeypatch) -> None:
    """늦게 끊긴 것은 서버가 받았을 수 있다 — 다시 보내면 예산을 두 번 쓴다."""
    import trippilot.llm_gateway.adapters.bedrock_adapter as mod

    ticks = iter([0.0, 2.0, 2.0])  # 시작 → 실패 시점(2초 뒤) → (쓰이지 않음)
    monkeypatch.setattr(mod.time, "monotonic", lambda: next(ticks))
    client = _FakeClient(raises=ConnectionClosedError("closed"))
    with pytest.raises(ConnectionClosedError):
        BedrockAdapter(client, ARN).invoke(_request())
    assert len(client.calls) == 1


def test_other_ssl_errors_are_not_retried() -> None:
    client = _FakeClient(raises=SSLError("certificate verify failed"))
    with pytest.raises(SSLError):
        BedrockAdapter(client, ARN).invoke(_request())
    assert len(client.calls) == 1


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


# ── 예산 관통 (2026-09-29 실서비스 504 의 원인) ──────────────────────────────
#
# 실측: `/ai/v1/notification/copies` 가 항목 2건에 각 11.9초·8.3초를 쓰고 백스톱 13초에
# 걸려 504 를 냈다(trace f2c6722d). 강등 경로 자체는 맞게 돌았지만 **강등 응답을 만들기
# 전에** 백스톱이 터졌다. 원인은 둘이다 — 어댑터가 `timeout_sec` 를 아예 안 쓰고,
# 클라이언트에 재시도 설정이 없어 botocore 기본 재시도가 콜드스타트 오류를 4번 반복했다.


class _RecordingFactory:
    """timeout 별 클라이언트를 만드는 팩토리 — main 의 조립을 흉내낸다."""

    def __init__(self, client) -> None:
        self._client = client
        self.timeouts: list[float | None] = []

    def __call__(self, timeout_sec):
        self.timeouts.append(timeout_sec)
        return self._client


def test_per_call_budget_reaches_the_client() -> None:
    """항목당 예산이 클라이언트까지 내려가야 한다 — botocore 는 호출 인자로 못 받는다.

    그래서 타임아웃별 클라이언트를 만드는 팩토리를 받는다. 이게 없으면 워커가 나눈
    4초가 어디에도 전달되지 않고, 한 항목이 요청 예산 전체를 먹는다.
    """
    factory = _RecordingFactory(_FakeClient(_ok("본문")))
    BedrockAdapter(factory, ARN).invoke(_request(timeout_sec=4.0))

    assert factory.timeouts == [4.0]


def test_same_budget_reuses_one_client() -> None:
    # 호출마다 새로 만들면 서비스 모델 로딩이 매번 붙는다(수십 ms~).
    factory = _RecordingFactory(_FakeClient(_ok("본문")))
    adapter = BedrockAdapter(factory, ARN)
    adapter.invoke(_request(timeout_sec=4.0))
    adapter.invoke(_request(timeout_sec=4.0))
    adapter.invoke(_request(timeout_sec=2.0))

    assert factory.timeouts == [4.0, 2.0]


def test_a_plain_client_still_works() -> None:
    # 기존 호출 방식(클라이언트 직접 주입)을 깨지 않는다 — 테스트·스크립트가 쓴다.
    client = _FakeClient(_ok("본문"))
    assert BedrockAdapter(client, ARN).invoke(_request()).raw_text == "본문"


def test_cold_start_through_the_factory_is_still_a_timeout() -> None:
    # 팩토리 경로에서도 콜드스타트가 폴백 계단으로 간다(강등, 500 아님).
    class _Cold(_FakeClient):
        def invoke_model(self, **kwargs):
            class ModelNotReadyException(Exception):
                pass

            raise ModelNotReadyException("cold start (reached max retries: 4)")

    factory = _RecordingFactory(_Cold())
    with pytest.raises(LlmTimeoutError):
        BedrockAdapter(factory, ARN).invoke(_request(timeout_sec=4.0))
    assert factory.timeouts == [4.0]
