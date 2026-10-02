"""TRIP-1183 — OR 프리필터의 식사창 FOOD 예약석.

배경(TRIP-1160 QA 6회차 '미식 반영 비일관'): 후보 > 60 이면 OR 단계는 점수 상위 60 만
노드로 남긴다. 규칙 점수 모드에서 FOOD 의 규칙 순위가 86~108위라 프리필터가 FOOD 를 전부
잘라, 같은 입력에서 **OR 해는 식당 0, 폴백 그리디는 식당 4**(폴백은 식사창 food-first)로
갈렸다. `meal_bonus` 는 프리필터 **뒤** 목적함수라 노드가 없으면 줄 대상이 없다.

수정: 아직 닿는 식사창에 체류가 들어가는 영업 FOOD 상위 k건(k = 그 창 수)을 고정 블록 다음
자리로 확보하고 나머지를
점수순으로 채운 뒤, 남긴 집합을 다시 점수 내림차순 + poi_id 로 정렬한다(해 품질이 노드 순서에
의존한다 — 정렬을 빼면 부산 gourmet −13% 실측). 노드 수 상한 60 유지.

증명하는 것:
  ① PBT(프리필터 단독): 후보 밖 POI 없음·중복 없음·≤ 60 · 순서 = 점수순+poi_id · 고정 블록
     우선 · 그날 영업 FOOD 가 min(k, 그날 영업 FOOD 수, 60 − 고정)건 이상 남는다 · 예약석이
     아닌 자리는 점수 서열 그대로(밀려난 후보보다 낮은 비FOOD 가 남지 않는다)
  ② 식사 보정 off(`meal_bonus=0`) 구성은 예약석 0 — 순수 점수 상위 60(종전 집합)
  ③ 석 자격은 폴백 food-first 와 같은 기준 — 재계획 하한이 지난 창·하루 창 밖 창은 석이 없고,
     영업창이 식사창과 안 겹치는 FOOD 는 석을 받지 않는다
  ④ 규칙 모드 모양의 풀(FOOD 점수 최하위): OR **노드 집합**의 FOOD 수 ≥ 폴백의 식사창 FOOD 수
     (수정 전 0). OR 해 자체는 HC 0 · 하루 FOOD ≤ 3 · 같은 입력 2회 동일만 단언한다.
CP-SAT 해의 내용(OR 이 식당을 몇 곳 놓는가)은 단언하지 않는다 — 결정론 한도에서 멈춘 FEASIBLE
해라 탐색 시드·플랫폼에 따라 뒤집힌다(안티패턴 189행). 이 픽스처는 FOOD 0 해가 목적값도 더
높다(점수 갭 > meal_bonus) — 석은 자리만 남기고, 놓을지는 목적함수가 정한다.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.assembly_engine.config import AssemblyConfig, stay_for
from trippilot.assembly_engine.constraints import check_all
from trippilot.assembly_engine.fallback_assembler import RuleFallbackAssembler
from trippilot.assembly_engine.ortools_assembler import _PREFILTER_TOP_K, OrToolsAssembler
from trippilot.assembly_engine.travel import TravelEstimator
from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId, ScheduleId, TransportMode
from trippilot.domain.itinerary import ItineraryProblem, SolveMode, TimeWindow
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.poi import counts_as_food, DataQuality, OpenHour, Poi, PoiCategory, PoiSource

_KST = timezone(timedelta(hours=9))
_DAY = date(2026, 8, 5)                 # 수요일 (weekday 2)
_CLOSED = (OpenHour(day_of_week=0, open_min=600, close_min=1200),)   # 월요일만 — _DAY 휴무
_CFG = AssemblyConfig()
# 보정 off 격리 — FOOD 하루 상한도 끈다(food_daily_max 크게). 상한이 켜지면 프리필터 FOOD 몫
# (#859 후속)이 '순수 점수 상위 60' 을 바꾸는데, 이 config 가 시험하는 성질은 예약석 0 뿐이다.
_CFG_OFF = AssemblyConfig(meal_bonus=0.0, meal_penalty=0.0, food_daily_max=10_000)
_SEATS = 2                              # 식사창 수 (점심·저녁)
_STAY = stay_for(PoiCategory.FOOD, None)
_FULL_DAY = (0, 24 * 60)


def _slots(asm: OrToolsAssembler, floor: int | None = None, day=_FULL_DAY):
    return asm._meal_slots(day[0], day[1], floor, _STAY)


def _key(c: ScoredPoi):
    return (-c.score, str(c.poi_id))


def _poi(pid: str, cat: PoiCategory, k: int, hours=()) -> Poi:
    # 7×n 격자, 약 400m 간격 — 하루 동선 안
    return Poi(PoiId(pid), pid, cat,
               GeoPoint(35.150 + 0.004 * (k % 7), 129.050 + 0.004 * (k // 7)), hours,
               None, None, DataQuality.FULL, PoiSource.SEED, None)


# ── ① PBT — 프리필터 단독 ─────────────────────────────────────────────

_NON_FOOD = [c for c in PoiCategory if c is not PoiCategory.FOOD]


@st.composite
def _pools(draw):
    n = draw(st.integers(_PREFILTER_TOP_K + 1, _PREFILTER_TOP_K + 40))
    pois, cands = [], []
    for k in range(n):
        cat = draw(st.sampled_from(list(PoiCategory)))
        closed = draw(st.integers(0, 2)) == 0
        pid = f"p{k:03d}"
        pois.append(_poi(pid, cat, k, _CLOSED if closed else ()))
        # 점수 동률이 자주 나오게 거친 격자 — poi_id tie-break 를 같이 시험
        cands.append(ScoredPoi(PoiId(pid), draw(st.integers(0, 20)) / 20, False))
    fixed = draw(st.sets(st.sampled_from([c.poi_id for c in cands]), max_size=70))
    return {p.poi_id: p for p in pois}, cands, frozenset(fixed)


def _open_food(index, c) -> bool:
    p = index[c.poi_id]
    return p.category is PoiCategory.FOOD and p.open_hours != _CLOSED


@settings(max_examples=200, deadline=None)
@given(pool=_pools())
def test_prefilter_food_seat_properties(pool) -> None:
    index, cands, fixed = pool
    asm = OrToolsAssembler(index, TravelEstimator(_CFG), _CFG)

    kept = asm._prefilter(list(cands), fixed, _DAY, _slots(asm), _STAY)

    ids = [c.poi_id for c in kept]
    assert len(ids) == len(set(ids))                                 # 중복 없음
    assert set(ids) <= {c.poi_id for c in cands}                     # 후보 밖 POI 없음 (INV-1)
    assert len(kept) == _PREFILTER_TOP_K                             # 상한 그대로
    assert kept == sorted(kept, key=_key)                            # 노드 순서 규칙
    n_fixed = len(fixed & {c.poi_id for c in cands})
    assert sum(c.poi_id in fixed for c in kept) == min(n_fixed, _PREFILTER_TOP_K)  # 고정 우선
    open_food = [c for c in cands if c.poi_id not in fixed and _open_food(index, c)]
    kept_food = [c for c in kept if c.poi_id not in fixed and _open_food(index, c)]
    assert len(kept_food) >= min(_SEATS, len(open_food), _PREFILTER_TOP_K - n_fixed)
    # 예약석 말고는 **같은 부류(FOOD류 / 비FOOD) 안에서** 점수 서열 그대로. FOOD류는 몫
    # (max(예약석, food_daily_max×4))까지만 — 몫이 찼을 때만 서열보다 먼저 밀려난다(#859 후속:
    # 미식 취향에서 상위 60 이 전부 FOOD 라 비FOOD 노드 0 이던 것). 비FOOD 가 모자라면 넘친
    # FOOD 로 60 을 채운다(위 `len == 60`).
    food_quota = max(_SEATS, _CFG.food_daily_max * 4)
    is_food = lambda c: counts_as_food(index[c.poi_id])  # noqa: E731
    kept_free_food = [c for c in kept if c.poi_id not in fixed and is_food(c)]
    kept_free_non = [c for c in kept if c.poi_id not in fixed and not is_food(c)]
    dropped = [c for c in cands if c.poi_id not in set(ids)]
    if any(not is_food(d) for d in dropped):
        assert len(kept_free_food) <= food_quota          # 비FOOD 를 밀어낸 FOOD 는 몫 안에서만
    seat_ids = {c.poi_id for c in sorted(open_food, key=_key)[:_SEATS]}
    free_kept = [x for x in kept_free_food + kept_free_non if x.poi_id not in seat_ids]
    for d in dropped:
        same = kept_free_food if is_food(d) else kept_free_non
        assert all(_key(x) < _key(d) for x in same if x.poi_id not in seat_ids)  # 부류 안 서열
        # 밀려난 이유는 둘 중 하나 — 상위 60 절단(남은 비고정·비예약석이 전부 서열 위) 또는
        # (FOOD류만) 몫이 참.
        cut_by_top_k = all(_key(x) < _key(d) for x in free_kept)
        assert cut_by_top_k or (is_food(d) and len(kept_free_food) >= food_quota)


@settings(max_examples=50, deadline=None)
@given(pool=_pools())
def test_meal_correction_off_reserves_no_seats(pool) -> None:
    """보정 off 는 예약석 0 — 고정 다음 순수 점수 상위 60. 예약석은 `meal_bonus` 가 보상할
    노드를 남기려는 것이라, 보상이 없으면 점수 높은 후보를 밀어낼 이유가 없다."""
    index, cands, fixed = pool
    asm = OrToolsAssembler(index, TravelEstimator(_CFG_OFF), _CFG_OFF)

    kept = asm._prefilter(list(cands), fixed, _DAY, _slots(asm), _STAY)

    ranked = sorted(cands, key=_key)
    expect = ([c for c in ranked if c.poi_id in fixed]
              + [c for c in ranked if c.poi_id not in fixed])[:_PREFILTER_TOP_K]
    assert kept == sorted(expect, key=_key)


def test_closed_food_takes_no_seat() -> None:
    """그날 휴무인 FOOD 는 노드가 못 되니 자리를 받지 않는다 — 영업 FOOD 만 예약석."""
    pois = [_poi(f"s{k:02d}", PoiCategory.SIGHT, k) for k in range(70)]
    pois += [_poi("f-closed", PoiCategory.FOOD, 70, _CLOSED),
             _poi("f-open", PoiCategory.FOOD, 71)]
    index = {p.poi_id: p for p in pois}
    cands = [ScoredPoi(p.poi_id, 0.9 if p.category is PoiCategory.SIGHT else
                       (0.2 if p.poi_id == "f-closed" else 0.1), False) for p in pois]
    asm = OrToolsAssembler(index, TravelEstimator(_CFG), _CFG)

    kept = {c.poi_id for c in asm._prefilter(cands, frozenset(), _DAY, _slots(asm), _STAY)}

    assert "f-open" in kept and "f-closed" not in kept


# ── ③ 석 자격 = 아직 닿는 식사창에 체류가 들어가는가 ──────────────────


def test_meal_slots_follow_replan_floor_and_day_window() -> None:
    """재계획 하한·하루 창으로 자른 뒤 FOOD 체류가 들어가는 창만 — 폴백이 하한 기준으로
    food-first 를 끄는 것과 같은 규칙. 하한이 두 창을 다 지나면 석 0."""
    asm = OrToolsAssembler({}, TravelEstimator(_CFG), _CFG)
    lunch, dinner = _CFG.lunch_window_min, _CFG.dinner_window_min

    assert _slots(asm) == [lunch, dinner]
    assert _slots(asm, floor=15 * 60) == [dinner]                     # 점심창 지남
    assert _slots(asm, floor=dinner[1] - _STAY + 1) == []              # 저녁창도 체류 못 들어감
    assert _slots(asm, day=(9 * 60, lunch[0] + _STAY)) == [(lunch[0], lunch[0] + _STAY)]
    assert _slots(asm, day=(15 * 60, 16 * 60)) == []                    # 하루 창이 식사창 사이


def _seat_pool(food_hours):
    """SIGHT 70(0.9) + FOOD 2(0.1·0.05, 영업창 `food_hours`) — FOOD 는 예약석으로만 남는다."""
    pois = [_poi(f"s{k:02d}", PoiCategory.SIGHT, k) for k in range(70)]
    pois += [_poi("f-a", PoiCategory.FOOD, 70, food_hours), _poi("f-b", PoiCategory.FOOD, 71, food_hours)]
    index = {p.poi_id: p for p in pois}
    score = {"f-a": 0.1, "f-b": 0.05}
    return index, [ScoredPoi(p.poi_id, score.get(p.poi_id, 0.9), False) for p in pois]


def test_seat_count_shrinks_with_reachable_windows() -> None:
    index, cands = _seat_pool(())
    asm = OrToolsAssembler(index, TravelEstimator(_CFG), _CFG)
    food = lambda kept: {c.poi_id for c in kept} & {"f-a", "f-b"}    # noqa: E731

    assert food(asm._prefilter(cands, frozenset(), _DAY, _slots(asm), _STAY)) == {"f-a", "f-b"}
    assert food(asm._prefilter(cands, frozenset(), _DAY, _slots(asm, 15 * 60), _STAY)) == {"f-a"}
    assert food(asm._prefilter(cands, frozenset(), _DAY, _slots(asm, 19 * 60 + 30), _STAY)) == set()


def test_food_open_outside_meal_windows_takes_no_seat() -> None:
    """심야만 영업(22~24시)하는 식당은 식사창에 놓일 수 없다 — 석을 받지 않는다."""
    late = tuple(OpenHour(day_of_week=d, open_min=22 * 60, close_min=24 * 60) for d in range(7))
    index, cands = _seat_pool(late)
    asm = OrToolsAssembler(index, TravelEstimator(_CFG), _CFG)

    kept = {c.poi_id for c in asm._prefilter(cands, frozenset(), _DAY, _slots(asm), _STAY)}

    assert not kept & {"f-a", "f-b"}


# ── ④ 규칙 모드 모양의 풀 — OR 노드와 폴백의 식사 정합 ─────────────────


def _rule_like_problem():
    """비FOOD 66곳(0.50~0.90) + FOOD 20곳(0.05~0.15) — FOOD 가 전부 61위 밖."""
    pois, cands = [], []
    for k in range(66):
        cat = _NON_FOOD[k % len(_NON_FOOD)]
        if cat is PoiCategory.STAY:
            cat = PoiCategory.SIGHT
        pois.append(_poi(f"n{k:02d}", cat, k))
        cands.append(ScoredPoi(PoiId(f"n{k:02d}"), 0.90 - 0.006 * k, False))
    for k in range(20):
        pois.append(_poi(f"f{k:02d}", PoiCategory.FOOD, 66 + k))
        cands.append(ScoredPoi(PoiId(f"f{k:02d}"), 0.15 - 0.005 * k, False))
    index = {p.poi_id: p for p in pois}
    problem = ItineraryProblem(
        schedule_id=ScheduleId("s-1183"), days=(_DAY,), candidates=tuple(cands),
        fixed_blocks=(), budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=TimeWindow(datetime(2026, 8, 5, 9, 0, tzinfo=_KST),
                              datetime(2026, 8, 5, 21, 0, tzinfo=_KST)),
        seed=7, anchor=GeoPoint(35.160, 129.060))
    return problem, index


def _in_meal(slot, cfg: AssemblyConfig) -> bool:
    a = slot.start_at.hour * 60 + slot.start_at.minute
    return any(lo <= a and a + slot.stay_min <= hi
               for lo, hi in (cfg.lunch_window_min, cfg.dinner_window_min))


def test_rule_mode_or_nodes_hold_food_for_fallback_meals() -> None:
    """폴백이 식사창에 놓는 식당 수만큼 OR 노드에도 식당이 남는다(수정 전 0) — 노드 집합
    수준의 정합이다. OR 해가 그 노드를 실제로 쓰는지는 목적함수 몫이라 단언하지 않는다."""
    problem, index = _rule_like_problem()
    est = TravelEstimator(_CFG)
    asm = OrToolsAssembler(index, est, _CFG)

    nodes = asm._prefilter(list(problem.candidates), frozenset(), _DAY, _slots(asm), _STAY)
    fb_sol = RuleFallbackAssembler(index, est, _CFG).solve(problem)

    fb_meal = sum(_in_meal(s, _CFG) for d in fb_sol.days for s in d.slots
                  if index[s.poi_id].category is PoiCategory.FOOD)
    assert fb_meal >= 1                                   # 전제 — 폴백은 식사창에 식당을 둔다
    assert sum(index[c.poi_id].category is PoiCategory.FOOD for c in nodes) >= fb_meal


def test_rule_mode_or_solution_keeps_hard_constraints_and_is_deterministic() -> None:
    problem, index = _rule_like_problem()
    est = TravelEstimator(_CFG)

    first = OrToolsAssembler(index, est, _CFG).solve(problem, 10_000)
    second = OrToolsAssembler(index, est, _CFG).solve(problem, 10_000)

    assert first is not None and first.solve_mode is SolveMode.OR_TOOLS
    assert check_all(first, problem, index, est) == []
    assert first.days == second.days                      # 같은 입력 2회 동일
    for d in first.days:
        assert sum(index[s.poi_id].category is PoiCategory.FOOD for s in d.slots) <= 3
