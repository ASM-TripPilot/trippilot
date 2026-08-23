"""예외 → HTTP 상태·오류 바디 매핑 (경계 계약 PR #104 · #127).

**에러 vs 폴백 이원화**: AI가 200을 반환하면 백엔드는 폴백하지 않는다(`is_fallback=true`
여도 그건 AI가 이미 마친 폴백 결과물이다). 반대로 아래 4xx/5xx가 나가는 순간 백엔드는
`MinimalItineraryFallback`을 켠다 — 그러니 "정상 결과의 열화"를 오류로 내보내면 안 된다.

| 상황 | HTTP | retryable |
|---|---|---|
| 요청 스키마·도메인 불변식 위반 | 422 | false |
| 필수 방문지/고정블록 모순(SolverConflictError, d08) | 409 | false |
| 컨텍스트 권한 위반(PermissionDeniedError) | 403 | false |
| 백엔드 POI 조회에 우리가 잘못 보냄(4xx) | 422 | false |
| 백엔드 서비스 토큰 거부(401·403) | 500 | false |
| 백엔드 장애·연결 실패(5xx·타임아웃) | 500 | **true** |
| 설정 버그·미분류 예외 | 500 | false |
| 오케스트레이터 미주입(배선 전) | 503 | false |

시한 초과는 **여기 없다**: deadline 초과는 오류가 아니라 200 + MINIMAL + `is_fallback=true`
로 수렴한다(TRIP-291 — 체인 최후 보루는 시한과 무관하게 실행된다).
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from trippilot.api.schemas import ErrorBody
from trippilot.poi_curation.adapters.backend_poi_db import BackendPoiDbError
from trippilot.solver_engine.facade import SolverConflictError
from trippilot.domain.context import PermissionDeniedError

# 오류 코드 — 백엔드 로그·분류의 키(문자열 안정성 유지).
CODE_VALIDATION = "VALIDATION_ERROR"
CODE_DOMAIN_INVARIANT = "DOMAIN_INVARIANT_VIOLATION"
CODE_SOLVER_CONFLICT = "SOLVER_CONFLICT"
CODE_PERMISSION_DENIED = "PERMISSION_DENIED"
CODE_BACKEND_AUTH = "BACKEND_AUTH_ERROR"
CODE_BACKEND_UNAVAILABLE = "BACKEND_UNAVAILABLE"
CODE_INTERNAL = "INTERNAL_ERROR"
CODE_NOT_WIRED = "ORCHESTRATOR_NOT_WIRED"


class BoundaryError(Exception):
    """경계 오류 — 상태코드·오류코드·재시도 가능성을 함께 실어 나른다."""

    def __init__(self, status_code: int, error_code: str, message: str,
                 retryable: bool = False) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code
        self.message = message
        self.retryable = retryable

    def body(self) -> ErrorBody:
        return ErrorBody(error_code=self.error_code, message=self.message,
                         retryable=self.retryable)


def orchestrator_not_wired() -> BoundaryError:
    """배선 전(TRIP-237 머지 대기) 명시 실패 — 빈 일정을 지어내지 않는다(INV-4)."""
    return BoundaryError(
        503, CODE_NOT_WIRED,
        "ItineraryOrchestrator가 주입되지 않았습니다 — AI 서비스 배선 미완료.",
    )


def map_exception(exc: BaseException) -> BoundaryError:
    """도메인 예외 → 경계 오류. 미분류는 500으로 **드러낸다**(침묵 금지, INV-4)."""
    if isinstance(exc, BoundaryError):
        return exc
    if isinstance(exc, PermissionDeniedError):
        return BoundaryError(403, CODE_PERMISSION_DENIED, str(exc))
    if isinstance(exc, BackendPoiDbError):
        return _map_backend_poi_db(exc)
    if isinstance(exc, SolverConflictError):
        # d08 — 고정 블록/필수 방문지 모순. 재시도해도 같은 입력이면 같은 결과다.
        return BoundaryError(409, CODE_SOLVER_CONFLICT, str(exc))
    if isinstance(exc, ValueError):
        # 도메인 불변식은 전부 ValueError로 던진다(business-rules §2 — __post_init__).
        # pydantic ValidationError도 ValueError 하위라 같은 422로 수렴한다.
        return BoundaryError(422, CODE_DOMAIN_INVARIANT, str(exc))
    return BoundaryError(500, CODE_INTERNAL, f"{type(exc).__name__}: {exc}")


def _map_backend_poi_db(exc: BackendPoiDbError) -> BoundaryError:
    """백엔드 POI 조회 실패 → 상태코드로 책임 소재를 가른다(TRIP-436).

    상태코드 없이 전부 500 이면 "상대가 고장났다"로 읽혀 호출측이 폴백·재시도·알림을
    태운다 — 정작 고칠 쪽이 우리인 경우(잘못된 poi_id, 토큰 미설정)에도 그렇다.
    """
    if exc.status in (401, 403):
        # 원인이 명확한 유일한 갈래 — 요청이 아니라 배포 설정 문제다(TRIP-393).
        return BoundaryError(
            500, CODE_BACKEND_AUTH,
            f"{exc} — 서비스 간 인증 거부: AI 의 X-Service-Token 설정을 확인하라"
            " (백엔드 공유 시크릿 불일치·미설정, TRIP-393).",
        )
    if exc.status is not None and 400 <= exc.status < 500:
        # 잘못 보낸 쪽은 우리다(예: UUID 아닌 poi_id) — 상대 장애로 위장하지 않는다.
        return BoundaryError(422, CODE_VALIDATION, str(exc))
    return BoundaryError(500, CODE_BACKEND_UNAVAILABLE, str(exc), exc.retryable)


def _json(err: BoundaryError) -> JSONResponse:
    return JSONResponse(status_code=err.status_code, content=err.body().model_dump())


async def _boundary_handler(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, BoundaryError)
    return _json(exc)


async def _request_validation_handler(_: Request, exc: Exception) -> JSONResponse:
    """요청 스키마 위반 → 422. FastAPI 기본 바디(`detail`) 대신 계약 바디로 통일한다."""
    errors = getattr(exc, "errors", lambda: [])()
    detail = "; ".join(
        f"{'.'.join(str(p) for p in e.get('loc', ()))}: {e.get('msg', '')}"
        for e in errors
    ) or str(exc)
    return _json(BoundaryError(422, CODE_VALIDATION, f"요청 스키마 위반 — {detail}"))


async def _unclassified_handler(_: Request, exc: Exception) -> JSONResponse:
    """라우트 밖(응답 직렬화 등)에서 샌 예외의 안전망 — 500도 계약 바디로 나간다."""
    return _json(map_exception(exc))


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(BoundaryError, _boundary_handler)
    app.add_exception_handler(RequestValidationError, _request_validation_handler)
    app.add_exception_handler(Exception, _unclassified_handler)
