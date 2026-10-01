"""LLM 출력 상한 — 기능별 상한·청크 상한·잘림 표면화 (전부 fake — 실 호출 0, D37).

실측(라이브 로그, claude-sonnet-5·gpt-5.6-terra): 공용 max_tokens=1024 에서
  - EXPLANATION 이 매번 output_tokens=1024 에서 잘려 `parse_error: JSON 아님` → 근거 0건
  - PREFERENCE_SCORING 청크 성공률: 29건 9/10 · 32건 1/10 · 41·52건 0/10
    (병렬 상한 10 에 걸린 풀 515 → 청크 ~52건)

증명하는 것:
  (a) 벤더로 가는 max_tokens 가 기능별이다 — EXPLANATION·ALTERNATIVE_EXPLANATION 4096,
      나머지는 종전 1024 (회귀 0)
  (b) 어떤 풀·설정에서도 청크 ≤ 청크 상한, LLM 행 건수 ≤ 병렬×청크 상한, 청크 ⊆ 풀(INV-1),
      중복 없음 — 그리고 상한을 넘는 풀은 규칙 점수 상위만 LLM 으로 간다
  (c) 벤더 종료 사유가 길이 초과면 어댑터가 표면화하고, 폴백 사유가 `truncated:` 로 갈린다
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.agents.schedule.agent import ScheduleAgent
from trippilot.agents.schedule.budget import OrchestratorConfig, allocate
from trippilot.domain.common import GeoPoint, PoiId, TraceId
from trippilot.domain.llm import CandidatePool, LlmFeature, ModelTier, ScoredPoi, TypedResult
from trippilot.domain.observability import FallbackEvent
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.domain.prompt import PromptRef
from trippilot.llm_gateway.adapters.anthropic_adapter import AnthropicAdapter
from trippilot.llm_gateway.adapters.openai_adapter import OpenAIAdapter
from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.gates.scoring import ClosedSetGate
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.workers.preference import (
    PreferenceScoringWorker,
    plan_chunks,
    score_chunk_cap,
)
from trippilot.ports.llm_port import LlmRequest, LlmResponse

from tests.fakes.fake_clock import FakeClock
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.test_schedule_coordinator import (
    _NOW as _COORD_NOW,
    _PERSONA,
    _AssemblyProvider,
    _Renderer,
    _Sink,
    _request,
)

_NOW = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
_TRACE = TraceId("t-caps")
_CFG = C1Config(model_ids={ModelTier.LIGHT: "m-l", ModelTier.HEAVY: "m-h"})


class _RecordingLlm:
    def __init__(self, text: str = "{}", *, truncated: bool = False) -> None:
        self.requests: list[LlmRequest] = []
        self._text = text
        self._truncated = truncated

    def invoke(self, request: LlmRequest) -> LlmResponse:
        self.requests.append(request)
        return LlmResponse(
            raw_text=self._text, input_tokens=1, output_tokens=1, latency_ms=0,
            model_id=request.model_id, truncated=self._truncated,
        )


def _poi(pid: str) -> Poi:
    return Poi(
        poi_id=PoiId(pid), name=f"장소-{pid}", category=PoiCategory.SIGHT,
        coord=GeoPoint(37.75, 128.87), open_hours=(), avg_cost=None, rating=None,
        quality=DataQuality.FULL, source=PoiSource.SEED, confidence=None,
    )


def _pool(n: int) -> CandidatePool:
    pois = tuple(_poi(f"c{i:04d}") for i in range(n))
    return CandidatePool(poi_ids=frozenset(p.poi_id for p in pois), pois=pois,
                         generated_at=_NOW)


# ── (a) 기능별 출력 상한 ────────────────────────────────────────────


@pytest.mark.parametrize("feature", list(LlmFeature))
def test_max_tokens_per_feature_reaches_vendor(feature: LlmFeature) -> None:
    llm = _RecordingLlm()
    gw = GatewayFacade(llm, _Renderer(), ClosedSetGate(), _CFG, InMemoryTrace())

    try:
        gw.call(feature, {}, _pool(1), _TRACE, _NOW)
    except ValueError:
        pytest.skip(f"{feature.value} 라우팅 미설정 — 상한과 무관")

    expected = {
        LlmFeature.EXPLANATION: 4096,
        LlmFeature.ALTERNATIVE_EXPLANATION: 4096,
        # 실측 출력 950~1016 토큰 — 1024 에 붙어 잘림 1회가 재시도 → 504 로 번졌다
        LlmFeature.REFLECTION_TEMPLATE: 2048,
    }.get(feature, 1024)
    assert [r.max_tokens for r in llm.requests] == [expected]


def test_explicit_shared_cap_still_applies_to_unmapped_features() -> None:
    """공용 값을 바꾸면 기능별 지정이 없는 기능만 따라간다 (스크립트의 4096 같은 오버라이드)."""
    cfg = C1Config(model_ids=_CFG.model_ids, max_tokens=4096)
    assert cfg.max_tokens_for(LlmFeature.EVENT_EXTRACTION) == 4096
    assert cfg.max_tokens_for(LlmFeature.EXPLANATION) == 4096
    assert _CFG.max_tokens_for(LlmFeature.PREFERENCE_SCORING) == 1024


# ── (b) 청크 상한 ───────────────────────────────────────────────────


def test_default_chunk_cap_fits_scoring_output_budget() -> None:
    """기본 설정에서 청크 상한 × 건당 추정 ≤ PREFERENCE_SCORING 출력 상한 — 실측 실패 구간(32건~) 밖."""
    cap = score_chunk_cap(_CFG)
    assert cap <= 29  # 실측: 29건 9/10 성공, 32건 1/10
    assert cap >= _CFG.score_chunk_min


@settings(max_examples=200, deadline=None)
@given(
    n=st.integers(min_value=0, max_value=2000),
    chunk_size=st.integers(min_value=1, max_value=60),
    max_parallel=st.integers(min_value=1, max_value=20),
    chunk_max=st.integers(min_value=1, max_value=60),
)
def test_plan_chunks_never_exceeds_chunk_max(n, chunk_size, max_parallel, chunk_max) -> None:
    pool = _pool(n)

    chunks = plan_chunks(pool, min(chunk_size, chunk_max), max_parallel, chunk_max=chunk_max)

    sizes = [len(c.pois) for c in chunks]
    assert all(0 < s <= chunk_max for s in sizes)
    assert sum(sizes) <= max_parallel * chunk_max
    ids = [p.poi_id for c in chunks for p in c.pois]
    assert len(ids) == len(set(ids))  # 중복 없음
    assert set(ids) <= pool.poi_ids  # INV-1
    assert all(c.poi_ids == frozenset(p.poi_id for p in c.pois) for c in chunks)
    assert sum(sizes) == min(n, max_parallel * chunk_max)  # 상한 안이면 전원 간다


def test_worker_capacity_is_parallel_times_chunk_cap() -> None:
    gw = GatewayFacade(_RecordingLlm(), _Renderer(), ClosedSetGate(), _CFG, InMemoryTrace())
    assert PreferenceScoringWorker(gw).capacity == _CFG.score_max_parallel * score_chunk_cap(_CFG)


class _CappedScoring:
    """capacity 2 짜리 스코어러 — 받은 풀을 기록하고 전원 0.5 로 답한다."""

    capacity = 2

    def __init__(self) -> None:
        self.pools: list[CandidatePool] = []

    def score(self, pool, persona, trace_id, now, *, timeout_sec=None):
        self.pools.append(pool)
        return TypedResult(
            value=tuple(ScoredPoi(poi_id=p.poi_id, score=0.5, is_llm_score=True)
                        for p in pool.pois),
            is_fallback=False, error=None, call_record=None,
        )


def test_agent_sends_only_rule_top_to_llm_and_backfills_rest() -> None:
    from tests.test_schedule_agent import _pool as _agent_pool

    trace = InMemoryTrace()
    scoring = _CappedScoring()
    agent = ScheduleAgent(scoring, _AssemblyProvider(trace, _Sink(), primary=True),
                          FakeClock(), trace)
    request = _request()
    pool = _agent_pool()
    assert len(pool.pois) > scoring.capacity

    scored, _ = agent._score(request, pool, _PERSONA,
                             allocate(20_000, OrchestratorConfig()), 20_000, [],
                             _TRACE, _COORD_NOW)

    rule = sorted(agent._rule_scores(request, pool), key=lambda sp: (-sp.score, str(sp.poi_id)))
    sent = scoring.pools[0]
    assert sent.poi_ids == frozenset(sp.poi_id for sp in rule[:2])  # 규칙 상위만 LLM 으로
    assert {sp.poi_id for sp in scored} == pool.poi_ids  # 나머지는 규칙 점수로 보충
    assert sum(sp.is_llm_score for sp in scored) == 2


# ── (c) 잘림 표면화 ─────────────────────────────────────────────────

_REQ = LlmRequest(
    model_id="m", prompt="p",
    prompt_ref=PromptRef(prompt_id="prompts/t.yaml", version="0.0.1", feature="EXPLANATION"),
    max_tokens=1024, timeout_sec=2.5,
)


def _openai_chat(finish_reason: str):
    return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(
        create=lambda **kw: SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content='{"a'),
                                     finish_reason=finish_reason)],
            usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1024),
            model="m"))))


def _openai_responses(status: str, reason: str | None):
    details = SimpleNamespace(reason=reason) if reason else None
    return SimpleNamespace(responses=SimpleNamespace(
        create=lambda **kw: SimpleNamespace(
            output_text='{"a', status=status, incomplete_details=details,
            usage=SimpleNamespace(input_tokens=1, output_tokens=1024), model="m")))


def _anthropic(stop_reason: str):
    return SimpleNamespace(messages=SimpleNamespace(
        create=lambda **kw: SimpleNamespace(
            content=[SimpleNamespace(type="text", text='{"a')], stop_reason=stop_reason,
            usage=SimpleNamespace(input_tokens=1, output_tokens=1024), model="m")))


@pytest.mark.parametrize(("adapter", "truncated"), [
    (OpenAIAdapter(_openai_chat("length")), True),
    (OpenAIAdapter(_openai_chat("stop")), False),
    (OpenAIAdapter(_openai_responses("incomplete", "max_output_tokens"), api="responses"), True),
    (OpenAIAdapter(_openai_responses("incomplete", "content_filter"), api="responses"), False),
    (OpenAIAdapter(_openai_responses("completed", None), api="responses"), False),
    (AnthropicAdapter(_anthropic("max_tokens")), True),
    (AnthropicAdapter(_anthropic("end_turn")), False),
])
def test_adapters_surface_length_stop(adapter, truncated: bool) -> None:
    assert adapter.invoke(_REQ).truncated is truncated


def _fallback_reason(llm) -> str:
    trace = InMemoryTrace()
    gw = GatewayFacade(llm, _Renderer(), ClosedSetGate(), _CFG, trace)
    result = gw.call(LlmFeature.PREFERENCE_SCORING, {}, _pool(3), _TRACE, _NOW)
    assert result.is_fallback
    (event,) = trace.of_type(FallbackEvent)
    assert event.reason == result.error
    return event.reason


def test_truncated_response_falls_back_with_truncated_prefix() -> None:
    cut = json.dumps({"scores": [{"poiId": "c0000", "score": 0.5}]})[:20]
    reason = _fallback_reason(_RecordingLlm(cut, truncated=True))
    assert reason.startswith("truncated:")


def test_untruncated_broken_json_keeps_parse_error_path() -> None:
    cut = json.dumps({"scores": [{"poiId": "c0000", "score": 0.5}]})[:20]
    reason = _fallback_reason(_RecordingLlm(cut))
    assert not reason.startswith("truncated:")
