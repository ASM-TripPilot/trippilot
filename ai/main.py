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

import logging
import pathlib
import os
import sys
from collections.abc import Mapping

from fastapi import FastAPI

from trippilot.api.app import create_app
from trippilot.api.wiring import build_dev_app
from trippilot.domain.llm import LlmFeature

PORT = 8000


def _env(name: str) -> str | None:
    """빈 문자열도 미설정으로 취급 — CI·compose가 비운 값을 ''로 주입한다(smoke_llm 동형).

    공백만 있는 값도 미설정이다. `int("   ")` 는 `int("")` 와 똑같이 기동을 죽인다
    (TRIP-882 계열) — `.env` 에 `X= ` 처럼 꼬리 공백이 남는 건 흔하다.
    """
    return (os.environ.get(name) or "").strip() or None


# 우리 로거에 다는 핸들러 이름 — 멱등 판정용(같은 이름이 있으면 다시 안 단다).
_LOG_HANDLER_NAME = "trippilot"
# `WARN` 은 logging 의 정식 별칭이라 운영자가 흔히 친다 — 받아 주되 정식 이름으로 접는다.
_LOG_LEVELS = ("CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG")
_LOG_ALIASES = {"WARN": "WARNING", "FATAL": "CRITICAL"}


def configure_logging() -> None:
    """`trippilot.*` 로그가 실제로 나오게 한다 (TRIP-914).

    uvicorn 기본 설정은 `uvicorn*` 로거만 구성하고 루트엔 핸들러를 달지 않는다. 그래서
    우리 로거는 **INFO 가 통째로 버려지고** WARNING 만 `logging.lastResort` 로 (레벨·
    시각·로거 이름 없이) 새어 나갔다 — 프리필터 절단 관측(TRIP-908)의 분모, 요청 로그
    (`api/middleware.py`)가 그렇게 안 보였다.

    - 레벨은 `TRIPPILOT_LOG_LEVEL`(기본 INFO). 미지원 값은 **기동 실패**다 —
      조용한 기본값은 "설정했다고 믿는데 안 나오는" 상태를 만든다(`TRIPPILOT_LLM_PROVIDER`
      와 같은 규칙).
    - 핸들러는 `trippilot` 로거에만 단다. 루트에 달면 의존 라이브러리 로그까지 우리
      포맷으로 바꾼다.
    - **전파는 끊지 않는다.** 끊으면 루트로 안 올라가 `caplog`(핸들러를 루트에 다는
      pytest 기구)가 우리 로그를 못 잡고, import 순서에 따라 남의 테스트가 깨진다.
      운영에선 루트에 핸들러가 없어 중복 출력도 없다(`lastResort` 는 **핸들러를 하나도
      못 찾았을 때만** 쓰인다).
    - 멱등하다 — 재호출은 레벨만 갱신한다(기동 경로가 둘이고, 테스트가 여러 번 부른다).
    """
    raw = _env("TRIPPILOT_LOG_LEVEL") or "INFO"
    level = _LOG_ALIASES.get(raw.upper(), raw.upper())
    if level not in _LOG_LEVELS:
        # 원문 그대로 찍는다 — 대문자로 접어 찍으면 운영자가 자기가 넣은 값을 못 찾는다.
        raise RuntimeError(
            f"TRIPPILOT_LOG_LEVEL 미지원 값: {raw!r} — {'|'.join(_LOG_LEVELS)} 중 하나"
        )
    logger = logging.getLogger("trippilot")
    logger.setLevel(level)
    for existing in logger.handlers:
        if getattr(existing, "name", None) == _LOG_HANDLER_NAME:
            existing.setLevel(level)
            return
    handler = logging.StreamHandler(sys.stdout)
    handler.name = _LOG_HANDLER_NAME
    handler.setLevel(level)
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    )
    logger.addHandler(handler)


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


def _place_existence():
    """카카오 REST 키 설정 시 지도 실재 검증 어댑터 조립 (TRIP-683).

    `KAKAO_REST_API_KEY` → 없으면 `KAKAO_CLIENT_ID` 순으로 본다.
    미설정(빈 문자열 포함) = 미배선(None) — 순위 강등 없이 기존 경로 그대로.

    **배제가 아니라 강등이다.** 실측(`ai-existence-probe`, 반경 300m, 무리별
    200건): 영업 중의 4.0% 가 검색에 안 나오고(오탐), 폐업의 48.5% 만 걸린다.
    7,837건 환산 시 잡는 폐업 ≈102건 vs 잘못 버리는 영업 중 ≈305건이라
    배제하면 손해다. 못 찾은 것은 뒤로 밀릴 뿐 후보에서 사라지지 않는다.

    호출 상한은 `verify()` 1회당이고 어댑터는 앱 수명 동안 산다 — 인스턴스
    누적 예산이면 소진 후 영구히 무동작이 되므로 매 호출 갱신된다.
    """
    # `KAKAO_CLIENT_ID` 로 폴백한다 — 카카오 OAuth 는 `client_id` 자리에 **REST
    # API 키를 그대로** 쓰므로 소셜 로그인용으로 받은 그 값이 로컬 API 에서도
    # 동작한다(2026-09-16 실호출 확인: 키워드검색 200, "솔오름전망대" 반환).
    # 별도 키를 다시 발급받게 하지 않는다 — 같은 앱의 같은 키다.
    key = _env("KAKAO_REST_API_KEY") or _env("KAKAO_CLIENT_ID")
    if key is None:
        return None
    import time

    from trippilot.background.naver_search import UrllibHttpClient
    from trippilot.poi_curation.adapters.kakao_existence import (
        KakaoExistenceAdapter,
    )

    return KakaoExistenceAdapter(
        # 호출당 1s — 어댑터는 마감을 호출 **사이**에서만 보므로 진행 중인 호출 1건이 곧
        # 마감 초과 상한이다. 기본 10s 면 생성 시한을 10s 넘길 수 있었다(TRIP-904 리뷰).
        # 키워드 검색 1건은 보통 수백 ms 라 1s 로 정상 응답을 자르지 않는다.
        UrllibHttpClient(timeout_sec=1.0), key,
        # 상한은 검증 대상 상위 N(기본 50) 보다 넉넉히 — 실질 제한은 마감이다
        # `_env` 를 거친다 — `os.environ.get(k, "60")` 은 변수가 **없을 때만** 기본을
        # 쓰고 `EXISTENCE_MAX_CALLS=` 로 오면 "" 를 돌려줘 `int("")` 로 죽는다.
        # compose 가 통로를 열어 둔 변수는 전부 빈 문자열로 올 수 있다(TRIP-882 —
        # 이 한 줄이 소스 빌드 컨테이너 기동을 막았다).
        max_calls=int(_env("EXISTENCE_MAX_CALLS") or "60"),
        monotonic_ms=lambda: int(time.monotonic() * 1000),
    )


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


def _retry_models_from_env() -> dict:
    """`TRIPPILOT_LLM_RETRY_MODELS` — 같은 파서, 다른 변수 (2단 폴백)."""
    from trippilot.llm_gateway.feature_model_env import RETRY_ENV_VAR, feature_models_from_env

    return dict(feature_models_from_env(env_var=RETRY_ENV_VAR))


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


_LOCAL_PREFIX = "local"


def _local_route(feature_models: Mapping[LlmFeature, str]) -> dict[str, object]:
    """`local*` 모델이 배정돼 있으면 우리가 서빙하는 모델의 라우트를 만든다.

    전송로가 둘이고 **환경변수가 어느 쪽인지 고른다**:

    * `TRIPPILOT_BEDROCK_MODEL_ARN` — Bedrock Custom Model Import (실서비스).
      서버리스라 무요청 0원이고 GPU 쿼터·상시 과금이 없다.
    * `TRIPPILOT_LOCAL_LLM_BASE_URL` — OpenAI 호환 서버(vLLM·MLX). 로컬 개발과
      Mac 검증이 이 경로를 쓴다. 어댑터 신규 구현 없이 base_url 만 갈아끼운다.

    둘 다 있으면 **Bedrock 이 이긴다** — 실서비스 설정이 개발용 잔재를 덮는 쪽이
    안전하다(반대면 누가 `.env` 에 남겨둔 localhost 로 실서비스가 나간다).

    **배정됐는데 둘 다 없으면 기동 실패다**(설정 버그). 조용히 기본 벤더로 나가면
    파인튜닝 모델이 안 붙은 채 정상처럼 보인다 — 그 침묵이 이 분기의 존재 이유다.
    런타임 연결 실패는 다른 이야기고, 그쪽은 폴백 계단이 받는다(INV-4).
    """
    if not any(str(m).lower().startswith(_LOCAL_PREFIX) for m in feature_models.values()):
        return {}

    model_arn = _env("TRIPPILOT_BEDROCK_MODEL_ARN")
    if model_arn:
        import boto3

        from trippilot.llm_gateway.adapters.bedrock_adapter import BedrockAdapter

        client = boto3.client(
            "bedrock-runtime",
            region_name=_env("TRIPPILOT_BEDROCK_REGION") or "us-east-1",
        )
        return {_LOCAL_PREFIX: BedrockAdapter(client, model_arn)}

    base_url = _env("TRIPPILOT_LOCAL_LLM_BASE_URL")
    if not base_url:
        raise RuntimeError(
            "local* 모델이 TRIPPILOT_LLM_FEATURE_MODELS 에 배정됐는데 "
            "TRIPPILOT_BEDROCK_MODEL_ARN·TRIPPILOT_LOCAL_LLM_BASE_URL 둘 다 미설정 "
            "— 기본 벤더로 조용히 나가지 않는다"
        )
    import openai

    from trippilot.llm_gateway.adapters.openai_adapter import OpenAIAdapter

    client = openai.OpenAI(
        api_key=_env("TRIPPILOT_LOCAL_LLM_API_KEY") or "local",  # 로컬 서버는 키를 안 본다
        base_url=base_url,
        max_retries=0,
    )
    return {_LOCAL_PREFIX: OpenAIAdapter(client, api="chat")}


_DIRECTIVES_PATH = pathlib.Path(__file__).resolve().parent / "data" / "replan_directives.yaml"


def _replan_directives() -> tuple:
    """KB-4 재계획 지시 사전 (칩·자유입력 해석). 없거나 깨져도 기동을 막지 않는다.

    **여기서 읽는 이유**: yaml 파서 의존은 `llm_gateway/prompts.py` 전용이라는
    아키텍처 규칙이 있어(`test_yaml_only_imported_in_llm_gateway_prompts`) `src/`
    안에서 못 읽는다. `load_directive_file(path, parse)` 가 파서를 인자로 받게
    설계된 것이 그 때문이고, `main.py` 는 `src/` 밖이라 여기가 그 자리다.

    사전이 없으면 `/replan` 이 칩·자유입력을 해석하지 못하고 그 사실을 응답 노트
    (`directive_dictionary_absent`)로 낸다 — 조용히 무시하는 것과 다르다.
    """
    try:
        import yaml

        from trippilot.agents.planb.directives import load_directive_file

        return load_directive_file(_DIRECTIVES_PATH, yaml.safe_load)
    except Exception as e:  # 파일 부재·형식 위반 — 지시 없이도 재계획은 된다
        logging.getLogger("trippilot.main").warning(
            "replan_directives 로드 실패 %s: %s — 지시 해석 없이 기동", type(e).__name__, e)
        return ()


def build_app_from_env() -> FastAPI:
    """env → 앱 조립 스위치. 미설정 경로는 기존과 동일(회귀 없음)."""
    configure_logging()  # 조립 로그부터 보이게 — 실패해도 기동 전에 드러난다 (TRIP-914)
    if os.environ.get("TRIPPILOT_WIRING") == "unwired":
        return create_app()
    weather = _kma_weather()
    poi_db = _backend_poi_db()
    travel = _tmap_travel()
    events = _event_store()
    existence = _place_existence()
    vector_store, embedding = _vector_rag()
    provider = _env("TRIPPILOT_LLM_PROVIDER")
    if provider is None:
        return build_dev_app(weather=weather, poi_db=poi_db, events=events,
                             vector_store=vector_store, embedding=embedding,
                             travel_port=travel, existence=existence)
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
    feature_models = _feature_models_from_env()
    local_routes = _local_route(feature_models)
    if local_routes:
        from trippilot.llm_gateway.adapters.routing import RoutingLlm

        # mixed 면 이미 RoutingLlm 이다 — 바깥에서 local 접두어만 가로채고 나머지는
        # 안쪽 라우터에 위임한다(합성). 접두어가 겹치지 않으므로 순서 의존이 없다.
        llm = RoutingLlm(default=llm, routes=local_routes)
    return build_dev_app(llm=llm, model_id=model_id, weather=weather,
                         poi_db=poi_db, events=events,
                         vector_store=vector_store, embedding=embedding,
                         travel_port=travel, existence=existence,
                         feature_models=feature_models,
                         retry_models=_retry_models_from_env(),
                         directives=_replan_directives())


# ASGI 진입점 — `uvicorn main:app` 으로도 기동 가능.
app = build_app_from_env()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
