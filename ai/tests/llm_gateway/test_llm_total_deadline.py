"""LLM 호출 벽시계 총시간 상한 (DeadlineTransport) — 2026-10-18 개발 서버 생성 504.

SDK `timeout=` 은 바이트 간격 기준이라, 바이트를 조금씩 흘리는 서버 앞에서 시한
7.5s 호출이 16.7s 에 "성공"했다. 로컬 가짜 서버(127.0.0.1)로 재현한다 — 실 API 0건.

증명하는 것:
  ① 시한 T 에서 T+여유 안에 LlmTimeoutError, 서버 쪽 소켓이 실제로 닫힌다 (openai·anthropic)
  ② 점수 워커가 청크를 포기한 뒤 잔여 호출 0 — 서버 커넥션·스레드가 남지 않는다
  ③ 정상 응답(gzip 포함)은 종전 그대로
  ④ 운영 조립(main.py)의 세 LLM 클라이언트가 이 전송을 쓴다
"""

from __future__ import annotations

import gzip
import http.server
import json
import socketserver
import threading
import time

import anthropic
import openai
import pytest

import main
from trippilot.domain.llm import LlmFeature
from trippilot.llm_gateway.adapters.anthropic_adapter import AnthropicAdapter
from trippilot.llm_gateway.adapters.deadline_http import DeadlineTransport
from trippilot.llm_gateway.adapters.openai_adapter import OpenAIAdapter
from trippilot.ports.llm_port import LlmRequest, LlmTimeoutError
from tests.llm_gateway.test_llm_gateway_preference_wallclock import (
    _NOW, _PERSONA, _TRACE_ID, _fast_cfg, _pool, _worker,
)

_RESPONSES_BODY = json.dumps({
    "id": "r", "object": "response", "created_at": 0, "model": "m", "status": "completed",
    "output": [{"type": "message", "id": "m1", "role": "assistant", "status": "completed",
                "content": [{"type": "output_text", "text": "hi", "annotations": []}]}],
    "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2,
              "input_tokens_details": {"cached_tokens": 0},
              "output_tokens_details": {"reasoning_tokens": 0}},
    "parallel_tool_calls": False, "tool_choice": "auto", "tools": [],
}).encode()


class _Server:
    """mode="trickle": 헤더 후 공백 1바이트씩 끝없이(본문 미완) / "gzip": 즉시 gzip 응답."""

    def __init__(self, mode: str) -> None:
        state = self
        self.open = 0
        self.closed = threading.Event()
        self._lock = threading.Lock()

        class H(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def do_POST(self) -> None:
                self.rfile.read(int(self.headers["Content-Length"]))
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                if mode == "gzip":
                    body = gzip.compress(_RESPONSES_BODY)
                    self.send_header("Content-Encoding", "gzip")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                self.send_header("Content-Length", "100000")
                self.end_headers()
                with state._lock:
                    state.open += 1
                try:
                    for _ in range(200):  # 최대 10s — 클라이언트가 끊으면 쓰기 실패로 빠진다
                        time.sleep(0.05)
                        self.wfile.write(b" ")
                        self.wfile.flush()
                except OSError:
                    state.closed.set()
                finally:
                    with state._lock:
                        state.open -= 1

            def log_message(self, *args) -> None:
                pass

        self._srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), H)
        self._srv.daemon_threads = True
        threading.Thread(target=self._srv.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self._srv.server_address[1]}"

    def stop(self) -> None:
        self._srv.shutdown()
        self._srv.server_close()


@pytest.fixture
def trickle():
    s = _Server("trickle")
    yield s
    s.stop()


def _openai(url: str) -> OpenAIAdapter:
    client = openai.OpenAI(
        api_key="x", base_url=f"{url}/v1", max_retries=0,
        http_client=openai.DefaultHttpxClient(transport=DeadlineTransport()),
    )
    return OpenAIAdapter(client, api="responses")


def _anthropic(url: str) -> AnthropicAdapter:
    client = anthropic.Anthropic(
        api_key="x", base_url=url, max_retries=0,
        http_client=anthropic.DefaultHttpxClient(transport=DeadlineTransport()),
    )
    return AnthropicAdapter(client)


def _req(timeout_sec: float) -> LlmRequest:
    return LlmRequest(model_id="m", prompt="p", prompt_ref=None, max_tokens=10,
                      timeout_sec=timeout_sec)


def _wait_until(cond, sec: float = 2.0) -> bool:
    end = time.monotonic() + sec
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.02)
    return cond()


@pytest.mark.parametrize("make", [_openai, _anthropic], ids=["openai", "anthropic"])
def test_trickling_server_is_cut_at_total_deadline(trickle, make) -> None:
    adapter = make(trickle.url)
    started = time.monotonic()
    with pytest.raises(LlmTimeoutError):
        adapter.invoke(_req(0.5))
    elapsed = time.monotonic() - started
    # 상한은 서버 흘림(최대 10s)의 절반 — 느린 CI 러너에서 벽시계가 밀려도(1.67s 관측) 깜빡이지 않게.
    # 종전 결함이면 흘림이 끝날 때까지(≈10s) 걸리므로 5s 로도 회귀는 잡힌다.
    assert 0.45 <= elapsed < 5.0, elapsed  # 종전: 바이트가 오는 한 무한
    assert trickle.closed.wait(5.0), "취소 뒤 커넥션이 닫혀야 한다"
    assert _wait_until(lambda: trickle.open == 0)


def test_preference_worker_leaves_no_inflight_calls_after_deadline(trickle) -> None:
    worker, _ = _worker(_openai(trickle.url), _fast_cfg())
    baseline = threading.active_count()
    started = time.monotonic()
    result = worker.score(_pool(40), _PERSONA, _TRACE_ID, _NOW, timeout_sec=0.5)
    assert time.monotonic() - started < 5.0  # 위와 같은 이유로 흘림 길이의 절반
    assert result.is_fallback  # 전 청크 시한 초과 → 기존 폴백 신호 (INV-4)
    assert _wait_until(lambda: trickle.open == 0), "포기한 청크의 호출이 서버에 남았다"
    # 청크 스레드도 시한에 풀려 끝난다(백그라운드 루프 스레드 1개만 남을 수 있다)
    assert _wait_until(lambda: threading.active_count() <= baseline + 1)


def test_normal_gzip_response_unchanged() -> None:
    s = _Server("gzip")
    try:
        resp = _openai(s.url).invoke(_req(5.0))
    finally:
        s.stop()
    assert resp.raw_text == "hi"
    assert (resp.input_tokens, resp.output_tokens) == (1, 1)


def test_main_llm_clients_use_deadline_transport(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-no-real-call")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key-no-real-call")
    monkeypatch.setenv("TRIPPILOT_LOCAL_LLM_BASE_URL", "http://127.0.0.1:9")
    monkeypatch.delenv("TRIPPILOT_BEDROCK_MODEL_ARN", raising=False)
    openai_llm, _ = main._openai_llm_and_model()
    anthropic_llm, _ = main._anthropic_llm_and_model()
    local_llm = next(iter(main._local_route({LlmFeature.REMINDER_COPY: "local-x"}).values()))
    for llm in (openai_llm, anthropic_llm, local_llm):
        assert isinstance(llm._client._client._transport, DeadlineTransport)
