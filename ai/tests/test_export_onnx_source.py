"""ONNX 내보내기가 **어느 가중치를 읽는가** (TRIP-965).

이미지 빌드 안에서 돌 때 문제가 된다. 그 시점에는 `HF_HUB_OFFLINE=1` 이고 가중치는
이미 `/models/kure` 에 fp16 으로 구워져 있다(`bake_model.py`). 모델명을 그대로 쓰면
허브로 나가려다 **빌드가 죽는다.**

그리고 읽은 뒤 fp32 로 되올려야 한다 — 구운 것은 fp16 이고, CPU 에 fp16 고속 경로가
없어 그대로 내보내면 느린 그래프가 나온다(TRIP-518 에서 19배 실측).
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parents[1] / "embedding" / "export_onnx.py"


def _load_script(monkeypatch: pytest.MonkeyPatch):
    spec = importlib.util.spec_from_file_location("trippilot_export_onnx_under_test", _SCRIPT)
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, spec.name, module)
    spec.loader.exec_module(module)
    return module


def test_baked_weights_win_over_the_hub_name(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EMBEDDING_MODEL_PATH", "/models/kure")

    assert _load_script(monkeypatch).model_source() == "/models/kure"


def test_falls_back_to_the_model_name_when_nothing_is_baked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("EMBEDDING_MODEL_PATH", raising=False)
    monkeypatch.delenv("EMBEDDING_MODEL", raising=False)

    assert _load_script(monkeypatch).model_source() == "nlpai-lab/KURE-v1"


def test_model_name_env_is_honoured(monkeypatch: pytest.MonkeyPatch) -> None:
    # 모델을 바꾸는 실험은 env 로 한다 — 스크립트를 고쳐 쓰면 그 커밋이 남지 않는다.
    monkeypatch.delenv("EMBEDDING_MODEL_PATH", raising=False)
    monkeypatch.setenv("EMBEDDING_MODEL", "some-org/other-model")

    assert _load_script(monkeypatch).model_source() == "some-org/other-model"
