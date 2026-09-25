"""임베딩 백엔드 분기 (TRIP-965) — 어느 엔진이 도는지는 **기동에서 결정되고 드러난다**.

세 값이 있다. 기본은 현행이고, 나머지 둘은 같은 모델을 ONNX 그래프로 돌린다.

    sentence-transformers  PyTorch 계열, 프로세스 안 (기본)
    onnx                   ONNX Runtime, **프로세스 안** — amd64 실측 13~15% 단축
    triton                 ONNX Runtime, 별도 컨테이너 (측정용 · 단일 모델엔 수지 안 맞음)

**오타를 기본값으로 흘리지 않는다.** `EMBEDDING_BACKEND=onx` 가 조용히 현행으로 떨어지면
"바꿨는데 아무것도 안 달라졌다"를 한참 뒤진다. 그래서 기동에서 죽인다.

여기서 추론 정확성은 검증하지 않는다 — 벡터가 같은지는 모킹으로 알 수 없고
`scripts/measure_triton_embedding.py` 의 동등성 판정(코사인 ≥ 0.9999 · top-4 전부 일치)이
그 자리다(BR-MLO-05).
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_APP = Path(__file__).resolve().parents[1] / "embedding" / "app.py"


def _load_app(monkeypatch: pytest.MonkeyPatch, backend: str | None):
    """`embedding/app.py` 를 env 를 세운 채 새로 읽는다 — BACKEND 는 import 시점 값이다."""
    if backend is None:
        monkeypatch.delenv("EMBEDDING_BACKEND", raising=False)
    else:
        monkeypatch.setenv("EMBEDDING_BACKEND", backend)
    spec = importlib.util.spec_from_file_location("trippilot_embedding_app_under_test", _APP)
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, spec.name, module)
    spec.loader.exec_module(module)
    return module


def test_default_backend_is_the_current_one(monkeypatch: pytest.MonkeyPatch) -> None:
    assert _load_app(monkeypatch, None).BACKEND == "sentence-transformers"


def test_onnx_backend_is_accepted(monkeypatch: pytest.MonkeyPatch) -> None:
    assert _load_app(monkeypatch, "onnx").BACKEND == "onnx"


def test_typo_fails_startup_and_names_every_value(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(RuntimeError) as caught:
        _load_app(monkeypatch, "onx")
    message = str(caught.value)
    for value in ("sentence-transformers", "onnx", "triton"):
        assert value in message


def test_onnx_backend_routes_to_the_in_process_path(monkeypatch: pytest.MonkeyPatch) -> None:
    module = _load_app(monkeypatch, "onnx")
    monkeypatch.setattr(module, "_embed_onnx", lambda texts: [[0.5] * module.EXPECTED_DIM])

    assert module._encode(["한 문장"]) == [[0.5] * module.EXPECTED_DIM]


def test_onnx_warmup_does_not_read_the_torch_model(monkeypatch: pytest.MonkeyPatch) -> None:
    """워밍이 `_load()` 를 부르면 2GB torch 모델을 읽는다 — 안 읽는 것이 이 백엔드의 이유다."""
    module = _load_app(monkeypatch, "onnx")
    calls: list[str] = []
    monkeypatch.setattr(module, "_load", lambda: calls.append("torch"))
    monkeypatch.setattr(module, "_encode", lambda texts: calls.append("encode") or [[0.0]])

    module._warm()
    for thread in __import__("threading").enumerate():
        if thread.name == "embedding-warmup":
            thread.join(timeout=5)

    assert calls == ["encode"]


def test_health_reports_loaded_from_the_onnx_session(monkeypatch: pytest.MonkeyPatch) -> None:
    # `_model` 은 onnx 경로에서 영원히 None 이다 — 그걸 보면 `loaded` 가 늘 false 로
    # 남아 워밍 진행을 보는 유일한 창이 막힌다.
    module = _load_app(monkeypatch, "onnx")
    assert module.health()["loaded"] is False

    monkeypatch.setattr(module, "_session", object())
    assert module.health()["loaded"] is True


def test_triton_backend_still_routes_to_the_container_path(monkeypatch: pytest.MonkeyPatch) -> None:
    # 측정 경로는 살려 둔다 — amd64 재측정 때 다시 쓴다.
    module = _load_app(monkeypatch, "triton")
    monkeypatch.setattr(module, "_embed_triton", lambda texts: [[0.25] * module.EXPECTED_DIM])

    assert module._encode(["한 문장"]) == [[0.25] * module.EXPECTED_DIM]
