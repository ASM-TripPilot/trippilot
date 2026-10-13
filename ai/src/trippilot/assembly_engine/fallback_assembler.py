"""RuleFallbackAssembler — 체인 최후 단계 (정본 §4.3 구성 휴리스틱, U2 FD §2.5).

항상 해를 반환한다 (INV-4 구조 보장): 최악 = 고정 블록만(또는 빈 일자).
problem.excluded_poi_ids는 후보 풀에서 제외 (2단계 생성 중복 방지 — TRIP-293).
결정론: 점수·id 정렬 기반, 무작위성 없음, wall-clock 미사용.
벤치마크에서 CP-SAT 웜스타트 힌트로도 검증된 그 그리디의 정식판.

OR 의 재정렬(B 단계, TRIP-1178)에 해당하는 '집합 고정 최근접 재배열'은 여기 넣지 않았다.
① 이 클래스의 해는 OR 웜스타트(`_greedy_hint`)이기도 해서, 순서를 바꾸면 OR 의 A 탐색이
통째로 바뀐다 — 체인 단계에만 넣으려면 경로를 따로 갈라야 한다. ② 체인에서 여기까지 오는
것은 OR 실패·잔여 시한 부족 때뿐이다(TRIP-1176 뒤 실 덤프 39건 OR 실패 0). ③ 이득도 OR 쪽보다
작다 — 측정(폴백 단독, 부산·서울 LLM 유사 점수 각 12일): 하루 km 중앙 −5~−19%.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta
from typing import Mapping, Sequence

from trippilot.assembly_engine.config import (
    RAIN_INDOOR,
    RAIN_OUTDOOR,
    stay_for,
    AssemblyConfig,
)
from trippilot.assembly_engine.constraints import anchor_minutes, not_before_floor
from trippilot.domain.common import PoiId
from trippilot.domain.itinerary import (
    DaySolution,
    FixedBlock,
    ItineraryProblem,
    ItinerarySolution,
    SolveMode,
    TimeWindow,
    VisitSlot,
)
from trippilot.domain.poi import Poi, PoiCategory, counts_as_food


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

    시각 없는 필수 방문(TRIP-1249)도 **배치됐으면** 실린다 — 창은 해의 슬롯, reason 은
    `required_visit`. 그래야 응답이 is_fixed=true 로 나간다(BE 가 핀해 보내던 종전과 같은
    모양 — 같이 짜기에서 필수방문이 교체 가능한 슬롯으로 바뀌는 회귀 방지). HC3 는
    `problem.fixed_blocks` 만 보므로 하드 제약은 늘지 않는다.
    """
    pinned = tuple(
        fb for fb in problem.fixed_blocks
        if fb.window.start.date() == day
        and any(
            s.poi_id == fb.poi_id
            and s.start_at == fb.window.start
            and s.end_at == fb.window.end
            for s in slots
        )
    )
    required: list[FixedBlock] = []
    for rv in problem.required_visits:
        if rv.day != day:
            continue
        slot = next((s for s in slots if s.poi_id == rv.poi_id), None)
        if slot is not None:
            required.append(FixedBlock(
                poi_id=rv.poi_id, window=TimeWindow(slot.start_at, slot.end_at),
                reason="required_visit"))
    return pinned + tuple(required)


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


class RuleFallbackAssembler:
    """ChainStage: required_ms=0, 항상 해 반환."""

    name = "rule_fallback"
    required_ms = 0

    def __init__(self, poi_index: Mapping[PoiId, Poi],
                 estimator, config: AssemblyConfig) -> None:
        self._pois = poi_index
        self._est = estimator
        self._cfg = config

    def solve(self, problem: ItineraryProblem,
              remaining_ms: int = 0) -> ItinerarySolution:
        score_of = {c.poi_id: c for c in problem.candidates}
        # 기배정 POI(TRIP-293)는 후보 풀에서만 뺀다 — 고정 블록(HC3)은 그대로 배치.
        # 고정 예약 POI 전체도 자유 경로에서 뺀다: 앞날 자유 배치가 선점하면
        # 제 날의 고정 배치를 used 방어가 건너뛰어 HC3가 깨진다 (2026-08-21 실측).
        # 필수 방문(TRIP-1249)도 같다 — 제 날의 ①′ 만 놓는다.
        reserved = ({fb.poi_id for fb in problem.fixed_blocks}
                    | {rv.poi_id for rv in problem.required_visits})
        ranked_src = [c for c in problem.candidates
                      if c.poi_id not in problem.excluded_poi_ids
                      and c.poi_id not in reserved]
        # 결정론 정렬: 점수 내림차순 → id 오름차순 (동점 tie-break)
        ranked = sorted(ranked_src, key=lambda c: (-c.score, str(c.poi_id)))
        fixed_by_day: dict = {}
        for fb in problem.fixed_blocks:
            fixed_by_day.setdefault(fb.window.start.date(), []).append(fb)
        required_by_day: dict = {}
        for rv in problem.required_visits:
            required_by_day.setdefault(rv.day, []).append(rv)

        used: set[PoiId] = set()
        days: list[DaySolution] = []
        # 비고정 방문 시작 하한 (TRIP-1182) — 고정 블록(①)은 면제, 자유 삽입(②)만 미룬다
        not_before = not_before_floor(problem)
        for day in problem.days:
            slots: list[VisitSlot] = []
            # 일별 카테고리 배치 수 (TRIP-531) — 고정 블록 포함
            cat_count: Counter = Counter()
            food_count = 0  # FOOD 하루 상한 — 고정 블록 포함 (OR 항의 핀 노드와 같은 기준)
            # ① 고정 블록 — 시각 그대로 (HC3)
            for fb in sorted(fixed_by_day.get(day, []), key=lambda f: f.window.start):
                if any(s.poi_id == fb.poi_id and s.start_at == fb.window.start
                       for s in slots):
                    # 중복 고정(예: regenerate가 잠근 슬롯 = 기존 fb) 방어. (POI, 시작)으로
                    # 본다 — POI 만 보면 같은 곳 하루 두 번 고정(·다른 날 같은 곳 예약)의
                    # 둘째를 건너뛰어 HC3 가 깨진다(재계획 리뷰 실측).
                    continue
                stay = int((fb.window.end - fb.window.start).total_seconds() // 60)
                sp = score_of.get(fb.poi_id)
                slots.append(VisitSlot(
                    poi_id=fb.poi_id, start_at=fb.window.start, end_at=fb.window.end,
                    stay_min=stay,
                    score=sp.score if sp else 0.0,
                    is_llm_score=sp.is_llm_score if sp else False,
                ))
                used.add(fb.poi_id)
                fb_poi = self._pois.get(fb.poi_id)
                if fb_poi is not None:
                    cat_count[fb_poi.category] += 1
                    food_count += counts_as_food(fb_poi)
            day_end = _at(day, problem.day_window.end)
            windows = (self._cfg.lunch_window_min, self._cfg.dinner_window_min)
            meal_done = [False] * len(windows)
            # ①′ 시각 없는 필수 방문 (TRIP-1249) — 고정 블록 사이 틈에서 가장 이른 가능 시각.
            #    식당은 식사창(점심 → 저녁) 안을 먼저, 안 되면 영업시간 안. 못 놓으면 건너뛴다
            #    (예외 없음 — 미배치는 배선이 보고한다). 체류는 사용자 값이면 그대로(pace 없음,
            #    고정과 같다), 없으면 카테고리 기본(`stay_for`, pace 적용 — 자유 후보와 같다).
            for rv in required_by_day.get(day, []):
                poi = self._pois.get(rv.poi_id)
                if poi is None or any(s.poi_id == rv.poi_id for s in slots):
                    continue  # 좌표 미상은 못 놓고, 같은 날 핀이면 이미 간다 (OR 과 같은 규칙)
                stay = (rv.dwell_min if rv.dwell_min is not None
                        else stay_for(poi.category, problem.pace))
                start = self._required_start(problem, day, poi, stay, slots, not_before, windows)
                if start is None:
                    continue
                sp = score_of.get(rv.poi_id)
                slots.append(VisitSlot(
                    poi_id=rv.poi_id, start_at=start,
                    end_at=start + timedelta(minutes=stay), stay_min=stay,
                    score=sp.score if sp else 0.0,
                    is_llm_score=sp.is_llm_score if sp else False,
                ))
                slots.sort(key=lambda s: s.start_at)
                used.add(rv.poi_id)
                cat_count[poi.category] += 1
                food_count += counts_as_food(poi)
                if poi.category is PoiCategory.FOOD:  # ② 와 같은 창 점유 판정
                    s_mod = start.hour * 60 + start.minute
                    for w, (lo, hi) in enumerate(windows):
                        if s_mod < hi and s_mod + stay > lo:
                            meal_done[w] = True
            # ② 점수순 말단 삽입 + 식사 시간대 보정 (TRIP-379 — OR-Tools 소프트 항의
            #    결정론 버전, HC 위반 후보는 스킵, 삽입 불가 시 비워둠).
            #    규칙: 현재 말단 시각이 아직 식사가 없는 식사 창 안이고 직전 슬롯이
            #    FOOD가 아니면 FOOD를 우선 시도(창당 1개·연속 금지의 그리디판),
            #    그 외에는 FOOD 후순위. 배제가 아니라 시도 순서만 바꾼다 —
            #    FOOD만 남으면 창 밖이어도 배치된다("정보 없음 ≠ 배제"와 같은 정신).
            #    틈 채우기(TRIP-1249)는 **필수 방문이 있는 날만** — ①′ 가 점심창에 놓은 식당
            #    앞의 오전이 비지 않게 첫 슬롯 앞·슬롯 사이 틈에도 넣는다. 없는 날은 종전과
            #    바이트 동일(말단 삽입만)이라 기존 요청의 웜스타트 힌트가 변하지 않는다.
            remaining = self._day_ranked(problem, day, ranked, used)
            gap_fill = bool(required_by_day.get(day))
            k = -1  # 커서: slots[k] 뒤 틈에 넣는다 (−1 = 첫 슬롯 앞). 틈 채우기가 아니면 늘 말단
            # 일별 카테고리 허용치 (TRIP-531) — OR-Tools 항과 동일 공식:
            # max(설정값, ⌈남은 후보 수 ÷ 남은 일수⌉) = 공정 몫 바닥.
            # 고정 허용치만 쓰면 앞날 회피분이 마지막 날에 몰린다(청주 실측).
            remaining_days = max(1, sum(1 for d in problem.days if d >= day))
            day_cat_total: Counter = Counter()
            for c in remaining:
                p = self._pois.get(c.poi_id)
                if p is not None:
                    day_cat_total[p.category] += 1
            # 분모에 그날 고정 블록도 합산 — OR-Tools 항의 len(idxs)(핀 노드 포함)와
            # 동일 기준. 빼면 고정 블록 카테고리의 자유 후보가 cat_count 선점 때문에
            # OR-Tools보다 일찍 후순위로 밀린다 (리뷰 지적).
            day_cat_total.update(cat_count)
            quota = {c: max(self._cfg.category_free_count, -(-n // remaining_days))
                     for c, n in day_cat_total.items()}
            while remaining:
                if not gap_fill:
                    k = len(slots) - 1
                last = slots[k] if k >= 0 else None
                nxt = slots[k + 1] if k + 1 < len(slots) else None
                ref = last.end_at if last is not None \
                    else _at(day, problem.day_window.start)
                if not_before is not None and ref < not_before:
                    ref = not_before  # 식사 창 판정도 실제로 놓일 수 있는 시각 기준
                ref_mod = ref.hour * 60 + ref.minute
                last_poi = self._pois.get(last.poi_id) if last is not None else None
                if last is not None and last_poi is None:
                    break  # 좌표 미상 뒤 이동을 모른다 — 0분으로 놓지 않는다 (TRIP-1177)
                nxt_poi = self._pois.get(nxt.poi_id) if nxt is not None else None
                last_is_food = (last_poi is not None
                                and last_poi.category is PoiCategory.FOOD)
                food_first = not last_is_food and any(
                    not done and lo <= ref_mod < hi
                    for done, (lo, hi) in zip(meal_done, windows))

                def _is_food(c) -> bool:
                    p = self._pois.get(c.poi_id)
                    return p is not None and p.category is PoiCategory.FOOD

                # 일별 동일 카테고리 초과 후보는 후순위 (TRIP-531 — OR-Tools 체감
                # 페널티의 그리디판). 배제가 아니라 시도 순서만 — 초과분만 남으면
                # 그대로 배치된다("정보 없음 ≠ 배제"와 같은 정신).
                def _over_quota(c) -> bool:
                    p = self._pois.get(c.poi_id)
                    return (p is not None and cat_count[p.category]
                            >= quota.get(p.category,
                                         self._cfg.category_free_count))

                # FOOD 하루 상한 (config 주석) — 다 찼으면 FOOD 는 맨 뒤. 배제가 아니라
                # 순서만이라 FOOD 만 남으면 그대로 배치된다. 첫 키인 것은 OR 감점(1.0)이
                # 카테고리 감점(0.3)·식사 선호보다 커서다.
                food_full = food_count >= self._cfg.food_daily_max

                def _food_over(c) -> bool:
                    p = self._pois.get(c.poi_id)
                    return food_full and p is not None and counts_as_food(p)

                # 안정 정렬 — FOOD 상한 → 쿼터 내 먼저 → 선호 클래스 → ranked 순서
                order = sorted(remaining, key=lambda c: (
                    _food_over(c), _over_quota(c), _is_food(c) != food_first))
                placed = False
                for cand in order:
                    if not gap_fill:
                        remaining.remove(cand)  # 실패든 성공이든 그 일자 재시도 없음
                    poi = self._pois.get(cand.poi_id)
                    if poi is None:
                        continue
                    stay = stay_for(poi.category, problem.pace)
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
                        ).internal_minutes
                    start = depart + timedelta(minutes=travel_min)
                    if not_before is not None:
                        # 하한 시각에 지금 위치(앵커)에서 출발 (OR 노드 lo 와 같은 규칙)
                        start = max(start, not_before + timedelta(
                            minutes=anchor_minutes(problem, poi, self._est)))
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
                    if nxt is not None:  # 틈 채우기 — 뒤 슬롯까지 이동도 들어가야 한다 (HC2)
                        if nxt_poi is None:
                            continue  # 좌표 미상 앞에도 놓지 않는다 (위 break 와 같은 이유)
                        to_next = self._est.estimate(
                            poi.coord, nxt_poi.coord, problem.transport).internal_minutes
                        if end + timedelta(minutes=to_next) > nxt.start_at:
                            continue
                    if gap_fill:
                        remaining.remove(cand)  # 틈에 못 들어간 후보는 다음 틈에서 다시 본다
                    slots.append(VisitSlot(
                        poi_id=cand.poi_id, start_at=start, end_at=end,
                        stay_min=stay, score=cand.score,
                        is_llm_score=cand.is_llm_score,
                    ))
                    used.add(cand.poi_id)
                    cat_count[poi.category] += 1  # TRIP-531
                    food_count += counts_as_food(poi)
                    slots.sort(key=lambda s: s.start_at)
                    if gap_fill:
                        k += 1  # 방금 놓은 슬롯 뒤로 — 같은 틈의 남은 자리를 이어서 본다
                    if poi.category is PoiCategory.FOOD:
                        s_mod = start.hour * 60 + start.minute
                        for w, (lo, hi) in enumerate(windows):
                            if s_mod < hi and s_mod + stay > lo:  # 창과 겹침
                                meal_done[w] = True
                    placed = True
                    break  # 말단이 바뀌었으니 선호 재평가
                if not placed:
                    if gap_fill and nxt is not None:
                        k += 1  # 이 틈엔 아무것도 안 들어간다 — 다음 틈으로
                        continue
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
            assembly_run=None,
        )

    def _required_start(self, problem: ItineraryProblem, day, poi: Poi, stay: int,
                        slots: list[VisitSlot], not_before: datetime | None,
                        windows: tuple[tuple[int, int], ...]) -> datetime | None:
        """①′ 필수 방문이 놓일 가장 이른 시각 (TRIP-1249) — 없으면 None.

        슬롯 사이 틈마다 본다: 앞 슬롯 끝 + 이동(없으면 창 시작 + 앵커 이동, 하한이 있으면
        하한 + 앵커 이동 — ② 와 같은 규칙) 이후, 뒤 슬롯 시작 − 이동 이전(HC2), 하루 창 안
        (HC4), 영업창 안(HC1). 식당(`counts_as_food`)은 점심창 → 저녁창 → 아무 때 순으로
        **창을 먼저** 돈다 — 같은 창 안에서는 이른 틈이 이긴다. 이웃 좌표를 모르면 그 틈은
        건너뛴다(0분 이동 금지, TRIP-1177).
        """
        base = _at(day, problem.day_window.start).replace(hour=0, minute=0)

        def mins(dt: datetime) -> int:
            return int((dt - base).total_seconds() // 60)

        ws = mins(_at(day, problem.day_window.start))
        we = mins(_at(day, problem.day_window.end))
        floor = (mins(not_before) + anchor_minutes(problem, poi, self._est)
                 if not_before is not None else None)

        def travel(a: Poi, b: Poi) -> int:
            return self._est.estimate(a.coord, b.coord, problem.transport).internal_minutes

        gaps: list[tuple[int, int]] = []
        prev: VisitSlot | None = None
        for nxt in (*sorted(slots, key=lambda s: s.start_at), None):
            prev_poi = self._pois.get(prev.poi_id) if prev is not None else None
            nxt_poi = self._pois.get(nxt.poi_id) if nxt is not None else None
            if (prev is None or prev_poi is not None) and (nxt is None or nxt_poi is not None):
                lb = (ws + anchor_minutes(problem, poi, self._est) if prev_poi is None
                      else mins(prev.end_at) + travel(prev_poi, poi))
                ub = we if nxt_poi is None else mins(nxt.start_at) - travel(poi, nxt_poi)
                gaps.append((max(lb, floor) if floor is not None else lb, ub))
            prev = nxt

        ranges = (*windows, (ws, we)) if counts_as_food(poi) else ((ws, we),)
        for lo_r, hi_r in ranges:
            for lb, ub in gaps:
                t = self._earliest_open(poi, max(lb, lo_r), min(ub, hi_r) - stay, stay,
                                        day.weekday())
                if t is not None:
                    return base + timedelta(minutes=t)
        return None

    @staticmethod
    def _earliest_open(poi: Poi, a: int, b: int, stay: int, dow: int) -> int | None:
        """[a, b] 안에서 체류가 영업창에 들어가는 가장 이른 시작(분). 정보 없음 = a (HC1 미적용).

        후보 시각은 a 와 그 뒤의 영업 시작들뿐이다 — 가능 구간은 영업창들의 합집합과 [a, b] 의
        교집합이라 가장 이른 점은 둘 중 하나다. 판정은 `_open_ok` 와 같은 식(한 창 안에 완전 포함).
        """
        if a > b:
            return None
        if not poi.open_hours:
            return a
        todays = [oh for oh in poi.open_hours if oh.day_of_week == dow]
        for t in sorted({a, *(oh.open_min for oh in todays if a < oh.open_min <= b)}):
            if any(oh.open_min <= t and t + stay <= oh.close_min for oh in todays):
                return t
        return None

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
