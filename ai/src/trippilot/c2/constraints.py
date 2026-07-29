"""ConstraintChecker — HC1~HC4 순수 함수 (정본 §4.2, U2 FD §2.2).

I/O 없음 — (solution, problem, poi_index, estimator)만으로 판정. oracle 전수 대조 가능(U5-P1).
빈 리스트 = 유효. 예산은 검사하지 않음(소프트, INV-SOLVE3).

영업시간 판정 규칙:
- poi.open_hours 비어 있음 = 영업정보 없음 → HC1 미적용 (알 수 없는 것은 막지 않는다)
- 항목이 있는데 해당 요일이 없음 = 휴무 → HC1 위반
- close_min > 1440(자정 초과)은 시작일 귀속 규칙으로 그대로 비교
"""

from __future__ import annotations

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
