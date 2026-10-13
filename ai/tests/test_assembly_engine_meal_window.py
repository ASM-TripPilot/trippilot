"""TRIP-379 — 식사 시간대 소프트 보정 (점심 11:00~14:00 · 저녁 17:00~20:00).

배경(실측 2회, TRIP-373 코멘트): 어셈블리가 카테고리-시간대 적합성을 몰라 점수 분포에
따라 ① 오전 식당 연속 배치 또는 ② 하루 식사 0곳 양극단이 발생했다. 정본에는 기존
규칙이 없어(ai-data-design.md §2.2는 RESTAURANT 체류 60분만 정의) 이 티켓이 신설.

증명하는 것:
  ① 재현 A(식당 점수 우위 풀): 창 밖 FOOD·FOOD 연속 배치가 무보정 대비 억제되고
     점심·저녁 창에 FOOD가 배치된다
  ② 재현 B(자연 점수 우위 풀): 보정 후 점심 창에 FOOD 1개 포함 (무보정 대조는
     TRIP-1176 완전 힌트 이후 성립하지 않아 뺐다 — 본문 주석)
  ③ 식당 0개 풀: 일정 정상 생성(실패 조건화 금지) + 보정 항이 완전 무영향
  ④ 폴백 경로 동일 규칙 (결정론 버전)
  ⑤ PBT: 임의 풀·점수·과장 가중에서도 보정이 HC1~4 위반을 만들지 않고(검증기
     무접촉) 결정론이 유지된다
  ⑥ 같은 식사창 두 번째 FOOD 는 창 밖 억제 상쇄를 못 받는다(창당 1곳) — 다만 배제는
     아니다(식당만 남으면 놓인다). 폴백도 같은 성질
"""

from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, timedelta, timezone

from hypothesis import given, settings

from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.constraints import check_all
from trippilot.assembly_engine.fallback_assembler import RuleFallbackAssembler
from trippilot.assembly_engine.ortools_assembler import OrToolsAssembler
from trippilot.assembly_engine.travel import TravelEstimator
from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId, ScheduleId, TransportMode
from trippilot.domain.itinerary import ItineraryProblem, SolveMode, TimeWindow
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource

from tests.generators.assembly import assembly_setups

_KST = timezone(timedelta(hours=9))
_DAY = date(2026, 8, 5)
# 소규모(≤8 노드)는 수 초 안에 OPTIMAL 도달 — 기존 ortools 테스트와 동일한 관례
_CFG = AssemblyConfig(or_tools_limit_ms=2000, or_tools_min_ms=50)
_CFG_OFF = AssemblyConfig(or_tools_limit_ms=2000, or_tools_min_ms=50,
                        meal_bonus=0.0, meal_penalty=0.0)   # 보정 끔 = 종전 동작
_CFG_EXTREME = AssemblyConfig(or_tools_limit_ms=1000, or_tools_min_ms=50,
                            meal_bonus=5.0, meal_penalty=5.0)  # 과장 가중 (PBT용)
_EST = TravelEstimator(_CFG)


# ── 헬퍼 ──────────────────────────────────────────────────────


def _poi(pid: str, cat: PoiCategory, k: int) -> Poi:
    return Poi(PoiId(pid), pid, cat, GeoPoint(37.751 + 0.004 * k, 128.876), (),
               None, None, DataQuality.FULL, PoiSource.SEED, None)


def _problem(specs: list[tuple[str, PoiCategory, float]], seed: int = 7):
    pois = [_poi(pid, cat, k) for k, (pid, cat, _) in enumerate(specs)]
    index = {p.poi_id: p for p in pois}
    cands = tuple(ScoredPoi(PoiId(pid), sc, False) for pid, _, sc in specs)
    problem = ItineraryProblem(
        schedule_id=ScheduleId("s-379"), days=(_DAY,), candidates=cands,
        fixed_blocks=(), budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=TimeWindow(datetime(2026, 8, 5, 9, 0, tzinfo=_KST),
                              datetime(2026, 8, 5, 21, 0, tzinfo=_KST)),
        seed=seed)
    return problem, index


def _mod(dt: datetime) -> int:
    return dt.hour * 60 + dt.minute


def _food_slots(solution, index):
    return [s for d in solution.days for s in d.slots
            if index[s.poi_id].category is PoiCategory.FOOD]


def _fully_in(slot, window: tuple[int, int]) -> bool:
    lo, hi = window
    return _mod(slot.start_at) >= lo and _mod(slot.end_at) <= hi


def _out_of_window_food(solution, index, cfg: AssemblyConfig) -> int:
    return sum(1 for s in _food_slots(solution, index)
               if not (_fully_in(s, cfg.lunch_window_min)
                       or _fully_in(s, cfg.dinner_window_min)))


def _food_food_pairs(solution, index) -> int:
    n = 0
    for d in solution.days:
        for prev, nxt in zip(d.slots, d.slots[1:]):
            if (index[prev.poi_id].category is PoiCategory.FOOD
                    and index[nxt.poi_id].category is PoiCategory.FOOD):
                n += 1
    return n


# 재현 A — 식당 점수 우위 풀 (식당 5 + 명소 3, TRIP-373 실측 ①의 구도)
_POOL_A = [("f1", PoiCategory.FOOD, .95), ("f2", PoiCategory.FOOD, .94),
           ("f3", PoiCategory.FOOD, .93), ("f4", PoiCategory.FOOD, .92),
           ("f5", PoiCategory.FOOD, .91),
           ("s1", PoiCategory.SIGHT, .50), ("s2", PoiCategory.SIGHT, .49),
           ("s3", PoiCategory.SIGHT, .48)]
# 재현 B — 자연 점수 우위 풀 (자연 6 + 식당 2, TRIP-373 실측 ②의 구도)
_POOL_B = [(f"n{i}", PoiCategory.NATURE, .80 - .01 * i) for i in range(6)] \
    + [("f1", PoiCategory.FOOD, .60), ("f2", PoiCategory.FOOD, .59)]
# 식당 0개 풀
_POOL_NO_FOOD = [(f"s{i}", PoiCategory.SIGHT, .70 - .02 * i) for i in range(3)] \
    + [(f"n{i}", PoiCategory.NATURE, .60 - .02 * i) for i in range(3)]


# ── ① 재현 A: 창 밖 FOOD 연속 억제 ────────────────────────────


def test_case_a_food_heavy_pool_suppresses_out_of_window_food_runs() -> None:
    problem, index = _problem(_POOL_A)
    on = OrToolsAssembler(index, _EST, _CFG).solve(problem, 3000)
    off = OrToolsAssembler(index, TravelEstimator(_CFG_OFF), _CFG_OFF).solve(problem, 3000)
    assert on is not None and off is not None
    assert check_all(on, problem, index, _EST) == []
    # 창 밖 FOOD·FOOD 연속 모두 무보정 대비 늘지 않고, 합계는 엄격히 줄어든다
    # (실측: 창밖 3→2, 연속 3→2 — 소프트 보정이라 0이 되지는 않는다: 고점수
    #  식당 5곳은 점수가 보정을 이겨 일부는 창 밖에 남는 것이 설계 의도)
    assert _out_of_window_food(on, index, _CFG) <= _out_of_window_food(off, index, _CFG)
    assert _food_food_pairs(on, index) <= _food_food_pairs(off, index)
    assert (_out_of_window_food(on, index, _CFG) + _food_food_pairs(on, index)
            < _out_of_window_food(off, index, _CFG) + _food_food_pairs(off, index))
    # 식사 리듬: 점심·저녁 창 각각에 FOOD 배치
    assert any(_fully_in(s, _CFG.lunch_window_min) for s in _food_slots(on, index))
    assert any(_fully_in(s, _CFG.dinner_window_min) for s in _food_slots(on, index))


# ── ② 재현 B: 자연 우위 풀에서 점심 창에 FOOD 포함 ─────────────


def test_case_b_nature_heavy_pool_gets_lunch_food() -> None:
    problem, index = _problem(_POOL_B)
    on = OrToolsAssembler(index, _EST, _CFG).solve(problem, 3000)
    off = OrToolsAssembler(index, TravelEstimator(_CFG_OFF), _CFG_OFF).solve(problem, 3000)
    assert on is not None and off is not None
    assert check_all(on, problem, index, _EST) == []
    assert check_all(off, problem, index, _EST) == []
    # 종전엔 "무보정이면 점심 창 FOOD 0(09:00 아침 배치)" 을 재현 전제로 단언했다. TRIP-1176
    # 부터 OR 은 그리디 해의 완전 힌트에서 출발하고, 그리디의 FOOD 우선 시도는 보정 가중과
    # 무관하게 돈다(보정을 꺼도 f1 이 12:40 점심 창) — 무보정 OR 해는 그 출발점을 그대로 둔다.
    # 즉 무보정 해의 식사 배치는 탐색 출발점의 우연이라 대조군이 못 된다. 보정 효과는 아래
    # 단언과 ① 재현 A(무보정 대비 엄격 감소)가 맡는다.
    # 보정 후: 점심 창에 FOOD 1개 포함
    assert any(_fully_in(s, _CFG.lunch_window_min) for s in _food_slots(on, index))


# ── ③ 식당 0개 풀: 정상 생성 + 보정 무영향 ────────────────────


def test_no_food_pool_still_generates_itinerary() -> None:
    problem, index = _problem(_POOL_NO_FOOD)
    on = OrToolsAssembler(index, _EST, _CFG).solve(problem, 3000)
    assert on is not None                        # 실패 조건화 금지
    assert any(d.slots for d in on.days)
    assert check_all(on, problem, index, _EST) == []
    # FOOD가 없으면 보정 항이 모델에 아예 없다 — 무보정 해와 완전 동일
    off = OrToolsAssembler(index, TravelEstimator(_CFG_OFF), _CFG_OFF).solve(problem, 3000)
    assert on == off
    fb = RuleFallbackAssembler(index, _EST, _CFG).solve(problem)
    assert fb.solve_mode is SolveMode.RULE_FALLBACK
    assert any(d.slots for d in fb.days)


# ── ④ 폴백 경로 — 같은 규칙의 결정론 버전 ─────────────────────


def test_fallback_case_a_no_morning_food_and_lunch_food() -> None:
    problem, index = _problem(_POOL_A)
    fb = RuleFallbackAssembler(index, _EST, _CFG).solve(problem)
    assert check_all(fb, problem, index, _EST) == []
    foods = _food_slots(fb, index)
    assert foods, "식당 우위 풀 — FOOD가 배치되어야 함"
    lunch_lo = _CFG.lunch_window_min[0]
    # 오전(점심 창 이전) FOOD 배치 억제 — 명소가 남아 있는 동안 FOOD는 후순위
    assert all(_mod(s.start_at) >= lunch_lo for s in foods)
    assert any(_fully_in(s, _CFG.lunch_window_min) for s in foods)


def test_fallback_case_b_lunch_window_gets_food() -> None:
    problem, index = _problem(_POOL_B)
    fb = RuleFallbackAssembler(index, _EST, _CFG).solve(problem)
    assert check_all(fb, problem, index, _EST) == []
    assert any(_fully_in(s, _CFG.lunch_window_min)
               for s in _food_slots(fb, index))


# ── ⑤ PBT — 보정은 HC1~4를 깨지 않고 결정론을 유지한다 ────────
# (constraints.py 무접촉: 소프트 항은 목적함수만 만지므로 가해집합 불변 — 과장
#  가중(5.0, 점수 최대 1.0의 5배)으로도 위반이 나오지 않음을 임의 풀에서 확인)


@settings(max_examples=15, deadline=None)
@given(setup=assembly_setups())
def test_pbt_extreme_meal_weights_never_violate_hard_constraints(setup) -> None:
    problem, index = setup
    est = TravelEstimator(_CFG_EXTREME)
    result = OrToolsAssembler(index, est, _CFG_EXTREME).solve(problem, 1500)
    if result is not None:
        assert check_all(result, problem, index, est) == []
    fb = RuleFallbackAssembler(index, est, _CFG_EXTREME).solve(problem)
    assert check_all(fb, problem, index, est) == []


@settings(max_examples=8, deadline=None)
@given(setup=assembly_setups())
def test_pbt_meal_correction_keeps_determinism(setup) -> None:
    problem, index = setup
    est = TravelEstimator(_CFG_EXTREME)
    assembly = OrToolsAssembler(index, est, _CFG_EXTREME)
    assert assembly.solve(problem, 1500) == assembly.solve(problem, 1500)
    fb = RuleFallbackAssembler(index, est, _CFG_EXTREME)
    assert fb.solve(problem) == fb.solve(problem)


@settings(max_examples=10, deadline=None)
@given(setup=assembly_setups())
def test_pbt_food_free_pool_is_unaffected_by_correction(setup) -> None:
    """FOOD 없는 풀에서는 보정 유무가 해에 어떤 영향도 주지 않는다."""
    problem, index = setup
    # FOOD → SIGHT 치환으로 FOOD 없는 동형 풀 구성 (replace — anti-patterns.md 규칙)
    index2 = {pid: (replace(p, category=PoiCategory.SIGHT)
                    if p.category is PoiCategory.FOOD else p)
              for pid, p in index.items()}
    on = OrToolsAssembler(index2, _EST, _CFG).solve(problem, 1500)
    off = OrToolsAssembler(index2, TravelEstimator(_CFG_OFF), _CFG_OFF).solve(problem, 1500)
    assert on == off
    fb_on = RuleFallbackAssembler(index2, _EST, _CFG).solve(problem)
    fb_off = RuleFallbackAssembler(index2, TravelEstimator(_CFG_OFF), _CFG_OFF).solve(problem)
    assert fb_on == fb_off


# ── ⑥ 같은 식사창 두 번째 FOOD — 창 밖 억제 상쇄는 창당 1곳만 ──────
# QA 6회차 실측: 점심·저녁 창에 식당 두 곳이 연달아(사이에 한 곳 끼고) 놓였다. 창 보상 ①은
# 창당 1회인데 창 밖 억제 ②의 상쇄를 창 안 FOOD 전부가 받아, 같은 창 두 번째 식당의 비용이
# 연속 억제 ③뿐이었다(비인접이면 0). 픽스처: 점심 창 = 하루 창(11:00~15:30)이라 창 밖 자리가
# 없고, 4슬롯이 들어간다 — f·c·f·c(식당 2) 대 f·c·c·c(식당 1)의 점수차 0.15 가 억제 0.2 보다 작다.

_CFG_ONE_WIN = AssemblyConfig(or_tools_limit_ms=2000, or_tools_min_ms=50,
                              lunch_window_min=(11 * 60, 15 * 60 + 30))
_POOL_WIN = [("f1", PoiCategory.FOOD, .70), ("f2", PoiCategory.FOOD, .70),
             ("c1", PoiCategory.CAFE, .55), ("c2", PoiCategory.CAFE, .55),
             ("c3", PoiCategory.CAFE, .55)]


def _window_problem(specs):
    problem, index = _problem(specs)
    window = TimeWindow(datetime(2026, 8, 5, 11, 0, tzinfo=_KST),
                        datetime(2026, 8, 5, 15, 30, tzinfo=_KST))
    return replace(problem, day_window=window), index


def _max_food_per_window(solution, index, cfg: AssemblyConfig) -> int:
    return max((sum(1 for s in _food_slots(solution, index) if _fully_in(s, w))
                for w in (cfg.lunch_window_min, cfg.dinner_window_min)), default=0)


def test_second_food_in_same_window_loses_offset() -> None:
    problem, index = _window_problem(_POOL_WIN)
    est = TravelEstimator(_CFG_ONE_WIN)
    for sol in (OrToolsAssembler(index, est, _CFG_ONE_WIN).solve(problem, 3000),
                RuleFallbackAssembler(index, est, _CFG_ONE_WIN).solve(problem)):
        assert sol is not None
        assert check_all(sol, problem, index, est) == []
        assert _max_food_per_window(sol, index, _CFG_ONE_WIN) == 1, sol.solve_mode


def test_second_food_in_same_window_is_not_forbidden() -> None:
    """소프트 항이다 — 식당만 남으면 같은 창에 두 곳이 그대로 놓인다(HC 해 집합 불변).

    FOOD 인접 억제(food_adjacent_penalty)는 끈다 — 식당만 있는 풀에선 두 곳이 반드시 인접이라
    그 항(점수 축 전체)이 두 번째를 덜어낸다. 여기서 증명할 것은 창당 1곳 묶음(AtMostOne)이
    방문을 막지 않는다는 것 하나다."""
    problem, index = _window_problem([s for s in _POOL_WIN if s[1] is PoiCategory.FOOD])
    cfg = replace(_CFG_ONE_WIN, food_adjacent_penalty=0.0)
    est = TravelEstimator(cfg)
    for sol in (OrToolsAssembler(index, est, cfg).solve(problem, 3000),
                RuleFallbackAssembler(index, est, cfg).solve(problem)):
        assert sol is not None
        assert check_all(sol, problem, index, est) == []
        assert _max_food_per_window(sol, index, _CFG_ONE_WIN) == 2, sol.solve_mode
