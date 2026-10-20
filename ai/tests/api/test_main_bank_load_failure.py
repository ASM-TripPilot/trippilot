"""질문뱅크·미리 계산한 뱅크 벡터를 못 읽어도 기동은 이어진다 — 실패 경로가 정의 안 된 `log` 로 NameError 를 내 기동을 죽이던 것.

`main._bank_vectors`·`_intent_bank` 의 except 는 "기동을 막지 않는다"였는데 모듈 전역 `log` 가 없어 실패하는 순간 NameError 였다.
"""

from __future__ import annotations

import main
import trippilot.orchestrator.question_bank as question_bank


def _boom(*_args, **_kwargs):
    raise ValueError("깨진 파일")


def test_bank_vectors_failure_falls_back_to_remote_index_with_a_warning(monkeypatch, caplog) -> None:
    monkeypatch.setattr(question_bank, "load_bank_vectors", _boom)
    with caplog.at_level("WARNING", logger="trippilot.main"):
        assert main._bank_vectors() is None
    assert "미리 계산한 질문뱅크 벡터 로드 실패 ValueError" in caplog.text


def test_intent_bank_failure_starts_with_an_empty_bank_and_a_warning(monkeypatch, caplog) -> None:
    monkeypatch.setattr(question_bank, "load_bank_file", _boom)
    with caplog.at_level("WARNING", logger="trippilot.main"):
        assert main._intent_bank() == ()
    assert "질문뱅크 로드 실패 ValueError" in caplog.text
