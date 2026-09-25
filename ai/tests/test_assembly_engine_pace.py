"""여행 속도(pace) — 체류시간 정수비가 하루 밀도를 바꾸는가 (TRIP-906).

## 무엇을 단언하지 않는가

**해의 동일성을 쓰지 않는다.** CP-SAT 시한이 벽시계라 같은 입력·같은 seed 로도 후보가
많아지면 해가 갈린다(실측: 후보 25곳에서 6회 중 2종). pace 회귀를 해 동일성으로 잡으면
pace 와 무관한 이유로 빨개진다. 슬롯 **수**는 안정적이라 그쪽을 본다.

**품질 점수로도 판정하지 않는다.** `QualityScore` 의 route_efficiency 가 이동거리 감소
함수라 슬롯을 줄이면 composite 가 **올라간다** — 지표로 A/B 하면 전 사용자를 느긋하게로
몰게 된다.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, timedelta, timezone

import pytest

from trippilot.assembly_engine.config import (
    PACE_STAY_RATIO,
    STAY_DEFAULT_MIN,
    AssemblyConfig,
    stay_for,
)
from trippilot.assembly_engine.fallback_assembler import RuleFallbackAssembler
from trippilot.assembly_engine.ortools_assembler import OrToolsAssembler
from trippilot.assembly_engine.travel import TravelEstimator
from trippilot.domain.common import (
    BudgetLevel,
    GeoPoint,
    Pace,
    PoiId,
    ScheduleId,
    TransportMode,
)
from trippilot.domain.itinerary import FixedBlock, ItineraryProblem, TimeWindow
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource

_KST = timezone(timedelta(hours=9))
_DAY = date(2026, 9, 1)
_CFG = AssemblyConfig(or_tools_limit_ms=2000, or_tools_min_ms=50)
_EST = TravelEstimator(_CFG)

_CATS = (PoiCategory.SIGHT, PoiCategory.FOOD, PoiCategory.CAFE, PoiCategory.NATURE,
         PoiCategory.CULTURE, PoiCategory.SHOPPING)


def _problem(n: int = 10, *, pace: Pace | None = None, fixed: FixedBlock | None = None):
    pois = [
        Poi(PoiId(f"pc{i}"), f"pc{i}", _CATS[i % len(_CATS)],
            GeoPoint(33.500 + 0.006 * (i % 4), 126.520 + 0.006 * (i // 4)), (),
            None, None, DataQuality.FULL, PoiSource.SEED, None)
        for i in range(n)
    ]
    index = {p.poi_id: p for p in pois}
    problem = ItineraryProblem(
        schedule_id=ScheduleId("s-pace"), days=(_DAY,),
        candidates=tuple(ScoredPoi(p.poi_id, 0.9 - 0.01 * i, False)
                         for i, p in enumerate(pois)),
        fixed_blocks=(fixed,) if fixed else (),
        budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=TimeWindow(datetime(2026, 9, 1, 9, 0, tzinfo=_KST),
                              datetime(2026, 9, 1, 21, 0, tzinfo=_KST)),
        seed=7, pace=pace)
    return problem, index


def _slots(problem, index, *, engine="or") -> int:
    asm = (OrToolsAssembler(index, _EST, _CFG) if engine == "or"
           else RuleFallbackAssembler(index, _EST, _CFG))
    out = asm.solve(problem, remaining_ms=2000)
    assert out is not None, f"{engine}: 해 없음 — pace 가 절벽을 넘겼다"
    return sum(len(d.slots) for d in out.days)


# ── 변환 자체 ────────────────────────────────────────────────────────────────

def test_stay_scales_in_the_declared_direction() -> None:
    for cat in _CATS:
        base = STAY_DEFAULT_MIN[cat]
        assert stay_for(cat, Pace.SLOW) > base
        assert stay_for(cat, Pace.BALANCED) == base
        assert stay_for(cat, Pace.PACKED) < base


def test_unset_pace_is_the_pre_pace_behaviour() -> None:
    """기존 호출 전부 무영향 — 이 한 줄이 회귀 보증이다."""
    for cat in STAY_DEFAULT_MIN:
        assert stay_for(cat, None) == STAY_DEFAULT_MIN[cat]


def test_stay_never_drops_below_the_floor() -> None:
    """0 에 수렴하면 하루에 무한정 담기는 퇴화가 생긴다."""
    for cat in STAY_DEFAULT_MIN:
        assert stay_for(cat, Pace.PACKED) >= 20


def test_every_pace_has_a_ratio() -> None:
    """enum 값이 늘었는데 비표가 안 늘면 `KeyError` 가 어셈블리 한복판에서 터진다."""
    missing = [p for p in Pace if p not in PACE_STAY_RATIO]
    assert not missing, f"비표에 없는 속도: {missing}"


def test_ratios_are_integers_for_determinism() -> None:
    """부동소수 곱은 반올림이 플랫폼별로 갈릴 수 있다 — CP-SAT 변수는 정수(분)다."""
    for pace, (num, den) in PACE_STAY_RATIO.items():
        assert isinstance(num, int) and isinstance(den, int) and den > 0


# ── 실제 밀도 ────────────────────────────────────────────────────────────────

def test_or_tools_density_is_monotone_in_pace() -> None:
    slow = _slots(*_problem(pace=Pace.SLOW))
    balanced = _slots(*_problem(pace=Pace.BALANCED))
    packed = _slots(*_problem(pace=Pace.PACKED))
    assert slow <= balanced <= packed, f"단조 아님: {slow}/{balanced}/{packed}"
    assert slow < packed, f"양 끝이 같으면 사용자는 차이를 못 느낀다: {slow} == {packed}"


def test_fallback_moves_the_same_direction() -> None:
    """두 엔진이 반대로 움직이면 폴백 강등 시 일정 밀도가 말없이 뒤집힌다."""
    slow = _slots(*_problem(pace=Pace.SLOW), engine="fb")
    packed = _slots(*_problem(pace=Pace.PACKED), engine="fb")
    assert slow <= packed


def test_unset_pace_matches_balanced_today() -> None:
    """지금은 BALANCED 비가 1:1 이라 동작이 같다 — 비를 바꾸면 여기가 먼저 알려준다."""
    assert _slots(*_problem(pace=None)) == _slots(*_problem(pace=Pace.BALANCED))


# ── 불변식 ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("pace", [None, *list(Pace)])
def test_fixed_block_window_is_never_scaled(pace) -> None:
    """고정 블록 체류는 사용자가 정한 창에서 나온다 — 비를 먹이면 HC3 가 깨진다."""
    fb = FixedBlock(
        poi_id=PoiId("pc0"),
        window=TimeWindow(datetime(2026, 9, 1, 13, 0, tzinfo=_KST),
                          datetime(2026, 9, 1, 14, 0, tzinfo=_KST)),
        reason="user_fixed")
    problem, index = _problem(pace=pace, fixed=fb)
    out = OrToolsAssembler(index, _EST, _CFG).solve(problem, remaining_ms=2000)
    assert out is not None
    placed = [s for d in out.days for s in d.slots if s.poi_id == fb.poi_id]
    assert len(placed) == 1
    assert placed[0].start_at == fb.window.start
    assert placed[0].end_at == fb.window.end


def test_pace_survives_serialization_round_trip() -> None:
    problem, _ = _problem(pace=Pace.SLOW)
    assert ItineraryProblem.from_dict(problem.to_dict()).pace is Pace.SLOW


def test_legacy_payload_without_pace_still_loads() -> None:
    """pace 키가 없는 기존 직렬화본 — 하위호환."""
    problem, _ = _problem(pace=Pace.SLOW)
    legacy = problem.to_dict()
    del legacy["pace"]
    assert ItineraryProblem.from_dict(legacy).pace is None


def test_pace_does_not_change_problems_that_did_not_ask_for_it() -> None:
    """무보정 경로 회귀 — 기존 문제에 pace 를 안 주면 직렬화까지 전과 같다."""
    problem, _ = _problem()
    assert problem.pace is None
    assert replace(problem, pace=None).to_dict() == problem.to_dict()


# ── pace 는 소프트 선호 — 지키려다 해를 못 내면 안 지킨다 ────────────────────

def test_unsolvable_pace_retries_unscaled_before_giving_up() -> None:
    """체류 배율이 인스턴스를 어렵게 만들면 **그리디로 내려가기 전에** 무보정으로 한 번 더.

    실측 배경: 후보 60곳·3초 한도에서 무보정은 6/6 성공인데 ×0.9 는 6/6 실패였고,
    후보 45곳에서는 반대로 ×0.95 가 6/6 실패·×0.9 는 성공이었다. "짧을수록 어렵다"가
    아니라 조합마다 어려운 인스턴스가 따로 있다 — 안전한 배율 고르기로는 못 막는다.
    """
    problem, index = _problem(pace=Pace.PACKED)
    asm = OrToolsAssembler(index, _EST, _CFG)
    original = asm._solve_day
    seen: list = []

    def flaky(prob, day, used, budget_ms, **kw):  # kw: 재시도가 넘기는 log_cut (TRIP-908)
        seen.append(prob.pace)
        if len(seen) == 1:
            return None  # 배율 먹인 첫 시도 실패를 흉내
        return original(prob, day, used, budget_ms, **kw)

    asm._solve_day = flaky
    out = asm.solve(problem, remaining_ms=2000)

    assert out is not None, "재시도 없이 포기했다 — 그리디 폴백으로 내려간다"
    assert seen == [Pace.PACKED, None], f"재시도가 무보정이 아니다: {seen}"
    assert not out.is_fallback, "OR 단계 산출물이어야 한다"


def test_no_retry_when_pace_is_unset() -> None:
    """무보정에서 실패한 것은 배율 탓이 아니다 — 같은 걸 또 풀어봐야 시간만 쓴다."""
    problem, index = _problem(pace=None)
    asm = OrToolsAssembler(index, _EST, _CFG)
    calls: list = []

    def always_none(prob, day, used, budget_ms):
        calls.append(prob.pace)
        return None

    asm._solve_day = always_none
    assert asm.solve(problem, remaining_ms=2000) is None
    assert calls == [None], f"불필요한 재시도: {calls}"


# ── 안 쓴 예산을 실패한 일자에 몰아준다 (TRIP-907) ───────────────────────────

def test_failed_day_retries_with_the_unspent_budget() -> None:
    """퍼사드는 잔여 전부를 넘기는데 일자당 상한이 3초라 나머지가 남는다.

    실측(후보 50곳·1일): 3초·6초는 3/3 해없음, 12초는 0/3. 못 푸는 게 아니라
    시간이 모자란 것이고 그 시간은 이미 있다 — 안 쓰고 그리디로 내려가고 있었다.
    """
    problem, index = _problem()
    asm = OrToolsAssembler(index, _EST, _CFG)
    original = asm._solve_day
    caps: list = []

    def flaky(prob, day, used, budget_ms, **kw):
        caps.append(kw.get("cap_ms"))
        if len(caps) == 1:
            return None  # 상한 안에서 못 푼 것을 흉내
        return original(prob, day, used, budget_ms, **kw)

    asm._solve_day = flaky
    out = asm.solve(problem, remaining_ms=15_000)

    assert out is not None, "남은 예산을 안 쓰고 포기했다 — 그리디 폴백으로 내려간다"
    assert caps[0] is None, "첫 시도는 기본 상한이어야 한다(성공 경로 지연 불변)"
    assert caps[1] and caps[1] > _CFG.or_tools_limit_ms, (
        f"재시도가 상한을 안 늘렸다: {caps[1]}")


def test_no_spare_retry_when_budget_is_already_spent() -> None:
    """잔여가 상한과 같으면 몰아줄 것이 없다 — 같은 걸 또 풀어봐야 시간만 쓴다."""
    problem, index = _problem()
    asm = OrToolsAssembler(index, _EST, _CFG)
    calls: list = []

    def always_none(prob, day, used, budget_ms, **kw):
        calls.append(budget_ms)
        return None

    asm._solve_day = always_none
    assert asm.solve(problem, remaining_ms=_CFG.or_tools_limit_ms) is None
    assert len(calls) == 1, f"불필요한 재시도: {calls}"
