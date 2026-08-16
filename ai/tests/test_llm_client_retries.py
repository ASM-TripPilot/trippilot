"""TRIP-381 — SDK 내부 자동 재시도 차단 (조립 지점 max_retries=0 계약).

증명하는 것: openai·anthropic SDK는 기본 max_retries=2 — 타임아웃·429·5xx에서
클라이언트가 몰래 재호출해 타임아웃 계약을 3배로 왜곡한다(2.5s 설정이 실제
~10s, 2026-08-16 계측 실측). 재시도 무익 정책(결정론 실패는 재시도로 안 바뀜)에
따라 **모든 클라이언트 생성 지점**이 max_retries=0으로 조립되는지 단언한다.

클라이언트 생성은 네트워크 호출이 아니다 — 실 API 호출 0건 (D37) 그대로.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# scripts/ 는 패키지가 아니다 — 스크립트와 같은 방식(동일 디렉토리 경로)으로 import
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import smoke_llm  # noqa: E402

import main  # noqa: E402

_ENV_VARS = (
    "TRIPPILOT_LLM_PROVIDER", "LLM_PROVIDER",
    "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL", "OPENAI_API",
    "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT",
    "AZURE_OPENAI_API_VERSION", "AZURE_OPENAI_DEPLOYMENT",
    "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL",
)


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """개발 머신의 잔존 env가 분기 테스트를 오염시키지 않게 전건 제거."""
    for var in _ENV_VARS:
        monkeypatch.delenv(var, raising=False)


def test_main_openai_client_has_sdk_retries_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """운영 조립(main._openai_llm_and_model)의 client가 max_retries=0."""
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-no-real-call")
    llm, _ = main._openai_llm_and_model()
    assert llm._client.max_retries == 0


def test_smoke_openai_client_has_sdk_retries_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-no-real-call")
    adapter, _ = smoke_llm._build_adapter()
    assert adapter._client.max_retries == 0


def test_smoke_azure_client_has_sdk_retries_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "azure")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "test-key-no-real-call")
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://fake.example.com")
    monkeypatch.setenv("AZURE_OPENAI_API_VERSION", "2024-06-01")
    adapter, _ = smoke_llm._build_adapter()
    assert adapter._client.max_retries == 0


def test_smoke_anthropic_client_has_sdk_retries_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """anthropic SDK도 기본 max_retries=2 — 동일하게 차단됐는지 확인."""
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key-no-real-call")
    adapter, _ = smoke_llm._build_adapter()
    assert adapter._client.max_retries == 0
