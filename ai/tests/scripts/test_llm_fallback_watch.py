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
from types import SimpleNamespace

from trippilot.api.wiring import LoggingTrace
from trippilot.domain.common import TraceId
from trippilot.domain.llm.llm import LlmFeature, ModelTier
from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.gates.base import GateOutcome
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.domain.llm.prompt import PromptRef
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


def _lines(caplog, *llms, feature=LlmFeature.EXPLANATION, cfg=_CFG, trace_prefix="t") -> list[str]:
    """llm 하나당 게이트웨이 호출 1건 — 로그 줄을 돌려준다(caplog 에 쌓인 것 전부)."""
    caplog.set_level(logging.INFO, logger="trippilot.wiring")
    trace = LoggingTrace()
    for i, llm in enumerate(llms):
        GatewayFacade(llm, _Echo(), _Accept(), cfg, trace).call(
            feature, {}, None, TraceId(f"{trace_prefix}{i}"), _NOW, retry_timeout_sec=1.0
        )
    return [r.getMessage() for r in caplog.records]


def test_credit_rejection_alarms_on_first_occurrence(caplog) -> None:
    alarm, report = watch.judge(_lines(caplog, _Raise(_CREDIT)))
    assert alarm and "과금 거절 1" in report and "credit balance" in report


def test_credit_rejection_rescued_by_another_key_still_alarms(caplog) -> None:
    """다음 키가 살리면 FallbackEvent 가 없다 — 그 키가 막힌 건 어댑터의 키 넘김 줄로만 보인다."""
    import anthropic
    import httpx

    from trippilot.llm_gateway.adapters.anthropic_adapter import AnthropicAdapter
    from trippilot.ports.llm_port import LlmRequest

    req = httpx.Request("POST", "https://api.anthropic.com/v1/messages")

    def fail(**_):
        raise anthropic.BadRequestError(_CREDIT, response=httpx.Response(400, request=req), body=None)

    def ok(**_):  # 둘째 키 — 실패 예외 대신 다른 예외로 멈춰 응답 파싱을 건너뛴다
        raise RuntimeError("stop")

    keys = [SimpleNamespace(messages=SimpleNamespace(create=f)) for f in (fail, ok)]
    caplog.set_level(logging.WARNING, logger="trippilot.llm_gateway.adapters.anthropic_adapter")
    request = LlmRequest(model_id="m", prompt="p", prompt_ref=PromptRef(prompt_id="p", version="0", feature="X"),
                         max_tokens=8, timeout_sec=1.0)
    try:
        AnthropicAdapter(keys).invoke(request)  # 첫 순번 = 소진 키
    except RuntimeError:
        pass
    alarm, report = watch.judge([r.getMessage() for r in caplog.records])
    assert alarm and "과금 거절 1" in report and "credit balance" in report


def test_retry_switch_is_not_a_fallback(caplog) -> None:
    """타임아웃 → 재시도 모델 성공은 사용자가 LLM 답을 받았다 — 대체로 세지 않는다."""
    lines = _lines(
        caplog, *[FakeLlm(canned="{}")] * 4, TimeoutForModelsLlm("{}", "m-h"), _Raise("boom")
    )
    alarm, report = watch.judge(lines)
    assert not alarm and "호출 6건 · 성공 5 · 대체 1" in report


def test_local_model_calls_are_not_counted(caplog) -> None:
    """자체 모델(local-*)은 콜드스타트로 정상적으로 실패한다 — 비율에도 표에도 넣지 않는다(alerts.tf 와 같은 규칙).

    FallbackEvent 엔 모델명이 없으므로 같은 trace 의 LlmCallRecord(model_id='local-…')로 잇는다 — 실제 게이트웨이가
    찍은 두 줄을 그대로 먹인다. 전부 자체 모델 실패(MIN_CALLS 건)에 클라우드 성공 1건이면 '호출 1건' 정상이어야 한다.
    """
    local_cfg = C1Config(model_ids=_CFG.model_ids, feature_models={LlmFeature.REMINDER_COPY: "local-x"})
    local = _lines(caplog, *[_Raise("ModelNotReadyException")] * watch.MIN_CALLS,
                   feature=LlmFeature.REMINDER_COPY, cfg=local_cfg, trace_prefix="r")
    assert sum("from_mode='llm_reminder_copy'" in line for line in local) == watch.MIN_CALLS  # 전제: 실제로 대체됐다
    caplog.clear()
    cloud = _lines(caplog, FakeLlm(canned="{}"))
    alarm, report = watch.judge(local + cloud)
    assert not alarm
    assert f"호출 1건 · 성공 1 · 대체 0 (0%) · 과금 거절 0 · 자체 모델 {watch.MIN_CALLS}건 제외" in report
    assert "llm_reminder_copy" not in report


def test_ratio_alarm_needs_enough_calls(caplog) -> None:
    assert watch.judge(_lines(caplog, *[_Raise("boom")] * (watch.MIN_CALLS - 1)))[0] is False
    caplog.clear()
    assert watch.judge(_lines(caplog, *[_Raise("boom")] * watch.MIN_CALLS))[0] is True
