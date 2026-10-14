"""기동 시 외부 배선 공백 경고 — 기동은 되고 품질만 조용히 떨어지는 3가지를 1줄씩 WARN.

증명하는 것:
  ① 임베딩 미배선 → 1줄 (Plan-B KB 검색이 요청마다 "실 임베딩 미배선")
  ② 실 LLM 인데 기능별 모델 배정이 비었음 → 1줄 (전 기능이 단일 모델)
  ③ WEATHER_API 미설정 → 1줄 (날씨 보정 없음)
  ④ 다 배선되면 경고 0줄 · 조건별로 정확히 1줄씩
조립 함수는 전부 스텁 — 실 HTTP·DB 호출 0.
"""

from __future__ import annotations

import logging

import pytest
from fastapi import FastAPI

import main

_WIRED = object()


@pytest.fixture(autouse=True)
def _stub_assembly(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("_backend_poi_db", "_travel_chain", "_event_store",
                 "_place_existence", "_place_hours"):
        monkeypatch.setattr(main, name, lambda: None)
    monkeypatch.setattr(main, "build_dev_app", lambda **_: FastAPI())
    for var in ("TRIPPILOT_WIRING", "TRIPPILOT_LLM_PROVIDER",
                "TRIPPILOT_LLM_FEATURE_MODELS", "TRIPPILOT_LLM_RETRY_MODELS"):
        monkeypatch.delenv(var, raising=False)


def _warnings(monkeypatch, caplog, *, weather, embedding, provider=None,
              feature_models: str | None = None) -> list[str]:
    monkeypatch.setattr(main, "_kma_weather", lambda: weather)
    monkeypatch.setattr(main, "_vector_rag", lambda: (embedding, embedding))
    if provider is not None:
        monkeypatch.setenv("TRIPPILOT_LLM_PROVIDER", provider)
        monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")  # 조립만, 호출 0
    if feature_models is not None:
        monkeypatch.setenv("TRIPPILOT_LLM_FEATURE_MODELS", feature_models)
    with caplog.at_level(logging.INFO, logger="trippilot"):
        main.build_app_from_env()
    return [r.getMessage() for r in caplog.records
            if r.name == "trippilot.main" and r.levelno == logging.WARNING]


def test_all_unwired_fake_llm_warns_embedding_and_weather(monkeypatch, caplog):
    msgs = _warnings(monkeypatch, caplog, weather=None, embedding=None)
    assert len(msgs) == 2
    assert sum("임베딩" in m for m in msgs) == 1
    assert sum("WEATHER_API" in m for m in msgs) == 1


def test_real_llm_without_feature_models_warns_single_model(monkeypatch, caplog):
    msgs = _warnings(monkeypatch, caplog, weather=_WIRED, embedding=_WIRED,
                     provider="anthropic")
    assert len(msgs) == 1 and "TRIPPILOT_LLM_FEATURE_MODELS" in msgs[0]


def test_fully_wired_emits_no_warning(monkeypatch, caplog):
    msgs = _warnings(monkeypatch, caplog, weather=_WIRED, embedding=_WIRED,
                     provider="anthropic",
                     feature_models="ALTERNATIVE_SELECTION=claude-haiku-4-5")
    assert msgs == []


def _infos(monkeypatch, caplog, *, feature_models: str) -> list[str]:
    monkeypatch.setattr(main, "_kma_weather", lambda: _WIRED)
    monkeypatch.setattr(main, "_vector_rag", lambda: (_WIRED, _WIRED))
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
