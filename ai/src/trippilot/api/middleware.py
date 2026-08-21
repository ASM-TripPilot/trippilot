"""API 미들웨어 3종 — rate-limit · 요청 계측(trace) · 타임아웃 백스톱 (U5-04, TRIP-240).

전부 **순수 ASGI 계층**이다 — FastAPI 라우트·`responses` 선언을 건드리지 않으므로
openapi 계약 스냅샷(`ai/docs/openapi.json`)은 불변이다(계약 동결, 결정4).
오류 응답 바디는 `errors.py`와 같은 계약 형식(`ErrorBody`)을 재사용한다.

계약 주의 — 백스톱 vs 200+폴백(PR #104·TRIP-291):
  정상적인 deadline 소진은 오류가 아니다. C2 체인 최후 보루(required_ms=0)가
  시한과 무관하게 실행돼 **200 + MINIMAL + is_fallback=true**로 수렴한다.
  여기의 타임아웃 백스톱은 그 보장 **위의 마지막 방어선**(프로세스 행 등 비정상
  상황)이며, `request_meta.deadline_ms + margin`(기본 5초)에서만 발동한다 —
  deadline보다 항상 뒤이므로 정상 폴백 흐름과 겹치지 않는다.

env (전부 선택 — 기본값은 관대하게, 통합테스트·로컬 개발을 방해하지 않는다):
  - `TRIPPILOT_RATE_LIMIT_RPS`   초당 토큰 충전율(기본 100). 0 이하 = rate-limit 비활성.
  - `TRIPPILOT_RATE_LIMIT_BURST` 버킷 용량(기본 1000).
  - `TRIPPILOT_TIMEOUT_MARGIN_MS`  deadline 위 여유 마진(기본 5000).
  - `TRIPPILOT_TIMEOUT_DEFAULT_MS` 바디에 deadline이 없을 때의 기준값(기본 600000
    — deadline 미지정=시간제약 없음(TRIP-473) 결정 이후 이 백스톱은 행(hang) 방지
    안전망만 맡는다; 제약 복원은 백엔드가 deadline_ms를 다시 실으면 된다).
  잘못된 값(파싱 불가·비양수 마진)은 기동 실패로 **드러낸다**(설정 오류 은폐 금지).

INV-4: rate-limit·백스톱 발동은 조용히 지나가지 않는다 — 구조화 로그(warning/error)
+ 계약 오류 바디로 드러난다. 로그의 `elapsed_ms`는 서버 운영 계측이지 사용자 표시가
아니다(INV-3는 표시 계층 규칙 — 응답 바디·헤더에 소요시간을 싣지 않는다).

저장소·외부 의존 없음: rate-limit은 in-memory 토큰버킷이다(단일 프로세스 전제 —
Redis류는 측정된 필요가 생길 때까지 이연, anti-patterns.md "스텁 단계 캐시 금지" 동형).
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import re
import time
import uuid
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Mapping

from fastapi import FastAPI

from trippilot.api.schemas import ErrorBody

_Scope = dict[str, Any]
_Message = dict[str, Any]
_Receive = Callable[[], Awaitable[_Message]]
_Send = Callable[[_Message], Awaitable[None]]
_AsgiApp = Callable[[_Scope, _Receive, _Send], Awaitable[None]]

_logger = logging.getLogger("trippilot.api.middleware")
_request_logger = logging.getLogger("trippilot.api.request")

# 오류 코드 — errors.py의 코드 계열과 같은 결(문자열 안정성 유지). 429/504는
# 라우트 밖(미들웨어)에서만 나가므로 여기서 소유한다(errors.py는 계약 동결).
CODE_RATE_LIMITED = "RATE_LIMITED"
CODE_TIMEOUT_BACKSTOP = "TIMEOUT_BACKSTOP"

_META_SCOPE_KEY = "trippilot.request_meta"
_TRACE_SCOPE_KEY = "trippilot.trace_id"
_TRACE_HEADER = b"x-trace-id"
# trace_id는 응답 헤더로 되돌아간다 — 헤더에 안전한 문자만 통과시킨다.
_TRACE_UNSAFE = re.compile(r"[^0-9A-Za-z._\-]")


# ───────────────────────── 설정 ─────────────────────────


@dataclass(frozen=True)
class MiddlewareSettings:
    """미들웨어 파라미터. 기본값은 관대하다 — 테스트·로컬을 방해하지 않는 수준."""

    rate_limit_rps: float = 100.0
    rate_limit_burst: int = 1000
    timeout_margin_ms: int = 5000
    timeout_default_deadline_ms: int = 600000  # 행 방지 안전망 (TRIP-473 — 시간제약 아님)

    def __post_init__(self) -> None:
        if self.timeout_margin_ms <= 0:
            raise ValueError(
                f"timeout_margin_ms는 양수여야 한다(got {self.timeout_margin_ms}) — "
                "마진 0이면 백스톱이 정상 deadline 폴백(200+MINIMAL)과 겹친다."
            )
        if self.timeout_default_deadline_ms <= 0:
            raise ValueError(
                f"timeout_default_deadline_ms는 양수여야 한다"
                f"(got {self.timeout_default_deadline_ms})"
            )
        if self.rate_limit_burst < 1:
            raise ValueError(f"rate_limit_burst는 1 이상이어야 한다(got {self.rate_limit_burst})")

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "MiddlewareSettings":
        """env → 설정. 파싱 불가 값은 예외로 **기동 실패** — 설정 오류를 은폐하지 않는다."""
        source = os.environ if env is None else env

        def _read(name: str, parse: Callable[[str], Any], default: Any) -> Any:
            raw = source.get(name)
            if raw is None or raw == "":  # 빈 문자열도 미설정(main._env 동형)
                return default
            return parse(raw)

        return cls(
            rate_limit_rps=_read("TRIPPILOT_RATE_LIMIT_RPS", float, cls.rate_limit_rps),
            rate_limit_burst=_read("TRIPPILOT_RATE_LIMIT_BURST", int, cls.rate_limit_burst),
            timeout_margin_ms=_read("TRIPPILOT_TIMEOUT_MARGIN_MS", int, cls.timeout_margin_ms),
            timeout_default_deadline_ms=_read(
                "TRIPPILOT_TIMEOUT_DEFAULT_MS", int, cls.timeout_default_deadline_ms
            ),
        )


# ───────────────────── 요청 바디 메타(공유 헬퍼) ─────────────────────


@dataclass(frozen=True)
class WireMeta:
    """요청 바디 `request_meta`에서 미들웨어가 쓰는 절편(IO-1). 없으면 None — 지어내지 않는다."""

    request_id: str | None
    deadline_ms: int | None


def parse_wire_meta(body: bytes) -> WireMeta:
    """바디 JSON에서 `request_meta.{request_id,deadline_ms}`를 방어적으로 읽는다.

    형태가 예상 밖이면 그 필드만 None으로 둔다(관측용 읽기 경로 — 전체 실패로
    승격하지 않는다; 스키마 검증·422는 라우트 계층 몫이다).
    """
    if not body:
        return WireMeta(None, None)
    try:
        doc = json.loads(body)
    except ValueError:
        return WireMeta(None, None)
    if not isinstance(doc, dict):
        return WireMeta(None, None)
    meta = doc.get("request_meta")
    if not isinstance(meta, dict):
        return WireMeta(None, None)
    request_id = meta.get("request_id")
    deadline = meta.get("deadline_ms")
    return WireMeta(
        request_id=request_id if isinstance(request_id, str) and request_id else None,
        deadline_ms=(
            deadline
            if isinstance(deadline, int) and not isinstance(deadline, bool) and deadline > 0
            else None
        ),
    )


async def _wire_meta(scope: _Scope, receive: _Receive) -> tuple[WireMeta, _Receive]:
    """바디를 한 번만 버퍼링해 메타를 뽑고, 하위 계층에 재생용 receive를 돌려준다.

    파싱 결과는 scope에 캐시된다 — trace·timeout 미들웨어가 이중 버퍼링하지 않는다.
    (경계 요청은 전부 소형 JSON — 스트리밍 업로드는 이 API에 없다.)
    """
    cached = scope.get(_META_SCOPE_KEY)
    if cached is not None:
        return cached, receive

    queued: list[_Message] = []
    chunks: list[bytes] = []
    while True:
        message = await receive()
        queued.append(message)
        if message["type"] != "http.request":  # http.disconnect 등 — 그대로 재생만 한다
            break
        chunks.append(message.get("body", b""))
        if not message.get("more_body", False):
            break

    meta = parse_wire_meta(b"".join(chunks))
    scope[_META_SCOPE_KEY] = meta

    async def replay() -> _Message:
        if queued:
            return queued.pop(0)
        return await receive()

    return meta, replay


# ───────────────────── 오류 응답(계약 바디) ─────────────────────


def _error_body_bytes(error_code: str, message: str) -> bytes:
    """errors.py와 같은 계약 형식 `{error_code, message, retryable:false}` 재사용."""
    return ErrorBody(error_code=error_code, message=message, retryable=False).model_dump_json().encode("utf-8")


async def _send_error(
    send: _Send, status: int, error_code: str, message: str,
    extra_headers: tuple[tuple[bytes, bytes], ...] = (),
) -> None:
    body = _error_body_bytes(error_code, message)
    headers = [
        (b"content-type", b"application/json"),
        (b"content-length", str(len(body)).encode("ascii")),
        *extra_headers,
    ]
    await send({"type": "http.response.start", "status": status, "headers": headers})
    await send({"type": "http.response.body", "body": body})


# ───────────────────── 1) 요청 계측(trace) ─────────────────────


class TraceMiddleware:
    """trace_id 결정 + 구조화 요청 로그 + 응답 헤더 반영.

    trace_id 우선순위: `x-trace-id` 헤더 → 바디 `request_meta.request_id` → 생성(uuid4).
    완료 시 한 줄 JSON 로그(method·path·status·elapsed_ms) — 429·504 포함 모든
    응답이 여기서 드러난다(INV-4).
    """

    def __init__(self, app: _AsgiApp) -> None:
        self.app = app

    async def __call__(self, scope: _Scope, receive: _Receive, send: _Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        trace_id = _header_trace_id(scope)
        meta, receive = await _wire_meta(scope, receive)
        if trace_id is None:
            trace_id = _sanitize_trace_id(meta.request_id) or uuid.uuid4().hex
        scope[_TRACE_SCOPE_KEY] = trace_id  # 하위 계층(백스톱 로그 등)이 재사용

        status: int | None = None
        started_at = time.monotonic()

        async def send_with_trace(message: _Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                message = {
                    **message,
                    "headers": [
                        *message.get("headers", []),
                        (_TRACE_HEADER, trace_id.encode("ascii")),
                    ],
                }
            await send(message)

        try:
            await self.app(scope, receive, send_with_trace)
        finally:
            elapsed_ms = int((time.monotonic() - started_at) * 1000)
            _request_logger.info(json.dumps({
                "event": "http_request",
                "trace_id": trace_id,
                "method": scope.get("method"),
                "path": scope.get("path"),
                "status": status,  # None = 응답 미발신(연결 단절 등) — 그것도 사실대로
                "elapsed_ms": elapsed_ms,
            }, ensure_ascii=False))


def _header_trace_id(scope: _Scope) -> str | None:
    for name, value in scope.get("headers", []):
        if name.lower() == _TRACE_HEADER:
            return _sanitize_trace_id(value.decode("latin-1"))
    return None


def _sanitize_trace_id(raw: str | None) -> str | None:
    if raw is None:
        return None
    cleaned = _TRACE_UNSAFE.sub("", raw)[:128]
    return cleaned or None


# ───────────────────── 2) rate-limit(토큰버킷) ─────────────────────


class RateLimitMiddleware:
    """클라이언트(IP)별 in-memory 토큰버킷. 초과 시 429 + 계약 오류 바디.

    `/health`·`/`는 면제 — 인프라(compose 헬스체크) 폴링을 막지 않는다.
    단일 프로세스 전제(외부 저장소 이연 — 모듈 docstring 참조).
    """

    EXEMPT_PATHS = frozenset({"/health", "/"})
    _MAX_BUCKETS = 1024  # 키 폭주 방어 — 초과 시 가득 찬(=휴면) 버킷부터 버린다

    def __init__(
        self, app: _AsgiApp, rps: float, burst: int,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.app = app
        self.rps = float(rps)
        self.burst = float(burst)
        self.clock = clock
        self._buckets: dict[str, tuple[float, float]] = {}  # key -> (tokens, refreshed_at)

    async def __call__(self, scope: _Scope, receive: _Receive, send: _Send) -> None:
        if (
            scope["type"] != "http"
            or self.rps <= 0  # 비활성 스위치
            or scope.get("path") in self.EXEMPT_PATHS
        ):
            await self.app(scope, receive, send)
            return

        client = scope.get("client")
        key = client[0] if client else "unknown"
        if self._acquire(key):
            await self.app(scope, receive, send)
            return

        retry_after = max(1, math.ceil(1.0 / self.rps))
        _logger.warning(json.dumps({  # INV-4 — 발동을 로그로 드러낸다
            "event": "rate_limited",
            "trace_id": scope.get(_TRACE_SCOPE_KEY),
            "client": key,
            "path": scope.get("path"),
            "retry_after_sec": retry_after,
        }, ensure_ascii=False))
        await _send_error(
            send, 429, CODE_RATE_LIMITED,
            "요청이 너무 잦습니다 — 잠시 후 다시 시도하세요.",
            extra_headers=((b"retry-after", str(retry_after).encode("ascii")),),
        )

    def _acquire(self, key: str) -> bool:
        now = self.clock()
        tokens, refreshed_at = self._buckets.get(key, (self.burst, now))
        tokens = min(self.burst, tokens + (now - refreshed_at) * self.rps)
        if tokens >= 1.0:
            self._buckets[key] = (tokens - 1.0, now)
            self._prune(now)
            return True
        self._buckets[key] = (tokens, now)
        return False

    def _prune(self, now: float) -> None:
        if len(self._buckets) <= self._MAX_BUCKETS:
            return
        for key, (tokens, refreshed_at) in list(self._buckets.items()):
            if tokens + (now - refreshed_at) * self.rps >= self.burst:
                del self._buckets[key]


# ───────────────────── 3) 타임아웃 백스톱 ─────────────────────


def backstop_ms(deadline_ms: int | None, margin_ms: int, default_deadline_ms: int) -> int:
    """백스톱 발동 시점 = deadline + margin — deadline보다 **항상 뒤**다.

    정상 deadline 소진은 C2 최후 보루가 200+MINIMAL로 수렴시킨다(TRIP-291);
    백스톱은 그 이후까지 응답이 없는 비정상(행)에서만 발동한다.
    """
    base = deadline_ms if deadline_ms is not None else default_deadline_ms
    return base + margin_ms


class TimeoutBackstopMiddleware:
    """서버측 최후 방어선 — `deadline_ms + margin`까지 응답이 없으면 504.

    정상 흐름과의 비간섭: 발동 시점이 deadline보다 margin만큼 뒤이므로, C2가
    보장하는 200+폴백(TRIP-291)이 먼저 나간다. 여기 도달했다는 것 자체가
    그 보장이 깨진 비정상(프로세스 행 등)이라는 뜻이다.

    한계(의도된 설계): sync 라우트는 스레드풀에서 돌므로 cancel이 스레드를
    죽이진 못한다 — 응답(504)은 즉시 나가고, 유기된 태스크의 늦은 발신은
    폐기된다(이미 로그로 드러난 뒤다). 이미 응답이 시작된 뒤에 발동하면
    504를 덧보낼 수 없어 연결 절단으로 끝난다(로그는 남는다).
    """

    def __init__(self, app: _AsgiApp, margin_ms: int, default_deadline_ms: int) -> None:
        self.app = app
        self.margin_ms = margin_ms
        self.default_deadline_ms = default_deadline_ms

    async def __call__(self, scope: _Scope, receive: _Receive, send: _Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        meta, receive = await _wire_meta(scope, receive)
        limit_ms = backstop_ms(meta.deadline_ms, self.margin_ms, self.default_deadline_ms)

        response_started = False
        timed_out = False

        async def guarded_send(message: _Message) -> None:
            nonlocal response_started
            if timed_out:
                return  # 유기된 태스크의 늦은 발신 폐기 — 이미 504 발신·로그됨
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        task = asyncio.ensure_future(self.app(scope, receive, guarded_send))
        done, _ = await asyncio.wait({task}, timeout=limit_ms / 1000.0)

        if task in done:
            exc = task.exception()
            if exc is not None:
                raise exc
            return

        timed_out = True
        task.cancel()  # best-effort — 스레드풀 작업은 못 죽인다(위 docstring)
        task.add_done_callback(_log_abandoned_task)
        _logger.error(json.dumps({  # INV-4 — 침묵 금지: 백스톱 발동은 error로 드러난다
            "event": "timeout_backstop",
            "trace_id": scope.get(_TRACE_SCOPE_KEY),
            "path": scope.get("path"),
            "deadline_ms": meta.deadline_ms,
            "backstop_ms": limit_ms,
            "response_started": response_started,
        }, ensure_ascii=False))
        if not response_started:
            await _send_error(
                send, 504, CODE_TIMEOUT_BACKSTOP,
                f"서버가 {limit_ms}ms(deadline+margin) 내에 응답하지 못했습니다 — "
                "정상 deadline 폴백(200+MINIMAL)마저 나가지 못한 비정상 상태입니다.",
            )


def _log_abandoned_task(task: "asyncio.Task[None]") -> None:
    """유기 태스크의 예외 소비 — 'exception was never retrieved' 노이즈 방지 + 기록."""
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        _logger.warning("timeout_backstop 유기 태스크 종료 예외: %r", exc)


# ───────────────────── 조립 ─────────────────────


def install_middlewares(app: FastAPI, settings: MiddlewareSettings | None = None) -> None:
    """미들웨어 3종 등록. add_middleware는 마지막 것이 최외곽 —
    실행 순서: Trace(최외곽, 모든 응답 로그) → RateLimit → TimeoutBackstop → 라우트.
    """
    if settings is None:
        settings = MiddlewareSettings.from_env()
    app.add_middleware(
        TimeoutBackstopMiddleware,
        margin_ms=settings.timeout_margin_ms,
        default_deadline_ms=settings.timeout_default_deadline_ms,
    )
    app.add_middleware(
        RateLimitMiddleware,
        rps=settings.rate_limit_rps,
        burst=settings.rate_limit_burst,
    )
    app.add_middleware(TraceMiddleware)
