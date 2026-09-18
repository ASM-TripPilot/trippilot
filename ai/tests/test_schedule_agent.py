"""ScheduleAgent 단독 계약 — 오케스트레이터 없이 `run(ScheduleTask)` 만으로 (agents/schedule/).

파이프라인 e2e·폴백 계단·시한 배분은 `test_schedule_coordinator.py` 가 코디네이터
경유로 전부 덮는다. 여기서는 **추출로 새로 생긴 경계**만 증명한다:
  ① run()은 예외를 던지지 않는다 — 어셈블리 공급자가 터져도 FAILED + 에이전트 이름의
     error 접두사로 수렴 (DL-5·INV-4)
  ② 오케스트레이터가 넘긴 prior_degradations 는 결과 status 에 합산된다 (침묵 금지 —
     수집 단계 강등이 봉투를 건너며 사라지지 않는다)
  ③ 에이전트 자기 결정 강등은 component="agents.schedule" 로 발행된다 (Reflect 선례)
  ④ 에이전트는 시계 원점을 오케스트레이터와 공유한다 — 잔여 예산이 started_ms 기준
     (TRIP-376 배분이 추출 전과 같은 값으로 관통)
"""

from __future__ import annotations

from trippilot.agents.schedule.agent import ScheduleAgent, ScheduleTask
from trippilot.agents.schedule.budget import OrchestratorConfig, allocate
from trippilot.agents.schedule.outcome import (
    Degradation,
    GenerationStatus,
    ScoringMode,
    candidates_report,
)
from trippilot.domain.observability import FallbackEvent
from trippilot.domain.poi_curation import CandidatePoolRequest
from trippilot.llm_gateway.gates.scoring import ClosedSetGate
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.workers.preference import PreferenceScoringWorker
from trippilot.poi_curation.config import M7Config
from trippilot.poi_curation.pool_builder import CandidatePoolBuilder

from tests.fakes.fake_clock import FakeClock
from tests.fakes.fake_llm import FakeLlm
from tests.fakes.in_memory_poi import InMemoryPoi
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.test_schedule_coordinator import (
    _C1CFG,
    _NOW,
    _PERSONA,
    _POIS,
    _TRACE_ID,
    _AssemblyProvider,
    _Renderer,
    _Sink,
    _request,
    _scores_json,
)


class _ExplodingProvider:
    """어셈블리 공급자가 설정 버그로 터지는 상황 — 에이전트 경계 밖 예외."""

    def for_pool(self, poi_index):
        raise RuntimeError("assembly provider misconfigured")


def _pool():
    req = _request()
    return CandidatePoolBuilder(InMemoryPoi(_POIS), M7Config()).build(
        CandidatePoolRequest(anchor=req.anchor, dates=req.days,
                             budget=req.budget, transport=req.transport),
        _NOW,
    )


def _agent(*, provider=None, clock=None, trace=None, alt_explainer=None):
    trace = trace if trace is not None else InMemoryTrace()
    sink = _Sink()
    gateway = GatewayFacade(FakeLlm(_scores_json("p1", "p2", "p3")), _Renderer(),
                            ClosedSetGate(), _C1CFG, trace)
    agent = ScheduleAgent(
        PreferenceScoringWorker(gateway),
        provider if provider is not None else _AssemblyProvider(trace, sink, primary=True),
        clock if clock is not None else FakeClock(),
        trace,
        alternative_explanation_worker=alt_explainer,
    )
    return agent, trace, sink


def _task(pool, *, persona=_PERSONA, started_ms=0, total_ms=20_000, prior=(), request=None):
    return ScheduleTask(
        request=request if request is not None else _request(),
        pool=pool,
        persona=persona,
        daily_rain=None,
        event_bonus=None,
        candidates_summary=candidates_report(pool),
        budget=allocate(total_ms, OrchestratorConfig()),
        started_ms=started_ms,
        trace_id=_TRACE_ID,
        now=_NOW,
        prior_degradations=tuple(prior),
    )


# ── ① 무예외 수렴 ───────────────────────────────────────────────────


def test_run_never_raises_and_names_itself_in_error() -> None:
    agent, trace, _ = _agent(provider=_ExplodingProvider())

    outcome = agent.run(_task(_pool()))

    assert outcome.status is GenerationStatus.FAILED
    assert outcome.solution is None
    assert (outcome.error or "").startswith("schedule_agent_error: RuntimeError")
    assert outcome.candidates_summary is not None  # 풀은 이미 알던 사실 — 잃지 않는다
    agent_events = [e for e in trace.of_type(FallbackEvent) if e.component == "agents.schedule"]
    assert any(e.stage == "agent" and e.reason == outcome.error for e in agent_events)


# ── ② 수집 단계 강등이 결과에 합산 ───────────────────────────────────


def test_prior_degradations_fold_into_status() -> None:
    agent, _, _ = _agent()
    prior = (Degradation(stage="weather", reason="weather_error: TimeoutError"),)

    outcome = agent.run(_task(_pool(), prior=prior))

    assert outcome.solution is not None
    assert outcome.status is GenerationStatus.DEGRADED  # 에이전트 단계는 전부 정상이었다
    assert prior[0] in outcome.degradations
    assert outcome.scoring_mode is ScoringMode.LLM


def test_no_prior_and_no_own_degradation_is_success() -> None:
    agent, _, _ = _agent()

    outcome = agent.run(_task(_pool()))

    assert outcome.status is GenerationStatus.SUCCESS
    assert outcome.degradations == ()


# ── ③ 발행자 이름 ────────────────────────────────────────────────────


def test_own_degradation_is_emitted_as_agents_schedule() -> None:
    agent, trace, _ = _agent()

    outcome = agent.run(_task(_pool(), persona=None))  # 페르소나 비가용 → 규칙 점수

    assert outcome.scoring_mode is ScoringMode.RULE
    events = [e for e in trace.of_type(FallbackEvent)
              if e.stage == "llm" and e.reason.startswith("persona_unavailable")]
    assert [e.component for e in events] == ["agents.schedule"]


# ── ④ 시계 원점 공유 ─────────────────────────────────────────────────


def test_remaining_budget_is_measured_from_started_ms() -> None:
    """오케스트레이터가 4s 를 이미 썼다면(started_ms=0, 시계=4_000) 어셈블리는
    잔여 16s 를 받는다 — 에이전트가 자기 시계를 새로 시작하면 20s 가 되어 틀린다."""
    clock = FakeClock(start_ms=4_000)
    agent, _, sink = _agent(clock=clock)

    outcome = agent.run(_task(_pool(), started_ms=0, total_ms=20_000))

    assert outcome.solution is not None
    assert sink.deadlines == [16_000]


# ── ⑤ 슬롯별 차선책 (TRIP-871) ──────────────────────────────────────
#
# 어셈블리가 뽑지 않은 차순위 후보를 슬롯마다 ≤ MAX_SLOT_ALTERNATIVES 건 싣는다.
# 제안만이다 — 시각·순서 없음(INV-2), 풀 안에서만(INV-1), LLM 0회, 결정론.

from dataclasses import replace
from datetime import date as date_type, datetime, timedelta

from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.agents.schedule.agent import pick_slot_alternatives
from trippilot.agents.schedule.outcome import MAX_SLOT_ALTERNATIVES
from trippilot.domain.common import PoiId
from trippilot.domain.itinerary import (
    DaySolution,
    FixedBlock,
    ItinerarySolution,
    SolveMode,
    TimeWindow,
    VisitSlot,
)
from trippilot.domain.llm import CandidatePool, ScoredPoi
from trippilot.domain.poi import OpenHour, PoiCategory
from trippilot.domain.common import ScheduleId

from tests.generators.poi import candidate_pools
from tests.test_schedule_coordinator import _DAY1, _KST, _poi

_WED = _DAY1  # 2026-08-05 = 수요일 (weekday 2)
assert _WED.weekday() == 2


def _solution(day: date_type, placed: tuple[PoiId, ...], *, fixed: tuple[PoiId, ...] = ()) -> ItinerarySolution:
    """배치 순서대로 1시간씩 — 시각 자체는 이 테스트의 관심이 아니다(INV-2 는 사영 테스트 몫)."""
    slots = tuple(
        VisitSlot(
            poi_id=pid,
            start_at=datetime.combine(day, datetime.min.time(), tzinfo=_KST) + timedelta(hours=9 + i),
            end_at=datetime.combine(day, datetime.min.time(), tzinfo=_KST) + timedelta(hours=10 + i),
            stay_min=60, score=0.5, is_llm_score=False,
        )
        for i, pid in enumerate(placed)
    )
    blocks = tuple(
        FixedBlock(poi_id=pid, window=TimeWindow(
            start=datetime.combine(day, datetime.min.time(), tzinfo=_KST) + timedelta(hours=9 + i),
            end=datetime.combine(day, datetime.min.time(), tzinfo=_KST) + timedelta(hours=10 + i),
        ), reason="must")
        for i, pid in enumerate(placed) if pid in fixed
    )
    return ItinerarySolution(
        schedule_id=ScheduleId("s-alt"),
        days=(DaySolution(date=day, slots=slots, fixed_blocks=blocks),),
        is_fallback=False, solve_mode=SolveMode.OR_TOOLS, assembly_run=None,
    )


def _pool_of(*pois):
    return CandidatePool(
        poi_ids=frozenset(p.poi_id for p in pois), pois=tuple(pois), generated_at=_NOW,
    )


def _scored(scores: dict[str, float]) -> tuple[ScoredPoi, ...]:
    return tuple(ScoredPoi(poi_id=PoiId(k), score=v, is_llm_score=True) for k, v in scores.items())


def test_alternatives_rank_same_category_then_score_then_distance_and_skip_closed() -> None:
    """p1(카페) 슬롯의 차선책: 같은 카테고리 우선 → 점수 → 거리. 그 요일 휴무(p5)는 뺀다."""
    here = _poi(1, 0.0, PoiCategory.CAFE)
    far_cafe = _poi(2, 0.050, PoiCategory.CAFE)      # 같은 카테고리, 점수 낮음, 멀다
    near_sight = _poi(3, 0.001, PoiCategory.SIGHT)   # 점수 최고지만 다른 카테고리
    near_cafe = _poi(4, 0.002, PoiCategory.CAFE)     # 같은 카테고리, 점수 높음
    closed_cafe = replace(  # 점수 최고·같은 카테고리지만 그 요일 휴무
        _poi(5, 0.001, PoiCategory.CAFE),
        open_hours=(OpenHour(day_of_week=(_WED.weekday() + 1) % 7, open_min=540, close_min=1260),),
    )
    pool = _pool_of(here, far_cafe, near_sight, near_cafe, closed_cafe)
    scores = _scored({"p1": 0.9, "p2": 0.5, "p3": 0.95, "p4": 0.8, "p5": 0.99})

    picks = pick_slot_alternatives(_solution(_WED, (here.poi_id,)), scores, pool)

    key = f"{_WED.isoformat()}#p1"
    assert list(picks) == [key]
    assert [a.poi_id for a in picks[key]] == [PoiId("p4"), PoiId("p2")]  # 같은 카테고리 2건이 상한을 채운다
    assert picks[key][0].rationale == "같은 카페 후보"


def test_alternatives_break_score_ties_by_distance_then_id() -> None:
    """점수 동률(실 LLM 점수에 흔하다)이면 슬롯 POI 에 가까운 쪽, 거리까지 같으면 poi_id 순."""
    here = _poi(1, 0.0, PoiCategory.SIGHT)
    far = _poi(2, 0.010, PoiCategory.SIGHT)
    near = _poi(3, 0.002, PoiCategory.SIGHT)
    near_twin = _poi(4, 0.002, PoiCategory.SIGHT)  # near 와 같은 좌표 — id 로만 갈린다
    pool = _pool_of(here, far, near, near_twin)
    same = _scored({"p1": 0.9, "p2": 0.9, "p3": 0.9, "p4": 0.9})

    picks = pick_slot_alternatives(_solution(_WED, (here.poi_id,)), same, pool, limit=3)

    assert [a.poi_id for a in picks[f"{_WED.isoformat()}#p1"]] == [PoiId("p3"), PoiId("p4"), PoiId("p2")]


def test_alternatives_fall_back_to_other_categories_and_label_them() -> None:
    here = _poi(1, 0.0, PoiCategory.CAFE)
    sight = _poi(3, 0.001, PoiCategory.SIGHT)
    pool = _pool_of(here, sight)

    picks = pick_slot_alternatives(_solution(_WED, (here.poi_id,)), _scored({"p1": 0.9, "p3": 0.1}), pool)

    (alt,) = picks[f"{_WED.isoformat()}#p1"]
    assert alt.poi_id == PoiId("p3")
    assert alt.rationale == "주변 명소 후보"


def test_alternatives_skip_fixed_slots_and_excluded_pois() -> None:
    here = _poi(1, 0.0, PoiCategory.CAFE)
    must = _poi(2, 0.001, PoiCategory.CAFE)      # 고정 블록 슬롯 — 사용자 must-visit
    spare = _poi(3, 0.001, PoiCategory.CAFE)
    banned = _poi(4, 0.001, PoiCategory.CAFE)    # 2단계 생성의 기배정 POI
    pool = _pool_of(here, must, spare, banned)
    solution = _solution(_WED, (here.poi_id, must.poi_id), fixed=(must.poi_id,))

    picks = pick_slot_alternatives(
        solution, _scored({"p1": 0.9, "p2": 0.9, "p3": 0.9, "p4": 0.9}), pool,
        excluded=frozenset({banned.poi_id}),
    )

    assert set(picks) == {f"{_WED.isoformat()}#p1"}          # 고정 슬롯 p2 에는 제안하지 않는다
    assert [a.poi_id for a in picks[f"{_WED.isoformat()}#p1"]] == [PoiId("p3")]


@st.composite
def _alt_cases(draw):
    pool = draw(candidate_pools().filter(lambda p: len(p.pois) >= 1))
    ids = sorted(pool.poi_ids, key=str)
    scores = tuple(
        ScoredPoi(poi_id=pid, score=draw(st.floats(0, 1, allow_nan=False)), is_llm_score=True)
        for pid in ids
    )
    placed = tuple(draw(st.lists(st.sampled_from(ids), unique=True, min_size=1, max_size=len(ids))))
    fixed = tuple(draw(st.lists(st.sampled_from(placed), unique=True, max_size=len(placed))))
    excluded = frozenset(draw(st.lists(st.sampled_from(ids), unique=True, max_size=len(ids))))
    day = draw(st.dates(min_value=date_type(2026, 1, 1), max_value=date_type(2027, 12, 31)))
    return pool, scores, _solution(day, placed, fixed=fixed), excluded


@settings(max_examples=150, deadline=None)
@given(_alt_cases())
def test_alternatives_properties(case) -> None:
    """INV-1 ⊆풀 · ∉배치 · ∉제외 · 자기 자신 아님 · 고정 슬롯 없음 · ≤상한 · 중복 없음 · 결정론."""
    pool, scores, solution, excluded = case
    placed = {s.poi_id for d in solution.days for s in d.slots}
    fixed = {b.poi_id for d in solution.days for b in d.fixed_blocks}
    keys = {f"{d.date.isoformat()}#{s.poi_id}" for d in solution.days for s in d.slots
            if s.poi_id not in fixed}

    picks = pick_slot_alternatives(solution, scores, pool, excluded=excluded)

    assert set(picks) <= keys
    # 하한 — 비고정 슬롯이 풀 안에 있고 그 요일 열린 여분 후보가 있으면 반드시 제안한다 (`return {}` 방어)
    index = {p.poi_id: p for p in pool.pois}
    spare = [p for p in pool.pois if p.poi_id not in placed | excluded | fixed]
    for d in solution.days:
        dow = d.date.weekday()
        open_spare = [p for p in spare if not p.open_hours or any(oh.day_of_week == dow for oh in p.open_hours)]
        for s in d.slots:
            if s.poi_id in index and s.poi_id not in fixed and open_spare:
                assert f"{d.date.isoformat()}#{s.poi_id}" in picks
    for key, alts in picks.items():
        ids = [a.poi_id for a in alts]
        assert 1 <= len(ids) <= MAX_SLOT_ALTERNATIVES
        assert len(set(ids)) == len(ids)
        for a in alts:
            assert pool.contains(a.poi_id)
            assert a.poi_id not in placed and a.poi_id not in excluded
            assert a.rationale
    assert picks == pick_slot_alternatives(solution, scores, pool, excluded=excluded)


def test_agent_outcome_carries_slot_alternatives_from_pool_only() -> None:
    """에이전트 경유 — 창을 09–12 로 좁혀 6건 중 2건만 배치되게 하고 차선책을 실값으로 단언한다.

    (기본 창 09–21 이면 6건이 전부 배치돼 차선책이 0건 — 그 상태의 단언은 아무것도 증명하지 않는다.)
    점수: p1~p3 은 FakeLlm 0.9, p4~p6 은 규칙 점수 보충(TRIP-378). 어셈블리가 p4(SIGHT)·p5(CAFE)를
    배치하면 여분은 p1·p2·p3·p6 — p4 의 차선책은 같은 SIGHT 중 점수 순(p6 규칙점수 > 0.9), 동률 0.9 셋은
    p4 와의 거리 순(p3 이 최근접). p5(CAFE)는 같은 카테고리 여분이 없어 "주변 명소 후보"로 내려간다.
    """
    pois = _POIS + (_poi(4, 0.015), _poi(5, 0.020, PoiCategory.CAFE), _poi(6, 0.025))
    req = replace(_request(), day_window=TimeWindow(
        start=datetime(2026, 8, 5, 9, 0, tzinfo=_KST), end=datetime(2026, 8, 5, 12, 0, tzinfo=_KST)))
    pool = CandidatePoolBuilder(InMemoryPoi(pois), M7Config()).build(
        CandidatePoolRequest(anchor=req.anchor, dates=req.days, budget=req.budget, transport=req.transport), _NOW,
    )
    agent, _, _ = _agent()

    outcome = agent.run(_task(pool, request=req))

    assert outcome.solution is not None
    placed = [s.poi_id for d in outcome.solution.days for s in d.slots]
    assert placed == [PoiId("p4"), PoiId("p5")]  # 전제 — 깨지면 아래 단언의 근거가 바뀐 것
    picks = outcome.slot_alternatives
    assert set(picks) == {f"{_WED.isoformat()}#p4", f"{_WED.isoformat()}#p5"}
    assert [(a.poi_id, a.rationale) for a in picks[f"{_WED.isoformat()}#p4"]] == [
        (PoiId("p6"), "같은 명소 후보"), (PoiId("p3"), "같은 명소 후보"),
    ]
    assert [(a.poi_id, a.rationale) for a in picks[f"{_WED.isoformat()}#p5"]] == [
        (PoiId("p6"), "주변 명소 후보"), (PoiId("p3"), "주변 명소 후보"),
    ]
    for alts in picks.values():
        assert len(alts) <= MAX_SLOT_ALTERNATIVES
        assert all(pool.contains(a.poi_id) and a.poi_id not in placed for a in alts)


def test_failed_outcome_has_no_alternatives() -> None:
    agent, _, _ = _agent(provider=_ExplodingProvider())
    outcome = agent.run(_task(_pool()))
    assert outcome.slot_alternatives == {}


# ── ⑥′ 차선책 LLM 문장 (TRIP-887) ──────────────────────────────────

from trippilot.domain.llm import PoiExplanation, TypedResult


class _SpyAltExplainer:
    def __init__(self, texts: dict[str, str] | None = None, *, fallback: bool = False) -> None:
        self.texts, self.fallback, self.calls, self.pairs = texts or {}, fallback, 0, ()

    def explain(self, pool, pairs, persona, trace_id, now, *, timeout_sec=None):
        self.calls += 1
        self.pairs = tuple((str(s), str(a)) for s, a in pairs)
        if self.fallback:
            return TypedResult(value=None, is_fallback=True, error="down", call_record=None)
        return TypedResult(
            value=tuple(PoiExplanation(PoiId(k), v) for k, v in self.texts.items()),
            is_fallback=False, error=None, call_record=None,
        )


def _six_poi_case(*, include_explanations: bool = True):
    """창 09–12 · 풀 6건 → p4(SIGHT)·p5(CAFE) 배치, 차선책은 각각 [p6, p3] (위 테스트와 같은 전제)."""
    pois = _POIS + (_poi(4, 0.015), _poi(5, 0.020, PoiCategory.CAFE), _poi(6, 0.025))
    req = replace(_request(), include_explanations=include_explanations, day_window=TimeWindow(
        start=datetime(2026, 8, 5, 9, 0, tzinfo=_KST), end=datetime(2026, 8, 5, 12, 0, tzinfo=_KST)))
    pool = CandidatePoolBuilder(InMemoryPoi(pois), M7Config()).build(
        CandidatePoolRequest(anchor=req.anchor, dates=req.days, budget=req.budget, transport=req.transport), _NOW,
    )
    return pool, req


def test_alternative_sentences_replace_template_rationale_where_given() -> None:
    pool, req = _six_poi_case()
    spy = _SpyAltExplainer({"p6": "바다 풍경을 좋아하시면 여기도 잘 맞아요."})
    agent, _, _ = _agent(alt_explainer=spy)

    outcome = agent.run(_task(pool, request=req))

    assert [s.poi_id for d in outcome.solution.days for s in d.slots] == [PoiId("p4"), PoiId("p5")]  # 전제
    assert outcome.status is GenerationStatus.SUCCESS  # 문장 일부 부재는 강등이 아니다
    assert spy.calls == 1
    assert set(spy.pairs) == {("p4", "p6"), ("p4", "p3"), ("p5", "p6"), ("p5", "p3")}
    for key in (f"{_WED.isoformat()}#p4", f"{_WED.isoformat()}#p5"):
        by_id = {a.poi_id: a.rationale for a in outcome.slot_alternatives[key]}
        assert by_id[PoiId("p6")] == "바다 풍경을 좋아하시면 여기도 잘 맞아요."  # LLM 문장
        assert by_id[PoiId("p3")].endswith("명소 후보")                          # 템플릿 유지


def test_alternative_sentences_fallback_keeps_template_and_records_degradation() -> None:
    pool, req = _six_poi_case()
    agent, _, _ = _agent(alt_explainer=_SpyAltExplainer(fallback=True))

    outcome = agent.run(_task(pool, request=req))

    assert outcome.status is GenerationStatus.DEGRADED
    assert any(d.stage == "alternative_explanation" for d in outcome.degradations)
    assert all(a.rationale.endswith("명소 후보")
               for alts in outcome.slot_alternatives.values() for a in alts)


def test_alternative_sentences_skipped_when_explanations_not_requested() -> None:
    pool, req = _six_poi_case(include_explanations=False)
    spy = _SpyAltExplainer({"p6": "x"})
    agent, _, _ = _agent(alt_explainer=spy)

    outcome = agent.run(_task(pool, request=req))

    assert spy.calls == 0 and outcome.status is GenerationStatus.SUCCESS  # 요청된 생략 = 강등 아님
    assert outcome.slot_alternatives  # 차선책 자체는 그대로 실린다


def test_alternative_sentences_skipped_without_persona_and_not_double_counted() -> None:
    pool, req = _six_poi_case()
    spy = _SpyAltExplainer({"p6": "x"})
    agent, _, _ = _agent(alt_explainer=spy)

    outcome = agent.run(_task(pool, request=req, persona=None))

    assert spy.calls == 0
    assert not any(d.stage == "alternative_explanation" for d in outcome.degradations)


class _RaisingAltExplainer(_SpyAltExplainer):
    def explain(self, *a, **k):
        self.calls += 1
        raise RuntimeError("cfg bug")


def test_alternative_sentences_deadline_skips_call_and_records_degradation() -> None:
    """잔여 < explanation_min_ms 면 부르지 않는다(DL-2) — 강등 + 이벤트, 템플릿 유지."""
    pool, req = _six_poi_case()
    spy = _SpyAltExplainer({"p6": "x"})
    agent, trace, _ = _agent(alt_explainer=spy)

    # 예산 1초 — 정지 시계라 ⑥′ 잔여가 1000ms < explanation_min_ms(1500). 점수 단계도 같은 이유로
    # 규칙 점수로 내려가지만 여기서 보는 것은 alternative_explanation 스테이지뿐이다.
    outcome = agent.run(_task(pool, request=req, total_ms=1_000))

    assert spy.calls == 0 and outcome.solution is not None
    assert outcome.status is GenerationStatus.DEGRADED
    reasons = [d.reason for d in outcome.degradations if d.stage == "alternative_explanation"]
    assert len(reasons) == 1 and reasons[0].startswith("deadline:remaining=")
    assert any(e.stage == "alternative_explanation" for e in trace.of_type(FallbackEvent))
    assert all(a.rationale.endswith("명소 후보")
               for alts in outcome.slot_alternatives.values() for a in alts)


def test_alternative_sentences_worker_exception_does_not_fail_generation() -> None:
    """부가 정보의 예외가 일정을 FAILED 로 만들면 안 된다 — DEGRADED + 사유, 템플릿 유지."""
    pool, req = _six_poi_case()
    agent, _, _ = _agent(alt_explainer=_RaisingAltExplainer())

    outcome = agent.run(_task(pool, request=req))

    assert outcome.solution is not None and outcome.status is GenerationStatus.DEGRADED
    assert any(d.stage == "alternative_explanation" and d.reason.startswith("explain_error: RuntimeError")
               for d in outcome.degradations)
    assert all(a.rationale.endswith("명소 후보")
               for alts in outcome.slot_alternatives.values() for a in alts)


def test_alternative_sentences_only_for_slot_pois_counts_as_empty() -> None:
    """LLM 이 (프롬프트가 금지한) 확정 장소 설명만 돌려주면 교체 0건 — 침묵이 아니라 강등이다."""
    pool, req = _six_poi_case()
    agent, _, _ = _agent(alt_explainer=_SpyAltExplainer({"p4": "확정 장소 설명"}))

    outcome = agent.run(_task(pool, request=req))

    assert outcome.status is GenerationStatus.DEGRADED
    assert any(d.reason == "alternative_explanation_empty" for d in outcome.degradations)
    assert all(a.rationale.endswith("명소 후보")
               for alts in outcome.slot_alternatives.values() for a in alts)


# ── ②′ 지도 실재 검증 → 점수 강등이 **일정에 닿는다** (TRIP-904) ─────────────
#
# 종전(TRIP-898)엔 풀 빌더가 풀 순서만 바꿔 일정이 그대로였다 — 이 절의 첫 테스트가
# 그 버그의 회귀 가드다. 속성 전수(강등이지 배제 아님·UNVERIFIED 무강등·계약 깨는
# 포트)는 test_schedule_existence_demote.py 가 덮는다.

from tests.fakes.fake_existence import FakeExistence
from trippilot.ports.place_existence_port import ExistenceStatus


def _existence_case():
    """풀 p1..p6(전부 SIGHT·같은 LLM 점수 0.9 는 p1~p3, 나머지는 규칙 보충)·창 09–12 → 2건 배치."""
    pois = tuple(_poi(i, 0.003 * i) for i in range(1, 7))
    req = replace(_request(), day_window=TimeWindow(
        start=datetime(2026, 8, 5, 9, 0, tzinfo=_KST), end=datetime(2026, 8, 5, 12, 0, tzinfo=_KST)))
    pool = CandidatePoolBuilder(InMemoryPoi(pois), M7Config()).build(
        CandidatePoolRequest(anchor=req.anchor, dates=req.days, budget=req.budget, transport=req.transport), _NOW,
    )
    return pool, req


def _agent_with_existence(existence):
    trace = InMemoryTrace()
    gateway = GatewayFacade(FakeLlm(_scores_json("p1", "p2", "p3", "p4", "p5", "p6")), _Renderer(),
                            ClosedSetGate(), _C1CFG, trace)
    return ScheduleAgent(
        PreferenceScoringWorker(gateway), _AssemblyProvider(trace, _Sink(), primary=True),
        FakeClock(), trace, existence=existence,
    ), trace


def _placed(outcome):
    return [str(s.poi_id) for d in outcome.solution.days for s in d.slots]


def test_map_miss_demotion_changes_the_itinerary() -> None:
    """배치될 두 곳을 '지도에 없음'으로 주면 다른 후보로 바뀐다 — 강등이 어셈블리에 닿는다."""
    pool, req = _existence_case()
    base = _agent_with_existence(None)[0].run(_task(pool, request=req))
    first = _placed(base)
    assert len(first) == 2  # 전제

    fake = FakeExistence({pid: ExistenceStatus.NOT_FOUND for pid in first})
    agent, _ = _agent_with_existence(fake)
    outcome = agent.run(_task(pool, request=req))

    assert fake.call_count == 1
    assert not set(_placed(outcome)) & set(first), "지도에서 못 찾은 곳이 그대로 배치됐다"
    assert outcome.status is GenerationStatus.SUCCESS  # 강등은 정상 동작이다 — 폴백 아님


def test_map_miss_is_demotion_not_exclusion() -> None:
    """전 후보가 '지도에 없음'이면 그래도 일정은 채워진다 — 다른 선택지가 없을 때는 쓴다."""
    pool, req = _existence_case()
    base = _placed(_agent_with_existence(None)[0].run(_task(pool, request=req)))
    agent, _ = _agent_with_existence(FakeExistence(default=ExistenceStatus.NOT_FOUND))

    outcome = agent.run(_task(pool, request=req))

    assert _placed(outcome) == base  # 다 같이 깎이면 상대 순서는 그대로다


def test_map_verify_failures_never_fail_or_silently_skip() -> None:
    """포트 예외·전량 확인 실패 → 일정은 그대로 + 강등 기록 (INV-4)."""
    pool, req = _existence_case()
    base = _placed(_agent_with_existence(None)[0].run(_task(pool, request=req)))

    class _Boom:
        def verify(self, queries, *, deadline_ms):
            raise RuntimeError("vendor down")

    for port, prefix in ((_Boom(), "existence_error: RuntimeError"),
                         (FakeExistence(default=ExistenceStatus.UNVERIFIED), "existence_unverified")):
        agent, trace = _agent_with_existence(port)
        outcome = agent.run(_task(pool, request=req))
        assert _placed(outcome) == base
        assert outcome.status is GenerationStatus.DEGRADED
        assert any(d.stage == "existence" and d.reason.startswith(prefix) for d in outcome.degradations)
        assert any(e.stage == "existence" for e in trace.of_type(FallbackEvent))


def test_map_verify_respects_assembly_floor() -> None:
    """어셈블리 바닥을 침범할 시간이 없으면 부르지 않는다 — 건너뛴 사실은 남긴다 (DL-2)."""
    pool, req = _existence_case()
    fake = FakeExistence(default=ExistenceStatus.NOT_FOUND)
    agent, trace = _agent_with_existence(fake)

    outcome = agent.run(_task(pool, request=req, total_ms=1_000))  # 바닥 1000ms = 전부

    assert fake.call_count == 0
    assert any(d.stage == "existence" and d.reason.startswith("deadline:available=")
               for d in outcome.degradations)
    # 결과에만 싣고 이벤트를 빠뜨리면 폴백률 지표에서 이 건너뜀이 안 보인다 (INV-4)
    assert [e.component for e in trace.of_type(FallbackEvent) if e.stage == "existence"] == [
        "agents.schedule"]



def test_map_verify_contract_breaking_port_never_fails_generation() -> None:
    """None·엉뚱한 원소·빈 응답을 돌려주는 포트 → 일정은 그대로 + 강등 기록 (FAILED 아님)."""
    pool, req = _existence_case()
    base = _placed(_agent_with_existence(None)[0].run(_task(pool, request=req)))

    class _Returns:
        def __init__(self, value):
            self.value = value

        def verify(self, queries, *, deadline_ms):
            return self.value

    cases = ((None, "existence_error: TypeError"),
             ([{"poi_id": "p1", "status": "NOT_FOUND"}], "existence_empty_response"),
             ((), "existence_empty_response"))
    for value, prefix in cases:
        agent, trace = _agent_with_existence(_Returns(value))
        outcome = agent.run(_task(pool, request=req))
        assert outcome.solution is not None and _placed(outcome) == base, value
        assert any(d.stage == "existence" and d.reason.startswith(prefix)
                   for d in outcome.degradations), (value, outcome.degradations)
        assert len([e for e in trace.of_type(FallbackEvent) if e.stage == "existence"]) == 1


def test_demotion_never_raises_a_nonpositive_score() -> None:
    """음수 점수(원거리 규칙 점수)는 배율을 곱하면 **올라간다** — 0 이하는 그대로 둔다."""
    from trippilot.agents.schedule.agent import demote_missing_on_map
    from trippilot.domain.llm import ScoredPoi
    from trippilot.ports.place_existence_port import ExistenceVerdict

    cands = (ScoredPoi(PoiId("neg"), -0.1, False), ScoredPoi(PoiId("zero"), 0.0, False),
             ScoredPoi(PoiId("pos"), 0.5, True))
    verdicts = tuple(ExistenceVerdict(c.poi_id, ExistenceStatus.NOT_FOUND) for c in cands)

    out = demote_missing_on_map(cands, verdicts, 0.2, 0.3)

    assert [c.score for c in out] == [-0.1, 0.0, max(0.5 - 0.3, 0.5 * 0.2)]



def test_demotion_does_not_become_exclusion_under_rain_soft_terms() -> None:
    """리뷰 실측 회귀(TRIP-904): 비 오는 날·실외만·전량 미검출이어도 OR-Tools 배치 수는 강등 전과 같다.

    곱셈만 쓰던 첫 안(×0.2)은 0.16 − 0.2(우천 실외 감점) < 0 이라 방문 이득이 음수가 되어
    **대체 후보가 없는데도** 3곳 → 1곳으로 줄었다(사실상 배제 — 9/12 팀 결정 위반).
    """
    from trippilot.agents.schedule.agent import demote_missing_on_map
    from trippilot.assembly_engine.ortools_assembler import OrToolsAssembler
    from trippilot.ports.place_existence_port import ExistenceVerdict
    from tests.test_assembly_engine_rain_adjust import (
        _CFG as _RAIN_CFG, _EST as _RAIN_EST, _POOL_OUTDOOR_ONLY, _RAINY, _problem as _rain_problem,
    )

    cfg = OrchestratorConfig()
    for rain in (None, _RAINY):
        problem, index = _rain_problem(_POOL_OUTDOOR_ONLY, rain=rain)
        verdicts = tuple(ExistenceVerdict(c.poi_id, ExistenceStatus.NOT_FOUND)
                         for c in problem.candidates)
        demoted = replace(problem, candidates=demote_missing_on_map(
            problem.candidates, verdicts,
            cfg.existence_demote_factor, cfg.existence_demote_penalty))

        def visits(p):
            sol = OrToolsAssembler(index, _RAIN_EST, _RAIN_CFG).solve(p, 3000)
            return sum(len(d.slots) for d in sol.days)

        assert visits(demoted) == visits(problem), f"rain={rain}"
