"""카테고리 하루 상한 — 취향이 한 카테고리를 하루 통째로 덮지 않는다 (cafe_daily_max · category_daily_max).

실측(2026-10-14, 로컬 종로 연인·취향 문화예술/미식/쇼핑/관광 + 카페/전시/맛집투어): 하루 7곳 중
문화 5곳(DEV 같은 스냅숏은 카페 연속 4곳). 취향 가점이 원하는 카테고리끼리 점수 차를 벌리면 일별
체감 항(−0.3)은 못 막는다. FOOD 하루 상한과 같은 기구(OR 초과 감점·폴백 후순위)를 전 카테고리로
넓혔다 — 하드 제약 아님, HC1~4 해 집합 불변.

증명하는 것:
  (a) 문화 편중 풀 → OR·폴백 모두 문화 ≤ 3, 남는 시간은 다른 카테고리 (상한 끈 대조는 문화 > 3)
  (b) 카페 편중 → 카페 ≤ 2
  (c) 고정 블록·필수 방문(재계획 "한 곳 추가" 포함)은 상한에서 깎이지 않는다 — 센 뒤 자유 몫만 준다
  (d) FOOD 핀 3건 + 저녁창 — 식사창 보상(+0.3)이 있어도 FOOD 상한을 넘지 않는다(감점 > 이득 전부)
  (e) PBT: 상한 안 후보가 남는 한 OR·폴백의 하루 카테고리별 수 ≤ 상한, 2종 이상 섞임, HC 위반 0
실 API 호출 0 — 어셈블리·거리 추정 전부 로컬 결정론.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone

import pytest
from hypothesis import given, settings, strategies as st

from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.constraints import check_all
from trippilot.assembly_engine.fallback_assembler import RuleFallbackAssembler
from trippilot.assembly_engine.ortools_assembler import OrToolsAssembler
from trippilot.assembly_engine.travel import TravelEstimator
from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId, ScheduleId, TransportMode
from trippilot.domain.itinerary import (FixedBlock, ItineraryProblem, RequiredVisit,
                                        TimeWindow)
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.poi import DataQuality, Poi, PoiCategory as C, PoiSource

_KST = timezone(timedelta(hours=9))
_DAY = date(2026, 8, 5)
_CFG = AssemblyConfig(or_tools_limit_ms=2000, or_tools_min_ms=50)
_CFG_OFF = replace(_CFG, cafe_daily_max=10_000, category_daily_max=10_000)


def _setup(specs, *, start_h=9, end_h=21, same_coord=False):
    """specs = [(id, 카테고리, 점수)]."""
    pois = [Poi(PoiId(pid), pid, cat,
                GeoPoint(37.751 + (0 if same_coord else 0.004 * k), 128.876), (),
                None, None, DataQuality.FULL, PoiSource.SEED, None)
            for k, (pid, cat, _) in enumerate(specs)]
    problem = ItineraryProblem(
        schedule_id=ScheduleId("s-daily-cap"), days=(_DAY,),
        candidates=tuple(ScoredPoi(PoiId(pid), sc, False) for pid, _, sc in specs),
        fixed_blocks=(), budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=TimeWindow(datetime(2026, 8, 5, start_h, 0, tzinfo=_KST),
                              datetime(2026, 8, 5, end_h, 0, tzinfo=_KST)),
        seed=7)
    return problem, {p.poi_id: p for p in pois}


def _solve_both(problem, index, cfg=_CFG):
    est = TravelEstimator(cfg)
    out = (OrToolsAssembler(index, est, cfg).solve(problem, 3000),
           RuleFallbackAssembler(index, est, cfg).solve(problem))
    for sol in out:
        assert sol is not None
        assert check_all(sol, problem, index, est) == []
    return out


def _cats(sol, index) -> Counter:
    return Counter(index[s.poi_id].category for d in sol.days for s in d.slots)


# 취향 상위 문화가 점수 차를 크게 벌린 풀 — 하루 9~21시면 문화만으로도 다 찬다
_CULTURE_HEAVY = ([(f"c{i}", C.CULTURE, .95) for i in range(8)]
                  + [(f"s{i}", C.SIGHT, .4) for i in range(3)]
                  + [(f"p{i}", C.SHOPPING, .4) for i in range(3)]
                  + [(f"n{i}", C.NATURE, .4) for i in range(3)])


def test_culture_heavy_pool_is_capped_and_mixed() -> None:
    problem, index = _setup(_CULTURE_HEAVY)
    for sol in _solve_both(problem, index):
        cats = _cats(sol, index)
        assert cats[C.CULTURE] <= _CFG.category_daily_max, sol.solve_mode
        assert len(cats) >= 2 and sum(cats.values()) > _CFG.category_daily_max, sol.solve_mode
    # 대조 — 상한을 끄면 문화가 하루를 덮는다(이 테스트가 실제로 무언가를 막는지)
    off_or, off_fb = _solve_both(problem, index, _CFG_OFF)
    assert _cats(off_or, index)[C.CULTURE] > _CFG.category_daily_max
    assert _cats(off_fb, index)[C.CULTURE] > _CFG.category_daily_max


def test_cafe_heavy_pool_is_capped_at_two() -> None:
    problem, index = _setup([(f"k{i}", C.CAFE, .95) for i in range(6)]
                            + [(f"s{i}", C.SIGHT, .4) for i in range(3)]
                            + [(f"p{i}", C.SHOPPING, .4) for i in range(3)]
                            + [(f"n{i}", C.NATURE, .4) for i in range(3)])
    for sol in _solve_both(problem, index):
        assert _cats(sol, index)[C.CAFE] <= _CFG.cafe_daily_max, sol.solve_mode
    off_or, off_fb = _solve_both(problem, index, _CFG_OFF)
    assert _cats(off_or, index)[C.CAFE] > _CFG.cafe_daily_max
    assert _cats(off_fb, index)[C.CAFE] > _CFG.cafe_daily_max


def test_single_category_pool_or_stops_at_cap_fallback_fills() -> None:
    """의도된 비대칭(FOOD 상한과 같다) — 명소만 있는 풀이면 OR 은 상한만큼만 담고(감점 > 이득,
    나머지는 차선책), 폴백은 순서만 미뤄 전부 놓는다. 해 없음은 아니다."""
    problem, index = _setup([(f"s{i}", C.SIGHT, .9) for i in range(6)])
    or_sol, fb_sol = _solve_both(problem, index)
    assert _cats(or_sol, index)[C.SIGHT] == _CFG.category_daily_max
    assert _cats(fb_sol, index)[C.SIGHT] == 6


# ── (c) 고정·필수는 깎지 않는다 ────────────────────────────────────


def test_fixed_blocks_over_cap_are_kept_and_free_share_drops() -> None:
    problem, index = _setup([(f"x{i}", C.CULTURE, .9) for i in range(4)] + _CULTURE_HEAVY)
    at = datetime(2026, 8, 5, 9, 0, tzinfo=_KST)
    pins = tuple(FixedBlock(PoiId(f"x{i}"),
                            TimeWindow(at + timedelta(minutes=150 * i),
                                       at + timedelta(minutes=150 * i + 90)), "예약")
                 for i in range(4))
    problem = replace(problem, fixed_blocks=pins)
    for sol in _solve_both(problem, index):
        placed = {str(s.poi_id) for d in sol.days for s in d.slots}
        assert {f"x{i}" for i in range(4)} <= placed, sol.solve_mode  # 핀 4건 전부
        assert _cats(sol, index)[C.CULTURE] == 4, sol.solve_mode  # 자유 문화 0


def test_required_visits_over_cap_are_all_placed() -> None:
    """재계획 "한 곳 추가"(add_one)·시각 없는 필수 방문 — 상한을 넘어도 전부 놓인다."""
    problem, index = _setup(_CULTURE_HEAVY)
    req = tuple(RequiredVisit(poi_id=PoiId(f"c{i}"), day=_DAY, dwell_min=None, reason="add_one")
                for i in range(4))
    problem = replace(problem, required_visits=req)
    for sol in _solve_both(problem, index):
        placed = {str(s.poi_id) for d in sol.days for s in d.slots}
        assert {f"c{i}" for i in range(4)} <= placed, sol.solve_mode
        assert _cats(sol, index)[C.CULTURE] == 4, sol.solve_mode  # 자유 문화는 더 안 붙는다


# ── (d) 식사창 보상이 FOOD 상한을 넘기지 못한다 ─────────────────────


def test_meal_bonus_does_not_push_food_over_cap() -> None:
    """핀 FOOD 3 + 자유 FOOD 0.9 + 관광지 0.3×6(상한 3) — 관광지가 묶여 남는 저녁창에 FOOD
    (0.9 + 창 보상 0.3 = 1.2)가 들어오던 구멍. 감점은 한 곳 이득 전부(≤1.55)보다 크다."""
    problem, index = _setup([(f"q{i}", C.FOOD, .9) for i in range(3)]
                            + [(f"f{i}", C.FOOD, .9) for i in range(3)]
                            + [(f"s{i}", C.SIGHT, .3) for i in range(6)])
    at = datetime(2026, 8, 5, 9, 0, tzinfo=_KST)
    pins = tuple(FixedBlock(PoiId(f"q{i}"),
                            TimeWindow(at + timedelta(minutes=90 * i),
                                       at + timedelta(minutes=90 * i + 60)), "예약")
                 for i in range(3))
    or_sol, _ = _solve_both(replace(problem, fixed_blocks=pins), index)
    assert _cats(or_sol, index)[C.FOOD] == _CFG.food_daily_max


# ── (e) PBT ──────────────────────────────────────────────────────
# 취향이 한 카테고리(문화·자연 90분)에 몰린 풀 — 그 카테고리 점수가 나머지보다 높고 수도 상한을 넘을
# 수 있다(하루 창 11시간이면 상한이 없을 때 넘친다). 같은 좌표. 다른 카테고리는 체류가 편중 카테고리
# 이하이고 총 체류가 하루 창보다 길다 — 편중 카테고리가 들어갈 틈이면 상한 안 후보도 들어간다
# (폴백 후순위의 전제).

_HIGH, _LOW = st.floats(0.6, 0.99), st.floats(0.0, 0.5)


@st.composite
def _skewed(draw):
    dom = draw(st.sampled_from((C.CULTURE, C.NATURE)))
    other_long = C.NATURE if dom is C.CULTURE else C.CULTURE
    specs = [(f"d{i}", dom, draw(_HIGH)) for i in range(draw(st.integers(0, 8)))]
    for cat, n in ((C.SIGHT, 3), (C.SHOPPING, 3), (C.NIGHT_VIEW, 3), (C.CAFE, 2),
                   (other_long, 3)):
        specs += [(f"{cat.value}{i}", cat, draw(_LOW)) for i in range(n)]
    return _setup(specs, start_h=10, end_h=21, same_coord=True)


def _cap(cat: C) -> int:
    return _CFG.cafe_daily_max if cat is C.CAFE else _CFG.category_daily_max


@settings(max_examples=15, deadline=None)
@given(setup=_skewed())
def test_pbt_daily_category_count_never_exceeds_cap(setup) -> None:
    problem, index = setup
    est = TravelEstimator(_CFG)
    for sol in (OrToolsAssembler(index, est, _CFG).solve(problem, 1500),
                RuleFallbackAssembler(index, est, _CFG).solve(problem)):
        assert sol is not None
        assert check_all(sol, problem, index, est) == []
        cats = _cats(sol, index)
        assert all(n <= _cap(cat) for cat, n in cats.items()), (sol.solve_mode, cats)
        if sum(cats.values()) > _CFG.category_daily_max:
            assert len(cats) >= 2


# ── 프리필터 몫 (후보 > 60) ─────────────────────────────────────────
# 실측(2026-10-14 종로): 후보 814 → 상위 60 이 문화·맛집뿐이라 상한 뒤 하루 5곳에 오후가 비었다.


def _culture_flood(n_other: int):
    specs = ([(f"c{i:02d}", C.CULTURE, .95) for i in range(70)]
             + [(f"s{i:02d}", C.SIGHT, .2) for i in range(n_other)])
    return _setup(specs, same_coord=True)


def test_prefilter_keeps_other_categories_when_one_dominates_scores() -> None:
    problem, index = _culture_flood(10)
    kept = OrToolsAssembler(index, TravelEstimator(_CFG), _CFG)._prefilter(
        list(problem.candidates), set(), _DAY, [], 60)
    assert sum(index[c.poi_id].category is C.SIGHT for c in kept) == 10
    sol = OrToolsAssembler(index, TravelEstimator(_CFG), _CFG).solve(problem, 3000)
    assert sol is not None
    assert _cats(sol, index)[C.CULTURE] <= _CFG.category_daily_max
    assert _cats(sol, index)[C.SIGHT] >= 1, "다른 카테고리 노드가 없으면 하루가 비어 간다"


def test_prefilter_still_fills_sixty_from_spill() -> None:
    problem, index = _culture_flood(2)
    kept = OrToolsAssembler(index, TravelEstimator(_CFG), _CFG)._prefilter(
        list(problem.candidates), set(), _DAY, [], 60)
    assert len(kept) == 60  # 다른 카테고리가 모자라면 넘친 후보로 다시 채운다 — 풀 손실 없음


@pytest.mark.parametrize("field", ["cafe_daily_max", "category_daily_max"])
def test_config_rejects_negative_daily_cap(field) -> None:
    with pytest.raises(ValueError, match=field):
        AssemblyConfig(**{field: -1})
