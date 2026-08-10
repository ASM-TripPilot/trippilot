"""U5-04 — API 미들웨어 3종 (TRIP-240): rate-limit · 요청 계측 · 타임아웃 백스톱.

여기서 고정하는 것:
1. rate-limit — 초과 시 429 + 계약 오류 바디(`{error_code, message, retryable}`),
   `/health` 면제, 발동은 로그로 드러난다(INV-4), 기본값은 관대하다
2. 요청 계측 — trace_id 우선순위(헤더 → request_meta.request_id → 생성),
   응답 헤더 반영, 구조화(JSON 한 줄) 로그
3. 타임아웃 백스톱 — **deadline 소진(200+MINIMAL 폴백, TRIP-291)과 겹치지 않고**
   deadline+margin 이후의 비정상(행)에서만 504가 나간다는 비간섭 증명
4. 미들웨어는 순수 ASGI 계층 — openapi 스냅샷(계약 동결)에 영향 없음
"""

from __future__ import annotations

import dataclasses
import json
import logging
import time

import pytest
from fastapi.testclient import TestClient

from trippilot.api.app import create_app
from trippilot.api.middleware import (
    CODE_RATE_LIMITED,
    CODE_TIMEOUT_BACKSTOP,
    MiddlewareSettings,
    RateLimitMiddleware,
    backstop_ms,
    parse_wire_meta,
)
from trippilot.domain.itinerary import SolveMode

from tests.test_api_contract import (
    BACKEND_REQUEST,
    FakeOrchestrator,
    make_outcome,
)

GENERATE = "/ai/v1/itinerary/generate"

# 테스트용 관대·즉발 설정 프리셋
_NO_TIMEOUT = MiddlewareSettings()  # 기본값 — margin 5s·default 30s (테스트에 안 걸린다)


def client(
    orchestrator: object | None = None,
    settings: MiddlewareSettings | None = None,
) -> TestClient:
    return TestClient(
        create_app(orchestrator, middleware=settings), raise_server_exceptions=False
    )


def body_with_deadline(deadline_ms: int) -> dict:
    return {
        **BACKEND_REQUEST,
        "request_meta": {**BACKEND_REQUEST["request_meta"], "deadline_ms": deadline_ms},
    }


class SlowOrchestrator(FakeOrchestrator):
    """스레드풀(sync 라우트)에서 sleep — deadline 소진/프로세스 행 시뮬레이션."""

    def __init__(self, outcome, sleep_sec: float) -> None:  # noqa: ANN001
        super().__init__(outcome)
        self.sleep_sec = sleep_sec

    def generate(self, request):  # noqa: ANN001
        time.sleep(self.sleep_sec)
        return super().generate(request)


def make_fallback_outcome():
    """deadline 소진 후 C2 최후 보루가 내는 것 — 200 + MINIMAL + is_fallback=true."""
    outcome = make_outcome()
    outcome.solution = dataclasses.replace(
        outcome.solution, is_fallback=True, solve_mode=SolveMode.MINIMAL
    )
    return outcome


# ───────────────────────── 1) rate-limit ─────────────────────────


def test_rate_limit_exceeded_returns_429_with_contract_body(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """버킷 소진 → 429 + errors.py와 같은 계약 바디. 발동은 로그로 드러난다(INV-4)."""
    settings = MiddlewareSettings(rate_limit_rps=0.001, rate_limit_burst=2)
    with client(FakeOrchestrator(make_outcome()), settings) as c:
        with caplog.at_level(logging.WARNING, logger="trippilot.api.middleware"):
            assert c.post(GENERATE, json=BACKEND_REQUEST).status_code == 200
            assert c.post(GENERATE, json=BACKEND_REQUEST).status_code == 200
            resp = c.post(GENERATE, json=BACKEND_REQUEST)

    assert resp.status_code == 429
    body = resp.json()
    assert set(body) == {"error_code", "message", "retryable"}  # 계약 형식 그대로
    assert body["error_code"] == CODE_RATE_LIMITED
    assert body["retryable"] is False
    assert "retry-after" in resp.headers
    assert "x-trace-id" in resp.headers  # 계측이 429에도 적용된다

    events = [json.loads(r.message) for r in caplog.records
              if r.name == "trippilot.api.middleware"]
    assert any(e["event"] == "rate_limited" for e in events), "발동이 로그에 없다(INV-4)"


def test_rate_limit_exempts_health_and_root() -> None:
    """인프라 폴링 경로는 면제 — compose 헬스체크를 막지 않는다."""
    settings = MiddlewareSettings(rate_limit_rps=0.001, rate_limit_burst=1)
    with client(settings=settings) as c:
        for _ in range(5):
            assert c.get("/health").status_code == 200
            assert c.get("/").status_code == 200


def test_rate_limit_disabled_when_rps_nonpositive() -> None:
    settings = MiddlewareSettings(rate_limit_rps=0, rate_limit_burst=1)
    with client(FakeOrchestrator(make_outcome()), settings) as c:
        for _ in range(10):
            assert c.post(GENERATE, json=BACKEND_REQUEST).status_code == 200


def test_rate_limit_defaults_are_generous() -> None:
    """기본 설정(burst 1000)은 통합테스트 수준의 연타를 막지 않는다."""
    with client(FakeOrchestrator(make_outcome())) as c:
        statuses = {c.post(GENERATE, json=BACKEND_REQUEST).status_code for _ in range(50)}
    assert statuses == {200}


def test_token_bucket_refills_with_clock() -> None:
    """토큰버킷 단위 검증 — 소진 → 거부 → 시간 경과만큼 충전 → 다시 허용."""
    now = [0.0]

    async def dummy_app(scope, receive, send):  # noqa: ANN001
        raise AssertionError("직접 _acquire만 검증")

    bucket = RateLimitMiddleware(dummy_app, rps=10, burst=1, clock=lambda: now[0])
    assert bucket._acquire("k") is True
    assert bucket._acquire("k") is False  # 소진
    now[0] += 0.05
    assert bucket._acquire("k") is False  # 0.5토큰 — 아직 부족
    now[0] += 0.06
    assert bucket._acquire("k") is True  # 1토큰 충전 완료
    assert bucket._acquire("other") is True  # 키별 독립


# ───────────────────────── 2) 요청 계측(trace) ─────────────────────────


def test_trace_id_from_header_echoes_back() -> None:
    with client(FakeOrchestrator(make_outcome())) as c:
        resp = c.post(GENERATE, json=BACKEND_REQUEST, headers={"x-trace-id": "abc-123"})
    assert resp.status_code == 200
    assert resp.headers["x-trace-id"] == "abc-123"


def test_trace_id_falls_back_to_request_meta_request_id() -> None:
    with client(FakeOrchestrator(make_outcome())) as c:
        resp = c.post(GENERATE, json=BACKEND_REQUEST)  # request_id = "req-1"
    assert resp.headers["x-trace-id"] == "req-1"


def test_trace_id_generated_when_absent() -> None:
    with client() as c:
        resp = c.get("/health")
    assert resp.status_code == 200
    assert len(resp.headers["x-trace-id"]) == 32  # uuid4().hex


def test_trace_id_header_wins_over_body_and_is_sanitized() -> None:
    with client(FakeOrchestrator(make_outcome())) as c:
        resp = c.post(
            GENERATE, json=BACKEND_REQUEST, headers={"x-trace-id": "ok id!@#$%"}
        )
    assert resp.headers["x-trace-id"] == "okid"  # 헤더 우선(req-1 아님) + 안전 문자만


def test_request_logged_as_structured_json(caplog: pytest.LogCaptureFixture) -> None:
    """경로·상태·소요 ms가 한 줄 JSON으로 남는다 — 파싱 가능해야 구조화다."""
    with client(FakeOrchestrator(make_outcome())) as c:
        with caplog.at_level(logging.INFO, logger="trippilot.api.request"):
            c.post(GENERATE, json=BACKEND_REQUEST)

    lines = [json.loads(r.message) for r in caplog.records
             if r.name == "trippilot.api.request"]
    assert len(lines) == 1
    line = lines[0]
    assert line["event"] == "http_request"
    assert line["trace_id"] == "req-1"
    assert line["method"] == "POST"
    assert line["path"] == GENERATE
    assert line["status"] == 200
    assert isinstance(line["elapsed_ms"], int) and line["elapsed_ms"] >= 0


def test_parse_wire_meta_is_defensive() -> None:
    """관측용 읽기 경로 — 예상 밖 형태는 None으로(전체 실패 승격 없음, 읽기≠쓰기)."""
    assert parse_wire_meta(b"") == parse_wire_meta(b"not-json")
    assert parse_wire_meta(b'{"request_meta": "oops"}').deadline_ms is None
    assert parse_wire_meta(b'[1,2]').request_id is None
    meta = parse_wire_meta(
        b'{"request_meta": {"request_id": "", "deadline_ms": true}}'
    )
    assert meta.request_id is None  # 빈 문자열은 없는 것
    assert meta.deadline_ms is None  # bool은 int로 취급하지 않는다
    assert parse_wire_meta(b'{"request_meta": {"deadline_ms": -5}}').deadline_ms is None
    ok = parse_wire_meta(b'{"request_meta": {"request_id": "r1", "deadline_ms": 20000}}')
    assert (ok.request_id, ok.deadline_ms) == ("r1", 20000)


# ───────────────────────── 3) 타임아웃 백스톱 ─────────────────────────


def test_backstop_threshold_is_strictly_after_deadline() -> None:
    """발동 시점 = deadline + margin > deadline — 정상 폴백(200)이 항상 먼저다."""
    assert backstop_ms(20000, 5000, 30000) == 25000
    assert backstop_ms(100, 200, 30000) == 300
    assert backstop_ms(None, 5000, 30000) == 35000  # deadline 미상 → default 기준
    for deadline in (1, 100, 5000, 20000):
        assert backstop_ms(deadline, 5000, 30000) > deadline


def test_deadline_exhaustion_still_returns_200_fallback_not_504() -> None:
    """비간섭 증명 — 핸들러가 deadline(100ms)을 **넘겨서** 폴백을 내도(TRIP-291
    C2 최후 보루 경로) 백스톱(발동점 deadline+5000ms)은 침묵하고 200이 나간다."""
    orchestrator = SlowOrchestrator(make_fallback_outcome(), sleep_sec=0.4)
    with client(orchestrator, _NO_TIMEOUT) as c:
        resp = c.post(GENERATE, json=body_with_deadline(100))

    assert resp.status_code == 200  # 504가 아니다 — deadline 소진은 오류가 아니다
    payload = resp.json()
    assert payload["is_fallback"] is True
    assert payload["solve_mode"] == "MINIMAL"


def test_backstop_fires_on_hang_with_contract_error_body(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """행(deadline+margin까지 무응답) → 504 + 계약 바디 + error 로그(INV-4)."""
    orchestrator = SlowOrchestrator(make_outcome(), sleep_sec=1.0)  # 행 시뮬레이션
    settings = MiddlewareSettings(timeout_margin_ms=200)  # 발동점 = 100+200 = 300ms
    with client(orchestrator, settings) as c:
        with caplog.at_level(logging.ERROR, logger="trippilot.api.middleware"):
            started = time.monotonic()
            resp = c.post(GENERATE, json=body_with_deadline(100))
            elapsed = time.monotonic() - started

    assert resp.status_code == 504
    body = resp.json()
    assert set(body) == {"error_code", "message", "retryable"}
    assert body["error_code"] == CODE_TIMEOUT_BACKSTOP
    assert body["retryable"] is False
    assert "x-trace-id" in resp.headers
    assert elapsed < 0.9, "백스톱이 핸들러 종료(1.0s)를 기다렸다 — 방어선이 아니다"

    events = [json.loads(r.message) for r in caplog.records
              if r.name == "trippilot.api.middleware" and r.levelno == logging.ERROR]
    assert any(e["event"] == "timeout_backstop" and e["backstop_ms"] == 300
               for e in events), "백스톱 발동이 로그에 없다(INV-4)"


def test_backstop_does_not_fire_within_deadline() -> None:
    """정상 응답(짧은 처리)은 아무 영향 없다 — 미들웨어 투명성."""
    with client(FakeOrchestrator(make_outcome()),
                MiddlewareSettings(timeout_margin_ms=200)) as c:
        resp = c.post(GENERATE, json=body_with_deadline(5000))
    assert resp.status_code == 200


# ───────────────────────── 4) 계약 스냅샷 불변 ─────────────────────────


def test_openapi_schema_unaffected_by_middleware() -> None:
    """미들웨어는 순수 ASGI 계층 — 어떤 설정이어도 openapi(계약 동결)는 동일하다."""
    default = create_app().openapi()
    tuned = create_app(
        middleware=MiddlewareSettings(
            rate_limit_rps=1, rate_limit_burst=1,
            timeout_margin_ms=1, timeout_default_deadline_ms=1,
        )
    ).openapi()
    assert default == tuned


def test_settings_reject_nonpositive_margin() -> None:
    """마진 0이면 백스톱이 정상 deadline 폴백과 겹친다 — 설정 단계에서 거부."""
    with pytest.raises(ValueError):
        MiddlewareSettings(timeout_margin_ms=0)
    with pytest.raises(ValueError):
        MiddlewareSettings.from_env({"TRIPPILOT_TIMEOUT_MARGIN_MS": "-1"})


def test_settings_from_env_parses_and_exposes_bad_values() -> None:
    env = {
        "TRIPPILOT_RATE_LIMIT_RPS": "2.5",
        "TRIPPILOT_RATE_LIMIT_BURST": "7",
        "TRIPPILOT_TIMEOUT_MARGIN_MS": "1234",
        "TRIPPILOT_TIMEOUT_DEFAULT_MS": "",  # 빈 문자열 = 미설정(main._env 동형)
    }
    settings = MiddlewareSettings.from_env(env)
    assert settings.rate_limit_rps == 2.5
    assert settings.rate_limit_burst == 7
    assert settings.timeout_margin_ms == 1234
    assert settings.timeout_default_deadline_ms == 30000
    with pytest.raises(ValueError):  # 파싱 불가 → 기동 실패로 드러난다(은폐 금지)
        MiddlewareSettings.from_env({"TRIPPILOT_RATE_LIMIT_BURST": "many"})
