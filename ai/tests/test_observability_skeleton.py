"""U1 — LLMOps 관측 + INV-4 절편 PBT.

증명하는 것:
  ① 직렬화 왕복 (U5-P10): 관측 이벤트 5종 모두 왕복 동일
  ② TypedResult 불변식   : is_fallback=True면 value는 None (INV-4)
  ③ INV-4 핵심          : LLM 실패 시 FallbackEvent가 발행된다 (침묵 실패 금지)
  ④ NFR-7.1            : 성공 호출도 LlmCallRecord로 계측된다
  ⑤ emit 안전          : TracePort.emit은 예외를 밖으로 던지지 않는다

※ 아래 _call_with_fallback은 U4 GatewayFacade의 축소 대역(stand-in) —
   U1 단계에서 부품들(FailingLlm·TracePort·FallbackEvent·InMemoryTrace)이
   의도한 INV-4 동작으로 조립되는지 증명한다.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from hypothesis import given

from trippilot.domain.llm import TypedResult
from trippilot.domain.observability import FallbackEvent, LlmCallRecord
from trippilot.domain.prompt import PromptRef
from trippilot.ports.llm_port import LlmPort, LlmRequest

from tests.fakes.fake_llm import FailingLlm, FakeLlm, SlowLlm
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.generators.observability import trace_events

_NOW = datetime(2026, 7, 21, 12, 0, tzinfo=timezone.utc)
_REQ = LlmRequest(
    model_id="claude-haiku-4-5",
    prompt="강릉 카페 3곳 점수 매겨줘",
    prompt_ref=PromptRef("prompts/score.yaml", "1.0.0", "score_preferences"),
    max_tokens=256,
    temperature=0.0,
)


def _call_with_fallback(
    llm: LlmPort, trace: InMemoryTrace, req: LlmRequest
) -> TypedResult[str]:
    """U4 GatewayFacade 축소 대역. 실패/타임아웃이면 폴백 + FallbackEvent 발행."""
    try:
        resp = llm.invoke(req)
        record = LlmCallRecord(
            trace_id=None,  # type: ignore[arg-type]  # 축소 대역 — 실제론 TraceId 전파
            occurred_at=_NOW,
            component="c1_gateway",
            feature=req.prompt_ref.feature,
            model_id=resp.model_id,
            prompt_ref=req.prompt_ref,
            input_tokens=resp.input_tokens,
            output_tokens=resp.output_tokens,
            latency_ms=resp.latency_ms,
            success=True,
            agent=None,
        )
        trace.emit(record)  # NFR-7.1: 성공도 계측
        return TypedResult(
            value=resp.raw_text, is_fallback=False, error=None, call_record=record
        )
    except Exception as e:  # noqa: BLE001 — 폴백은 모든 실패를 흡수 (침묵 실패 금지)
        trace.emit(
            FallbackEvent(
                trace_id=None,  # type: ignore[arg-type]
                occurred_at=_NOW,
                component="c1_gateway",
                stage="llm",
                from_mode="llm",
                to_mode="rule",
                reason=str(e),
            )
        )
        return TypedResult(value=None, is_fallback=True, error=str(e), call_record=None)


# ① 관측 이벤트 직렬화 왕복 (5종)
@given(ev=trace_events())
def test_trace_event_serialization_roundtrip(ev) -> None:
    assert ev.__class__.from_dict(ev.to_dict()) == ev


# ② TypedResult 불변식
def test_typed_result_fallback_forbids_value() -> None:
    TypedResult(value="ok", is_fallback=False, error=None, call_record=None)  # 정상
    TypedResult(value=None, is_fallback=True, error="x", call_record=None)  # 정상
    with pytest.raises(ValueError):
        TypedResult(value="leak", is_fallback=True, error=None, call_record=None)


# ③ INV-4 핵심 — LLM 실패/타임아웃 → FallbackEvent 발행
@pytest.mark.parametrize("broken", [FailingLlm(), SlowLlm()])
def test_llm_failure_emits_fallback_event(broken: LlmPort) -> None:
    trace = InMemoryTrace()
    result = _call_with_fallback(broken, trace, _REQ)

    assert result.is_fallback is True
    assert result.value is None
    fallbacks = trace.of_type(FallbackEvent)
    assert len(fallbacks) == 1  # 침묵 실패 금지 — 폴백이 관측됨
    assert fallbacks[0].stage == "llm"


# ④ NFR-7.1 — 성공 호출도 계측
def test_success_call_is_instrumented() -> None:
    trace = InMemoryTrace()
    result = _call_with_fallback(FakeLlm(), trace, _REQ)

    assert result.is_fallback is False
    assert result.value is not None
    assert trace.of_type(FallbackEvent) == []  # 폴백 없음
    records = trace.of_type(LlmCallRecord)
    assert len(records) == 1 and records[0].success is True
    # 토큰 메타가 계측으로 이어짐 (구조적으로 가능)
    assert records[0].input_tokens == len(_REQ.prompt)


# ⑤ emit 안전 — 예외를 밖으로 던지지 않음
def test_trace_emit_never_raises() -> None:
    trace = InMemoryTrace()
    trace.emit(None)  # type: ignore[arg-type]  # 이상한 값도 조용히 흡수
    assert True  # 여기 도달 = 예외 전파 없음
