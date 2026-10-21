"""지도 앱 평판 태그(`인기1`~`인기5`·`평점높음`)와 술집 표지 — 점수·풀 정렬 반영 (TRIP-1537).

원칙: 태그가 없으면 중립(0)이다 — 모르는 곳을 깎지 않는다. 영향은 작고(-0.06 ~ +0.10) 같은 카테고리 안의 순서를 가른다.
"""

from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from trippilot.assembly_engine.scorer import build_rule_score
from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.poi import (
    HIGH_RATING_TAG,
    NIGHTLIFE_TAG,
    DataQuality,
    OpenHour,
    Poi,
    PoiCategory,
    PoiSource,
    popularity_grade,
    reputation_bonus,
)
from trippilot.poi_curation.pool_builder import CandidatePoolBuilder
from trippilot.poi_curation.sourcing import overture


def _poi(pid: str, tags: tuple[str, ...] = (), category: PoiCategory = PoiCategory.FOOD,
         hours: tuple[OpenHour, ...] = (), saved: int = 0) -> Poi:
    return Poi(
        poi_id=PoiId(pid), name=pid, category=category, coord=GeoPoint(37.5, 127.0),
        open_hours=hours, avg_cost=None, rating=None, quality=DataQuality.FULL,
        source=PoiSource.SEED, confidence=None, saved_count=saved, tags=tags,
    )


def test_술집_표지는_나이트라이프에서_이름이_바뀌었고_수집_쪽과_한_이름이다() -> None:
    assert NIGHTLIFE_TAG == "술집"
    assert overture.NIGHTLIFE_TAG == NIGHTLIFE_TAG


@pytest.mark.parametrize("tags,grade", [((), None), (("인기1",), 1), (("한식", "인기5", "평점높음"), 5),
                                        (("인기6",), None), (("인기",), None), (("인기기",), None)])
def test_인기_등급은_인기1에서_인기5만_읽는다(tags: tuple[str, ...], grade: int | None) -> None:
    assert popularity_grade(tags) == grade


def test_태그가_없으면_중립이고_등급은_3이_기준선이다() -> None:
    assert reputation_bonus(()) == 0.0
    assert reputation_bonus(("한식", "혼밥")) == 0.0          # 다른 태그는 보지 않는다
    assert reputation_bonus(("인기3",)) == 0.0
    assert reputation_bonus(("인기5",)) == pytest.approx(0.06)
    assert reputation_bonus(("인기1",)) == pytest.approx(-0.06)
    assert reputation_bonus((HIGH_RATING_TAG,)) == pytest.approx(0.04)
    assert reputation_bonus(("인기5", HIGH_RATING_TAG)) == pytest.approx(0.10)


@given(grade=st.sampled_from([None, 1, 2, 3, 4, 5]), high=st.booleans(), extra=st.lists(st.text(max_size=6), max_size=4))
def test_pbt_보정은_범위_안이고_등급에_단조다(grade: int | None, high: bool, extra: list[str]) -> None:
    tags = tuple(extra) + ((f"인기{grade}",) if grade else ()) + ((HIGH_RATING_TAG,) if high else ())
    assert -0.06 - 1e-9 <= reputation_bonus(tags) <= 0.10 + 1e-9
    if grade and grade < 5:
        up = tuple(extra) + (f"인기{grade + 1}",) + ((HIGH_RATING_TAG,) if high else ())
        assert reputation_bonus(up) > reputation_bonus(tags)


def test_규칙_점수는_태그가_있는_쪽이_같은_조건에서_높고_없으면_그대로다() -> None:
    from trippilot.domain.common import BudgetLevel
    base = build_rule_score(_poi("a"), BudgetLevel.MID, None, 1)
    assert build_rule_score(_poi("a", ("인기3",)), BudgetLevel.MID, None, 1) == base          # 중립
    assert build_rule_score(_poi("a", ("인기5", HIGH_RATING_TAG)), BudgetLevel.MID, None, 1) == pytest.approx(base + 0.10)
    assert build_rule_score(_poi("a", ("인기1",)), BudgetLevel.MID, None, 1) == pytest.approx(base - 0.06)


def test_풀_정렬은_영업시간_저장수가_먼저고_같으면_평판이_가른다_태그_없음은_중간() -> None:
    oh = (OpenHour(day_of_week=0, open_min=600, close_min=1260),)
    pois = [_poi("low", ("인기1",), hours=oh), _poi("none", (), hours=oh), _poi("top", ("인기5", HIGH_RATING_TAG), hours=oh),
            _poi("saved", ("인기1",), hours=oh, saved=3), _poi("nohours", ("인기5",))]
    order = [p.poi_id for p in sorted(pois, key=CandidatePoolBuilder._rank_key)]
    assert order == ["saved", "top", "none", "low", "nohours"]
