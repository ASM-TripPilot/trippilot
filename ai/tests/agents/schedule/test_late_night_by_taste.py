"""늦은 시각(21:00 이후 시작)의 오늘은 취향으로만 고른다 — 2026-10-19 사용자 결정.

"액티비티나 활동적인 걸 좋아하면 야경이나 번화가에서 놀 곳, 자연을 좋아하면 야경 볼 만한 곳. 취향에
기반해서 추천하는 거지. 추천을 안 할 수도 있고." 저녁 8시 반 넘어 만들면 BE 가 오늘을 21:00 부터 연다.

증명하는 것:
  ① 늦은 하루 판정 — 하루짜리 요청이고 그 날 창이 21:00 이후 시작일 때만
  ② 취향 → 넣을 곳: 야경·자연 → 야경, 액티비티 → 야경 + 나이트라이프, 그 밖 → 없음
  ③ 에이전트 끝까지: 놓인 곳이 위 집합 안이고, 맞는 취향이 없으면 비며, 표식을 끄면(재계획) 종전대로 놓인다
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime

import pytest

from trippilot.agents.schedule.agent import _is_late_day, late_night_candidates
from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.itinerary import TimeWindow
from trippilot.domain.llm import CandidatePool
from trippilot.domain.poi import NIGHTLIFE_TAG, DataQuality, Poi, PoiCategory, PoiSource

from tests.agents.schedule.test_schedule_agent import _agent, _persona, _task
from tests.orchestrator.schedule.test_schedule_coordinator import _ANCHOR, _DAY1, _KST, _NOW, _request


def _p(pid: str, category: PoiCategory, k: int, tags: tuple[str, ...] = ()) -> Poi:
    return Poi(PoiId(pid), pid, category, GeoPoint(_ANCHOR.lat + 0.002 * k, _ANCHOR.lng), (),
               None, None, DataQuality.FULL, PoiSource.SEED, None, tags=tags)


_POIS = (
    _p("night", PoiCategory.NIGHT_VIEW, 1),
    _p("club", PoiCategory.ACTIVITY, 2, tags=(NIGHTLIFE_TAG,)),
    _p("theme", PoiCategory.ACTIVITY, 3),
    _p("museum", PoiCategory.CULTURE, 4),
    _p("diner", PoiCategory.FOOD, 5),
    _p("cafe", PoiCategory.CAFE, 6),
    # 자연 취향 가산을 받는 공원 — 필터가 없으면 밤 9시에도 이것이 야경을 이긴다(아래 ③ 이 그 차이를 본다)
    _p("park", PoiCategory.NATURE, 7),
)
_POOL = CandidatePool(poi_ids=frozenset(p.poi_id for p in _POIS), pois=_POIS, generated_at=_NOW)


def _late_request(*, start_hour: int = 21, on: bool = True):
    window = TimeWindow(start=datetime(2026, 8, 5, start_hour, 0, tzinfo=_KST),
                        end=datetime(2026, 8, 5, 23, 59, tzinfo=_KST))   # BE 밤 끝(TodayWindow)
    return replace(_request(), day_window=window, late_night_by_taste=on)


# ① ─────────────────────────────────────────────────────────────────────────

def test_late_day_is_a_single_day_starting_at_or_after_21() -> None:
    assert _is_late_day(_late_request(start_hour=21))
    assert not _is_late_day(_late_request(start_hour=20))
    assert not _is_late_day(replace(_late_request(), days=(_DAY1, _DAY1.replace(day=6))))


# ② ─────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize(("wanted", "expected"), [
    ({PoiCategory.NIGHT_VIEW}, {"night"}),
    ({PoiCategory.NATURE}, {"night"}),
    ({PoiCategory.ACTIVITY}, {"night", "club"}),
    ({PoiCategory.CULTURE, PoiCategory.FOOD}, set()),
    (set(), set()),
])
def test_taste_decides_what_goes_into_a_late_day(wanted, expected) -> None:
    assert {str(p) for p in late_night_candidates(_POIS, wanted)} == expected


# ③ ─────────────────────────────────────────────────────────────────────────

def _placed(outcome) -> set[str]:
    if outcome.solution is None:
        return set()
    return {str(s.poi_id) for d in outcome.solution.days for s in d.slots}


@pytest.mark.parametrize(("activities", "allowed"), [
    (("테마파크",), {"night", "club"}),   # 액티비티 취향 — 야경·밤에 노는 곳
    (("자연",), {"night"}),               # 자연 취향 — 야경
])
def test_late_day_only_places_what_the_taste_allows(activities, allowed) -> None:
    agent, _, _ = _agent()
    outcome = agent.run(_task(_POOL, request=_late_request(), persona=_persona(activities=activities)))

    placed = _placed(outcome)
    assert placed, "맞는 취향인데 한 곳도 안 놓였다"
    assert placed <= allowed, placed


def test_late_day_with_no_matching_taste_stays_empty() -> None:
    """역사문화만 좋아하면 밤 9시에 박물관을 넣지 않는다 — 추천을 안 하는 것도 답이다."""
    agent, _, _ = _agent()
    outcome = agent.run(_task(_POOL, request=_late_request(),
                              persona=_persona(activities=("역사문화",))))
    assert _placed(outcome) == set()


def test_without_the_flag_the_late_day_is_scheduled_as_before() -> None:
    """재계획(표식 끔)은 지시가 정한다 — 같은 입력에서 무엇이든 놓인다(위 '비움'이 표식 때문임을 보인다)."""
    agent, _, _ = _agent()
    outcome = agent.run(_task(_POOL, request=_late_request(on=False),
                              persona=_persona(activities=("역사문화",))))
    assert _placed(outcome)
