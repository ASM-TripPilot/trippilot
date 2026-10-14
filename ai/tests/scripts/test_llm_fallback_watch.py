"""dev LLM 대체 감시 판정기 (ai-llm-fallback-watch.yml).

로그 줄은 손으로 흉내 내지 않는다 — 실제 게이트웨이가 `LoggingTrace` 로 찍은 줄을
판정기에 먹인다. 이벤트 repr·로그 형식이 바뀌면 감시가 조용히 0건을 세게 되는데,
그때 여기서 깨진다.
"""

from __future__ import annotations

import importlib.util
import logging
from datetime import datetime, timezone
from pathlib import Path

from trippilot.api.wiring import LoggingTrace
from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature, ModelTier
from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.gates.base import GateOutcome
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.domain.prompt import PromptRef
from tests.fakes.fake_llm import FakeLlm, TimeoutForModelsLlm

_spec = importlib.util.spec_from_file_location(
    "llm_fallback_watch",
    Path(__file__).resolve().parents[2] / "scripts" / "mlops" / "llm_fallback_watch.py",
)
watch = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(watch)

_NOW = datetime(2026, 10, 13, 9, 0, tzinfo=timezone.utc)
_CFG = C1Config(
    model_ids={ModelTier.LIGHT: "m-l", ModelTier.HEAVY: "m-h"},
    retry_models={LlmFeature.EXPLANATION: "m-retry"},
)
# Anthropic 이 크레딧 소진 키에 돌려주는 400 의 SDK 예외 문자열 모양.
_CREDIT = (
    "Error code: 400 - {'type': 'error', 'error': {'type': 'invalid_request_error', "
    "'message': 'Your credit balance is too low to access the Anthropic API. "
    "Please go to Plans & Billing to upgrade or purchase credits.'}}"
)


class _Echo:
    def render(self, feature, variables):
        return "p", PromptRef(prompt_id="prompts/t.yaml", version="0", feature=feature.value)


class _Accept:
    def apply(self, raw_text, pool, *, feature, trace_id, now):
        return GateOutcome(value=(), drop_event=None, error=None)


class _Raise:
    def __init__(self, message: str) -> None:
        self._message = message

    def invoke(self, request):
        raise RuntimeError(self._message)


def _lines(caplog, *llms) -> list[str]:
    """llm 하나당 게이트웨이 호출 1건 — 로그 줄을 돌려준다."""
    caplog.set_level(logging.INFO, logger="trippilot.wiring")
    trace = LoggingTrace()
    for i, llm in enumerate(llms):
        GatewayFacade(llm, _Echo(), _Accept(), _CFG, trace).call(
            LlmFeature.EXPLANATION, {}, None, TraceId(f"t{i}"), _NOW, retry_timeout_sec=1.0
        )
    return [r.getMessage() for r in caplog.records]


def test_credit_rejection_alarms_on_first_occurrence(caplog) -> None:
    alarm, report = watch.judge(_lines(caplog, _Raise(_CREDIT)))
    assert alarm and "과금 거절 1" in report and "credit balance" in report


def test_retry_switch_is_not_a_fallback(caplog) -> None:
    """타임아웃 → 재시도 모델 성공은 사용자가 LLM 답을 받았다 — 대체로 세지 않는다."""
    lines = _lines(
        caplog, *[FakeLlm(canned="{}")] * 4, TimeoutForModelsLlm("{}", "m-h"), _Raise("boom")
    )
    alarm, report = watch.judge(lines)
    assert not alarm and "호출 6건 · 성공 5 · 대체 1" in report


def test_ratio_alarm_needs_enough_calls(caplog) -> None:
    assert watch.judge(_lines(caplog, *[_Raise("boom")] * (watch.MIN_CALLS - 1)))[0] is False
    caplog.clear()
    assert watch.judge(_lines(caplog, *[_Raise("boom")] * watch.MIN_CALLS))[0] is True
