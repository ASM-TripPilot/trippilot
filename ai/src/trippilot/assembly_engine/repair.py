"""RepairEngine — 최소 변경 수리 (정본 §1.2 repair, U2 FD §2.7).

1차 정책 TIME_SHIFT_ONLY: POI·순서 불변, 시각만 전방 이동(cascade)으로 HC2 해소 시도.
고정 블록(HC3)은 절대 이동하지 않는다 — 고정과 충돌하면 수리 불가(None).
수리 후 호출자가 반드시 재검증한다 (INV-2 — 여기서도 자체 확인).

참고: FD는 이 타입들을 domain에 배치했으나, 직렬화·영속 대상이 아니라
c2 내부 타입으로 조정 (U5 API 노출 시 재검토 — audit 기록).
TRIP-292에서 `HybridAssemblyFacade.repair()`가 공개 경계로 승격되면서 RepairResult가
백엔드 응답 스키마의 원천이 됐다 — 배치는 c2 유지, 직렬화 형태 확정은 U5 몫.

시한(deadline)은 여기서 다루지 않는다: 시계 소유자는 퍼사드 하나뿐(DL-3)이고,
이 함수는 단일 패스 순수 계산이라 중단점이 없다. 진입 스킵·초과 관측은 퍼사드가 한다.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from enum import Enum
from typing import Mapping

from trippilot.domain.common import PoiId
from trippilot.domain.itinerary import (
    DaySolution,
    ItineraryProblem,
    ItinerarySolution,
    VisitSlot,
)
from trippilot.domain.poi import Poi


class MinimalChangePolicy(Enum):
    TIME_SHIFT_ONLY = "TIME_SHIFT_ONLY"
    ALLOW_REORDER = "ALLOW_REORDER"  # 후속 — 1차 미구현


@dataclass(frozen=True, slots=True)
class RepairChange:
    poi_id: PoiId
    field: str  # "start_at"
    before: datetime
    after: datetime


@dataclass(frozen=True, slots=True)
class RepairResult:
    repaired: ItinerarySolution | None  # None = 수리 불가 → 체인 다음 단계
    changes: tuple[RepairChange, ...]


def _mod(dt: datetime) -> int:
    return dt.hour * 60 + dt.minute


def _fits_open_hours(poi: Poi, start: datetime, end: datetime) -> bool:
    if not poi.open_hours:
        return True
    todays = [oh for oh in poi.open_hours if oh.day_of_week == start.weekday()]
    if not todays:
        return False
    s = _mod(start)
    e = s + int((end - start).total_seconds() // 60)
    return any(oh.open_min <= s and e <= oh.close_min for oh in todays)


def repair(solution: ItinerarySolution, problem: ItineraryProblem,
           poi_index: Mapping[PoiId, Poi], estimator,
           policy: MinimalChangePolicy = MinimalChangePolicy.TIME_SHIFT_ONLY,
           ) -> RepairResult:
    if policy is not MinimalChangePolicy.TIME_SHIFT_ONLY:
        return RepairResult(repaired=None, changes=())

    pinned: dict[tuple, tuple[datetime, datetime]] = {
        (fb.window.start.date(), fb.poi_id): (fb.window.start, fb.window.end)
        for fb in problem.fixed_blocks
    }
    we_min = _mod(problem.day_window.end)
    changes: list[RepairChange] = []
    new_days: list[DaySolution] = []

    for day in solution.days:
        prev: VisitSlot | None = None
        new_slots: list[VisitSlot] = []
        for slot in day.slots:
            stay = int((slot.end_at - slot.start_at).total_seconds() // 60)
            pin = pinned.get((day.date, slot.poi_id))
            if pin is not None:
                start, end = pin  # 고정 블록 — 이동 금지 (HC3)
            else:
                start = slot.start_at
                if prev is not None:
                    p1 = poi_index.get(prev.poi_id)
                    p2 = poi_index.get(slot.poi_id)
                    if p1 is not None and p2 is not None:
                        travel = estimator.estimate(
                            p1.coord, p2.coord, problem.transport).internal_minutes
                        earliest = prev.end_at + timedelta(minutes=travel)
                        if start < earliest:
                            start = earliest  # 전방 이동 (HC2 해소)
                end = start + timedelta(minutes=stay)

            # 이동 결과가 다른 제약을 깨면 수리 불가
            if prev is not None and start < prev.end_at:
                return RepairResult(repaired=None, changes=())
            if _mod(start) + stay > we_min:  # HC4 (day window 초과)
                return RepairResult(repaired=None, changes=())
            poi = poi_index.get(slot.poi_id)
            if poi is not None and not _fits_open_hours(poi, start, end):
                return RepairResult(repaired=None, changes=())  # HC1 깨짐

            if start != slot.start_at:
                changes.append(RepairChange(slot.poi_id, "start_at",
                                            slot.start_at, start))
            moved = replace(slot, start_at=start, end_at=end)
            new_slots.append(moved)
            prev = moved
        new_days.append(replace(day, slots=tuple(new_slots)))

    # replace: 나열 재구성 금지(안티패턴 TRIP-314) — days 외 필드는 전부 그대로
    # 옮긴다(출처 solve_mode·score 보존 포함). 나열식은 뒤에 추가된 필드를
    # 조용히 떨어뜨렸다 — score(QualityScore) 소실이 실제 사례 (TRIP-329).
    repaired = replace(solution, days=tuple(new_days))
    return RepairResult(repaired=repaired, changes=tuple(changes))
