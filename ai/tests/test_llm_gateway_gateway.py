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

from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.gates.base import GateOutcome
from trippilot.llm_gateway.gateway import GatewayFacade, TierRouter
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


class EmptyResultGate:
    """드롭 0건인데 결과가 빈 fake — **LLM 이 애초에 0건을 냈을 때**의 모양이다.

    DropAllGate 와 구분해야 한다. 둘은 처방이 정반대인데(게이트 규칙 문제 vs
    프롬프트·입력 문제) 한때 같은 라벨을 썼다 — 행사 수집에서 대전이 6회 연속
    0건일 때 게이트를 의심하느라 3단계 추론이 필요했다(2026-08-25).
    """

    def apply(self, raw_text, pool, *, feature, trace_id, now):
        return GateOutcome(value=(), drop_event=None, error=None)


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


class _RecordingLlm:
    """FakeLlm 래퍼 — 게이트웨이가 넘긴 LlmRequest 기록 (타임아웃 정합 검증)."""

    def __init__(self) -> None:
        self._inner = FakeLlm()
        self.requests: list = []

    def invoke(self, request):
        self.requests.append(request)
        return self._inner.invoke(request)


def test_call_timeout_default_and_override() -> None:
    """timeout_sec 미지정이면 설정 기본(2.5s — INTENT 등 즉답성 feature 불변),
    지정하면 그 값이 LlmRequest까지 관통한다 (TRIP-376)."""
    llm = _RecordingLlm()
    facade, _ = _facade(llm, AcceptAllGate(_scored("p1")))

    _call(facade)  # override 없음
    facade.call(
        LlmFeature.PREFERENCE_SCORING, {"k": "v"}, None, _TRACE_ID, _NOW,
        timeout_sec=14.0,
    )

    assert [r.timeout_sec for r in llm.requests] == [_CFG.timeout_sec, 14.0]
    assert _CFG.timeout_sec == 2.5


# ── GW-P1: 실패 경로 전부 동일 형태로 수렴 ──────────────────


@pytest.mark.parametrize(
    ("llm", "gate", "reason_prefix"),
    [
        (SlowLlm(), AcceptAllGate(_scored("p1")), "timeout:"),
        (FailingLlm(), AcceptAllGate(_scored("p1")), "llm_error:"),
        (FakeLlm(), ParseFailGate(), "parse_error:"),
        (FakeLlm(), DropAllGate(), "gate_dropped_all"),
        (FakeLlm(), EmptyResultGate(), "llm_empty_result"),
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


def test_무결과와_전량드롭은_다른_사유로_기록된다() -> None:
    """**두 라벨이 다시 뭉개지면 여기서 깨진다.**

    처방이 정반대다 — gate_dropped_all 은 게이트 규칙(또는 LLM 환각)을 보라는
    신호고, llm_empty_result 는 프롬프트·입력 스니펫을 보라는 신호다. 구분이
    없으면 로그만으로는 어느 쪽인지 알 수 없어 매번 코드를 되짚어야 한다.

    판별 근거는 GateDropEvent 의 유무다 — 게이트는 dropped_count 가 0 이면
    이벤트를 만들지 않으므로, 그 부재가 "게이트는 아무것도 안 버렸다"는 증거다.
    """
    dropped_facade, dropped_trace = _facade(FakeLlm(), DropAllGate())
    empty_facade, empty_trace = _facade(FakeLlm(), EmptyResultGate())

    dropped = _call(dropped_facade)
    empty = _call(empty_facade)

    assert dropped.error == "gate_dropped_all"
    assert empty.error == "llm_empty_result"
    assert dropped.error != empty.error, "두 실패는 원인도 처방도 다르다"

    # 라벨의 근거가 실제로 GateDropEvent 유무인지까지 고정한다
    assert len(dropped_trace.of_type(GateDropEvent)) == 1
    assert len(empty_trace.of_type(GateDropEvent)) == 0


# ── TRIP-260 #4: FallbackEvent가 feature별 **실제** 폴백을 싣는다 ──


# 값의 근거는 호출측 코드다 (config.default_fallback_modes 항목별 주석 참조) —
# 여기서는 그 표가 이벤트까지 그대로 도달하는지만 고정한다.
_EXPECTED_MODES = {
    LlmFeature.PREFERENCE_SCORING: ("llm_score", "rule_score"),
    LlmFeature.EXPLANATION: ("llm_explain", "(none)"),
    LlmFeature.ALTERNATIVE_SELECTION: ("llm_select_alternatives", "rule_ranking"),
    LlmFeature.REFLECTION_TEMPLATE: ("llm_template", "fixed_template"),
    LlmFeature.REFLECTION_NUDGE: ("llm_nudge", "fixed_message"),
    LlmFeature.INTENT: ("llm_intent", "out_of_scope"),
    LlmFeature.PARAPHRASE: ("llm_paraphrase", "llm_direct"),
    LlmFeature.EDIT_TRANSLATION: ("llm_edit_translation", "translation_failed"),
    LlmFeature.EVENT_EXTRACTION: ("llm_extract", "(none)"),
    LlmFeature.PLACE_EXTRACTION: ("llm_extract", "(none)"),
    LlmFeature.REASON_INTERPRETATION: ("llm_reason_interpretation", "unknown"),
}


@pytest.mark.parametrize("feature", sorted(_EXPECTED_MODES, key=lambda f: f.value))
def test_fallback_event_carries_feature_specific_modes(feature: LlmFeature) -> None:
    """전 feature가 `llm_score → rule_score`를 찍던 동안 증빙 대부분이 거짓이었다.

    INV-4가 요구하는 것은 "폴백이 이벤트로 드러난다"가 아니라 "그 이벤트가 사실이다".
    """
    facade, trace = _facade(FakeLlm(), ParseFailGate())
    facade.call(feature, {"k": "v"}, None, _TRACE_ID, _NOW)

    events = trace.of_type(FallbackEvent)
    assert len(events) == 1
    assert (events[0].from_mode, events[0].to_mode) == _EXPECTED_MODES[feature]


def test_fallback_modes_are_not_all_the_same() -> None:
    """하드코딩 회귀 방지 — 값이 다시 한 종류로 수렴하면 여기서 깨진다."""
    assert len(set(_EXPECTED_MODES.values())) >= 4


def test_every_llm_feature_has_fallback_modes() -> None:
    """enum이 늘면 여기서 먼저 깨진다 — 새 feature의 폴백 실체를 확인하라는 신호."""
    assert set(_CFG.fallback_modes) == set(LlmFeature)
    assert _EXPECTED_MODES.keys() == set(LlmFeature)


def test_unmapped_feature_falls_back_visibly_not_plausibly() -> None:
    """매핑 누락은 KeyError로 죽지도, 그럴듯한 거짓말을 찍지도 않는다."""
    cfg = C1Config(model_ids=dict(_CFG.model_ids), fallback_modes={})
    trace = InMemoryTrace()
    facade = GatewayFacade(FakeLlm(), EchoRenderer(), ParseFailGate(), cfg, trace)

    facade.call(LlmFeature.PREFERENCE_SCORING, {"k": "v"}, None, _TRACE_ID, _NOW)

    assert trace.of_type(FallbackEvent)[0].to_mode == "unmapped_feature"
