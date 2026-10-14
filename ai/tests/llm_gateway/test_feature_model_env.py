"""TRIPPILOT_LLM_FEATURE_MODELS 파서 — 앱 조립과 리허설이 공유하는 설정 해석.

증명하는 것: 오타·형식 오류가 **조용히 넘어가지 않는다**. 이 파서가 관대하면
"그 기능만 몰래 기본 모델로 도는" 상태가 생기고, 운영과 리허설이 다른 모델을
태우는 것을 아무도 모르게 된다.
"""

from __future__ import annotations

import pytest

from trippilot.domain.llm import LlmFeature
from trippilot.llm_gateway.feature_model_env import ENV_VAR, feature_models_from_env


def test_미설정이면_빈_매핑(monkeypatch) -> None:
    monkeypatch.delenv(ENV_VAR, raising=False)
    assert feature_models_from_env() == {}


def test_빈_문자열도_빈_매핑(monkeypatch) -> None:
    monkeypatch.setenv(ENV_VAR, "")
    assert feature_models_from_env() == {}


def test_단일_오버라이드() -> None:
    assert feature_models_from_env("ALTERNATIVE_SELECTION=gpt-5.6-sol") == {
        LlmFeature.ALTERNATIVE_SELECTION: "gpt-5.6-sol"
    }


def test_여러_기능과_공백_허용() -> None:
    parsed = feature_models_from_env(
        " ALTERNATIVE_SELECTION = gpt-5.6-sol , reflection_template=claude-sonnet-5 ,, ")
    assert parsed == {
        LlmFeature.ALTERNATIVE_SELECTION: "gpt-5.6-sol",
        LlmFeature.REFLECTION_TEMPLATE: "claude-sonnet-5",
    }


def test_미지_feature_는_기동_실패() -> None:
    """오타가 '그 기능만 기본 모델'로 조용히 떨어지면 안 된다."""
    with pytest.raises(RuntimeError, match="미지 feature"):
        feature_models_from_env("ALTERNATIVE_SELECTON=gpt-5.6-sol")  # 오타


@pytest.mark.parametrize("raw", ["ALTERNATIVE_SELECTION", "ALTERNATIVE_SELECTION=", "=gpt-5.6-sol"])
def test_형식_오류는_즉시_실패(raw: str) -> None:
    with pytest.raises(RuntimeError):
        feature_models_from_env(raw)


def test_env_보다_인자가_우선(monkeypatch) -> None:
    """리허설이 명시값을 넘길 수 있어야 한다 — env 오염과 분리."""
    monkeypatch.setenv(ENV_VAR, "REFLECTION_TEMPLATE=claude-sonnet-5")
    assert feature_models_from_env("ALTERNATIVE_SELECTION=gpt-5.6-sol") == {
        LlmFeature.ALTERNATIVE_SELECTION: "gpt-5.6-sol"
    }
