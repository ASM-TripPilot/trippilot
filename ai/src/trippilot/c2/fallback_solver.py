"""RuleFallbackSolver — 체인 최후 단계 (정본 §4.3 구성 휴리스틱, U2 FD §2.5).

항상 해를 반환한다 (INV-4 구조 보장): 최악 = 고정 블록만(또는 빈 일자).
problem.excluded_poi_ids는 후보 풀에서 제외 (2단계 생성 중복 방지 — TRIP-293).
결정론: 점수·id 정렬 기반, 무작위성 없음, wall-clock 미사용.
벤치마크에서 CP-SAT 웜스타트 힌트로도 검증된 그 그리디의 정식판.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Mapping

from trippilot.c2.config import STAY_DEFAULT_MIN, SolverConfig
from trippilot.domain.common import PoiId
from trippilot.domain.itinerary import (
    DaySolution,
    ItineraryProblem,
    ItinerarySolution,
    SolveMode,
    VisitSlot,
)
from trippilot.domain.poi import Poi


def _at(day, template: datetime) -> datetime:
    """day 날짜에 template의 시각(time-of-day)·tz를 적용."""
    return datetime(day.year, day.month, day.day,
                    template.hour, template.minute, tzinfo=template.tzinfo)


def _open_ok(poi: Poi, start: datetime, end: datetime) -> bool:
    if not poi.open_hours:
        return True  # 정보 없음 → 막지 않음 (constraints.py와 동일 규칙)
    dow = start.weekday()
    todays = [oh for oh in poi.open_hours if oh.day_of_week == dow]
    if not todays:
        return False  # 휴무
    s = start.hour * 60 + start.minute
    e = s + int((end - start).total_seconds() // 60)
    return any(oh.open_min <= s and e <= oh.close_min for oh in todays)


class RuleFallbackSolver:
    """ChainStage: required_ms=0, 항상 해 반환."""

    name = "rule_fallback"
    required_ms = 0

    def __init__(self, poi_index: Mapping[PoiId, Poi],
                 estimator, config: SolverConfig) -> None:
        self._pois = poi_index
        self._est = estimator
        self._cfg = config

    def solve(self, problem: ItineraryProblem,
              remaining_ms: int = 0) -> ItinerarySolution:
        score_of = {c.poi_id: c for c in problem.candidates}
        # 기배정 POI(TRIP-293)는 후보 풀에서만 뺀다 — 고정 블록(HC3)은 그대로 배치
        ranked_src = [c for c in problem.candidates
                      if c.poi_id not in problem.excluded_poi_ids]
        # 결정론 정렬: 점수 내림차순 → id 오름차순 (동점 tie-break)
        ranked = sorted(ranked_src, key=lambda c: (-c.score, str(c.poi_id)))
        fixed_by_day: dict = {}
        for fb in problem.fixed_blocks:
            fixed_by_day.setdefault(fb.window.start.date(), []).append(fb)

        used: set[PoiId] = set()
        days: list[DaySolution] = []
        for day in problem.days:
            slots: list[VisitSlot] = []
            # ① 고정 블록 — 시각 그대로 (HC3)
            for fb in sorted(fixed_by_day.get(day, []), key=lambda f: f.window.start):
                if fb.poi_id in used:
                    continue  # 중복 고정(예: regenerate가 잠근 슬롯 = 기존 fb) 방어
                stay = int((fb.window.end - fb.window.start).total_seconds() // 60)
                sp = score_of.get(fb.poi_id)
                slots.append(VisitSlot(
                    poi_id=fb.poi_id, start_at=fb.window.start, end_at=fb.window.end,
                    stay_min=stay,
                    score=sp.score if sp else 0.0,
                    is_llm_score=sp.is_llm_score if sp else False,
                ))
                used.add(fb.poi_id)
            # ② 점수순 말단 삽입 (HC 위반 후보는 스킵, 삽입 불가 시 비워둠)
            day_end = _at(day, problem.day_window.end)
            for cand in ranked:
                if cand.poi_id in used:
                    continue
                poi = self._pois.get(cand.poi_id)
                if poi is None:
                    continue
                stay = STAY_DEFAULT_MIN[poi.category]
                last = slots[-1] if slots else None
                if last is None:
                    depart = _at(day, problem.day_window.start)
                    travel_min = 0
                    if problem.anchor is not None:
                        travel_min = self._est.estimate(
                            problem.anchor, poi.coord, problem.transport
                        ).internal_minutes
                else:
                    last_poi = self._pois.get(last.poi_id)
                    depart = last.end_at
                    travel_min = self._est.estimate(
                        last_poi.coord, poi.coord, problem.transport
                    ).internal_minutes if last_poi else 0
                start = depart + timedelta(minutes=travel_min)
                end = start + timedelta(minutes=stay)
                if end > day_end:
                    continue  # day window 초과 (HC4)
                if not _open_ok(poi, start, end):
                    continue  # 영업시간 (HC1)
                # 고정 블록과의 충돌: 말단 삽입이라 뒤에 오는 고정 블록만 위험
                conflict = any(not (end <= s.start_at or start >= s.end_at)
                               for s in slots)
                if conflict:
                    continue
                slots.append(VisitSlot(
                    poi_id=cand.poi_id, start_at=start, end_at=end,
                    stay_min=stay, score=cand.score, is_llm_score=cand.is_llm_score,
                ))
                used.add(cand.poi_id)
                slots.sort(key=lambda s: s.start_at)
            days.append(DaySolution(date=day, slots=tuple(slots), fixed_blocks=()))

        placed_any = any(d.slots for d in days)
        return ItinerarySolution(
            schedule_id=problem.schedule_id,
            days=tuple(days),
            is_fallback=True,
            solve_mode=SolveMode.RULE_FALLBACK if placed_any else SolveMode.MINIMAL,
            solver_run=None,
        )
