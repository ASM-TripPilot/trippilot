"""TripPilot AI 서비스 진입점 — FastAPI 경계 (U5-03·05, TRIP-239·241).

경계 라우트는 `trippilot.api.routes` 가 소유한다(itinerary·reflection 라우터 2개) —
경로 목록을 여기 다시 나열하지 않는다(나열이 먼저 낡는다). 와이어 정본은
`ai/docs/openapi.json` 이고, 앱과의 전수 일치는 `ai/tests/test_api_openapi_contract.py`
가 강제한다. 경계 밖 `/`·`/health` 는 `trippilot.api.app` 소유.
조립은 `trippilot.api.wiring` 소유 — main은 env 해석 + 얇은 스위치만 갖는다.

env 스위치 (TRIP-344):
- `TRIPPILOT_WIRING=unwired` — 미주입 앱(**경계 라우트 전부** 503, 배선 문제 격리용). 최우선.
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
- `TRIPPILOT_BACKEND_BASE_URL`(TRIP-408) — 백엔드 `/internal/pois` 실연동 주소
  (compose 네트워크 기준 `http://backend:8080`). 설정 시 BackendPoiDb 주입 —
  `TRIPPILOT_SERVICE_AUTH_TOKEN`(TRIP-393 공유 시크릿) 누락이면 **기동 실패**
  (백엔드 fail-closed 라 조용한 401 이 되느니 크게 드러낸다). 미설정 =
  기존 StaticPoiDb(제주 시드 4곳) 그대로.
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


def _anthropic_llm_and_model() -> tuple[object, str]:
    """`TRIPPILOT_LLM_PROVIDER=anthropic` 실배선 조립 (AI-D06 — Claude 직접 호출).

    smoke_llm._build_adapter의 anthropic 분기와 동형 — SDK 지연 import,
    max_retries=0(재시도 무익 정책, TRIP-381). 키 누락은 즉시 기동 실패.
    """
    api_key = _env("ANTHROPIC_API_KEY")
    if api_key is None:
        raise RuntimeError(
            "TRIPPILOT_LLM_PROVIDER=anthropic 인데 ANTHROPIC_API_KEY 미설정 — "
            "실 LLM 조립 불가(빈 문자열도 미설정). silent fallback 금지: 기동 실패."
        )
    import anthropic

    from trippilot.llm_gateway.adapters.anthropic_adapter import AnthropicAdapter

    client = anthropic.Anthropic(api_key=api_key, max_retries=0)
    return AnthropicAdapter(client), _env("ANTHROPIC_MODEL") or "claude-haiku-4-5"


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


def _backend_poi_db():
    """`TRIPPILOT_BACKEND_BASE_URL`(TRIP-408) 설정 시 백엔드 POI 정본 어댑터 조립.

    미설정(빈 문자열 포함) = 미배선(None) — 기존 StaticPoiDb 그대로.
    주소만 있고 토큰이 없으면 기동 실패 — 백엔드 /internal 은 fail-closed(TRIP-393)
    라 매 요청 401 로 조용히 빈손이 되느니 조립 시점에 크게 드러낸다.
    """
    base_url = _env("TRIPPILOT_BACKEND_BASE_URL")
    if base_url is None:
        return None
    token = _env("TRIPPILOT_SERVICE_AUTH_TOKEN")
    if token is None:
        raise RuntimeError(
            "TRIPPILOT_BACKEND_BASE_URL 설정인데 TRIPPILOT_SERVICE_AUTH_TOKEN "
            "미설정(빈 문자열 포함) — /internal 은 fail-closed(TRIP-393)라 "
            "조립 불가. silent fallback 금지: 기동 실패."
        )
    from trippilot.poi_curation.adapters.backend_poi_db import (
        BackendPoiDb, UrllibJsonClient,
    )

    return BackendPoiDb(UrllibJsonClient(), base_url, token)


def _tmap_travel():
    """`TMAP_API_KEY`(TRIP-432) 설정 시 ChainedTravelAdapter 조립.

    TMAP 실경로 1차 → 하버사인 폴백 2차. 미설정 = None (기존 TravelEstimator 그대로).
    """
    app_key = _env("TMAP_API_KEY")
    if app_key is None:
        return None
    from trippilot.assembly_engine.adapters.chained_travel import ChainedTravelAdapter
    from trippilot.assembly_engine.adapters.tmap import TmapRouteAdapter, UrllibHttpClient
    from trippilot.assembly_engine.config import AssemblyConfig
    from trippilot.assembly_engine.travel import TravelEstimator

    tmap = TmapRouteAdapter(UrllibHttpClient(), app_key)
    fallback = TravelEstimator(AssemblyConfig())
    return ChainedTravelAdapter(primary=tmap, fallback=fallback)


def _event_store():
    """`EVENTS_STORE`(행사 저장소 JSON 경로, TRIP-421) 설정 시 조립.

    미설정 = 미배선(None) — 행사 보너스 없이 기존 경로 그대로. 파일은 새벽 배치
    (ai-event-collect)가 collect-state 브랜치에 쌓는 collected_events.json.

    **경로를 줬는데 파일이 없으면 기동 실패**다(_backend_poi_db·_vector_rag 와 같은 규약).
    JsonEventStore 는 없는 파일을 빈 문서로 삼키고, EventProvider 는 그걸 status=OK·
    행사 0건으로 내며, 보너스 단계는 빈 목록이라 Degradation 조차 남기지 않는다 —
    경로 오타 하나가 "배선은 살아 있는데 영구 무보정"이 된다(INV-4: 침묵 실패 금지).
    """
    path = _env("EVENTS_STORE")
    if path is None:
        return None
    from pathlib import Path as _Path

    from trippilot.background.event_store import JsonEventStore

    store_path = _Path(path)
    if not store_path.is_file():
        raise RuntimeError(
            f"EVENTS_STORE={path!r} 인데 파일이 없다 — 행사 저장소 조립 불가. "
            "silent fallback 금지: 빈 저장소로 조용히 도는 대신 기동 실패."
        )
    return JsonEventStore(store_path)


def _vector_rag():
    """`TRIPPILOT_VECTOR_DB_URL`(TRIP-428) 설정 시 Plan-B RAG 실배선 조립.

    미설정(빈 문자열 포함) = 미배선 (None, None) — 대안 경계는 규칙 랭킹 강등으로
    동작한다(INV-4 계단, notes에 사유 기록). URL만 있고 임베딩 자격이 없으면
    **기동 실패** — 임베딩 없는 벡터 검색은 성립하지 않는데 조용히 강등하면
    "KB를 켰다"가 거짓이 된다.

    임베딩 선택: `TRIPPILOT_EMBEDDING_PROVIDER` = openai(기본, OPENAI_API_KEY 필수)
    | http(TRIPPILOT_EMBEDDING_BASE_URL 필수 — 별도 임베딩 컨테이너, TRIP-517)
    | titan(boto3 설치 + AWS 자격) | local(sentence-transformers 설치, 기본 KURE-v1 —
    게이트웨이에 임베딩 배포가 없어(404, 2026-08-21 실측) 로컬이 1순위. 팀 결정 2026-08-22:
    local 우선, 죽으면 provider 교체 + load_kb.py 재적재 — 벡터 공간 비호환이라
    쿼리 단위 폴백은 금지, 전환은 적재 단위).
    """
    url = _env("TRIPPILOT_VECTOR_DB_URL")
    if url is None:
        return None, None
    import psycopg

    from trippilot.agents.adapters.pgvector_store import PgVectorStore

    store = PgVectorStore(lambda: psycopg.connect(url))
    provider = _env("TRIPPILOT_EMBEDDING_PROVIDER") or "openai"
    if provider == "openai":
        api_key = _env("OPENAI_API_KEY")
        if api_key is None:
            raise RuntimeError(
                "TRIPPILOT_VECTOR_DB_URL 설정인데 OPENAI_API_KEY 미설정 — 임베딩 "
                "조립 불가(빈 문자열도 미설정). silent fallback 금지: 기동 실패. "
                "Titan은 TRIPPILOT_EMBEDDING_PROVIDER=titan."
            )
        import openai

        from trippilot.llm_gateway.adapters.openai_embedding import OpenAiEmbeddingAdapter

        client = openai.OpenAI(
            api_key=api_key, base_url=_env("OPENAI_BASE_URL"), max_retries=0)
        return store, OpenAiEmbeddingAdapter(client)
    if provider == "titan":
        import boto3

        from trippilot.llm_gateway.adapters.titan_embedding import TitanEmbeddingAdapter

        return store, TitanEmbeddingAdapter(boto3.client("bedrock-runtime"))
    if provider == "local":
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as e:  # 의존성에 없다(의도, boto3 선례) — 복구 명령을 바로 준다
            raise RuntimeError(
                "TRIPPILOT_EMBEDDING_PROVIDER=local 인데 sentence-transformers 미설치 — "
                "`uv pip install sentence-transformers` (uv sync 하면 다시 지워진다). "
                "silent fallback 금지: 기동 실패."
            ) from e
        from trippilot.llm_gateway.adapters.sentence_transformer_embedding import (
            DEFAULT_MODEL,
            SentenceTransformerEmbeddingAdapter,
        )

        model_name = _env("TRIPPILOT_EMBEDDING_MODEL") or DEFAULT_MODEL
        return store, SentenceTransformerEmbeddingAdapter(SentenceTransformer(model_name))
    if provider == "http":
        from trippilot.llm_gateway.adapters.http_embedding_assembly import http_embedding
        from trippilot.poi_curation.adapters.backend_poi_db import UrllibJsonClient

        return store, http_embedding(RuntimeError, lambda t: UrllibJsonClient(timeout_sec=t))
    raise RuntimeError(
        f"TRIPPILOT_EMBEDDING_PROVIDER 미지원 값: {provider!r} — openai|titan|local|http"
    )


def _feature_models_from_env() -> dict:
    """`TRIPPILOT_LLM_FEATURE_MODELS` 파싱 — 구현은 공용 모듈(리허설과 공유)."""
    from trippilot.llm_gateway.feature_model_env import feature_models_from_env

    return dict(feature_models_from_env())


def _mixed_llm_and_model() -> tuple[object, str]:
    """`TRIPPILOT_LLM_PROVIDER=mixed` — GPT·Claude 혼용 조립 (TRIP-513).

    양쪽 클라이언트를 모두 만들고 RoutingLlm이 모델명 접두어("claude*")로
    벤더를 고른다. 양쪽 키 모두 필수(fail-fast) — 혼용을 켰는데 한쪽이
    없으면 그 기능들만 조용히 죽는 상태를 만들지 않는다.
    기본 모델(티어 해석)은 OPENAI_MODEL — Claude는 feature_models로 배정.
    """
    from trippilot.llm_gateway.adapters.routing import RoutingLlm

    openai_llm, openai_model = _openai_llm_and_model()
    anthropic_llm, _ = _anthropic_llm_and_model()
    return RoutingLlm(default=openai_llm,
                      routes={"claude": anthropic_llm}), openai_model


def build_app_from_env() -> FastAPI:
    """env → 앱 조립 스위치. 미설정 경로는 기존과 동일(회귀 없음)."""
    if os.environ.get("TRIPPILOT_WIRING") == "unwired":
        return create_app()
    weather = _kma_weather()
    poi_db = _backend_poi_db()
    travel = _tmap_travel()
    events = _event_store()
    vector_store, embedding = _vector_rag()
    provider = _env("TRIPPILOT_LLM_PROVIDER")
    if provider is None:
        return build_dev_app(weather=weather, poi_db=poi_db, events=events,
                             vector_store=vector_store, embedding=embedding,
                             travel_port=travel)
    if provider == "openai":
        llm, model_id = _openai_llm_and_model()
    elif provider == "anthropic":
        llm, model_id = _anthropic_llm_and_model()
    elif provider == "mixed":
        llm, model_id = _mixed_llm_and_model()
    else:
        raise RuntimeError(
            f"TRIPPILOT_LLM_PROVIDER 미지원 값: {provider!r} — "
            "미설정(fake 조립) 또는 openai|anthropic|mixed 만 지원"
        )
    return build_dev_app(llm=llm, model_id=model_id, weather=weather,
                         poi_db=poi_db, events=events,
                         vector_store=vector_store, embedding=embedding,
                         travel_port=travel,
                         feature_models=_feature_models_from_env())


# ASGI 진입점 — `uvicorn main:app` 으로도 기동 가능.
app = build_app_from_env()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
