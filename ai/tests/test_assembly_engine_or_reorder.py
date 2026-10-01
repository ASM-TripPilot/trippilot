"""TRIP-1178 — OR 해의 방문 집합을 고정하고 이동 거리만 줄이는 재정렬(B 단계).

배경(TRIP-1160 QA 6회차): OR 목적함수에 이동 비용이 없어(이동은 HC2 시각 제약뿐) 같은 방문
집합 안의 순서가 탐색 경로로 정해지고, 왕복·튐이 생겼다(부산 1일차 37.7km).

B = A 의 visit 고정 + A 목적식 ≥ A 목적값(사전식) 아래에서 도로 거리 합 최소. OPTIMAL 일 때만
채택하고, 아니면 A 해 그대로다(강등 아님).

증명하는 것:
  ① 지그재그 고정 픽스처(부산 실좌표)에서 집합·점수 합 그대로, 거리는 준다, HC 위반 0
  ② 사전식이라 A 의 식사 창 FOOD 배치가 유지된다
  ③ 같은 입력 2회 동일 해(결정론)
  ④ B 시한 0 이면 B 를 돌리지 않는다 — A 해 그대로
  ⑤ B 가 OPTIMAL 을 증명 못 하면 A 해 그대로(FEASIBLE 은 채택하지 않는다)
  ⑥ PBT: 임의 좌표·영업시간 풀에서 집합 동일·점수 합 동일·거리 비증가·HC 0
"""

from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

from hypothesis import given, settings
from hypothesis import strategies as st
from ortools.sat.python import cp_model

from trippilot.assembly_engine import ortools_assembler
from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.constraints import check_all
from trippilot.assembly_engine.ortools_assembler import OrToolsAssembler
from trippilot.assembly_engine.travel import TravelEstimator
from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId, ScheduleId, TransportMode
from trippilot.domain.itinerary import FixedBlock, ItineraryProblem, SolveMode, TimeWindow
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource

_KST = timezone(timedelta(hours=9))
_CFG = AssemblyConfig(or_tools_limit_ms=1000, or_tools_min_ms=50)
_CFG_A = replace(_CFG, or_tools_reorder_ms=0)  # B 끔 = A 해
_EST = TravelEstimator(_CFG)
_DAY = date(2026, 10, 10)
_SEOMYEON = GeoPoint(35.1578, 129.0597)  # 앵커(숙소) — 부산 서면

# 서→동으로 흩어진 부산 명소. 시드 3 에서 A 는 황령산→자갈치→감천(서)→광안리→동백섬→해운대(동)
# 로 가운데에서 서쪽 끝을 찍고 동쪽 끝까지 가는 왕복을 낸다(48.2km).
_BUSAN = (
    ("dongbaek", 35.1530, 129.1520, PoiCategory.NATURE, 0.90),
    ("jagalchi", 35.0966, 129.0306, PoiCategory.FOOD, 0.85),
    ("hwangnyeong", 35.1580, 129.0830, PoiCategory.NIGHT_VIEW, 0.80),
    ("haeundae", 35.1587, 129.1604, PoiCategory.NATURE, 0.75),
    ("gamcheon", 35.0975, 129.0106, PoiCategory.SIGHT, 0.70),
    ("gwangalli", 35.1532, 129.1186, PoiCategory.NATURE, 0.65),
)


def _poi(pid: str, lat: float, lng: float, category: PoiCategory,
         open_hours: tuple[OpenHour, ...] = ()) -> Poi:
    return Poi(poi_id=PoiId(pid), name=pid, category=category, coord=GeoPoint(lat, lng),
               open_hours=open_hours, avg_cost=None, rating=None, quality=DataQuality.FULL,
               source=PoiSource.SEED, confidence=None)


def _problem(cands, *, days=(_DAY,), anchor=_SEOMYEON, seed=3, fixed=(),
             transport=TransportMode.PUBLIC) -> ItineraryProblem:
    d0 = days[0]
    return ItineraryProblem(
        schedule_id=ScheduleId("trip1178"), days=days, candidates=tuple(cands),
        fixed_blocks=tuple(fixed), budget=BudgetLevel.MID, transport=transport,
        day_window=TimeWindow(datetime(d0.year, d0.month, d0.day, 9, tzinfo=_KST),
                              datetime(d0.year, d0.month, d0.day, 21, tzinfo=_KST)),
        seed=seed, anchor=anchor)


def _busan():
    pois = [_poi(pid, lat, lng, cat) for pid, lat, lng, cat, _ in _BUSAN]
    index = {p.poi_id: p for p in pois}
    cands = [ScoredPoi(PoiId(pid), score, True) for pid, *_, score in _BUSAN]
    return _problem(cands), index


def _road_km(day_slots, index, problem) -> float:
    """B 의 목적과 같은 축 — 앵커 출발·복귀 포함 도로 km(앵커 없으면 노드 사이만)."""
    pts = [index[s.poi_id].coord for s in day_slots]
    if problem.anchor is not None and pts:
        pts = [problem.anchor, *pts, problem.anchor]
    return sum(_EST.estimate(a, b, problem.transport).distance_km_range[1]
               for a, b in zip(pts, pts[1:]))


def _meal_food(slots, index, cfg) -> int:
    n = 0
    for lo, hi in (cfg.lunch_window_min, cfg.dinner_window_min):
        n += any(index[s.poi_id].category is PoiCategory.FOOD
                 and lo <= s.start_at.hour * 60 + s.start_at.minute
                 and s.start_at.hour * 60 + s.start_at.minute + s.stay_min <= hi
                 for s in slots)
    return n


def _solve(cfg, problem, index, remaining_ms=3000):
    return OrToolsAssembler(index, _EST, cfg).solve(problem, remaining_ms=remaining_ms)


# ① 지그재그 픽스처
def test_zigzag_fixture_reorder_cuts_km_keeps_set_and_score() -> None:
    problem, index = _busan()
    a = _solve(_CFG_A, problem, index)
    b = _solve(_CFG, problem, index)
    a_slots, b_slots = a.days[0].slots, b.days[0].slots
    assert {s.poi_id for s in b_slots} == {s.poi_id for s in a_slots}
    assert sorted(s.score for s in b_slots) == sorted(s.score for s in a_slots)
    km_a, km_b = _road_km(a_slots, index, problem), _road_km(b_slots, index, problem)
    assert km_a > 45.0  # 픽스처 전제: A 가 실제로 왕복을 낸다
    assert km_b < km_a * 0.95
    assert check_all(b, problem, index, _EST) == []
    assert b.solve_mode is SolveMode.OR_TOOLS and b.is_fallback is False


# ② 사전식 — 식사 창 FOOD 유지
def test_reorder_keeps_meal_window_food() -> None:
    problem, index = _busan()
    a = _solve(_CFG_A, problem, index)
    b = _solve(_CFG, problem, index)
    assert _meal_food(a.days[0].slots, index, _CFG) >= 1  # 픽스처 전제
    assert _meal_food(b.days[0].slots, index, _CFG) >= _meal_food(a.days[0].slots, index, _CFG)


# ③ 결정론
def test_reorder_is_deterministic() -> None:
    problem, index = _busan()
    assert _solve(_CFG, problem, index) == _solve(_CFG, problem, index)


def _count_solves(cfg, problem, index):
    calls: list = []
    real = cp_model.CpSolver.Solve

    def spy(self, model, *args, **kwargs):
        calls.append(model.Proto().objective.scaling_factor)
        return real(self, model, *args, **kwargs)

    with patch.object(cp_model.CpSolver, "Solve", spy):
        sol = _solve(cfg, problem, index)
    return sol, calls


# ④ B 시한 0 → B 를 돌리지 않는다
def test_reorder_budget_zero_skips_stage_b() -> None:
    problem, index = _busan()
    sol_a, calls_a = _count_solves(_CFG_A, problem, index)
    sol_b, calls_b = _count_solves(_CFG, problem, index)
    # 최소화 목적(scaling_factor ≥ 0)은 B 뿐이다 — A 는 Maximize(음의 배율)
    assert all(f < 0 for f in calls_a)
    assert any(f >= 0 for f in calls_b)
    assert sol_b != sol_a  # 픽스처에선 B 가 실제로 순서를 바꾼다


# ⑤ OPTIMAL 아니면 A 그대로
def test_reorder_not_optimal_keeps_a() -> None:
    problem, index = _busan()
    a = _solve(_CFG_A, problem, index)
    with patch.object(ortools_assembler, "_REORDER_DET_LIMIT", 1e-9):
        b = _solve(_CFG, problem, index)
    assert b == a


# ⑥ PBT — 임의 좌표·영업시간 풀
@st.composite
def _pools(draw):
    n = draw(st.integers(min_value=2, max_value=8))
    d0 = draw(st.dates(min_value=date(2026, 10, 1), max_value=date(2026, 10, 20)))
    n_days = draw(st.integers(min_value=1, max_value=2))
    days = tuple(d0 + timedelta(days=k) for k in range(n_days))
    pois = []
    for i in range(n):
        hours: tuple[OpenHour, ...] = ()
        if draw(st.booleans()):
            open_min = draw(st.integers(min_value=7 * 60, max_value=13 * 60))
            close_min = draw(st.integers(min_value=open_min + 120, max_value=23 * 60))
            hours = tuple(OpenHour(day_of_week=(d0 + timedelta(days=k)).weekday(),
                                   open_min=open_min, close_min=close_min)
                          for k in range(n_days))
        pois.append(_poi(f"p{i}",
                         35.15 + draw(st.floats(-0.06, 0.06, allow_nan=False)),
                         129.06 + draw(st.floats(-0.08, 0.08, allow_nan=False)),
                         draw(st.sampled_from(list(PoiCategory))), hours))
    index = {p.poi_id: p for p in pois}
    cands = [ScoredPoi(p.poi_id, draw(st.floats(0, 1, allow_nan=False)), draw(st.booleans()))
             for p in pois]
    fixed = ()
    if draw(st.booleans()):  # 고정 블록 POI 는 영업정보 없음 — 사용자 예약 자체가 HC1 을 어기지 않게
        pois[0] = replace(pois[0], open_hours=())
        index[pois[0].poi_id] = pois[0]
        fb_start = datetime(d0.year, d0.month, d0.day, 13, 0, tzinfo=_KST)
        fixed = (FixedBlock(poi_id=pois[0].poi_id,
                            window=TimeWindow(start=fb_start, end=fb_start + timedelta(minutes=60)),
                            reason="user_fixed"),)
    anchor = draw(st.one_of(st.none(), st.just(_SEOMYEON)))
    transport = draw(st.sampled_from(list(TransportMode)))
    return _problem(cands, days=days, anchor=anchor, seed=draw(st.integers(0, 2**31)),
                    fixed=fixed, transport=transport), index


@settings(max_examples=25, deadline=None)
@given(setup=_pools())
def test_reorder_property_same_set_score_and_no_longer(setup) -> None:
    problem, index = setup
    a = _solve(_CFG_A, problem, index, remaining_ms=4000)
    b = _solve(_CFG, problem, index, remaining_ms=4000)
    assert (a is None) == (b is None)
    if a is None:
        return
    assert check_all(b, problem, index, _EST) == []
    for da, db in zip(a.days, b.days, strict=True):
        assert {s.poi_id for s in db.slots} == {s.poi_id for s in da.slots}
        assert sorted(s.score for s in db.slots) == sorted(s.score for s in da.slots)
        assert db.fixed_blocks == da.fixed_blocks
        # B 는 미터 정수로 푼다 — 반올림 몫(구간당 0.5m)만 허용
        tol = 0.001 * (len(db.slots) + 1)
        assert _road_km(db.slots, index, problem) <= _road_km(da.slots, index, problem) + tol
