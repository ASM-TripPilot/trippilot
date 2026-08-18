"""TRIP-383 — 날씨 소프트 보정 (강수 시 실외 강등·실내 보상, TRIP-379 식사 보정 동형).

증명하는 것:
  ① 재현(실외 고점수 풀 + 비): 실외(NATURE·NIGHT_VIEW·ACTIVITY)가 무보정 대비
     줄고 실내(CULTURE·CAFE·SHOPPING)가 늘어난다 — 하드 배제는 아니다
  ② 임계 미만 강수확률·정보 없음 날짜는 무보정과 완전 동일 (해 단위 동일성)
  ③ 폴백 경로 동일 규칙 (결정론 버전)
  ④ 실외만 있는 풀 + 비: 일정은 그대로 나온다 (하드 배제 금지)
  ⑤ 다일 여행: 비 오는 날만 실내로 기울고 맑은 날은 실외 유지
  ⑥ 무보정 회귀: daily_rain_prob=None ↔ 빈 매핑 ↔ 가중 0 전부 동일 해
  ⑦ 직렬화: daily_rain_prob 왕복 보존 + 키 없는 기존 직렬화본 하위호환
  ⑧ PBT: 임의 풀·과장 가중·임의 강수맵에서도 HC1~4 불파괴(검증기 무접촉)·결정론
"""

from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, timedelta, timezone

from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.solver_engine.config import RAIN_INDOOR, RAIN_OUTDOOR, SolverConfig
from trippilot.solver_engine.constraints import check_all
from trippilot.solver_engine.fallback_solver import RuleFallbackSolver
from trippilot.solver_engine.ortools_solver import OrToolsSolver
from trippilot.solver_engine.travel import TravelEstimator
from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId, ScheduleId, TransportMode
from trippilot.domain.itinerary import ItineraryProblem, TimeWindow
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource

from tests.generators.solver import solver_setups

_KST = timezone(timedelta(hours=9))
_DAY = date(2026, 8, 5)
_DAY2 = date(2026, 8, 6)
# 소규모(≤8 노드)는 수 초 안에 OPTIMAL 도달 — 기존 솔버 테스트와 동일한 관례
_CFG = SolverConfig(or_tools_limit_ms=2000, or_tools_min_ms=50)
_CFG_EXTREME = SolverConfig(or_tools_limit_ms=1000, or_tools_min_ms=50,
                            rain_outdoor_penalty=5.0, rain_indoor_bonus=5.0)
_EST = TravelEstimator(_CFG)
_RAINY = {_DAY: 80}  # 임계(기본 60) 이상 — 우천일


def _poi(pid: str, cat: PoiCategory, k: int) -> Poi:
    return Poi(PoiId(pid), pid, cat, GeoPoint(37.751 + 0.004 * k, 128.876), (),
               None, None, DataQuality.FULL, PoiSource.SEED, None)


def _problem(specs: list[tuple[str, PoiCategory, float]], *,
             days: tuple[date, ...] = (_DAY,), rain=None, seed: int = 7):
    pois = [_poi(pid, cat, k) for k, (pid, cat, _) in enumerate(specs)]
    index = {p.poi_id: p for p in pois}
    cands = tuple(ScoredPoi(PoiId(pid), sc, False) for pid, _, sc in specs)
    problem = ItineraryProblem(
        schedule_id=ScheduleId("s-383"), days=days, candidates=cands,
        fixed_blocks=(), budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        # 창을 좁혀(09~15시) 전원 배치가 불가능하게 — 선택이 실제로 갈리는 배치
        day_window=TimeWindow(datetime(2026, 8, 5, 9, 0, tzinfo=_KST),
                              datetime(2026, 8, 5, 15, 0, tzinfo=_KST)),
        seed=seed, daily_rain_prob=rain)
    return problem, index


def _category_counts(solution, index, day=None):
    outdoor = indoor = 0
    for d in solution.days:
        if day is not None and d.date != day:
            continue
        for s in d.slots:
            cat = index[s.poi_id].category
            if cat in RAIN_OUTDOOR:
                outdoor += 1
            elif cat in RAIN_INDOOR:
                indoor += 1
    return outdoor, indoor


# 재현 풀 — 실외 고점수(자연 4) + 실내 근소 열세(문화 3).
# 점수 갭 ≤ 0.2라 보정(실외 -0.2 / 실내 +0.1)이 서열을 뒤집는 구도 —
# 갭이 한 단(≥0.3) 이상이면 취향이 그대로 이기는 것이 설계 의도다.
# 실내는 전부 CULTURE(체류 90분 = NATURE와 동일)로 맞춘다 — 체류시간 차이로
# 무보정 해가 이미 실내로 기우는 교란(짧은 CAFE·SHOPPING 다다익선)을 제거해
# "보정만이 서열을 뒤집는" 재현을 만든다.
_POOL = [("n1", PoiCategory.NATURE, .90), ("n2", PoiCategory.NATURE, .89),
         ("n3", PoiCategory.NATURE, .88), ("n4", PoiCategory.NATURE, .87),
         ("c1", PoiCategory.CULTURE, .75), ("c2", PoiCategory.CULTURE, .74),
         ("c3", PoiCategory.CULTURE, .73)]
_POOL_OUTDOOR_ONLY = [(f"n{i}", PoiCategory.NATURE, .80 - .02 * i)
                      for i in range(4)]


# ── ① 재현: 실외 고점수 풀 + 비 → 실내 우세 재배치 ────────────────────


def test_rainy_day_shifts_ortools_selection_indoor() -> None:
    on_problem, index = _problem(_POOL, rain=_RAINY)
    off_problem, _ = _problem(_POOL, rain=None)
    on = OrToolsSolver(index, _EST, _CFG).solve(on_problem, 3000)
    off = OrToolsSolver(index, _EST, _CFG).solve(off_problem, 3000)
    assert on is not None and off is not None
    assert check_all(on, on_problem, index, _EST) == []
    out_on, in_on = _category_counts(on, index)
    out_off, in_off = _category_counts(off, index)
    # 무보정 재현: 고점수 실외가 우세 — 보정 후 실내가 늘고 실외가 준다
    assert out_off > in_off
    assert in_on > in_off
    assert out_on < out_off


# ── ② 임계 미만·정보 없음 = 무보정과 완전 동일 ───────────────────────


def test_below_threshold_pop_equals_no_adjust() -> None:
    below, index = _problem(_POOL, rain={_DAY: 50})  # 임계(60) 미만
    none, _ = _problem(_POOL, rain=None)
    solver = OrToolsSolver(index, _EST, _CFG)
    assert solver.solve(below, 3000) == solver.solve(none, 3000)
    fb = RuleFallbackSolver(index, _EST, _CFG)
    assert fb.solve(below) == fb.solve(none)


def test_unknown_date_pop_equals_no_adjust() -> None:
    # 예보가 다른 날짜에만 있다 — 이 일자는 정보 없음 = 무보정 (0% 지어내기 금지)
    other, index = _problem(_POOL, rain={_DAY2: 90})
    none, _ = _problem(_POOL, rain=None)
    solver = OrToolsSolver(index, _EST, _CFG)
    assert solver.solve(other, 3000) == solver.solve(none, 3000)


# ── ③ 폴백 경로 — 같은 규칙의 결정론 버전 ────────────────────────────


def test_fallback_rainy_day_prefers_indoor() -> None:
    on_problem, index = _problem(_POOL, rain=_RAINY)
    off_problem, _ = _problem(_POOL, rain=None)
    fb = RuleFallbackSolver(index, _EST, _CFG)
    on, off = fb.solve(on_problem), fb.solve(off_problem)
    assert check_all(on, on_problem, index, _EST) == []
    out_on, in_on = _category_counts(on, index)
    out_off, in_off = _category_counts(off, index)
    assert in_on > in_off
    assert out_on < out_off
    # 슬롯 score는 원 선호 점수 그대로 — 조정 점수는 순위에만 쓰인다
    score_of = {pid: sc for pid, _, sc in _POOL}
    assert all(s.score == score_of[str(s.poi_id)]
               for d in on.days for s in d.slots)


# ── ④ 하드 배제 금지 — 실외만 있는 풀 + 비 ───────────────────────────


def test_outdoor_only_pool_still_generates_on_rainy_day() -> None:
    problem, index = _problem(_POOL_OUTDOOR_ONLY, rain=_RAINY)
    on = OrToolsSolver(index, _EST, _CFG).solve(problem, 3000)
    assert on is not None
    assert any(d.slots for d in on.days)  # 비가 와도 실외 배치 가능 (배제 아님)
    assert check_all(on, problem, index, _EST) == []
    fb = RuleFallbackSolver(index, _EST, _CFG).solve(problem)
    assert any(d.slots for d in fb.days)


# ── ⑤ 다일 여행 — 비 오는 날만 기운다 ────────────────────────────────


def test_multi_day_only_rainy_day_shifts_indoor() -> None:
    # day1만 비 — 실내는 day1에, 실외는 day2에 몰리는 것이 기대 배치
    problem, index = _problem(_POOL, days=(_DAY, _DAY2), rain={_DAY: 90})
    fb = RuleFallbackSolver(index, _EST, _CFG).solve(problem)
    out_d1, in_d1 = _category_counts(fb, index, day=_DAY)
    out_d2, in_d2 = _category_counts(fb, index, day=_DAY2)
    assert in_d1 > 0            # 우천일에 실내 배치
    assert in_d1 >= in_d2       # 실내는 우천일 우선
    assert out_d2 >= out_d1     # 실외는 맑은 날 우선


# ── ⑥ 무보정 회귀 — None ↔ 빈 매핑 ↔ 가중 0 동일 ─────────────────────


def test_no_adjust_paths_are_identical() -> None:
    none, index = _problem(_POOL, rain=None)
    empty, _ = _problem(_POOL, rain={})
    solver = OrToolsSolver(index, _EST, _CFG)
    base = solver.solve(none, 3000)
    assert base == solver.solve(empty, 3000)
    # 가중 0 = 우천일이어도 항이 전부 0 — 무보정과 동일
    zero_cfg = SolverConfig(or_tools_limit_ms=2000, or_tools_min_ms=50,
                            rain_outdoor_penalty=0.0, rain_indoor_bonus=0.0)
    rainy, _ = _problem(_POOL, rain=_RAINY)
    assert OrToolsSolver(index, TravelEstimator(zero_cfg), zero_cfg) \
        .solve(rainy, 3000) == base
    fb = RuleFallbackSolver(index, _EST, _CFG)
    assert fb.solve(none) == fb.solve(empty)


# ── ⑦ 직렬화 왕복 + 하위호환 ─────────────────────────────────────────


def test_daily_rain_prob_serialization_roundtrip() -> None:
    problem, _ = _problem(_POOL, rain={_DAY: 80, _DAY2: 20})
    restored = ItineraryProblem.from_dict(problem.to_dict())
    assert restored.daily_rain_prob == {_DAY: 80, _DAY2: 20}
    # 키가 없는 기존 직렬화본 — None으로 복원 (하위호환)
    legacy = problem.to_dict()
    del legacy["daily_rain_prob"]
    assert ItineraryProblem.from_dict(legacy).daily_rain_prob is None


# ── ⑧ PBT — 보정은 HC1~4를 깨지 않고 결정론을 유지한다 ───────────────
# (constraints.py 무접촉: 소프트 항은 목적함수·순위만 만지므로 가해집합 불변 —
#  과장 가중(5.0, 점수 최대 1.0의 5배) + 임의 강수맵에서도 위반 0을 확인)


@st.composite
def rainy_setups(draw):
    problem, index = draw(solver_setups())
    rain = {
        d: draw(st.integers(min_value=0, max_value=100))
        for d in problem.days
        if draw(st.booleans())  # 일부 날짜는 정보 없음 (부분 매핑)
    }
    return replace(problem, daily_rain_prob=rain or None), index


@settings(max_examples=15, deadline=None)
@given(setup=rainy_setups())
def test_pbt_extreme_rain_weights_never_violate_hard_constraints(setup) -> None:
    problem, index = setup
    est = TravelEstimator(_CFG_EXTREME)
    result = OrToolsSolver(index, est, _CFG_EXTREME).solve(problem, 1500)
    if result is not None:
        assert check_all(result, problem, index, est) == []
    fb = RuleFallbackSolver(index, est, _CFG_EXTREME).solve(problem)
    assert check_all(fb, problem, index, est) == []


@settings(max_examples=8, deadline=None)
@given(setup=rainy_setups())
def test_pbt_rain_correction_keeps_determinism(setup) -> None:
    problem, index = setup
    est = TravelEstimator(_CFG_EXTREME)
    solver = OrToolsSolver(index, est, _CFG_EXTREME)
    assert solver.solve(problem, 1500) == solver.solve(problem, 1500)
    fb = RuleFallbackSolver(index, est, _CFG_EXTREME)
    assert fb.solve(problem) == fb.solve(problem)


@settings(max_examples=10, deadline=None)
@given(setup=solver_setups())
def test_pbt_rain_free_problem_is_unaffected_by_rain_config(setup) -> None:
    """daily_rain_prob=None인 문제는 날씨 가중이 아무리 커도 해가 변하지 않는다."""
    problem, index = setup
    # 비교 기준은 날씨 가중만 다른 동일 설정 (시간 한도가 다르면 해 자체가 갈릴 수 있다)
    base_cfg = SolverConfig(or_tools_limit_ms=1000, or_tools_min_ms=50)
    on = OrToolsSolver(index, TravelEstimator(_CFG_EXTREME), _CFG_EXTREME) \
        .solve(problem, 1500)
    off = OrToolsSolver(index, TravelEstimator(base_cfg), base_cfg) \
        .solve(problem, 1500)
    assert on == off
    fb_on = RuleFallbackSolver(index, TravelEstimator(_CFG_EXTREME), _CFG_EXTREME) \
        .solve(problem)
    fb_off = RuleFallbackSolver(index, TravelEstimator(base_cfg), base_cfg) \
        .solve(problem)
    assert fb_on == fb_off
