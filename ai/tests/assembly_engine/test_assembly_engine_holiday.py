"""공휴일 휴무 — HC1 하위 코드와 조립 전 경로의 같은 판정 (상황 감지 H1 · BR-SA-17).

규칙은 `poi.open_windows_on` 하나다 — 검증(HC1)과 두 어셈블러·수리·까닭 판정이 같은 함수를 보지 않으면
조립이 둔 해를 검증이 거부한다(`open_hours_ok` 독스트링과 같은 이유).

증명하는 것:
  ① check_hc1 하위 코드 3종 — 정기 휴무 CLOSED_DAY(공휴일과 겹쳐도 우선), 휴일 규칙 HOLIDAY, 그날 열지만 창 밖
     OUT_OF_HOURS. detail 은 종전 문자열(휴일은 "공휴일 휴무"). check_all 은 problem.holidays 를 본다 — None 이면
     공휴일을 보지 않는다(모드 off = 종전과 같다).
  ② 두 어셈블러는 그 날 휴일 규칙으로 닫힌 곳을 자유 후보로도 필수 방문으로도 놓지 않는다 — 모드 off 면 놓는다.
  ③ 수리는 휴일 휴무를 깨는 해를 내지 않는다 — 퍼사드 validate·repair 가 같은 holidays 로 판정한다.
  ④ 까닭 판정(`explain_unplaced`) — 휴일 휴무도 closed.
  ⑤ PBT — 휴일 규칙·달력을 섞은 임의 문제에서 규칙 조립·OR 조립 해가 **같은 holidays** 로 HC1~4 무위반.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, timedelta, timezone

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.constraints import check_all, check_hc1, open_hours_ok
from trippilot.assembly_engine.facade import HybridAssemblyFacade
from trippilot.assembly_engine.fallback_assembler import RuleFallbackAssembler, explain_unplaced
from trippilot.assembly_engine.ortools_assembler import OrToolsAssembler
from trippilot.assembly_engine.repair import repair
from trippilot.assembly_engine.travel import TravelEstimator
from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId, ScheduleId, TransportMode
from trippilot.domain.itinerary import (
    DaySolution,
    ItineraryProblem,
    ItinerarySolution,
    RequiredVisit,
    SolveMode,
    TimeWindow,
    VisitSlot,
)
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource

from tests.fakes.fake_clock import FakeClock
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.generators.assembly import assembly_setups

_KST = timezone(timedelta(hours=9))
_CFG = AssemblyConfig(or_tools_min_ms=50)
_EST = TravelEstimator(_CFG)
_ANCHOR = GeoPoint(37.5665, 126.9780)
_HANGUL = date(2026, 10, 9)          # 한글날 — 금요일
_SUBST_MON = date(2026, 10, 5)       # 대체공휴일(개천절) — 월요일
_THU = date(2026, 10, 8)
_CAL = {_HANGUL: frozenset({"PUBLIC"}), _SUBST_MON: frozenset({"PUBLIC"})}
_TUE_SUN = tuple(OpenHour(d, 540, 1080) for d in range(1, 7))  # 월요일 휴관, 09~18시


def _at(day: date, h: int, m: int = 0) -> datetime:
    return datetime(day.year, day.month, day.day, h, m, tzinfo=_KST)


def _poi(pid: str, hours=_TUE_SUN, rules=frozenset({"PUBLIC"}), cat=PoiCategory.CULTURE,
         coord: GeoPoint = _ANCHOR) -> Poi:
    return Poi(poi_id=PoiId(pid), name=pid, category=cat, coord=coord, open_hours=hours,
               avg_cost=None, rating=None, quality=DataQuality.FULL, source=PoiSource.SEED,
               confidence=None, holiday_rules=frozenset(rules))


def _slot(pid: str, start: datetime, end: datetime) -> VisitSlot:
    return VisitSlot(poi_id=PoiId(pid), start_at=start, end_at=end,
                     stay_min=int((end - start).total_seconds() // 60), score=0.5, is_llm_score=False)


def _sol(day: date, *slots: VisitSlot) -> ItinerarySolution:
    return ItinerarySolution(schedule_id=ScheduleId("h1"), days=(DaySolution(day, tuple(slots), ()),),
                             is_fallback=False, solve_mode=SolveMode.OR_TOOLS, assembly_run=None)


def _problem(day: date, *, candidates=(), required=(), holidays=None) -> ItineraryProblem:
    return ItineraryProblem(
        schedule_id=ScheduleId("h1"), days=(day,), candidates=tuple(candidates), fixed_blocks=(),
        budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=TimeWindow(_at(day, 9), _at(day, 21)), seed=1, anchor=_ANCHOR,
        required_visits=tuple(required), holidays=holidays)


# ── ① check_hc1 하위 코드 ────────────────────────────────────────────


def test_휴일_규칙으로_닫힌_날은_HOLIDAY() -> None:
    index = {PoiId("m"): _poi("m")}
    sol = _sol(_HANGUL, _slot("m", _at(_HANGUL, 10), _at(_HANGUL, 11)))
    [v] = check_hc1(sol, index, _CAL)
    assert (v.code, v.slot_ref, v.detail, v.reason_code) == ("HC1", PoiId("m"), "공휴일 휴무", "HOLIDAY")
    assert check_hc1(sol, index) == []  # 모드 off — 공휴일을 보지 않는다
    assert check_hc1(sol, index, {}) == []  # 달력 실패 — 태그 규칙은 못 본다


def test_정기_휴무는_공휴일과_겹쳐도_CLOSED_DAY() -> None:
    index = {PoiId("m"): _poi("m")}
    sol = _sol(_SUBST_MON, _slot("m", _at(_SUBST_MON, 10), _at(_SUBST_MON, 11)))
    for holidays in (None, _CAL):
        [v] = check_hc1(sol, index, holidays)
        assert (v.detail, v.reason_code) == ("0요일 휴무", "CLOSED_DAY")


def test_그날_열지만_창_밖이면_OUT_OF_HOURS() -> None:
    index = {PoiId("m"): _poi("m")}
    sol = _sol(_THU, _slot("m", _at(_THU, 19), _at(_THU, 20)))
    [v] = check_hc1(sol, index, _CAL)
    assert (v.detail, v.reason_code) == ("영업시간 밖: 1140~1200", "OUT_OF_HOURS")


def test_영업정보가_없어도_날짜_명시형이_닫으면_HOLIDAY() -> None:
    new_year = date(2027, 1, 1)
    index = {PoiId("x"): _poi("x", hours=(), rules={"01-01"})}
    sol = _sol(new_year, _slot("x", _at(new_year, 10), _at(new_year, 11)))
    assert [v.reason_code for v in check_hc1(sol, index, {})] == ["HOLIDAY"]
    assert check_hc1(sol, index) == []


def test_check_all_과_open_hours_ok_는_문제의_달력을_본다() -> None:
    index = {PoiId("m"): _poi("m")}
    sol = _sol(_HANGUL, _slot("m", _at(_HANGUL, 10), _at(_HANGUL, 11)))
    assert [v.reason_code for v in check_all(sol, _problem(_HANGUL, holidays=_CAL), index, _EST)] == ["HOLIDAY"]
    assert check_all(sol, _problem(_HANGUL), index, _EST) == []
    assert open_hours_ok(index[PoiId("m")], _at(_HANGUL, 10), _at(_HANGUL, 11)) is True
    assert open_hours_ok(index[PoiId("m")], _at(_HANGUL, 10), _at(_HANGUL, 11), _CAL) is False


# ── ② 두 어셈블러 ────────────────────────────────────────────────────


def _two_assemblers(problem: ItineraryProblem, index):
    rule = RuleFallbackAssembler(index, _EST, _CFG).solve(problem)
    ortools = OrToolsAssembler(index, _EST, _CFG).solve(problem, 2_000)
    return rule, ortools


def _placed(sol) -> set[PoiId]:
    return {s.poi_id for d in sol.days for s in d.slots} if sol is not None else set()


def test_자유_후보는_공휴일_휴무면_놓지_않고_off_면_놓는다() -> None:
    museum = _poi("m", coord=GeoPoint(_ANCHOR.lat + 0.002, _ANCHOR.lng))
    cafe = _poi("c", hours=(), rules=(), cat=PoiCategory.CAFE)
    index = {museum.poi_id: museum, cafe.poi_id: cafe}
    cands = (ScoredPoi(museum.poi_id, 0.9, False), ScoredPoi(cafe.poi_id, 0.5, False))
    on = _problem(_HANGUL, candidates=cands, holidays=_CAL)
    for sol in _two_assemblers(on, index):
        assert PoiId("m") not in _placed(sol)
        assert check_all(sol, on, index, _EST) == []
    off = _problem(_HANGUL, candidates=cands)
    for sol in _two_assemblers(off, index):
        assert PoiId("m") in _placed(sol)


def test_필수_방문도_공휴일_휴무면_놓지_않는다() -> None:
    museum = _poi("m")
    index = {museum.poi_id: museum}
    rv = RequiredVisit(poi_id=museum.poi_id, day=_HANGUL, dwell_min=None, reason="llm_compose")
    on = _problem(_HANGUL, required=(rv,), holidays=_CAL)
    rule, ortools = _two_assemblers(on, index)
    assert PoiId("m") not in _placed(rule) | _placed(ortools)
    off = _problem(_HANGUL, required=(rv,))
    rule, ortools = _two_assemblers(off, index)
    assert PoiId("m") in _placed(rule) and PoiId("m") in _placed(ortools)


def test_까닭은_closed() -> None:
    museum = _poi("m")
    index = {museum.poi_id: museum}
    rv = RequiredVisit(poi_id=museum.poi_id, day=_HANGUL, dwell_min=None, reason="llm_compose")
    empty = ItinerarySolution(schedule_id=ScheduleId("h1"), days=(DaySolution(_HANGUL, (), ()),),
                              is_fallback=False, solve_mode=SolveMode.OR_TOOLS, assembly_run=None)
    why, _ = explain_unplaced(_problem(_HANGUL, required=(rv,), holidays=_CAL), empty, index, _EST, _CFG)
    assert why == {PoiId("m"): "closed"}
    why, _ = explain_unplaced(_problem(_HANGUL, required=(rv,)), empty, index, _EST, _CFG)
    assert why == {PoiId("m"): "fits"}


# ── ③ 수리·퍼사드 ────────────────────────────────────────────────────


def test_수리는_휴일_휴무를_깨는_해를_내지_않는다() -> None:
    index = {PoiId("m"): _poi("m")}
    sol = _sol(_HANGUL, _slot("m", _at(_HANGUL, 10), _at(_HANGUL, 11)))
    assert repair(sol, _problem(_HANGUL, holidays=_CAL), index, _EST).repaired is None
    assert repair(sol, _problem(_HANGUL), index, _EST).repaired == sol


def test_퍼사드_validate_와_repair_는_같은_달력을_본다() -> None:
    index = {PoiId("m"): _poi("m")}
    facade = HybridAssemblyFacade([RuleFallbackAssembler(index, _EST, _CFG)], index, _EST,
                                  FakeClock(), InMemoryTrace())
    sol = _sol(_HANGUL, _slot("m", _at(_HANGUL, 10), _at(_HANGUL, 11)))
    on = _problem(_HANGUL, holidays=_CAL)
    assert [v.reason_code for v in facade.validate(sol, on, 1_000)] == ["HOLIDAY"]
    assert facade.repair(sol, on, 1_000).repaired is None
    assert facade.validate(sol, _problem(_HANGUL), 1_000) == []


# ── ⑤ PBT — 조립한 해는 같은 달력으로 검증을 통과한다 ─────────────────

_RULES = st.frozensets(st.sampled_from(["PUBLIC", "SEOLLAL_DAY", "BUDDHA", "08-03", "08-15"]), max_size=2)


@st.composite
def _holiday_setups(draw):
    problem, index = draw(assembly_setups())
    pinned = {fb.poi_id for fb in problem.fixed_blocks}  # 핀 POI 는 휴무로 만들지 않는다 — 배선 ⓪′ 가 빼는 몫
    index = {pid: (replace(p, holiday_rules=draw(_RULES)) if pid not in pinned else p)
             for pid, p in index.items()}
    holidays = draw(st.one_of(st.none(), st.just({}), st.fixed_dictionaries({}, optional={
        d: st.frozensets(st.sampled_from(["PUBLIC", "SEOLLAL_DAY", "BUDDHA"]), min_size=1)
        for d in problem.days})))
    return replace(problem, holidays=holidays), index


@settings(max_examples=120, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(setup=_holiday_setups())
def test_PBT_조립한_해는_같은_달력으로_HC1_4_무위반(setup) -> None:
    problem, index = setup
    rule = RuleFallbackAssembler(index, _EST, _CFG).solve(problem)
    assert check_all(rule, problem, index, _EST) == []
    ortools = OrToolsAssembler(index, _EST, _CFG).solve(problem, 2_000)
    if ortools is not None:
        assert check_all(ortools, problem, index, _EST) == []
