"""U5-01·02 — ItineraryOrchestrator 조립 + 폴백 계단 (TRIP-237·238).

증명하는 것:
  ① 정상 경로 e2e: M7 풀 → C1 점수 → C2 solve 가 fake만으로 끝까지 흐른다
  ② 폴백 계단 각 칸 (INV-4): C1 실패/워커 예외/시한 부족/전량 드롭 → **규칙 점수**,
     C2 강등 → 결과에 표시. 어느 칸도 조용히 넘어가지 않는다
  ③ 이중 폴백 금지: C2 체인 강등은 C2가 이미 관측했으므로 오케스트레이터는
     이벤트를 재발행하지 않는다 (폴백률 지표 이중 계수 방지)
  ④ 시한 배분: day1 5초·전체 20초 양쪽에서 C2 예산 > 0, 상류가 다 태워도 예약분 보장
  ⑤ day1 2단계(TRIP-293): days 부분집합 + excluded_poi_ids 가 그대로 통과
  ⑥ INV-1: 게이트를 우회한 풀 밖 poi_id는 후보로도 슬롯으로도 들어가지 못한다
  ⑦ PBT: 어떤 입력에도 generate()는 예외를 밖으로 던지지 않고
     결과 또는 명시적 실패(FAILED + error)로 수렴한다
"""

from __future__ import annotations

import json
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone

from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.context import ContextResolver
from trippilot.llm_gateway.gates.base import GateOutcome
from trippilot.llm_gateway.gates.explanation import ExplanationGate
from trippilot.llm_gateway.gates.scoring import ClosedSetGate
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.workers.explanation import ExplanationWorker
from trippilot.llm_gateway.workers.preference import PreferenceScoringWorker
from trippilot.solver_engine.config import SolverConfig
from trippilot.solver_engine.facade import HybridSolverFacade
from trippilot.solver_engine.fallback_solver import RuleFallbackSolver
from trippilot.solver_engine.travel import TravelEstimator
from trippilot.domain.common import (
    BudgetLevel,
    GeoPoint,
    PoiId,
    ScheduleId,
    TraceId,
    TransportMode,
)
from trippilot.domain.context import Principal, ResourceRef
from trippilot.domain.itinerary import FixedBlock, SolveMode, TimeWindow
from trippilot.domain.llm import ModelTier, ScoredPoi
from trippilot.domain.observability import FallbackEvent
from trippilot.domain.persona import CompanionType, PersonaSummary, TasteTag
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.domain.prompt import PromptRef
from trippilot.poi_curation.config import M7Config
from trippilot.poi_curation.pool_builder import CandidatePoolBuilder
from trippilot.orchestrator.itinerary_orchestrator import (
    GenerateItineraryRequest,
    GenerationOutcome,
    GenerationStatus,
    ItineraryOrchestrator,
    OrchestratorConfig,
    ScoringMode,
    allocate,
)

from tests.fakes.fake_clock import FakeClock
from tests.fakes.fake_llm import FailingLlm, FakeLlm, SlowLlm
from tests.fakes.in_memory_poi import InMemoryPoi
from tests.fakes.in_memory_trace import InMemoryTrace

_KST = timezone(timedelta(hours=9))
_NOW = datetime(2026, 8, 5, 8, 0, tzinfo=_KST)
_DAY1 = date(2026, 8, 5)
_TRACE_ID = TraceId("t-u5")
_ANCHOR = GeoPoint(37.751, 128.876)
_SCFG = SolverConfig()
_EST = TravelEstimator(_SCFG)
_C1CFG = C1Config(model_ids={ModelTier.LIGHT: "m-light", ModelTier.HEAVY: "m-heavy"})
_PERSONA = PersonaSummary(
    taste_tags=(TasteTag.NATURE,), companion=CompanionType.SOLO, budget=BudgetLevel.MID
)
_OWNER = "u1"
_PRINCIPAL = Principal(user_id=_OWNER)
_PERSONA_REF = ResourceRef(kind="persona", ref_id="persona-1", owner_id=_OWNER)
_WINDOW = TimeWindow(
    start=datetime(2026, 8, 5, 9, 0, tzinfo=_KST),
    end=datetime(2026, 8, 5, 21, 0, tzinfo=_KST),
)


# ── fixtures ────────────────────────────────────────────────────────


def _poi(i: int, off: float = 0.0, category: PoiCategory = PoiCategory.SIGHT) -> Poi:
    return Poi(
        poi_id=PoiId(f"p{i}"),
        name=f"POI{i}",
        category=category,
        coord=GeoPoint(_ANCHOR.lat + off, _ANCHOR.lng + off),
        open_hours=(),  # 정보 없음 → HC1 미적용 (가해성 보장)
        avg_cost=None,
        rating=4.0,
        quality=DataQuality.FULL,
        source=PoiSource.SEED,
        confidence=None,
    )


_POIS = (_poi(1, 0.0), _poi(2, 0.005), _poi(3, 0.010))
_POOL_IDS = frozenset(p.poi_id for p in _POIS)
_FAR_POIS = (_poi(9, 3.0),)  # 반경 밖 — 풀 0건 시나리오


def _scores_json(*ids: str) -> str:
    return json.dumps(
        {"scores": [{"poiId": i, "score": 0.9, "reason": "r"} for i in ids]}
    )


def _explanations_json(*ids: str) -> str:
    return json.dumps(
        {"explanations": [{"poiId": i, "text": "조용한 곳이라"} for i in ids]}
    )


class _Renderer:
    """결정론 렌더 fake (PromptRegistry 자리)."""

    def render(self, feature, variables):
        return f"{feature.value}|{sorted(variables)}", PromptRef(
            prompt_id="prompts/test.yaml", version="0.0.1", feature=feature.value
        )


class _Store:
    """ContextStore fake — 재조회 결과를 주입식으로 바꿔 워커 예외 경로를 만든다."""

    def __init__(self, value: object = _PERSONA) -> None:
        self._value = value

    def get(self, ref):
        return self._value


class _BypassGate:
    """풀 밖 poi_id를 그대로 통과시키는 **깨진** 게이트 (INV-1 우회 방어 검증용)."""

    def apply(self, raw_text, pool, *, feature, trace_id, now):
        return GateOutcome(
            value=(ScoredPoi(PoiId("hallucinated"), 0.99, True),),
            drop_event=None,
            error=None,
        )


class _PrimaryStage:
    """1차 단계 fake — 규칙 배치 결과를 OR_TOOLS 산출물로 승격 (정상 경로용)."""

    name = "primary_fake"
    required_ms = 0

    def __init__(self, poi_index) -> None:
        self._inner = RuleFallbackSolver(poi_index, _EST, _SCFG)

    def solve(self, problem, remaining_ms):
        solution = self._inner.solve(problem, remaining_ms)
        if not any(d.slots for d in solution.days):
            return None  # 배치 0건 → 해 없음 (체인 다음 단계로)
        return replace(solution, is_fallback=False, solve_mode=SolveMode.OR_TOOLS)


class _Sink:
    """C2에 실제로 넘어간 (problem, deadline) 기록."""

    def __init__(self) -> None:
        self.problems: list = []
        self.deadlines: list[int] = []


class _RecordingFacade:
    def __init__(self, inner, sink: _Sink) -> None:
        self._inner, self._sink = inner, sink

    def solve(self, problem, deadline_ms, trace_id=None):
        self._sink.problems.append(problem)
        self._sink.deadlines.append(deadline_ms)
        return self._inner.solve(problem, deadline_ms, trace_id)


class _Solvers:
    """SolverProvider — 요청 스코프로 퍼사드를 조립 (풀이 매 요청 다르므로)."""

    def __init__(self, trace, sink: _Sink, *, primary: bool) -> None:
        self._trace, self._sink, self._primary = trace, sink, primary

    def for_pool(self, poi_index):
        stages = []
        if self._primary:
            stages.append(_PrimaryStage(poi_index))
        stages.append(RuleFallbackSolver(poi_index, _EST, _SCFG))
        return _RecordingFacade(
            HybridSolverFacade(stages, poi_index, _EST, FakeClock(), self._trace),
            self._sink,
        )


class _BurningClock:
    """호출마다 시간이 흐르는 시계 — 상류가 예산을 다 태우는 상황 재현."""

    def __init__(self, step_ms: int) -> None:
        self._t, self._step = 0, step_ms

    def monotonic_ms(self) -> int:
        t = self._t
        self._t += self._step
        return t


def _build(
    *,
    score_llm=None,
    score_gate=None,
    expl_llm=None,
    primary: bool = True,
    pois=_POIS,
    store_value: object = _PERSONA,
    clock=None,
    config: OrchestratorConfig | None = None,
):
    trace = InMemoryTrace()
    builder = CandidatePoolBuilder(InMemoryPoi(tuple(pois)), M7Config())
    resolver = ContextResolver(_Store(store_value))
    gateway = GatewayFacade(
        score_llm if score_llm is not None else FakeLlm(_scores_json("p1", "p2", "p3")),
        _Renderer(),
        score_gate if score_gate is not None else ClosedSetGate(),
        _C1CFG,
        trace,
    )
    explainer = None
    if expl_llm is not None:
        explainer = ExplanationWorker(
            GatewayFacade(expl_llm, _Renderer(), ExplanationGate(), _C1CFG, trace),
            resolver,
        )
    sink = _Sink()
    orchestrator = ItineraryOrchestrator(
        builder,
        PreferenceScoringWorker(gateway, resolver),
        _Solvers(trace, sink, primary=primary),
        clock if clock is not None else FakeClock(),
        trace,
        context_resolver=resolver,  # 소유 검증(fail-closed, TRIP-333)도 같은 resolver
        explanation_worker=explainer,
        config=config,
    )
    return orchestrator, trace, sink


def _request(
    *,
    days: tuple[date, ...] = (_DAY1,),
    fixed_blocks: tuple[FixedBlock, ...] = (),
    excluded: frozenset[PoiId] = frozenset(),
    persona_ref: ResourceRef = _PERSONA_REF,
) -> GenerateItineraryRequest:
    return GenerateItineraryRequest(
        schedule_id=ScheduleId("s-1"),
        anchor=_ANCHOR,
        days=days,
        day_window=_WINDOW,
        budget=BudgetLevel.MID,
        transport=TransportMode.PUBLIC,
        persona_ref=persona_ref,
        principal=_PRINCIPAL,
        seed=7,
        fixed_blocks=fixed_blocks,
        excluded_poi_ids=excluded,
    )


def _slot_ids(outcome: GenerationOutcome) -> set[PoiId]:
    assert outcome.solution is not None
    return {s.poi_id for d in outcome.solution.days for s in d.slots}


def _orchestrator_events(trace) -> list[FallbackEvent]:
    return [
        e
        for e in trace.of_type(FallbackEvent)
        if e.component == "orchestrator.itinerary"
    ]


# ── ① 정상 경로 e2e ─────────────────────────────────────────────────


def test_e2e_pool_to_scores_to_solution() -> None:
    orchestrator, _, sink = _build()

    outcome = orchestrator.generate(_request(), 20_000, _TRACE_ID, _NOW)

    assert outcome.status is GenerationStatus.SUCCESS
    assert outcome.degradations == ()
    assert outcome.scoring_mode is ScoringMode.LLM
    assert outcome.candidate_count == 3
    assert outcome.solution is not None
    assert outcome.solution.solve_mode is SolveMode.OR_TOOLS
    assert outcome.solution.score is not None          # C2가 붙인 QualityScore 보존
    assert _slot_ids(outcome) <= _POOL_IDS             # INV-1
    assert all(
        s.is_llm_score for d in outcome.solution.days for s in d.slots
    )                                                  # LLM 점수가 슬롯까지 전달됨
    assert sink.problems[0].candidates                 # 조립된 문제가 C2에 그대로 전달


def test_e2e_attaches_explanations_when_worker_wired() -> None:
    orchestrator, _, _ = _build(
        expl_llm=FakeLlm(_explanations_json("p1", "p2", "p3"))
    )

    outcome = orchestrator.generate(_request(), 20_000, _TRACE_ID, _NOW)

    assert outcome.status is GenerationStatus.SUCCESS
    assert outcome.explanations
    assert {e.poi_id for e in outcome.explanations} <= _POOL_IDS  # INV-1


# ── ② 폴백 계단 ─────────────────────────────────────────────────────


def test_c1_llm_failure_falls_back_to_rule_scores() -> None:
    """LLM 실패 → 규칙 점수로 대체하고 일정은 그대로 나온다 (INV-4)."""
    orchestrator, trace, _ = _build(score_llm=FailingLlm())

    outcome = orchestrator.generate(_request(), 20_000, _TRACE_ID, _NOW)

    assert outcome.status is GenerationStatus.DEGRADED
    assert outcome.scoring_mode is ScoringMode.RULE
    assert outcome.solution is not None
    assert outcome.candidate_count == 3                # 풀 전량에 규칙 점수
    assert _slot_ids(outcome) <= _POOL_IDS             # INV-1 유지
    assert not any(s.is_llm_score for d in outcome.solution.days for s in d.slots)
    assert any(d.stage == "llm" for d in outcome.degradations)
    # 게이트웨이가 "규칙 점수로 전환" 신호를 남겼고, 실행은 오케스트레이터가 했다
    assert any(e.to_mode == "rule_score" for e in trace.of_type(FallbackEvent))


def test_c1_timeout_falls_back_to_rule_scores() -> None:
    orchestrator, _, _ = _build(score_llm=SlowLlm())

    outcome = orchestrator.generate(_request(), 20_000, _TRACE_ID, _NOW)

    assert outcome.scoring_mode is ScoringMode.RULE
    assert outcome.solution is not None
    assert any("timeout" in d.reason for d in outcome.degradations)


def test_c1_worker_exception_is_observed_by_orchestrator() -> None:
    """게이트웨이 밖에서 터진 실패 — 아무도 이벤트를 못 냈으니 조립이 낸다 (침묵 금지)."""
    orchestrator, trace, _ = _build(store_value=object())  # 재조회 결과 타입 위반

    outcome = orchestrator.generate(_request(), 20_000, _TRACE_ID, _NOW)

    assert outcome.scoring_mode is ScoringMode.RULE
    assert outcome.solution is not None
    events = _orchestrator_events(trace)
    assert any(e.reason.startswith("score_error") for e in events)
    assert any(e.to_mode == "rule_score" for e in events)


def test_gate_dropped_all_falls_back_to_rule_scores() -> None:
    """전량 드롭(환각만 반환) → 게이트웨이 폴백 신호 → 규칙 점수."""
    orchestrator, _, _ = _build(score_llm=FakeLlm(_scores_json("ghost-1", "ghost-2")))

    outcome = orchestrator.generate(_request(), 20_000, _TRACE_ID, _NOW)

    assert outcome.scoring_mode is ScoringMode.RULE
    assert _slot_ids(outcome) <= _POOL_IDS
    assert PoiId("ghost-1") not in _slot_ids(outcome)


def test_empty_pool_skips_llm_and_still_returns_itinerary() -> None:
    orchestrator, _, _ = _build(pois=_FAR_POIS)

    outcome = orchestrator.generate(_request(), 20_000, _TRACE_ID, _NOW)

    assert outcome.status is GenerationStatus.DEGRADED
    assert outcome.candidate_count == 0
    assert any(d.reason == "empty_pool" for d in outcome.degradations)
    assert outcome.solution is not None
    assert outcome.solution.solve_mode is SolveMode.MINIMAL


def test_explanation_failure_keeps_itinerary() -> None:
    orchestrator, _, _ = _build(expl_llm=FailingLlm())

    outcome = orchestrator.generate(_request(), 20_000, _TRACE_ID, _NOW)

    assert outcome.status is GenerationStatus.DEGRADED
    assert outcome.solution is not None                # 설명 실패는 일정을 죽이지 않는다
    assert outcome.explanations == ()
    assert any(d.stage == "explanation" for d in outcome.degradations)


# ── ③ 이중 폴백 금지 ────────────────────────────────────────────────


def test_solver_degradation_recorded_without_duplicate_event() -> None:
    """C2 체인 강등은 C2가 이미 관측했다 — 조립은 결과에만 싣고 재발행하지 않는다."""
    orchestrator, trace, sink = _build(primary=False)  # 규칙 폴백만 남긴 체인

    outcome = orchestrator.generate(_request(), 20_000, _TRACE_ID, _NOW)

    assert outcome.status is GenerationStatus.DEGRADED
    assert outcome.solution is not None
    assert outcome.solution.solve_mode is SolveMode.RULE_FALLBACK
    assert any(
        d.stage == "solver" and d.reason.startswith("solver_degraded")
        for d in outcome.degradations
    )
    # 조립은 solver 단계 이벤트를 하나도 내지 않았다 (폴백률 이중 계수 방지)
    assert [e for e in _orchestrator_events(trace) if e.stage == "solver"] == []
    assert len(sink.problems) == 1                     # 재시도 없음 — solve 호출 1회


# ── ④ 시한 배분 ─────────────────────────────────────────────────────


def test_allocate_day1_and_full_budgets() -> None:
    cfg = OrchestratorConfig()

    day1 = allocate(5_000, cfg)
    full = allocate(20_000, cfg)

    assert (day1.m7_ms, day1.c1_ms, day1.c2_reserved_ms) == (750, 1_750, 2_500)
    assert (full.m7_ms, full.c1_ms, full.c2_reserved_ms) == (1_000, 2_500, 10_000)
    for b in (day1, full):
        assert b.c2_reserved_ms > 0
        assert b.m7_ms + b.c1_ms + b.c2_reserved_ms <= b.total_ms


def test_short_deadline_skips_c1_but_still_returns_itinerary() -> None:
    """정상 소유 요청은 시한 스킵 시에도 규칙 점수로 성공 (TRIP-333 회귀 가드)."""
    orchestrator, trace, sink = _build()

    outcome = orchestrator.generate(_request(), 500, _TRACE_ID, _NOW)

    assert outcome.scoring_mode is ScoringMode.RULE      # LLM 부를 시간이 없다
    assert outcome.solution is not None                  # 그래도 결과는 나온다
    assert any(d.reason.startswith("deadline") for d in outcome.degradations)
    assert any(
        e.reason.startswith("deadline") for e in _orchestrator_events(trace)
    )
    assert sink.deadlines[0] > 0                         # C2 예산은 0 이하가 아니다


def test_c2_gets_reserved_budget_even_when_upstream_burns_everything() -> None:
    """상류가 전체 예산을 다 태워도 C2는 예약분을 받는다 (항상 최소 일정 방지)."""
    orchestrator, _, sink = _build(clock=_BurningClock(step_ms=10_000))

    outcome = orchestrator.generate(_request(), 5_000, _TRACE_ID, _NOW)

    assert sink.deadlines[0] == 2_500                     # = c2_reserved_ms
    assert outcome.solution is not None


@settings(max_examples=100, deadline=None)
@given(total=st.integers(min_value=-50_000, max_value=200_000))
def test_pbt_allocate_never_starves_c2(total: int) -> None:
    """어떤 전체 예산에서도 C2 몫은 양수(전체가 양수인 한)이고 합은 예산을 넘지 않는다."""
    b = allocate(total, OrchestratorConfig())

    assert b.m7_ms + b.c1_ms + b.c2_reserved_ms <= max(0, total)
    assert b.c2_reserved_ms > 0 or total <= 0


# ── ⑤ day1 2단계 (TRIP-293) ─────────────────────────────────────────


def test_day1_two_phase_passes_subset_and_exclusions_through() -> None:
    orchestrator, _, sink = _build()
    excluded = frozenset({PoiId("p1")})

    outcome = orchestrator.generate(
        _request(days=(_DAY1,), excluded=excluded), 5_000, _TRACE_ID, _NOW
    )

    problem = sink.problems[0]
    assert problem.days == (_DAY1,)                       # 부분집합 그대로
    assert problem.excluded_poi_ids == excluded           # 제외 목록 그대로
    assert PoiId("p1") not in _slot_ids(outcome)          # 기배정 POI 재배정 없음
    assert outcome.solution is not None


# ── ⑥ INV-1 우회 차단 ───────────────────────────────────────────────


def test_out_of_pool_score_cannot_enter_candidates() -> None:
    """게이트가 깨져 풀 밖 poi_id가 통과해도 조립이 재교차해 걸러낸다."""
    orchestrator, trace, sink = _build(score_gate=_BypassGate())

    outcome = orchestrator.generate(_request(), 20_000, _TRACE_ID, _NOW)

    assert outcome.scoring_mode is ScoringMode.RULE        # 전량 탈락 → 규칙 점수
    assert all(
        c.poi_id in _POOL_IDS for c in sink.problems[0].candidates
    )
    assert PoiId("hallucinated") not in _slot_ids(outcome)
    assert any(
        e.reason.startswith("closed_set_recheck_dropped")
        for e in _orchestrator_events(trace)
    )


# ── ⑦ 명시적 실패 · PBT ─────────────────────────────────────────────


def test_permission_violation_fails_instead_of_silently_degrading() -> None:
    """D31 — 권한 위반은 폴백 대상이 아니다. 규칙 점수로 "성공한 척" 하지 않는다."""
    orchestrator, trace, sink = _build()
    foreign = ResourceRef(kind="persona", ref_id="persona-9", owner_id="someone-else")

    outcome = orchestrator.generate(
        _request(persona_ref=foreign), 20_000, _TRACE_ID, _NOW
    )

    assert outcome.status is GenerationStatus.FAILED
    assert outcome.solution is None
    assert outcome.error is not None
    assert outcome.error.startswith("permission_denied")
    assert sink.problems == []                             # 솔버까지 가지 않았다
    assert any(
        e.reason.startswith("permission_denied") for e in _orchestrator_events(trace)
    )


def test_short_deadline_with_foreign_persona_still_fails_403() -> None:
    """TRIP-333 fail-closed — DL-2 시한 스킵 경로에서도 남의 persona_ref는 403.

    500ms면 C1 점수 단계가 통째로 스킵되어 페르소나를 읽지 않지만(접근 시점 검사
    부재), 소유 검증은 조립 진입에서 ContextResolver 갈래로 강제되므로 규칙 점수
    일정이 나가지 않고 FAILED(permission_denied → 경계 403)로 수렴한다.
    """
    orchestrator, trace, sink = _build()
    foreign = ResourceRef(kind="persona", ref_id="persona-9", owner_id="someone-else")

    outcome = orchestrator.generate(
        _request(persona_ref=foreign), 500, _TRACE_ID, _NOW
    )

    assert outcome.status is GenerationStatus.FAILED
    assert outcome.solution is None
    assert outcome.error is not None
    assert outcome.error.startswith("permission_denied")
    assert outcome.scoring_mode is not ScoringMode.LLM
    assert sink.problems == []                             # 솔버까지 가지 않았다
    assert any(
        e.reason.startswith("permission_denied") for e in _orchestrator_events(trace)
    )


@settings(max_examples=100, deadline=None)
@given(deadline_ms=st.integers(min_value=-5_000, max_value=60_000))
def test_pbt_foreign_persona_always_403_regardless_of_deadline(
    deadline_ms: int,
) -> None:
    """TRIP-333 — 권한 위반 요청은 deadline이 어떤 값이어도 PermissionDeniedError 경로.

    시한이 넉넉하면 C1 접근 시점에서, 짧아 스킵되면 조립 진입 소유 검증에서 —
    어느 쪽이든 결과는 동일하게 FAILED(permission_denied)다 (fail-closed).
    """
    orchestrator, _, sink = _build()
    foreign = ResourceRef(kind="persona", ref_id="persona-9", owner_id="someone-else")

    outcome = orchestrator.generate(
        _request(persona_ref=foreign), deadline_ms, _TRACE_ID, _NOW
    )

    assert outcome.status is GenerationStatus.FAILED
    assert outcome.solution is None
    assert outcome.error is not None
    assert outcome.error.startswith("permission_denied")
    assert sink.problems == []                             # 어떤 시한에서도 솔버 미도달


def test_contradictory_fixed_blocks_return_explicit_failure() -> None:
    """모순 입력(같은 POI 고정 블록 2개) → 침묵이 아니라 명시적 실패."""
    orchestrator, trace, _ = _build()
    conflicting = (
        FixedBlock(
            poi_id=PoiId("p1"),
            window=TimeWindow(
                datetime(2026, 8, 5, 10, 0, tzinfo=_KST),
                datetime(2026, 8, 5, 11, 0, tzinfo=_KST),
            ),
            reason="user_fixed",
        ),
        FixedBlock(
            poi_id=PoiId("p1"),
            window=TimeWindow(
                datetime(2026, 8, 5, 13, 0, tzinfo=_KST),
                datetime(2026, 8, 5, 14, 0, tzinfo=_KST),
            ),
            reason="user_fixed",
        ),
    )

    outcome = orchestrator.generate(
        _request(fixed_blocks=conflicting), 20_000, _TRACE_ID, _NOW
    )

    assert outcome.status is GenerationStatus.FAILED
    assert outcome.error is not None
    assert outcome.error.startswith("solver_conflict")
    assert any(
        e.reason.startswith("solver_conflict") for e in _orchestrator_events(trace)
    )


_FAILURE_MODES = (
    "ok",
    "llm_error",
    "llm_timeout",
    "garbage",
    "hallucination",
    "bypass_gate",
    "empty_pool",
    "bad_persona",
    "permission",
)


@settings(max_examples=120, deadline=None)
@given(
    mode=st.sampled_from(_FAILURE_MODES),
    deadline_ms=st.integers(min_value=-5_000, max_value=30_000),
    n_days=st.integers(min_value=1, max_value=3),
    excluded=st.sets(st.sampled_from(["p1", "p2", "p3"]), max_size=3),
    explain=st.booleans(),
)
def test_pbt_generate_never_raises_and_always_converges(
    mode: str, deadline_ms: int, n_days: int, excluded: set[str], explain: bool
) -> None:
    """어떤 (실패 모드, 시한, 일자, 제외집합)에서도 예외가 밖으로 나오지 않는다 (INV-4).

    결과는 항상 둘 중 하나: 일정이 실린 outcome, 또는 error가 실린 FAILED.
    어느 쪽이든 배치된 POI는 후보 풀 안이다 (INV-1).
    """
    orchestrator, _, _ = _build(
        score_llm={
            "llm_error": FailingLlm(),
            "llm_timeout": SlowLlm(),
            "garbage": FakeLlm("not json at all"),
            "hallucination": FakeLlm(_scores_json("ghost")),
        }.get(mode),
        score_gate=_BypassGate() if mode == "bypass_gate" else None,
        pois=_FAR_POIS if mode == "empty_pool" else _POIS,
        store_value=object() if mode == "bad_persona" else _PERSONA,
        expl_llm=FakeLlm(_explanations_json("p1", "p2", "p3")) if explain else None,
    )
    request = _request(
        days=tuple(_DAY1 + timedelta(days=k) for k in range(n_days)),
        excluded=frozenset(PoiId(x) for x in excluded),
        persona_ref=(
            ResourceRef(kind="persona", ref_id="x", owner_id="intruder")
            if mode == "permission"
            else _PERSONA_REF
        ),
    )

    outcome = orchestrator.generate(request, deadline_ms, _TRACE_ID, _NOW)

    assert isinstance(outcome, GenerationOutcome)
    if outcome.status is GenerationStatus.FAILED:
        assert outcome.solution is None and outcome.error
        assert outcome.degradations                        # 사유가 반드시 남는다
    else:
        assert outcome.solution is not None
        assert _slot_ids(outcome) <= _POOL_IDS             # INV-1
        assert (outcome.status is GenerationStatus.SUCCESS) == (
            not outcome.degradations
        )
    if mode == "permission":
        # TRIP-333 fail-closed (팀 결정 2026-08-11): 남의 persona_ref는 deadline이
        # 어떤 값이어도 항상 PermissionDeniedError 경로(FAILED → 경계 403)다.
        # DL-2 시한 스킵으로 C1이 통째로 건너뛰어져도 예외가 아니다 — 소유 검증은
        # 접근 시점이 아니라 조립 진입(⓪)에서 ContextResolver 갈래로 강제된다.
        assert outcome.status is GenerationStatus.FAILED
        assert outcome.error is not None
        assert outcome.error.startswith("permission_denied")
    # 봉투 부가 필드 정합 (TRIP-341): solved_at ⇔ 해 존재, 풀 실측은 지어내지 않는다
    assert (outcome.solved_at is not None) == (outcome.solution is not None)
    if outcome.status is not GenerationStatus.FAILED:
        assert outcome.candidates_summary is not None
        assert outcome.candidates_summary.pool_size == (
            0 if mode == "empty_pool" else 3
        )


# ── ⑧ 봉투 부가 필드 — candidates_summary·solved_at (TRIP-341) ────────


_BOUNDARY_CATEGORIES = tuple(c for c in PoiCategory if c is not PoiCategory.STAY)


def test_candidates_summary_reports_pool_facts_low_level() -> None:
    """풀 3건 전부 SIGHT → LOW + 나머지 7개 카테고리가 부족 목록에 실린다."""
    orchestrator, _, _ = _build()

    outcome = orchestrator.generate(_request(), 20_000, _TRACE_ID, _NOW)

    summary = outcome.candidates_summary
    assert summary is not None
    assert summary.pool_size == 3                      # len(pool.pois) 실측
    assert summary.level == "LOW"
    assert set(summary.shortfall_categories) == {
        c.value for c in _BOUNDARY_CATEGORIES if c is not PoiCategory.SIGHT
    }


def test_candidates_summary_ok_when_every_category_present() -> None:
    pois = tuple(
        _poi(i, 0.001 * i, category=c)
        for i, c in enumerate(_BOUNDARY_CATEGORIES, start=1)
    )
    ids = tuple(f"p{i}" for i in range(1, len(pois) + 1))
    orchestrator, _, _ = _build(score_llm=FakeLlm(_scores_json(*ids)), pois=pois)

    outcome = orchestrator.generate(_request(), 20_000, _TRACE_ID, _NOW)

    summary = outcome.candidates_summary
    assert summary is not None
    assert summary.level == "OK"
    assert summary.pool_size == len(pois)
    assert summary.shortfall_categories == ()


def test_candidates_summary_no_candidates_on_empty_pool() -> None:
    orchestrator, _, _ = _build(pois=_FAR_POIS)  # 전부 반경 밖 → 풀 0건

    outcome = orchestrator.generate(_request(), 20_000, _TRACE_ID, _NOW)

    summary = outcome.candidates_summary
    assert summary is not None
    assert summary.level == "NO_CANDIDATES"
    assert summary.pool_size == 0                      # 실측 0 — "모름"(None)이 아니다
    assert set(summary.shortfall_categories) == {c.value for c in _BOUNDARY_CATEGORIES}


def test_solved_at_derives_from_injected_now_not_wall_clock() -> None:
    """solved_at = 주입 now + 단조시계 경과 — 정지 시계(경과 0)면 정확히 now다."""
    orchestrator, _, _ = _build()  # FakeClock: monotonic 경과 0

    outcome = orchestrator.generate(_request(), 20_000, _TRACE_ID, _NOW)

    assert outcome.status is GenerationStatus.SUCCESS
    assert outcome.solved_at == _NOW                   # wall-clock 미개입 (DL-3)


def test_solver_conflict_failure_keeps_pool_facts_but_no_solved_at() -> None:
    """모순 고정 블록 FAILED — 해가 없으니 solved_at=None, 풀 실측 보고는 유지."""
    conflicting = (
        FixedBlock(
            poi_id=PoiId("p1"),
            window=TimeWindow(
                datetime(2026, 8, 5, 10, 0, tzinfo=_KST),
                datetime(2026, 8, 5, 11, 0, tzinfo=_KST),
            ),
            reason="user_fixed",
        ),
        FixedBlock(
            poi_id=PoiId("p1"),
            window=TimeWindow(
                datetime(2026, 8, 5, 13, 0, tzinfo=_KST),
                datetime(2026, 8, 5, 14, 0, tzinfo=_KST),
            ),
            reason="user_fixed",
        ),
    )
    orchestrator, _, _ = _build()

    outcome = orchestrator.generate(
        _request(fixed_blocks=conflicting), 20_000, _TRACE_ID, _NOW
    )

    assert outcome.status is GenerationStatus.FAILED
    assert outcome.solved_at is None                   # 검증 시각을 지어내지 않는다
    assert outcome.candidates_summary is not None      # 풀은 실제로 만들었다
    assert outcome.candidates_summary.pool_size == 3
