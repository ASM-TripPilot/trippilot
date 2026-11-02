"""여행 당일 편집 — 지금 전에 시작한 슬롯은 그 시각 그대로(닻), 그 뒤만 다시 흘린다 (agents/edit/agent.py `_apply` · commands.retime_day).

교체(앱 교체 버튼 REPLACE)·빼기(REMOVE)·끝 추가(ADD)가 하루를 첫 슬롯부터 다시 흘려, 이미 다녀온 곳의 시각까지 바꿔 저장했다(develop 부터).
검증기는 가짜(위반 없음 + 무엇을 쟀는지 적는다 — `checks` 면 실제 HC1~4)이고 재타이밍·추정기는 진짜다. 경계 관통(BE 의 UTC requested_at)은
`tests/api/test_api_edit_insert_between.py` 가 본다.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, time, timedelta, timezone

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.agents.edit.agent import EditAgent, EditTask
from trippilot.agents.edit.commands import EditStatus
from trippilot.api.wiring import _problem_for
from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.constraints import check_all, check_hc2
from trippilot.assembly_engine.travel import TravelEstimator
from trippilot.domain.common import GeoPoint, PoiId, ScheduleId, TraceId, TransportMode
from trippilot.domain.edit import EditCommand, EditOp
from trippilot.domain.itinerary import DaySolution, FixedBlock, ItinerarySolution, SolveMode, TimeWindow, VisitSlot
from trippilot.domain.llm import CandidatePool
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource

KST = timezone(timedelta(hours=9))
D, NEXT = date(2026, 10, 21), date(2026, 10, 22)
_BEFORE_TRIP = datetime(2026, 10, 20, 20, 0, tzinfo=KST)
_EST = TravelEstimator(AssemblyConfig())


def _poi(pid: str, lat: float, lng: float) -> Poi:
    return Poi(PoiId(pid), pid, PoiCategory.SIGHT, GeoPoint(lat, lng), (), None, None, DataQuality.FULL,
               PoiSource.SEED, None)


# 그 날 슬롯 s0~s5(1일차)·t0~t5(2일차)와 넣을 후보 n0·n1 — 이웃끼리 대중교통 추정 22분 안팎이라, 저장 간격이 그보다 짧으면
# 다시 흘릴 때 지난 곳이 밀린다
_PLACES = {p.poi_id: p for p in (
    *(_poi(f"{k}{i}", 37.55 + 0.009 * i, 126.97 + 0.006 * (i % 2)) for k in "st" for i in range(6)),
    _poi("n0", 37.56, 126.99), _poi("n1", 37.575, 126.985))}


def _day(on: date, stays: list[int], gaps: list[int], *, k: str = "s", fixed: frozenset[int] = frozenset()) -> DaySolution:
    t, slots = datetime.combine(on, time(9, 0), tzinfo=KST), []
    for i, (stay, gap) in enumerate(zip(stays, gaps)):
        slots.append(VisitSlot(PoiId(f"{k}{i}"), t, t + timedelta(minutes=stay), stay, 0.5, True))
        t += timedelta(minutes=stay + gap)
    blocks = tuple(FixedBlock(s.poi_id, TimeWindow(s.start_at, s.end_at), "wire_fixed")
                   for i, s in enumerate(slots) if i in fixed)
    return DaySolution(on, tuple(slots), blocks)


def _solution(*days: DaySolution) -> ItinerarySolution:
    return ItinerarySolution(ScheduleId("s-today"), days, False, SolveMode.OR_TOOLS, None)


class _Facade:
    """위반 없음 — 무엇을 쟀는지만 적는다(⑤ 가 지금 있는 곳 → 다음 일정을 재는지 본다). `checks` 면 실제 HC1~4 로 잰다."""

    def __init__(self, checks: bool = False) -> None:
        self.seen: list[tuple[ItinerarySolution, object]] = []
        self.checks = checks

    def validate(self, solution, problem, deadline_ms, trace_id=None):
        self.seen.append((solution, problem))
        return tuple(check_all(solution, problem, _PLACES, _EST)) if self.checks else ()


class _Provider:
    def __init__(self, checks: bool = False) -> None:
        self.facade = _Facade(checks)

    def for_pool(self, poi_index):
        return self.facade


class _NoTranslator:
    def translate(self, *a, **k):
        raise AssertionError("구조화 진입은 번역기를 부르지 않는다")


def _run(solution: ItinerarySolution, command: EditCommand, now: datetime, *, target: date = D, checks: bool = False):
    provider = _Provider(checks)
    agent = EditAgent(_NoTranslator(), provider, _EST, lambda s: _problem_for(s, KST), tz=KST)
    pool = CandidatePool(poi_ids=frozenset({PoiId("n0"), PoiId("n1")}), pois=(_PLACES["n0"], _PLACES["n1"]),
                         generated_at=now)
    out = agent.run(EditTask(solution=solution, target_date=target, pool=pool, poi_index=_PLACES,
                             transport=TransportMode.PUBLIC, trace_id=TraceId("t-today"), now=now, deadline_ms=20_000,
                             command=command, confirm=True))
    return out, provider.facade


def _remove(i: int, k: str = "s") -> EditCommand:
    return EditCommand(EditOp.REMOVE_SLOT, {}, (PoiId(f"{k}{i}"),))


def _replace(i: int, k: str = "s") -> EditCommand:
    return EditCommand(EditOp.REPLACE_SLOT, {"targetPoiId": "n0"}, (PoiId(f"{k}{i}"),))


_ADD_END = EditCommand(EditOp.ADD_SLOT, {"targetPoiId": "n1"}, ())


def _at(h: int, m: int, s: int = 0) -> datetime:
    return datetime(2026, 10, 21, h, m, s, tzinfo=KST)


def _travel(a: str, b: str) -> timedelta:
    return timedelta(minutes=_EST.estimate(_PLACES[a].coord, _PLACES[b].coord, TransportMode.PUBLIC).internal_minutes)


# ── 속성: 지난 곳은 그대로, 나머지는 지금 이후 ────────────────────────────


@given(st.lists(st.tuples(st.integers(30, 150), st.integers(0, 90)), min_size=2, max_size=6), st.data())
@settings(max_examples=200, deadline=None)
def test_trip_day_edit_never_moves_what_already_started(plan: list, data) -> None:
    """당일 교체·빼기·끝 추가(와 사이 넣기)는 지금 전에 시작한 슬롯(진행 중·끝남)의 시각을 바꾸지 않고, 다시 흘린 곳·새 곳은
    지금 이후(현지 벽시계)에 둔다. 저장 간격이 추정(22분)보다 짧은 날도 만든다 — 다시 흘리면 지난 곳이 밀리던 날이다."""
    day = _day(D, [s for s, _ in plan], [g for _, g in plan])
    local = _at(8, 0) + timedelta(seconds=data.draw(st.integers(0, 14 * 3600)))  # 그 날 08:00~22:00, 초까지(분 올림을 탄다)
    now = local.astimezone(timezone.utc) if data.draw(st.booleans()) else local  # BE 는 UTC(…Z)로 보낸다
    i = data.draw(st.integers(0, len(plan) - 1))
    between = EditCommand(EditOp.ADD_SLOT, {"targetPoiId": "n1", "afterPoiId": f"s{i}"}, ())
    command = data.draw(st.sampled_from((_remove(i), _replace(i), _ADD_END, between)))
    out, facade = _run(_solution(day), command, now)

    started = [s for s in day.slots if s.start_at < local]
    if command.op is EditOp.REPLACE_SLOT and day.slots[i] in started and day.slots[i] != started[-1]:
        # 새 곳은 지금 이후에만 둔다 — 그 뒤에 이미 시작한 곳이 있으면 그 순서는 시간을 거스른다(사유 있는 거부, 예외 아님)
        assert out.status is EditStatus.REJECTED and "이미 시작한" in (out.reason or "")
        return
    if command is between and i + 1 < len(plan) and day.slots[i + 1].start_at <= local:
        assert out.status is EditStatus.REJECTED and "past_gap" in (out.reason or "")  # 사이 넣기의 종전 규칙 그대로
        return
    assert out.status is EditStatus.APPLIED, out.reason
    [edited] = out.solution.days
    kept = {s.poi_id: (s.start_at, s.end_at) for s in started}
    assert {p for p in kept if p not in command.affected_slots} <= {s.poi_id for s in edited.slots}
    for s in edited.slots:
        assert s.start_at.utcoffset() == timedelta(hours=9)  # 현지 벽시계 — UTC 하한을 그대로 쓰면 13:10 이 04:10 으로 나갔다
        if s.poi_id in kept:
            assert (s.start_at, s.end_at) == kept[s.poi_id]  # 지난 일정은 그 시각 그대로
        else:
            assert s.start_at >= now  # 다시 흘린 곳·새로 넣은 곳은 지금 이후
    assert all(a.end_at <= b.start_at for a, b in zip(edited.slots, edited.slots[1:]))
    # 지금 있는 곳(가장 최근에 시작한 곳)을 빼거나 바꿔도 사용자는 거기 있었다 — 다음 곳은 거기서 지금(끝났으면 끝난 시각) 떠나 닿는 시각 이후다
    here = started[-1] if started else None
    gone = here is not None and here.poi_id in command.affected_slots  # 빼기·교체 — 추가는 대상 슬롯이 없다
    after = [s for s in edited.slots if s.poi_id not in kept]
    if gone and after:
        assert after[0].start_at >= min(here.end_at, local) + _travel(here.poi_id, after[0].poi_id)
    # ⑤ 는 지금 있는 곳(가장 최근에 시작한 곳)부터 잰다 — '거기 → 다음 일정' 이동은 재고, 그보다 앞선 곳은 이 편집이 만든 시각이 아니다.
    # 그 곳을 뺐거나 바꿨으면 지금(분 올림)까지만, 끝났으면 끝까지 머문 곳으로 앞에 세워 잰다 — 재타이밍과 같은 모델이라 HC2 는 늘 통과한다
    order = [s.poi_id for s in edited.slots]
    anchored = [p for p in order if p in kept]
    checked, problem = facade.seen[-1]
    view = checked.days[0].slots
    if gone and after:
        floor = local.replace(second=0) + timedelta(minutes=1 if local.second else 0)
        assert [s.poi_id for s in view] == [here.poi_id, *order[len(anchored):]]
        assert (view[0].start_at, view[0].end_at) == (here.start_at, min(here.end_at, floor))
    else:
        assert [s.poi_id for s in view] == order[max(len(anchored) - 1, 0):]
    assert check_hc2(checked, _PLACES, _EST, problem) == []


# ── 기존과 같은 경우 ─────────────────────────────────────────────────────


@pytest.mark.parametrize("command", [_remove(1), _replace(1), _ADD_END], ids=["remove", "replace", "add"])
def test_before_the_first_slot_it_is_the_same_as_before_the_trip(command: EditCommand) -> None:
    """여행 당일이라도 첫 일정 전이면 지난 곳이 없다 — 여행 전에 고친 것과 같은 결과다(종전 동작)."""
    solution = _solution(_day(D, [60, 90, 60], [10, 30, 0]))  # 10분 간격 — 추정(22분)보다 짧아 다시 흘리면 시각이 바뀐다
    early, _ = _run(solution, command, _at(8, 30, 15))
    before, _ = _run(solution, command, _BEFORE_TRIP)
    assert early.status is before.status is EditStatus.APPLIED
    assert early.solution == before.solution


@pytest.mark.parametrize("command", [_remove(1, "t"), _replace(1, "t"), _ADD_END], ids=["remove", "replace", "add"])
def test_editing_another_day_ignores_the_clock(command: EditCommand) -> None:
    """오늘이 1일차여도 2일차를 고치면 지금은 상관없다 — 종전대로 그 날을 다시 흘리고, 오늘 일정은 손대지 않는다."""
    solution = _solution(_day(D, [60, 60, 60], [10, 10, 10]), _day(NEXT, [60, 90, 60], [10, 30, 0], k="t"))
    today, _ = _run(solution, command, _at(13, 10), target=NEXT)
    before, _ = _run(solution, command, _BEFORE_TRIP, target=NEXT)
    assert today.status is before.status is EditStatus.APPLIED
    assert today.solution == before.solution
    assert today.solution.days[0] == solution.days[0]


# ── 지난 슬롯 자체를 고치는 요청 — 지금 동작 고정 ──────────────────────────


def test_removing_a_visited_slot_is_still_applied() -> None:
    """지난 슬롯 빼기는 막지 않는다(새 거절 규칙 없음). 남은 지난 곳은 그 시각 그대로, 뒤는 지금부터 다시 흘린다."""
    day = _day(D, [60, 60, 60, 60], [30, 30, 30, 30])  # 09:00 · 10:30 · 12:00~13:00 · 13:30
    out, _ = _run(_solution(day), _remove(0), _at(12, 40))
    assert out.status is EditStatus.APPLIED, out.reason
    s1, s2, s3 = out.solution.days[0].slots
    assert (s1, s2) == day.slots[1:3]
    assert s3.poi_id == "s3" and s3.start_at >= _at(12, 40)


def test_replacing_the_place_you_are_at_starts_the_new_one_once_you_get_there() -> None:
    """지금 있는 곳(진행 중)을 바꾸면 거기서 지금(분 올림) 떠나 새 곳에 닿는 시각부터다 — 앞서 다녀온 곳은 그대로다.
    그 앞 닻(다녀온 곳)에서 커서를 흘리면 지금 있는 곳 → 새 곳 이동(27분)이 0분이 돼 지금 바로(12:41) 시작한다(2026-10-30 리뷰 재현)."""
    day = _day(D, [60, 60, 90, 60], [30, 30, 30, 30])  # 09:00 · 10:30 · 12:00~13:30(진행 중) · 14:00
    out, facade = _run(_solution(day), _replace(2), _at(12, 40, 20), checks=True)
    assert out.status is EditStatus.APPLIED, out.reason
    s0, s1, new, s3 = out.solution.days[0].slots
    assert (s0, s1) == day.slots[:2]
    assert (new.poi_id, new.start_at) == ("n0", _at(12, 41) + _travel("s2", "n0")) and s3.start_at >= new.end_at
    checked, _ = facade.seen[-1]  # ⑤ 는 지금 있는 곳(지금까지 머문 것으로) → 새 곳 이동을 잰다
    assert [(s.poi_id, s.end_at) for s in checked.days[0].slots[:2]] == [("s2", _at(12, 41)), ("n0", new.end_at)]


@pytest.mark.parametrize(("now", "left_at"), [(_at(12, 40, 20), _at(12, 41)), (_at(13, 5), _at(13, 0))],
                         ids=["in_progress", "just_ended"])
def test_removing_the_place_you_are_at_flows_the_next_from_there(now: datetime, left_at: datetime) -> None:
    """지금 있는 곳을 빼도 사용자는 거기 있었다 — 다음 곳은 거기서 떠나 닿는 시각부터다. 진행 중이면 지금(분 올림), 이미 끝났으면 끝난 시각에
    떠난다(그 곳을 남겨 둔 편집과 같은 모델). 그 앞 닻에서 재면 지금 바로 시작한다(진행 중 12:41, 끝남 13:05)."""
    day = _day(D, [60, 60, 60, 60], [30, 30, 30, 30])  # 09:00 · 10:30 · 12:00~13:00 · 13:30
    out, facade = _run(_solution(day), _remove(2), now, checks=True)
    assert out.status is EditStatus.APPLIED, out.reason
    s0, s1, s3 = out.solution.days[0].slots
    assert (s0, s1) == day.slots[:2]
    assert s3.start_at == left_at + _travel("s2", "s3")
    assert [(s.poi_id, s.end_at) for s in facade.seen[-1][0].days[0].slots] == [("s2", left_at), ("s3", s3.end_at)]


def test_leaving_the_place_you_are_at_cannot_make_a_reservation_you_cannot_reach() -> None:
    """지금 있는 곳을 빼고 바로 뒤 예약으로 가는 이동도 ⑤ 가 잰다 — 못 닿으면 HC2 로 거부한다(사유 있는 REJECTED).
    그 앞 닻(다녀온 곳) → 예약을 재면 통과한다."""
    day = _day(D, [60, 60, 45, 60], [30, 30, 5, 30], fixed=frozenset({3}))  # 12:00~12:45(진행 중) → 12:50 예약(이동 22분)
    out, _ = _run(_solution(day), _remove(2), _at(12, 40), checks=True)
    assert out.status is EditStatus.REJECTED
    assert [(v.code, v.slot_ref) for v in out.violations] == [("HC2", "s3")]


def test_replacing_an_older_visited_slot_is_refused_by_time_order_not_raised() -> None:
    """새 곳은 지금 이후에만 둔다 — 그 뒤에 이미 시작한 곳이 있으면 그 자리는 시간을 거스른다. 사유 있는 거부다(예외 아님, DL-5).
    종전엔 하루를 첫 슬롯부터 다시 흘려 반영했다(지난 일정 교체를 어떻게 다룰지는 결정 대기)."""
    day = _day(D, [60, 60, 90, 60], [30, 30, 30, 30])
    out, _ = _run(_solution(day), _replace(0), _at(12, 40))
    assert out.status is EditStatus.REJECTED and "이미 시작한" in (out.reason or "")


def test_moving_rides_the_same_anchor() -> None:
    """옮기기도 같은 닻 — 아직 안 간 곳끼리는 지금 이후로 다시 흘리고, 이미 시작한 곳을 옮기는 순서는 시간을 거스른다(사유 있는 거부)."""
    day = _day(D, [60, 60, 60, 60], [30, 30, 30, 30])  # 09:00 · 10:30 · 12:00 · 13:30
    later = EditCommand(EditOp.MOVE_SLOT, {"afterPoiId": "s3"}, (PoiId("s2"),))  # 아직 안 간 두 곳을 바꾼다
    out, _ = _run(_solution(day), later, _at(11, 50))
    assert out.status is EditStatus.APPLIED, out.reason
    s0, s1, s3, s2 = out.solution.days[0].slots
    assert (s0, s1) == day.slots[:2] and s3.start_at >= _at(11, 50) and s2.start_at >= s3.end_at
    visited = EditCommand(EditOp.MOVE_SLOT, {"afterPoiId": "s3"}, (PoiId("s0"),))  # 다녀온 곳을 저녁으로
    out, _ = _run(_solution(day), visited, _at(11, 50))
    assert out.status is EditStatus.REJECTED and "이미 시작한" in (out.reason or "")


# ── ⑤ 검증 범위 ─────────────────────────────────────────────────────────


def test_older_visits_and_their_reservation_leave_validation_but_where_you_are_stays() -> None:
    """⑤ 는 지금 있는 곳(가장 최근)부터 잰다. 그보다 앞선 곳은 예약 블록째 뺀다 — 블록을 남기면 HC3 가 없는 슬롯을 찾고, 지난 간격을
    지금 추정기로 다시 재면 다녀온 하루가 통째로 막힌다(①b `RebuiltDays.history` 와 같은 태도)."""
    day = _day(D, [60, 60, 90, 60], [5, 30, 30, 30], fixed=frozenset({0}))  # 09:00 예약 → 10:05(5분 — 추정 22분보다 짧다)
    out, facade = _run(_solution(day), _ADD_END, _at(12, 40))
    assert out.status is EditStatus.APPLIED, out.reason
    assert out.solution.days[0].slots[:3] == day.slots[:3]
    checked, problem = facade.seen[-1]
    assert [s.poi_id for s in checked.days[0].slots] == ["s2", "s3", "n1"]  # 지금 있는 곳 → 다음 일정은 잰다
    assert problem.fixed_blocks == ()
    assert check_all(checked, problem, _PLACES, _EST) == []
    whole = replace(_problem_for(out.solution, KST), days=(D,))
    assert {v.code for v in check_all(out.solution, whole, _PLACES, _EST)} == {"HC2"}  # 다 재면 지난 5분 간격이 막는다
