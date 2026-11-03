"""`ScheduleTask.rule_only` — 취향을 규칙 점수(`taste_fit`)로만 매긴다 (편집 ①b 날마다 동네, 2026-11-03).

편집 시한(BE 8s − 왕복 여유)에 취향 LLM 점수는 못 든다. 그렇다고 취향을 버리면(종전 `persona=None`) 날 재구성이 취향과 무관하게
뽑았다. 증명하는 것(실 LLM 0):
  ① 시한이 넉넉해도 점수 워커를 부르지 않는다 — 강등도 아니라 FallbackEvent 가 없다(`llm_composed` 와 같은 처리)
  ② 규칙 점수에 취향이 실린다 — 취향 카테고리 후보만 `taste_fit` 만큼 오른다(다시 짜기 #1793 과 같은 규칙)
  ③ 끄면 종전 그대로 — 같은 시한·같은 페르소나면 점수 워커를 부른다
"""

from __future__ import annotations

from dataclasses import replace

import pytest

from tests.agents.schedule.test_schedule_agent import _persona, _pool, _task
from tests.fakes.fake_clock import FakeClock
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.orchestrator.schedule.test_schedule_coordinator import _AssemblyProvider, _Sink
from trippilot.agents.schedule import agent as schedule_agent
from trippilot.agents.schedule.agent import ScheduleAgent
from trippilot.agents.schedule.outcome import ScoringMode
from trippilot.assembly_engine.scorer import taste_fit
from trippilot.domain.observability import FallbackEvent
from trippilot.domain.poi.poi import PoiCategory


class _CountingScorer:
    """점수 워커 대역 — 불리면 센다(불리면 안 되는 길에서 실패로 드러난다)."""

    def __init__(self) -> None:
        self.calls = 0

    def capacity_for(self, timeout_sec):
        return 1_000

    def score(self, pool, persona, trace_id, now, *, timeout_sec=None):
        self.calls += 1
        raise RuntimeError("점수 LLM 을 부르면 안 되는 길")


def _run(rule_only: bool, persona):
    scorer, trace = _CountingScorer(), InMemoryTrace()
    agent = ScheduleAgent(scorer, _AssemblyProvider(trace, _Sink(), primary=True), FakeClock(), trace)
    outcome = agent.run(replace(_task(_pool(), persona=persona, total_ms=20_000), rule_only=rule_only))
    return outcome, scorer, trace


def test_rule_only_never_calls_the_scorer_and_is_not_a_degradation() -> None:
    outcome, scorer, trace = _run(True, _persona(activities=("카페",)))
    assert scorer.calls == 0
    assert outcome.scoring_mode is ScoringMode.RULE and outcome.solution is not None
    assert [e for e in trace.of_type(FallbackEvent) if e.stage == "llm"] == []


def test_rule_only_scores_carry_the_taste(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, float] = {}
    real = schedule_agent.build_rule_score

    def spy(poi, *a, **kw):
        score = real(poi, *a, **kw)
        seen[str(poi.poi_id)] = kw.get("taste", frozenset())
        return score

    monkeypatch.setattr(schedule_agent, "build_rule_score", spy)
    _run(True, _persona(activities=("카페",)))
    assert seen and set(seen.values()) == {frozenset({PoiCategory.CAFE})}
    assert taste_fit(PoiCategory.CAFE, frozenset({PoiCategory.CAFE})) > 0  # 카페가 실제로 오른다


def test_off_keeps_the_old_road() -> None:
    _, scorer, trace = _run(False, _persona(activities=("카페",)))
    assert scorer.calls == 1  # 시한이 넉넉하고 페르소나가 있으면 종전대로 점수 워커를 부른다
    assert any(e.reason.startswith("score_error") for e in trace.of_type(FallbackEvent) if e.stage == "llm")
