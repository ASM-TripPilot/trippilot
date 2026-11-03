"""편집 에이전트의 여행 컨텍스트 — 취향 순위·요청별 도보 상한·빈 날 시작·'N일차' 기준 (agents/edit · 순수 단계).

경계 관통(와이어 칸 → 에이전트 → 응답)은 `tests/api/test_api_edit_trip_context.py` 가 본다. 여기서는 단계마다 하나씩:
  ① 사이 넣기 순위는 취향을 '재배열'만 한다 — 후보 집합은 같고, 취향이 없으면 종전 순서 그대로(속성)
  ② ④ 재타이밍·⑤ 검증이 같은 요청별 상한의 추정기를 쓴다 · ①b ⑤ 는 풀이가 쓴 추정기(상한·주차 계획)로 잰다
  ③ 빈 날의 첫 곳은 그 날 창의 시작 · 'N일차'는 여행 첫날부터
"""

from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, time, timedelta, timezone

from hypothesis import given, settings
from hypothesis import strategies as st

from tests.agents.edit import test_edit_day_area_agent as area
from trippilot.agents.edit.agent import EditAgent, EditTask
from trippilot.agents.edit.commands import EditStatus, RetimeContext, retime_day
from trippilot.agents.edit.day_area import DayClause, day_of, resolve_day_areas
from trippilot.agents.edit.insert_between import rank_on_segment
from trippilot.api.wiring import _problem_for
from trippilot.assembly_engine.config import ACTIVE_WALK_MAX_KM, AssemblyConfig
from trippilot.assembly_engine.travel import TravelEstimator
from trippilot.domain.common import GeoPoint, PoiId, ScheduleId, TraceId, TransportMode
from trippilot.domain.edit import EditCommand, EditOp
from trippilot.domain.itinerary.itinerary import DaySolution, ItinerarySolution, SolveMode, VisitSlot
from trippilot.domain.llm.llm import CandidatePool
from trippilot.domain.poi.poi import TRENDING_TAG, DataQuality, Poi, PoiCategory, PoiSource

KST = timezone(timedelta(hours=9))
D = date(2026, 10, 21)
_CFG = AssemblyConfig()
A_, B_ = GeoPoint(37.5385, 126.9888), GeoPoint(37.5600, 126.9230)  # 경리단길 → 연남동(구간 약 6km)


def _poi(n: int, cat: PoiCategory, lat: float, lng: float, *, tags=()) -> Poi:
    return Poi(PoiId(f"p{n}"), f"장소{n}", cat, GeoPoint(lat, lng), (), None, None, DataQuality.FULL, PoiSource.SEED, None,
               tags=tuple(tags))


_ARGS = dict(slack_km=2.0, exclude=frozenset(), taken_names=(), kind=None, not_kinds=frozenset(), night=False, day=D,
             holidays=None)


# ── ① 사이 넣기 순위 ─────────────────────────────────────────────────────


def test_taste_puts_its_category_ahead_of_trending_in_the_same_spot() -> None:
    mid = (37.5440, 126.9510)
    trending = _poi(1, PoiCategory.SIGHT, *mid, tags=(TRENDING_TAG,))
    nature = _poi(2, PoiCategory.NATURE, mid[0] + 0.0002, mid[1])
    assert [p.poi_id for p, _ in rank_on_segment((trending, nature), A_, B_, **_ARGS)] == ["p1", "p2"]  # 종전: 인기 먼저
    assert [p.poi_id for p, _ in rank_on_segment((trending, nature), A_, B_, **_ARGS,
                                                 taste=frozenset({PoiCategory.NATURE}))] == ["p2", "p1"]


_pt = st.builds(GeoPoint, st.floats(37.53, 37.57), st.floats(126.92, 127.00))
_cats = st.sampled_from([c for c in PoiCategory if c not in (PoiCategory.STAY, PoiCategory.BAR)])


@given(st.lists(st.tuples(_pt, _cats, st.booleans()), max_size=20), st.sets(_cats, max_size=3))
@settings(max_examples=120, deadline=None)
def test_taste_only_reorders(points, taste) -> None:
    """취향은 후보를 더하거나 빼지 않는다(INV-1 은 풀·거르기 몫) — 같은 집합의 재배열이고, 빈 취향은 종전 순서 그대로다."""
    pois = [_poi(i, cat, c.lat, c.lng, tags=(TRENDING_TAG,) if hot else ()) for i, (c, cat, hot) in enumerate(points)]
    base = rank_on_segment(pois, A_, B_, **_ARGS)
    liked = rank_on_segment(pois, A_, B_, **_ARGS, taste=frozenset(taste))
    assert sorted(p.poi_id for p, _ in liked) == sorted(p.poi_id for p, _ in base)
    assert rank_on_segment(pois, A_, B_, **_ARGS, taste=frozenset()) == base


# ── ② 요청별 도보 상한 — ④ 와 ⑤ 가 같은 추정기 ─────────────────────────────


def _north(km_road: float) -> GeoPoint:
    return GeoPoint(37.55 + km_road / _CFG.detour_factor / 111.195, 126.98)


_PLACES = {PoiId(k): Poi(PoiId(k), k, PoiCategory.SIGHT, _north(km), (), None, None, DataQuality.FULL, PoiSource.SEED, None)
           for k, km in (("a", 0.0), ("x", 3.0), ("b", 0.75))}


class _Facade:
    def validate(self, solution, problem, deadline_ms, trace_id=None):
        return ()


class _Provider:
    """`walker` 는 진짜 상한 추정기 — 무엇을 몇으로 불렀는지 적는다."""

    def __init__(self) -> None:
        self.facade_caps: list = []
        self.walker_caps: list = []

    def for_pool(self, poi_index, walk_max_km=None, parking=None):
        self.facade_caps.append(walk_max_km)
        return _Facade()

    def walker(self, walk_max_km, parking=None):
        self.walker_caps.append(walk_max_km)
        return TravelEstimator(replace(_CFG, public_walk_max_km=walk_max_km))


def _slot(pid: str, h: int) -> VisitSlot:
    start = datetime.combine(D, time(h, 0), tzinfo=KST)
    return VisitSlot(PoiId(pid), start, start + timedelta(hours=1), 60, 0.0, False)


def _remove_x(walk_max_km: float | None, provider: _Provider) -> VisitSlot:
    solution = ItinerarySolution(ScheduleId("s"), (DaySolution(D, (_slot("a", 10), _slot("x", 12), _slot("b", 14)), ()),),
                                 False, SolveMode.OR_TOOLS, None)
    agent = EditAgent(None, provider, TravelEstimator(_CFG), lambda s: _problem_for(s, KST), tz=KST)
    out = agent.run(EditTask(solution=solution, target_date=D, pool=CandidatePool(poi_ids=frozenset(), pois=(),
                                                                                    generated_at=datetime(2026, 10, 20, tzinfo=KST)),
                             poi_index=_PLACES, transport=TransportMode.PUBLIC, trace_id=TraceId("t"),
                             now=datetime(2026, 10, 20, 20, 0, tzinfo=KST), deadline_ms=7_000,
                             command=EditCommand(EditOp.REMOVE_SLOT, {}, (PoiId("x"),)), confirm=True,
                             walk_max_km=walk_max_km))
    assert out.status is EditStatus.APPLIED, out.reason
    return out.solution.days[0].slots[1]


def test_retime_and_validation_share_the_requested_walk_cap() -> None:
    plain, active = _Provider(), _Provider()
    assert _remove_x(None, plain).start_at.time() == time(11, 18)  # 공용 700m — 0.75km 는 대중교통 18분
    assert (plain.walker_caps, plain.facade_caps) == ([], [None])  # 종전 그대로(공용 추정기·공용 퍼사드)
    assert _remove_x(ACTIVE_WALK_MAX_KM, active).start_at.time() == time(11, 16)  # 걷기 16분 — 생성과 같다
    assert (active.walker_caps, active.facade_caps) == ([ACTIVE_WALK_MAX_KM], [ACTIVE_WALK_MAX_KM])


def test_day_rebuild_is_validated_with_the_solvers_own_estimator() -> None:
    """①b — 콘센트가 풀이의 추정기(상한·주차 계획)를 함께 돌려주면 ⑤ 가 그것으로 잰다. 없으면 종전(공용)."""
    plan = object()
    provider = area._Provider()
    rebuilt = replace(area._rebuilt(), walk_max_km=ACTIVE_WALK_MAX_KM, parking=plan)
    assert area._agent(provider).run(area._task(area._Rebuild(rebuilt))).status is EditStatus.APPLIED
    assert provider.estimators == [(ACTIVE_WALK_MAX_KM, plan)]
    legacy = area._Provider()
    area._agent(legacy).run(area._task(area._Rebuild(area._rebuilt())))
    assert legacy.estimators == [(None, None)]


# ── ③ 빈 날 시작 · 'N일차' ──────────────────────────────────────────────


def test_first_place_on_an_empty_day_starts_at_the_window() -> None:
    est = TravelEstimator(_CFG)
    empty = DaySolution(D, (), ())
    ctx = RetimeContext(coords={PoiId("a"): _north(0.0)}, stay_min={}, estimator=est, transport=TransportMode.PUBLIC)
    assert retime_day(empty, (PoiId("a"),), ctx, KST).slots[0].start_at.time() == time(10, 0)  # 창이 없으면 종전
    opened = replace(ctx, day_start=datetime.combine(D, time(15, 0), tzinfo=KST))
    assert retime_day(empty, (PoiId("a"),), opened, KST).slots[0].start_at.time() == time(15, 0)
    busy = DaySolution(D, (_slot("a", 9),), ())
    assert retime_day(busy, (PoiId("a"),), opened, KST).slots[0].start_at.time() == time(9, 0)  # 슬롯이 있는 날은 첫 슬롯 그대로


def test_nth_day_counts_from_the_trip_start_but_only_edits_planned_days() -> None:
    days = [date(2026, 10, 24), date(2026, 10, 25), date(2026, 10, 26)]  # 여행은 10-23 부터
    today = date(2026, 10, 22)
    assert day_of("2일차", days, today) == date(2026, 10, 25)  # 종전 — 받은 일정의 첫 날부터
    assert day_of("2일차", days, today, first=date(2026, 10, 23)) == date(2026, 10, 24)  # 대화와 같은 셈
    assert day_of("1일차", days, today, first=date(2026, 10, 23)) == "day_out_of_trip"  # 일정 없는 날은 고르지 않는다
    assert day_of("마지막 날", days, today, first=date(2026, 10, 23)) == date(2026, 10, 26)  # 순번만 바뀐다
    got = resolve_day_areas((DayClause(("2일차",), "강남구"),), days, today, first=date(2026, 10, 23))
    assert [(x.day, x.area) for x in got] == [(date(2026, 10, 24), "강남구")]
