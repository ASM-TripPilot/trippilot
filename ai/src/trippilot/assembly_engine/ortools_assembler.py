"""OrToolsAssembler — 체인 1차 단계 (CP-SAT, 미결 #3 확정 · 벤치마크 모델의 정식판).

벤치마크에서 실증된 구성 그대로:
- 그리디(RuleFallbackAssembler) 해를 웜스타트 힌트로 → 단일 워커에서도 즉시 가능해
- 단일 워커 + 시드 고정 = 결정론 (다중 워커는 결정론 붕괴 — audit 2026-07-29 교훈)
- 후보 > 60은 점수 상위 60 프리필터 (이동행렬 O(N²) 방지)

일자별 순차 해결: 잔여 시간을 일자 수로 분할, 앞 일자에서 쓴 POI는 제외.
problem.excluded_poi_ids(다른 호출에서 이미 배정된 POI)는 used 초기값으로 주입한다
— 2단계 생성(day1 먼저 → 나머지)에서 호출 간 중복 방지 (TRIP-293).
INFEASIBLE(고정 블록 모순 등)·UNKNOWN이면 None → 체인 다음 단계 (INV-4).
"""

from __future__ import annotations

import logging
import time
from collections import Counter
from dataclasses import replace
from datetime import datetime, timedelta
from typing import Mapping

from ortools.sat.python import cp_model

from trippilot.assembly_engine.config import (
    RAIN_INDOOR,
    RAIN_OUTDOOR,
    stay_for,
    AssemblyConfig,
)
from trippilot.assembly_engine.fallback_assembler import RuleFallbackAssembler, placed_fixed_blocks
from trippilot.domain.common import PoiId
from trippilot.domain.itinerary import (
    DaySolution,
    ItineraryProblem,
    ItinerarySolution,
    SolveMode,
    VisitSlot,
)
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.poi import Poi, PoiCategory

_log = logging.getLogger(__name__)

_PREFILTER_TOP_K = 60
_MIN_DAY_MS = 100


def prefilter_cut(
    before: list[ScoredPoi], kept: list[ScoredPoi], pois: Mapping[PoiId, Poi]
) -> tuple[Counter, tuple[PoiCategory, ...]]:
    """프리필터가 버린 후보의 카테고리 분포와 **잘려서 0이 된 카테고리** (TRIP-908).

    두 번째 값이 이 관측의 본체다. "식당 0개 풀"(수집 공백 — 설계상 허용, TRIP-379)과
    "식당이 있었는데 상위 N 에서 전부 잘림"(랭킹·상한 문제)은 둘 다 밥 슬롯이 빈 같은
    결과로 수렴하는데, 조치가 정반대다. 전자는 FOOD 가 `before` 에 없어 여기 안 나오고,
    후자만 나온다. `meal_bonus` 는 프리필터 **뒤** 목적함수라 FOOD 후보가 안 남으면 줄
    대상이 없다 — 그래서 총 건수가 아니라 카테고리별 잔존 0 을 본다.

    **프리필터 잔존 기준이다 — 실제 노드 기준이 아니다.** 남은 FOOD 가 전부 휴무·창
    밖이라 노드에서 빠져도 여기엔 안 나오고, 후보 밖 FOOD 고정 블록(식당 예약)이 있어도
    "잔존 0: FOOD" 로 나온다. 이 관측이 가르려는 것은 "프리필터가 잘랐는가" 하나다.
    """
    kept_ids = {c.poi_id for c in kept}
    cut = Counter(pois[c.poi_id].category for c in before if c.poi_id not in kept_ids)
    kept_cats = {pois[c.poi_id].category for c in kept}
    zeroed = tuple(sorted((cat for cat in cut if cat not in kept_cats),
                          key=lambda cat: cat.value))
    return cut, zeroed


def _log_prefilter_cut(day, before, kept, pois) -> None:
    """관측만 한다 — 프리필터 동작은 바꾸지 않는다(카테고리 인지 프리필터는 별건).

    ponytail: 로그로만 남긴다. 응답·`AssemblyRunRecord` 로 내려면 단계 → 퍼사드 통로가
    필요하다(단계는 trace 포트를 모른다) — 로그로 빈도를 본 뒤 필요하면 올린다.
    주의: 앱에 루트 로깅 설정이 없어 uvicorn 기본으로는 `trippilot.*` 의 **INFO 가 안
    나온다**(WARNING 만 나온다 — 잔존 0 신호는 보이고, 분모인 절단 INFO 는 안 보인다).
    요청 로그(`api/middleware.py`)도 같은 처지라 로깅 설정은 별건이다.
    """
    cut, zeroed = prefilter_cut(before, kept, pois)
    by_cat = ", ".join(f"{cat.value}={n}" for cat, n in
                       sorted(cut.items(), key=lambda kv: kv[0].value))
    if zeroed:
        _log.warning(
            "프리필터가 카테고리를 통째로 잘랐다 — 잔존 0: %s (day=%s, 후보 %d → %d, 잘림 %s)",
            ",".join(cat.value for cat in zeroed), day, len(before), len(kept), by_cat)
    else:
        _log.info("프리필터 절단 (day=%s, 후보 %d → %d, 잘림 %s)",
                  day, len(before), len(kept), by_cat)


def _mod(dt: datetime) -> int:
    return dt.hour * 60 + dt.minute


class OrToolsAssembler:
    """ChainStage. required_ms = config.or_tools_min_ms."""

    name = "or_tools"

    def __init__(self, poi_index: Mapping[PoiId, Poi],
                 estimator, config: AssemblyConfig) -> None:
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
        started = time.monotonic()
        for day in problem.days:
            slots = self._solve_day(problem, day, used, per_day_ms)
            if slots is None and problem.pace is not None:
                # **pace 는 소프트 선호다.** 지키려다 해를 못 내면 안 지키는 편이 낫다 —
                # 여기서 포기하면 체인 다음 단계인 규칙 폴백(그리디)으로 내려가고,
                # 그러면 "알차게를 골랐더니 일정이 더 성의 없어졌다"가 된다.
                #
                # 체류 배율은 CP-SAT 인스턴스의 난이도를 바꾼다. 실측(후보 60곳·3초 한도):
                # 무보정은 6/6 성공인데 ×0.9 는 6/6 실패였고, 후보 45곳에서는 반대로
                # ×0.95 가 6/6 실패·×0.9 는 6/6 성공이었다. 즉 "체류가 짧을수록 어렵다"가
                # 아니라 **조합마다 어려운 인스턴스가 따로 있다**(같은 조합은 재현된다).
                # (이 불안정 자체는 pace 와 무관하게 존재한다 — 무보정 기준선도 후보
                #  50곳에서 8/8 해없음이다. 별건으로 재서 정한다: OR 단계가 큰
                #  후보풀에서 해를 못 낸다.)
                # 그래서 안전한 배율을 고르는 것으로는 못 막고, 못 냈을 때 무보정으로
                # 한 번 더 보는 쪽이 맞다 — 이 재시도는 정의상 기준선과 같으므로
                # **pace 를 켜서 기준선보다 나빠지는 경우가 없다.**
                _log.info("pace=%s 로 해 없음 — 무보정 재시도 (day=%s)",
                          problem.pace.value, day)
                # 재시도는 같은 후보를 같은 프리필터로 자른다(pace 는 후보를 안 바꾼다) —
                # 절단 관측을 두 번 남기면 빈도가 두 배로 세진다 (TRIP-908).
                slots = self._solve_day(replace(problem, pace=None), day,
                                        used, per_day_ms, log_cut=False)
            if slots is None:
                # **안 쓴 예산을 실패한 일자에 몰아준다 (TRIP-907).**
                #
                # 퍼사드는 이 단계에 잔여 **전부**를 넘기는데(TRIP-376), `_solve_day`
                # 는 일자당 상한(기본 3초)으로 스스로 자른다. 그래서 하루짜리 요청은
                # 15초를 받아 3초만 쓰고 그리디로 내려간다 — 12초가 그냥 남는다.
                #
                # 실측(후보 50곳·1일): 3초·6초는 3/3 해없음, **12초는 0/3** 이다.
                # 즉 못 푸는 게 아니라 시간이 모자란 것이고, 그 시간은 이미 있다.
                # 상한 자체를 올리지 않는 이유는 위 `_solve_day` 주석에 있다 —
                # 잘 풀리던 요청까지 전부 느려진다.
                # 기준은 `per_day_ms` 가 아니라 **실제로 쓰인 상한**이다 — 하루짜리
                # 요청은 per_day_ms 가 잔여 전부(15초)라 그걸로 비교하면 영원히
                # 거짓이 된다. 실제 CP-SAT 에 들어간 값은 min(상한, per_day) 다.
                used_cap_ms = min(self._cfg.or_tools_limit_ms, per_day_ms)
                spare_ms = remaining_ms - int((time.monotonic() - started) * 1000)
                if spare_ms >= used_cap_ms * 2:
                    _log.info("해 없음 — 남은 예산 %dms 를 몰아 재시도 (day=%s)",
                              spare_ms, day)
                    slots = self._solve_day(replace(problem, pace=None), day, used,
                                            spare_ms, log_cut=False, cap_ms=spare_ms)
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
            assembly_run=None,
        )

    # ── 일자 단위 CP-SAT ──────────────────────────────────────
    def _solve_day(self, problem, day, used: set[PoiId],
                   budget_ms: int, *, log_cut: bool = True,
                   cap_ms: int | None = None) -> list[VisitSlot] | None:
        tz = problem.day_window.start.tzinfo
        ws, we = _mod(problem.day_window.start), _mod(problem.day_window.end)
        fixed = [fb for fb in problem.fixed_blocks if fb.window.start.date() == day]
        fixed_ids = {fb.poi_id for fb in fixed}
        # 다른 날 고정 예약분은 오늘의 자유 후보에서 뺀다 — 안 빼면 같은 POI가
        # 자유(오늘)+고정(그날)으로 두 번 배치된다 (2026-08-21 제주 프로브 실측).
        reserved = {fb.poi_id for fb in problem.fixed_blocks} - fixed_ids

        # 후보 수집 (사용된 것·타일 고정 예약 제외) + 프리필터
        cands = [c for c in problem.candidates
                 if c.poi_id not in used and c.poi_id not in reserved
                 and c.poi_id in self._pois]
        if len(cands) > _PREFILTER_TOP_K:
            cands.sort(key=lambda c: (-c.score, str(c.poi_id)))
            keep = [c for c in cands if c.poi_id in fixed_ids]
            keep += [c for c in cands if c.poi_id not in fixed_ids]
            kept = keep[:_PREFILTER_TOP_K]
            if log_cut:
                _log_prefilter_cut(day, cands, kept, self._pois)
            cands = kept

        # 노드 구성: 각 노드의 (poi, stay, lo, hi, score, pinned_start)
        nodes = []
        for c in cands:
            poi = self._pois[c.poi_id]
            stay = stay_for(poi.category, problem.pace)
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
                # lo·hi 도 함께 고정한다 — 아래 else 가지가 새 노드를 만들 때 쓰는 값과
                # 같아야 한다. 안 맞추면 후보로 계산된 창(`hi = 닫힘 − 기본체류`)이 남고,
                # 그 밖에 pin 이 놓이면 `start[i] == pin` 과 정의역이 모순돼 CP-SAT 이
                # INFEASIBLE 을 낸다 → `_solve_day` None → **그 일자가 아니라 전체 solve**
                # 가 None → 규칙 폴백 강등. 실측: 하루 창 09~21시, SIGHT(기본 75분)이
                # 후보이자 고정일 때 20:00 예약에서 재현(19:00 은 통과 — 경계가 19:45).
                # 고정 블록의 창이 정본이다(HC3) — 후보 기본체류는 여기서 의미가 없다.
                existing.update({"pin": pin, "stay": stay, "lo": pin, "hi": pin})
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
        obj_terms += self._category_soft_terms(problem, day, m, nodes, visit)
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

        cp_solver = cp_model.CpSolver()
        # 일자당 상한. **기본값(3초)은 성공 경로의 지연을 묶는 장치다** — CP-SAT 은
        # 준 시간을 거의 항상 끝까지 쓰므로(후보 20곳에서도 3,003ms 실측) 상한을
        # 올리면 잘 풀리던 요청까지 전부 느려진다. 그래서 상한은 그대로 두고,
        # **해를 못 냈을 때만** 호출측이 `cap_ms` 로 남은 예산을 몰아준다.
        cap = self._cfg.or_tools_limit_ms if cap_ms is None else cap_ms
        cp_solver.parameters.max_time_in_seconds = min(cap, budget_ms) / 1000.0
        cp_solver.parameters.random_seed = problem.seed % (2**31)
        cp_solver.parameters.num_search_workers = 1  # 결정론 (FD §4)
        status = cp_solver.Solve(m)
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return None

        slots = []
        base = datetime(day.year, day.month, day.day, tzinfo=tz)
        for i, n in enumerate(nodes):
            if not cp_solver.Value(visit[i]):
                continue
            s_min = cp_solver.Value(start[i])
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

    def _category_soft_terms(self, problem, day, m: cp_model.CpModel,
                             nodes, visit) -> list:
        """일별 동일 카테고리 체감 페널티 (TRIP-531 — 하드 제약 아님, 목적함수만).

        카테고리별 방문 수가 허용치를 넘는 초과분마다 -category_excess_penalty.
        허용치 = max(category_free_count, ⌈남은 후보 수 ÷ 남은 일수⌉) — 공정 몫
        바닥. 고정 허용치만 쓰면 일 단위 순차 풀이에서 앞날들이 페널티를 피해
        미룬 몫이 마지막 날에 몰린다(청주 08-12 실측: 2/5/7 캐스케이드). 공정 몫
        바닥이면 전량 배치 상황에선 균등 분산을 유도하고, 넉넉한 풀에선 설정값이
        그대로 작동한다 — 원칙: 어셈블리는 풀 비중 이상으로 증폭하지 않는다(그 이상의
        다양성은 수집·풀 구성 책임). 식사 보정과 직교 — 그쪽은 FOOD의 시각·인접,
        이쪽은 전 카테고리의 **개수**. 어느 항도 방문 가능성 자체를 제약하지
        않으므로 HC1~4 충족 해 집합은 불변(검증기 무접촉). 초과 변수는 하한만
        걸어도 Maximize가 스스로 바닥 max(0, count-허용치)에 붙는다.
        """
        penalty = int(self._cfg.category_excess_penalty * 1000)
        if penalty == 0:
            return []
        remaining_days = max(1, sum(1 for d in problem.days if d >= day))
        by_cat: dict[PoiCategory, list[int]] = {}
        for i, n in enumerate(nodes):
            by_cat.setdefault(n["poi"].category, []).append(i)
        terms: list = []
        for cat, idxs in sorted(by_cat.items(), key=lambda kv: kv[0].value):
            free = max(self._cfg.category_free_count,
                       -(-len(idxs) // remaining_days))  # ceil
            if len(idxs) <= free:
                continue  # 초과 불가능 — 변수 생략
            excess = m.NewIntVar(0, len(idxs) - free, f"catx_{cat.value}")
            m.Add(excess >= sum(visit[i] for i in idxs) - free)
            terms.append(-penalty * excess)
        return terms

    def _meal_soft_terms(self, m: cp_model.CpModel, nodes, visit, start,
                         arcs) -> list:
        """식사 시간대 소프트 보정 항 (TRIP-379 — 하드 제약 아님, 목적함수만).

        규칙(폴백 어셈블리와 동일 의미):
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
                # b=1이 보상·감면으로만 작용하므로 유리하면 어셈블리가 스스로 세운다.
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

        규칙(폴백 어셈블리와 동일 의미): 그 일자 강수확률 ≥ rain_threshold_pct이면
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
        greedy = RuleFallbackAssembler(self._pois, self._est, self._cfg).solve(sub)
        return {s.poi_id: _mod(s.start_at) for d in greedy.days for s in d.slots}
