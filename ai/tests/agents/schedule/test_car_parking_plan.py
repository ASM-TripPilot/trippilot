"""자차 여행이면 에이전트가 주차 거점 계획을 공급자에게 받아 조립에 넘기고 결과에 싣는다 — 2026-10-21 사용자
("어느 정도 가까우면 걸어가게 하고 주차했던 곳으로 돌아가게").

증명하는 것:
  ① 자차 요청: `parking_for(풀, 도보 상한)` 한 번 → 같은 계획이 `for_pool` 과 결과(`outcome.parking`)에 실린다
     (화면 거리 감싸개가 결과의 계획으로 같은 이름표를 붙인다)
  ② 대중교통 요청: 계획을 만들지 않는다(None)
"""

from __future__ import annotations

from dataclasses import replace

from trippilot.assembly_engine.parking import plan_parking
from trippilot.domain.common import TransportMode

from tests.agents.schedule.test_schedule_agent import _agent, _pool, _request, _task
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.orchestrator.schedule.test_schedule_coordinator import _AssemblyProvider, _Sink


class _Recording(_AssemblyProvider):
    def __init__(self, trace) -> None:
        super().__init__(trace, _Sink(), primary=True)
        self.asked: list = []
        self.passed: list = []

    def parking_for(self, poi_index, walk_max_km):
        plan = plan_parking((p.coord for p in poi_index.values()),
                            walk_max_km=walk_max_km if walk_max_km is not None else 0.7, detour_factor=1.3)
        self.asked.append((walk_max_km, plan))
        return plan

    def for_pool(self, poi_index, walk_max_km=None, parking=None):
        self.passed.append(parking)
        return super().for_pool(poi_index)


def test_자차_요청은_주차_계획을_받아_조립과_결과에_같이_싣는다() -> None:
    trace = InMemoryTrace()
    provider = _Recording(trace)
    agent, _, _ = _agent(provider=provider, trace=trace)

    outcome = agent.run(_task(_pool(), request=replace(_request(), transport=TransportMode.CAR)))

    assert len(provider.asked) == 1 and provider.asked[0][0] is None  # 액티비티 취향이 아니면 설정 기본 상한
    plan = provider.asked[0][1]
    assert provider.passed == [plan] and outcome.parking is plan


def test_대중교통_요청은_주차_계획이_없다() -> None:
    trace = InMemoryTrace()
    provider = _Recording(trace)
    agent, _, _ = _agent(provider=provider, trace=trace)

    outcome = agent.run(_task(_pool()))

    assert provider.asked == [] and provider.passed == [None] and outcome.parking is None
