"""TRIP-908 — OR-Tools 프리필터가 버린 후보를 **관측**한다 (동작 불변).

`_solve_day` 는 후보가 60곳을 넘으면 점수순 상위 60 만 남긴다. 버린 것에 기록이 없어
"식당 0개 풀"(수집 공백 — TRIP-379 가 설계로 허용)과 "식당이 있었는데 전부 잘림"
(랭킹·상한 문제)이 같은 결과(밥 슬롯 없음)로 수렴하고 구별되지 않았다. 조치가 정반대다.

증명하는 것:
  ① 식당이 전부 잘리면 FOOD 가 "잔존 0" 으로 나온다 → WARNING
  ② 식당이 원래 없던 풀은 FOOD 가 "잔존 0" 에 **안** 나온다 → 두 사건이 갈린다
  ③ 속성: 잔존 0 ⊆ 절단 전 카테고리, 잔존 0 ∩ 남은 카테고리 = ∅, 잘린 건수 합 = 절단 전 − 후
  (동작 불변은 기존 OR-Tools 테스트가 덮는다 — 남기는 후보 계산은 한 글자도 안 바뀌었다)
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
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource

_KST = timezone(timedelta(hours=9))
_DAY = date(2026, 8, 5)
# 해 자체는 이 테스트의 관심이 아니다 — 로그는 CP-SAT 전에 남는다. 짧게 끊는다.
_CFG = AssemblyConfig(or_tools_limit_ms=100, or_tools_min_ms=50)


def _poi(pid: str, cat: PoiCategory, k: int) -> Poi:
    return Poi(PoiId(pid), pid, cat, GeoPoint(37.751 + 0.001 * (k % 20), 128.876), (),
               None, None, DataQuality.FULL, PoiSource.SEED, None)


def _pool(spec: list[tuple[PoiCategory, int, float]]):
    """(카테고리, 개수, 점수) 묶음 → (poi_index, 후보)."""
    pois, cands, k = [], [], 0
    for cat, n, score in spec:
        for _ in range(n):
            pid = f"{cat.value.lower()}-{k:03d}"
            pois.append(_poi(pid, cat, k))
            cands.append(ScoredPoi(PoiId(pid), score, False))
            k += 1
    return {p.poi_id: p for p in pois}, cands


def _solve_logging(index, cands, caplog):
    problem = ItineraryProblem(
        schedule_id=ScheduleId("s-908"), days=(_DAY,), candidates=tuple(cands),
        fixed_blocks=(), budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=TimeWindow(datetime(2026, 8, 5, 9, 0, tzinfo=_KST),
                              datetime(2026, 8, 5, 21, 0, tzinfo=_KST)),
        seed=7)
    with caplog.at_level(logging.INFO, logger="trippilot.assembly_engine.ortools_assembler"):
        OrToolsAssembler(index, TravelEstimator(_CFG), _CFG).solve(problem, 200)
    return [r for r in caplog.records if "프리필터" in r.getMessage()]


def _top(cands):
    return sorted(cands, key=lambda c: (-c.score, str(c.poi_id)))[:_PREFILTER_TOP_K]


# ── ① 식당이 전부 잘렸다 ─────────────────────────────────────────────


def test_all_food_cut_is_reported_as_zeroed(caplog) -> None:
    index, cands = _pool([(PoiCategory.SIGHT, 70, 0.9), (PoiCategory.FOOD, 5, 0.1)])

    cut, zeroed = prefilter_cut(cands, _top(cands), index)
    records = _solve_logging(index, cands, caplog)

    assert zeroed == (PoiCategory.FOOD,)
    assert cut == {PoiCategory.SIGHT: 10, PoiCategory.FOOD: 5}
    assert len(records) == 1 and records[0].levelno == logging.WARNING
    assert "잔존 0: FOOD" in records[0].getMessage()


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
