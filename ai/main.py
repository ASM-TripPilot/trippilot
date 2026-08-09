"""TripPilot AI 서비스 진입점 — FastAPI 경계 (U5-03, TRIP-239).

`POST /ai/v1/itinerary/{generate,validate,repair}` + `/health`.
오케스트레이터(TRIP-237) 배선 전이라 3개 라우트는 503으로 명시 실패하고,
`/health`는 기존 스텁과 동일한 `{"status": "UP", "service": "ai"}`를 유지한다
(docker-compose 헬스체크 의존).
"""

from trippilot.api.app import create_app

PORT = 8000

# ASGI 진입점 — `uvicorn main:app` 으로도 기동 가능.
app = create_app()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
