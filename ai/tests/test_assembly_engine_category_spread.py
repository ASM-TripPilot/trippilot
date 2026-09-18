"""U5-P1·U5-P3 확장 (TRIP-531) — 일별 동일 카테고리 체감 페널티는 배제가 아니다.

기본 가중(0.3)에서의 HC 보존·결정론은 기존 게이트가 이미 커버한다
(test_assembly_engine_fallback.py ①②·test_assembly_engine_ortools.py ①② — 기본
AssemblyConfig에 다양성 항이 켜져 있다). 이 파일은 그 위의 구멍만 메운다:
편중 풀 + 과장 가중(5.0)이라는 적대적 구도에서 소프트 항이 배제·손실·비결정으로
번지지 않음을 증명한다.

증명하는 것:
  ① 배제 아님(핵심): 단일 카테고리 풀 + 과장 페널티(5.0)에서도 일정이 나온다 —
     OR-Tools는 앞날 회피분을 마지막 날(허용치=잔여 후보 수, 무페널티)로 미뤄
     **카테고리 항 단독으로는** 전량 배치(식사 항 0으로 격리 — 아래 주석),
     폴백은 순서 키가 상수라 무보정 해와 **완전 동일**
  ② 후순위 ≠ 손실(폴백): 편중 혼합 풀에서 재정렬은 시도 순서만 바꾼다 —
     배치 슬롯 수가 항 무발동 config(category_free_count 매우 큼)와 같고,
     순서 무관 가해 풀에서는 전량 배치가 유지된다
  ③ 결정론: 과장 가중에서도 동일 입력 2회 → 동일 해 (OR-Tools·폴백)
  ④ 허용치 공식: 1일 여행이면 허용치 = ⌈후보÷1⌉ = 후보 수 — 페널티가 아무리
     커도 마지막 날 전량 배치는 막히지 않는다(항 무발동과 해 단위 동일)
  ⑤ 적대적 HC PBT: 과장 가중 + 편중 풀에서도 HC1~4 위반 0 (기본 가중은 기존
     게이트 소관 — 여기는 과장 가중 구멍만)
  ⑥ config: 신규 2필드 음수 거부

실 API 호출 0 (D37) — 어셈블리·거리 추정 전부 로컬 결정론.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from hypothesis import given, settings

from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.constraints import check_all
from trippilot.assembly_engine.fallback_assembler import RuleFallbackAssembler
from trippilot.assembly_engine.ortools_assembler import OrToolsAssembler
from trippilot.assembly_engine.travel import TravelEstimator
from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId, ScheduleId, TransportMode
from trippilot.domain.itinerary import ItineraryProblem, TimeWindow
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource

from tests.generators.assembly import skewed_category_setups

_KST = timezone(timedelta(hours=9))
_DAY = date(2026, 8, 5)
_DAY2 = date(2026, 8, 6)
# 소규모(≤8 노드)는 수 초 안에 OPTIMAL 도달 — 기존 어셈블리 테스트와 동일한 관례
_CFG = AssemblyConfig(or_tools_limit_ms=2000, or_tools_min_ms=50)
# 항 무발동 = 허용치를 후보 수 위로 올린다 — OR-Tools는 항 생략, 폴백은 재정렬
# 없음. (category_excess_penalty=0은 OR-Tools만 끄고 폴백 쿼터는 남아 반쪽이다.)
_CFG_OFF = AssemblyConfig(or_tools_limit_ms=2000, or_tools_min_ms=50,
                        category_free_count=10_000)
# 과장 가중 — 점수 축 [0,1]의 5배. 페널티가 항상 점수를 이기는 적대 구도.
_CFG_EXTREME = AssemblyConfig(or_tools_limit_ms=2000, or_tools_min_ms=50,
                            category_excess_penalty=5.0)
# 카테고리 항 격리판 (식사 항 0) — 단일 카테고리 FOOD 풀에서는 기존 식사 항
# (TRIP-379 ③ FOOD·FOOD 인접 -0.2)이 저점수(<0.2) FOOD를 어느 날에 놓아도 순손실로
# 만들어 떨어뜨린다(커밋 실측 "순창 SIGHT 4→3"과 같은, 수용된 소프트 경제).
# "카테고리 항 **단독**은 배치를 잃지 않는다(마지막 날 무페널티 흡수)"를 정리로
# 증명하려면 그 기존 항과 분리해야 한다 — 격리 없이 총량 동등을 걸면 식사 항의
# 기존 동작을 이 티켓의 회귀로 오인한다.
_CFG_EXTREME_ISO = AssemblyConfig(or_tools_limit_ms=2000, or_tools_min_ms=50,
                                category_excess_penalty=5.0,
                                meal_bonus=0.0, meal_penalty=0.0)
_CFG_OFF_ISO = AssemblyConfig(or_tools_limit_ms=2000, or_tools_min_ms=50,
                            category_free_count=10_000,
                            meal_bonus=0.0, meal_penalty=0.0)
_EST = TravelEstimator(_CFG)


# ── 헬퍼 ──────────────────────────────────────────────────────


def _poi(pid: str, cat: PoiCategory, k: int) -> Poi:
    return Poi(PoiId(pid), pid, cat, GeoPoint(37.751 + 0.004 * k, 128.876), (),
               None, None, DataQuality.FULL, PoiSource.SEED, None)


def _problem(specs: list[tuple[str, PoiCategory, float]], *,
             days: tuple[date, ...] = (_DAY,), seed: int = 7):
    pois = [_poi(pid, cat, k) for k, (pid, cat, _) in enumerate(specs)]
    index = {p.poi_id: p for p in pois}
    cands = tuple(ScoredPoi(PoiId(pid), sc, False) for pid, _, sc in specs)
    problem = ItineraryProblem(
        schedule_id=ScheduleId("s-531"), days=days, candidates=cands,
        fixed_blocks=(), budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=TimeWindow(datetime(2026, 8, 5, 9, 0, tzinfo=_KST),
                              datetime(2026, 8, 5, 21, 0, tzinfo=_KST)),
        seed=seed)
    return problem, index


def _total_slots(solution) -> int:
    return sum(len(d.slots) for d in solution.days)


# 단일 카테고리 풀 — 전부 FOOD. 점수에 페널티(0.3) 아래 값(.2/.15/.1)을 섞어
# "초과분의 한계 이득이 음수"인 적대 구도를 만든다 (체감이 배제로 번지기 쉬운 곳).
_POOL_MONO = [("f1", PoiCategory.FOOD, .90), ("f2", PoiCategory.FOOD, .80),
              ("f3", PoiCategory.FOOD, .70), ("f4", PoiCategory.FOOD, .20),
              ("f5", PoiCategory.FOOD, .15), ("f6", PoiCategory.FOOD, .10)]


# ── ① 배제 아님 — 단일 카테고리 풀에서도 일정이 나온다 ────────────


def test_mono_pool_ortools_places_all_despite_extreme_penalty() -> None:
    """2일 여행 + 전부 FOOD + 페널티 5.0: 앞날은 허용치만큼만 담고 나머지를
    마지막 날(허용치=잔여 수, 무페널티)로 미룬다 — 카테고리 항 단독은 전량
    배치를 잃지 않는다 (식사 항 격리 — _CFG_*_ISO 주석)."""
    problem, index = _problem(_POOL_MONO, days=(_DAY, _DAY2))
    est = TravelEstimator(_CFG_EXTREME_ISO)
    on = OrToolsAssembler(index, est, _CFG_EXTREME_ISO).solve(problem, 3000)
    off = OrToolsAssembler(index, TravelEstimator(_CFG_OFF_ISO),
                        _CFG_OFF_ISO).solve(problem, 3000)
    assert on is not None and off is not None
    assert check_all(on, problem, index, est) == []
    # 배제 아님의 핵심 — 페널티 5.0으로도 총 배치 수는 무발동과 동일 (전량 6)
    assert _total_slots(on) == _total_slots(off) == len(problem.candidates)
    # 체감은 작동한다: 첫날 몰아넣기가 무발동 대비 줄고, 미룬 몫은 둘째 날로
    assert len(on.days[0].slots) < len(off.days[0].slots)
    assert len(on.days[1].slots) > 0


@settings(max_examples=10, deadline=None)
@given(setup=skewed_category_setups(mono=True))
def test_pbt_mono_pool_ortools_never_excluded(setup) -> None:
    problem, index = setup
    est = TravelEstimator(_CFG_EXTREME_ISO)
    result = OrToolsAssembler(index, est, _CFG_EXTREME_ISO).solve(problem, 1500)
    assert result is not None  # 가해 풀(생성기 보장) — 해가 있어야 한다
    assert check_all(result, problem, index, est) == []
    # 순서 무관 가해 풀 — 마지막 날 무페널티 흡수로 전량 배치가 최적
    assert _total_slots(result) == len(problem.candidates)


@settings(max_examples=30, deadline=None)
@given(setup=skewed_category_setups(mono=True))
def test_pbt_mono_pool_fallback_identical_to_no_penalty(setup) -> None:
    """폴백은 시도 순서만 바꾼다 — 단일 카테고리면 순서 키가 상수라 재정렬
    자체가 무의미해지고, 해는 항 무발동 config와 완전히 같아야 한다."""
    problem, index = setup
    on = RuleFallbackAssembler(index, _EST, _CFG).solve(problem)
    off = RuleFallbackAssembler(index, TravelEstimator(_CFG_OFF), _CFG_OFF).solve(problem)
    assert on == off
    assert any(d.slots for d in on.days)  # 배제 아님 — 일정은 나온다
    assert check_all(on, problem, index, _EST) == []


# ── ② 후순위 ≠ 손실 (폴백, 편중 혼합 풀) ─────────────────────────


@settings(max_examples=30, deadline=None)
@given(setup=skewed_category_setups())
def test_pbt_fallback_reorder_never_loses_placements(setup) -> None:
    """재정렬은 배치 실패를 만들지 않는다 — 슬롯 수가 항 무발동과 동일하고,
    순서 무관 가해 풀(생성기 보장)에서는 전량 배치다."""
    problem, index = setup
    on = RuleFallbackAssembler(index, _EST, _CFG).solve(problem)
    off = RuleFallbackAssembler(index, TravelEstimator(_CFG_OFF), _CFG_OFF).solve(problem)
    assert _total_slots(on) == _total_slots(off) == len(problem.candidates)
    assert check_all(on, problem, index, _EST) == []


# ── ③ 결정론 — 과장 가중에서도 동일 입력 2회 → 동일 해 ───────────


@settings(max_examples=8, deadline=None)
@given(setup=skewed_category_setups())
def test_pbt_category_penalty_keeps_determinism(setup) -> None:
    problem, index = setup
    est = TravelEstimator(_CFG_EXTREME)
    assembly = OrToolsAssembler(index, est, _CFG_EXTREME)
    assert assembly.solve(problem, 1500) == assembly.solve(problem, 1500)
    fb = RuleFallbackAssembler(index, est, _CFG_EXTREME)
    assert fb.solve(problem) == fb.solve(problem)


# ── ④ 허용치 공식 — 1일 여행이면 허용치 = 후보 수 (무발동과 동등) ──
# 후보 7 > category_free_count 2지만 남은 일수 1 → ⌈7÷1⌉ = 7 = 후보 수.
# "어셈블리는 풀 비중 이상으로 증폭하지 않는다"의 사영: 마지막 날 전량 배치는
# 페널티가 아무리 커도 막히지 않는다.

_POOL_LAST_DAY = [(f"f{i}", PoiCategory.FOOD, .90 - .05 * i) for i in range(7)]


def test_single_day_quota_equals_pool_size_ortools() -> None:
    problem, index = _problem(_POOL_LAST_DAY, days=(_DAY,))
    est = TravelEstimator(_CFG_EXTREME)
    on = OrToolsAssembler(index, est, _CFG_EXTREME).solve(problem, 3000)
    off = OrToolsAssembler(index, TravelEstimator(_CFG_OFF), _CFG_OFF).solve(problem, 3000)
    assert on is not None
    assert on == off  # 허용치 = 후보 수 → 항 자체가 생기지 않는다 (모델 동일)
    assert _total_slots(on) == len(problem.candidates)


def test_single_day_quota_equals_pool_size_fallback() -> None:
    problem, index = _problem(_POOL_LAST_DAY, days=(_DAY,))
    est = TravelEstimator(_CFG_EXTREME)
    on = RuleFallbackAssembler(index, est, _CFG_EXTREME).solve(problem)
    off = RuleFallbackAssembler(index, TravelEstimator(_CFG_OFF), _CFG_OFF).solve(problem)
    assert on == off  # 쿼터 = 후보 수 → 재정렬 무발동
    assert _total_slots(on) == len(problem.candidates)


# ── ⑤ 적대적 HC PBT — 과장 가중 + 편중 풀에서도 HC1~4 불파괴 ──────
# (기본 가중의 HC 보존은 기존 게이트가 커버 — 여기는 과장 가중 구멍만.
#  소프트 항은 목적함수만 만지므로 가해집합 불변 — 검증기 무접촉이 정리다.)


@settings(max_examples=15, deadline=None)
@given(setup=skewed_category_setups())
def test_pbt_extreme_category_penalty_never_violates_hard_constraints(setup) -> None:
    problem, index = setup
    est = TravelEstimator(_CFG_EXTREME)
    result = OrToolsAssembler(index, est, _CFG_EXTREME).solve(problem, 1500)
    if result is not None:
        assert check_all(result, problem, index, est) == []
    fb = RuleFallbackAssembler(index, est, _CFG_EXTREME).solve(problem)
    assert check_all(fb, problem, index, est) == []


# ── ⑥ config — 신규 2필드 음수 거부 ──────────────────────────────


def test_config_rejects_negative_category_free_count() -> None:
    with pytest.raises(ValueError, match="category_free_count"):
        AssemblyConfig(category_free_count=-1)


def test_config_rejects_negative_category_excess_penalty() -> None:
    with pytest.raises(ValueError, match="category_excess_penalty"):
        AssemblyConfig(category_excess_penalty=-0.1)
