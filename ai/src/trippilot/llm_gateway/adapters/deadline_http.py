"""DeadlineTransport — LLM SDK(openai·anthropic) 호출에 **벽시계 총시간 상한**을 건다.

## 왜 (2026-10-18 개발 서버 생성 504)

SDK 에 넘기는 `timeout=` 은 httpx 의 연결·읽기·쓰기 **단위** 시한이다. 읽기 시한은
"바이트 사이 간격"이라 바이트가 조금씩 오면 총시간은 끝없이 늘어난다 — 시한 7.5s 호출이
16.7s 에 "성공"으로 끝났다. 동기 httpx 는 진행 중 요청을 밖에서 끊을 방법이 없어서,
워커가 포기한 청크의 스레드·커넥션이 504 뒤에도 살아 다음 요청을 굶겼다.

## 어떻게

SDK 는 동기 그대로 두고 전송 계층만 바꾼다. 요청을 백그라운드 이벤트 루프 하나에서
httpx 비동기 전송으로 보내고, 호출 스레드는 SDK 시한(`timeout["read"]`)만큼만 기다린다.
넘으면 그 태스크를 취소한다 — 비동기 httpx 는 취소 시 커넥션을 닫는다. 그리고
`httpx.ReadTimeout` 을 던져 SDK 가 `APITimeoutError` → 어댑터가 `LlmTimeoutError` 로
바꾸는 기존 경로(FallbackEvent·llm_cost success=False)를 그대로 탄다(INV-4).

시한 값은 바꾸지 않는다 — 종전엔 단위 시한이던 같은 값이 이제 총시간이다.
응답 본문은 전부 받아 돌려준다(스트리밍 미지원 — 이 리포는 쓰지 않는다).
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import threading

import httpx

_loop: asyncio.AbstractEventLoop | None = None
_loop_lock = threading.Lock()


def _background_loop() -> asyncio.AbstractEventLoop:
    global _loop
    with _loop_lock:
        if _loop is None:
            _loop = asyncio.new_event_loop()
            threading.Thread(
                target=_loop.run_forever, name="llm-deadline-loop", daemon=True
            ).start()
        return _loop


class DeadlineTransport(httpx.BaseTransport):
    """`httpx.Client(transport=DeadlineTransport())` 로 SDK 에 꽂는다."""

    def __init__(self) -> None:
        # SDK 기본 클라이언트와 같은 풀 한도 — transport 를 직접 주면 SDK 한도가 안 먹는다.
        # 쉬는 연결은 100s 까지 둔다(httpx 기본 5s). 5s 면 띄엄띄엄 오는 도우미 턴마다 첫 LLM 호출이 TCP+TLS 를 새로 맺는다
        # — 게이트웨이 왕복 ≈180ms·새 연결 ≈0.56s(2026-10-19 실측). 게이트웨이는 쉬는 연결을 120s 쉬어도 받고 240s 에는
        # 닫았다. 닫힌 연결은 풀이 꺼낼 때 걸러 새로 맺는다(httpcore — 읽을 수 있는 소켓 = 상대가 닫음).
        # ponytail: 프록시 env(HTTPS_PROXY)는 읽지 않는다 — 배포에 egress 프록시가 생기면 여기서 `proxy=`
        self._inner = httpx.AsyncHTTPTransport(
            limits=httpx.Limits(max_connections=1000, max_keepalive_connections=100, keepalive_expiry=100.0)
        )

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        total = (request.extensions.get("timeout") or {}).get("read")
        content = request.read()

        async def send() -> httpx.Response:
            req = httpx.Request(
                request.method, request.url, headers=request.headers,
                content=content, extensions=request.extensions,
            )
            resp = await self._inner.handle_async_request(req)
            try:
                # 원본 바이트 그대로 — 압축 해제는 바깥 httpx.Client 가 헤더를 보고 한다
                body = b"".join([chunk async for chunk in resp.aiter_raw()])
            finally:
                await resp.aclose()
            return httpx.Response(resp.status_code, headers=resp.headers, content=body)

        future = asyncio.run_coroutine_threadsafe(send(), _background_loop())
        try:
            return future.result(timeout=total)
        except concurrent.futures.TimeoutError:
            future.cancel()  # 루프 안 태스크 취소 → httpx 가 커넥션을 닫는다
            raise httpx.ReadTimeout(
                f"total deadline {total}s exceeded", request=request
            ) from None
