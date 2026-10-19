"""못 놓인 필수 방문의 까닭 + 빈 틈에 드는 후보 — `explain_unplaced` (다시 짜기 1회 수리, 2026-10-18).

증명하는 것:
  ① 까닭 5종이 각각 그 상황에서만 나온다 — closed·hours·far·full·fits. 하루·카테고리 상한은 까닭이
     아니다(필수 방문엔 소프트 항이라 지배 항을 못 이긴다).
  ② 놓인 곳·좌표 미상은 판정하지 않는다.
  ⑤ 규칙 조립기의 틈은 하루 창 안으로 잘린다 — 창 밖 잠금 앞 틈에 식당이 창 밖으로 놓이던 회귀(PBT P1 이 찾음).
  ⑥ `repair_gaps` — 틈 번호·경계 문구·앞 장소 기준 거리.
  ③ PBT P1 — `fits` 의 시각에 그 후보를 끼워 넣어도 HC1~4·시작 하한·좌표 검증이 깨지지 않는다
     (거짓 "들어간다"를 LLM 후보로 싣지 않는다).
  ④ PBT P2 — 혼자인 필수 방문은 OR·규칙 **둘 다** 까닭이 closed·hours·far 가 아닐 때만 놓는다(OR 은 페이스
     없을 때 — 페이스 해가 없으면 페이스 없이 다시 푸는 재시도가 있어서다).
     앵커를 빼면 놓이는 것 ⇔ far·fits, 휴무 ⇔ closed — 라벨이 솔버의 실제 판정과 맞는다.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, timedelta, timezone

from hypothesis import HealthCheck, assume, event, given, settings
from hypothesis import strategies as st

from trippilot.assembly_engine.config import AssemblyConfig, stay_for
from trippilot.assembly_engine.constraints import check_all, check_hc2_coords_known, check_not_before
from trippilot.assembly_engine.fallback_assembler import RuleFallbackAssembler, explain_unplaced
from trippilot.assembly_engine.ortools_assembler import OrToolsAssembler
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
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource

_KST = timezone(timedelta(hours=9))
_DAY = date(2026, 10, 14)  # 수요일
_WD = _DAY.weekday()
_CFG = AssemblyConfig(or_tools_min_ms=50)
_EST = TravelEstimator(_CFG)
_ANCHOR = GeoPoint(37.5665, 126.9780)


def _at(h: int, m: int = 0) -> datetime:
    return datetime(2026, 10, 14, h, m, tzinfo=_KST)


def _poi(pid: str, cat: PoiCategory = PoiCategory.SIGHT, hours: tuple[OpenHour, ...] = (),
         coord: GeoPoint = _ANCHOR) -> Poi:
    return Poi(poi_id=PoiId(pid), name=pid, category=cat, coord=coord, open_hours=hours,
               avg_cost=None, rating=None, quality=DataQuality.FULL, source=PoiSource.SEED,
               confidence=None)


def _rv(pid: str, dwell: int | None = None) -> RequiredVisit:
    return RequiredVisit(poi_id=PoiId(pid), day=_DAY, dwell_min=dwell, reason="llm_compose")


def _problem(*, required=(), pins=(), window=((9, 0), (21, 0)), not_before=None,
             anchor: GeoPoint | None = _ANCHOR, pace=None) -> ItineraryProblem:
    return ItineraryProblem(
        schedule_id=ScheduleId("explain"), days=(_DAY,), candidates=(), fixed_blocks=tuple(pins),
        budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=TimeWindow(_at(*window[0]), _at(*window[1])), seed=1, anchor=anchor,
        pace=pace, not_before=not_before, required_visits=tuple(required))


def _pin(pid: str, start: datetime, end: datetime) -> FixedBlock:
    return FixedBlock(poi_id=PoiId(pid), window=TimeWindow(start, end), reason="user")


def _slot(pid: str, start: datetime, end: datetime) -> VisitSlot:
    return VisitSlot(poi_id=PoiId(pid), start_at=start, end_at=end,
                     stay_min=int((end - start).total_seconds() // 60), score=0.0, is_llm_score=False)


def _solution(*slots: VisitSlot) -> ItinerarySolution:
    ordered = tuple(sorted(slots, key=lambda s: s.start_at))
    return ItinerarySolution(schedule_id=ScheduleId("explain"), days=(DaySolution(
        date=_DAY, slots=ordered, fixed_blocks=()),), is_fallback=False,
        solve_mode=SolveMode.OR_TOOLS, assembly_run=None)


def _why(problem, solution, index, probe=(), cfg=_CFG):
    return explain_unplaced(problem, solution, index, TravelEstimator(cfg), cfg, probe)


# ── ① 까닭 5종 ───────────────────────────────────────────────────────────


def test_그날_휴무면_closed() -> None:
    monday = (OpenHour(day_of_week=0, open_min=540, close_min=1260),)
    index = {PoiId("v"): _poi("v", hours=monday)}
    why, _ = _why(_problem(required=(_rv("v"),)), _solution(), index)
    assert why == {PoiId("v"): "closed"}


def test_하한_뒤로_영업시간이_안_남으면_hours() -> None:
    """09~10시 영업인데 지금이 10:30 — 앵커를 빼도 못 간다."""
    index = {PoiId("v"): _poi("v", hours=(OpenHour(_WD, 540, 600),))}
    why, _ = _why(_problem(required=(_rv("v"),), not_before=_at(10, 30)), _solution(), index)
    assert why == {PoiId("v"): "hours"}


def test_지금_위치에서_멀어_영업_중에_못_닿으면_far() -> None:
    """18시 마감 카페(45분), 지금 17:00, 40km 밖 — 앵커 이동만 빼면 들어간다."""
    far_anchor = GeoPoint(_ANCHOR.lat + 0.36, _ANCHOR.lng)  # ≈40km
    index = {PoiId("v"): _poi("v", PoiCategory.CAFE, hours=(OpenHour(_WD, 540, 1080),))}
    problem = _problem(required=(_rv("v"),), not_before=_at(17), anchor=far_anchor)
    why, _ = _why(problem, _solution(), index)
    assert why == {PoiId("v"): "far"}


def test_빈_하루엔_되는데_지금_틈엔_안_들어가면_full() -> None:
    """핀 둘이 30분 틈만 남기고 체류는 75분(SIGHT)."""
    pins = (_pin("a", _at(9), _at(12)), _pin("b", _at(12, 30), _at(21)))
    index = {PoiId(p): _poi(p) for p in ("a", "b", "v")}
    problem = _problem(required=(_rv("v"),), pins=pins)
    why, _ = _why(problem, _solution(_slot("a", _at(9), _at(12)), _slot("b", _at(12, 30), _at(21))),
                  index)
    assert why == {PoiId("v"): "full"}


def test_틈이_비어_있으면_fits() -> None:
    pins = (_pin("a", _at(9), _at(10)),)
    index = {PoiId(p): _poi(p) for p in ("a", "v")}
    why, _ = _why(_problem(required=(_rv("v"),), pins=pins), _solution(_slot("a", _at(9), _at(10))),
                  index)
    assert why == {PoiId("v"): "fits"}


def test_놓인_곳과_좌표_미상은_판정하지_않는다() -> None:
    index = {PoiId("placed"): _poi("placed")}  # "ghost" 는 인덱스에 없다
    problem = _problem(required=(_rv("placed"), _rv("ghost")))
    why, _ = _why(problem, _solution(_slot("placed", _at(10), _at(11, 15))), index)
    assert why == {}


def test_틈_검사는_체류가_그_틈에_들어가는_후보만_시각과_함께_낸다() -> None:
    """12~13시 틈 — 45분 카페는 그 안의 시각, 120분 액티비티는 없음. 놓인 곳은 후보가 아니다."""
    slots = (_slot("a", _at(9), _at(12)), _slot("b", _at(13), _at(21)))
    index = {PoiId("a"): _poi("a"), PoiId("b"): _poi("b"),
             PoiId("cafe"): _poi("cafe", PoiCategory.CAFE),
             PoiId("act"): _poi("act", PoiCategory.ACTIVITY)}
    problem = _problem(pins=(_pin("a", _at(9), _at(12)), _pin("b", _at(13), _at(21))))
    _, fits = _why(problem, _solution(*slots), index, probe=(PoiId("cafe"), PoiId("act"), PoiId("a")))
    assert set(fits) == {PoiId("cafe")}
    assert _at(12) <= fits[PoiId("cafe")] <= _at(13) - timedelta(minutes=45)


def test_하루_상한이_빠듯해도_까닭은_full_fits_뿐이다() -> None:
    """카페 하루 1곳·카테고리 1곳 — 필수 방문에 상한은 소프트라 까닭으로 지어내지 않는다."""
    tight = AssemblyConfig(or_tools_min_ms=50, cafe_daily_max=1, category_daily_max=1,
                           food_daily_max=1)
    index = {PoiId(p): _poi(p, PoiCategory.CAFE) for p in ("c1", "c2", "c3", "c4")}
    problem = _problem(required=tuple(_rv(p) for p in ("c1", "c2", "c3", "c4")),
                       window=((9, 0), (12, 0)))
    placed = _solution(_slot("c1", _at(9), _at(9, 45)), _slot("c2", _at(9, 45), _at(10, 30)),
                       _slot("c3", _at(10, 30), _at(11, 15)))
    why, _ = _why(problem, placed, index, cfg=tight)
    assert why == {PoiId("c4"): "fits"}
    why, _ = _why(problem, _solution(_slot("c1", _at(9), _at(11, 30))), index, cfg=tight)
    assert set(why.values()) == {"full"}


# ── ⑤ 틈은 하루 창 안 (규칙 조립기 회귀) ─────────────────────────────────


def test_창_밖_잠금_앞_틈에서도_식당은_창_안에만_놓인다() -> None:
    """"6시까지"(창 끝 18:00) + 19시 저녁 잠금 — 마지막 틈이 잠금까지 늘어나 식당이 식사창(창으로 안 잘림)대로
    18시 뒤에 놓이면 HC4 위반이라 체인 전 단계가 실패한다. 틈을 창으로 자르면 창 안에 놓거나 안 놓는다."""
    index = {PoiId("dinner"): _poi("dinner"), PoiId("food"): _poi("food", PoiCategory.FOOD)}
    problem = _problem(required=(_rv("food"),), pins=(_pin("dinner", _at(19), _at(20)),),
                       window=((9, 0), (18, 0)), not_before=_at(17, 10))
    solution = RuleFallbackAssembler(index, _EST, _CFG).solve(problem)
    food = [s for s in solution.days[0].slots if s.poi_id == PoiId("food")]
    assert all(s.end_at <= _at(18) for s in food), food
    assert not check_all(replace(solution, days=(replace(
        solution.days[0], slots=tuple(s for s in solution.days[0].slots if s.poi_id != PoiId("dinner")),
        fixed_blocks=()),)), replace(problem, fixed_blocks=()), index, _EST)


# ── ⑥ repair_gaps ────────────────────────────────────────────────────────


def test_repair_gaps_는_틈마다_번호_경계_앞_장소_거리를_낸다() -> None:
    from trippilot.agents.planb.composition import repair_gaps
    from trippilot.assembly_engine.travel import haversine_km

    a = _poi("a", coord=_ANCHOR)
    b = _poi("b", coord=GeoPoint(_ANCHOR.lat + 0.01, _ANCHOR.lng))
    x = _poi("x", PoiCategory.CAFE, coord=GeoPoint(_ANCHOR.lat + 0.02, _ANCHOR.lng))
    y = _poi("y", PoiCategory.CAFE, coord=GeoPoint(_ANCHOR.lat - 0.02, _ANCHOR.lng))
    index = {p.poi_id: p for p in (a, b, x, y)}
    slots = (_slot("b", _at(14), _at(15)), _slot("a", _at(10), _at(11)))  # 정렬 안 된 입력
    fits = {PoiId("x"): _at(11, 20), PoiId("y"): _at(15, 30)}
    gap_of, labels, near = repair_gaps(slots, _at(9), _at(21), fits, index, GeoPoint(37.0, 127.0))
    assert gap_of == {PoiId("x"): 1, PoiId("y"): 2}
    assert labels == {1: "11:00~14:00 · 앞: a · 뒤: b", 2: "15:00~21:00 · 앞: b"}
    assert near[PoiId("x")] == haversine_km(a.coord, x.coord)  # 그 틈의 앞 장소에서
    assert near[PoiId("y")] == haversine_km(b.coord, y.coord)
    gap_of, labels, near = repair_gaps((), _at(13), _at(21), {PoiId("x"): _at(13)}, index, _ANCHOR)
    assert labels == {0: "13:00~21:00"} and near[PoiId("x")] == haversine_km(_ANCHOR, x.coord)


# ── ③·④ PBT ─────────────────────────────────────────────────────────────

_CATS = (PoiCategory.SIGHT, PoiCategory.CAFE, PoiCategory.FOOD, PoiCategory.NATURE,
         PoiCategory.ACTIVITY, PoiCategory.CULTURE)
_PACES = (None, Pace.SLOW, Pace.BALANCED, Pace.PACKED)


@st.composite
def _hours(draw) -> tuple[OpenHour, ...]:
    """0~3 구간 — 그날(수) 구간이 없을 수도(휴무), 아예 없을 수도(정보 없음) 있다."""
    out = []
    for _ in range(draw(st.integers(0, 3))):
        dow = draw(st.sampled_from((_WD, _WD, (_WD + 1) % 7)))
        lo = draw(st.integers(6 * 60, 20 * 60))
        out.append(OpenHour(dow, lo, lo + draw(st.integers(30, 10 * 60))))
    return tuple(out)


@st.composite
def _coord(draw, spread: float) -> GeoPoint:
    return GeoPoint(_ANCHOR.lat + draw(st.floats(-spread, spread)),
                    _ANCHOR.lng + draw(st.floats(-spread, spread)))


@st.composite
def _setting(draw):
    ws = draw(st.integers(8 * 2, 11 * 2)) * 30
    we = draw(st.integers(17, 22)) * 60
    nb = draw(st.one_of(st.none(), st.integers(ws, ws + 6 * 60)))
    window = ((ws // 60, ws % 60), (we // 60, we % 60))
    return dict(window=window,
                not_before=None if nb is None else _at(nb // 60, nb % 60),
                # 가깝거나(이동 무시 가능) 30~40km 밖 — far 가 드물지 않게 섞는다
                anchor=draw(st.one_of(_coord(0.02), _coord(0.4))), pace=draw(st.sampled_from(_PACES)))


@st.composite
def _day_case(draw):
    s = draw(_setting())
    index: dict[PoiId, Poi] = {}
    pins = []
    t = s["window"][0][0] * 60 + s["window"][0][1] + draw(st.integers(0, 120))
    for i in range(draw(st.integers(0, 3))):
        dur = draw(st.integers(30, 120))
        if t + dur > 23 * 60:
            break
        pid = f"pin{i}"
        index[PoiId(pid)] = _poi(pid, draw(st.sampled_from(_CATS)), coord=draw(_coord(0.02)))
        pins.append(_pin(pid, _at(t // 60, t % 60), _at((t + dur) // 60, (t + dur) % 60)))
        t += dur + draw(st.integers(30, 180))
    required = []
    for i in range(draw(st.integers(1, 4))):
        pid = f"rv{i}"
        index[PoiId(pid)] = _poi(pid, draw(st.sampled_from(_CATS)), draw(_hours()), draw(_coord(0.05)))
        required.append(_rv(pid, draw(st.one_of(st.none(), st.integers(20, 150)))))
    probe = []
    for i in range(draw(st.integers(0, 4))):
        pid = f"x{i}"
        index[PoiId(pid)] = _poi(pid, draw(st.sampled_from(_CATS)), draw(_hours()), draw(_coord(0.05)))
        probe.append(PoiId(pid))
    return _problem(required=required, pins=pins, **s), index, tuple(probe)


def _clean(solution, problem, index) -> bool:
    return not (check_all(solution, problem, index, _EST)
                + check_not_before(solution, problem, index, _EST)
                + check_hc2_coords_known(solution, index))


@settings(max_examples=200, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(_day_case())
def test_P1_틈에_든다는_시각에_끼워도_검증이_깨지지_않는다(case) -> None:
    problem, index, probe = case
    base = RuleFallbackAssembler(index, _EST, _CFG).solve(problem)
    assume(_clean(base, problem, index))
    why, fits = explain_unplaced(problem, base, index, _EST, _CFG, probe)
    event(f"fits={min(len(fits), 2)}")  # 공허 방지 — 끼워 볼 것이 있는 예가 충분한지
    placed = {s.poi_id for s in base.days[0].slots}
    assert set(why) == {rv.poi_id for rv in problem.required_visits if rv.poi_id not in placed}
    for pid, t in fits.items():
        stay = stay_for(index[pid].category, problem.pace)
        day = base.days[0]
        slots = tuple(sorted((*day.slots, _slot(str(pid), t, t + timedelta(minutes=stay))),
                             key=lambda s: s.start_at))
        grown = replace(base, days=(replace(day, slots=slots),))
        assert _clean(grown, problem, index), (pid, t)


@st.composite
def _lone_case(draw):
    s = draw(_setting())
    poi = _poi("v", draw(st.sampled_from(_CATS)), draw(_hours()), draw(_coord(0.05)))
    rv = _rv("v", draw(st.one_of(st.none(), st.integers(20, 150))))
    return _problem(required=(rv,), **s), {poi.poi_id: poi}


def _places(problem, index) -> tuple[bool, bool]:
    rule = RuleFallbackAssembler(index, _EST, _CFG).solve(problem)
    ortools = OrToolsAssembler(index, _EST, _CFG).solve(problem, 2_000)
    # 놓을 수 있는 노드가 하나도 없으면 OR 은 해 없음(None)이다 — 빈 회로가 불가라(`_hint_path`
    # 독스트링). 체인은 규칙으로 내려가고 거기서도 안 놓이니 "안 놓음"과 같다.
    return (ortools is not None and any(s.poi_id == PoiId("v") for s in ortools.days[0].slots),
            any(s.poi_id == PoiId("v") for s in rule.days[0].slots))


@settings(max_examples=200, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(_lone_case())
def test_P2_혼자인_필수_방문은_두_어셈블러가_까닭대로_놓는다(case) -> None:
    problem, index = case
    why, _ = explain_unplaced(problem, _solution(), index, _EST, _CFG)
    code = why[PoiId("v")]
    event(code)  # 네 라벨이 다 나오는지(--hypothesis-show-statistics)
    assert code in {"closed", "hours", "far", "fits"}  # 빈 하루에 full 은 없다
    # OR 은 페이스 해가 없으면 페이스 없이(짧은 체류로) 한 번 더 푼다(`ortools_assembler` 재시도) — 혼자인
    # 방문에선 페이스 체류가 안 들어가면 해가 없어 그 재시도가 놓는다. 까닭은 페이스 체류로 말하므로(실제
    # 해는 대개 페이스 해에서 나온다) OR 대조는 페이스가 없을 때만이다(리뷰 10-19: 시드 6/60 에서 깨졌다).
    # 규칙 조립기는 재시도가 없어 늘 대조한다.
    def check(p, expected: bool) -> None:
        by_or, by_rule = _places(p, index)
        assert by_rule == expected, code
        if p.pace is None:
            assert by_or == expected, code

    check(problem, code == "fits")
    # 라벨이 실제 판정과 맞는다 — 앵커만 빼면 놓인다 ⇔ far·fits, 휴무 ⇔ 그날 영업 구간 0
    check(replace(problem, anchor=None), code in {"far", "fits"})
    poi = index[PoiId("v")]
    assert (code == "closed") == bool(poi.open_hours and all(h.day_of_week != _WD for h in poi.open_hours))
