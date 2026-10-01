"""ConstraintChecker — HC1~HC4 순수 함수 (정본 §4.2, U2 FD §2.2).

I/O 없음 — (solution, problem, poi_index, estimator)만으로 판정. oracle 전수 대조 가능(U5-P1).
빈 리스트 = 유효. 예산은 검사하지 않음(소프트, INV-SOLVE3).

영업시간 판정 규칙:
- poi.open_hours 비어 있음 = 영업정보 없음 → HC1 미적용 (알 수 없는 것은 막지 않는다)
- 항목이 있는데 해당 요일이 없음 = 휴무 → HC1 위반
- close_min > 1440(자정 초과)은 시작일 귀속 규칙으로 그대로 비교
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Mapping

from trippilot.domain.common import PoiId
from trippilot.domain.itinerary import ItineraryProblem, ItinerarySolution, Violation
from trippilot.domain.poi import Poi


def _min_of_day(dt) -> int:
    return dt.hour * 60 + dt.minute


def check_hc1(solution: ItinerarySolution, poi_index: Mapping[PoiId, Poi]) -> list[Violation]:
    """영업시간: start ≥ open ∧ end ≤ close."""
    out: list[Violation] = []
    for day in solution.days:
        for slot in day.slots:
            poi = poi_index.get(slot.poi_id)
            if poi is None or not poi.open_hours:
                continue  # 정보 없음 → 미적용
            dow = slot.start_at.weekday()
            todays = [oh for oh in poi.open_hours if oh.day_of_week == dow]
            if not todays:
                out.append(Violation("HC1", slot.poi_id, f"{dow}요일 휴무"))
                continue
            start_m = _min_of_day(slot.start_at)
            end_m = start_m + int((slot.end_at - slot.start_at).total_seconds() // 60)
            if not any(oh.open_min <= start_m and end_m <= oh.close_min for oh in todays):
                out.append(Violation("HC1", slot.poi_id,
                                     f"영업시간 밖: {start_m}~{end_m}"))
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
    ws = problem.day_window.start
    local = floor.astimezone(ws.tzinfo) if ws.tzinfo is not None else floor
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
    """day window 내 (자정 초과 활동은 시작일 귀속 — end가 자정 넘어도 시작일 창으로 비교)."""
    ws = _min_of_day(problem.day_window.start)
    we = _min_of_day(problem.day_window.end)
    if we <= ws:
        we += 1440  # window 자체가 자정 초과인 경우
    out: list[Violation] = []
    for day in solution.days:
        for slot in day.slots:
            start_m = _min_of_day(slot.start_at)
            end_m = start_m + int((slot.end_at - slot.start_at).total_seconds() // 60)
            if start_m < ws or end_m > we:
                out.append(Violation("HC4", slot.poi_id,
                                     f"day window({ws}~{we}) 밖: {start_m}~{end_m}"))
    return out


def check_all(solution: ItinerarySolution, problem: ItineraryProblem,
              poi_index: Mapping[PoiId, Poi], estimator) -> list[Violation]:
    return (check_hc1(solution, poi_index)
            + check_hc2(solution, poi_index, estimator, problem)
            + check_hc3(solution, problem)
            + check_hc4(solution, problem))
