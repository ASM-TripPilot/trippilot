"""FOOD 하루 상한 — 미식 취향의 '하루 전부 맛집' 차단 (food_daily_max · food_excess_penalty).

실측(2026-10-02, 부산 미식 4판): 하루 4~7곳 전부 FOOD·관광지 0. 일반 카테고리 체감 항은
일자별 days=1 호출에서 허용치 = 후보 전량이라 꺼져 있었고, 크기(0.3)도 미식 점수 간격보다
작았다. FOOD 전용 소프트 항(OR)·후순위(폴백)를 더한다 — 하드 제약 아님, HC1~4 해 집합 불변.

증명하는 것:
  (a) OR: FOOD 0.9×8 + SIGHT 0.3×6, 1일 → FOOD ≤ 3, 나머지는 SIGHT
  (b) 폴백: 같은 입력 → FOOD ≤ 3
  (c) FOOD 만 있는 풀 → 비지 않는다 (폴백 전량 후순위 배치, OR 은 상한만큼)
  (d) 중립 입력 회귀 0 — 상한이 닿지 않는 풀에서 꺼진 config 와 해 동일
  (e) PBT: 비FOOD 가 남는 한 FOOD ≤ 상한 + HC 위반 0
  이름이 음식 골목인 ACTIVITY 도 FOOD 로 센다 / 상한을 크게 두면 꺼진다 / config 음수 거부.
실 API 호출 0 — 어셈블리·거리 추정 전부 로컬 결정론.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from hypothesis import given, settings, strategies as st

from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.constraints import check_all
from trippilot.assembly_engine.fallback_assembler import RuleFallbackAssembler
from trippilot.assembly_engine.ortools_assembler import OrToolsAssembler
from trippilot.assembly_engine.travel import TravelEstimator
from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId, ScheduleId, TransportMode
from dataclasses import replace

from trippilot.domain.itinerary import FixedBlock, ItineraryProblem, TimeWindow
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource, counts_as_food

_KST = timezone(timedelta(hours=9))
_DAY = date(2026, 8, 5)
_CFG = AssemblyConfig(or_tools_limit_ms=2000, or_tools_min_ms=50)
_CFG_OFF = AssemblyConfig(or_tools_limit_ms=2000, or_tools_min_ms=50, food_daily_max=10_000)
_EST = TravelEstimator(_CFG)
_F, _S = PoiCategory.FOOD, PoiCategory.SIGHT


def _setup(specs, *, start_h=9, end_h=21, same_coord=False):
    """specs = [(id, 카테고리, 점수, 이름|None)]."""
    pois = [Poi(PoiId(pid), name or pid, cat,
                GeoPoint(37.751 + (0 if same_coord else 0.004 * k), 128.876), (),
                None, None, DataQuality.FULL, PoiSource.SEED, None)
            for k, (pid, cat, _, name) in enumerate(specs)]
    problem = ItineraryProblem(
        schedule_id=ScheduleId("s-food-cap"), days=(_DAY,),
        candidates=tuple(ScoredPoi(PoiId(pid), sc, False) for pid, _, sc, _ in specs),
        fixed_blocks=(), budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=TimeWindow(datetime(2026, 8, 5, start_h, 0, tzinfo=_KST),
                              datetime(2026, 8, 5, end_h, 0, tzinfo=_KST)),
        seed=7)
    return problem, {p.poi_id: p for p in pois}


def _food_count(solution, index) -> int:
    return sum(counts_as_food(index[s.poi_id]) for d in solution.days for s in d.slots)


def _cats(solution, index) -> list[PoiCategory]:
    return [index[s.poi_id].category for d in solution.days for s in d.slots]


_GOURMET = ([(f"f{i}", _F, .9, None) for i in range(8)]
            + [(f"s{i}", _S, .3, None) for i in range(6)])


# ── (a)(b) 미식 편중 풀 ─────────────────────────────────────────


def test_gourmet_pool_ortools_caps_food_and_fills_with_sights() -> None:
    problem, index = _setup(_GOURMET)
    result = OrToolsAssembler(index, _EST, _CFG).solve(problem, 3000)
    assert result is not None
    assert check_all(result, problem, index, _EST) == []
    cats = _cats(result, index)
    assert cats.count(_F) <= _CFG.food_daily_max
    assert cats.count(_S) >= 3  # 남는 시간은 관광지가 채운다
    # 종전(상한 꺼짐)엔 맛집이 상한을 넘었다 — 이 테스트가 실제로 무언가를 막는지 확인
    off = OrToolsAssembler(index, TravelEstimator(_CFG_OFF), _CFG_OFF).solve(problem, 3000)
    assert _cats(off, index).count(_F) > _CFG.food_daily_max


def test_gourmet_pool_fallback_caps_food() -> None:
    problem, index = _setup(_GOURMET)
    result = RuleFallbackAssembler(index, _EST, _CFG).solve(problem)
    assert check_all(result, problem, index, _EST) == []
    cats = _cats(result, index)
    assert cats.count(_F) <= _CFG.food_daily_max
    assert cats.count(_S) >= 3
    # 폴백은 종전에도 이 풀에서 FOOD 2곳이었다 — 식사창 밖 FOOD 후순위(TRIP-379 그리디판)가
    # 이미 막았다. 상한이 폴백에서 일하는 것은 식사창 안 연쇄·FOOD 만 남는 꼬리 쪽이다.


# ── 고정 블록(핀)의 FOOD 도 센다 ─────────────────────────────────
# 9:00·10:30·12:00 식당 예약 3건 → 13시 말단이 점심창이라 종전 폴백은 FOOD 를 먼저 시도했다(4곳째).


def _with_food_pins():
    problem, index = _setup([(f"p{i}", _F, .9, None) for i in range(3)]
                            + [(f"f{i}", _F, .9, None) for i in range(3)]
                            + [(f"s{i}", _S, .3, None) for i in range(6)])
    at = datetime(2026, 8, 5, 9, 0, tzinfo=_KST)
    pins = tuple(FixedBlock(PoiId(f"p{i}"),
                            TimeWindow(at + timedelta(minutes=90 * i),
                                       at + timedelta(minutes=90 * i + 60)), "예약")
                 for i in range(3))
    return replace(problem, fixed_blocks=pins), index


def test_fixed_food_blocks_count_toward_cap() -> None:
    problem, index = _with_food_pins()
    off = RuleFallbackAssembler(index, TravelEstimator(_CFG_OFF), _CFG_OFF).solve(problem)
    assert _food_count(off, index) > _CFG.food_daily_max  # 종전엔 넘었다
    for result in (OrToolsAssembler(index, _EST, _CFG).solve(problem, 3000),
                   RuleFallbackAssembler(index, _EST, _CFG).solve(problem)):
        assert result is not None
        assert check_all(result, problem, index, _EST) == []
        assert _food_count(result, index) == _CFG.food_daily_max  # 핀 3건만


# ── (c) FOOD 만 있는 풀 — 비지 않는다 ─────────────────────────────

_FOOD_ONLY = [(f"f{i}", _F, .9 - .05 * i, None) for i in range(7)]


def test_food_only_pool_fallback_places_all_food() -> None:
    """후순위일 뿐 배제가 아니다 — FOOD 만 남으면 상한을 넘어 그대로 배치."""
    problem, index = _setup(_FOOD_ONLY)
    on = RuleFallbackAssembler(index, _EST, _CFG).solve(problem)
    off = RuleFallbackAssembler(index, TravelEstimator(_CFG_OFF), _CFG_OFF).solve(problem)
    assert on == off  # 전부 상한 초과면 순서 키가 상수 — 해가 그대로다
    assert _food_count(on, index) > _CFG.food_daily_max
    assert check_all(on, problem, index, _EST) == []


def test_food_only_pool_ortools_places_up_to_cap() -> None:
    """OR 은 초과분이 점수 축 전체(1.0)만큼 깎여 이득이 없다 — 상한만큼만 담는다(비지는 않음).

    FOOD 인접 억제는 끈다 — 식당만 있는 풀에선 전부 인접이라 그 항이 상한보다 먼저 덜어낸다
    (그 동작은 test_assembly_engine_food_adjacent). 여기서는 상한 항 단독을 본다."""
    problem, index = _setup(_FOOD_ONLY)
    cfg = replace(_CFG, food_adjacent_penalty=0.0)
    result = OrToolsAssembler(index, TravelEstimator(cfg), cfg).solve(problem, 3000)
    assert result is not None
    assert check_all(result, problem, index, _EST) == []
    assert _food_count(result, index) == _CFG.food_daily_max


# ── (d) 중립 입력 — 상한이 닿지 않으면 종전과 같다 ─────────────────

_NEUTRAL = ([(f"f{i}", _F, .5, None) for i in range(2)]
            + [(f"x{i}", cat, .5, None) for i, cat in enumerate(
                (_S, PoiCategory.CAFE, PoiCategory.CULTURE, PoiCategory.NATURE, _S))])


def test_neutral_pool_unchanged() -> None:
    problem, index = _setup(_NEUTRAL)
    assert (OrToolsAssembler(index, _EST, _CFG).solve(problem, 3000)
            == OrToolsAssembler(index, TravelEstimator(_CFG_OFF), _CFG_OFF).solve(problem, 3000))
    assert (RuleFallbackAssembler(index, _EST, _CFG).solve(problem)
            == RuleFallbackAssembler(index, TravelEstimator(_CFG_OFF), _CFG_OFF).solve(problem))


# ── 이름이 음식 골목인 ACTIVITY 도 FOOD 로 센다 ───────────────────


def test_eatery_named_activity_counts_as_food() -> None:
    specs = ([(f"f{i}", _F, .9, None) for i in range(3)]
             + [("a1", PoiCategory.ACTIVITY, .9, "자갈치 양곱창 골목"),
                ("a2", PoiCategory.ACTIVITY, .9, "부평깡통 먹자골목(부산)")]
             + [(f"s{i}", _S, .3, None) for i in range(6)])
    problem, index = _setup(specs)
    assert counts_as_food(index[PoiId("a1")]) and counts_as_food(index[PoiId("a2")])
    assert not counts_as_food(index[PoiId("s0")])
    for result in (OrToolsAssembler(index, _EST, _CFG).solve(problem, 3000),
                   RuleFallbackAssembler(index, _EST, _CFG).solve(problem)):
        assert result is not None
        assert _food_count(result, index) <= _CFG.food_daily_max


# ── (e) PBT — 비FOOD 가 남는 한 FOOD ≤ 상한, HC 위반 0 ─────────────
# 같은 좌표·4시간 창·비FOOD 는 체류 ≤ FOOD(60분) 카테고리만 — FOOD 가 들어갈 틈이면
# 비FOOD 도 들어간다. 비FOOD 8건 ≥ 하루 슬롯 수(240분 ÷ 45분 < 6) − 3 보장.
# 점수 상한 0.99: 1.0 이면 초과분 이득이 정확히 0 이라 OR 이 동률로 담을 수 있다.

_NONFOOD = st.sampled_from((PoiCategory.CAFE, PoiCategory.SHOPPING, PoiCategory.NIGHT_VIEW))
_SCORE = st.floats(0.0, 0.99)


@st.composite
def _food_heavy(draw):
    foods = [(f"f{i}", _F, draw(_SCORE), None) for i in range(draw(st.integers(0, 8)))]
    others = [(f"n{i}", draw(_NONFOOD), draw(_SCORE), None) for i in range(8)]
    return _setup(foods + others, start_h=10, end_h=14, same_coord=True)


@settings(max_examples=15, deadline=None)
@given(setup=_food_heavy())
def test_pbt_food_never_exceeds_cap_while_nonfood_remains(setup) -> None:
    problem, index = setup
    for result in (OrToolsAssembler(index, _EST, _CFG).solve(problem, 1500),
                   RuleFallbackAssembler(index, _EST, _CFG).solve(problem)):
        assert result is not None
        assert check_all(result, problem, index, _EST) == []
        assert _food_count(result, index) <= _CFG.food_daily_max


# ── config ───────────────────────────────────────────────────────


@pytest.mark.parametrize("field", ["food_daily_max", "food_excess_penalty"])
def test_config_rejects_negative_food_cap(field) -> None:
    with pytest.raises(ValueError, match=field):
        AssemblyConfig(**{field: -1})


# ── 프리필터 FOOD 몫 (후보 > 60) ─────────────────────────────────────────
# 실측(2026-10-02, #859 직후 부산 미식): 후보 375 → 프리필터 상위 60 이 전부 FOOD(+음식 골목)라
# 비FOOD 노드가 0 — 상한이 넘친 FOOD 를 빼도 채울 관광지가 없어 하루 6곳 → 3곳으로 줄었다.


def _big_pool(n_food: int, n_sight: int):
    specs = ([(f"f{i:02d}", _F, 0.9, None) for i in range(n_food)]
             + [(f"s{i:02d}", _S, 0.2, None) for i in range(n_sight)])
    return _setup(specs, same_coord=True)


def test_prefilter_keeps_non_food_nodes_when_food_dominates_scores() -> None:
    problem, index = _big_pool(70, 10)
    sol = OrToolsAssembler(index, _EST, _CFG).solve(problem, 3000)
    assert sol is not None
    placed = [s for d in sol.days for s in d.slots]
    assert _food_count(sol, index) <= _CFG.food_daily_max
    assert any(index[s.poi_id].category is _S for s in placed), "관광지가 노드에 없으면 하루가 비어 간다"
    assert len(placed) > _CFG.food_daily_max


def test_prefilter_still_fills_sixty_when_non_food_is_scarce() -> None:
    problem, index = _big_pool(70, 2)
    asm = OrToolsAssembler(index, _EST, _CFG)
    kept = asm._prefilter(list(problem.candidates), set(), _DAY, [], 60)
    assert len(kept) == 60  # 비FOOD 가 모자라면 FOOD 로 다시 채운다 — 풀 손실 없음
    assert sum(1 for c in kept if index[c.poi_id].category is _S) == 2
