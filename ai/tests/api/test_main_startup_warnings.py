"""기동 시 외부 배선 공백 경고 — 기동은 되고 품질만 조용히 떨어지는 것들을 1줄씩 WARN + 도우미 env 2종 해석.

증명하는 것:
  ① 임베딩 미배선 → 1줄 (Plan-B KB 검색이 요청마다 "실 임베딩 미배선")
  ② 실 LLM 인데 기능별 모델 배정이 비었음 → 1줄 (전 기능이 단일 모델)
  ③ WEATHER_API 미설정 → 1줄 (날씨 보정 없음)
  ④ 도우미 메모리 DSN(TRIPPILOT_VECTOR_DB_URL) 미설정 → 1줄 "도우미 메모리 미설정" (assistant-orchestrator T017)
  ⑤ 다 배선되면 경고 0줄 · 조건별로 정확히 1줄씩
  ⑥ `TRIPPILOT_DIALOGUE_ORCHESTRATOR` on|off(기본 off, 오타는 기동 실패) · `TRIPPILOT_DIALOGUE_SHADOW_RATE` 0~1(기본 1.0,
     범위 밖·숫자 아님은 기동 실패) 이 `build_dev_app` 인자로 관통한다 — 오타가 조용히 off 로 떨어지면 "켰다"가 거짓이 된다
  ⑦ DSN 이 있으면 `PgDialogueMemoryStore`(연결은 지연 — 조립만, 실 DB 0), 없으면 None(= wiring 의 InMemory)
조립 함수는 전부 스텁 — 실 HTTP·DB 호출 0.
"""

from __future__ import annotations

import logging

import pytest
from fastapi import FastAPI

import main
from trippilot.agents.adapters.pg_memory_store import PgDialogueMemoryStore

_WIRED = object()


@pytest.fixture(autouse=True)
def _stub_assembly(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("_backend_poi_db", "_travel_chain", "_event_store",
                 "_place_existence", "_place_hours"):
        monkeypatch.setattr(main, name, lambda: None)
    monkeypatch.setattr(main, "build_dev_app", lambda **_: FastAPI())
    for var in ("TRIPPILOT_WIRING", "TRIPPILOT_LLM_PROVIDER",
                "TRIPPILOT_LLM_FEATURE_MODELS", "TRIPPILOT_LLM_RETRY_MODELS",
                "TRIPPILOT_VECTOR_DB_URL", "TRIPPILOT_DIALOGUE_ORCHESTRATOR",
                "TRIPPILOT_DIALOGUE_SHADOW_RATE"):
        monkeypatch.delenv(var, raising=False)


def _warnings(monkeypatch, caplog, *, weather, embedding, memory=None, provider=None,
              feature_models: str | None = None) -> list[str]:
    monkeypatch.setattr(main, "_kma_weather", lambda: weather)
    monkeypatch.setattr(main, "_vector_rag", lambda: (embedding, embedding))
    monkeypatch.setattr(main, "_memory_store", lambda: memory)
    if provider is not None:
        monkeypatch.setenv("TRIPPILOT_LLM_PROVIDER", provider)
        monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")  # 조립만, 호출 0
    if feature_models is not None:
        monkeypatch.setenv("TRIPPILOT_LLM_FEATURE_MODELS", feature_models)
    with caplog.at_level(logging.INFO, logger="trippilot"):
        main.build_app_from_env()
    return [r.getMessage() for r in caplog.records
            if r.name == "trippilot.main" and r.levelno == logging.WARNING]


def test_all_unwired_fake_llm_warns_embedding_weather_and_memory(monkeypatch, caplog):
    msgs = _warnings(monkeypatch, caplog, weather=None, embedding=None, memory=None)
    assert len(msgs) == 3
    assert sum("임베딩" in m for m in msgs) == 1
    assert sum("WEATHER_API" in m for m in msgs) == 1
    assert sum("도우미 메모리 미설정" in m for m in msgs) == 1


def test_real_llm_without_feature_models_warns_single_model(monkeypatch, caplog):
    msgs = _warnings(monkeypatch, caplog, weather=_WIRED, embedding=_WIRED, memory=_WIRED,
                     provider="anthropic")
    assert len(msgs) == 1 and "TRIPPILOT_LLM_FEATURE_MODELS" in msgs[0]


def test_fully_wired_emits_no_warning(monkeypatch, caplog):
    msgs = _warnings(monkeypatch, caplog, weather=_WIRED, embedding=_WIRED, memory=_WIRED,
                     provider="anthropic",
                     feature_models="ALTERNATIVE_SELECTION=claude-haiku-4-5")
    assert msgs == []


def test_memory_warning_names_the_env_var_and_fires_once(monkeypatch, caplog):
    """DSN 만 빠진 조립 — 그 한 줄만, 변수 이름을 품고(운영자가 무엇을 채울지 바로 알게)."""
    (msg,) = _warnings(monkeypatch, caplog, weather=_WIRED, embedding=_WIRED, memory=None,
                       provider="anthropic", feature_models="ALTERNATIVE_SELECTION=m")
    assert "도우미 메모리 미설정" in msg and "TRIPPILOT_VECTOR_DB_URL" in msg


def _infos(monkeypatch, caplog, *, feature_models: str) -> list[str]:
    monkeypatch.setattr(main, "_kma_weather", lambda: _WIRED)
    monkeypatch.setattr(main, "_vector_rag", lambda: (_WIRED, _WIRED))
    monkeypatch.setattr(main, "_memory_store", lambda: _WIRED)
    monkeypatch.setenv("TRIPPILOT_LLM_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
    monkeypatch.setenv("TRIPPILOT_LLM_FEATURE_MODELS", feature_models)
    with caplog.at_level(logging.INFO, logger="trippilot"):
        main.build_app_from_env()
    return [r.getMessage() for r in caplog.records
            if r.name == "trippilot.main" and "기능별 모델 배정" in r.getMessage()]


def test_assignment_count_and_missing_features_are_logged_once(monkeypatch, caplog):
    """새 feature 가 들어왔는데 시크릿 배정이 안 따라오면 미배정 목록에 이름이 보인다."""
    from trippilot.domain.llm import LlmFeature

    [line] = _infos(monkeypatch, caplog,
                    feature_models="ALTERNATIVE_SELECTION=m1,INTENT=m2")
    assert line.startswith(f"기능별 모델 배정 2종 / 미배정 {len(LlmFeature) - 2}종: ")
    assert "ALTERNATIVE_SELECTION" not in line and "PREFERENCE_SCORING" in line


def test_full_assignment_logs_no_missing_list(monkeypatch, caplog):
    from trippilot.domain.llm import LlmFeature

    everything = ",".join(f"{f.value}=m" for f in LlmFeature)
    [line] = _infos(monkeypatch, caplog, feature_models=everything)
    assert line == f"기능별 모델 배정 {len(LlmFeature)}종 / 미배정 0종"


# ── ⑥ 도우미 오케스트레이터 env 2종 → build_dev_app 인자 관통 ───────────────────


def _dev_app_kwargs(monkeypatch, **env: str) -> dict:
    """fake 조립(LLM_PROVIDER 미설정) 경로로 `build_dev_app` 에 넘어간 인자를 잡는다."""
    seen: dict = {}

    def _capture(**kwargs):
        seen.update(kwargs)
        return FastAPI()

    monkeypatch.setattr(main, "build_dev_app", _capture)
    monkeypatch.setattr(main, "_kma_weather", lambda: _WIRED)
    monkeypatch.setattr(main, "_vector_rag", lambda: (_WIRED, _WIRED))
    monkeypatch.setattr(main, "_memory_store", lambda: _WIRED)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    main.build_app_from_env()
    return seen


def test_dialogue_env_defaults_are_off_and_full_shadow(monkeypatch):
    kwargs = _dev_app_kwargs(monkeypatch)
    assert kwargs["dialogue_orchestrator_enabled"] is False
    assert kwargs["shadow_rate"] == 1.0
    assert kwargs["memory_store"] is _WIRED


@pytest.mark.parametrize("raw, expected", [("on", True), ("off", False), ("", False), ("  on ", True)])
def test_dialogue_orchestrator_switch_is_exact_on_off(monkeypatch, raw, expected):
    kwargs = _dev_app_kwargs(monkeypatch, TRIPPILOT_DIALOGUE_ORCHESTRATOR=raw)
    assert kwargs["dialogue_orchestrator_enabled"] is expected


@pytest.mark.parametrize("bad", ["On", "true", "1", "yes"])
def test_dialogue_orchestrator_typo_fails_startup(monkeypatch, bad):
    """오타가 조용히 off 로 떨어지면 '켰다' 가 거짓이 된다 — `TRIPPILOT_LLM_PROVIDER` 와 같은 규칙."""
    with pytest.raises(RuntimeError, match=f"TRIPPILOT_DIALOGUE_ORCHESTRATOR.*{bad!r}"):
        _dev_app_kwargs(monkeypatch, TRIPPILOT_DIALOGUE_ORCHESTRATOR=bad)


@pytest.mark.parametrize("raw, expected", [("0", 0.0), ("0.2", 0.2), ("1", 1.0), ("1.0", 1.0), ("", 1.0)])
def test_shadow_rate_is_parsed_within_unit_interval(monkeypatch, raw, expected):
    kwargs = _dev_app_kwargs(monkeypatch, TRIPPILOT_DIALOGUE_SHADOW_RATE=raw)
    assert kwargs["shadow_rate"] == pytest.approx(expected)


@pytest.mark.parametrize("bad", ["1.5", "-0.1", "abc", "20%"])
def test_shadow_rate_outside_unit_interval_fails_startup(monkeypatch, bad):
    with pytest.raises(RuntimeError, match=f"TRIPPILOT_DIALOGUE_SHADOW_RATE.*{bad!r}"):
        _dev_app_kwargs(monkeypatch, TRIPPILOT_DIALOGUE_SHADOW_RATE=bad)


def test_dialogue_env_also_reaches_the_real_llm_branch(monkeypatch):
    kwargs = _dev_app_kwargs(monkeypatch, TRIPPILOT_LLM_PROVIDER="anthropic", ANTHROPIC_API_KEY="dummy",
                             TRIPPILOT_DIALOGUE_ORCHESTRATOR="on", TRIPPILOT_DIALOGUE_SHADOW_RATE="0.2")
    assert kwargs["dialogue_orchestrator_enabled"] is True and kwargs["shadow_rate"] == pytest.approx(0.2)


# ── ⑦ 메모리 스토어 조립 ─────────────────────────────────────────────────────


def test_memory_store_is_none_without_dsn(monkeypatch):
    monkeypatch.delenv("TRIPPILOT_VECTOR_DB_URL", raising=False)
    assert main._memory_store() is None
    monkeypatch.setenv("TRIPPILOT_VECTOR_DB_URL", "   ")  # 공백만 = 미설정 (TRIP-882 계열)
    assert main._memory_store() is None


def test_memory_store_is_pg_adapter_with_dsn_and_connects_lazily(monkeypatch):
    """조립은 연결하지 않는다 — 이 테스트가 실 DB 없이 도는 것이 그 증명이다."""
    monkeypatch.setenv("TRIPPILOT_VECTOR_DB_URL", "postgresql://ai_user:x@db.invalid:5432/ai_kb")
    assert isinstance(main._memory_store(), PgDialogueMemoryStore)
