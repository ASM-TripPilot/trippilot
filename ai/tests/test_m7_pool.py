"""U3 — CandidatePoolBuilder 6단계 필터 PBT (POOL-P1~P4) + 직렬화.

InMemoryPoi(U1 fake)에 무작위 POI를 넣고, 풀 출력이 필터 계약을 지키는지 검증.
"""

from __future__ import annotations

from datetime import datetime, timezone

from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.c2.travel import haversine_km
from trippilot.domain.common import BudgetLevel
from trippilot.domain.m7 import CandidatePoolRequest
from trippilot.domain.poi import DataQuality
from trippilot.m7.config import M7Config
from trippilot.m7.pool_builder import CandidatePoolBuilder

from tests.fakes.in_memory_poi import InMemoryPoi
from tests.generators.m7 import pois_with_attrs, pool_requests

_CFG = M7Config()
_NOW = datetime(2026, 7, 29, 12, 0, tzinfo=timezone.utc)


def _build(pois, request):
    db = InMemoryPoi(seed=tuple(pois))
    return CandidatePoolBuilder(db, _CFG).build(request, _NOW)


def _applied_radius(request: CandidatePoolRequest) -> float:
    if request.radius_override_km is not None:
        return request.radius_override_km
    r = _CFG.radius_km[request.transport]
    return r * _CFG.multi_day_factor if len(request.dates) > 1 else r


# POOL-P1 — 반경
@settings(max_examples=40)
@given(pois=st.lists(pois_with_attrs(), max_size=15, unique_by=lambda p: p.poi_id),
       request=pool_requests())
def test_pool_all_within_radius(pois, request) -> None:
    pool = _build(pois, request)
    r = _applied_radius(request)
    assert pool.radius_km == r
    for p in pool.pois:
        assert haversine_km(request.anchor, p.coord) <= r + 1e-6


# POOL-P2 — 예산·품질·상한
@settings(max_examples=40)
@given(pois=st.lists(pois_with_attrs(), max_size=15, unique_by=lambda p: p.poi_id),
       request=pool_requests())
def test_pool_budget_quality_cap(pois, request) -> None:
    pool = _build(pois, request)
    limit = _CFG.budget_limit[request.budget]
    for p in pool.pois:
        if limit is not None and p.avg_cost is not None:
            assert p.avg_cost <= limit          # 예산 (None=통과 규칙 확인 포함)
        assert p.quality is not DataQuality.MINIMAL  # 품질
    assert len(pool.pois) <= _CFG.max_candidates     # 상한
    assert pool.poi_ids == {p.poi_id for p in pool.pois}  # INV-1 정합 (U1 재확인)


# POOL-P3 — 결정론
@settings(max_examples=25)
@given(pois=st.lists(pois_with_attrs(), max_size=12, unique_by=lambda p: p.poi_id),
       request=pool_requests())
def test_pool_is_deterministic(pois, request) -> None:
    assert _build(pois, request) == _build(pois, request)


# POOL-P4 — 여행일 전체 휴무 poi 배제
@settings(max_examples=40)
@given(pois=st.lists(pois_with_attrs(), max_size=15, unique_by=lambda p: p.poi_id),
       request=pool_requests())
def test_pool_excludes_never_open(pois, request) -> None:
    pool = _build(pois, request)
    travel_dows = {d.weekday() for d in request.dates}
    for p in pool.pois:
        if p.open_hours:  # 정보 없으면 통과 규칙
            assert any(oh.day_of_week in travel_dows for oh in p.open_hours)


# 직렬화 왕복 (U5-P10 승계)
@given(request=pool_requests())
def test_pool_request_roundtrip(request: CandidatePoolRequest) -> None:
    assert CandidatePoolRequest.from_dict(request.to_dict()) == request


@settings(max_examples=25)
@given(pois=st.lists(pois_with_attrs(), max_size=8, unique_by=lambda p: p.poi_id),
       request=pool_requests())
def test_pool_with_anchor_roundtrip(pois, request) -> None:
    pool = _build(pois, request)
    assert type(pool).from_dict(pool.to_dict()) == pool  # anchor·radius_km 포함
