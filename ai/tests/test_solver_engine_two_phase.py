"""U2 — day1 2단계 생성 지원: 기배정 POI 제외 (TRIP-293).

증명하는 것:
  ① 직렬화     : excluded_poi_ids 왕복 + 키 없는 기존 payload 하위호환 (U5-P10 계열)
  ② 무회귀     : 제외가 비면 솔버 3종 결과가 기존과 완전히 동일
  ③ 제외 존중  : 제외된 POI는 어느 일자에도 없음 (OR-Tools · 규칙 폴백 · LLM 2차)
  ④ PBT       : 임의 problem × 임의 제외 부분집합 → 배치 ∩ 제외 = ∅ (고정 블록 제외)
                 이면서 여전히 HC1~HC4 통과
  ⑤ 2단계 시뮬 : 1차(day1) 결과 poi_id를 2차 제외로 넘기면 전체 POI 중복 0
  ⑥ INV-1 불변 : 제외는 후보 풀 축소일 뿐 — closed-set 게이트를 우회하지 않는다
"""

from __future__ import annotations

import json
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone

from hypothesis import assume, given, settings
from hypothesis import strategies as st

from trippilot.solver_engine.config import SolverConfig
from trippilot.solver_engine.constraints import check_all
from trippilot.solver_engine.facade import HybridSolverFacade
from trippilot.solver_engine.fallback_solver import RuleFallbackSolver
from trippilot.solver_engine.llm_solver import LlmSolver
from trippilot.solver_engine.ortools_solver import OrToolsSolver
from trippilot.solver_engine.travel import TravelEstimator
from trippilot.domain.common import (
    BudgetLevel,
    GeoPoint,
    PoiId,
    ScheduleId,
    TransportMode,
)
from trippilot.domain.itinerary import ItineraryProblem, SolveMode, TimeWindow
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.observability import GateDropEvent
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.domain.prompt import PromptRef
from trippilot.ports.llm_port import LlmRequest, LlmResponse

from tests.fakes.fake_clock import FakeClock
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.generators.solver import solver_setups

_KST = timezone(timedelta(hours=9))
_CFG = SolverConfig(or_tools_limit_ms=1000, or_tools_min_ms=50)
_EST = TravelEstimator(_CFG)
_REF = PromptRef("prompts/solver_secondary.yaml", "0.1.0", "solver_secondary")


# ── 픽스처 ────────────────────────────────────────────────
def _poi(pid: str, lat: float, lng: float) -> Poi:
    return Poi(PoiId(pid), pid, PoiCategory.SIGHT, GeoPoint(lat, lng),
               (), None, None, DataQuality.FULL, PoiSource.SEED, None)


def _fixture(days: tuple[date, ...] = (date(2026, 8, 5),)):
    """후보 3개(a·b·c) / 고정 블록 없음 — 제외 효과만 관측되는 최소 세트."""
    pois = [_poi("a", 37.75, 128.87), _poi("b", 37.76, 128.88),
            _poi("c", 37.77, 128.89)]
    d0 = days[0]
    problem = ItineraryProblem(
        schedule_id=ScheduleId("s"), days=days,
        candidates=tuple(ScoredPoi(p.poi_id, 0.9 - 0.1 * i, True)
                         for i, p in enumerate(pois)),
        fixed_blocks=(), budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=TimeWindow(datetime(d0.year, d0.month, d0.day, 9, 0, tzinfo=_KST),
                              datetime(d0.year, d0.month, d0.day, 21, 0, tzinfo=_KST)),
        seed=7)
    return problem, {p.poi_id: p for p in pois}


def _placed(solution) -> list[PoiId]:
    return [s.poi_id for d in solution.days for s in d.slots]


class RecordingLlm:
    """LlmPort fake — 프롬프트를 기록한다 (제외 POI 미노출 검증용)."""

    def __init__(self, canned: str) -> None:
        self._canned = canned
        self.last_prompt: str | None = None

    def invoke(self, request: LlmRequest) -> LlmResponse:
        self.last_prompt = request.prompt
        return LlmResponse(raw_text=self._canned, input_tokens=1, output_tokens=1,
                           latency_ms=1, model_id=request.model_id)


def _canned(slots: list[dict], day: str = "2026-08-05") -> str:
    return json.dumps({"days": [{"date": day, "slots": slots}]})


def _llm_stage(llm, index, trace) -> LlmSolver:
    return LlmSolver(llm, index, _EST, _CFG, trace, _REF, "claude-sonnet-5")


# ① 직렬화 왕복 + 하위호환 ────────────────────────────────
def test_excluded_poi_ids_roundtrip() -> None:
    problem, _ = _fixture()
    p = replace(problem, excluded_poi_ids=frozenset({PoiId("a"), PoiId("c")}))
    d = p.to_dict()
    assert d["excluded_poi_ids"] == ["a", "c"]  # JSON 원시 타입 + 정렬 = 결정론
    json.dumps(d)  # 직렬화 가능해야 한다
    assert ItineraryProblem.from_dict(d) == p


def test_excluded_defaults_to_empty_and_old_payload_still_reads() -> None:
    problem, _ = _fixture()
    assert problem.excluded_poi_ids == frozenset()
    legacy = problem.to_dict()
    del legacy["excluded_poi_ids"]  # 키가 없던 기존 직렬화본
    assert ItineraryProblem.from_dict(legacy) == problem


# ② 무회귀 — 제외가 비면 기존 동작과 동일 ────────────────
@settings(max_examples=15, deadline=None)
@given(setup=solver_setups())
def test_empty_exclusion_is_identical_to_before(setup) -> None:
    problem, index = setup
    empty = replace(problem, excluded_poi_ids=frozenset())

    assert (RuleFallbackSolver(index, _EST, _CFG).solve(problem)
            == RuleFallbackSolver(index, _EST, _CFG).solve(empty))
    ort = OrToolsSolver(index, _EST, _CFG)
    assert ort.solve(problem, 1500) == ort.solve(empty, 1500)


def test_empty_exclusion_keeps_llm_prompt_and_gate_unchanged() -> None:
    problem, index = _fixture()
    canned = _canned([{"poi_id": "a", "start": "2026-08-05T10:00:00+09:00",
                       "end": "2026-08-05T11:15:00+09:00"}])
    base_llm, empty_llm = RecordingLlm(canned), RecordingLlm(canned)
    base = _llm_stage(base_llm, index, InMemoryTrace()).solve(problem, 5000)
    empty = _llm_stage(empty_llm, index, InMemoryTrace()).solve(
        replace(problem, excluded_poi_ids=frozenset()), 5000)

    assert base == empty
    assert base_llm.last_prompt == empty_llm.last_prompt


# ③ 제외 존중 — 솔버 3종 ─────────────────────────────────
def test_rule_fallback_never_places_excluded_poi() -> None:
    problem, index = _fixture()
    excluded = frozenset({PoiId("a")})
    solution = RuleFallbackSolver(index, _EST, _CFG).solve(
        replace(problem, excluded_poi_ids=excluded))

    assert PoiId("a") not in _placed(solution)
    assert set(_placed(solution)) == {PoiId("b"), PoiId("c")}  # 나머지는 그대로 배치


def test_ortools_never_places_excluded_poi() -> None:
    problem, index = _fixture()
    excluded = frozenset({PoiId("a"), PoiId("b")})
    solution = OrToolsSolver(index, _EST, _CFG).solve(
        replace(problem, excluded_poi_ids=excluded), remaining_ms=1500)

    assert solution is not None
    assert set(_placed(solution)) & excluded == set()
    assert PoiId("c") in _placed(solution)


def test_llm_solver_never_places_excluded_poi() -> None:
    problem, index = _fixture()
    trace = InMemoryTrace()
    # LLM이 제외된 a를 제안해도 반환 해에 남으면 안 된다
    llm = RecordingLlm(_canned([
        {"poi_id": "a", "start": "2026-08-05T10:00:00+09:00",
         "end": "2026-08-05T11:15:00+09:00"},
        {"poi_id": "c", "start": "2026-08-05T13:00:00+09:00",
         "end": "2026-08-05T14:15:00+09:00"}]))

    result = _llm_stage(llm, index, trace).solve(
        replace(problem, excluded_poi_ids=frozenset({PoiId("a")})), 5000)

    assert result is not None
    assert _placed(result) == [PoiId("c")]
    assert '"a"' not in llm.last_prompt  # 프롬프트 후보 목록에서도 빠진다


# ⑥ INV-1 — 제외는 closed-set 게이트를 우회하지 않는다 ──
def test_excluded_proposal_is_gate_dropped_and_observed() -> None:
    problem, index = _fixture()
    trace = InMemoryTrace()
    llm = RecordingLlm(_canned([
        {"poi_id": "a", "start": "2026-08-05T10:00:00+09:00",
         "end": "2026-08-05T11:15:00+09:00"},
        {"poi_id": "유령맛집", "start": "2026-08-05T15:00:00+09:00",
         "end": "2026-08-05T16:00:00+09:00"},
        {"poi_id": "c", "start": "2026-08-05T13:00:00+09:00",
         "end": "2026-08-05T14:15:00+09:00"}]))

    result = _llm_stage(llm, index, trace).solve(
        replace(problem, excluded_poi_ids=frozenset({PoiId("a")})), 5000)

    assert result is not None and _placed(result) == [PoiId("c")]
    drops = trace.of_type(GateDropEvent)  # 침묵 드롭 금지 — 관측 발행 유지
    assert len(drops) == 1
    assert set(drops[0].dropped_ids) == {PoiId("a"), PoiId("유령맛집")}
    assert drops[0].total_count == 3 and drops[0].dropped_count == 2


# ④ PBT — 임의 제외 부분집합 ─────────────────────────────
def _draw_excluded(data, problem) -> frozenset[PoiId]:
    ids = sorted({str(c.poi_id) for c in problem.candidates})
    if not ids:
        return frozenset()
    chosen = data.draw(st.lists(st.sampled_from(ids), unique=True, max_size=len(ids)))
    return frozenset(PoiId(x) for x in chosen)


def _fixed_ids(problem) -> set[PoiId]:
    """고정 블록(HC3)은 제외보다 우선 — 그 POI만 제외 집합과 교집합이 허용된다."""
    return {fb.poi_id for fb in problem.fixed_blocks
            if fb.window.start.date() in set(problem.days)}


@settings(max_examples=60, deadline=None)
@given(setup=solver_setups(), data=st.data())
def test_pbt_rule_fallback_respects_exclusion_and_stays_valid(setup, data) -> None:
    problem, index = setup
    p = replace(problem, excluded_poi_ids=_draw_excluded(data, problem))

    solution = RuleFallbackSolver(index, _EST, _CFG).solve(p)

    assert set(_placed(solution)) & p.excluded_poi_ids <= _fixed_ids(p)
    assert check_all(solution, p, index, _EST) == []  # HC1~HC4 유지


@settings(max_examples=25, deadline=None)
@given(setup=solver_setups(), data=st.data())
def test_pbt_ortools_respects_exclusion_and_stays_valid(setup, data) -> None:
    problem, index = setup
    p = replace(problem, excluded_poi_ids=_draw_excluded(data, problem))

    solution = OrToolsSolver(index, _EST, _CFG).solve(p, remaining_ms=1500)
    if solution is None:  # 시간창 불가 등 — 체인이 처리할 영역
        return

    assert set(_placed(solution)) & p.excluded_poi_ids <= _fixed_ids(p)
    assert check_all(solution, p, index, _EST) == []


# ⑤ 2단계 생성 시뮬레이션 — 호출 간 POI 중복 0 ───────────
def test_two_phase_generation_has_no_duplicate_poi() -> None:
    problem, index = _fixture(days=(date(2026, 8, 5), date(2026, 8, 6)))
    facade = HybridSolverFacade(
        [OrToolsSolver(index, _EST, _CFG), RuleFallbackSolver(index, _EST, _CFG)],
        index, _EST, FakeClock(), InMemoryTrace())

    # 1차: day1만 (deadline 5,000ms — D38)
    phase1 = facade.solve(replace(problem, days=problem.days[:1]), deadline_ms=5000)
    assigned = frozenset(_placed(phase1))
    # 2차: 나머지 일자 + 1차 배정분 제외
    phase2 = facade.solve(
        replace(problem, days=problem.days[1:], excluded_poi_ids=assigned),
        deadline_ms=60_000)

    merged = _placed(phase1) + _placed(phase2)
    assert len(merged) == len(set(merged))  # 두 호출을 합쳐도 중복 0
    assert set(_placed(phase2)) & assigned == set()
    assert facade.validate(phase1, replace(problem, days=problem.days[:1]),
                           deadline_ms=1000) == []
    assert facade.validate(phase2, replace(problem, days=problem.days[1:]),
                           deadline_ms=1000) == []


@settings(max_examples=25, deadline=None)
@given(setup=solver_setups())
def test_pbt_two_phase_matches_single_call_uniqueness(setup) -> None:
    problem, index = setup
    assume(len(problem.days) >= 2)
    chain = [OrToolsSolver(index, _EST, _CFG), RuleFallbackSolver(index, _EST, _CFG)]
    facade = HybridSolverFacade(chain, index, _EST, FakeClock(), InMemoryTrace())

    p1 = replace(problem, days=problem.days[:1])
    phase1 = facade.solve(p1, deadline_ms=5000)
    assigned = frozenset(_placed(phase1))
    p2 = replace(problem, days=problem.days[1:], excluded_poi_ids=assigned)
    phase2 = facade.solve(p2, deadline_ms=60_000)

    merged = _placed(phase1) + _placed(phase2)
    assert len(merged) == len(set(merged))  # 1회 호출과 동일한 "POI 1회 방문" 성질
    assert facade.validate(phase1, p1, deadline_ms=1000) == []
    assert facade.validate(phase2, p2, deadline_ms=1000) == []


def test_two_phase_solve_mode_is_still_honest() -> None:
    """제외를 주더라도 출처 태깅(INV-2/INV-4)은 그대로."""
    problem, index = _fixture()
    solution = OrToolsSolver(index, _EST, _CFG).solve(
        replace(problem, excluded_poi_ids=frozenset({PoiId("a")})), 1500)
    assert solution is not None
    assert solution.solve_mode == SolveMode.OR_TOOLS and solution.is_fallback is False
