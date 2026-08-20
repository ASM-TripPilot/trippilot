"""OrToolsSolver — 체인 1차 단계 (CP-SAT, 미결 #3 확정 · 벤치마크 모델의 정식판).

벤치마크에서 실증된 구성 그대로:
- 그리디(RuleFallbackSolver) 해를 웜스타트 힌트로 → 단일 워커에서도 즉시 가능해
- 단일 워커 + 시드 고정 = 결정론 (다중 워커는 결정론 붕괴 — audit 2026-07-29 교훈)
- 후보 > 60은 점수 상위 60 프리필터 (이동행렬 O(N²) 방지)

일자별 순차 해결: 잔여 시간을 일자 수로 분할, 앞 일자에서 쓴 POI는 제외.
problem.excluded_poi_ids(다른 호출에서 이미 배정된 POI)는 used 초기값으로 주입한다
— 2단계 생성(day1 먼저 → 나머지)에서 호출 간 중복 방지 (TRIP-293).
INFEASIBLE(고정 블록 모순 등)·UNKNOWN이면 None → 체인 다음 단계 (INV-4).
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta
from typing import Mapping

from ortools.sat.python import cp_model

from trippilot.solver_engine.config import (
    RAIN_INDOOR,
    RAIN_OUTDOOR,
    STAY_DEFAULT_MIN,
    SolverConfig,
)
from trippilot.solver_engine.fallback_solver import RuleFallbackSolver, placed_fixed_blocks
from trippilot.domain.common import PoiId
from trippilot.domain.itinerary import (
    DaySolution,
    ItineraryProblem,
    ItinerarySolution,
    SolveMode,
    VisitSlot,
)
from trippilot.domain.poi import Poi, PoiCategory

_PREFILTER_TOP_K = 60
_MIN_DAY_MS = 100


def _mod(dt: datetime) -> int:
    return dt.hour * 60 + dt.minute


class OrToolsSolver:
    """ChainStage. required_ms = config.or_tools_min_ms."""

    name = "or_tools"

    def __init__(self, poi_index: Mapping[PoiId, Poi],
                 estimator, config: SolverConfig) -> None:
        self._pois = poi_index
        self._est = estimator
        self._cfg = config
        self.required_ms = config.or_tools_min_ms

    def solve(self, problem: ItineraryProblem,
              remaining_ms: int) -> ItinerarySolution | None:
        per_day_ms = max(_MIN_DAY_MS, remaining_ms // max(1, len(problem.days)))
        # 기배정 POI(TRIP-293)는 "이미 앞 일자에서 쓴 것"과 동일 취급 = used 초기값
        used: set[PoiId] = set(problem.excluded_poi_ids)
        days_out: list[DaySolution] = []
        for day in problem.days:
            slots = self._solve_day(problem, day, used, per_day_ms)
            if slots is None:
                return None  # 해 확보 실패 → 체인 다음 단계
            used.update(s.poi_id for s in slots)
            days_out.append(DaySolution(
                date=day, slots=tuple(slots),
                fixed_blocks=placed_fixed_blocks(problem, day, slots),  # TRIP-343
            ))
        return ItinerarySolution(
            schedule_id=problem.schedule_id,
            days=tuple(days_out),
            is_fallback=False,
            solve_mode=SolveMode.OR_TOOLS,
            solver_run=None,
        )

    # ── 일자 단위 CP-SAT ──────────────────────────────────────
    def _solve_day(self, problem, day, used: set[PoiId],
                   budget_ms: int) -> list[VisitSlot] | None:
        tz = problem.day_window.start.tzinfo
        ws, we = _mod(problem.day_window.start), _mod(problem.day_window.end)
        fixed = [fb for fb in problem.fixed_blocks if fb.window.start.date() == day]
        fixed_ids = {fb.poi_id for fb in fixed}

        # 후보 수집 (사용된 것 제외) + 프리필터
        cands = [c for c in problem.candidates
                 if c.poi_id not in used and c.poi_id in self._pois]
        if len(cands) > _PREFILTER_TOP_K:
            cands.sort(key=lambda c: (-c.score, str(c.poi_id)))
            keep = [c for c in cands if c.poi_id in fixed_ids]
            keep += [c for c in cands if c.poi_id not in fixed_ids]
            cands = keep[:_PREFILTER_TOP_K]

        # 노드 구성: 각 노드의 (poi, stay, lo, hi, score, pinned_start)
        nodes = []
        for c in cands:
            poi = self._pois[c.poi_id]
            stay = STAY_DEFAULT_MIN[poi.category]
            win = self._day_open_window(poi, day)
            if win is None:
                continue  # 휴무 — 모델에서 제외
            lo = max(win[0], ws)
            hi = min(win[1], we) - stay
            if lo > hi:
                continue  # 시간창 불가 — 제외
            nodes.append({"poi": poi, "stay": stay, "lo": lo, "hi": hi,
                          "score": c.score, "is_llm": c.is_llm_score, "pin": None})
        for fb in fixed:  # 고정 블록 — 후보에 없어도 노드로 추가, 시각 고정 (HC3)
            poi = self._pois.get(fb.poi_id)
            if poi is None:
                return None
            pin = _mod(fb.window.start)
            stay = int((fb.window.end - fb.window.start).total_seconds() // 60)
            existing = next((n for n in nodes if n["poi"].poi_id == fb.poi_id), None)
            if existing:
                existing.update({"pin": pin, "stay": stay})
            else:
                nodes.append({"poi": poi, "stay": stay, "lo": pin, "hi": pin,
                              "score": 0.0, "is_llm": False, "pin": pin})

        if not nodes:
            return []  # 배치할 것 없음 — 빈 일자 (해 없음 아님)

        k = len(nodes)
        anchor = problem.anchor
        coords = [n["poi"].coord for n in nodes]

        def travel(i: int, j: int) -> int:  # 노드 간 (버퍼 포함 — HC2와 동일 산식)
            return self._est.estimate(coords[i], coords[j],
                                      problem.transport).internal_minutes

        m = cp_model.CpModel()
        visit = [m.NewBoolVar(f"v{i}") for i in range(k)]
        start = [m.NewIntVar(n["lo"], max(n["lo"], n["hi"]), f"s{i}")
                 for i, n in enumerate(nodes)]
        for i, n in enumerate(nodes):
            if n["pin"] is not None:
                m.Add(visit[i] == 1)
                m.Add(start[i] == n["pin"])

        arcs = []
        for i in range(k):
            arcs.append((i + 1, i + 1, visit[i].Not()))
        for i in range(k + 1):
            for j in range(k + 1):
                if i == j:
                    continue
                lit = m.NewBoolVar(f"a{i}_{j}")
                arcs.append((i, j, lit))
                if i == 0 and j >= 1:
                    depart = ws
                    if anchor is not None:
                        depart += self._est.estimate(
                            anchor, coords[j - 1], problem.transport).internal_minutes
                    m.Add(start[j - 1] >= depart).OnlyEnforceIf(lit)
                elif i >= 1 and j >= 1:
                    m.Add(start[j - 1] >= start[i - 1] + nodes[i - 1]["stay"]
                          + travel(i - 1, j - 1)).OnlyEnforceIf(lit)
        m.AddCircuit(arcs)
        obj_terms: list = [int(n["score"] * 1000) * visit[i]
                           for i, n in enumerate(nodes)]
        obj_terms += self._meal_soft_terms(m, nodes, visit, start, arcs)
        obj_terms += self._rain_soft_terms(problem, day, nodes, visit)
        obj_terms += self._event_soft_terms(problem, nodes, visit)
        m.Maximize(sum(obj_terms))

        # 웜스타트 힌트 = 규칙해 (벤치마크 실증 구성)
        hint = self._greedy_hint(problem, day, used)
        id_to_idx = {n["poi"].poi_id: i for i, n in enumerate(nodes)}
        for pid, start_min in hint.items():
            i = id_to_idx.get(pid)
            if i is not None:
                m.AddHint(visit[i], 1)
                m.AddHint(start[i], min(max(start_min, nodes[i]["lo"]),
                                        max(nodes[i]["lo"], nodes[i]["hi"])))

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = min(
            self._cfg.or_tools_limit_ms, budget_ms) / 1000.0
        solver.parameters.random_seed = problem.seed % (2**31)
        solver.parameters.num_search_workers = 1  # 결정론 (FD §4)
        status = solver.Solve(m)
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return None

        slots = []
        base = datetime(day.year, day.month, day.day, tzinfo=tz)
        for i, n in enumerate(nodes):
            if not solver.Value(visit[i]):
                continue
            s_min = solver.Value(start[i])
            slots.append(VisitSlot(
                poi_id=n["poi"].poi_id,
                start_at=base + timedelta(minutes=s_min),
                end_at=base + timedelta(minutes=s_min + n["stay"]),
                stay_min=n["stay"],
                score=n["score"],
                is_llm_score=n["is_llm"],
            ))
        slots.sort(key=lambda s: s.start_at)
        return slots

    def _meal_soft_terms(self, m: cp_model.CpModel, nodes, visit, start,
                         arcs) -> list:
        """식사 시간대 소프트 보정 항 (TRIP-379 — 하드 제약 아님, 목적함수만).

        규칙(폴백 솔버와 동일 의미):
          ① 각 식사 창(점심·저녁)에 FOOD 슬롯이 1개 배치되면 창당 +meal_bonus
          ② 창 밖 FOOD 배치는 건당 -meal_penalty
          ③ FOOD→FOOD 연속 배치(인접 아크)는 건당 -meal_penalty

        스케일 근거: 점수 항이 int(score·1000)이고 score ∈ [0,1]이므로 보정도 같은
        ×1000 축에 얹는다. 기본 보상 300·억제 200은 점수 한 단(0.2~0.3) 크기 —
        취향 점수 갭이 그보다 크면 점수 서열이 그대로 이기고(보정이 취향을 압도 금지),
        동률·근소 갭에서만 배치 시각·순서를 움직인다. 어느 항도 방문 가능성 자체를
        제약하지 않으므로 HC1~4 충족 해 집합은 불변(검증기 무접촉).
        """
        bonus = int(self._cfg.meal_bonus * 1000)
        penalty = int(self._cfg.meal_penalty * 1000)
        food = [i for i, n in enumerate(nodes)
                if n["poi"].category is PoiCategory.FOOD]
        if not food or (bonus == 0 and penalty == 0):
            return []
        terms: list = []
        in_window: dict[int, list] = {i: [] for i in food}
        windows = (self._cfg.lunch_window_min, self._cfg.dinner_window_min)
        for w_idx, (lo, hi) in enumerate(windows):
            lits = []
            for i in food:
                n = nodes[i]
                if n["lo"] > hi - n["stay"] or n["hi"] < lo:
                    continue  # 이 창 안 배치가 시간창상 불가능 — 변수 생략
                b = m.NewBoolVar(f"meal{w_idx}_{i}")
                # b ⇒ (방문 ∧ 슬롯이 창 안에 완전 포함). 역방향 함의는 불필요 —
                # b=1이 보상·감면으로만 작용하므로 유리하면 솔버가 스스로 세운다.
                m.AddImplication(b, visit[i])
                m.Add(start[i] >= lo).OnlyEnforceIf(b)
                m.Add(start[i] + n["stay"] <= hi).OnlyEnforceIf(b)
                lits.append(b)
                in_window[i].append(b)
            if lits:
                r = m.NewBoolVar(f"meal_win{w_idx}")
                m.AddBoolOr(lits).OnlyEnforceIf(r)  # r ⇒ 창에 FOOD ≥ 1
                terms.append(bonus * r)             # ① 창당 1회 보상
        # ② 창 밖 FOOD 억제: 방문 FOOD마다 -penalty, 창 안(b=1)이면 +penalty로 상쇄.
        #    점심·저녁 창이 겹치지 않아 한 노드의 b는 최대 1개만 참 — 과잉 상쇄 없음.
        for i in food:
            terms.append(-penalty * visit[i])
            for b in in_window[i]:
                terms.append(penalty * b)
        # ③ FOOD→FOOD 인접 아크 억제 (아크 (i+1, j+1) ↔ 노드 i→j 직행)
        food_set = set(food)
        for i, j, lit in arcs:
            if (i != j and i >= 1 and j >= 1
                    and i - 1 in food_set and j - 1 in food_set):
                terms.append(-penalty * lit)
        return terms

    def _rain_soft_terms(self, problem, day, nodes, visit) -> list:
        """날씨 소프트 보정 항 (TRIP-383 — 식사 보정(_meal_soft_terms)과 동형).

        규칙(폴백 솔버와 동일 의미): 그 일자 강수확률 ≥ rain_threshold_pct이면
          ① 실외(NATURE·NIGHT_VIEW·ACTIVITY) 방문 건당 -rain_outdoor_penalty
          ② 실내(CULTURE·CAFE·SHOPPING) 방문 건당 +rain_indoor_bonus

        스케일 근거는 식사 보정과 동일 축(점수 항 int(score·1000), score ∈ [0,1]) —
        억제 200·보상 100은 점수 한 단(0.2~0.3) 미만이라 취향 점수 갭이 크면 점수
        서열이 그대로 이기고, 근소 갭에서만 실내로 재배치된다. 하드 배제 아님 —
        방문 가능성 자체를 제약하지 않으므로(목적함수만) HC1~4 충족 해 집합은
        불변(검증기 무접촉). 고정 블록 핀 노드는 visit=1 강제라 상수 오프셋일 뿐
        해에 영향이 없다(HC3 우선).
        """
        rain = problem.daily_rain_prob
        if rain is None:
            return []
        pop = rain.get(day)
        if pop is None or pop < self._cfg.rain_threshold_pct:
            return []  # 정보 없음·임계 미만 — 무보정 (정보 없음 ≠ 배제)
        penalty = int(self._cfg.rain_outdoor_penalty * 1000)
        bonus = int(self._cfg.rain_indoor_bonus * 1000)
        terms: list = []
        for i, n in enumerate(nodes):
            category = n["poi"].category
            if category in RAIN_OUTDOOR and penalty:
                terms.append(-penalty * visit[i])
            elif category in RAIN_INDOOR and bonus:
                terms.append(bonus * visit[i])
        return terms

    def _event_soft_terms(self, problem, nodes, visit) -> list:
        """행사 근접 보너스 항 (TRIP-421 — 날씨 보정(_rain_soft_terms)과 동형).

        problem.event_bonus[poi_id] ∈ [0,1] × event_bonus_scale — **양수만**
        (감점 경로 없음: 행사가 취향에 안 맞으면 보너스 0일 뿐, POI 본연의 점수는
        불변). 하드 배제 아님 — 목적함수만 건드리므로 HC1~4 해 집합 불변.
        """
        bonus = problem.event_bonus
        if not bonus:  # None·빈 맵 — 항 자체가 없다 (종전 동작과 동일)
            return []
        scale = self._cfg.event_bonus_scale
        terms: list = []
        for i, n in enumerate(nodes):
            value = bonus.get(n["poi"].poi_id)
            if value:
                terms.append(int(value * scale * 1000) * visit[i])
        return terms

    def _day_open_window(self, poi: Poi, day) -> tuple[int, int] | None:
        """해당 요일 영업창 (없음=종일, 요일 미포함=휴무). 다중 창은 최장 창 채택
        (보수적 부분집합 — checker의 any-window 판정과 안전하게 정합)."""
        if not poi.open_hours:
            return (0, 1440 * 2)
        todays = [oh for oh in poi.open_hours if oh.day_of_week == day.weekday()]
        if not todays:
            return None
        best = max(todays, key=lambda oh: oh.close_min - oh.open_min)
        return (best.open_min, best.close_min)

    def _greedy_hint(self, problem, day, used: set[PoiId]) -> dict[PoiId, int]:
        # replace()로 재구성한다(TRIP-314): 필드를 일일이 나열하면 ItineraryProblem에
        # 나중에 추가되는 필드를 조용히 떨어뜨려 이 힌트 경로에서만 반영이 사라진다
        # (regenerate가 excluded_poi_ids를 잃은 TRIP-292와 같은 자리). 여기서 바꾸는
        # 것은 "그 하루로 좁히기" 3개뿐이고 seed 포함 나머지는 전부 그대로 이어진다.
        sub = replace(
            problem,
            days=(day,),
            candidates=tuple(c for c in problem.candidates if c.poi_id not in used),
            fixed_blocks=tuple(fb for fb in problem.fixed_blocks
                               if fb.window.start.date() == day),
        )
        greedy = RuleFallbackSolver(self._pois, self._est, self._cfg).solve(sub)
        return {s.poi_id: _mod(s.start_at) for d in greedy.days for s in d.slots}
