"""U2 — LLM 2차 솔버 · RepairEngine · warm-start.

증명하는 것:
  ① golden      : 유효 제안 → LLM 해 채택 + LlmCallRecord 계측
  ② INV-1 (2차) : 후보 밖 유령 id 제안 → 드롭 + GateDropEvent, 유효분만 생존
  ③ 강건성      : 깨진 JSON·타임아웃 → None → 체인이 규칙 폴백으로 (침묵 없음)
  ④ repair      : HC2 위반 제안을 시각 이동으로 수리해 채택 (출처 LLM 보존)
  ⑤ U5-P2      : warm-start — locked 슬롯 시각 불변 + 재실행 멱등
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

from hypothesis import given, settings

from trippilot.c2.config import SolverConfig
from trippilot.c2.facade import HybridSolverFacade
from trippilot.c2.fallback_solver import RuleFallbackSolver
from trippilot.c2.llm_solver import LlmSolver
from trippilot.c2.ortools_solver import OrToolsSolver
from trippilot.c2.travel import TravelEstimator
from trippilot.domain.common import (
    BudgetLevel,
    GeoPoint,
    PoiId,
    ScheduleId,
    TransportMode,
)
from trippilot.domain.itinerary import ItineraryProblem, SolveMode, TimeWindow
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.observability import GateDropEvent, LlmCallRecord
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.domain.prompt import PromptRef

from tests.fakes.fake_clock import FakeClock
from tests.fakes.fake_llm import FakeLlm, SlowLlm
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.generators.solver import solver_setups

_KST = timezone(timedelta(hours=9))
_CFG = SolverConfig(or_tools_limit_ms=1000, or_tools_min_ms=50)
_EST = TravelEstimator(_CFG)
_REF = PromptRef("prompts/solver_secondary.yaml", "0.1.0", "solver_secondary")


def _poi(pid: str, lat: float, lng: float) -> Poi:
    return Poi(PoiId(pid), pid, PoiCategory.SIGHT, GeoPoint(lat, lng),
               (), None, None, DataQuality.FULL, PoiSource.SEED, None)


def _setup():
    a, b = _poi("a", 37.75, 128.87), _poi("b", 37.79, 128.92)
    problem = ItineraryProblem(
        schedule_id=ScheduleId("s"), days=(date(2026, 8, 5),),
        candidates=(ScoredPoi(a.poi_id, 0.9, True), ScoredPoi(b.poi_id, 0.7, True)),
        fixed_blocks=(), budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=TimeWindow(datetime(2026, 8, 5, 9, 0, tzinfo=_KST),
                              datetime(2026, 8, 5, 21, 0, tzinfo=_KST)),
        seed=7)
    return problem, {a.poi_id: a, b.poi_id: b}


def _canned(slots: list[dict]) -> str:
    return json.dumps({"days": [{"date": "2026-08-05", "slots": slots}]})


def _llm_stage(llm, index, trace):
    return LlmSolver(llm, index, _EST, _CFG, trace, _REF, "claude-sonnet-5")


# ① golden — 유효 제안 채택 + 계측
def test_golden_proposal_accepted_as_llm() -> None:
    problem, index = _setup()
    trace = InMemoryTrace()
    llm = FakeLlm(canned=_canned([
        {"poi_id": "a", "start": "2026-08-05T10:00:00+09:00",
         "end": "2026-08-05T11:15:00+09:00"}]))
    stage = _llm_stage(llm, index, trace)

    result = stage.solve(problem, remaining_ms=5000)

    assert result is not None and result.solve_mode == SolveMode.LLM
    assert [str(s.poi_id) for d in result.days for s in d.slots] == ["a"]
    records = trace.of_type(LlmCallRecord)
    assert len(records) == 1 and records[0].success is True
    assert records[0].model_id == "claude-sonnet-5"  # AI-D07 ④ 경로별 모델


# ② INV-1 — 유령 id 드롭 + GateDropEvent
def test_ghost_poi_dropped_with_gate_event() -> None:
    problem, index = _setup()
    trace = InMemoryTrace()
    llm = FakeLlm(canned=_canned([
        {"poi_id": "유령맛집", "start": "2026-08-05T10:00:00+09:00",
         "end": "2026-08-05T11:00:00+09:00"},
        {"poi_id": "a", "start": "2026-08-05T12:00:00+09:00",
         "end": "2026-08-05T13:15:00+09:00"}]))

    result = _llm_stage(llm, index, trace).solve(problem, 5000)

    assert result is not None
    assert [str(s.poi_id) for d in result.days for s in d.slots] == ["a"]  # 유효분만
    drops = trace.of_type(GateDropEvent)
    assert len(drops) == 1
    assert drops[0].dropped_ids == (PoiId("유령맛집"),)
    assert drops[0].total_count == 2 and drops[0].dropped_count == 1


# ③ 강건성 — 깨진 JSON / 타임아웃 → None, 체인이 규칙 폴백
def test_broken_json_falls_back_through_chain() -> None:
    problem, index = _setup()
    trace = InMemoryTrace()
    chain = [_llm_stage(FakeLlm(canned="이건 JSON이 아님"), index, trace),
             RuleFallbackSolver(index, _EST, _CFG)]
    facade = HybridSolverFacade(chain, index, _EST, FakeClock(), trace)

    result = facade.solve(problem, deadline_ms=10_000)

    assert result.solve_mode == SolveMode.RULE_FALLBACK
    assert facade.validate(result, problem) == []


def test_llm_timeout_is_observed_and_falls_back() -> None:
    problem, index = _setup()
    trace = InMemoryTrace()
    stage = _llm_stage(SlowLlm(), index, trace)

    assert stage.solve(problem, 5000) is None
    records = trace.of_type(LlmCallRecord)
    assert len(records) == 1 and records[0].success is False  # 실패도 계측 (침묵 금지)


# ④ repair — HC2 위반 제안을 시각 이동으로 수리 (출처 보존)
def test_hc2_violating_proposal_is_repaired() -> None:
    problem, index = _setup()
    trace = InMemoryTrace()
    # a(~11:15) 직후 11:20에 b 시작 — a→b 이동시간(수십 분) 부족 → HC2 위반 → 수리 대상
    llm = FakeLlm(canned=_canned([
        {"poi_id": "a", "start": "2026-08-05T10:00:00+09:00",
         "end": "2026-08-05T11:15:00+09:00"},
        {"poi_id": "b", "start": "2026-08-05T11:20:00+09:00",
         "end": "2026-08-05T12:20:00+09:00"}]))
    stage = _llm_stage(llm, index, trace)

    result = stage.solve(problem, 5000)

    assert result is not None and result.solve_mode == SolveMode.LLM
    slots = [s for d in result.days for s in d.slots]
    assert len(slots) == 2
    travel = _EST.estimate(index[PoiId("a")].coord, index[PoiId("b")].coord,
                           problem.transport).internal_minutes
    gap = int((slots[1].start_at - slots[0].end_at).total_seconds() // 60)
    assert gap >= travel  # 수리로 HC2 충족
    facade = HybridSolverFacade([], index, _EST, FakeClock(), trace)
    assert facade.validate(result, problem) == []


# ⑤ U5-P2 — warm-start: locked 보존 + 멱등
@settings(max_examples=10, deadline=None)
@given(setup=solver_setups())
def test_regenerate_preserves_locked_and_is_idempotent(setup) -> None:
    problem, index = setup
    trace = InMemoryTrace()
    chain = [OrToolsSolver(index, _EST, _CFG), RuleFallbackSolver(index, _EST, _CFG)]
    facade = HybridSolverFacade(chain, index, _EST, FakeClock(), trace)

    first = facade.solve(problem, deadline_ms=5000)
    locked = [s for d in first.days for s in d.slots][:1]  # 첫 슬롯을 잠금
    if not locked:
        return  # 빈 해 — 잠글 것 없음

    regen1 = facade.regenerate(problem, locked, deadline_ms=5000)
    regen2 = facade.regenerate(problem, locked, deadline_ms=5000)

    kept = [s for d in regen1.days for s in d.slots
            if s.poi_id == locked[0].poi_id]
    assert kept and kept[0].start_at == locked[0].start_at  # 시각 불변
    assert kept[0].end_at == locked[0].end_at
    assert regen1 == regen2  # 멱등 (U5-P2)
    assert facade.validate(regen1, problem) == []
