"""ScheduleAgent 단독 계약 — 오케스트레이터 없이 `run(ScheduleTask)` 만으로 (agents/schedule/).

파이프라인 e2e·폴백 계단·시한 배분은 `test_itinerary_orchestrator.py` 가 오케스트레이터
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
from tests.test_itinerary_orchestrator import (
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


def _agent(*, provider=None, clock=None, trace=None):
    trace = trace if trace is not None else InMemoryTrace()
    sink = _Sink()
    gateway = GatewayFacade(FakeLlm(_scores_json("p1", "p2", "p3")), _Renderer(),
                            ClosedSetGate(), _C1CFG, trace)
    agent = ScheduleAgent(
        PreferenceScoringWorker(gateway),
        provider if provider is not None else _AssemblyProvider(trace, sink, primary=True),
        clock if clock is not None else FakeClock(),
        trace,
    )
    return agent, trace, sink


def _task(pool, *, persona=_PERSONA, started_ms=0, total_ms=20_000, prior=()):
    return ScheduleTask(
        request=_request(),
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
