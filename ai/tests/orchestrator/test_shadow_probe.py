"""섀도 프로브 — 기존 3단 IntentRouter 를 응답 경로 밖에서 재는 장치 (assistant-orchestrator FD BLM §9 · DE §2.7·§5).

결정론 장치: 실행기(Executor)를 주입한다 — `_InlineExecutor` 는 submit 즉시 같은 스레드에서 돌리고,
`_DeferredExecutor` 는 받아만 두어 in-flight 포화를 재현한다. rng·clock·logger 도 전부 주입이라
스레드 타이밍에 기대는 단언이 없다(기본 풀 경로 1건만 짧게 기다린다).

보는 것: ① rate 0/1 과 시드 결정론(AO-P16) ② 포화 skip 과 자리 반납 ③ 로그 1줄의 키 집합·순서와
**발화 원문·slots·account_ref 부재**(AO-P9, SEC-U8-06) ④ `TaggedTrace` 가 component 만 바꿔 위임
⑤ `ShadowCountingLlm` 인스턴스 계수 ⑥ 실물 IntentRouter + 실물 게이트웨이 왕복에서 호출 수·trace 접미.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import logging
import random
import threading
import time
from concurrent.futures import Executor, Future
from datetime import datetime, timezone
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from tests.fakes.fake_embedding import FakeEmbedding
from tests.fakes.fake_llm import FailingLlm, FakeLlm
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.fakes.in_memory_vector_store import InMemoryVectorStore
from trippilot.domain.common import TraceId
from trippilot.domain.intent import Intent, IntentMatch, MatchRoute
from trippilot.domain.llm import ModelTier
from trippilot.domain.observability import FallbackEvent, GateDropEvent, LlmCallRecord
from trippilot.domain.prompt import PromptRef
from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.gates.intent import IntentGate
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.orchestrator.intent_eval import is_refusal
from trippilot.orchestrator.intent_router import IntentRouter, normalize
from trippilot.orchestrator.shadow_probe import (
    ShadowCountingLlm,
    ShadowIntentProbe,
    ShadowRecord,
    ShadowSide,
    TaggedTrace,
)
from trippilot.ports.llm_port import LlmRequest

_NOW = datetime(2026, 10, 18, 9, 0, tzinfo=timezone.utc)
_CFG = C1Config(model_ids={ModelTier.LIGHT: "m-l", ModelTier.HEAVY: "m-h"})
_PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts"
_REF = PromptRef("prompts/intent.yaml", "0.2.0", "INTENT")
_META = {
    "bank_sha": "f1104f0b83d0", "t_high": 0.82, "t_mid": 0.75, "vote_ratio": 0.8, "intent_margin": 0.02,
    "intent_prompt": "prompts/dialogue_intent.yaml@0.1.0", "shadow_prompt": "prompts/intent.yaml@0.2.0",
}
_FORBIDDEN_KEYS = {"utterance", "slots", "account_ref"}


def _m(intent: Intent, route: MatchRoute, conf: float = 0.9, *, slots: dict | None = None,
       reason: str | None = None) -> IntentMatch:
    return IntentMatch(intent=intent, slots=slots or {}, confidence=conf, match_route=route, reason=reason)


_SERVICE = _m(Intent.GET_WEATHER, MatchRoute.LLM_DIRECT, 0.82)
_SHADOW_AGREE = _m(Intent.GET_WEATHER, MatchRoute.CONFIDENT, 0.91)
_REFUSED = _m(Intent.OUT_OF_SCOPE, MatchRoute.FALLBACK, 0.0,
              reason="below_t_mid(0.55) → intent_fallback: parse_error: not_classifiable: 의도 분류 불가")


# ── 더블 ────────────────────────────────────────────────────────────────


class _InlineExecutor(Executor):
    """submit 즉시 같은 스레드에서 실행 — 로그가 submit 반환 전에 남는다."""

    def submit(self, fn, /, *args, **kwargs):
        fut: Future = Future()
        try:
            fut.set_result(fn(*args, **kwargs))
        except BaseException as e:  # noqa: BLE001 — Future 계약대로 실어 둔다
            fut.set_exception(e)
        return fut


class _DeferredExecutor(Executor):
    """받아만 두고 `run_all()` 때 실행 — in-flight 가 차 있는 상태를 재현한다."""

    def __init__(self) -> None:
        self.queued: list = []

    def submit(self, fn, /, *args, **kwargs):
        self.queued.append((fn, args, kwargs))
        return Future()

    def run_all(self) -> None:
        for fn, args, kwargs in self.queued:
            fn(*args, **kwargs)
        self.queued.clear()


class _ClosedExecutor(Executor):
    def submit(self, fn, /, *args, **kwargs):
        raise RuntimeError("cannot schedule new futures after shutdown")


class _StubRouter:
    def __init__(self, match: IntentMatch) -> None:
        self._match = match
        self.calls: list[tuple] = []

    def route(self, utterance: str, trace_id: TraceId, now: datetime) -> IntentMatch:
        self.calls.append((utterance, trace_id, now))
        return self._match


class _BoomRouter:
    def route(self, utterance: str, trace_id: TraceId, now: datetime) -> IntentMatch:
        raise RuntimeError("boom")


def _logger() -> tuple[logging.Logger, list[logging.LogRecord]]:
    """등록되지 않은 독립 로거 — Hypothesis 예제마다 새로 만들어도 서로 섞이지 않는다."""
    records: list[logging.LogRecord] = []

    class _Collect(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            records.append(record)

    log = logging.Logger("shadow-test")
    log.setLevel(logging.INFO)
    log.addHandler(_Collect())
    return log, records


def _payloads(records: list[logging.LogRecord], prefix: str) -> list[dict]:
    """`<prefix> {json}` 줄만 골라 JSON 으로 — 선례(`replan_reason`)와 같은 `sed 's/.*prefix //' | jq` 모양."""
    out = []
    for r in records:
        msg = r.getMessage()
        if msg.startswith(prefix):
            out.append(json.loads(msg[len(prefix):]))
    return out


def _ticks(*values: float):
    it = iter(values)
    return lambda: next(it)


def _probe(router, *, rate: float = 1.0, pool: Executor | None = None, max_inflight: int = 4,
           seed: int = 1, counting: ShadowCountingLlm | None = None, clock=None):
    log, records = _logger()
    probe = ShadowIntentProbe(
        router, rate=rate, pool=pool if pool is not None else _InlineExecutor(),
        max_inflight=max_inflight, rng=random.Random(seed),
        clock=clock if clock is not None else _ticks(*([10.0, 10.038] * 64)),
        logger=log, counting=counting,
    )
    return probe, records


def _submit(probe: ShadowIntentProbe, utterance: str = "내일 비 와?", trace_id: str = "t-1", *,
            service: IntentMatch = _SERVICE, turn_index: int = 3, meta=_META) -> bool:
    return probe.submit(utterance, TraceId(trace_id), _NOW, service=service, service_ms=1650,
                        service_llm_calls=1, turn_index=turn_index, meta=meta)


def _all_keys(d: object) -> set[str]:
    keys: set[str] = set()
    if isinstance(d, dict):
        for k, v in d.items():
            keys.add(k)
            keys |= _all_keys(v)
    return keys


# ── 샘플링·포화 (AO-P16) ─────────────────────────────────────────────────


def test_rate_zero_never_routes_and_logs_sampled_out() -> None:
    router = _StubRouter(_SHADOW_AGREE)
    probe, records = _probe(router, rate=0.0)

    assert _submit(probe) is False
    assert router.calls == []
    assert _payloads(records, "intent_shadow_skipped ") == [
        {"event": "intent_shadow_skipped", "trace_id": "t-1", "why": "sampled_out"},
    ]
    assert _payloads(records, "intent_shadow ") == []


def test_rate_one_routes_every_turn() -> None:
    router = _StubRouter(_SHADOW_AGREE)
    probe, records = _probe(router, rate=1.0)

    assert [_submit(probe, trace_id=f"t-{i}") for i in range(5)] == [True] * 5
    assert len(router.calls) == 5
    assert len(_payloads(records, "intent_shadow ")) == 5
    assert _payloads(records, "intent_shadow_skipped ") == []


@settings(max_examples=40, deadline=None)
@given(seed=st.integers(0, 2**32 - 1), rate=st.floats(0.0, 1.0))
def test_sampling_is_deterministic_in_the_injected_rng(seed: int, rate: float) -> None:
    picks = []
    for _ in range(2):
        probe, _records = _probe(_StubRouter(_SHADOW_AGREE), rate=rate, seed=seed)
        picks.append([_submit(probe, trace_id=f"t-{i}") for i in range(6)])
    rng = random.Random(seed)
    expected = [rng.random() < rate for _ in range(6)]
    assert picks[0] == picks[1] == expected


def test_saturated_when_inflight_limit_is_reached_then_recovers() -> None:
    pool = _DeferredExecutor()
    probe, records = _probe(_StubRouter(_SHADOW_AGREE), pool=pool, max_inflight=2)

    assert [_submit(probe, trace_id=f"t-{i}") for i in range(3)] == [True, True, False]
    assert _payloads(records, "intent_shadow_skipped ") == [
        {"event": "intent_shadow_skipped", "trace_id": "t-2", "why": "saturated"},
    ]

    pool.run_all()  # 두 건이 끝나면 자리가 난다
    assert len(_payloads(records, "intent_shadow ")) == 2
    assert _submit(probe, trace_id="t-3") is True


def test_pool_refusing_work_returns_false_logs_error_and_releases_the_slot() -> None:
    probe, records = _probe(_StubRouter(_SHADOW_AGREE), pool=_ClosedExecutor(), max_inflight=1)

    assert _submit(probe, trace_id="t-1") is False
    assert _submit(probe, trace_id="t-2") is False  # 자리가 반납됐으니 saturated 가 아니라 다시 error
    errors = _payloads(records, "intent_shadow_error ")
    assert [e["trace_id"] for e in errors] == ["t-1", "t-2"]
    assert all("RuntimeError" in e["error"] for e in errors)
    assert _payloads(records, "intent_shadow_skipped ") == []


def test_probe_rejects_rate_outside_unit_interval_and_zero_inflight() -> None:
    with pytest.raises(ValueError):
        ShadowIntentProbe(_StubRouter(_SHADOW_AGREE), rate=1.5, rng=random.Random(1))
    with pytest.raises(ValueError):
        ShadowIntentProbe(_StubRouter(_SHADOW_AGREE), rate=0.5, max_inflight=0, rng=random.Random(1))


# ── 로그 1줄 (DE §5) ─────────────────────────────────────────────────────


def test_record_line_has_the_canon_fields_in_fixed_order() -> None:
    probe, records = _probe(_StubRouter(_SHADOW_AGREE))

    assert _submit(probe, "내일 비 와?", "req-7") is True

    lines = _payloads(records, "intent_shadow ")
    assert len(lines) == 1
    rec = lines[0]
    assert list(rec) == [
        "event", "trace_id", "turn_index", "service", "shadow", "agree",
        "utterance_chars", "utterance_sha12", "meta",
    ]
    assert (rec["event"], rec["trace_id"], rec["turn_index"]) == ("intent_shadow", "req-7", 3)
    assert rec["service"] == {
        "intent": "GET_WEATHER", "route": "LLM_DIRECT", "confidence": 0.82, "reason": None,
        "llm_calls": 1, "latency_ms": 1650, "refused": False,
    }
    assert rec["shadow"] == {
        "intent": "GET_WEATHER", "route": "CONFIDENT", "confidence": 0.91, "reason": None,
        "llm_calls": 0, "latency_ms": 38, "refused": False,
    }
    assert rec["agree"] is True
    assert rec["utterance_chars"] == len(normalize("내일 비 와?"))
    assert rec["utterance_sha12"] == hashlib.sha256(normalize("내일 비 와?").encode()).hexdigest()[:12]
    assert rec["meta"] == _META
    assert "\n" not in records[0].getMessage()


def test_disagreement_and_refusal_are_recorded() -> None:
    probe, records = _probe(_StubRouter(_REFUSED))

    _submit(probe)

    rec = _payloads(records, "intent_shadow ")[0]
    assert rec["agree"] is False
    assert rec["shadow"]["intent"] == "OUT_OF_SCOPE" and rec["shadow"]["route"] == "FALLBACK"
    assert rec["shadow"]["refused"] is True
    assert rec["shadow"]["reason"] == _REFUSED.reason  # 섀도 쪽 사유는 남긴다 — 어느 단계에서 떨어졌는지


def test_shadow_route_gets_suffixed_trace_id_and_the_same_now() -> None:
    router = _StubRouter(_SHADOW_AGREE)
    probe, _records = _probe(router)

    _submit(probe, "내일 비 와?", "req-9")

    assert router.calls == [("내일 비 와?", TraceId("req-9:shadow"), _NOW)]


def test_router_exception_is_swallowed_logged_and_the_slot_released() -> None:
    probe, records = _probe(_BoomRouter(), max_inflight=1)

    assert _submit(probe, trace_id="t-1") is True  # 제출은 됐다 — 실패는 스레드 안의 일
    assert _submit(probe, trace_id="t-2") is True  # 자리가 반납됐다

    assert _payloads(records, "intent_shadow ") == []
    errors = _payloads(records, "intent_shadow_error ")
    assert [e["trace_id"] for e in errors] == ["t-1", "t-2"]
    assert all(e["error"].startswith("RuntimeError") for e in errors)


# ── 원문 부재 (AO-P9 · SEC-U8-06) ────────────────────────────────────────

_HANGUL = st.text(
    alphabet=st.characters(min_codepoint=0xAC00, max_codepoint=0xD7A3), min_size=4, max_size=40,
)


@settings(max_examples=40, deadline=None)
@given(utterance=_HANGUL)
def test_log_never_carries_the_utterance_slots_or_account_ref(utterance: str) -> None:
    service = _m(Intent.GET_WEATHER, MatchRoute.LLM_DIRECT, 0.8, slots={"region": utterance})
    shadow = _m(Intent.GET_WEATHER, MatchRoute.CONFIDENT, 0.9, slots={"region": utterance})
    probe, records = _probe(_StubRouter(shadow))

    assert _submit(probe, utterance, service=service, meta={"bank_sha": "abc"}) is True

    text = "\n".join(r.getMessage() for r in records)
    assert utterance not in text
    assert normalize(utterance) not in text
    rec = _payloads(records, "intent_shadow ")[0]
    assert _all_keys(rec).isdisjoint(_FORBIDDEN_KEYS)
    assert rec["utterance_chars"] == len(normalize(utterance))
    assert rec["utterance_sha12"] == hashlib.sha256(normalize(utterance).encode()).hexdigest()[:12]


def test_record_types_have_no_slot_for_utterance_slots_or_account_ref() -> None:
    for cls in (ShadowRecord, ShadowSide):
        assert {f.name for f in dataclasses.fields(cls)}.isdisjoint(_FORBIDDEN_KEYS)
    side = ShadowSide.from_match(_SHADOW_AGREE, llm_calls=0, latency_ms=1)
    base = dict(trace_id="t", turn_index=1, service=side, shadow=side, utterance_chars=4,
                utterance_sha12="abc", meta={})
    with pytest.raises(TypeError):
        ShadowRecord(**base, utterance="원문")  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        ShadowRecord(**{**base, "meta": {"account_ref": "acct-1"}})  # meta 도 같은 금지 키


def test_forbidden_meta_key_is_not_logged_but_surfaces_as_error() -> None:
    probe, records = _probe(_StubRouter(_SHADOW_AGREE))

    assert _submit(probe, meta={"account_ref": "acct-zq7"}) is True

    assert _payloads(records, "intent_shadow ") == []
    assert len(_payloads(records, "intent_shadow_error ")) == 1
    assert "acct-zq7" not in "\n".join(r.getMessage() for r in records)


# ── 직렬화 왕복 (AO-P11) ─────────────────────────────────────────────────


def test_record_roundtrips_through_json_and_agree_is_derived() -> None:
    record = ShadowRecord(
        trace_id="t", turn_index=12,
        service=ShadowSide.from_match(_SERVICE, llm_calls=1, latency_ms=1650, keep_reason=False),
        shadow=ShadowSide.from_match(_REFUSED, llm_calls=2, latency_ms=2400),
        utterance_chars=11, utterance_sha12="3f9a3f9a3f9a", meta=dict(_META),
    )
    assert record.agree is False
    assert ShadowRecord.from_dict(json.loads(record.to_json())) == record
    assert "\n" not in record.to_json()


# ── TaggedTrace ─────────────────────────────────────────────────────────


def _call_record() -> LlmCallRecord:
    return LlmCallRecord(
        trace_id=TraceId("t:shadow"), occurred_at=_NOW, component="c1.gateway", feature="INTENT",
        model_id="m-l", prompt_ref=_REF, input_tokens=1, output_tokens=1, latency_ms=5, success=True,
        agent=None,
    )


def _fallback_event() -> FallbackEvent:
    return FallbackEvent(trace_id=TraceId("t:shadow"), occurred_at=_NOW, component="c1.gateway",
                         stage="llm", from_mode="llm", to_mode="fallback", reason="timeout")


def test_tagged_trace_rewrites_only_component_and_delegates() -> None:
    inner = InMemoryTrace()
    tagged = TaggedTrace(inner)
    drop = GateDropEvent(trace_id=TraceId("t:shadow"), occurred_at=_NOW, component="c1.gate",
                         feature="INTENT", dropped_ids=(), total_count=1, dropped_count=0)

    for event in (_call_record(), _fallback_event(), drop):
        tagged.emit(event)

    assert [e.component for e in inner.events] == ["c1.gateway.shadow"] * 3
    assert inner.events[0] == dataclasses.replace(_call_record(), component="c1.gateway.shadow")
    assert inner.events[1] == dataclasses.replace(_fallback_event(), component="c1.gateway.shadow")
    assert inner.events[2] == dataclasses.replace(drop, component="c1.gateway.shadow")


def test_tagged_trace_custom_component_and_passthrough_for_unknown_events() -> None:
    inner = InMemoryTrace()
    TaggedTrace(inner, component="c1.gateway.other").emit(_call_record())
    assert inner.events[0].component == "c1.gateway.other"

    TaggedTrace(inner).emit("not-an-event")  # component 칸이 없는 것은 그대로 넘긴다
    assert inner.events[-1] == "not-an-event"


def test_tagged_trace_swallows_inner_failure() -> None:
    class _Boom:
        def emit(self, event) -> None:
            raise RuntimeError("boom")

    TaggedTrace(_Boom()).emit(_fallback_event())  # 예외 없음 — 계측 실패 ≠ 비즈니스 실패


# ── ShadowCountingLlm ───────────────────────────────────────────────────


def test_counting_llm_counts_every_call_across_threads_and_passes_the_response_through() -> None:
    inner = FakeLlm(canned="ok")
    counting = ShadowCountingLlm(inner)
    request = LlmRequest(model_id="m-l", prompt="p", prompt_ref=_REF, max_tokens=8)

    assert counting.invoke(request) == inner.invoke(request)
    assert counting.count == 1

    def work() -> None:
        for _ in range(25):
            counting.invoke(request)

    threads = [threading.Thread(target=work) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert counting.count == 1 + 8 * 25

    counting.reset()
    assert counting.count == 0


def test_counting_llm_counts_a_failed_call_too() -> None:
    counting = ShadowCountingLlm(FailingLlm())
    with pytest.raises(RuntimeError):
        counting.invoke(LlmRequest(model_id="m-l", prompt="p", prompt_ref=_REF, max_tokens=8))
    assert counting.count == 1  # 비용은 났다 — CountingLlm 과 같은 규칙


# ── 실물 라우터 + 실물 게이트웨이 왕복 ──────────────────────────────────


def test_end_to_end_llm_direct_counts_one_shadow_call_and_tags_the_trace() -> None:
    trace = InMemoryTrace()
    counting = ShadowCountingLlm(
        FakeLlm(canned=json.dumps({"intent": "GET_WEATHER", "slots": {}, "confidence": 0.7})))
    gateway = GatewayFacade(counting, PromptRegistry(_PROMPTS_DIR), IntentGate(), _CFG, TaggedTrace(trace))
    router = IntentRouter(FakeEmbedding(), InMemoryVectorStore(), intent_gateway=gateway,
                          bank_ready=lambda: False)  # 1·2차 건너뛰고 3차로 — LLM 정확히 1회
    probe, records = _probe(router, counting=counting)

    assert _submit(probe, trace_id="req-1") is True

    rec = _payloads(records, "intent_shadow ")[0]
    assert rec["shadow"]["route"] == "LLM_DIRECT"
    assert rec["shadow"]["intent"] == "GET_WEATHER" and rec["agree"] is True
    assert rec["shadow"]["llm_calls"] == 1
    assert rec["shadow"]["reason"] == "escalated: bank_not_ready"
    calls = trace.of_type(LlmCallRecord)
    assert len(calls) == 1
    assert calls[0].component == "c1.gateway.shadow"
    assert str(calls[0].trace_id) == "req-1:shadow"


def test_default_pool_runs_the_route_on_an_intent_shadow_thread() -> None:
    seen: dict[str, str] = {}

    class _ThreadNameRouter:
        def route(self, utterance: str, trace_id: TraceId, now: datetime) -> IntentMatch:
            seen["thread"] = threading.current_thread().name
            return _SHADOW_AGREE

    log, records = _logger()
    probe = ShadowIntentProbe(_ThreadNameRouter(), rate=1.0, rng=random.Random(1), logger=log)

    assert _submit(probe) is True
    deadline = time.monotonic() + 5.0
    while not _payloads(records, "intent_shadow ") and time.monotonic() < deadline:
        time.sleep(0.01)
    assert len(_payloads(records, "intent_shadow ")) == 1
    assert seen["thread"].startswith("intent-shadow")


# ── is_refusal 공개 ─────────────────────────────────────────────────────


def test_is_refusal_is_public_and_reads_the_refusal_markers() -> None:
    assert is_refusal(_REFUSED) is True
    assert is_refusal(_m(Intent.OUT_OF_SCOPE, MatchRoute.FALLBACK, 0.0,
                         reason="router_error: RuntimeError: boom")) is False
    assert is_refusal(_SHADOW_AGREE) is False
