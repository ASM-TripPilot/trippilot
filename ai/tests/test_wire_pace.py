"""경계 어휘 `pace` 가 도메인까지 오는가 (TRIP-906).

받아만 놓고 안 쓰던 값이라, 잠그는 것은 "번역된다"가 아니라 **"끝까지 도달한다"** 다.
"""

from __future__ import annotations

import pytest

from trippilot.api.wiring import _PACE_TOKENS, _pace_from
from trippilot.domain.common import PACE_TOKENS, Pace

# 백엔드 `PreferenceSet.PACES` 정본 3종
BACKEND_PACES = ("느긋하게", "균형있게", "알차게")


class _Prof:
    def __init__(self, pace):
        self.pace = pace


class _Req:
    def __init__(self, pace):
        self.preference_profile = _Prof(pace)


@pytest.mark.parametrize("label", BACKEND_PACES)
def test_every_backend_pace_is_translated(label: str) -> None:
    assert _pace_from(_Req(label)) is not None, f"{label!r} 이 번역표에 없다"


def test_backend_paces_map_in_order() -> None:
    got = [_pace_from(_Req(x)) for x in BACKEND_PACES]
    assert got == [Pace.SLOW, Pace.BALANCED, Pace.PACKED]


@pytest.mark.parametrize("value", [None, "", "  ", "모르는속도"])
def test_unset_or_unknown_is_none_not_a_neutral_default(value) -> None:
    """미설정은 BALANCED 가 아니다 — 고른 사람과 안 고른 사람을 구분한다.

    예산(`_budget_from`)이 미인식을 MID 로 떨어뜨리는 것과 의도적으로 다르다.
    """
    assert _pace_from(_Req(value)) is None


def test_wiring_and_domain_share_one_table() -> None:
    """표가 두 벌이면 한쪽만 고쳐 어긋난다."""
    assert _PACE_TOKENS is PACE_TOKENS


# ── 도달 — 값이 어셈블리까지 오는가 ─────────────────────────────────────────
#
# 이 파일에서 제일 중요한 것은 번역이 아니라 **도달**이다. pace 는 경계에 도착해
# 있었는데도 소비처가 0이라 아무 일도 안 했다 — 번역만 잠그면 같은 상태로 되돌아가도
# 테스트는 초록이다.

from dataclasses import replace as _replace  # noqa: E402

from trippilot.agents.schedule.agent import ScheduleAgent, ScheduleTask  # noqa: E402
from trippilot.agents.schedule.budget import OrchestratorConfig, allocate  # noqa: E402
from trippilot.llm_gateway.gates.scoring import ClosedSetGate  # noqa: E402
from trippilot.llm_gateway.gateway import GatewayFacade  # noqa: E402
from trippilot.llm_gateway.workers.preference import PreferenceScoringWorker  # noqa: E402
from trippilot.poi_curation.config import M7Config  # noqa: E402
from trippilot.poi_curation.pool_builder import CandidatePoolBuilder  # noqa: E402
from trippilot.domain.poi_curation import CandidatePoolRequest  # noqa: E402

from tests.fakes.fake_clock import FakeClock  # noqa: E402
from tests.fakes.fake_llm import FakeLlm  # noqa: E402
from tests.fakes.in_memory_poi import InMemoryPoi  # noqa: E402
from tests.fakes.in_memory_trace import InMemoryTrace  # noqa: E402
from tests.test_schedule_coordinator import (  # noqa: E402
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


class _ProblemCapturingProvider:
    """어셈블리 퍼사드를 감싸 `solve` 가 받은 ItineraryProblem 을 붙잡는다."""

    def __init__(self, inner) -> None:
        self._inner = inner
        self.problems = []

    def for_pool(self, poi_index):
        facade = self._inner.for_pool(poi_index)
        outer = self

        class _Spy:
            def __getattr__(self, name):
                return getattr(facade, name)

            def solve(self, problem, *a, **kw):
                outer.problems.append(problem)
                return facade.solve(problem, *a, **kw)

        return _Spy()


def _run_with_pace(pace):
    trace = InMemoryTrace()
    provider = _ProblemCapturingProvider(_AssemblyProvider(trace, _Sink(), primary=True))
    gateway = GatewayFacade(FakeLlm(_scores_json("p1", "p2", "p3")), _Renderer(),
                            ClosedSetGate(), _C1CFG, trace)
    agent = ScheduleAgent(PreferenceScoringWorker(gateway), provider, FakeClock(), trace)

    req = _replace(_request(), pace=pace)
    pool = CandidatePoolBuilder(InMemoryPoi(_POIS), M7Config()).build(
        CandidatePoolRequest(anchor=req.anchor, dates=req.days,
                             budget=req.budget, transport=req.transport),
        _NOW,
    )
    agent.run(ScheduleTask(
        request=req,
        pool=pool, persona=_PERSONA, daily_rain=None, event_bonus=None,
        candidates_summary=None,
        budget=allocate(20_000, OrchestratorConfig()),
        started_ms=0, trace_id=_TRACE_ID, now=_NOW, prior_degradations=()))
    return provider.problems


@pytest.mark.parametrize("pace", [None, *list(Pace)])
def test_pace_reaches_the_assembly_problem(pace) -> None:
    problems = _run_with_pace(pace)
    assert problems, "어셈블리가 한 번도 안 불렸다 — 테스트 전제가 깨졌다"
    assert all(p.pace is pace for p in problems), (
        f"요청의 pace={pace} 가 어셈블리까지 안 왔다: {[p.pace for p in problems]}")
