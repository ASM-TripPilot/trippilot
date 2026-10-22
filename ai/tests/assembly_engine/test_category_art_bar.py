"""미술(ART)·술집(BAR) 카테고리 신설 (TRIP-1545) — 새 카테고리가 표마다 빠짐없이 들어갔는지, 문화·맛집에서 갈라진 뜻이 지켜지는지.

전 값을 덮어야 하는 표(가중·체류시간)는 직접 dict 조회라 하나라도 빠지면 KeyError 다 — 새 값이 늘 때마다 이 테스트가 먼저 깨진다.
"""

from __future__ import annotations

import pytest

from trippilot.agents.schedule.family import _EATERY
from trippilot.agents.schedule.outcome import _wanted_categories
from trippilot.assembly_engine.config import RAIN_INDOOR, RAIN_OUTDOOR, STAY_DEFAULT_MIN
from trippilot.assembly_engine.scorer import CATEGORY_WEIGHT
from trippilot.domain.common import BudgetLevel
from trippilot.domain.persona import PersonaSummary, TasteTag
from trippilot.domain.poi import PoiCategory
from trippilot.orchestrator import dialogue_handlers as dh


def test_경계_코드는_ART_BAR_를_포함해_열_개다() -> None:
    assert {c.value for c in PoiCategory} - {"STAY"} == {
        "SIGHT", "FOOD", "CAFE", "NIGHT_VIEW", "NATURE", "SHOPPING", "CULTURE", "ACTIVITY", "ART", "BAR"}


@pytest.mark.parametrize("cat", list(PoiCategory))
def test_전_카테고리가_가중과_체류시간_표에_있다(cat: PoiCategory) -> None:
    assert cat in CATEGORY_WEIGHT
    assert cat in STAY_DEFAULT_MIN


def test_미술은_문화와_같은_축_술집은_카페와_같은_단이고_둘_다_실내다() -> None:
    assert CATEGORY_WEIGHT[PoiCategory.ART] == CATEGORY_WEIGHT[PoiCategory.CULTURE]
    assert CATEGORY_WEIGHT[PoiCategory.BAR] == CATEGORY_WEIGHT[PoiCategory.CAFE]
    assert {PoiCategory.ART, PoiCategory.BAR} <= RAIN_INDOOR
    assert not ({PoiCategory.ART, PoiCategory.BAR} & RAIN_OUTDOOR)


def test_술집은_맛집이었던_곳이라_같은_단지_묶기에서_식당과_같이_뺀다() -> None:
    assert PoiCategory.BAR in _EATERY


def _persona(tags=()) -> PersonaSummary:
    return PersonaSummary(taste_tags=tuple(tags), companion=None, budget=BudgetLevel.MID, activities=(), cuisines=())


def test_문화_취향이면_미술도_바라고_다른_취향은_미술을_끌어오지_않는다() -> None:
    assert PoiCategory.ART in _wanted_categories(_persona([TasteTag.CULTURE]))
    assert PoiCategory.ART not in _wanted_categories(_persona([TasteTag.FOOD, TasteTag.NATURE]))


def test_탐색에서_문화를_고르면_미술도_나오고_맛집은_술집을_끌어오지_않는다() -> None:
    assert dh._EXPLORE_FAMILY["CULTURE"] == ("CULTURE", "ART")
    assert "FOOD" not in dh._EXPLORE_FAMILY and "BAR" not in sum(dh._EXPLORE_FAMILY.values(), ())
