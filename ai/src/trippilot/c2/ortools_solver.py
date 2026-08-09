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

from trippilot.c2.config import STAY_DEFAULT_MIN, SolverConfig
from trippilot.c2.fallback_solver import RuleFallbackSolver
from trippilot.domain.common import PoiId
from trippilot.domain.itinerary import (
    DaySolution,
    ItineraryProblem,
    ItinerarySolution,
    SolveMode,
    VisitSlot,
)
from trippilot.domain.poi import Poi

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
            days_out.append(DaySolution(date=day, slots=tuple(slots), fixed_blocks=()))
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
        m.Maximize(sum(int(n["score"] * 1000) * visit[i] for i, n in enumerate(nodes)))

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
