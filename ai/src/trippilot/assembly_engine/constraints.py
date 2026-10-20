"""ConstraintChecker — HC1~HC4 순수 함수 (정본 §4.2, U2 FD §2.2).

I/O 없음 — (solution, problem, poi_index, estimator)만으로 판정. oracle 전수 대조 가능(U5-P1).
빈 리스트 = 유효. 예산은 검사하지 않음(소프트, INV-SOLVE3).

영업시간 판정 규칙 — 그 날 창은 `poi.open_windows_on` 하나로만 읽는다(조립 전 경로와 같은 함수):
- poi.open_hours 비어 있음 = 영업정보 없음 → HC1 미적용 (알 수 없는 것은 막지 않는다)
- 항목이 있는데 해당 요일이 없음 = 휴무 → HC1 위반
- 휴일 규칙이 그 날을 닫음(상황 감지 H1, `problem.holidays` 가 있을 때만) → HC1 위반 — 영업정보가 없어도
- close_min > 1440(자정 초과)은 시작일 귀속 규칙으로 그대로 비교
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Mapping

from trippilot.domain.common import PoiId
from trippilot.domain.itinerary import (
    CLOSED_DAY,
    HOLIDAY,
    OUT_OF_HOURS,
    ItineraryProblem,
    ItinerarySolution,
    Violation,
)
from trippilot.domain.poi import HolidayCalendar, Poi, closed_by_holiday, open_windows_on


def _min_of_day(dt) -> int:
    return dt.hour * 60 + dt.minute


def open_hours_ok(poi: Poi, start_at: datetime, end_at: datetime,
                  holidays: HolidayCalendar | None = None) -> bool:
    """HC1 판정 1건 — 정보 없음은 통과, 있으면 그 날 영업창 **하나에 완전 포함**이어야 한다.

    `check_hc1` 의 규칙 그 자체다. 조립 밖에서 "이 핀이 영업시간에 걸리나"를 미리 물을 때도
    (ScheduleAgent — 걸리면 409 대신 빼고 보고, TRIP-1249) 이 함수를 쓴다 — 규칙이 둘이 되면
    에이전트가 둔 핀을 검증기가 거부하는 모순이 생긴다. 그 날 창은 `open_windows_on`(휴일 규칙 포함,
    `holidays` None = 모드 off)이다.
    """
    windows = open_windows_on(poi, start_at.date(), holidays)
    if windows is None:
        return True  # 정보 없음 → 미적용
    start_m = _min_of_day(start_at)
    end_m = start_m + int((end_at - start_at).total_seconds() // 60)
    if any(oh.open_min <= start_m and end_m <= oh.close_min for oh in windows):
        return True
    # 자정 넘어 시작한 방문(00:30)은 전날 창이 자정을 넘어 이어지는지도 본다 — 야경 16:00~익일 02:00 은
    # 전날 요일의 창(close 26:00)이다. 밤 늦게 만든 오늘이 01:00 까지 열린다(2026-10-19 사용자).
    before = open_windows_on(poi, start_at.date() - timedelta(days=1), holidays)
    return bool(before) and any(
        oh.open_min <= start_m + 1440 and end_m + 1440 <= oh.close_min for oh in before)


def check_hc1(solution: ItinerarySolution, poi_index: Mapping[PoiId, Poi],
              holidays: HolidayCalendar | None = None) -> list[Violation]:
    """영업시간: start ≥ open ∧ end ≤ close. 하위 코드(상황 감지 H1 · BR-SA-17)는 정기 휴무 CLOSED_DAY
    (공휴일과 겹쳐도 이것이 먼저 — 그 요일은 원래 닫는다), 휴일 규칙 휴무 HOLIDAY, 그 날 열지만 창 밖 OUT_OF_HOURS.
    detail 문자열은 종전 그대로다(휴일은 "공휴일 휴무")."""
    out: list[Violation] = []
    for day in solution.days:
        for slot in day.slots:
            poi = poi_index.get(slot.poi_id)
            if poi is None or open_hours_ok(poi, slot.start_at, slot.end_at, holidays):
                continue
            dow = slot.start_at.weekday()
            if poi.open_hours and not any(oh.day_of_week == dow for oh in poi.open_hours):
                out.append(Violation("HC1", slot.poi_id, f"{dow}요일 휴무", CLOSED_DAY))
                continue
            if closed_by_holiday(poi, slot.start_at.date(), holidays):
                out.append(Violation("HC1", slot.poi_id, "공휴일 휴무", HOLIDAY))
                continue
            start_m = _min_of_day(slot.start_at)
            end_m = start_m + int((slot.end_at - slot.start_at).total_seconds() // 60)
            out.append(Violation("HC1", slot.poi_id, f"영업시간 밖: {start_m}~{end_m}", OUT_OF_HOURS))
    return out


def check_hc2(solution: ItinerarySolution, poi_index: Mapping[PoiId, Poi],
              estimator, problem: ItineraryProblem) -> list[Violation]:
    """이동 가능: prev.end + travel ≤ next.start (버퍼는 estimator에 포함)."""
    out: list[Violation] = []
    for day in solution.days:
        for prev, nxt in zip(day.slots, day.slots[1:]):
            p1, p2 = poi_index.get(prev.poi_id), poi_index.get(nxt.poi_id)
            if p1 is None or p2 is None:
                continue
            travel = estimator.estimate(p1.coord, p2.coord, problem.transport)
            gap = int((nxt.start_at - prev.end_at).total_seconds() // 60)
            if gap < travel.internal_minutes:
                out.append(Violation("HC2", nxt.poi_id,
                                     f"이동 {travel.internal_minutes}분 필요, 간격 {gap}분"))
    return out


def check_hc2_coords_known(solution: ItinerarySolution,
                           poi_index: Mapping[PoiId, Poi]) -> list[Violation]:
    """체인 내부 전용 (TRIP-1177) — 인접 쌍 한쪽이 인덱스에 없으면 이동 검증 불가 = 위반.

    `check_hc2` 의 "정보 없음은 막지 않는다"는 이미 저장된 일정을 다시 보는 경로
    (validate·repair·edit)의 규칙이라 그대로 둔다. solve 는 시각을 **만드는** 경로라,
    모르는 이동을 0분으로 놓은 해가 위반 0 으로 화면에 나갔다(INV-2).
    """
    out: list[Violation] = []
    for day in solution.days:
        for prev, nxt in zip(day.slots, day.slots[1:]):
            if prev.poi_id not in poi_index or nxt.poi_id not in poi_index:
                out.append(Violation("HC2", nxt.poi_id, "좌표 미상 — 이동 검증 불가"))
    return out


def free_visit_cap(problem: ItineraryProblem, day) -> int | None:
    """그 일자 **자유 방문** 상한 — `max_visits_per_day` − 고정 블록 − 필수 방문 (BR-U4-47).

    상한은 고정·필수를 세되 빼지 않는다 — 그래서 자유 방문 몫만 깎는다(바닥 0). 필수는 놓였는지와
    무관하게 센다(두 어셈블러가 같은 값을 쓰도록 문제 필드만 본다). 상한이 없으면 None.
    """
    cap = problem.max_visits_per_day
    if cap is None:
        return None
    pinned = {(fb.poi_id, fb.window.start) for fb in problem.fixed_blocks
              if fb.window.start.date() == day}
    required = ({rv.poi_id for rv in problem.required_visits if rv.day == day}
                - {pid for pid, _ in pinned})
    return max(0, cap - len(pinned) - len(required))


def not_before_floor(problem: ItineraryProblem) -> datetime | None:
    """비고정 방문 시작 하한을 분 단위로 **올린다** (TRIP-1182). 자르는 게 없으면 None.

    슬롯은 분 해상도다 — 14:10:05 를 내리면 14:10 시작 슬롯이 하한 이전이 된다. 하한이
    그 일자 창 시작 이하면 None 이다 — 아무것도 자르지 않고, 앵커 이동도 창 시작 출발이
    이미 센다(generate 와 같은 모델 그대로). 두 어셈블러·체인 검증이 같은 값을 쓴다.
    """
    nb = problem.not_before
    if nb is None:
        return None
    floor = nb.replace(second=0, microsecond=0)
    if floor != nb:
        floor += timedelta(minutes=1)
    tz = problem.day_window.start.tzinfo
    local = floor.astimezone(tz) if tz is not None else floor
    ws = problem.window_on(local.date()).start  # 일자별 창 (TRIP-1389)
    return floor if local.time() > ws.time() else None


def anchor_minutes(problem: ItineraryProblem, poi: Poi, estimator) -> int:
    """하한 시각의 출발점(앵커 = 사용자의 지금 위치)에서 그 장소까지 이동(분). 앵커 없으면 0.

    재계획 앵커는 BE 가 GPS → 마지막 완료 방문 → 숙소 순으로 고른 현재 위치다. 하한에
    이걸 더하지 않으면 먼 곳에 있는 사람이 하한 시각에 바로 도착한 해가 나간다(INV-2).
    지난 잠금 뒤 방문도 그 잠금 장소가 아니라 여기서 센다 — 사용자는 이미 떠났다.
    """
    if problem.anchor is None:
        return 0
    return estimator.estimate(problem.anchor, poi.coord, problem.transport).internal_minutes


def check_not_before(solution: ItinerarySolution, problem: ItineraryProblem,
                     poi_index: Mapping[PoiId, Poi], estimator) -> list[Violation]:
    """체인 내부 전용 (TRIP-1182) — 고정 블록이 아닌 슬롯이 `하한 + 앵커 이동` 이전에
    시작하면 위반.

    solve 는 시각을 **만드는** 경로라, 이미 지난 시각이나 지금 위치에서 갈 수 없는 시각에
    새 방문을 놓은 해가 검증 도장과 함께 나가면 INV-2 위반이다. 공용 validate·repair 에는
    넣지 않는다 — 저장된 일정을 다시 보는 경로라 시간이 흐르면 지난 슬롯이 전부 위반이
    되고, 그 문제엔 하한도 없다. 고정 블록은 HC3 과 같은 기준(poi·시각 정확 일치)으로
    면제한다. 좌표 미상 POI 는 하한만 본다(이동은 `check_hc2_coords_known` 몫).
    """
    floor = not_before_floor(problem)
    if floor is None:
        return []
    pinned = {(fb.poi_id, fb.window.start, fb.window.end) for fb in problem.fixed_blocks}
    out: list[Violation] = []
    for day in solution.days:
        for slot in day.slots:
            if (slot.poi_id, slot.start_at, slot.end_at) in pinned:
                continue
            poi = poi_index.get(slot.poi_id)
            lo = floor + timedelta(
                minutes=anchor_minutes(problem, poi, estimator) if poi else 0)
            if slot.start_at < lo:
                out.append(Violation("HC4", slot.poi_id,
                                     f"시작 하한({lo.isoformat()}) 이전: "
                                     f"{slot.start_at.isoformat()}"))
    return out


def check_hc3(solution: ItinerarySolution, problem: ItineraryProblem) -> list[Violation]:
    """고정 블록 시각 불변: 해당 일자에 정확한 시각의 슬롯이 존재해야 함."""
    out: list[Violation] = []
    slots_by_day = {day.date: day.slots for day in solution.days}
    for fb in problem.fixed_blocks:
        d = fb.window.start.date()
        if d not in set(problem.days):
            continue
        slots = slots_by_day.get(d, ())
        ok = any(s.poi_id == fb.poi_id
                 and s.start_at == fb.window.start
                 and s.end_at == fb.window.end for s in slots)
        if not ok:
            out.append(Violation("HC3", fb.poi_id, f"{d} 고정 블록 미준수"))
    return out


def check_hc4(solution: ItinerarySolution, problem: ItineraryProblem) -> list[Violation]:
    """day window 내 (자정 초과 활동은 시작일 귀속 — end가 자정 넘어도 시작일 창으로 비교).

    창은 그 날의 것이다(`window_on` — 일자별 창, TRIP-1389). 고정 블록은 창이 아니라 HC3 가
    잡는다 — 사용자가 정한 시각(야경 20:00~익일 01:00 등)이 창을 넘는다고 위반으로 세면 모든
    조립 단계가 그 하루를 버렸다(TRIP-1390). 시작 하한 검사(`check_not_before`)와 같은 규칙."""
    pinned = {(fb.poi_id, fb.window.start, fb.window.end) for fb in problem.fixed_blocks}
    out: list[Violation] = []
    for day in solution.days:
        win = problem.window_on(day.date)
        ws = _min_of_day(win.start)
        we = _min_of_day(win.end)
        if we <= ws:
            we += 1440  # window 자체가 자정 초과인 경우
        for slot in day.slots:
            if (slot.poi_id, slot.start_at, slot.end_at) in pinned:
                continue
            start_m = _min_of_day(slot.start_at) + 1440 * (slot.start_at.date() - day.date).days
            end_m = start_m + int((slot.end_at - slot.start_at).total_seconds() // 60)
            # 시작은 그날 안(자정 넘는 창에서도 끝만 넘는다 — 슬롯은 시작 시각 + ends_next_day 로 나간다)
            if start_m < ws or end_m > we or start_m > 24 * 60 - 1:
                out.append(Violation("HC4", slot.poi_id,
                                     f"day window({ws}~{we}) 밖: {start_m}~{end_m}"))
    return out


def check_all(solution: ItinerarySolution, problem: ItineraryProblem,
              poi_index: Mapping[PoiId, Poi], estimator) -> list[Violation]:
    return (check_hc1(solution, poi_index, problem.holidays)
            + check_hc2(solution, poi_index, estimator, problem)
            + check_hc3(solution, problem)
            + check_hc4(solution, problem))
