"""U3 — CandidatePoolBuilder 6단계 필터 PBT (POOL-P1~P4) + 직렬화.

InMemoryPoi(U1 fake)에 무작위 POI를 넣고, 풀 출력이 필터 계약을 지키는지 검증.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, timezone

from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.assembly_engine.travel import haversine_km
from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId, TransportMode
from trippilot.domain.poi_curation import CandidatePoolRequest
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource
from trippilot.poi_curation.config import M7Config
from trippilot.poi_curation.pool_builder import CandidatePoolBuilder

from tests.fakes.in_memory_poi import InMemoryPoi
from tests.generators.poi_curation import pois_with_attrs, pool_requests

_CFG = M7Config()
_NOW = datetime(2026, 7, 29, 12, 0, tzinfo=timezone.utc)
_ANCHOR = GeoPoint(37.751, 128.876)
_ALL_WEEK = tuple(OpenHour(d, 540, 1260) for d in range(7))


def _build(pois, request, cfg: M7Config = _CFG):
    db = InMemoryPoi(seed=tuple(pois))
    return CandidatePoolBuilder(db, cfg).build(request, _NOW)


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


# ── 영업시간 보유 정렬 신호 (TRIP-326, U6 이전 임시 완화) ────────────────────
#
# 배제(필터)가 아니라 **순위 강등**이다. 아래 테스트들이 그 경계를 고정한다:
# 순서(P5) / 상한 절단 시 생존 우선권 / 기존 정렬 성질 회귀 없음(P6) / 필터 아님.

def _poi(pid: str, *, open_hours=(), rating=None, coord=_ANCHOR, saved_count=0) -> Poi:
    return Poi(
        poi_id=PoiId(pid),
        name=pid,
        category=PoiCategory.SIGHT,
        coord=coord,
        open_hours=open_hours,
        avg_cost=None,
        rating=rating,
        quality=DataQuality.FULL,
        source=PoiSource.SEED,
        confidence=None,
        saved_count=saved_count,
    )


def _request(**kw) -> CandidatePoolRequest:
    base = dict(
        anchor=_ANCHOR,
        dates=(date(2026, 8, 3),),
        budget=BudgetLevel.HIGH,
        transport=TransportMode.CAR,
        radius_override_km=None,
    )
    return CandidatePoolRequest(**{**base, **kw})


def test_open_hours_poi_precedes_missing_even_with_lower_rating() -> None:
    """예제 — 평점이 낮아도 영업시간 보유 POI가 앞선다."""
    pool = _build([_poi("z-open", open_hours=_ALL_WEEK, rating=1.0),
                   _poi("a-none", rating=5.0)], _request())
    assert [str(p.poi_id) for p in pool.pois] == ["z-open", "a-none"]


@settings(max_examples=40)
@given(pois=st.lists(pois_with_attrs(), max_size=15, unique_by=lambda p: p.poi_id),
       request=pool_requests())
def test_pool_orders_open_hours_first(pois, request) -> None:
    """POOL-P5 — 영업시간 보유 POI는 미보유 POI보다 항상 앞."""
    flags = [not p.open_hours for p in _build(pois, request).pois]
    assert flags == sorted(flags)  # False(보유) 구간이 True(미보유) 구간보다 앞


@settings(max_examples=40)
@given(pois=st.lists(pois_with_attrs(), max_size=15, unique_by=lambda p: p.poi_id),
       request=pool_requests())
def test_pool_secondary_keys_unchanged_within_group(pois, request) -> None:
    """POOL-P6 회귀 — 같은 보유 상태 안에서는 rating desc → poi_id asc 유지."""
    for has_hours in (True, False):
        group = [p for p in _build(pois, request).pois if bool(p.open_hours) is has_hours]
        keys = [(-(p.rating or 0.0), str(p.poi_id)) for p in group]
        assert keys == sorted(keys)


@settings(max_examples=40)
@given(pois=st.lists(pois_with_attrs(), max_size=15, unique_by=lambda p: p.poi_id),
       request=pool_requests(), cap=st.integers(min_value=1, max_value=15))
def test_pool_cap_truncates_ordered_prefix(pois, request, cap) -> None:
    """상한 절단은 정렬 결과의 앞부분만 남긴다 → 영업시간 보유분이 먼저 생존."""
    full = _build(pois, request)
    capped = _build(pois, request, M7Config(max_candidates=cap))
    assert capped.pois == full.pois[:cap]


def test_cap_keeps_open_hours_pois_at_default_limit() -> None:
    """기본 상한(5000)에서 영업시간 보유분이 미보유 대량 후보를 밀어내고 살아남는다."""
    kept = [_poi(f"open-{i:04d}", open_hours=_ALL_WEEK, rating=0.0) for i in range(10)]
    flood = [_poi(f"none-{i:04d}", rating=5.0) for i in range(_CFG.max_candidates)]
    pool = _build(kept + flood, _request())
    assert len(pool.pois) == _CFG.max_candidates
    assert {p.poi_id for p in kept} <= pool.poi_ids  # 평점 5.0 미보유분보다 우선 생존


def test_missing_open_hours_is_not_excluded() -> None:
    """예제 — 전 후보가 영업시간 미보유여도 풀은 비지 않는다 (필터 아님)."""
    pois = [_poi("a"), _poi("b"), _poi("c")]
    assert _build(pois, _request()).poi_ids == {p.poi_id for p in pois}


@settings(max_examples=40)
@given(pois=st.lists(pois_with_attrs(), max_size=15, unique_by=lambda p: p.poi_id),
       request=pool_requests())
def test_open_hours_signal_never_excludes(pois, request) -> None:
    """PBT — 영업시간을 모두 지워도 풀 구성원은 상시 영업 POI일 때와 동일 (순서만 변함)."""
    stripped = [replace(p, open_hours=()) for p in pois]
    always_open = [replace(p, open_hours=_ALL_WEEK) for p in pois]
    assert _build(stripped, request).poi_ids == _build(always_open, request).poi_ids


# ── 인기 정렬 = saved_count (TRIP-280 잔여 해소) ──────────────────────────────

def test_saved_count_desc_orders_within_same_open_hours_group() -> None:
    """같은 영업시간 보유 상태 안에서는 저장 수가 많은 쪽이 앞선다 (poi_id 역순으로 배치)."""
    pool = _build([_poi("a-cold", saved_count=0),
                   _poi("b-hot", saved_count=120),
                   _poi("c-mid", saved_count=7)], _request())
    assert [str(p.poi_id) for p in pool.pois] == ["b-hot", "c-mid", "a-cold"]


def test_open_hours_still_outranks_saved_count() -> None:
    """인기는 2순위 — 영업시간 보유 신호(TRIP-326)를 뒤집지 않는다."""
    pool = _build([_poi("z-open", open_hours=_ALL_WEEK, saved_count=0),
                   _poi("a-hot", saved_count=999)], _request())
    assert [str(p.poi_id) for p in pool.pois] == ["z-open", "a-hot"]


def test_rule_score_increases_with_saved_count() -> None:
    """규칙 점수의 인기 항도 같은 신호를 쓴다 — 죽은 rating 항 대체."""
    from trippilot.assembly_engine.scorer import build_rule_score

    cold, hot = _poi("p", saved_count=0), _poi("p", saved_count=500)
    assert build_rule_score(hot, BudgetLevel.HIGH, None, 7) > build_rule_score(cold, BudgetLevel.HIGH, None, 7)
