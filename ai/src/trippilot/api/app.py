"""FastAPI 앱 조립 — 경계 라우트 + 오류 핸들러 + 헬스체크.

오케스트레이터는 **주입**받는다(`create_app(orchestrator=...)`). 실 구현(TRIP-237)이
머지되기 전까지 기본값은 None이고, 그 상태에서 3개 라우트는 503 + `ORCHESTRATOR_NOT_WIRED`
로 명시 실패한다 — 빈 일정을 200으로 내보내면 백엔드가 그것을 정상 결과로 믿는다(INV-4).
"""

from __future__ import annotations

from fastapi import FastAPI

from trippilot.api.errors import install_error_handlers
from trippilot.api.protocols import ItineraryOrchestrator
from trippilot.api.routes import router

HEALTH_BODY = {"status": "UP", "service": "ai"}


def create_app(orchestrator: ItineraryOrchestrator | None = None) -> FastAPI:
    app = FastAPI(
        title="TripPilot AI",
        version="0.1.0",
        description="일정 생성·검증·수리 경계 (U5). 와이어는 snake_case.",
    )
    app.state.orchestrator = orchestrator
    install_error_handlers(app)
    app.include_router(router)

    # docker-compose·컨테이너 헬스체크가 쓰는 엔드포인트 — 응답 형태를 바꾸지 말 것.
    @app.get("/health")
    def health() -> dict[str, str]:
        return HEALTH_BODY

    @app.get("/")
    def root() -> dict[str, str]:
        return HEALTH_BODY

    return app
