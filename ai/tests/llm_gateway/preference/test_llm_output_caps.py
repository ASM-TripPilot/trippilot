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
    SCORE_TOKENS_PER_ITEM,
    score_chunk_cap,
)
from trippilot.ports.llm_port import LlmRequest, LlmResponse, LlmTimeoutError

from tests.fakes.fake_clock import FakeClock
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.orchestrator.schedule.test_schedule_coordinator import (
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
        # 여행 요약 실측 출력 1639~1935 토큰 — 2048 에서 10회 중 4회 잘림(2026-10-20)
        LlmFeature.REFLECTION_TEMPLATE: 4096,
        # fable(사고 토큰도 상한 안) 실측 출력 1000~1024 — 1024 에서 잘림
        LlmFeature.SHARE_CARD_COPY: 2048,
        # 다시 짜기 하루 구성 — 고른 곳 ≤ 8건 × 이유 + fable 사고 토큰
        LlmFeature.REPLAN_COMPOSITION: 2048,
        LlmFeature.PREFERENCE_SCORING: 2048,
        # 도우미 턴 — 분류 JSON 한 줄 · 답변 ≤400자 · 요약 ≤20줄×120자(1024 면 꽉 찬 요약이 잘린다)
        LlmFeature.DIALOGUE_INTENT: 1024,  # DEV 실측 출력 239/256 — 사고 토큰이 상한에 붙었다
        LlmFeature.DIALOGUE_ANSWER: 512,
        LlmFeature.DIALOGUE_MEMORY: 2048,
        LlmFeature.DIALOGUE_PLAN: 1024,  # 분류와 같은 근거 — JSON 한 줄 + 사고 토큰(출력 239/256 실측)
        LlmFeature.DIALOGUE_SQL: 512,  # SELECT 한 문장 JSON, 사고 끔
        LlmFeature.DIALOGUE_SMALLTALK: 512,  # 잡담 1~3문장 JSON — 답변과 같은 상한
        LlmFeature.PLACE_FACT_LOOKUP: 1024,  # 칸 셋 JSON + 검색 뒤 사고 토큰
        LlmFeature.DIALOGUE_KNOWLEDGE: 512,  # 지식 답 2~4문장 JSON — 답변과 같은 상한
    }.get(feature, 1024)
    assert [r.max_tokens for r in llm.requests] == [expected]


def test_explicit_shared_cap_still_applies_to_unmapped_features() -> None:
    """공용 값을 바꾸면 기능별 지정이 없는 기능만 따라간다 (스크립트의 4096 같은 오버라이드)."""
    cfg = C1Config(model_ids=_CFG.model_ids, max_tokens=4096)
    assert cfg.max_tokens_for(LlmFeature.EVENT_EXTRACTION) == 4096
    assert cfg.max_tokens_for(LlmFeature.EXPLANATION) == 4096
    assert _CFG.max_tokens_for(LlmFeature.PREFERENCE_SCORING) == 2048  # 기능별 지정 — 공용 값을 안 따른다


@pytest.mark.parametrize("feature", list(LlmFeature))
def test_effort_per_feature_reaches_vendor(feature: LlmFeature) -> None:
    """출력 상한과 같은 길 — 기능별 effort 가 벤더 요청까지 닿는다(미지정은 None)."""
    llm = _RecordingLlm()
    gw = GatewayFacade(llm, _Renderer(), ClosedSetGate(), _CFG, InMemoryTrace())

    try:
        gw.call(feature, {}, _pool(1), _TRACE, _NOW)
    except ValueError:
        pytest.skip(f"{feature.value} 라우팅 미설정 — effort 와 무관")

    expected = {
        # fable 실측(2026-10-11): 백엔드 시한(리마인드 8s·replan 25s) 안에 들려면 low
        # 회고는 terra 실측(2026-10-20)으로 none — low 는 하루 6~12곳에서 시한 15s 를 넘겼다
        LlmFeature.REFLECTION_TEMPLATE: "none",
        LlmFeature.REMINDER_COPY: "low",
        LlmFeature.ALTERNATIVE_SELECTION: "low",
        LlmFeature.REPLAN_COMPOSITION: "low",  # 같은 replan 25s 안에서 PlanB 다음에 돈다
        LlmFeature.REPLAN_REQUEST_EXTRACTION: "low",  # 같은 replan 시한, 구성보다 먼저
        LlmFeature.REPLAN_DIRECTIVE_TRANSLATION: "low",  # 기본 추론에서 DEV 3.75s 시한 2/2 초과
        # 도우미 턴 — 해석 시한 9s 안에서 분류 ≤2.5s·답변 ≤2.5s·요약 ≤2.0s (assistant-orchestrator FD §2.10)
        LlmFeature.DIALOGUE_INTENT: "none",
        LlmFeature.DIALOGUE_ANSWER: "none",
        LlmFeature.DIALOGUE_MEMORY: "low",
        LlmFeature.DIALOGUE_PLAN: "none",  # 같은 9s 안의 2‴ 계획(≤3.5s) — 사고 없이 더 빠르고 품질이 같거나 낫다(2026-10-20 실측)
        LlmFeature.DIALOGUE_SQL: "none",  # 팬아웃 안(≤3s)의 짧은 변환
        LlmFeature.DIALOGUE_SMALLTALK: "none",  # 답변과 같은 자리(≤3.5s)
        LlmFeature.PLACE_FACT_LOOKUP: "low",  # 턴 밖(뒤에서) — 검색 결과에서 값 셋을 고른다
        LlmFeature.DIALOGUE_KNOWLEDGE: "none",  # 답변과 같은 자리(≤3.5s)
        LlmFeature.PREFERENCE_SCORING: "none",  # 닫힌 목록에 점수만 — 사고 없이 묶음 p50 2.46 → 1.73s, 쌍 정합 같음(2026-10-23)
    }.get(feature)
    assert [r.effort for r in llm.requests] == [expected]


def test_effort_survives_timeout_retry() -> None:
    """2단 폴백(재시도 모델)도 같은 effort 로 부른다 — 재시도만 느려지면 예산을 못 지킨다."""

    class _TimeoutOnce(_RecordingLlm):
        def invoke(self, request: LlmRequest) -> LlmResponse:
            if not self.requests:
                self.requests.append(request)
                raise LlmTimeoutError("first")
            return super().invoke(request)

    cfg = C1Config(
        model_ids=_CFG.model_ids,
        retry_models={LlmFeature.ALTERNATIVE_SELECTION: "m-retry"},
        feature_effort={LlmFeature.ALTERNATIVE_SELECTION: "low"},
    )
    llm = _TimeoutOnce()
    gw = GatewayFacade(llm, _Renderer(), ClosedSetGate(), cfg, InMemoryTrace())

    gw.call(LlmFeature.ALTERNATIVE_SELECTION, {}, _pool(1), _TRACE, _NOW,
            retry_timeout_sec=1.0)

    assert [(r.model_id, r.effort) for r in llm.requests] == [("m-h", "low"), ("m-retry", "low")]


# ── (b) 청크 상한 ───────────────────────────────────────────────────


def test_default_chunk_cap_fits_scoring_output_budget() -> None:
    """기본 설정에서 청크 상한 × 건당 추정 + 사고 몫 ≤ PREFERENCE_SCORING 출력 상한 — 잘려서 폐기되는 구간 밖."""
    from trippilot.llm_gateway.workers.preference import SCORE_THINKING_RESERVE_TOKENS
    cap = score_chunk_cap(_CFG)
    assert cap * SCORE_TOKENS_PER_ITEM + SCORE_THINKING_RESERVE_TOKENS <= _CFG.max_tokens_for(LlmFeature.PREFERENCE_SCORING)
    assert cap >= _CFG.score_chunk_min


def test_scoring_cap_leaves_room_for_thinking_without_growing_the_chunk() -> None:
    """출력 상한을 올린 이유는 사고 토큰(fable)이지 청크를 키우려는 게 아니다 — 2026-10-13 DEV 45회 중 3회가
    정확히 1024 에서 잘렸다. 번호 출력(0.4.0)은 건당 16 이라 역산 64 — 상한은 chunk_max 40 이 정한다."""
    from trippilot.llm_gateway.workers.preference import SCORE_THINKING_RESERVE_TOKENS
    cap_tokens = _CFG.max_tokens_for(LlmFeature.PREFERENCE_SCORING)
    assert score_chunk_cap(_CFG) == _CFG.score_chunk_max
    assert score_chunk_cap(_CFG) * SCORE_TOKENS_PER_ITEM + SCORE_THINKING_RESERVE_TOKENS <= cap_tokens
    # 상한을 1024 로 되돌리는 설정이 와도 청크 0·폭증 없이 절반 몫만 뺀다
    small = C1Config(model_ids=_CFG.model_ids,
                     feature_max_tokens={LlmFeature.PREFERENCE_SCORING: 1024})
    assert score_chunk_cap(small) == 512 // SCORE_TOKENS_PER_ITEM


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
    # 상한 안이면 전원 간다 — 자르는 기준은 청크 크기(시한 역산값)다. chunk_max 로 자르면 병렬 상한에서 청크가
    # 역산값을 넘겨 시한을 깬다(2026-10-20 개발 서버 1일차 10/10 시한 초과).
    assert sum(sizes) == min(n, max_parallel * min(chunk_size, chunk_max))


def test_worker_capacity_is_parallel_times_chunk_cap() -> None:
    gw = GatewayFacade(_RecordingLlm(), _Renderer(), ClosedSetGate(), _CFG, InMemoryTrace())
    assert PreferenceScoringWorker(gw).capacity == _CFG.score_max_parallel * score_chunk_cap(_CFG)


class _CappedScoring:
    """capacity 2 짜리 스코어러 — 받은 풀을 기록하고 전원 0.5 로 답한다."""

    capacity = 2

    def capacity_for(self, timeout_sec):  # noqa: ANN001 — 시한과 무관한 가짜
        return self.capacity

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
    from tests.agents.schedule.test_schedule_agent import _pool as _agent_pool

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

    rule = sorted(agent._rule_scores(request, pool, _PERSONA), key=lambda sp: (-sp.score, str(sp.poi_id)))
    sent = scoring.pools[0]
    assert sent.poi_ids == frozenset(sp.poi_id for sp in rule[:2])  # 규칙 상위만 LLM 으로
    assert {sp.poi_id for sp in scored} == pool.poi_ids  # 나머지는 규칙 점수로 보충
    assert sum(sp.is_llm_score for sp in scored) == 2


class _BudgetCappedScoring(_CappedScoring):
    """시한 무관 상한은 넉넉한데(1000) 이 시한에는 2건만 — 에이전트가 `capacity_for` 로 잘라야 한다."""

    capacity = 1000

    def __init__(self) -> None:
        super().__init__()
        self.asked: list[float] = []

    def capacity_for(self, timeout_sec):  # noqa: ANN001
        self.asked.append(timeout_sec)
        return 2


def test_agent_caps_the_llm_pool_by_the_stage_budget_not_the_static_capacity() -> None:
    """2026-10-20 개발 서버: 시한 무관 상한(250)으로 잘라 1일차 8.1s 예산에 청크 25 가 나가 10/10 시한 초과였다.
    에이전트는 워커 호출에 주는 시한과 **같은 시한**으로 실을 건수를 묻고, 규칙 점수 상위만 보낸다."""
    from tests.agents.schedule.test_schedule_agent import _pool as _agent_pool

    trace = InMemoryTrace()
    scoring = _BudgetCappedScoring()
    agent = ScheduleAgent(scoring, _AssemblyProvider(trace, _Sink(), primary=True), FakeClock(), trace)
    request = _request()
    pool = _agent_pool()
    budget = allocate(15_000, OrchestratorConfig())
    remaining = 8_136

    scored, _ = agent._score(request, pool, _PERSONA, budget, remaining, [], _TRACE, _COORD_NOW)

    rule = sorted(agent._rule_scores(request, pool, _PERSONA), key=lambda sp: (-sp.score, str(sp.poi_id)))
    assert scoring.asked == [min(budget.c1_ms, remaining) / 1000.0]
    assert scoring.pools[0].poi_ids == frozenset(sp.poi_id for sp in rule[:2])
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


def test_llm_이_못_본_후보는_llm_이_본_보통보다_높게_서지_않는다() -> None:
    """규칙 점수(명소 1.0 + 인기·입장료·취향, 1.3 까지)를 LLM 점수(0~1)와 그대로 섞으면 LLM 이 안 본 곳이 이긴다.

    서울 2박3일(풀 1,319 · LLM 250)에서 카페 취향인데 상위 150 에 카페가 0곳이었다 — LLM 이 카페에 준 0.93 을
    LLM 이 보지도 않은 명소의 규칙 점수 1.1 이 눌렀다(2026-10-20 로컬). 못 본 곳은 규칙 서열은 그대로 두되
    LLM 이 본 것의 중앙값을 넘지 않는다.
    """
    from statistics import median

    from tests.agents.schedule.test_schedule_agent import _pool as _agent_pool

    class _Liked(_CappedScoring):
        def score(self, pool, persona, trace_id, now, *, timeout_sec=None):
            self.pools.append(pool)
            ids = sorted(str(p.poi_id) for p in pool.pois)
            return TypedResult(value=(ScoredPoi(PoiId(ids[0]), 0.95, True), ScoredPoi(PoiId(ids[1]), 0.30, True)),
                               is_fallback=False, error=None, call_record=None)

    trace = InMemoryTrace()
    agent = ScheduleAgent(_Liked(), _AssemblyProvider(trace, _Sink(), primary=True), FakeClock(), trace)
    scored, _ = agent._score(_request(), _agent_pool(), _PERSONA,
                             allocate(20_000, OrchestratorConfig()), 20_000, [], _TRACE, _COORD_NOW)

    llm = [sp for sp in scored if sp.is_llm_score]
    unseen = [sp for sp in scored if not sp.is_llm_score]
    assert unseen and all(sp.score <= median(sp.score for sp in llm) for sp in unseen), scored
    assert max(llm, key=lambda sp: sp.score).score > max(sp.score for sp in unseen)  # LLM 이 좋다고 본 곳이 1등
    rule = {sp.poi_id: sp.score for sp in agent._rule_scores(_request(), _agent_pool(), _PERSONA)}
    order = sorted(unseen, key=lambda sp: -sp.score)
    assert [rule[sp.poi_id] for sp in order] == sorted((rule[sp.poi_id] for sp in unseen), reverse=True)  # 서열 유지
