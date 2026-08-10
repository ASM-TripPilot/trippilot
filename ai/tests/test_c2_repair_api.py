"""U2 — repair 공개 경계 · validate/repair 시한 인지 · regenerate 제외 보존 (TRIP-292).

증명하는 것:
  ① repair 공개  : HC2 위반 해 → 퍼사드가 수리 + 재검증 통과 + QualityScore 부착
                   (호출자는 poi_index·estimator를 몰라도 된다 — 승격의 목적)
  ② 수리 불가    : 밀어도 HC4를 못 지키면 repaired=None (계약대로) + 관측 흔적
  ③ 시한(repair) : 잔여 0 → 실행 없이 수리 불가 + FallbackEvent("deadline"),
                   작업이 시한을 넘기면 deadline_exceeded 관측 (DL-5 침묵 금지)
  ④ 시한(validate): 시한이 소진돼도 검증을 생략하지 않되(INV-2) 흔적을 남긴다
  ⑤ regenerate   : excluded_poi_ids가 warm-start 경로에서도 보존 (필드 나열 재구성 소실 회귀)
  ⑥ 무회귀       : llm_solver의 내부 repair 경로(모듈 함수 직접 호출)는 그대로
"""

from __future__ import annotations

import json
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone

from trippilot.c2.config import SolverConfig
from trippilot.c2.facade import HybridSolverFacade
from trippilot.c2.fallback_solver import RuleFallbackSolver
from trippilot.c2.llm_solver import LlmSolver
from trippilot.c2.repair import MinimalChangePolicy
from trippilot.c2.repair import repair as repair_engine
from trippilot.c2.travel import TravelEstimator
from trippilot.domain.common import (
    BudgetLevel,
    GeoPoint,
    PoiId,
    ScheduleId,
    TransportMode,
)
from trippilot.domain.itinerary import (
    DaySolution,
    ItineraryProblem,
    ItinerarySolution,
    QualityScore,
    SolveMode,
    TimeWindow,
    VisitSlot,
)
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.observability import FallbackEvent, SolverRunRecord
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.domain.prompt import PromptRef

from tests.fakes.fake_clock import FakeClock
from tests.fakes.fake_llm import FakeLlm
from tests.fakes.in_memory_trace import InMemoryTrace

_KST = timezone(timedelta(hours=9))
_CFG = SolverConfig(or_tools_limit_ms=1000, or_tools_min_ms=50)
_EST = TravelEstimator(_CFG)
_DAY = date(2026, 8, 5)
_REF = PromptRef("prompts/solver_secondary.yaml", "0.1.0", "solver_secondary")


class TickingClock:
    """monotonic_ms() 호출마다 tick_ms 경과 — 작업 중 시한 초과를 sleep 없이 재현."""

    def __init__(self, tick_ms: int) -> None:
        self._now = 0
        self._tick = tick_ms

    def monotonic_ms(self) -> int:
        now = self._now
        self._now += self._tick
        return now


def _poi(pid: str, lat: float, lng: float) -> Poi:
    return Poi(PoiId(pid), pid, PoiCategory.SIGHT, GeoPoint(lat, lng),
               (), None, None, DataQuality.FULL, PoiSource.SEED, None)


def _setup():
    """a→b 이동 52분(TravelEstimator 실측)인 2후보 문제. day window 09:00~21:00."""
    a, b = _poi("a", 37.75, 128.87), _poi("b", 37.79, 128.92)
    problem = ItineraryProblem(
        schedule_id=ScheduleId("s"), days=(_DAY,),
        candidates=(ScoredPoi(a.poi_id, 0.9, True), ScoredPoi(b.poi_id, 0.7, True)),
        fixed_blocks=(), budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=TimeWindow(datetime(2026, 8, 5, 9, 0, tzinfo=_KST),
                              datetime(2026, 8, 5, 21, 0, tzinfo=_KST)),
        seed=7)
    return problem, {a.poi_id: a, b.poi_id: b}


def _slot(pid: str, h1: int, m1: int, h2: int, m2: int) -> VisitSlot:
    start = datetime(2026, 8, 5, h1, m1, tzinfo=_KST)
    end = datetime(2026, 8, 5, h2, m2, tzinfo=_KST)
    return VisitSlot(poi_id=PoiId(pid), start_at=start, end_at=end,
                     stay_min=int((end - start).total_seconds() // 60),
                     score=0.8, is_llm_score=True)


def _sol(*slots: VisitSlot) -> ItinerarySolution:
    return ItinerarySolution(
        schedule_id=ScheduleId("s"),
        days=(DaySolution(date=_DAY, slots=slots, fixed_blocks=()),),
        is_fallback=False, solve_mode=SolveMode.LLM, solver_run=None)


def _facade(index, clock=None, trace=None, chain=()):
    return HybridSolverFacade(list(chain), index, _EST,
                              clock or FakeClock(), trace or InMemoryTrace())


def _placed(solution: ItinerarySolution) -> list[PoiId]:
    return [s.poi_id for d in solution.days for s in d.slots]


# ── ① repair 공개 경계 — 수리 성공 ────────────────────────────

def test_repair_public_resolves_hc2_violation() -> None:
    problem, index = _setup()
    trace = InMemoryTrace()
    facade = _facade(index, trace=trace)
    # a 종료 11:15 직후 11:20에 b 시작 — 이동 52분 부족 → HC2 위반
    broken = _sol(_slot("a", 10, 0, 11, 15), _slot("b", 11, 20, 12, 20))
    assert facade.validate(broken, problem, deadline_ms=1000) != []

    result = facade.repair(broken, problem, deadline_ms=1000)

    assert result.repaired is not None
    assert facade.validate(result.repaired, problem, deadline_ms=1000) == []
    assert _placed(result.repaired) == [PoiId("a"), PoiId("b")]  # POI·순서 불변
    assert [c.poi_id for c in result.changes] == [PoiId("b")]    # 최소 변경
    records = trace.of_type(SolverRunRecord)
    assert len(records) == 1
    assert records[0].repaired is True and records[0].violations_found == 0
    assert records[0].solve_mode == SolveMode.LLM  # 출처 보존


def test_repair_attaches_quality_score() -> None:
    """공개 반환 해에는 solve()와 동일하게 QualityScore가 붙는다 (TRIP-261)."""
    problem, index = _setup()
    facade = _facade(index)
    broken = _sol(_slot("a", 10, 0, 11, 15), _slot("b", 11, 20, 12, 20))

    repaired = facade.repair(broken, problem, deadline_ms=1000).repaired

    assert repaired is not None and repaired.score is not None
    assert repaired.score.constraint_satisfaction == 1.0  # 반환 해는 위반 0건
    for v in (repaired.score.preference_fit, repaired.score.route_efficiency,
              repaired.score.composite):
        assert 0.0 <= v <= 1.0


def test_repair_of_valid_solution_is_noop() -> None:
    problem, index = _setup()
    facade = _facade(index)
    ok = _sol(_slot("a", 10, 0, 11, 15), _slot("b", 13, 0, 14, 0))

    result = facade.repair(ok, problem, deadline_ms=1000)

    assert result.repaired is not None and result.changes == ()
    assert _placed(result.repaired) == [PoiId("a"), PoiId("b")]


# ── ② 수리 불가 계약 ─────────────────────────────────────────

def test_repair_returns_none_when_shift_breaks_day_window() -> None:
    problem, index = _setup()
    trace = InMemoryTrace()
    facade = _facade(index, trace=trace)
    # b를 이동시간만큼 밀면 20:52 시작 → 21:12 종료로 day window(21:00) 초과 → 수리 불가
    broken = _sol(_slot("a", 19, 0, 20, 0), _slot("b", 20, 5, 20, 25))

    result = facade.repair(broken, problem, deadline_ms=1000)

    assert result.repaired is None and result.changes == ()
    reasons = [e.reason for e in trace.of_type(FallbackEvent)]
    assert "unrepairable" in reasons  # 침묵 실패 금지 (INV-4)
    records = trace.of_type(SolverRunRecord)
    assert len(records) == 1
    assert records[0].repaired is False and records[0].violations_found > 0


def test_repair_with_unsupported_policy_returns_none() -> None:
    problem, index = _setup()
    trace = InMemoryTrace()
    facade = _facade(index, trace=trace)
    broken = _sol(_slot("a", 10, 0, 11, 15), _slot("b", 11, 20, 12, 20))

    result = facade.repair(broken, problem, deadline_ms=1000,
                           policy=MinimalChangePolicy.ALLOW_REORDER)

    assert result.repaired is None  # 1차 미구현 정책 — 계약대로 수리 불가
    assert "unrepairable" in [e.reason for e in trace.of_type(FallbackEvent)]


# ── ③ repair 시한 인지 (DL-2 · DL-5) ─────────────────────────

def test_repair_skips_without_budget_and_is_observed() -> None:
    problem, index = _setup()
    trace = InMemoryTrace()
    facade = _facade(index, trace=trace)
    broken = _sol(_slot("a", 10, 0, 11, 15), _slot("b", 11, 20, 12, 20))

    result = facade.repair(broken, problem, deadline_ms=0)

    assert result.repaired is None and result.changes == ()
    events = trace.of_type(FallbackEvent)
    assert [e.reason for e in events] == ["deadline"]   # 스킵이 관측됨 (침묵 금지)
    assert events[0].from_mode == "repair" and events[0].stage == "solver"
    assert trace.of_type(SolverRunRecord) == []          # 실행 자체가 없었음


def test_repair_overrun_is_observed() -> None:
    problem, index = _setup()
    trace = InMemoryTrace()
    facade = _facade(index, clock=TickingClock(tick_ms=900), trace=trace)
    broken = _sol(_slot("a", 10, 0, 11, 15), _slot("b", 11, 20, 12, 20))

    result = facade.repair(broken, problem, deadline_ms=100)  # 900ms 소모 > 100ms

    assert result.repaired is not None  # 수리는 끝냈다 — 초과를 숨기지 않을 뿐
    assert any(e.reason.startswith("deadline_exceeded:repair")
               for e in trace.of_type(FallbackEvent))


# ── ④ validate 시한 인지 — 검증은 생략하지 않는다 (INV-2) ────

def test_validate_still_runs_when_deadline_exhausted() -> None:
    problem, index = _setup()
    trace = InMemoryTrace()
    facade = _facade(index, trace=trace)
    broken = _sol(_slot("a", 10, 0, 11, 15), _slot("b", 11, 20, 12, 20))

    violations = facade.validate(broken, problem, deadline_ms=0)

    assert violations != []  # 시한이 없어도 위반을 찾아낸다 (미검증 해 반환 금지)
    assert "deadline_exhausted:validate_forced" in [
        e.reason for e in trace.of_type(FallbackEvent)]


def test_validate_overrun_is_observed() -> None:
    problem, index = _setup()
    trace = InMemoryTrace()
    facade = _facade(index, clock=TickingClock(tick_ms=700), trace=trace)
    ok = _sol(_slot("a", 10, 0, 11, 15), _slot("b", 13, 0, 14, 0))

    assert facade.validate(ok, problem, deadline_ms=100) == []
    assert any(e.reason.startswith("deadline_exceeded:validate")
               for e in trace.of_type(FallbackEvent))


def test_validate_within_budget_is_silent() -> None:
    problem, index = _setup()
    trace = InMemoryTrace()
    facade = _facade(index, trace=trace)
    ok = _sol(_slot("a", 10, 0, 11, 15), _slot("b", 13, 0, 14, 0))

    assert facade.validate(ok, problem, deadline_ms=5000) == []
    assert trace.events == []  # 정상 경로는 잡음 없음


# ── ⑤ regenerate 회귀 — 제외 POI 소실 (TRIP-292) ─────────────

def test_regenerate_preserves_excluded_poi_ids() -> None:
    """warm-start 경로에서도 excluded_poi_ids가 후보 풀에서 빠져야 한다.

    수정 전: regenerate가 ItineraryProblem을 필드 나열로 재구성하며
    excluded_poi_ids를 빠뜨려, 제외 POI가 재생성 결과에 되살아났다.
    """
    problem, index = _setup()
    excluded = frozenset({PoiId("a")})
    facade = _facade(index, chain=[RuleFallbackSolver(index, _EST, _CFG)])

    result = facade.regenerate(replace(problem, excluded_poi_ids=excluded),
                               locked_slots=(), deadline_ms=5000)

    placed = set(_placed(result))
    assert placed & excluded == set()   # 제외 POI가 되살아나지 않는다
    assert PoiId("b") in placed         # 빈 해라서 통과한 게 아님을 보증


def test_regenerate_preserves_excluded_with_locked_slots() -> None:
    problem, index = _setup()
    excluded = frozenset({PoiId("a")})
    facade = _facade(index, chain=[RuleFallbackSolver(index, _EST, _CFG)])
    p = replace(problem, excluded_poi_ids=excluded)

    first = facade.regenerate(p, locked_slots=(), deadline_ms=5000)
    locked = [s for d in first.days for s in d.slots][:1]
    regen = facade.regenerate(p, locked, deadline_ms=5000)

    assert set(_placed(regen)) & excluded == set()
    kept = [s for d in regen.days for s in d.slots if s.poi_id == locked[0].poi_id]
    assert kept and kept[0].start_at == locked[0].start_at  # locked 보존 유지


# ── ⑤-1 repair 엔진 회귀 — QualityScore 소실 (TRIP-329) ──────

def test_repair_engine_preserves_quality_score() -> None:
    """모듈 함수 repair()는 입력 해의 QualityScore를 떨어뜨리지 않는다.

    수정 전: repair()가 ItinerarySolution을 필드 나열로 재구성하며 score를
    빠뜨려, 수리 경로를 지나면 품질 점수가 소실됐다 (안티패턴 TRIP-314 잔존).
    퍼사드 경계는 수리 후 재계산해 덮어쓰지만(TRIP-261), 순수 엔진은 보존이
    기본이다 — 잃는 것보다 낫다.
    """
    problem, index = _setup()
    score = QualityScore(preference_fit=0.9, constraint_satisfaction=1.0,
                         route_efficiency=0.8, composite=0.85)
    broken = replace(_sol(_slot("a", 10, 0, 11, 15), _slot("b", 11, 20, 12, 20)),
                     score=score)

    result = repair_engine(broken, problem, index, _EST)

    assert result.repaired is not None
    assert result.repaired.score == score  # 수리가 품질 점수를 잃지 않는다


def test_repair_engine_noop_preserves_quality_score() -> None:
    """위반이 없어 이동이 0건이어도 score는 그대로 실려 나온다."""
    problem, index = _setup()
    score = QualityScore(preference_fit=0.7, constraint_satisfaction=1.0,
                         route_efficiency=0.6, composite=0.75)
    ok = replace(_sol(_slot("a", 10, 0, 11, 15), _slot("b", 13, 0, 14, 0)),
                 score=score)

    result = repair_engine(ok, problem, index, _EST)

    assert result.repaired is not None and result.changes == ()
    assert result.repaired.score == score


# ── ⑥ llm_solver 내부 repair 경로 무회귀 ─────────────────────

def test_llm_internal_repair_path_unchanged() -> None:
    """2차 솔버는 여전히 모듈 함수 repair()를 직접 쓴다 — 퍼사드 승격과 무관."""
    problem, index = _setup()
    trace = InMemoryTrace()
    canned = json.dumps({"days": [{"date": "2026-08-05", "slots": [
        {"poi_id": "a", "start": "2026-08-05T10:00:00+09:00",
         "end": "2026-08-05T11:15:00+09:00"},
        {"poi_id": "b", "start": "2026-08-05T11:20:00+09:00",
         "end": "2026-08-05T12:20:00+09:00"}]}]})
    stage = LlmSolver(FakeLlm(canned=canned), index, _EST, _CFG, trace, _REF,
                      "claude-sonnet-5")

    result = stage.solve(problem, remaining_ms=5000)

    assert result is not None and result.solve_mode == SolveMode.LLM
    assert _placed(result) == [PoiId("a"), PoiId("b")]  # 수리 후 채택
    # 내부 경로는 퍼사드 관측을 발행하지 않는다 (기존 이벤트 구성 유지)
    assert trace.of_type(SolverRunRecord) == []
