"""테마 태그·평판을 도우미 탐색과 재계획 규칙 폴백에 반영 (TRIP-1537).

말 → 테마 동의어 표(`domain.theme_tags`)가 오탐 없이 뜻이 분명한 구절만 잡고, 그 결과가 정렬에 닿는지를 고정한다.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from trippilot.agents.planb.rag import _rule_ranking
from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.llm import CandidatePool
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.domain.theme_tags import THEME_TAGS, themes_in
from trippilot.orchestrator import dialogue_handlers as dh

_A = GeoPoint(37.5, 127.0)


def _poi(pid: str, tags: tuple[str, ...] = (), km: float = 1.0, saved: int = 0,
         category: PoiCategory = PoiCategory.FOOD) -> Poi:
    # 위도 0.009 도 ≈ 1km
    return Poi(poi_id=PoiId(pid), name=pid, category=category, coord=GeoPoint(37.5 + 0.009 * km, 127.0),
               open_hours=(), avg_cost=None, rating=None, quality=DataQuality.FULL, source=PoiSource.SEED,
               confidence=None, saved_count=saved, tags=tags)


@pytest.mark.parametrize("text,expected", [
    ("혼자 가기 좋은 곳", ("혼밥", "혼술")),
    ("혼밥하기 좋은 식당", ("혼밥",)),
    ("아이랑 갈 만한 카페", ("아이동반",)),
    ("사진 찍기 좋은 뷰 카페", ("뷰", "사진")),
    ("가성비 좋은 단체 회식 장소", ("단체", "가성비")),
    ("조용한 분위기에서 공부", ("작업", "분위기")),
    ("바다 보이는 곳", ("뷰",)),
    ("주차 편한 곳", ("주차",)),
    # 오탐 방지 — 짧은 낱말이 다른 말에 박히지 않는다
    ("아이스크림 맛집", ()),
    ("오래된 한옥 카페", ()),
    ("싼 티 나는 곳", ()),
    ("", ()),
    (None, ()),
])
def test_말에서_테마_태그를_뽑는다(text, expected) -> None:
    assert themes_in(text) == expected


def test_표가_내놓는_태그는_모두_정제_어휘_13종_안이다() -> None:
    assert len(THEME_TAGS) == 13 and len(set(THEME_TAGS)) == 13
    for t in ("혼자 가기", "아이랑", "사진", "가성비", "단체", "데이트 코스", "주차", "느긋하게 오래 머물", "야외 테라스", "분위기 좋은", "노트북 작업", "경치", "혼술"):
        assert set(themes_in(t)) <= set(THEME_TAGS)


def test_도우미_탐색은_말의_테마와_맞는_태그를_앞에_둔다() -> None:
    pois = [_poi("plain"), _poi("kid", ("아이동반",)), _poi("view", ("뷰",))]
    ranked = dh._explore_rank(pois, None, "아이랑 가기 좋은")
    assert [p.poi_id for p in ranked][0] == "kid"


def test_도우미_탐색은_평판이_높은_쪽을_앞에_두고_태그가_없으면_가운데다() -> None:
    pois = [_poi("low", ("인기1",)), _poi("none"), _poi("top", ("인기5", "평점높음"))]
    assert [p.poi_id for p in dh._explore_rank(pois, "FOOD", None)] == ["top", "none", "low"]


def _pool(pois: list[Poi]) -> CandidatePool:
    return CandidatePool(poi_ids=frozenset(p.poi_id for p in pois), pois=tuple(pois), generated_at=datetime(2026, 10, 21, tzinfo=UTC), anchor=_A, radius_km=10.0)


def _rank(pois: list[Poi], request: str = "") -> list[str]:
    ranked, _ = _rule_ranking((), _pool(pois), tuple(p.poi_id for p in pois), "", request)
    return list(ranked)


def test_재계획_규칙_폴백은_태그가_없으면_종전처럼_거리순이다() -> None:
    pois = [_poi("far", km=3.0), _poi("near", km=0.5), _poi("mid", km=1.5)]
    assert _rank(pois) == ["near", "mid", "far"]


def test_재계획_규칙_폴백은_평판이_5km_안의_거리_차를_뒤집고_그_밖은_못_뒤집는다() -> None:
    # 평판 +0.10 = 5km 눈금: 2km 더 먼 인기5·평점높음이 앞서고, 8km 더 먼 곳은 못 앞선다
    assert _rank([_poi("near", km=1.0), _poi("famous", ("인기5", "평점높음"), km=3.0)]) == ["famous", "near"]
    assert _rank([_poi("near", km=1.0), _poi("famous", ("인기5", "평점높음"), km=9.0)]) == ["near", "famous"]


def test_재계획_규칙_폴백은_사용자_말의_테마가_맞는_태그를_거리보다_먼저_본다() -> None:
    pois = [_poi("near", km=0.5), _poi("kidfar", ("아이동반",), km=4.0)]
    assert _rank(pois, "아이랑 갈 만한 곳") == ["kidfar", "near"]
    assert _rank(pois, "") == ["near", "kidfar"]       # 말이 없으면 무동작
