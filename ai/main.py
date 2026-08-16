"""TripPilot AI 서비스 진입점 — FastAPI 경계 (U5-03·05, TRIP-239·241).

`POST /ai/v1/itinerary/{generate,validate,repair}` + `/health`.
조립은 `trippilot.api.wiring` 소유 — main은 env 해석 + 얇은 스위치만 갖는다.

env 스위치 (TRIP-344):
- `TRIPPILOT_WIRING=unwired` — 미주입 앱(3개 라우트 503, 배선 문제 격리용). 최우선.
- `TRIPPILOT_LLM_PROVIDER` 미설정 — 기존 그대로 in-memory fake 조립(스모크·로컬
  개발용 — 실 LLM·실 DB 호출 0, D37): LLM은 명시적 미배선(UnwiredLlm)이라 점수는
  규칙 폴백, 일정은 OR-Tools가 낸다.
- `TRIPPILOT_LLM_PROVIDER=openai` — c1/adapters OpenAIAdapter 실배선.
  `OPENAI_API_KEY`(필수) · `OPENAI_BASE_URL`(선택 — OpenAI 호환 게이트웨이) ·
  `OPENAI_MODEL`(기본 gpt-5.6-terra) · `OPENAI_API`(chat|responses, 기본 responses
  — 멘토 게이트웨이가 responses만 라우팅). 조립 불가(키 누락 등)는 **기동 실패**로
  드러낸다 — INV-4는 런타임 폴백이지 설정 오류 은폐가 아니다(silent fallback 금지).
- `WEATHER_API`(TRIP-383) — 기상청 단기예보 서비스키(디코딩 키). 설정 시 날씨
  소프트 보정용 KmaWeatherAdapter를 주입한다. 미설정 = 무보정(기존 그대로).
- 미들웨어 한도·타임아웃 env(`TRIPPILOT_RATE_LIMIT_*` · `TRIPPILOT_TIMEOUT_*`,
  TRIP-240)는 `create_app` 내부에서 해석된다 — `trippilot/api/middleware.py` 참조.

`/health`는 기존 스텁과 동일한 `{"status": "UP", "service": "ai"}`를 유지한다
(docker-compose 헬스체크 의존).
"""

import os

from fastapi import FastAPI

from trippilot.api.app import create_app
from trippilot.api.wiring import build_dev_app

PORT = 8000


def _env(name: str) -> str | None:
    """빈 문자열도 미설정으로 취급 — CI·compose가 비운 값을 ''로 주입한다(smoke_llm 동형)."""
    return os.environ.get(name) or None


def _openai_llm_and_model() -> tuple[object, str]:
    """`TRIPPILOT_LLM_PROVIDER=openai` 실배선 조립. 반환: (LlmPort 어댑터, model_id).

    openai SDK는 지연 import — SDK 의존은 c1/adapters 한정(TRIP-340 아키텍처 규칙)
    이고, 클라이언트 생성만은 조립 진입점인 이 파일(src 밖)이 맡는다
    (scripts/smoke_llm.py `_build_adapter`와 동형). 키 누락·잘못된 OPENAI_API 값은
    여기서 즉시 예외 → 기동 실패로 크게 드러난다.
    """
    api_key = _env("OPENAI_API_KEY")
    if api_key is None:
        raise RuntimeError(
            "TRIPPILOT_LLM_PROVIDER=openai 인데 OPENAI_API_KEY 미설정 — "
            "실 LLM 조립 불가(빈 문자열도 미설정). silent fallback 금지: 기동 실패."
        )
    import openai

    from trippilot.llm_gateway.adapters.openai_adapter import OpenAIAdapter

    client = openai.OpenAI(
        api_key=api_key,
        base_url=_env("OPENAI_BASE_URL"),  # None → 표준 api.openai.com
        # 재시도 무익 정책 (TRIP-381): 결정론 실패는 재시도로 안 바뀜(백엔드 합의
        # 원칙과 동일) + SDK 내부 자동 재시도(기본 2회)가 타임아웃 계약을 3배로
        # 왜곡한다 — 2.5s 설정이 실제 ~10s (2026-08-16 계측 실측). 재시도 판단은
        # 게이트웨이/오케스트레이터 폴백 계단 소유 — SDK가 몰래 하지 않는다.
        max_retries=0,
    )
    adapter = OpenAIAdapter(client, api=_env("OPENAI_API") or "responses")
    return adapter, _env("OPENAI_MODEL") or "gpt-5.6-terra"


def _kma_weather():
    """`WEATHER_API`(기상청 공공데이터포털 디코딩 키, TRIP-383) 설정 시 실 어댑터 조립.

    미설정(빈 문자열 포함) = 미배선(None) — 날씨 보정 없이 기존 경로 그대로.
    실 응답 드리프트는 실키 실행에서 검증한다 (테스트·CI 실 호출 0, D37).
    """
    key = _env("WEATHER_API")
    if key is None:
        return None
    from trippilot.poi_curation.adapters.kma_weather import KmaWeatherAdapter
    from trippilot.poi_curation.sourcing.tourapi import UrllibHttpClient

    return KmaWeatherAdapter(UrllibHttpClient(), key)


def build_app_from_env() -> FastAPI:
    """env → 앱 조립 스위치. 미설정 경로는 기존과 동일(회귀 없음)."""
    if os.environ.get("TRIPPILOT_WIRING") == "unwired":
        return create_app()
    weather = _kma_weather()
    provider = _env("TRIPPILOT_LLM_PROVIDER")
    if provider is None:
        return build_dev_app(weather=weather)
    if provider != "openai":
        raise RuntimeError(
            f"TRIPPILOT_LLM_PROVIDER 미지원 값: {provider!r} — "
            "미설정(fake 조립) 또는 openai 만 지원"
        )
    llm, model_id = _openai_llm_and_model()
    return build_dev_app(llm=llm, model_id=model_id, weather=weather)


# ASGI 진입점 — `uvicorn main:app` 으로도 기동 가능.
app = build_app_from_env()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
