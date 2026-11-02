"""액티비티 취향이면 도로 1.0km 까지 걷는다 — 2026-10-19 사용자("활동적인 사람은 상한을 조금 더 올려도
되는데 1.1km 이상에선 도보로 가게 하지 마").

증명하는 것:
  ① 에이전트가 취향으로 상한을 정한다 — 액티비티 취향이면 1.0km 로 조립을 짓고 결과에 싣는다, 아니면 None
  ② 공급자는 그 상한의 추정기로 조립하고(`walker`), 화면 거리 감싸개(`WalkFirst`)가 같은 판정을 한다 —
     상한 안의 대중교통 구간은 걷기, 밖은 원래 포트(실경로)로 넘긴다
"""

from __future__ import annotations

from trippilot.assembly_engine.config import ACTIVE_WALK_MAX_KM, WALK_HARD_MAX_KM, AssemblyConfig
from trippilot.assembly_engine.travel import WALKED_SOURCE, TravelEstimator, WalkFirst
from trippilot.domain.common import GeoPoint, TransportMode

from tests.agents.schedule.test_schedule_agent import _agent, _persona, _pool, _task
from tests.orchestrator.schedule.test_schedule_coordinator import _AssemblyProvider, _Sink

P = TransportMode.PUBLIC
_CFG = AssemblyConfig()


def _road_north(road_km: float) -> GeoPoint:
    return GeoPoint(37.5 + road_km / _CFG.detour_factor / 111.195, 127.0)


class _Recording(_AssemblyProvider):
    def __init__(self, trace) -> None:
        super().__init__(trace, _Sink(), primary=True)
        self.walk_caps: list = []

    def for_pool(self, poi_index, walk_max_km=None, parking=None):
        self.walk_caps.append(walk_max_km)
        return super().for_pool(poi_index)


# ① ─────────────────────────────────────────────────────────────────────────

def test_activity_taste_raises_the_walk_cap_and_reports_it() -> None:
    from tests.fakes.in_memory_trace import InMemoryTrace
    trace = InMemoryTrace()
    provider = _Recording(trace)
    agent, _, _ = _agent(provider=provider, trace=trace)

    outcome = agent.run(_task(_pool(), persona=_persona(activities=("테마파크",))))

    assert provider.walk_caps == [ACTIVE_WALK_MAX_KM]
    assert outcome.walk_max_km == ACTIVE_WALK_MAX_KM < WALK_HARD_MAX_KM


def test_other_tastes_keep_the_default_cap() -> None:
    from tests.fakes.in_memory_trace import InMemoryTrace
    trace = InMemoryTrace()
    provider = _Recording(trace)
    agent, _, _ = _agent(provider=provider, trace=trace)

    outcome = agent.run(_task(_pool(), persona=_persona(activities=("역사문화",))))

    assert provider.walk_caps == [None]
    assert outcome.walk_max_km is None


# ② ─────────────────────────────────────────────────────────────────────────

class _Port:
    def __init__(self) -> None:
        self.calls = 0

    def estimate(self, from_, to, mode):
        self.calls += 1
        return TravelEstimator(_CFG).estimate(from_, to, mode)


def test_walk_first_walks_inside_the_cap_and_defers_outside() -> None:
    walker = TravelEstimator(AssemblyConfig(public_walk_max_km=ACTIVE_WALK_MAX_KM))
    port = _Port()
    wrapped = WalkFirst(port, walker)
    origin = _road_north(0.0)

    assert wrapped.estimate(origin, _road_north(0.9), P).source == WALKED_SOURCE   # 기본이면 대중교통인 거리
    assert port.calls == 0                                                        # 걷는 구간은 실경로를 안 부른다
    assert wrapped.estimate(origin, _road_north(1.05), P).source != WALKED_SOURCE
    assert port.calls == 1


def test_provider_builds_the_assembly_with_the_requested_cap() -> None:
    from trippilot.api.wiring import ChainAssemblyProvider
    from tests.fakes.fake_clock import FakeClock
    from tests.fakes.in_memory_trace import InMemoryTrace

    provider = ChainAssemblyProvider(TravelEstimator(_CFG), FakeClock(), InMemoryTrace(), _CFG)
    origin = _road_north(0.0)

    assert provider.walker(None).estimate(origin, _road_north(0.9), P).source != WALKED_SOURCE
    assert provider.walker(ACTIVE_WALK_MAX_KM).estimate(origin, _road_north(0.9), P).source == WALKED_SOURCE
