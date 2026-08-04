"""U4-01 — GatewayFacade 단발 호출 파이프라인 (call→gate→result).

GW-P1: 타임아웃·예외·파싱실패·전량드롭 → is_fallback=True ∧ value=None
       ∧ FallbackEvent 1건 ∧ record.success=False (BR-U4-02·03)
GW-P2: 성공 경로 call_record의 (feature, model_id, prompt_ref, 토큰) 정합
BR-U4-05: LlmFeature 밖 호출 = ValueError (폴백 아님)
게이트 본체(파서·풀 교차)는 U4-02 — 여기서는 seam(ExitGate)을 fake로 검증.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from trippilot.c1.config import C1Config
from trippilot.c1.gate import GateOutcome
from trippilot.c1.gateway import GatewayFacade, TierRouter
from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.llm import LlmFeature, ModelTier, ScoredPoi
from trippilot.domain.observability import FallbackEvent, GateDropEvent, LlmCallRecord
from trippilot.domain.prompt import PromptRef
from tests.fakes.fake_llm import FailingLlm, FakeLlm, SlowLlm
from tests.fakes.in_memory_trace import InMemoryTrace

_NOW = datetime(2026, 8, 3, 12, 0, tzinfo=timezone.utc)
_TRACE_ID = TraceId("t-u4")
_CFG = C1Config(
    model_ids={ModelTier.LIGHT: "model-light-test", ModelTier.HEAVY: "model-heavy-test"}
)


class EchoRenderer:
    """결정론 렌더 fake — PromptRegistry(U4-05) 자리."""

    def render(self, feature, variables):
        prompt = f"{feature.value}|{sorted(variables.items())}"
        ref = PromptRef(
            prompt_id="prompts/test.yaml", version="0.0.1", feature=feature.value
        )
        return prompt, ref


def _scored(*ids: str) -> tuple[ScoredPoi, ...]:
    return tuple(ScoredPoi(poi_id=PoiId(i), score=0.5, is_llm_score=True) for i in ids)


class AcceptAllGate:
    """검증 통과 fake — 고정 scored 반환."""

    def __init__(self, scored: tuple[ScoredPoi, ...]) -> None:
        self._value = scored

    def apply(self, raw_text, pool, *, feature, trace_id, now):
        return GateOutcome(value=self._value, drop_event=None, error=None)


class DropAllGate:
    """전량 드롭 fake (GATE-P2의 폴백 분기)."""

    def apply(self, raw_text, pool, *, feature, trace_id, now):
        dropped = (PoiId("hallucinated-1"),)
        return GateOutcome(
            value=(),
            drop_event=GateDropEvent(
                trace_id=trace_id,
                occurred_at=now,
                component="c1.gate",
                feature=feature.value,
                dropped_ids=dropped,
                total_count=1,
                dropped_count=1,
            ),
            error=None,
        )


class ParseFailGate:
    """스키마 파싱 실패 fake (5단 실패 = 폴백 경로)."""

    def apply(self, raw_text, pool, *, feature, trace_id, now):
        return GateOutcome(value=(), drop_event=None, error="parse_error: not json")


def _facade(llm, gate) -> tuple[GatewayFacade, InMemoryTrace]:
    trace = InMemoryTrace()
    return GatewayFacade(llm, EchoRenderer(), gate, _CFG, trace), trace


def _call(facade):
    return facade.call(
        LlmFeature.PREFERENCE_SCORING, {"k": "v"}, None, _TRACE_ID, _NOW
    )


# ── GW-P2: 성공 경로 계측 정합 ──────────────────────────────


def test_success_path_returns_value_and_consistent_record() -> None:
    facade, trace = _facade(FakeLlm(), AcceptAllGate(_scored("p1", "p2")))
    result = _call(facade)

    assert result.is_fallback is False and result.error is None
    assert result.value == _scored("p1", "p2")
    rec = result.call_record
    assert rec is not None and rec.success is True
    assert rec.feature == "PREFERENCE_SCORING"
    assert rec.model_id == "model-light-test"  # LIGHT 티어 설정값 (BR-U4-08)
    assert rec.prompt_ref.version == "0.0.1"
    assert rec.input_tokens > 0 and rec.output_tokens > 0  # FakeLlm 합성 토큰
    assert trace.of_type(LlmCallRecord) == [rec]  # 계측 의무 (BR-U4-03)
    assert trace.of_type(FallbackEvent) == []


# ── GW-P1: 실패 경로 전부 동일 형태로 수렴 ──────────────────


@pytest.mark.parametrize(
    ("llm", "gate", "reason_prefix"),
    [
        (SlowLlm(), AcceptAllGate(_scored("p1")), "timeout:"),
        (FailingLlm(), AcceptAllGate(_scored("p1")), "llm_error:"),
        (FakeLlm(), ParseFailGate(), "parse_error:"),
        (FakeLlm(), DropAllGate(), "gate_dropped_all"),
    ],
)
def test_failure_paths_converge_to_fallback(llm, gate, reason_prefix) -> None:
    facade, trace = _facade(llm, gate)
    result = _call(facade)

    assert result.is_fallback is True and result.value is None
    assert result.error is not None and result.error.startswith(reason_prefix)
    assert result.call_record is not None and result.call_record.success is False
    fallbacks = trace.of_type(FallbackEvent)
    assert len(fallbacks) == 1 and fallbacks[0].reason == result.error
    assert fallbacks[0].to_mode == "rule_score"  # 실행은 호출측 (BR-U4-09)
    assert len(trace.of_type(LlmCallRecord)) == 1  # 실패도 계측 (BR-U4-03)


def test_drop_all_emits_gate_drop_event() -> None:
    facade, trace = _facade(FakeLlm(), DropAllGate())
    _call(facade)
    drops = trace.of_type(GateDropEvent)
    assert len(drops) == 1 and drops[0].dropped_count == 1


# ── BR-U4-05: 기능 목록도 closed-set ─────────────────────────


def test_non_feature_call_is_a_bug_not_fallback() -> None:
    facade, trace = _facade(FakeLlm(), AcceptAllGate(_scored("p1")))
    with pytest.raises(ValueError):
        facade.call("free_text_feature", {}, None, _TRACE_ID, _NOW)  # type: ignore[arg-type]
    assert trace.events == []  # 폴백 신호 없음 — 호출 자체가 버그


# ── 라우팅: 설정 버그는 ValueError (폴백 아님) ───────────────


def test_router_missing_model_id_raises() -> None:
    cfg = C1Config(model_ids={ModelTier.LIGHT: "only-light"})
    with pytest.raises(ValueError):
        TierRouter(cfg).route(LlmFeature.EXPLANATION)  # HEAVY 미설정


def test_router_resolves_all_default_features_deterministically() -> None:
    router = TierRouter(_CFG)
    for feature in LlmFeature:  # ROUTE-P1: 전 feature 스윕 + 결정론
        first = router.route(feature)
        assert first in _CFG.model_ids.values()
        assert router.route(feature) == first
