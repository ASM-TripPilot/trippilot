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
from trippilot.c1.adapters.openai_adapter import OpenAIAdapter
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
             "OPENAI_BASE_URL", "OPENAI_MODEL", "OPENAI_API")


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
