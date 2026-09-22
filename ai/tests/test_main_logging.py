"""TRIP-914 — `trippilot.*` 로그가 실제로 나온다 (운영 기동 경로).

배경: uvicorn 기본 설정은 `uvicorn*` 로거만 구성하고 루트엔 핸들러가 없다. 그래서 우리
로거의 INFO 는 통째로 버려지고 WARNING 만 `logging.lastResort` 로 (레벨·시각·로거 이름
없이) 새어 나갔다 — 프리필터 절단 관측(TRIP-908)의 분모와 요청 로그가 그렇게 안 보였다.

증명하는 것:
  ① INFO 가 실제로 **출력된다** (핸들러 스트림에 로거 이름·레벨과 함께)
  ② 레벨은 `TRIPPILOT_LOG_LEVEL` — 기본 INFO, 값이 있으면 그 값
  ③ 미지원 값은 **기동 실패** (조용한 기본값 금지 — "켰다고 믿는데 안 나온다"가 최악)
  ④ 멱등 — 여러 번 불러도 핸들러는 하나 (같은 줄이 두 번 나가지 않는다)
  ⑤ **전파를 끊지 않는다** — 끊으면 `caplog` 가 우리 로그를 못 잡아 남의 테스트가
     import 순서에 따라 깨진다(운영에선 루트에 핸들러가 없어 중복도 없다)
  ⑥ 기동 경로(`build_app_from_env`)가 이것을 부른다 — 부르지 않으면 전부 무의미하다
"""

from __future__ import annotations

import io
import logging
import sys

import pytest

import main

_LOGGER = "trippilot"


@pytest.fixture(autouse=True)
def _restore_logger():
    """전역 로거를 만지는 테스트 — 원상복구 (다른 테스트의 caplog 를 깨지 않는다)."""
    logger = logging.getLogger(_LOGGER)
    before = (list(logger.handlers), logger.level, logger.propagate)
    yield
    logger.handlers, logger.level, logger.propagate = (
        before[0], before[1], before[2])


def _reset() -> logging.Logger:
    logger = logging.getLogger(_LOGGER)
    logger.handlers = [h for h in logger.handlers
                       if getattr(h, "name", None) != main._LOG_HANDLER_NAME]
    return logger


def _ours(logger: logging.Logger) -> list[logging.Handler]:
    return [h for h in logger.handlers
            if getattr(h, "name", None) == main._LOG_HANDLER_NAME]


# ── ① 실제로 출력된다 ───────────────────────────────────────────────


def test_info_actually_reaches_the_stream(monkeypatch) -> None:
    monkeypatch.delenv("TRIPPILOT_LOG_LEVEL", raising=False)
    logger = _reset()

    main.configure_logging()
    (handler,) = _ours(logger)
    assert handler.stream is sys.stdout     # 갈아끼우기 **전에** 출력처를 고정한다
    handler.stream = io.StringIO()          # 그다음 받아 본다
    logging.getLogger("trippilot.exists").info("절단 %d건", 3)

    line = handler.stream.getvalue()
    assert "INFO" in line and "trippilot.exists" in line and "절단 3건" in line


# ── ②·③ 레벨 ────────────────────────────────────────────────────────


def test_level_defaults_to_info(monkeypatch) -> None:
    monkeypatch.delenv("TRIPPILOT_LOG_LEVEL", raising=False)
    logger = _reset()

    main.configure_logging()

    assert logger.level == logging.INFO and _ours(logger)[0].level == logging.INFO


@pytest.mark.parametrize("value,expected",
                         [("DEBUG", logging.DEBUG), ("warning", logging.WARNING),
                          (" ERROR ", logging.ERROR),
                          # logging 정식 별칭 — 운영자가 흔히 친다
                          ("WARN", logging.WARNING), ("fatal", logging.CRITICAL)])
def test_level_comes_from_env(monkeypatch, value, expected) -> None:
    monkeypatch.setenv("TRIPPILOT_LOG_LEVEL", value)
    logger = _reset()

    main.configure_logging()

    assert logger.level == expected and _ours(logger)[0].level == expected


@pytest.mark.parametrize("bad", ["TRACE", "9", "verbose"])
def test_unsupported_level_fails_startup(monkeypatch, bad) -> None:
    """조용한 기본값 금지 — 오타가 "설정했는데 왜 안 나오지"로 남으면 안 된다.

    메시지에 **원문 그대로** 실린다: 대문자로 접어 찍으면 운영자가 자기가 넣은 값을 못 찾는다.
    """
    monkeypatch.setenv("TRIPPILOT_LOG_LEVEL", bad)
    logger = _reset()
    before = logger.level

    with pytest.raises(RuntimeError, match=f"TRIPPILOT_LOG_LEVEL.*{bad!r}"):
        main.configure_logging()

    assert logger.level == before and not _ours(logger)   # 실패는 전역 상태를 안 바꾼다


def test_empty_env_is_unset_not_error(monkeypatch) -> None:
    """compose·CI 가 비운 값은 ''·공백으로 온다 (TRIP-882 계열) — 기본값으로 간다."""
    monkeypatch.setenv("TRIPPILOT_LOG_LEVEL", "   ")
    logger = _reset()

    main.configure_logging()

    assert logger.level == logging.INFO


# ── ④ 멱등 ──────────────────────────────────────────────────────────


def test_repeated_calls_keep_one_handler(monkeypatch) -> None:
    monkeypatch.setenv("TRIPPILOT_LOG_LEVEL", "INFO")
    logger = _reset()

    main.configure_logging()
    monkeypatch.setenv("TRIPPILOT_LOG_LEVEL", "DEBUG")
    main.configure_logging()

    assert len(_ours(logger)) == 1                      # 같은 줄이 두 번 나가지 않는다
    assert logger.level == logging.DEBUG and _ours(logger)[0].level == logging.DEBUG


# ── ⑤ 전파 유지 (caplog 보호) ───────────────────────────────────────


def test_propagation_is_kept_so_caplog_still_sees_us(caplog) -> None:
    logger = _reset()

    main.configure_logging()
    _ours(logger)[0].stream = io.StringIO()
    with caplog.at_level(logging.INFO, logger="trippilot.exists"):
        logging.getLogger("trippilot.exists").info("보인다")

    assert logger.propagate is True
    assert [r.getMessage() for r in caplog.records] == ["보인다"]


# ── ⑥ 기동 경로가 부른다 ────────────────────────────────────────────


def test_build_app_from_env_configures_logging(monkeypatch) -> None:
    monkeypatch.setenv("TRIPPILOT_WIRING", "unwired")   # 조립은 이 테스트의 관심이 아니다
    monkeypatch.setenv("TRIPPILOT_LOG_LEVEL", "WARNING")
    logger = _reset()

    main.build_app_from_env()

    assert _ours(logger) and logger.level == logging.WARNING
