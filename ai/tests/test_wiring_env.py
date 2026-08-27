"""TRIP-344 — 데모 POI 시드 UUID 정렬 + env 실배선 분기 (공동 통합테스트 감사 F2).

증명하는 것:
  ① 데모 시드 4건이 백엔드 `R__seed_stub_pois.sql`과 id·이름·좌표·카테고리 일치
     (값 하드코딩 비교 — 어느 한쪽만 바뀌면 여기서 깨져 드리프트가 드러난다)
     + poi_id 전건이 유효 UUID(백엔드 AiSlot.poiId 역직렬화 가능)
  ② env 미설정 → 기존과 동일한 fake 조립(UnwiredLlm) — 회귀 없음
  ③ TRIPPILOT_LLM_PROVIDER=openai + 키 없음(빈 문자열 포함) → 기동 실패(명시 에러)
     — silent fallback 금지(INV-4는 런타임 폴백이지 설정 오류 은폐가 아니다)
  ④ 키 있음 → OpenAIAdapter 조립(기본 responses·gpt-5.6-terra) — 조립만, 실 호출 0(D37)
"""

from __future__ import annotations

import uuid

import pytest
from fastapi import FastAPI

import main
from trippilot.api import wiring
from trippilot.llm_gateway.adapters.openai_adapter import OpenAIAdapter
from trippilot.domain.poi import PoiCategory

# 정본: backend/app/src/main/resources/db/migration/R__seed_stub_pois.sql
# (카테고리는 boundaryCode 한→영: 자연=NATURE·맛집=FOOD·카페=CAFE)
_BACKEND_SEED = {
    "e0000000-0000-4000-8000-000000000001":
        ("성산일출봉", 33.4587, 126.9427, PoiCategory.NATURE),
    "e0000000-0000-4000-8000-000000000002":
        ("제주 흑돼지거리", 33.5108, 126.5219, PoiCategory.FOOD),
    "e0000000-0000-4000-8000-000000000003":
        ("월정리 카페거리", 33.5563, 126.7960, PoiCategory.CAFE),
    "e0000000-0000-4000-8000-000000000004":
        ("한라산", 33.3617, 126.5292, PoiCategory.NATURE),
}

_ENV_VARS = ("TRIPPILOT_WIRING", "TRIPPILOT_LLM_PROVIDER", "OPENAI_API_KEY",
             "OPENAI_BASE_URL", "OPENAI_MODEL", "OPENAI_API",
             "TRIPPILOT_BACKEND_BASE_URL", "TRIPPILOT_SERVICE_AUTH_TOKEN",
             "TRIPPILOT_VECTOR_DB_URL", "TRIPPILOT_EMBEDDING_PROVIDER",
             "TRIPPILOT_EMBEDDING_MODEL", "EVENTS_STORE")


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """개발 머신의 잔존 env가 분기 테스트를 오염시키지 않게 전건 제거."""
    for var in _ENV_VARS:
        monkeypatch.delenv(var, raising=False)


# ── ① 시드 ↔ 백엔드 시드 정합 ────────────────────────────────────────


def test_demo_seed_mirrors_backend_seed_exactly() -> None:
    seed = wiring.demo_poi_seed()
    assert {str(p.poi_id) for p in seed} == set(_BACKEND_SEED)
    for poi in seed:
        name, lat, lng, category = _BACKEND_SEED[str(poi.poi_id)]
        assert (poi.name, poi.coord.lat, poi.coord.lng, poi.category) == (
            name, lat, lng, category
        ), f"백엔드 시드와 불일치: {poi.poi_id}"


def test_demo_seed_poi_ids_are_valid_uuid_strings() -> None:
    """백엔드 AiSlot.poiId(UUID) 역직렬화 가능 — 캐노니컬 표기까지 동일해야 한다."""
    for poi in wiring.demo_poi_seed():
        assert str(uuid.UUID(str(poi.poi_id))) == str(poi.poi_id)


def test_demo_anchor_reaches_seed_pois_within_public_radius() -> None:
    """앵커 기준 PUBLIC 반경(10km) 안에 시드가 있어야 데모 생성이 빈손이 아니다."""
    in_radius = [
        p for p in wiring.demo_poi_seed()
        if wiring.haversine_km(wiring.DEMO_ANCHOR, p.coord) <= 10.0
    ]
    assert in_radius, "DEMO_ANCHOR 반경 10km 안 시드 0건 — 데모 생성이 항상 빈손"


# ── ② env 미설정 → 기존 fake 조립 그대로 (회귀 없음) ─────────────────


def test_env_unset_dispatches_to_default_dev_assembly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict = {"called": False}

    def spy(**kwargs: object) -> object:
        captured["called"] = True
        captured.update(kwargs)
        return FastAPI()

    monkeypatch.setattr(main, "build_dev_app", spy)
    main.build_app_from_env()
    assert captured["called"] is True
    assert "llm" not in captured  # 기본 경로 — LLM 주입 없음(UnwiredLlm 유지)


def test_default_dev_assembly_keeps_unwired_llm(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """build_dev_app 기본값이 UnwiredLlm인지 조립 인자를 직접 확인(회귀 가드)."""
    captured: dict = {}
    real = wiring.build_orchestrator

    def spy(**kwargs: object) -> object:
        captured.update(kwargs)
        return real(**kwargs)

    monkeypatch.setattr(wiring, "build_orchestrator", spy)
    wiring.build_dev_app()
    assert isinstance(captured["llm"], wiring.UnwiredLlm)


def test_unwired_mode_still_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    """TRIPPILOT_WIRING=unwired는 격리 모드 — 라우트가 503으로 응답해야 한다."""
    from fastapi.testclient import TestClient

    monkeypatch.setenv("TRIPPILOT_WIRING", "unwired")
    with TestClient(main.build_app_from_env(),
                    raise_server_exceptions=False) as client:
        assert client.get("/health").status_code == 200
        response = client.post("/ai/v1/itinerary/validate", json={})
        assert response.status_code in (422, 503)  # 미주입 앱 — 정상 조립 아님


# ── ③ openai 선택 + 조립 불가 → 기동 실패 (silent fallback 금지) ─────


def test_openai_provider_without_key_fails_startup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TRIPPILOT_LLM_PROVIDER", "openai")
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        main.build_app_from_env()


def test_openai_provider_empty_key_fails_startup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """빈 문자열도 미설정 취급 — CI·compose가 비운 secret을 ''로 주입한다."""
    monkeypatch.setenv("TRIPPILOT_LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "")
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        main.build_app_from_env()


def test_unknown_provider_fails_startup(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TRIPPILOT_LLM_PROVIDER", "gemini")
    with pytest.raises(RuntimeError, match="TRIPPILOT_LLM_PROVIDER"):
        main.build_app_from_env()


def test_openai_invalid_api_mode_fails_startup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TRIPPILOT_LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-no-real-call")
    monkeypatch.setenv("OPENAI_API", "grpc")
    with pytest.raises(ValueError, match="chat|responses"):
        main.build_app_from_env()


# ── ④ openai 실배선 조립 (조립만 — 실 API 호출 0, D37) ───────────────


def test_openai_provider_assembles_adapter_with_defaults(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TRIPPILOT_LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-no-real-call")
    llm, model_id = main._openai_llm_and_model()
    assert isinstance(llm, OpenAIAdapter)
    assert model_id == "gpt-5.6-terra"
    # 내부 필드지만 계약상 중요: 멘토 게이트웨이는 responses만 라우팅한다(TRIP-340).
    assert llm._api == "responses"


def test_openai_provider_builds_full_app(monkeypatch: pytest.MonkeyPatch) -> None:
    """키가 있으면 전체 조립이 성공한다 — 클라이언트 생성은 네트워크 호출이 아니다."""
    monkeypatch.setenv("TRIPPILOT_LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-no-real-call")
    monkeypatch.setenv("OPENAI_MODEL", "gpt-5.6")
    monkeypatch.setenv("OPENAI_API", "chat")
    assert isinstance(main.build_app_from_env(), FastAPI)


# ── ⑤ 백엔드 POI 정본 실연동 분기 (TRIP-408 — 조립만, 실 호출 0) ─────


def _spy_dev_app(monkeypatch: pytest.MonkeyPatch) -> dict:
    captured: dict = {}

    def spy(**kwargs: object) -> object:
        captured.update(kwargs)
        return FastAPI()

    monkeypatch.setattr(main, "build_dev_app", spy)
    return captured


def test_backend_poi_env_unset_keeps_static_seed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """미설정 → poi_db=None → build_dev_app 이 StaticPoiDb 기본값으로 조립(AC 하위호환)."""
    captured = _spy_dev_app(monkeypatch)
    main.build_app_from_env()
    assert captured["poi_db"] is None
    real = wiring.build_orchestrator
    inner: dict = {}

    def spy(**kwargs: object) -> object:
        inner.update(kwargs)
        return real(**kwargs)

    monkeypatch.setattr(wiring, "build_orchestrator", spy)
    wiring.build_dev_app(poi_db=None)
    assert isinstance(inner["poi_db"], wiring.StaticPoiDb)


def test_backend_poi_env_set_wires_backend_adapter(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from trippilot.poi_curation.adapters.backend_poi_db import BackendPoiDb

    monkeypatch.setenv("TRIPPILOT_BACKEND_BASE_URL", "http://backend:8080")
    monkeypatch.setenv("TRIPPILOT_SERVICE_AUTH_TOKEN", "secret")
    captured = _spy_dev_app(monkeypatch)
    main.build_app_from_env()
    assert isinstance(captured["poi_db"], BackendPoiDb)


@pytest.mark.parametrize("token", [None, ""])
def test_backend_url_without_token_fails_startup(
    monkeypatch: pytest.MonkeyPatch, token: str | None,
) -> None:
    """주소만 있고 토큰 없음(빈 문자열 포함) → 기동 실패 — /internal 은 fail-closed."""
    monkeypatch.setenv("TRIPPILOT_BACKEND_BASE_URL", "http://backend:8080")
    if token is not None:
        monkeypatch.setenv("TRIPPILOT_SERVICE_AUTH_TOKEN", token)
    with pytest.raises(RuntimeError, match="TRIPPILOT_SERVICE_AUTH_TOKEN"):
        main.build_app_from_env()


# ── ⑥ Plan-B RAG 벡터 실배선 분기 (TRIP-428 — 조립만, 실 호출 0) ─────


def test_vector_env_unset_leaves_rag_unwired(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = _spy_dev_app(monkeypatch)
    main.build_app_from_env()
    assert captured["vector_store"] is None and captured["embedding"] is None


def test_vector_env_set_wires_pgvector_and_openai_embedding(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from trippilot.agents.adapters.pgvector_store import PgVectorStore
    from trippilot.llm_gateway.adapters.openai_embedding import OpenAiEmbeddingAdapter

    monkeypatch.setenv("TRIPPILOT_VECTOR_DB_URL", "postgresql://x:x@localhost:5433/ai_kb")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-no-real-call")
    captured = _spy_dev_app(monkeypatch)
    main.build_app_from_env()  # 커넥션은 지연 팩토리 — 조립 시 실 접속 없음
    assert isinstance(captured["vector_store"], PgVectorStore)
    assert isinstance(captured["embedding"], OpenAiEmbeddingAdapter)


@pytest.mark.parametrize("key", [None, ""])
def test_vector_url_without_embedding_key_fails_startup(
    monkeypatch: pytest.MonkeyPatch, key: str | None,
) -> None:
    monkeypatch.setenv("TRIPPILOT_VECTOR_DB_URL", "postgresql://x:x@localhost:5433/ai_kb")
    if key is not None:
        monkeypatch.setenv("OPENAI_API_KEY", key)
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        main.build_app_from_env()


def test_env_anthropic_provider_assembles(monkeypatch):
    """TRIPPILOT_LLM_PROVIDER=anthropic — AnthropicAdapter 조립 (TRIP-421)."""
    import sys
    import types

    calls = {}

    class _FakeAnthropicClient:
        def __init__(self, **kwargs):
            calls.update(kwargs)

    fake_sdk = types.ModuleType("anthropic")
    fake_sdk.Anthropic = _FakeAnthropicClient
    monkeypatch.setitem(sys.modules, "anthropic", fake_sdk)
    monkeypatch.setenv("TRIPPILOT_LLM_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k-test")
    monkeypatch.setenv("ANTHROPIC_MODEL", "claude-x")

    import main as main_mod
    llm, model_id = main_mod._anthropic_llm_and_model()

    from trippilot.llm_gateway.adapters.anthropic_adapter import AnthropicAdapter
    assert isinstance(llm, AnthropicAdapter)
    assert model_id == "claude-x"
    assert calls == {"api_key": "k-test", "max_retries": 0}  # 재시도 무익 정책 (TRIP-381)


def test_env_anthropic_without_key_fails_fast(monkeypatch):
    monkeypatch.setenv("TRIPPILOT_LLM_PROVIDER", "anthropic")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    import main as main_mod
    import pytest as _pytest
    with _pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
        main_mod._anthropic_llm_and_model()


def test_feature_model_override_beats_tier(monkeypatch):
    """TRIP-513 — feature_models 오버라이드가 tier 해석보다 우선."""
    from trippilot.llm_gateway.config import C1Config
    from trippilot.llm_gateway.gateway import TierRouter
    from trippilot.domain.llm import LlmFeature, ModelTier

    cfg = C1Config(
        model_ids={ModelTier.LIGHT: "gpt-l", ModelTier.HEAVY: "gpt-h"},
        feature_models={LlmFeature.EXPLANATION: "claude-sonnet-4-5"},
    )
    router = TierRouter(cfg)
    assert router.route(LlmFeature.EXPLANATION) == "claude-sonnet-4-5"  # 오버라이드
    assert router.route(LlmFeature.INTENT) == "gpt-l"  # 미배정 — 기존 tier 해석


def test_routing_llm_dispatches_by_model_prefix():
    """TRIP-513 — claude* 모델은 Anthropic 어댑터로, 그 외는 기본으로."""
    from trippilot.llm_gateway.adapters.routing import RoutingLlm
    from trippilot.ports.llm_port import LlmRequest
    from trippilot.domain.prompt import PromptRef

    class _Port:
        def __init__(self, tag): self.tag, self.got = tag, []
        def invoke(self, request):
            self.got.append(request.model_id)
            return self.tag

    gpt, claude = _Port("gpt"), _Port("claude")
    router = RoutingLlm(default=gpt, routes={"claude": claude})
    ref = PromptRef(prompt_id="p", version="0", feature="INTENT")

    def _req(model): return LlmRequest(model_id=model, prompt="x", prompt_ref=ref,
                                       max_tokens=10, temperature=0.0)
    assert router.invoke(_req("Claude-Sonnet-4-5")) == "claude"  # 대소문자 무시
    assert router.invoke(_req("gpt-5.6-terra")) == "gpt"
    assert claude.got == ["Claude-Sonnet-4-5"] and gpt.got == ["gpt-5.6-terra"]


def test_feature_models_env_parsing(monkeypatch):
    """TRIP-513 — 콤마 목록 파싱, 미지 feature 는 기동 실패 (조용한 기본화 금지)."""
    import main as main_mod
    import pytest as _pytest
    from trippilot.domain.llm import LlmFeature

    monkeypatch.setenv("TRIPPILOT_LLM_FEATURE_MODELS",
                       "EXPLANATION=claude-sonnet-4-5, reflection_nudge=claude-haiku-4-5")
    parsed = main_mod._feature_models_from_env()
    assert parsed == {LlmFeature.EXPLANATION: "claude-sonnet-4-5",
                      LlmFeature.REFLECTION_NUDGE: "claude-haiku-4-5"}  # 소문자 허용

    monkeypatch.setenv("TRIPPILOT_LLM_FEATURE_MODELS", "NO_SUCH=m")
    with _pytest.raises(RuntimeError, match="미지 feature"):
        main_mod._feature_models_from_env()

# ── local(KURE) 임베딩 분기 (팀 결정 2026-08-22: 로컬 우선) ──────────────


def test_vector_rag_local_without_package_fails_fast(monkeypatch) -> None:
    """provider=local + sentence-transformers 미설치 = 기동 실패 (silent fallback 금지)."""
    import sys as _sys

    monkeypatch.setenv("TRIPPILOT_VECTOR_DB_URL", "postgresql://x:x@localhost:5433/x")
    monkeypatch.setenv("TRIPPILOT_EMBEDDING_PROVIDER", "local")
    monkeypatch.setitem(_sys.modules, "sentence_transformers", None)  # import 시 ImportError
    with pytest.raises(RuntimeError, match="sentence-transformers 미설치"):
        main._vector_rag()


def test_vector_rag_unknown_provider_lists_local(monkeypatch) -> None:
    """미지원 값 에러가 세 갈래(openai|titan|local)를 전부 안내한다."""
    monkeypatch.setenv("TRIPPILOT_VECTOR_DB_URL", "postgresql://x:x@localhost:5433/x")
    monkeypatch.setenv("TRIPPILOT_EMBEDDING_PROVIDER", "voyage")
    with pytest.raises(RuntimeError, match=r"openai\|titan\|local"):
        main._vector_rag()


# ── 행사 저장소 배선 (TRIP-421) ──────────────────────────────────────
# 이 배선의 실패 모드는 예외가 아니라 **조용한 빈 저장소**다 — 경로가 틀리거나
# 파일이 사라져도 JsonEventStore 는 빈 문서로 조립되고 일정은 행사 없이 나온다.
# 그래서 "미설정=미배선"과 "compose 기본값이 가리키는 파일이 실재한다"를 함께 건다.


def test_events_store_unset_is_not_wired(monkeypatch) -> None:
    monkeypatch.delenv("EVENTS_STORE", raising=False)
    assert main._event_store() is None


def test_events_store_env_wires_readable_store(monkeypatch, tmp_path) -> None:
    import json as _json
    from datetime import date as _date

    from trippilot.background.event_store import JsonEventStore

    path = tmp_path / "events.json"
    path.write_text(_json.dumps({
        "events": [{"event_id": "evx-1", "name": "가을축제", "event_type": "FESTIVAL",
                    "start": "2026-09-01", "end": "2026-09-03", "coord": None}],
        "coverage": {}, "pointer": 0,
    }), encoding="utf-8")
    monkeypatch.setenv("EVENTS_STORE", str(path))

    store = main._event_store()
    assert isinstance(store, JsonEventStore)
    events, truncated = store.search_events(_date(2026, 9, 2), _date(2026, 9, 5))
    assert [e.name for e in events] == ["가을축제"] and truncated is False


def test_events_store_missing_file_fails_startup(monkeypatch, tmp_path) -> None:
    """경로를 줬는데 파일이 없으면 기동 실패 — 빈 저장소로 조용히 도는 것을 막는다.

    JsonEventStore 는 없는 파일을 빈 문서로 삼키고, 그 뒤 EventProvider 는 status=OK·
    행사 0건을 내며 보너스 단계는 Degradation 조차 남기지 않는다. 경로 오타 하나가
    영구 무보정이 되는 경로라 조립 단계에서 끊는다 (_vector_rag 와 같은 규약).
    """
    monkeypatch.setenv("EVENTS_STORE", str(tmp_path / "없는파일.json"))
    with pytest.raises(RuntimeError, match="EVENTS_STORE"):
        main._event_store()


def test_shipped_events_store_is_not_empty() -> None:
    """compose 기본값 `data/collected_events.json` 이 실재하고 행사가 들어 있다.
    파일이 사라지면 배선은 살아 있는 채로 빈 저장소가 된다 (조용한 무보정)."""
    import json as _json
    from pathlib import Path as _Path

    shipped = _Path(__file__).resolve().parents[1] / "data" / "collected_events.json"
    assert shipped.exists(), f"동봉 행사 저장소 없음: {shipped}"
    assert _json.loads(shipped.read_text(encoding="utf-8"))["events"], "행사 0건"
