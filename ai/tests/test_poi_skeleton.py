"""U1 — POI + closed-set 절편 PBT.

증명하는 것:
  ① 직렬화 왕복 (U5-P10): Poi·CandidatePool 왕복 동일 (중첩·datetime·frozenset 포함)
  ② INV-1 강제         : poi_ids 인덱스가 pois와 어긋나면 생성 거부
  ③ 가격 캐싱 금지      : to_cacheable_dict()에 avg_cost 없음 (business-rules.md §6)
  ④ 후보 멤버십         : 풀 안 모든 poi가 contains()로 확인됨 (INV-1 판정 기반)
  ⑤ 카테고리 값 표 완전성: PoiCategory 전 값이 c2 값 표(STAY_DEFAULT_MIN·CATEGORY_WEIGHT)에
                          존재 — 두 표 모두 직접 dict 조회라 키 누락은 런타임 KeyError (TRIP-281).
                          enum이 바뀔 때 깨져야 하므로 enum과 같은 파일에서 지킨다.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from hypothesis import given
from hypothesis import strategies as st

from trippilot.c2.config import STAY_DEFAULT_MIN
from trippilot.c2.scorer import CATEGORY_WEIGHT
from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.llm import CandidatePool, ScoredPoi
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource, SourcedPoi

from tests.generators.geo import geo_points
from tests.generators.poi import (
    candidate_pools,
    free_scored_pois,
    open_hours,
    pois,
    polluted_scored_pois,
    sourced_pois,
)


# ① 직렬화 왕복
@given(poi=pois())
def test_poi_serialization_roundtrip(poi: Poi) -> None:
    assert Poi.from_dict(poi.to_dict()) == poi


@given(pool=candidate_pools())
def test_candidate_pool_serialization_roundtrip(pool: CandidatePool) -> None:
    assert CandidatePool.from_dict(pool.to_dict()) == pool


# ② INV-1 강제 — 인덱스와 실제 id가 어긋난 풀은 생성 불가
def test_candidate_pool_rejects_index_mismatch() -> None:
    poi = Poi(
        poi_id=PoiId("p1"),
        name="a",
        category=PoiCategory.FOOD,
        coord=GeoPoint(37.5, 127.0),
        open_hours=(),
        avg_cost=None,
        rating=None,
        quality=DataQuality.FULL,
        source=PoiSource.SEED,
        confidence=None,
    )
    fixed_now = datetime(2026, 7, 21, 12, 0, tzinfo=timezone.utc)
    with pytest.raises(ValueError):
        # poi는 p1 하나뿐인데 인덱스에 유령 id를 넣음 → INV-1 위반
        CandidatePool(
            poi_ids=frozenset({PoiId("p1"), PoiId("GHOST")}),
            pois=(poi,),
            generated_at=fixed_now,
        )


# ② 보강 — 생성기가 만드는 풀은 항상 불변식 만족
@given(pool=candidate_pools())
def test_generated_pool_satisfies_invariant(pool: CandidatePool) -> None:
    assert pool.poi_ids == {p.poi_id for p in pool.pois}


# ③ 가격 캐싱 금지
@given(poi=pois())
def test_cacheable_dict_excludes_price(poi: Poi) -> None:
    assert "avg_cost" not in poi.to_cacheable_dict()


# ④ 후보 멤버십 — 풀 안 poi는 전부 contains() True
@given(pool=candidate_pools())
def test_pool_contains_all_its_pois(pool: CandidatePool) -> None:
    assert all(pool.contains(p.poi_id) for p in pool.pois)


# ⑤ 카테고리 값 표 완전성 (TRIP-281) — 키셋 명시 비교. 새 카테고리를 enum에만 추가하면
#    여기서 즉시 빨개진다(런타임 KeyError로 미루지 않음).
def test_stay_default_min_covers_every_category() -> None:
    missing = [c for c in PoiCategory if c not in STAY_DEFAULT_MIN]
    assert not missing, f"STAY_DEFAULT_MIN 누락: {missing}"


def test_category_weight_covers_every_category() -> None:
    missing = [c for c in PoiCategory if c not in CATEGORY_WEIGHT]
    assert not missing, f"CATEGORY_WEIGHT 누락: {missing}"


def test_category_tables_have_no_stale_keys() -> None:
    """폐기된 카테고리(예: TRIP-278 ETC)가 표에 남지 않도록 역방향도 본다."""
    known = set(PoiCategory)
    assert set(STAY_DEFAULT_MIN) == known
    assert set(CATEGORY_WEIGHT) == known


def test_boundary_categories_match_backend_contract() -> None:
    """경계 8종 = 백엔드 `/internal/pois` 코드 집합. STAY는 내부 전용이라 제외 (PR #104 회신)."""
    boundary = {
        "SIGHT", "FOOD", "CAFE", "NIGHT_VIEW",
        "NATURE", "SHOPPING", "CULTURE", "ACTIVITY",
    }
    assert {c.value for c in PoiCategory} - {"STAY"} == boundary


# ── 보강: 단독 직렬화 왕복 (기존엔 부모 통해 간접 검증되던 타입들) ──
@given(g=geo_points())
def test_geopoint_roundtrip(g: GeoPoint) -> None:
    assert GeoPoint.from_dict(g.to_dict()) == g


@given(oh=open_hours())
def test_open_hour_roundtrip(oh: OpenHour) -> None:
    assert OpenHour.from_dict(oh.to_dict()) == oh


@given(sp=free_scored_pois())
def test_scored_poi_roundtrip(sp: ScoredPoi) -> None:
    assert ScoredPoi.from_dict(sp.to_dict()) == sp


@given(sp=sourced_pois())
def test_sourced_poi_roundtrip(sp: SourcedPoi) -> None:
    assert SourcedPoi.from_dict(sp.to_dict()) == sp


# ── 보강: 적대적 생성기 유효성 (INV-1 U4 게이트 재료, U5-P5) ──
@given(pool=candidate_pools(), data=st.data())
def test_polluted_scored_poi_is_outside_pool(pool: CandidatePool, data) -> None:
    bad = data.draw(polluted_scored_pois(pool))
    assert not pool.contains(bad.poi_id)  # 풀 밖 id 보장 — 게이트가 드롭할 대상
