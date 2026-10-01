"""TRIP-908 — OR-Tools 프리필터가 버린 후보를 **관측**한다 (동작 불변).

`_solve_day` 는 후보가 60곳을 넘으면 점수순 상위 60 만 남긴다. 버린 것에 기록이 없어
"식당 0개 풀"(수집 공백 — TRIP-379 가 설계로 허용)과 "식당이 있었는데 전부 잘림"
(랭킹·상한 문제)이 같은 결과(밥 슬롯 없음)로 수렴하고 구별되지 않았다. 조치가 정반대다.

증명하는 것:
  ① 그날 영업하는 식당은 점수가 최하위여도 식사창 예약석(TRIP-1183)으로 남는다 → FOOD 는
     "잔존 0" 이 아니고 INFO. 영업 식당이 없어 전부 잘리면 여전히 "잔존 0: FOOD" WARNING —
     관측은 예약석 뒤의 실제 잔존을 그대로 말한다
  ② 식당이 원래 없던 풀은 FOOD 가 "잔존 0" 에 **안** 나온다 → 두 사건이 갈린다
  ③ 속성: 잔존 0 ⊆ 절단 전 카테고리, 잔존 0 ∩ 남은 카테고리 = ∅, 잘린 건수 합 = 절단 전 − 후
  (예약석 자체의 성질은 test_assembly_engine_prefilter_food_seats.py)
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.ortools_assembler import (
    _PREFILTER_TOP_K,
    OrToolsAssembler,
    prefilter_cut,
)
from trippilot.assembly_engine.travel import TravelEstimator
from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId, ScheduleId, TransportMode
from trippilot.domain.itinerary import ItineraryProblem, TimeWindow
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource

_KST = timezone(timedelta(hours=9))
_DAY = date(2026, 8, 5)
# 해 자체는 이 테스트의 관심이 아니다 — 로그는 CP-SAT 전에 남는다. 짧게 끊는다.
_CFG = AssemblyConfig(or_tools_limit_ms=100, or_tools_min_ms=50)


def _poi(pid: str, cat: PoiCategory, k: int, hours=()) -> Poi:
    return Poi(PoiId(pid), pid, cat, GeoPoint(37.751 + 0.001 * (k % 20), 128.876), hours,
               None, None, DataQuality.FULL, PoiSource.SEED, None)


# _DAY(수요일)엔 휴무 — 월요일만 영업
_CLOSED_TODAY = (OpenHour(day_of_week=0, open_min=600, close_min=1200),)


def _pool(spec: list[tuple[PoiCategory, int, float]], closed: frozenset = frozenset()):
    """(카테고리, 개수, 점수) 묶음 → (poi_index, 후보). `closed` 카테고리는 그날 휴무."""
    pois, cands, k = [], [], 0
    for cat, n, score in spec:
        for _ in range(n):
            pid = f"{cat.value.lower()}-{k:03d}"
            pois.append(_poi(pid, cat, k, _CLOSED_TODAY if cat in closed else ()))
            cands.append(ScoredPoi(PoiId(pid), score, False))
            k += 1
    return {p.poi_id: p for p in pois}, cands


def _solve_logging(index, cands, caplog, not_before=None):
    problem = ItineraryProblem(
        schedule_id=ScheduleId("s-908"), days=(_DAY,), candidates=tuple(cands),
        fixed_blocks=(), budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=TimeWindow(datetime(2026, 8, 5, 9, 0, tzinfo=_KST),
                              datetime(2026, 8, 5, 21, 0, tzinfo=_KST)),
        seed=7, not_before=not_before)
    with caplog.at_level(logging.INFO, logger="trippilot.assembly_engine.ortools_assembler"):
        OrToolsAssembler(index, TravelEstimator(_CFG), _CFG).solve(problem, 200)
    return [r for r in caplog.records if "프리필터" in r.getMessage()]


def _top(cands):
    return sorted(cands, key=lambda c: (-c.score, str(c.poi_id)))[:_PREFILTER_TOP_K]


# ── ① 최하위 식당 — 영업하면 예약석, 휴무면 여전히 잔존 0 ──────────────


def test_open_food_keeps_meal_seats_and_is_not_zeroed(caplog) -> None:
    """종전엔 이 풀이 "잔존 0: FOOD" 였다(TRIP-908 관측의 대표 사례). 예약석(TRIP-1183)
    뒤로는 식사창 수(2)만큼 식당이 남고, 로그도 그대로 말한다 — 잘린 것은 SIGHT 12·FOOD 3."""
    index, cands = _pool([(PoiCategory.SIGHT, 70, 0.9), (PoiCategory.FOOD, 5, 0.1)])

    records = _solve_logging(index, cands, caplog)

    assert len(records) == 1 and records[0].levelno == logging.INFO
    msg = records[0].getMessage()
    assert "잔존 0" not in msg
    assert "FOOD=3" in msg and "SIGHT=12" in msg


def test_food_closed_today_is_still_reported_as_zeroed(caplog) -> None:
    """예약석은 그날 영업 식당만 받는다 — 전부 휴무면 잘리고, 관측은 정직하게 잔존 0 을 낸다."""
    index, cands = _pool([(PoiCategory.SIGHT, 70, 0.9), (PoiCategory.FOOD, 5, 0.1)],
                         closed=frozenset({PoiCategory.FOOD}))

    cut, zeroed = prefilter_cut(cands, _top(cands), index)
    records = _solve_logging(index, cands, caplog)

    assert zeroed == (PoiCategory.FOOD,)
    assert cut == {PoiCategory.SIGHT: 10, PoiCategory.FOOD: 5}
    assert len(records) == 1 and records[0].levelno == logging.WARNING
    assert "잔존 0: FOOD" in records[0].getMessage()


def test_replan_floor_past_meal_windows_reserves_no_seat(caplog) -> None:
    """재계획 하한이 저녁창까지 지나면 석이 없다(폴백도 그 구간에선 food-first 를 끈다) —
    하한이 `_solve_day` 에서 프리필터까지 실려 간다. 점심창만 지나면 저녁 1석."""
    index, cands = _pool([(PoiCategory.SIGHT, 70, 0.9), (PoiCategory.FOOD, 5, 0.1)])

    late = _solve_logging(index, cands, caplog, datetime(2026, 8, 5, 19, 30, tzinfo=_KST))
    assert late[-1].levelno == logging.WARNING and "잔존 0: FOOD" in late[-1].getMessage()
    caplog.clear()
    mid = _solve_logging(index, cands, caplog, datetime(2026, 8, 5, 15, 0, tzinfo=_KST))
    assert "FOOD=4" in mid[-1].getMessage()


# ── ② 식당이 원래 없었다 — ①과 갈린다 ────────────────────────────────


def test_food_absent_from_pool_is_not_reported_as_zeroed(caplog) -> None:
    index, cands = _pool([(PoiCategory.SIGHT, 75, 0.9)])

    cut, zeroed = prefilter_cut(cands, _top(cands), index)
    records = _solve_logging(index, cands, caplog)

    assert zeroed == ()
    assert cut == {PoiCategory.SIGHT: 15}
    assert len(records) == 1 and records[0].levelno == logging.INFO
    assert "FOOD" not in records[0].getMessage()


def test_no_log_when_prefilter_does_not_cut(caplog) -> None:
    index, cands = _pool([(PoiCategory.SIGHT, 10, 0.9), (PoiCategory.FOOD, 3, 0.5)])
    assert _solve_logging(index, cands, caplog) == []


# ── ③ 속성 ───────────────────────────────────────────────────────────


@settings(max_examples=100, deadline=None)
@given(counts=st.lists(st.tuples(st.sampled_from(list(PoiCategory)), st.integers(0, 30),
                                 st.floats(0.0, 1.0, allow_nan=False)),
                       min_size=1, max_size=8))
def test_prefilter_cut_properties(counts) -> None:
    index, cands = _pool(counts)
    kept = _top(cands)

    cut, zeroed = prefilter_cut(cands, kept, index)

    before_cats = {index[c.poi_id].category for c in cands}
    kept_cats = {index[c.poi_id].category for c in kept}
    assert set(zeroed) <= before_cats
    assert not set(zeroed) & kept_cats
    assert set(zeroed) == before_cats - kept_cats          # 잔존 0 의 정의 그대로
    assert sum(cut.values()) == len(cands) - len(kept)
    assert list(zeroed) == sorted(zeroed, key=lambda c: c.value)   # 결정론


def test_pace_retry_does_not_double_count_the_cut(caplog, monkeypatch) -> None:
    """pace 로 해가 없어 무보정 재시도해도 같은 날 절단 기록은 1줄 — 빈도가 두 배로 세지면 안 된다."""
    from dataclasses import replace
    from trippilot.domain.itinerary import Pace

    index, cands = _pool([(PoiCategory.SIGHT, 70, 0.9), (PoiCategory.FOOD, 5, 0.1)])
    calls = []
    real = OrToolsAssembler._solve_day

    def first_fails(self, problem, day, used, budget_ms, **kw):
        calls.append(problem.pace)
        out = real(self, problem, day, used, budget_ms, **kw)
        return None if problem.pace is not None else out   # pace 시도는 해 없음으로

    monkeypatch.setattr(OrToolsAssembler, "_solve_day", first_fails)
    problem = ItineraryProblem(
        schedule_id=ScheduleId("s-908"), days=(_DAY,), candidates=tuple(cands),
        fixed_blocks=(), budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=TimeWindow(datetime(2026, 8, 5, 9, 0, tzinfo=_KST),
                              datetime(2026, 8, 5, 21, 0, tzinfo=_KST)),
        seed=7, pace=list(Pace)[0])
    with caplog.at_level(logging.INFO, logger="trippilot.assembly_engine.ortools_assembler"):
        OrToolsAssembler(index, TravelEstimator(_CFG), _CFG).solve(problem, 200)

    assert len(calls) == 2 and calls[1] is None          # 전제 — 재시도가 실제로 돌았다
    assert len([r for r in caplog.records if "프리필터" in r.getMessage()]) == 1
