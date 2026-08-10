"""TripPilot AI 서비스 진입점 — FastAPI 경계 (U5-03·05, TRIP-239·241).

`POST /ai/v1/itinerary/{generate,validate,repair}` + `/health`.
조립은 `trippilot.api.wiring` 소유 — main은 얇게 유지한다.

기본 조립은 in-memory fake(스모크·로컬 개발용 — 실 LLM·실 DB 호출 0, D37):
LLM은 명시적 미배선이라 점수는 규칙 폴백, 일정은 OR-Tools가 낸다.
`TRIPPILOT_WIRING=unwired`면 미주입 앱(3개 라우트 503) — 배선 문제 격리용.
`/health`는 기존 스텁과 동일한 `{"status": "UP", "service": "ai"}`를 유지한다
(docker-compose 헬스체크 의존).
"""

import os

from trippilot.api.app import create_app
from trippilot.api.wiring import build_dev_app

PORT = 8000

# ASGI 진입점 — `uvicorn main:app` 으로도 기동 가능.
app = (
    create_app()
    if os.environ.get("TRIPPILOT_WIRING") == "unwired"
    else build_dev_app()
)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
