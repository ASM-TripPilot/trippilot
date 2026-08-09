"""U5-03 — 오류 매핑·헬스체크 (TRIP-239).

**에러 vs 폴백 이원화**(경계 계약 PR #104): AI가 200을 내면 백엔드는 폴백하지 않고,
4xx/5xx를 내면 백엔드가 `MinimalItineraryFallback`을 켠다. 그래서 상태코드 4종과
`retryable` 값은 계약 그대로 고정한다.

| 상황 | HTTP | retryable |
|---|---|---|
| 요청 스키마·도메인 불변식 위반 | 422 | false |
| 고정블록 모순(SolverConflictError, d08) | 409 | false |
| 컨텍스트 권한 위반(PermissionDeniedError) | 403 | false |
| 미분류 예외 | 500 | false |
| 오케스트레이터 미주입 | 503 | false |
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from trippilot.api.app import HEALTH_BODY, create_app
from trippilot.c2.facade import SolverConflictError
from trippilot.domain.context import PermissionDeniedError
from tests.test_api_contract import BACKEND_REQUEST, FakeOrchestrator, make_outcome

ROUTES = (
    "/ai/v1/itinerary/generate",
    "/ai/v1/itinerary/validate",
    "/ai/v1/itinerary/repair",
)


class RaisingOrchestrator(FakeOrchestrator):
    """generate 진입 즉시 정해둔 예외를 던진다."""

    def __init__(self, exc: Exception) -> None:
        super().__init__(make_outcome())
        self.exc = exc

    def generate(self, request):  # noqa: ANN001
        raise self.exc


def client(orchestrator: object | None = None) -> TestClient:
    return TestClient(create_app(orchestrator), raise_server_exceptions=False)


def assert_error_body(response, status: int, code: str, retryable: bool = False) -> None:
    assert response.status_code == status
    body = response.json()
    assert set(body) == {"error_code", "message", "retryable"}, body
    assert body["error_code"] == code
    assert body["retryable"] is retryable
    assert body["message"]  # 침묵 실패 금지 — 사유가 비어 있으면 안 된다


# ───────────────────────── 예외 → 상태코드 4종 ─────────────────────────


@pytest.mark.parametrize(
    ("exc", "status", "code"),
    [
        (ValueError("start < end 위반"), 422, "DOMAIN_INVARIANT_VIOLATION"),
        (SolverConflictError("고정 블록 모순"), 409, "SOLVER_CONFLICT"),
        (PermissionDeniedError("타인 리소스 참조"), 403, "PERMISSION_DENIED"),
        (RuntimeError("설정 버그"), 500, "INTERNAL_ERROR"),
    ],
)
def test_exception_maps_to_contract_status(exc: Exception, status: int, code: str) -> None:
    with client(RaisingOrchestrator(exc)) as c:
        response = c.post("/ai/v1/itinerary/generate", json=BACKEND_REQUEST)
    assert_error_body(response, status, code)


def test_solver_conflict_precedes_generic_500() -> None:
    """d08 흐름은 500으로 뭉개지지 않는다 — 백엔드가 충돌 안내 UI로 분기하는 근거."""
    with client(RaisingOrchestrator(SolverConflictError("모든 단계 실패"))) as c:
        body = c.post("/ai/v1/itinerary/generate", json=BACKEND_REQUEST).json()
    assert body["message"] == "모든 단계 실패"


# ───────────────────────── 요청 스키마 위반 → 422 ─────────────────────────


@pytest.mark.parametrize(
    "payload",
    [
        {},                                                       # 필수 필드 전무
        {**BACKEND_REQUEST, "time_windows": []},                  # 최소 1일(days 불변식)
        {**BACKEND_REQUEST, "trip_context": {                     # end < start
            "destinations": ["부산"], "start_date": "2026-08-12",
            "end_date": "2026-08-10", "companion_type": None, "budget_level": None}},
        {**BACKEND_REQUEST, "time_windows": [                     # start < end 위반
            {"date": "2026-08-10", "start": "21:00", "end": "09:00"}]},
        {**BACKEND_REQUEST, "request_meta": {                     # IO-1 지연 예산 없음
            "request_id": "r", "requested_at": "2026-08-10T00:00:00Z", "deadline_ms": 0}},
        {**BACKEND_REQUEST, "anchors": [                          # 좌표 범위 밖
            {"date": "2026-08-10", "lat": 99.0, "lng": 129.0}]},
    ],
)
def test_invalid_request_is_422(payload: dict) -> None:
    with client(FakeOrchestrator(make_outcome())) as c:
        response = c.post("/ai/v1/itinerary/generate", json=payload)
    assert_error_body(response, 422, "VALIDATION_ERROR")


def test_unknown_field_is_rejected_loudly() -> None:
    """계약 드리프트를 침묵으로 흡수하지 않는다 — 오타 하나로 기능이 조용히 무력화되는 것보다
    422가 낫다(예: excluded_poi_ids 오타 = 중복 방지 소실)."""
    with client(FakeOrchestrator(make_outcome())) as c:
        response = c.post(
            "/ai/v1/itinerary/generate",
            json={**BACKEND_REQUEST, "excluded_poi_id": ["oops"]},
        )
    assert_error_body(response, 422, "VALIDATION_ERROR")


# ───────────────────────── 미주입 503 ─────────────────────────


@pytest.mark.parametrize("path", ROUTES)
def test_routes_return_503_when_orchestrator_missing(path: str) -> None:
    """배선 전에는 빈 일정을 200으로 위장하지 않고 명시 실패한다(INV-4)."""
    with client(None) as c:
        response = c.post(path, json=BACKEND_REQUEST)
    assert_error_body(response, 503, "ORCHESTRATOR_NOT_WIRED")


# ───────────────────────── /health 회귀 ─────────────────────────


@pytest.mark.parametrize("path", ["/health", "/"])
def test_health_keeps_stub_contract(path: str) -> None:
    """docker-compose 헬스체크가 쓰는 경로 — 기존 스텁과 동일한 응답을 유지한다."""
    with client(None) as c:
        response = c.get(path)
    assert response.status_code == 200
    assert response.json() == HEALTH_BODY == {"status": "UP", "service": "ai"}


def test_health_works_without_orchestrator_wiring() -> None:
    """오케스트레이터 미주입이 컨테이너 기동 실패로 번지면 안 된다."""
    with client(None) as c:
        assert c.get("/health").status_code == 200
        assert c.post(ROUTES[0], json=BACKEND_REQUEST).status_code == 503
