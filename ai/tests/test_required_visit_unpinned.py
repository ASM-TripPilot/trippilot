"""시각 없는 필수 방문 (TRIP-1249) — `fixed_blocks[].start = null` 은 핀이 아니라 "그 날 꼭, 시각은 조립이".

배경(2026-10-05 로컬 재현): 같이 짜기에서 날짜·시각 미지정 필수방문을 BE 가 창 시작(09:00)에
핀해 보냈다. 핀에도 HC1 이 걸려 11시에 여는 식당·10시에 여는 사찰이 OR·그리디 둘 다
`invalid:1` → 409 → BE 최소 일정으로 하루가 통째로 비었다. 이제 BE 는 시각을 지어내지 않고
(`start: null`), AI 가 영업시간 안(식당은 식사창 안)에서 시각을 고른다. 명시 `start` 는 종전
HC3 핀 그대로다.

증명하는 것:
  ① 스키마: generate 는 start null 수용 · date 없음은 여전히 422 · 미지 키 422 ·
     replan `locked_blocks` 의 start null 은 422(잠금은 시각 필수)
  ② 배선: start 유무로 고정/필수 분리(dwell null·0 → None) · 미배치 판정(NO_FEASIBLE_SLOT /
     OUT_OF_RANGE / 유예)
  ③ OR: 필수 노드는 가능하면 항상 방문 · FOOD 필수는 식사창이 하나라도 가능하면 그 안(PBT) ·
     식사창 불가면 영업창 안 · 휴무면 빠지되 예외 없음 · 프리필터가 안 자른다 · 다른 날
     필수는 오늘 자유 후보에서 빠진다 · 필수 없는 날은 필드 없는 문제와 동일 해(패리티) ·
     제외보다 우선 · **소프트 지배 항**이라 둘 중 하나가 불가능해도 다른 하나는 놓이고
     (하드 제약 시절엔 그날 필수 전부가 풀렸다), 프리필터 초과 풀·기본 결정론 한도에서도
     OR 모드가 유지된다(하드 시절엔 UNKNOWN 이 OR 단계를 통째로 잃었다)
  ③′ 둘 다: 앵커 출발(창 시작 + 이동)·재계획 하한을 지킨다 · 다음 핀까지 이동이 안 들어가는
     점심창은 건너뛰고 저녁창으로 간다 · dwell 없으면 카테고리 기본 체류(pace 적용) ·
     로컬 재현 실표본(11~20시 식당 · 휴게 있는 두 창 식당 · 10시 개장 명소)
  ④ 그리디: 같은 성질 + 틈 채우기는 필수 방문이 있는 날만(다른 날 패리티)
  ⑤ 경로 e2e: 11시 개장 식당 · 10시 개장 명소를 start null 로 → 200, 영업시간 안(식당은
     식사창 안), is_fixed=true, 409 없음
  ⑥ INV-1: 풀 밖 필수 POI 는 인덱스에만 합류, 후보가 되지 않는다
  ⑦ 다지역(앵커 구간) 생성: 필수 방문은 제 날의 구간에서만 놓인다
"""

from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, timedelta, timezone

import pytest
from hypothesis import assume, given, settings
from hypothesis import strategies as st
from pydantic import ValidationError

from trippilot.api import schemas
from trippilot.api.wiring import (
    KST,
    REASON_NO_FEASIBLE_SLOT,
    REASON_OUT_OF_RANGE,
    _domain_generate_request,
    _fixed_block,
    build_dev_app,
    judge_unplaced_must_visits,
)
from trippilot.assembly_engine.config import AssemblyConfig, stay_for
from trippilot.assembly_engine.constraints import anchor_minutes, check_all
from trippilot.assembly_engine.fallback_assembler import RuleFallbackAssembler
from trippilot.assembly_engine.ortools_assembler import OrToolsAssembler, drop_food_runs
from trippilot.assembly_engine.travel import TravelEstimator
from trippilot.domain.common import BudgetLevel, GeoPoint, Pace, PoiId, ScheduleId, TransportMode
from trippilot.domain.itinerary import (
    DaySolution,
    FixedBlock,
    ItineraryProblem,
    ItinerarySolution,
    RequiredVisit,
    SolveMode,
    TimeWindow,
    VisitSlot,
)
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource

from tests.test_e2e_boundary import _request as _e2e_request
from tests.test_api_replan_wired import _DIRECTIVES, _body as _replan_body, _post as _replan_post

_KST = timezone(timedelta(hours=9))
_DAY = date(2026, 8, 5)  # 수요일
_DAY2 = _DAY + timedelta(days=1)
_CFG = AssemblyConfig(or_tools_limit_ms=2000, or_tools_min_ms=50)
_EST = TravelEstimator(_CFG)
_LUNCH, _DINNER = _CFG.lunch_window_min, _CFG.dinner_window_min


# ── 빌더 ──────────────────────────────────────────────────────────────


def _hours(open_min: int, close_min: int) -> tuple[OpenHour, ...]:
    return tuple(OpenHour(d, open_min, close_min) for d in range(7))


def _poi(pid: str, cat: PoiCategory, k: int, hours: tuple[OpenHour, ...] = ()) -> Poi:
    return Poi(PoiId(pid), pid, cat, GeoPoint(37.751 + 0.003 * k, 128.876), hours,
               None, None, DataQuality.FULL, PoiSource.SEED, None)


def _rv(pid: str, day: date = _DAY, dwell: int | None = 60) -> RequiredVisit:
    return RequiredVisit(PoiId(pid), day, dwell, "must_visit_anytime")


def _at(h: int, m: int = 0, day: date = _DAY) -> datetime:
    return datetime(day.year, day.month, day.day, h, m, tzinfo=_KST)


def _pin(pid: str, start: datetime, end: datetime) -> FixedBlock:
    return FixedBlock(PoiId(pid), TimeWindow(start, end), "user_fixed")


def _problem(pois: list[Poi], *, candidates: list[str] | None = None,
             required: tuple[RequiredVisit, ...] = (), days: tuple[date, ...] = (_DAY,),
             fixed: tuple[FixedBlock, ...] = (), seed: int = 7, anchor: GeoPoint | None = None,
             excluded: frozenset[PoiId] = frozenset(), score: float = 0.5):
    index = {p.poi_id: p for p in pois}
    ids = candidates if candidates is not None else [str(p.poi_id) for p in pois]
    cands = tuple(ScoredPoi(PoiId(pid), score, False) for pid in ids)
    problem = ItineraryProblem(
        schedule_id=ScheduleId("s-1249"), days=days, candidates=cands, fixed_blocks=fixed,
        budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=TimeWindow(_at(9), _at(21)),
        seed=seed, anchor=anchor, excluded_poi_ids=excluded, required_visits=required)
    return problem, index


def _mod(dt: datetime) -> int:
    return dt.hour * 60 + dt.minute


def _slot(solution: ItinerarySolution, pid: str, day: date = _DAY) -> VisitSlot | None:
    return next((s for d in solution.days if d.date == day for s in d.slots
                 if s.poi_id == PoiId(pid)), None)


def _in_meal_window(slot: VisitSlot) -> bool:
    return any(_mod(slot.start_at) >= lo and _mod(slot.end_at) <= hi
               for lo, hi in (_LUNCH, _DINNER))


def _or_solve(problem, index):
    return OrToolsAssembler(index, _EST, _CFG).solve(problem, remaining_ms=3000)


def _fb_solve(problem, index):
    return RuleFallbackAssembler(index, _EST, _CFG).solve(problem)


_BOTH = pytest.mark.parametrize("solve", [_or_solve, _fb_solve], ids=["or", "fallback"])


# ── ① 스키마 ──────────────────────────────────────────────────────────


def _block(pid: str, d: date = _DAY, start: str | None = None, **extra) -> dict:
    return {"poi_id": pid, "date": d.isoformat(), "start": start, "dwell_min": 60, **extra}


def test_generate_schema_accepts_null_start_but_still_requires_date() -> None:
    body = _e2e_request(fixed_blocks=(_block("p1"),))
    parsed = schemas.GenerateItineraryRequest.model_validate(body)
    assert parsed.fixed_blocks[0].start is None and parsed.fixed_blocks[0].date == _DAY

    for bad in ({"poi_id": "p1", "start": None},                    # date 없음
                _block("p1", extra_key=1)):                           # 미지 키 — 드리프트 침묵 금지
        with pytest.raises(ValidationError):
            schemas.GenerateItineraryRequest.model_validate(_e2e_request(fixed_blocks=(bad,)))


def test_fixed_block_backstop_still_rejects_null_start() -> None:
    """`_fixed_block` 은 그대로 엄격하다 — 시각 없는 블록은 `_required_visit` 몫이다."""
    with pytest.raises(ValueError):
        _fixed_block(schemas.FixedBlockSchema(poi_id="p1", date=_DAY, start=None), KST)


def test_replan_locked_block_without_start_is_422() -> None:
    """잠금은 시각이 정체성 — 시각 없는 잠금은 HC3 로 표현 불가(422), generate 의 완화와 무관."""
    with pytest.raises(ValidationError, match="locked_blocks"):
        schemas.ReplanRequest.model_validate(_replan_body(locked_blocks=[
            {"poi_id": "e0000000-0000-4000-8000-000000000002", "date": "2026-09-21",
             "start": None}]))
    response = _replan_post(build_dev_app(directives=_DIRECTIVES), locked_blocks=[
        {"poi_id": "e0000000-0000-4000-8000-000000000002", "date": "2026-09-21",
         "start": None, "dwell_min": 60}])
    assert response.status_code == 422, response.text


# ── ② 배선 — 분리 · 미배치 판정 ─────────────────────────────────────────


def _schema_request(blocks: tuple[dict, ...], *, dates=(_DAY,), trip_end: date | None = None):
    body = _e2e_request(dates=dates, fixed_blocks=blocks)
    if trip_end is not None:
        body["trip_context"]["end_date"] = trip_end.isoformat()
    return schemas.GenerateItineraryRequest.model_validate(body)


def test_wiring_splits_blocks_by_start_presence() -> None:
    request = _schema_request((_block("p1"), _block("p2", start="10:00"),
                               {"poi_id": "p3", "date": _DAY.isoformat(), "start": None,
                                "dwell_min": None},
                               _block("p4", dwell_min=0)))
    domain = _domain_generate_request(request, KST)
    assert [b.poi_id for b in domain.fixed_blocks] == [PoiId("p2")]
    assert domain.required_visits == (
        RequiredVisit(PoiId("p1"), _DAY, 60, "must_visit_anytime"),
        RequiredVisit(PoiId("p3"), _DAY, None, "must_visit_anytime"),  # null → 조립이 카테고리 기본
        RequiredVisit(PoiId("p4"), _DAY, None, "must_visit_anytime"),  # 0 도 미지정으로 본다
    )


def _solution_with(pids: tuple[str, ...], day: date = _DAY) -> ItinerarySolution:
    base = datetime(day.year, day.month, day.day, 10, 0, tzinfo=_KST)
    slots = tuple(VisitSlot(PoiId(p), base + timedelta(hours=i), base + timedelta(hours=i, minutes=30),
                            30, 0.5, False) for i, p in enumerate(pids))
    return ItinerarySolution(ScheduleId("s"), (DaySolution(day, slots, ()),), False,
                             SolveMode.OR_TOOLS, None)


def test_judge_reports_required_visit_absent_from_its_day() -> None:
    request = _schema_request((_block("p1"), _block("p2")))
    report = judge_unplaced_must_visits(request, _solution_with(("p1", "p9")), KST)
    assert [(r.poi_id, r.reason_code) for r in report] == [("p2", REASON_NO_FEASIBLE_SLOT)]


def test_judge_required_visit_out_of_trip_is_out_of_range_and_deferred_is_silent() -> None:
    outside = _block("p5", _DAY + timedelta(days=9))
    deferred = _block("p6", _DAY2)  # 기간 안 · 이 요청의 일자 밖 → 2차 소관
    request = _schema_request((outside, deferred), trip_end=_DAY2)
    report = judge_unplaced_must_visits(request, _solution_with(("p1",)), KST)
    assert [(r.poi_id, r.reason_code) for r in report] == [("p5", REASON_OUT_OF_RANGE)]


# ── ③ OR-Tools ────────────────────────────────────────────────────────


def _sights(n: int = 4) -> list[Poi]:
    return [_poi(f"s{i}", PoiCategory.SIGHT, i) for i in range(n)]


@_BOTH
@pytest.mark.parametrize("in_pool", [True, False])
def test_required_visit_is_always_placed_and_exposed_as_fixed(solve, in_pool: bool) -> None:
    temple = _poi("temple", PoiCategory.CULTURE, 9, _hours(10 * 60, 18 * 60))
    pois = _sights() + [temple]
    problem, index = _problem(pois, candidates=[f"s{i}" for i in range(4)] + (["temple"] if in_pool else []),
                              required=(_rv("temple", dwell=80),), score=0.9)  # 80 ≠ CULTURE 기본 90
    result = solve(problem, index)
    assert result is not None
    slot = _slot(result, "temple")
    assert slot is not None and slot.stay_min == 80
    assert _mod(slot.start_at) >= 10 * 60 and _mod(slot.end_at) <= 18 * 60
    assert check_all(result, problem, index, _EST) == []
    assert result.days[0].fixed_blocks == (
        FixedBlock(PoiId("temple"), TimeWindow(slot.start_at, slot.end_at), "required_visit"),)
    assert sum(s.poi_id == PoiId("temple") for s in result.days[0].slots) == 1


def test_or_required_food_lands_in_meal_window_with_anchor_and_pin() -> None:
    """앵커 출발·핀과 섞여도 FOOD 필수는 점심/저녁창 안이고 핀은 그대로다."""
    diner = _poi("diner", PoiCategory.FOOD, 5, _hours(11 * 60, 22 * 60))
    fixed = (_pin("s1", _at(15), _at(16)),)
    problem, index = _problem(_sights() + [diner], candidates=[f"s{i}" for i in range(4)],
                              required=(_rv("diner"),), fixed=fixed,
                              anchor=GeoPoint(37.745, 128.870))
    result = _or_solve(problem, index)
    assert result is not None
    slot = _slot(result, "diner")
    assert slot is not None and _in_meal_window(slot)
    assert _slot(result, "s1").start_at == _at(15)
    assert check_all(result, problem, index, _EST) == []


def test_or_required_food_without_feasible_meal_window_stays_inside_opening_hours() -> None:
    cafe = _poi("brunch", PoiCategory.FOOD, 5, _hours(14 * 60 + 30, 16 * 60 + 30))  # 식사창 어디에도 60분이 안 들어간다
    problem, index = _problem(_sights() + [cafe], candidates=[f"s{i}" for i in range(4)],
                              required=(_rv("brunch"),))
    result = _or_solve(problem, index)
    assert result is not None
    slot = _slot(result, "brunch")
    assert slot is not None and not _in_meal_window(slot)
    assert 14 * 60 + 30 <= _mod(slot.start_at) and _mod(slot.end_at) <= 16 * 60 + 30
    assert check_all(result, problem, index, _EST) == []


def _closed_on(day: date, pid: str = "closed") -> Poi:
    return _poi(pid, PoiCategory.CULTURE, 5,
                tuple(OpenHour(d, 9 * 60, 18 * 60) for d in range(7) if d != day.weekday()))


@_BOTH
def test_required_visit_closed_that_day_is_absent_without_raising(solve) -> None:
    problem, index = _problem(_sights() + [_closed_on(_DAY)], candidates=[f"s{i}" for i in range(4)],
                              required=(_rv("closed"),))
    result = solve(problem, index)
    assert result is not None
    assert _slot(result, "closed") is None
    assert result.days[0].slots  # 나머지 일정은 그대로 나간다
    assert result.days[0].fixed_blocks == ()
    assert check_all(result, problem, index, _EST) == []


def test_or_prefilter_keeps_required_candidate_with_lowest_score() -> None:
    pois = [_poi(f"c{i}", PoiCategory.SIGHT, i % 12) for i in range(70)]
    index = {p.poi_id: p for p in pois}
    cands = tuple(ScoredPoi(p.poi_id, 0.9 - 0.01 * i, False) for i, p in enumerate(pois))
    problem = replace(_problem(pois)[0], candidates=cands, required_visits=(_rv("c69"),))
    result = _or_solve(problem, index)
    assert result is not None
    assert _slot(result, "c69") is not None  # 점수 꼴찌(70위)여도 프리필터(60)가 안 자른다


def test_or_production_pool_size_keeps_or_mode_and_required_food_in_meal_window() -> None:
    """프리필터 상한을 넘는 풀 + 기본 결정론 한도 — 종전 하드 `visit==1` 은 한도 안에 못 풀면
    (UNKNOWN) OR 단계를 통째로 잃었다. 지배 항 + 그리디 힌트면 FEASIBLE 로 멈춰도 필수 식당이
    식사창 안에 남는다."""
    cats = (PoiCategory.SIGHT, PoiCategory.CAFE, PoiCategory.NATURE, PoiCategory.CULTURE)
    pois = [_poi(f"c{i}", cats[i % 4], i % 12, _hours(9 * 60, 21 * 60)) for i in range(70)]
    diner = _poi("diner", PoiCategory.FOOD, 7, _hours(11 * 60, 22 * 60))
    index = {p.poi_id: p for p in pois + [diner]}
    cands = (*(ScoredPoi(p.poi_id, 0.9 - 0.01 * i, False) for i, p in enumerate(pois)),
             ScoredPoi(diner.poi_id, 0.05, False))  # 점수 꼴찌 — 점수로는 절대 못 들어온다
    problem = replace(_problem(pois)[0], candidates=cands, required_visits=(_rv("diner", dwell=None),))
    cfg, est = AssemblyConfig(), TravelEstimator(AssemblyConfig())
    result = OrToolsAssembler(index, est, cfg).solve(problem, remaining_ms=15_000)
    assert result is not None and result.solve_mode is SolveMode.OR_TOOLS
    slot = _slot(result, "diner")
    assert slot is not None and _in_meal_window(slot), slot
    assert len(result.days[0].slots) >= 4  # 필수 식당만 덩그러니가 아니다
    assert check_all(result, problem, index, est) == []


@_BOTH
def test_required_visit_of_another_day_is_not_free_placed_today(solve) -> None:
    pois = _sights() + [_poi("hot", PoiCategory.SIGHT, 5)]
    problem, index = _problem(pois, required=(_rv("hot", day=_DAY2),), days=(_DAY, _DAY2))
    problem = replace(problem, candidates=tuple(
        replace(c, score=0.99 if c.poi_id == PoiId("hot") else 0.3) for c in problem.candidates))
    result = solve(problem, index)
    assert result is not None
    assert _slot(result, "hot", _DAY) is None
    assert _slot(result, "hot", _DAY2) is not None
    assert check_all(result, problem, index, _EST) == []


@_BOTH
def test_days_without_required_visits_are_identical_to_problem_without_the_field(solve) -> None:
    """2일차에만 필수 방문(풀 밖) — 1일차 해는 필드가 없는 문제와 바이트 동일(힌트·순서 불변)."""
    far = _poi("far", PoiCategory.CULTURE, 20, _hours(10 * 60, 18 * 60))
    pois = [_poi(f"m{i}", PoiCategory.FOOD if i % 3 == 0 else PoiCategory.SIGHT, i) for i in range(7)]
    base, index = _problem(pois + [far], candidates=[f"m{i}" for i in range(7)], days=(_DAY, _DAY2))
    with_required = replace(base, required_visits=(_rv("far", day=_DAY2),))
    plain, augmented = solve(base, index), solve(with_required, index)
    assert plain is not None and augmented is not None
    assert augmented.days[0] == plain.days[0]
    assert _slot(augmented, "far", _DAY2) is not None


@_BOTH
def test_required_visit_wins_over_excluded(solve) -> None:
    """제외 목록은 후보 풀 축소일 뿐 — 고정 블록과 같이 필수 방문이 이긴다."""
    problem, index = _problem(_sights(), required=(_rv("s2"),), excluded=frozenset({PoiId("s2")}))
    result = solve(problem, index)
    assert result is not None and _slot(result, "s2") is not None


def test_or_required_food_goes_outside_meal_windows_when_pins_fill_them() -> None:
    """점심·저녁창을 핀이 다 차지하면 식사창 항은 못 받고 방문 항만 받는다 — 영업시간 안, 409 아님."""
    diner = _poi("diner", PoiCategory.FOOD, 1, _hours(9 * 60, 22 * 60))
    problem, index = _problem(_sights() + [diner], candidates=["s0", "s3"], required=(_rv("diner"),),
                              fixed=(_pin("s1", _at(10, 30), _at(14, 30)), _pin("s2", _at(16, 30), _at(20, 30))))
    result = _or_solve(problem, index)
    assert result is not None
    slot = _slot(result, "diner")
    assert slot is not None and not _in_meal_window(slot)
    assert check_all(result, problem, index, _EST) == []


def test_or_required_visit_is_absent_when_a_pin_fills_the_whole_day() -> None:
    """핀이 하루를 다 차지하면 필수는 빠지고(미배치 보고 몫) 핀만 남는다 — 예외 없음, 재풀이 없음."""
    problem, index = _problem(_sights(), candidates=["s0"], required=(_rv("s3"),),
                              fixed=(_pin("s1", _at(9), _at(21)),))
    result = _or_solve(problem, index)
    assert result is not None
    assert [s.poi_id for s in result.days[0].slots] == [PoiId("s1")]
    assert check_all(result, problem, index, _EST) == []


@_BOTH
@pytest.mark.parametrize("why", ["closed", "pin_covered"])
def test_one_impossible_required_visit_does_not_drop_the_other(solve, why: str) -> None:
    """A 는 불가능(휴무 / 영업창 전체가 핀에 덮임), B 는 평범 — B 는 놓이고 A 만 보고된다.

    하드 `visit==1` + 완화 사다리는 A 의 모순에서 그날 필수 **전부**를 풀어 B 까지 잃었다.
    """
    if why == "closed":
        a, pins = _closed_on(_DAY, "a"), ()
    else:  # 10~12시만 여는 곳을 09:30~13:00 핀이 통째로 덮는다
        a, pins = _poi("a", PoiCategory.CULTURE, 1, _hours(10 * 60, 12 * 60)), (_pin("s1", _at(9, 30), _at(13),),)
    b = _poi("b", PoiCategory.CULTURE, 9, _hours(10 * 60, 18 * 60))
    problem, index = _problem(_sights() + [a, b], candidates=["s0", "s2", "s3"],
                              required=(_rv("a"), _rv("b")), fixed=pins)
    result = solve(problem, index)
    assert result is not None
    assert _slot(result, "a") is None and _slot(result, "b") is not None
    assert check_all(result, problem, index, _EST) == []

    pin_blocks = tuple(_block(str(p.poi_id), start=f"{p.window.start:%H:%M}",
                              dwell_min=int((p.window.end - p.window.start).total_seconds() // 60))
                       for p in pins)
    report = judge_unplaced_must_visits(_schema_request((_block("a"), _block("b"), *pin_blocks)), result, KST)
    assert [(r.poi_id, r.reason_code) for r in report] == [("a", REASON_NO_FEASIBLE_SLOT)]


def test_drop_food_runs_never_drops_required_nodes() -> None:
    def node(required: bool):
        return {"poi": _poi("f", PoiCategory.FOOD, 0), "pin": None, "required": required}
    nodes = [node(False), node(True), node(False)]
    assert drop_food_runs([0, 1, 2], nodes) == [1]


# ── ③′ 둘 다 — 앵커 출발 · 하한 · 다음 핀까지 이동 · 체류 기본값 · 실표본 ──────────


@_BOTH
def test_required_visit_departs_from_the_anchor(solve) -> None:
    """핀과 달리 필수 방문은 앵커 출발을 지킨다 — 창 시작 + 앵커→POI 이동 전에는 시작하지 않는다."""
    temple = _poi("temple", PoiCategory.CULTURE, 0)
    problem, index = _problem([temple], candidates=[], required=(_rv("temple"),),
                              anchor=GeoPoint(37.751 - 0.09, 128.876))  # 약 10km 남쪽
    travel = anchor_minutes(problem, temple, _EST)
    assert travel >= 60  # 픽스처 전제 — 이동이 짧으면 단언이 무의미하다
    result = solve(problem, index)
    slot = _slot(result, "temple")
    assert slot is not None and _mod(slot.start_at) >= 9 * 60 + travel
    assert check_all(result, problem, index, _EST) == []


@_BOTH
def test_required_visit_respects_the_not_before_floor(solve) -> None:
    """재계획 하한(TRIP-1182) — 필수 방문도 비고정이라 하한 전에는 시작하지 않는다."""
    temple = _poi("temple", PoiCategory.CULTURE, 9)
    problem, index = _problem(_sights() + [temple], candidates=[f"s{i}" for i in range(4)],
                              required=(_rv("temple"),))
    problem = replace(problem, not_before=_at(14))
    result = solve(problem, index)
    slot = _slot(result, "temple")
    assert slot is not None and _mod(slot.start_at) >= 14 * 60
    assert all(_mod(s.start_at) >= 14 * 60 for s in result.days[0].slots)
    assert check_all(result, problem, index, _EST) == []


@_BOTH
def test_required_food_skips_lunch_when_travel_to_the_following_pin_is_too_tight(solve) -> None:
    """점심창에 넣으면 12:30 핀까지 이동이 안 들어간다(HC2) → 저녁창. 이동을 안 보면 11:00 에 놓고 핀을 깬다."""
    diner = _poi("diner", PoiCategory.FOOD, 5, _hours(11 * 60, 22 * 60))
    far = _poi("far", PoiCategory.SIGHT, 5 + 18)  # 약 6km 북쪽
    travel = _EST.estimate(diner.coord, far.coord, TransportMode.PUBLIC).internal_minutes
    assert travel > 30  # 픽스처 전제: 11:00 시작 + 60분 + 이동 > 12:30
    problem, index = _problem(_sights() + [diner, far], candidates=[f"s{i}" for i in range(4)],
                              required=(_rv("diner"),), fixed=(_pin("far", _at(12, 30), _at(14, 30)),))
    result = solve(problem, index)
    slot = _slot(result, "diner")
    assert slot is not None and _in_meal_window(slot) and _mod(slot.start_at) >= 17 * 60, slot
    assert check_all(result, problem, index, _EST) == []


@_BOTH
@pytest.mark.parametrize("pace", [None, Pace.SLOW, Pace.PACKED])
def test_required_visit_without_dwell_uses_the_category_default_stay(solve, pace) -> None:
    """dwell null·0 → 카테고리 기본 체류에 pace 를 먹인 값(자유 후보와 같다) — 종전 고정 60분이 아니다."""
    temple = _poi("temple", PoiCategory.CULTURE, 9, _hours(10 * 60, 18 * 60))
    problem, index = _problem(_sights() + [temple], candidates=[f"s{i}" for i in range(4)],
                              required=(_rv("temple", dwell=None),))
    result = solve(replace(problem, pace=pace), index)
    slot = _slot(result, "temple")
    expected = stay_for(PoiCategory.CULTURE, pace)
    assert expected != 60 and slot is not None and slot.stay_min == expected


_TWO_WINDOWS = ((11 * 60, 15 * 60), (16 * 60, 20 * 60))


@_BOTH
@pytest.mark.parametrize(("cat", "hours", "ok"), [
    # 원문 "11:00~20:00 (준비시간 15:00~16:00)" — 파서가 휴게 구간을 버려 창 하나
    pytest.param(PoiCategory.FOOD, _hours(11 * 60, 20 * 60), _in_meal_window, id="food-11-20"),
    # 같은 요일 두 창(11~15·16~20) — 둘 중 하나 안에 완전히 든다 (OR 은 최장 창만 쓴다)
    pytest.param(PoiCategory.FOOD, tuple(OpenHour(d, lo, hi) for d in range(7) for lo, hi in _TWO_WINDOWS),
                 lambda s: any(lo <= _mod(s.start_at) and _mod(s.end_at) <= hi for lo, hi in _TWO_WINDOWS),
                 id="food-two-windows"),
    pytest.param(PoiCategory.SIGHT, _hours(10 * 60, 18 * 60), lambda s: _mod(s.start_at) >= 10 * 60,
                 id="sight-opens-10"),
])
def test_local_reproduction_samples_land_inside_their_hours(solve, cat, hours, ok) -> None:
    sample = _poi("sample", cat, 5, hours)
    problem, index = _problem(_sights() + [sample], candidates=[f"s{i}" for i in range(4)],
                              required=(_rv("sample"),))
    result = solve(problem, index)
    slot = _slot(result, "sample")
    assert slot is not None and ok(slot), slot
    assert check_all(result, problem, index, _EST) == []


# ── ③″ PBT — FOOD 필수는 식사창이 하나라도 가능하면 그 안 (OR · 그리디) ──────


@st.composite
def _food_cases(draw):
    n = draw(st.integers(min_value=2, max_value=5))
    pois = [_poi(f"r{i}", draw(st.sampled_from([PoiCategory.SIGHT, PoiCategory.CAFE,
                                                  PoiCategory.FOOD, PoiCategory.NATURE])), i)
            for i in range(n)]
    open_min = draw(st.integers(min_value=8 * 60, max_value=13 * 60))
    close_min = draw(st.integers(min_value=open_min + 120, max_value=22 * 60))
    dwell = draw(st.integers(min_value=30, max_value=90))
    # 하루 창(09~21시) ∩ 영업창에 체류가 들어가는 경우만 — 안 들어가는 경우는 아래 별도 속성
    assume(min(close_min, 21 * 60) - max(open_min, 9 * 60) >= dwell)
    diner = _poi("diner", PoiCategory.FOOD, 7, _hours(open_min, close_min))
    seed = draw(st.integers(min_value=0, max_value=2**31))
    in_pool = draw(st.booleans())
    return pois, diner, dwell, seed, in_pool


def _meal_window_feasible(diner: Poi, dwell: int) -> bool:
    oh = diner.open_hours[0]
    return any(max(lo, oh.open_min, 9 * 60) + dwell <= min(hi, oh.close_min, 21 * 60)
               for lo, hi in (_LUNCH, _DINNER))


@settings(max_examples=25, deadline=None)
@given(case=_food_cases())
@_BOTH
def test_pbt_required_food_is_in_a_meal_window_whenever_one_is_feasible(solve, case) -> None:
    pois, diner, dwell, seed, in_pool = case
    problem, index = _problem(pois + [diner],
                              candidates=[str(p.poi_id) for p in pois] + (["diner"] if in_pool else []),
                              required=(_rv("diner", dwell=dwell),), seed=seed)
    result = solve(problem, index)
    assert result is not None
    slot = _slot(result, "diner")
    assert slot is not None and slot.stay_min == dwell
    assert check_all(result, problem, index, _EST) == []
    if _meal_window_feasible(diner, dwell):
        assert _in_meal_window(slot), (slot.start_at, slot.end_at, diner.open_hours[0])


@st.composite
def _unfit_food_cases(draw):
    """체류가 하루 창 ∩ 영업창에 **안** 들어가는 식당 — 구간 길이 < 체류를 구성으로 보장한다."""
    dwell = draw(st.integers(min_value=30, max_value=90))
    open_min = draw(st.integers(min_value=8 * 60, max_value=20 * 60))
    close_min = draw(st.integers(min_value=open_min + 15, max_value=max(open_min, 9 * 60) + dwell - 1))
    diner = _poi("diner", PoiCategory.FOOD, 7, _hours(open_min, close_min))
    return [_poi(f"r{i}", PoiCategory.SIGHT, i) for i in range(3)], diner, dwell, draw(st.integers(0, 2**31))


@settings(max_examples=25, deadline=None)
@given(case=_unfit_food_cases())
@_BOTH
def test_pbt_required_food_that_cannot_fit_is_absent_without_exception(solve, case) -> None:
    pois, diner, dwell, seed = case
    oh = diner.open_hours[0]
    assert min(oh.close_min, 21 * 60) - max(oh.open_min, 9 * 60) < dwell  # 전략 전제
    problem, index = _problem(pois + [diner], candidates=[str(p.poi_id) for p in pois],
                              required=(_rv("diner", dwell=dwell),), seed=seed)
    result = solve(problem, index)
    assert result is not None
    assert _slot(result, "diner") is None
    assert check_all(result, problem, index, _EST) == []


# ── ④ 그리디 — 틈 채우기 ─────────────────────────────────────────────────


def test_fallback_fills_the_morning_before_a_lunch_required_food() -> None:
    diner = _poi("diner", PoiCategory.FOOD, 2, _hours(11 * 60, 22 * 60))
    problem, index = _problem(_sights(6) + [diner], candidates=[f"s{i}" for i in range(6)],
                              required=(_rv("diner"),))
    result = _fb_solve(problem, index)
    slots = result.days[0].slots
    diner_slot = _slot(result, "diner")
    assert diner_slot is not None and _in_meal_window(diner_slot)
    assert slots[0].poi_id != PoiId("diner") and _mod(slots[0].start_at) < 11 * 60  # 오전이 비지 않는다
    assert check_all(result, problem, index, _EST) == []


def test_fallback_without_required_visits_does_not_gap_fill_before_a_pin() -> None:
    """필수 방문이 없는 날은 종전 그대로 말단 삽입뿐 — 핀 앞 오전은 비어 있다(웜스타트 불변)."""
    problem, index = _problem(_sights(6), fixed=(_pin("s1", _at(13), _at(14)),))
    result = _fb_solve(problem, index)
    assert result.days[0].slots[0].start_at == _at(13)


# ── ⑤ 경로 e2e — 실 조립 + fake 어댑터 ───────────────────────────────────


@pytest.mark.parametrize(("pid", "category", "open_min"), [
    ("n3", PoiCategory.FOOD, 11 * 60),        # 풀 안 식당 — 11시 개장 (재현 R-food)
    ("n1", PoiCategory.SIGHT, 10 * 60),       # 풀 안 사찰 — 10시 개장 (재현 R-sight)
    ("far-lotte", PoiCategory.FOOD, 11 * 60),  # 풀 밖 식당 — 인덱스 합류 경로
])
def test_generate_places_unpinned_must_visit_inside_hours_without_409(pid, category, open_min) -> None:
    from tests.fakes.in_memory_poi import InMemoryPoi
    from tests.test_schedule_fixed_poi_index import _ALL, _D1, _client, _request

    pois = tuple(replace(p, category=category, open_hours=_hours(open_min, 22 * 60))
                 if str(p.poi_id) == pid else p for p in _ALL)
    with _client(InMemoryPoi(pois)) as client:
        response = client.post("/ai/v1/itinerary/generate", json=_request(
            (_D1,), [{"poi_id": pid, "date": _D1.isoformat(), "start": None, "dwell_min": 60}]))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["unplaced_must_visits"] == []
    placed = [s for s in body["days"][0]["slots"] if s["poi_id"] == pid]
    assert len(placed) == 1 and placed[0]["is_fixed"] is True
    start = int(placed[0]["start_at"][:2]) * 60 + int(placed[0]["start_at"][3:5])
    end = int(placed[0]["end_at"][:2]) * 60 + int(placed[0]["end_at"][3:5])
    assert start >= open_min and end <= 22 * 60
    if category is PoiCategory.FOOD:
        assert any(start >= lo and end <= hi for lo, hi in (_LUNCH, _DINNER))
    assert len(body["days"][0]["slots"]) >= 2  # 필수 방문만 덩그러니가 아니다


def test_generate_reports_unregistered_unpinned_must_visit_as_unplaced() -> None:
    from tests.test_schedule_fixed_poi_index import _D1, _GHOST, _client, _request

    with _client() as client:
        response = client.post("/ai/v1/itinerary/generate", json=_request(
            (_D1,), [{"poi_id": _GHOST, "date": _D1.isoformat(), "start": None, "dwell_min": 60}]))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["unplaced_must_visits"] == [{"poi_id": _GHOST, "reason_code": "NO_FEASIBLE_SLOT"}]
    assert "fixed_poi:fixed_poi_unresolved" in body["degradations"]


# ── ⑥ INV-1 — 풀 밖 필수 POI 는 인덱스에만 ───────────────────────────────


def test_out_of_pool_required_poi_joins_the_index_only() -> None:
    from tests.fakes.fake_clock import FakeClock
    from tests.fakes.fake_llm import FailingLlm
    from tests.fakes.in_memory_trace import InMemoryTrace
    from tests.test_e2e_boundary import _C1CFG
    from tests.test_schedule_fixed_poi_index import _SpyPoi
    from trippilot.agents.schedule.agent import ScheduleAgent, ScheduleTask
    from trippilot.agents.schedule.budget import OrchestratorConfig, allocate
    from trippilot.agents.schedule.outcome import candidates_report
    from trippilot.llm_gateway.gates.scoring import ClosedSetGate
    from trippilot.llm_gateway.gateway import GatewayFacade
    from trippilot.llm_gateway.workers.preference import PreferenceScoringWorker
    from tests.test_schedule_agent import _pool
    from tests.test_schedule_coordinator import (
        _DAY1, _NOW, _TRACE_ID, _AssemblyProvider, _Renderer, _Sink, _request as req,
    )

    # 요청 앵커(강릉) 근처지만 풀에는 없는 곳 — 핀과 달리 앵커 출발을 지키므로 닿을 수 있어야 한다
    outside = _poi("outside-pool", PoiCategory.CULTURE, 3, _hours(10 * 60, 18 * 60))
    trace, sink, spy = InMemoryTrace(), _Sink(), _SpyPoi((outside,))
    agent = ScheduleAgent(
        PreferenceScoringWorker(GatewayFacade(FailingLlm(), _Renderer(), ClosedSetGate(), _C1CFG, trace)),
        _AssemblyProvider(trace, sink, primary=True), FakeClock(), trace, poi_db=spy)
    request = replace(req(), required_visits=(_rv("outside-pool", day=_DAY1),))
    pool = _pool()
    assert outside.poi_id not in pool.poi_ids
    outcome = agent.run(ScheduleTask(
        request=request, pool=pool, persona=None, daily_rain=None, event_bonus=None,
        candidates_summary=candidates_report(pool, days=1, persona=None),
        budget=allocate(20_000, OrchestratorConfig()), started_ms=0, trace_id=_TRACE_ID, now=_NOW))

    assert spy.calls  # 풀 밖이라 실제로 조회했다
    problem = sink.problems[0]
    assert problem.required_visits == (_rv("outside-pool", day=_DAY1),)
    assert outside.poi_id not in {c.poi_id for c in problem.candidates}
    assert {c.poi_id for c in problem.candidates} <= pool.poi_ids
    assert outcome.solution is not None
    assert sum(s.poi_id == outside.poi_id for d in outcome.solution.days for s in d.slots) == 1


# ── ⑦ 다지역 — 필수 방문은 제 날의 구간에서만 ──────────────────────────────


def test_anchor_runs_place_required_visit_only_on_its_day() -> None:
    from tests.test_e2e_boundary import _POIS, make_client
    from tests.test_generate_anchor_runs import _DAY1 as R1, _DAY2 as R2, _FAR_SET, _two_region_body

    body = _two_region_body()
    body["fixed_blocks"] = [{"poi_id": "q3", "date": R2.isoformat(), "start": None, "dwell_min": 60}]
    with make_client(pois=_POIS + _FAR_SET) as client:
        response = client.post("/ai/v1/itinerary/generate", json=body)

    assert response.status_code == 200, response.text
    out = response.json()
    by_day = {d["date"]: [s["poi_id"] for s in d["slots"]] for d in out["days"]}
    assert "q3" not in by_day[R1.isoformat()]
    assert by_day[R2.isoformat()].count("q3") == 1
    assert out["unplaced_must_visits"] == []
