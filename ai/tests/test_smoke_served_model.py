"""서빙 모델 동일성 단언 — A/B 의 한쪽이 몰래 다른 모델이면 측정이 통째로 무효다.

두 가지가 조용히 어긋난다.

1. **서버가 다른 이름을 서빙한다.** 요청의 `model=` 문자열은 vLLM `--served-model-name`
   (또는 Triton 모델 레포지토리 디렉토리명)과 **정확히** 같아야 한다. 어긋나면 404 가
   아니라 서버 구현에 따라 그냥 다른 모델이 답할 수 있다.
2. **앱이 로컬 라우트를 안 켠다.** `main.py::_local_route` 는 배정 모델명이 `local` 로
   시작할 때만 라우트를 만든다 — 아니면 예외 없이 외부 벤더로 나간다. 파인튜닝 모델이
   안 붙은 채 "정상"으로 보이는 형태다.

그래서 스모크는 답을 받기 전에 **누가 답할 것인지** 먼저 확인한다.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from smoke_reminder_copy import ServedModelMismatch, assert_served_model  # noqa: E402


class _Models:
    def __init__(self, ids: list[str]) -> None:
        self._ids = ids

    def list(self):
        return type("Page", (), {"data": [type("M", (), {"id": i})() for i in self._ids]})()


class _Client:
    def __init__(self, ids: list[str]) -> None:
        self.models = _Models(ids)


def test_exact_match_passes() -> None:
    assert_served_model(_Client(["local-reminder-qwen3-4b-v1"]), "local-reminder-qwen3-4b-v1")


def test_different_served_name_is_refused() -> None:
    # 병합 전 베이스를 그 이름으로 띄워도 "그럴듯한 답"이 나온다 — 이름부터 막는다.
    with pytest.raises(ServedModelMismatch) as caught:
        assert_served_model(_Client(["Qwen/Qwen3-4B-Instruct-2507"]), "local-reminder-qwen3-4b-v1")
    assert "local-reminder-qwen3-4b-v1" in str(caught.value)


def test_name_without_local_prefix_is_refused_before_any_call() -> None:
    # 접두어가 없으면 앱은 로컬 라우트를 아예 안 만든다(main.py::_local_route).
    # 스모크만 우연히 통과하고 실제 경로는 외부 벤더로 나가는 상태를 막는다.
    with pytest.raises(ServedModelMismatch, match="local"):
        assert_served_model(_Client(["reminder-qwen3-4b-v1"]), "reminder-qwen3-4b-v1")


def test_server_that_cannot_list_models_is_refused_not_ignored() -> None:
    # 조회가 막힌 것을 "해당 없음"으로 읽지 않는다(anti-patterns: 도구 거부를 부재로 읽기).
    class _Broken:
        class models:
            @staticmethod
            def list():
                raise RuntimeError("연결 거부")

    with pytest.raises(ServedModelMismatch, match="확인할 수 없다"):
        assert_served_model(_Broken(), "local-reminder-qwen3-4b-v1")
