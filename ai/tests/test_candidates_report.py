"""후보 충분성 판정 `candidates_report` (BR-U2-05, 2026-10-02 개정).

LOW 는 **취향이 요구하는 카테고리가 풀에 0건**이거나 **풀이 하루 최소 슬롯 수 × 일수보다
작을 때**만. 취향과 무관한 카테고리 공백은 `shortfall_categories` 에만 남는다.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from hypothesis import given
from hypothesis import strategies as st

from trippilot.agents.schedule.outcome import (
    MIN_SLOTS_PER_DAY,
    candidates_report,
)
from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId
from trippilot.domain.llm import CandidatePool
from trippilot.domain.persona import ACTIVITY_LABELS, CUISINE_LABELS, PersonaSummary, TasteTag
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource

_NOW = datetime(2026, 10, 2, 9, 0, tzinfo=timezone(timedelta(hours=9)))
_BOUNDARY = tuple(c for c in PoiCategory if c is not PoiCategory.STAY)


def _pool(categories) -> CandidatePool:
    pois = tuple(
        Poi(poi_id=PoiId(f"p{i}"), name=f"P{i}", category=c,
            coord=GeoPoint(33.5, 126.5), open_hours=(), avg_cost=None, rating=None,
            quality=DataQuality.FULL, source=PoiSource.SEED, confidence=None)
        for i, c in enumerate(categories)
    )
    return CandidatePool(poi_ids=frozenset(p.poi_id for p in pois), pois=pois,
                         generated_at=_NOW)


def _persona(tags=(), activities=(), cuisines=()) -> PersonaSummary:
    return PersonaSummary(taste_tags=tuple(tags), companion=None, budget=BudgetLevel.MID,
                          activities=tuple(activities), cuisines=tuple(cuisines))


def _no(*missing: PoiCategory) -> list[PoiCategory]:
    """missing 을 뺀 경계 카테고리로 충분히 큰(1일 기준) 풀."""
    return [c for c in _BOUNDARY if c not in missing] * MIN_SLOTS_PER_DAY


def test_no_taste_shopping_gap_is_ok_but_reported() -> None:
    r = candidates_report(_pool(_no(PoiCategory.SHOPPING)), days=1, persona=None)
    assert r.level == "OK"
    assert r.shortfall_categories == ("SHOPPING",)


def test_empty_taste_persona_never_triggers_taste_low() -> None:
    r = candidates_report(_pool(_no(PoiCategory.SHOPPING, PoiCategory.FOOD)),
                          days=1, persona=_persona())
    assert r.level == "OK"


def test_food_taste_with_no_food_is_low() -> None:
    pool = _pool(_no(PoiCategory.FOOD))
    assert candidates_report(pool, days=1, persona=_persona(tags=[TasteTag.FOOD])).level == "LOW"
    # activities·cuisines 도 같은 축으로 사상된다
    assert candidates_report(pool, days=1, persona=_persona(activities=["맛집투어"])).level == "LOW"
    assert candidates_report(pool, days=1, persona=_persona(cuisines=["한식"])).level == "LOW"


def test_unrelated_taste_gap_is_ok() -> None:
    r = candidates_report(_pool(_no(PoiCategory.NIGHT_VIEW)), days=1,
                          persona=_persona(tags=[TasteTag.FOOD], activities=["카페"]))
    assert r.level == "OK"
    assert r.shortfall_categories == ("NIGHT_VIEW",)


def test_empty_pool_is_no_candidates() -> None:
    r = candidates_report(_pool([]), days=1, persona=_persona(tags=[TasteTag.FOOD]))
    assert r.level == "NO_CANDIDATES"
    assert r.pool_size == 0


def test_undersized_pool_is_low() -> None:
    full = list(_BOUNDARY)  # 8건 — 모든 카테고리 있음
    assert candidates_report(_pool(full), days=1, persona=None).level == "OK"
    # 2일 = 최소 10슬롯 > 8건
    assert candidates_report(_pool(full), days=2, persona=None).level == "LOW"


_categories = st.lists(st.sampled_from(list(PoiCategory)), max_size=40)
_personas = st.one_of(st.none(), st.builds(
    _persona,
    tags=st.lists(st.sampled_from(list(TasteTag)), max_size=3),
    activities=st.lists(st.sampled_from(ACTIVITY_LABELS), max_size=3),
    cuisines=st.lists(st.sampled_from(CUISINE_LABELS), max_size=2),
))


@given(cats=_categories, days=st.integers(1, 5), persona=_personas)
def test_report_properties(cats, days, persona) -> None:
    r = candidates_report(_pool(cats), days=days, persona=persona)
    present = set(cats)
    # shortfall 은 종전과 동일 — 풀에 없는 경계 카테고리 전부, 정의 순서
    assert r.shortfall_categories == tuple(c.value for c in _BOUNDARY if c not in present)
    assert r.level in {"OK", "LOW", "NO_CANDIDATES"}
    assert r.pool_size == len(cats)
    assert (r.level == "NO_CANDIDATES") == (not cats)
    # 취향 없음 + 풀 충분 → 카테고리 공백이 있어도 OK
    if cats and persona is None and len(cats) >= MIN_SLOTS_PER_DAY * days:
        assert r.level == "OK"
    # 풀 과소 → (비어 있지 않으면) 항상 LOW
    if cats and len(cats) < MIN_SLOTS_PER_DAY * days:
        assert r.level == "LOW"
