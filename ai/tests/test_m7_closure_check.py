"""TRIP-251 — 당일 휴무 배치 접점 (batch_check_closed 연결, U3 FD §2 ③ 비고).

check_closures가 PoiDbPort 경유로만 조회하고, 반환 계약(부분집합·결정론)과
INV-4(포트 실패가 "휴무 없음"으로 침묵 수렴 금지)를 지키는지 검증.
"""

from __future__ import annotations

from datetime import date

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource
from trippilot.m7.cached_repo import CachedPoiRepository
from trippilot.m7.closure_check import (
    ClosureCheckResult,
    ClosureCheckStatus,
    check_closures,
)
from trippilot.m7.config import M7Config

from tests.fakes.in_memory_cache import InMemoryCache
from tests.fakes.in_memory_poi import InMemoryPoi
from tests.generators.m7 import pois_with_attrs

_ON = date(2026, 8, 3)  # 월요일 (weekday 0)


def _poi(pid: str, dows: tuple[int, ...]) -> Poi:
    return Poi(PoiId(pid), pid, PoiCategory.FOOD, GeoPoint(36.33, 127.43),
               tuple(OpenHour(d, 540, 1260) for d in dows), None, 4.0,
               DataQuality.FULL, PoiSource.SEED, None)


class _RaisingClosedSource(InMemoryPoi):
    """batch_check_closed만 장애 — 포트 실패 주입용."""

    def batch_check_closed(self, poi_ids, on):
        raise RuntimeError("db down")


class _GhostClosedSource(InMemoryPoi):
    """입력 밖 poi_id를 돌려주는 계약 위반 소스."""

    def batch_check_closed(self, poi_ids, on):
        return frozenset({PoiId("ghost")})


# ── 단위: 휴무 판별 ──────────────────────────────────────────
def test_closed_on_that_day_is_reported() -> None:
    db = InMemoryPoi(seed=(_poi("open-mon", (0,)), _poi("closed-mon", (1, 2))))
    r = check_closures(db, frozenset({PoiId("open-mon"), PoiId("closed-mon")}), _ON)
    assert r.status is ClosureCheckStatus.OK
    assert r.closed_poi_ids == frozenset({PoiId("closed-mon")})
    assert r.checked_on == _ON


def test_empty_input_returns_empty_without_port_call() -> None:
    class _Counting(InMemoryPoi):
        calls = 0

        def batch_check_closed(self, poi_ids, on):
            self.calls += 1
            return super().batch_check_closed(poi_ids, on)

    db = _Counting()
    r = check_closures(db, frozenset(), _ON)
    assert r == ClosureCheckResult(ClosureCheckStatus.OK, frozenset(), _ON)
    assert db.calls == 0  # 빈 일정 — I/O 없음 (결정론)


def test_wired_through_cached_repo() -> None:
    """운영 배선: CachedPoiRepository(위임 경로) 경유로 동일 결과."""
    src = InMemoryPoi(seed=(_poi("p1", (1,)),))
    repo = CachedPoiRepository(src, InMemoryCache(), M7Config())
    r = check_closures(repo, frozenset({PoiId("p1")}), _ON)
    assert r.status is ClosureCheckStatus.OK
    assert r.closed_poi_ids == frozenset({PoiId("p1")})


# ── INV-4: 실패는 상태로 구분 (침묵 수렴 금지) ────────────────
def test_port_failure_is_failed_not_no_closures() -> None:
    r = check_closures(_RaisingClosedSource(), frozenset({PoiId("p1")}), _ON)
    assert r.status is ClosureCheckStatus.FAILED
    assert r.closed_poi_ids == frozenset()
    assert r.reason and "RuntimeError" in r.reason  # 사유 보존


def test_contract_violation_is_failed_not_silently_fixed() -> None:
    r = check_closures(_GhostClosedSource(), frozenset({PoiId("p1")}), _ON)
    assert r.status is ClosureCheckStatus.FAILED  # 조용히 교집합으로 고치지 않는다
    assert r.closed_poi_ids == frozenset()


def test_result_type_forbids_failed_with_closures_or_without_reason() -> None:
    with pytest.raises(ValueError):
        ClosureCheckResult(ClosureCheckStatus.FAILED, frozenset({PoiId("p")}), _ON, "x")
    with pytest.raises(ValueError):
        ClosureCheckResult(ClosureCheckStatus.FAILED, frozenset(), _ON, None)
    with pytest.raises(ValueError):
        ClosureCheckResult(ClosureCheckStatus.OK, frozenset(), _ON, "잉여 사유")


# ── PBT ──────────────────────────────────────────────────────
@settings(max_examples=40)
@given(pois=st.lists(pois_with_attrs(), max_size=12, unique_by=lambda p: p.poi_id),
       picks=st.sets(st.integers(0, 11)),
       on=st.dates(min_value=date(2026, 8, 1), max_value=date(2026, 8, 20)))
def test_closed_set_is_subset_of_input_and_matches_open_hours(pois, picks, on) -> None:
    db = InMemoryPoi(seed=tuple(pois))
    ids = frozenset(pois[k % len(pois)].poi_id for k in picks) if pois else frozenset()
    r = check_closures(db, ids, on)
    assert r.status is ClosureCheckStatus.OK
    assert r.closed_poi_ids <= ids                      # 부분집합
    dow = on.weekday()
    by_id = {p.poi_id: p for p in pois}
    for pid in ids:                                     # 판별 정합 (fake 기준)
        closed = not any(oh.day_of_week == dow for oh in by_id[pid].open_hours)
        assert (pid in r.closed_poi_ids) == closed
    # 직렬화 왕복 (U5-P10 승계)
    assert ClosureCheckResult.from_dict(r.to_dict()) == r


@settings(max_examples=25)
@given(pois=st.lists(pois_with_attrs(), max_size=10, unique_by=lambda p: p.poi_id),
       on=st.dates(min_value=date(2026, 8, 1), max_value=date(2026, 8, 20)))
def test_check_is_deterministic(pois, on) -> None:
    ids = frozenset(p.poi_id for p in pois)
    db = InMemoryPoi(seed=tuple(pois))
    assert check_closures(db, ids, on) == check_closures(db, ids, on)


@settings(max_examples=25)
@given(pois=st.lists(pois_with_attrs(), min_size=1, max_size=8,
                     unique_by=lambda p: p.poi_id))
def test_failure_never_looks_like_ok(pois) -> None:
    """어떤 입력에도 포트 장애가 OK("휴무 없음")로 보이지 않는다 (INV-4)."""
    ids = frozenset(p.poi_id for p in pois)
    r = check_closures(_RaisingClosedSource(seed=tuple(pois)), ids, _ON)
    assert r.status is ClosureCheckStatus.FAILED and r.reason
