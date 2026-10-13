"""② 점수 단계의 잔여는 어셈블리 바닥(`c2_reserved_ms`)을 **뺀** 값이다 (2026-10-13 DEV 재계획 504 실측).

재계획은 에이전트 앞에서 PlanB 가 예산의 절반(실측 11.6s)을 쓴다. 종전엔 점수 호출에 전체 잔여
(25s − 11.6s = 13.4s)를 그대로 줘서 호출이 그만큼 기다린 뒤 어셈블리가 바닥 5s 를 또 쓰고,
합 30s > 시한 25s → 미들웨어 백스톱 504 → 백엔드 "수동 편집 전환". 다른 단계(⓪·②′·②⁗)는
이미 바닥을 빼고 있었다 — 점수만 빠져 있었다. 생성 경로(에이전트가 t0 에 시작)는 결과가 같다
(20s: min(14s, 20−0−5=15s) = 14s — `test_score_stage_cap_reaches_gateway_call_timeout`)."""

from __future__ import annotations

from trippilot.agents.schedule.agent import ScheduleAgent
from trippilot.agents.schedule.outcome import ScoringMode
from trippilot.llm_gateway.gates.scoring import ClosedSetGate
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.workers.preference import PreferenceScoringWorker

from tests.fakes.fake_clock import FakeClock
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.test_schedule_agent import _pool, _task
from tests.test_schedule_coordinator import (
    _C1CFG, _AssemblyProvider, _RecordingLlm, _Renderer, _Sink, _scores_json,
)

_TOTAL_MS = 25_000       # 재계획 시한 (BE → AI deadline_ms)
_RESERVED_MS = 5_000     # allocate(25_000): c2_reserved = min(25_000, 5_000, max(1_000, 12_500))


def _agent(clock: FakeClock):
    trace, sink = InMemoryTrace(), _Sink()
    llm = _RecordingLlm(_scores_json("p1", "p2", "p3"))
    agent = ScheduleAgent(
        PreferenceScoringWorker(GatewayFacade(llm, _Renderer(), ClosedSetGate(), _C1CFG, trace)),
        _AssemblyProvider(trace, sink, primary=True), clock, trace)
    return agent, llm, sink


def test_scoring_timeout_leaves_the_assembly_reserve() -> None:
    """앞 단계가 11.6s 를 쓴 뒤 들어오면 점수 호출 시한은 25 − 11.6 − 5 = 8.4s 다 (종전 13.4s).

    그래야 점수가 최악(타임아웃)이어도 어셈블리가 바닥 5s 를 쓰고 25s 안에 끝난다."""
    agent, llm, sink = _agent(FakeClock(start_ms=11_600))

    outcome = agent.run(_task(_pool(), started_ms=0, total_ms=_TOTAL_MS))

    assert outcome.scoring_mode is ScoringMode.LLM
    assert [r.timeout_sec for r in llm.requests] == [(_TOTAL_MS - 11_600 - _RESERVED_MS) / 1000]
    assert sink.deadlines[0] >= _RESERVED_MS  # 어셈블리 바닥은 그대로 보장된다


def test_scoring_is_skipped_when_only_the_reserve_is_left() -> None:
    """잔여가 바닥만 남았으면(또는 c1_min_ms 미만) 부르지 않고 규칙 점수로 — 타임아웃만 기다리는
    호출은 시한을 넘기는 길이지 품질이 아니다(DL-2, 침묵 스킵 금지 → 강등 사유에 잔여를 적는다)."""
    agent, llm, _ = _agent(FakeClock(start_ms=_TOTAL_MS - _RESERVED_MS - 300))

    outcome = agent.run(_task(_pool(), started_ms=0, total_ms=_TOTAL_MS))

    assert llm.requests == []
    assert outcome.scoring_mode is ScoringMode.RULE
    assert outcome.solution is not None
    assert any(d.reason.startswith("deadline:c1_budget") and "remaining=300ms" in d.reason
               for d in outcome.degradations)
