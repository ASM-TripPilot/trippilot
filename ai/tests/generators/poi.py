"""POI·CandidatePool·ScoredPoi generator (business-logic-model.md §4).

- open_hours: open<close, 자정 초과(close>1440) 케이스 포함
- pois: 카테고리·품질 전분포, avg_cost=None 포함, WEB→confidence 보장
- candidate_pools: poi_ids == pois의 id 집합 (INV-1 정상 케이스 보장)
- scored_pois(pool): poi_id ∈ pool (정상) / polluted_scored_pois(pool): 풀 밖 (적대적, U4용)
"""

from __future__ import annotations

from datetime import timedelta, timezone

from hypothesis import strategies as st

from trippilot.domain.common import PoiId
from trippilot.domain.llm import CandidatePool, ScoredPoi
from trippilot.domain.poi import (
    DataQuality,
    OpenHour,
    Poi,
    PoiCategory,
    PoiSource,
    SourcedPoi,
)

from tests.generators.geo import geo_points

_KST = timezone(timedelta(hours=9))  # Asia/Seoul 고정 오프셋 (1차 출시)


@st.composite
def open_hours(draw) -> OpenHour:
    open_min = draw(st.integers(min_value=0, max_value=1439))
    span = draw(st.integers(min_value=1, max_value=1000))  # close>1440 케이스 포함
    return OpenHour(
        day_of_week=draw(st.integers(min_value=0, max_value=6)),
        open_min=open_min,
        close_min=open_min + span,
    )


@st.composite
def _poi_with_id(draw, poi_id: PoiId) -> Poi:
    source = draw(st.sampled_from(list(PoiSource)))
    if source is PoiSource.WEB:
        confidence = draw(st.floats(0, 1, allow_nan=False, allow_infinity=False))
    else:
        confidence = draw(
            st.one_of(st.none(), st.floats(0, 1, allow_nan=False, allow_infinity=False))
        )
    return Poi(
        poi_id=poi_id,
        name=draw(st.text(min_size=1, max_size=20)),
        category=draw(st.sampled_from(list(PoiCategory))),
        coord=draw(geo_points()),
        open_hours=tuple(draw(st.lists(open_hours(), max_size=3))),
        avg_cost=draw(st.one_of(st.none(), st.integers(min_value=0, max_value=100000))),
        rating=draw(
            st.one_of(st.none(), st.floats(0, 5, allow_nan=False, allow_infinity=False))
        ),
        quality=draw(st.sampled_from(list(DataQuality))),
        source=source,
        confidence=confidence,
    )


@st.composite
def pois(draw) -> Poi:
    poi_id = PoiId(draw(st.text(min_size=1, max_size=12)))
    return draw(_poi_with_id(poi_id))


@st.composite
def candidate_pools(draw) -> CandidatePool:
    ids = draw(st.lists(st.text(min_size=1, max_size=12), unique=True, max_size=6))
    pois_tuple = tuple(draw(_poi_with_id(PoiId(x))) for x in ids)
    return CandidatePool(
        poi_ids=frozenset(PoiId(x) for x in ids),
        pois=pois_tuple,
        generated_at=draw(st.datetimes(timezones=st.just(_KST))),
    )


def scored_pois(pool: CandidatePool) -> st.SearchStrategy[ScoredPoi]:
    """poi_id ∈ pool 보장 (INV-1 정상 케이스). 빈 풀이면 생성 불가."""
    if not pool.poi_ids:
        return st.nothing()
    return st.builds(
        ScoredPoi,
        poi_id=st.sampled_from(sorted(pool.poi_ids, key=str)),
        score=st.floats(0, 1, allow_nan=False, allow_infinity=False),
        is_llm_score=st.booleans(),
    )


def free_scored_pois() -> st.SearchStrategy[ScoredPoi]:
    """풀과 무관한 ScoredPoi (단독 직렬화 테스트용)."""
    return st.builds(
        ScoredPoi,
        poi_id=st.builds(PoiId, st.text(min_size=1, max_size=8)),
        score=st.floats(0, 1, allow_nan=False, allow_infinity=False),
        is_llm_score=st.booleans(),
    )


@st.composite
def polluted_scored_pois(draw, pool: CandidatePool) -> ScoredPoi:
    """poi_id ∉ pool 보장 (INV-1 적대적 케이스, U5-P5 — U4 게이트가 사용)."""
    bad = draw(
        st.text(min_size=1, max_size=12).filter(lambda s: PoiId(s) not in pool.poi_ids)
    )
    return ScoredPoi(
        poi_id=PoiId(bad),
        score=draw(st.floats(0, 1, allow_nan=False, allow_infinity=False)),
        is_llm_score=draw(st.booleans()),
    )


def sourced_pois() -> st.SearchStrategy[SourcedPoi]:
    """웹 소싱 원시 후보 (PlacesPort 반환형)."""
    return st.builds(
        SourcedPoi,
        name=st.text(min_size=1, max_size=20),
        coord=geo_points(),
        category=st.sampled_from(list(PoiCategory)),
        source_url=st.one_of(st.none(), st.text(min_size=1, max_size=30)),
        raw_confidence=st.one_of(
            st.none(), st.floats(0, 1, allow_nan=False, allow_infinity=False)
        ),
    )
