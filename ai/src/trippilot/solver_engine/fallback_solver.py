"""RuleFallbackSolver — 체인 최후 단계 (정본 §4.3 구성 휴리스틱, U2 FD §2.5).

항상 해를 반환한다 (INV-4 구조 보장): 최악 = 고정 블록만(또는 빈 일자).
problem.excluded_poi_ids는 후보 풀에서 제외 (2단계 생성 중복 방지 — TRIP-293).
결정론: 점수·id 정렬 기반, 무작위성 없음, wall-clock 미사용.
벤치마크에서 CP-SAT 웜스타트 힌트로도 검증된 그 그리디의 정식판.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Mapping, Sequence

from trippilot.solver_engine.config import (
    RAIN_INDOOR,
    RAIN_OUTDOOR,
    STAY_DEFAULT_MIN,
    SolverConfig,
)
from trippilot.domain.common import PoiId
from trippilot.domain.itinerary import (
    DaySolution,
    FixedBlock,
    ItineraryProblem,
    ItinerarySolution,
    SolveMode,
    VisitSlot,
)
from trippilot.domain.poi import Poi, PoiCategory


def _at(day, template: datetime) -> datetime:
    """day 날짜에 template의 시각(time-of-day)·tz를 적용."""
    return datetime(day.year, day.month, day.day,
                    template.hour, template.minute, tzinfo=template.tzinfo)


def placed_fixed_blocks(
    problem: ItineraryProblem, day, slots: Sequence[VisitSlot]
) -> tuple[FixedBlock, ...]:
    """그 일자 고정 블록(HC3) 중 **실제 해에 배치된 것**만 (TRIP-343).

    routes.to_payload는 `DaySolution.fixed_blocks`에서만 is_fixed를 판정한다 —
    비워 두면 응답 is_fixed가 상시 false가 되어 백엔드 왕복 후 validate/repair의
    HC3 검증 집합이 비어 버린다. 배치 사실은 지어내지 않고, HC3 판정과 동일 기준
    (poi·시각 정확 일치 슬롯 존재)으로 해에서 읽는다.
    """
    return tuple(
        fb for fb in problem.fixed_blocks
        if fb.window.start.date() == day
        and any(
            s.poi_id == fb.poi_id
            and s.start_at == fb.window.start
            and s.end_at == fb.window.end
            for s in slots
        )
    )


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
        # 기배정 POI(TRIP-293)는 후보 풀에서만 뺀다 — 고정 블록(HC3)은 그대로 배치.
        # 고정 예약 POI 전체도 자유 경로에서 뺀다: 앞날 자유 배치가 선점하면
        # 제 날의 고정 배치를 used 방어가 건너뛰어 HC3가 깨진다 (2026-08-21 실측).
        reserved = {fb.poi_id for fb in problem.fixed_blocks}
        ranked_src = [c for c in problem.candidates
                      if c.poi_id not in problem.excluded_poi_ids
                      and c.poi_id not in reserved]
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
            # ② 점수순 말단 삽입 + 식사 시간대 보정 (TRIP-379 — OR-Tools 소프트 항의
            #    결정론 버전, HC 위반 후보는 스킵, 삽입 불가 시 비워둠).
            #    규칙: 현재 말단 시각이 아직 식사가 없는 식사 창 안이고 직전 슬롯이
            #    FOOD가 아니면 FOOD를 우선 시도(창당 1개·연속 금지의 그리디판),
            #    그 외에는 FOOD 후순위. 배제가 아니라 시도 순서만 바꾼다 —
            #    FOOD만 남으면 창 밖이어도 배치된다("정보 없음 ≠ 배제"와 같은 정신).
            day_end = _at(day, problem.day_window.end)
            windows = (self._cfg.lunch_window_min, self._cfg.dinner_window_min)
            meal_done = [False] * len(windows)
            remaining = self._day_ranked(problem, day, ranked, used)
            while remaining:
                last = slots[-1] if slots else None
                ref = last.end_at if last is not None \
                    else _at(day, problem.day_window.start)
                ref_mod = ref.hour * 60 + ref.minute
                last_poi = self._pois.get(last.poi_id) if last is not None else None
                last_is_food = (last_poi is not None
                                and last_poi.category is PoiCategory.FOOD)
                food_first = not last_is_food and any(
                    not done and lo <= ref_mod < hi
                    for done, (lo, hi) in zip(meal_done, windows))

                def _is_food(c) -> bool:
                    p = self._pois.get(c.poi_id)
                    return p is not None and p.category is PoiCategory.FOOD

                # 안정 정렬 — 선호 클래스 먼저, 클래스 안에서는 ranked 순서 유지
                order = sorted(remaining, key=lambda c: _is_food(c) != food_first)
                placed = False
                for cand in order:
                    remaining.remove(cand)  # 실패든 성공이든 그 일자 재시도 없음
                    poi = self._pois.get(cand.poi_id)
                    if poi is None:
                        continue
                    stay = STAY_DEFAULT_MIN[poi.category]
                    if last is None:
                        depart = _at(day, problem.day_window.start)
                        travel_min = 0
                        if problem.anchor is not None:
                            travel_min = self._est.estimate(
                                problem.anchor, poi.coord, problem.transport
                            ).internal_minutes
                    else:
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
                        stay_min=stay, score=cand.score,
                        is_llm_score=cand.is_llm_score,
                    ))
                    used.add(cand.poi_id)
                    slots.sort(key=lambda s: s.start_at)
                    if poi.category is PoiCategory.FOOD:
                        s_mod = start.hour * 60 + start.minute
                        for w, (lo, hi) in enumerate(windows):
                            if s_mod < hi and s_mod + stay > lo:  # 창과 겹침
                                meal_done[w] = True
                    placed = True
                    break  # 말단이 바뀌었으니 선호 재평가
                if not placed:
                    break  # 남은 후보 전부 배치 불가 — 일자 종료
            days.append(DaySolution(
                date=day, slots=tuple(slots),
                fixed_blocks=placed_fixed_blocks(problem, day, slots),  # TRIP-343
            ))

        placed_any = any(d.slots for d in days)
        return ItinerarySolution(
            schedule_id=problem.schedule_id,
            days=tuple(days),
            is_fallback=True,
            solve_mode=SolveMode.RULE_FALLBACK if placed_any else SolveMode.MINIMAL,
            solver_run=None,
        )

    def _day_ranked(self, problem: ItineraryProblem, day,
                    ranked: list, used: set[PoiId]) -> list:
        """그 일자 후보 순위 — 우천일이면 날씨 보정 반영 (TRIP-383, OR-Tools 소프트
        항의 결정론 버전).

        규칙: 강수확률 ≥ rain_threshold_pct인 날짜는 실외 점수 -rain_outdoor_penalty ·
        실내 +rain_indoor_bonus로 **순위만** 조정한다 — 배제가 아니라 시도 순서를
        바꾸는 것뿐이라 실외만 남은 풀에서도 일정은 나온다(식사 보정과 같은 정신).
        조정 점수는 정렬에만 쓰고 슬롯 score에는 싣지 않는다(선호 점수 의미 보존).
        무보정(None·정보 없음·임계 미만)이면 ranked 순서 그대로 — 종전 동작과 동일.
        """
        remaining = [c for c in ranked if c.poi_id not in used]
        rain = problem.daily_rain_prob
        pop = rain.get(day) if rain is not None else None
        rainy = pop is not None and pop >= self._cfg.rain_threshold_pct
        event_bonus = problem.event_bonus or {}
        if not rainy and not event_bonus:
            return remaining

        def _adjusted(c) -> float:
            score = c.score
            # 행사 근접 보너스 (TRIP-421) — 양수만, 날짜 무관 (기간 겹침은 수집 필터가 이미 보장)
            score += event_bonus.get(c.poi_id, 0.0) * self._cfg.event_bonus_scale
            if not rainy:
                return score
            poi = self._pois.get(c.poi_id)
            if poi is None:
                return score
            if poi.category in RAIN_OUTDOOR:
                return score - self._cfg.rain_outdoor_penalty
            if poi.category in RAIN_INDOOR:
                return score + self._cfg.rain_indoor_bonus
            return score

        # ranked와 동일한 결정론 정렬 키(점수 내림차순 → id 오름차순)의 보정판
        return sorted(remaining, key=lambda c: (-_adjusted(c), str(c.poi_id)))
