"""OrToolsAssembler — 체인 1차 단계 (CP-SAT, 미결 #3 확정 · 벤치마크 모델의 정식판).

구성:
- 그리디(RuleFallbackAssembler) 해의 방문 순서를 **완전** 힌트로(`_hint_path`) + 하루
  용량 컷(`_capacity_cut`) → 첫 해가 힌트에서 바로 나온다 (TRIP-1176). 종전처럼
  visit·start 만 힌트하면 CP-SAT 이 ~20ms 만에 힌트를 버려 이 문장이 성립하지 않았다
- 단일 워커 + 시드 고정 + 결정론 시간 한도 = 결정론 (다중 워커는 결정론 붕괴 — audit
  2026-07-29 교훈. 벽시계 한도는 부하에 따라 멈추는 지점이 달라 백스톱으로만 쓴다)
- 후보 > 60은 60 프리필터 (이동행렬 O(N²) 방지) — 고정 블록 → FOOD 예약석(아직 닿는 식사창
  수) → 점수순, 남긴 집합은 점수순+poi_id 로 재정렬 (`_prefilter`, TRIP-1183)
- 해(A) 뒤 재정렬(B, `_reorder`): 방문 집합·A 목적값을 고정하고 도로 거리만 최소화 —
  같은 집합 안의 왕복·튐 제거 (TRIP-1178)

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
from trippilot.assembly_engine.constraints import anchor_minutes, not_before_floor
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
from trippilot.domain.poi import Poi, PoiCategory, counts_as_food

_log = logging.getLogger(__name__)

_PREFILTER_TOP_K = 60
_MIN_DAY_MS = 100
# 실패한 일자에 몰아주는 재시도(TRIP-907)의 상한. 잔여 **전부**를 넘기면 deadline 미지정
# 요청(wiring UNBOUNDED_DEADLINE_MS=600초)에서 해 없는 하루가 CP-SAT 에 ~590초를 쓴다
# (QA 실측: generate 601초). 이 값은 재시도의 **벽시계 백스톱**이고, 재시도의 탐색량은
# 결정론 한도 × `_RETRY_DET_FACTOR`(기본 2.0×5 = 10)다. 이 안에 못 풀면 체인 다음 단계
# (그리디)로 내려간다. (종전 근거 "12초면 0/3 해없음 → 시간 문제" 는 틀린 진단이었다 —
# 원인은 불완전 힌트·무의미한 상계, TRIP-1176.)
SPARE_RETRY_CAP_MS = 15_000
# 재시도 탐색량 배수. 벽시계 상한의 비율로 정하지 않는다 — 그러면 백스톱
# (`or_tools_limit_ms`)을 올릴 때 재시도 탐색량이 조용히 준다(3000 → 7000 이면 ×5 → ×2.1).
# 결정론인 것은 det×5 의 벽시계 소요가 재시도 상한 안에 들 때뿐이다: 한 코어에서 det 10 ≈
# 8.4초로 들지만, CPU 0.5 몫에선 14~27초(wall/det 1.4~2.75)라 백스톱이 먼저 끊는다.
_RETRY_DET_FACTOR = 5
# 재정렬(B 단계, TRIP-1178)의 결정론 한도. 방문이 고정돼 하루 ≤ 십여 노드의 경로 문제라
# 실측 det ≤ 0.003 에 OPTIMAL 이다(부산·서울 234회) — 0.5 는 넉넉한 상한이다.
_REORDER_DET_LIMIT = 0.5


def drop_food_runs(order: list[int], nodes) -> list[int]:
    """웜스타트 힌트 순서에서 FOOD→FOOD 연속을 뺀다 — 고정 블록(pin) 노드는 절대 빼지 않는다.

    그리디(규칙 폴백)는 하루 끝에 FOOD 만 남으면 식당 뒤에 식당을 그대로 놓고, 그 순서가 완전
    힌트(TRIP-1176)로 들어가면 결정론 한도 안의 탐색이 거기서 못 벗어난다(2026-10-04 홍천 실측
    18:36 치킨 → 19:52 쭈꾸미 — 최적해라면 둘째를 빼는 게 늘 이득인데 남았다). 힌트는 출발점일
    뿐이라 방문 하나를 빼도 정확성과 무관하다(경로에서 노드를 빼면 이동만 준다). 연속 판정은
    ③ 인접 억제(`_meal_soft_terms`)와 같은 기준 — `PoiCategory.FOOD`. 둘 다 고정이면 둔다.
    """
    kept: list[int] = []
    for i in order:
        is_food = nodes[i]["poi"].category is PoiCategory.FOOD
        prev = kept[-1] if kept else None
        if (is_food and prev is not None
                and nodes[prev]["poi"].category is PoiCategory.FOOD):
            if nodes[i]["pin"] is None:
                continue                  # 뒤의 자유 FOOD 를 뺀다
            if nodes[prev]["pin"] is None:
                kept.pop()                # 뒤가 고정이면 앞의 자유 FOOD 를 뺀다
        kept.append(i)
    return kept


def prefilter_cut(
    before: list[ScoredPoi], kept: list[ScoredPoi], pois: Mapping[PoiId, Poi]
) -> tuple[Counter, tuple[PoiCategory, ...]]:
    """프리필터가 버린 후보의 카테고리 분포와 **잘려서 0이 된 카테고리** (TRIP-908).

    두 번째 값이 이 관측의 본체다. "식당 0개 풀"(수집 공백 — 설계상 허용, TRIP-379)과
    "식당이 있었는데 상위 N 에서 전부 잘림"(랭킹·상한 문제)은 둘 다 밥 슬롯이 빈 같은
    결과로 수렴하는데, 조치가 정반대다. 전자는 FOOD 가 `before` 에 없어 여기 안 나오고,
    후자만 나온다. `meal_bonus` 는 프리필터 **뒤** 목적함수라 FOOD 후보가 안 남으면 줄
    대상이 없다 — 그래서 총 건수가 아니라 카테고리별 잔존 0 을 본다. 식사창 예약석
    (TRIP-1183) 뒤로 FOOD 가 잔존 0 이 되는 것은 식사창에 놓일 영업 FOOD 가 없거나, 재계획
    하한이 식사창을 다 지났거나, 보정 off 일 때뿐이다.

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
    """관측만 한다 — 프리필터 동작은 바꾸지 않는다(FOOD 예약석은 `_prefilter`).

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


def _not_before_min(problem: ItineraryProblem, day) -> int | None:
    """그 일자 비고정 노드의 시작 하한(분) — 그리디(`not_before_floor` 절대 시각)와 같은 규칙.

    하한이 뒷날이면 그날 자유 방문은 없다(어떤 노드 hi 보다도 큰 값), 앞날이면 무제한(None).
    """
    nb = not_before_floor(problem)
    if nb is None:
        return None
    tz = problem.day_window.start.tzinfo
    if tz is not None:
        nb = nb.astimezone(tz)
    if nb.date() > day:
        return 1440 * 2 + 1
    return _mod(nb) if nb.date() == day else None


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
                # 아니라 **조합마다 어려운 인스턴스가 따로 있다**(같은 조합은 대부분
                # 재현됐다 — 벽시계 한도라 일부는 None↔해가 뒤집혔다).
                # (이 불안정 자체는 pace 와 무관하게 존재했다 — 무보정 기준선도 후보
                #  50곳에서 8/8 해없음이었다. 원인은 불완전 힌트·무의미한 상계였고
                #  TRIP-1176 에서 고쳤다 — 위 수치는 그 전 실측이다. 같은 하네스로
                #  재면 후보 45·50·60곳 × pace 3값 모두 해없음 0 이다.)
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
                # 는 일자당 상한(당시 기본 3초)으로 스스로 자른다. 그래서 하루짜리 요청은
                # 15초를 받아 3초만 쓰고 그리디로 내려갔다 — 12초가 그냥 남았다.
                #
                # 종전 근거("후보 50곳: 3·6초 해없음, 12초 0/3 → 시간이 모자란 것")는
                # 틀린 진단이었다. 원인은 불완전 힌트·무의미한 상계였고(TRIP-1176), 그걸
                # 고친 뒤 실 덤프 39건에서 1차 실패는 0 이다. 그래서 지금 이 재시도는
                # 드문 실패(경로 완성 실패로 부분 힌트가 된 경우 등)의 **안전장치**다.
                #
                # 탐색을 멈추는 것이 결정론 한도라서, **같은 한도로 다시 돌면 1차와
                # 똑같은 탐색을 반복해 같은 None 이 나온다**(측정: 실 덤프 39건을 힌트
                # 없이 det 0.1 로 1차 실패시켰을 때 같은 한도 재시도 구제 0/39, ×5 한도
                # 36/39). 그래서 한도를 고정 배수(`_RETRY_DET_FACTOR`)로 키운다 — 남은
                # 예산 비율로 키우면 벽시계가 다시 결과를 정한다. 재시도도 결정론인 것은
                # 그 탐색량의 벽시계 소요가 재시도 상한 안에 들 때뿐이다(한 코어 기준).
                # 아래 문턱(잔여 ≥ 일자 상한 ×2, 기본 14초)이 그 소요(한 코어 det 10 ≈
                # 8.4초)를 덮는다 — 잔여 6~8초에서 돌아 백스톱에 끊기는 재시도를 막는다.
                # 1차 한도를 올리지 않는 이유: 한도는 성공 경로에서도 끝까지 쓰인다(실
                # 덤프 78회 OPTIMAL 증명 0) — 올리면 잘 풀리던 요청까지 전부 느려진다.
                # 기준은 `per_day_ms` 가 아니라 **실제로 쓰인 상한**이다 — 하루짜리
                # 요청은 per_day_ms 가 잔여 전부(15초)라 그걸로 비교하면 영원히
                # 거짓이 된다. 실제 CP-SAT 에 들어간 값은 min(상한, per_day) 다.
                used_cap_ms = min(self._cfg.or_tools_limit_ms, per_day_ms)
                spare_ms = remaining_ms - int((time.monotonic() - started) * 1000)
                if spare_ms >= used_cap_ms * 2:
                    retry_ms = min(spare_ms, SPARE_RETRY_CAP_MS)
                    _log.info("해 없음 — 남은 예산 %dms 중 %dms 를 몰아 재시도 (day=%s)",
                              spare_ms, retry_ms, day)
                    slots = self._solve_day(replace(problem, pace=None), day, used,
                                            retry_ms, log_cut=False, cap_ms=retry_ms,
                                            det_limit=self._retry_det_limit())
                    if slots is None:  # 침묵 금지(INV-4) — 퍼사드 no_solution 과 짝
                        _log.warning("몰아 재시도도 상한 %dms·결정론 한도 %.1f 안에 해 없음"
                                     " — 다음 단계로 (day=%s, 남은 예산 %dms)",
                                     retry_ms, self._retry_det_limit(), day, spare_ms)
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

    def _retry_det_limit(self) -> float:
        """몰아 재시도(TRIP-907)의 결정론 한도 = 1차 한도 × 고정 배수."""
        return self._cfg.or_tools_det_limit * _RETRY_DET_FACTOR

    # ── 일자 단위 CP-SAT ──────────────────────────────────────
    def _solve_day(self, problem, day, used: set[PoiId],
                   budget_ms: int, *, log_cut: bool = True,
                   cap_ms: int | None = None,
                   det_limit: float | None = None) -> list[VisitSlot] | None:
        day_started = time.monotonic()
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
        floor = _not_before_min(problem, day)
        if len(cands) > _PREFILTER_TOP_K:
            food_stay = stay_for(PoiCategory.FOOD, problem.pace)
            kept = self._prefilter(cands, fixed_ids, day,
                                   self._meal_slots(ws, we, floor, food_stay), food_stay)
            if log_cut:
                _log_prefilter_cut(day, cands, kept, self._pois)
            cands = kept

        # 노드 구성: 각 노드의 (poi, stay, lo, hi, score, pinned_start)
        # 해 품질은 노드 **순서**에 의존한다 — 증명 없이 결정론 한도에서 FEASIBLE 로 끝나서,
        # 같은 집합이라도 순서가 바뀌면 다른(더 나쁠 수 있는) 해가 나온다(부산 실측 −13%).
        nodes = []
        # 비고정 방문 시작 하한 (TRIP-1182). 정의역만 좁힌다. 후보이자 고정인 노드엔 걸지
        # 않는다 — 아래에서 lo=hi=pin 으로 덮이는데, 하한이 그 hi 를 넘어 여기서 빠지면 고정
        # 루프가 점수 0 노드로 다시 만들어 슬롯 점수가 바뀐다(재계획은 잠금 POI 가 후보에 합류).
        for c in cands:
            poi = self._pois[c.poi_id]
            stay = stay_for(poi.category, problem.pace)
            win = self._day_open_window(poi, day)
            if win is None:
                continue  # 휴무 — 모델에서 제외
            lo = max(win[0], ws)
            if floor is not None and c.poi_id not in fixed_ids:
                # 하한 시각에 지금 위치(앵커)에서 출발 — 정의역만 좁힌다(용량 컷 유효)
                lo = max(lo, floor + anchor_minutes(problem, poi, self._est))
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

        # 앵커 → 노드 이동. 핀은 앵커 출발을 따지지 않으므로 0 (아래 깊이0 아크 주석).
        from_anchor = [0 if anchor is None or n["pin"] is not None
                       else self._est.estimate(anchor, coords[j],
                                               problem.transport).internal_minutes
                       for j, n in enumerate(nodes)]
        inc = list(from_anchor)  # 들어오는 이동 하한(용량 컷) — 아크를 만들며 줄인다

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
                # 핀(고정 블록)은 앵커 출발을 따지지 않는다 — 블록 자신의 시각이 기준이다.
                # 그리디(시각 그대로 배치)·검증기(check_hc2 는 앵커→첫 슬롯을 안 본다)와
                # 같은 규칙. 걸면 BE 가 창 시작에 핀한 필수방문이 앵커가 있는 한 항상
                # INFEASIBLE → 그 호출 전체가 규칙 폴백으로 떨어졌다(TRIP-1175).
                if i == 0 and j >= 1 and nodes[j - 1]["pin"] is None:
                    m.Add(start[j - 1] >= ws + from_anchor[j - 1]).OnlyEnforceIf(lit)
                elif i >= 1 and j >= 1:
                    t = travel(i - 1, j - 1)
                    inc[j - 1] = min(inc[j - 1], t)
                    m.Add(start[j - 1] >= start[i - 1] + nodes[i - 1]["stay"]
                          + t).OnlyEnforceIf(lit)
        m.AddCircuit(arcs)
        self._capacity_cut(m, nodes, visit, inc, ws, we)
        obj_terms: list = [int(n["score"] * 1000) * visit[i]
                           for i, n in enumerate(nodes)]
        obj_terms += self._meal_soft_terms(m, nodes, visit, start, arcs)
        obj_terms += self._rain_soft_terms(problem, day, nodes, visit)
        obj_terms += self._event_soft_terms(problem, nodes, visit)
        obj_terms += self._category_soft_terms(problem, day, m, nodes, visit)
        obj_terms += self._food_cap_terms(m, nodes, visit)
        m.Maximize(sum(obj_terms))

        cap = self._cfg.or_tools_limit_ms if cap_ms is None else cap_ms
        cp_solver = cp_model.CpSolver()
        # 탐색을 멈추는 것은 **결정론 시간 한도**다(TRIP-1176) — 벽시계는 부하에 따라
        # 같은 입력에서 다른 해·None 을 냈다(실측 반복 동일 28/30). 벽시계(일자당 상한)는
        # 지연을 묶는 백스톱으로만 남는다. **결정론은 벽시계 몫 ≥ det 소요일 때만**이다 —
        # 일자 몫(잔여 ÷ 일수)이 작거나 CPU 가 모자라 백스톱이 먼저 걸리면 깨지고, 아래
        # 경고가 그걸 남긴다(config `or_tools_limit_ms` 주석의 실측).
        det_cap = self._cfg.or_tools_det_limit if det_limit is None else det_limit
        wall_cap_s = min(cap, budget_ms) / 1000.0
        cp_solver.parameters.max_deterministic_time = det_cap
        cp_solver.parameters.max_time_in_seconds = wall_cap_s
        cp_solver.parameters.random_seed = problem.seed % (2**31)
        cp_solver.parameters.num_search_workers = 1  # 결정론 (FD §4)

        # 웜스타트 = 그리디 해의 방문 **순서**를 완전 힌트로 (TRIP-1176)
        hint = self._greedy_hint(problem, day, used)
        id_to_idx = {n["poi"].poi_id: i for i, n in enumerate(nodes)}
        order = drop_food_runs([id_to_idx[pid] for pid, _ in sorted(
            hint.items(), key=lambda kv: (kv[1], str(kv[0]))) if pid in id_to_idx], nodes)
        self._hint_path(m, order, visit, arcs, cp_solver)
        status = cp_solver.Solve(m)
        resp = cp_solver.ResponseProto()
        if (status in (cp_model.FEASIBLE, cp_model.UNKNOWN)
                and resp.deterministic_time < det_cap):
            # 증명도 결정론 한도도 아닌데 멈췄다 = 벽시계 백스톱. 운영 CPU 0.5 몫·동시
            # 요청에서 생긴다 — 잦으면 det 를 내리지 말고 requests.cpu 를 올린다.
            _log.warning("결정론 한도 전에 벽시계 백스톱으로 끊김 — 같은 입력도 부하에 따라"
                         " 다른 해가 된다 (day=%s, det %.2f/%.2f, 벽시계 %.2fs/%.2fs)",
                         day, resp.deterministic_time, det_cap, resp.wall_time, wall_cap_s)
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return None
        # B 의 벽시계 백스톱은 고정이다 — A 가 결정론으로 끝났는데 일자 몫이 남았는지로 B 를
        # 가르면 같은 입력이 부하에 따라 다른 순서가 된다(리뷰 실측: A 밖 소요 41~51ms 라 몫
        # 경계 ±수십 ms 에서 채택이 뒤집혔다). A 가 이미 백스톱에 끊겼으면(부하 의존·위 경고)
        # 그때만 일자 몫이 남은 만큼 쓴다.
        reorder_ms = self._cfg.or_tools_reorder_ms
        if status == cp_model.FEASIBLE and resp.deterministic_time < det_cap:
            left_ms = budget_ms - int((time.monotonic() - day_started) * 1000)
            reorder_ms = min(reorder_ms, left_ms)
        cp_solver = self._reorder(m, cp_solver, problem, visit, start, arcs,
                                  obj_terms, coords, reorder_ms)

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

    def _reorder(self, m: cp_model.CpModel, a_solver: cp_model.CpSolver, problem,
                 visit, start, arcs, obj_terms, coords, wall_ms: int) -> cp_model.CpSolver:
        """B 단계 — A 해의 방문 집합을 고정하고 이동 거리만 줄인다 (TRIP-1178).

        목적함수에 이동 비용이 없어(이동은 HC2 시각 제약뿐) 같은 집합 안의 순서가 탐색 경로로
        정해졌다 — 왕복·튐(QA 부산 1일차 37.7km). 이동 항을 A 에 섞으면 선택이 잡음처럼
        흔들리고 해 없음까지 갔다(λ 실측). 그래서 사전식이다: visit = A 값, A 목적식 ≥ A
        목적값(식사 창 보상 등 소프트 항 유지) 아래 도로 거리(앵커 출발·복귀 포함 — 측정 축과
        같다) 합 최소. 실측(#846 위): 실 덤프 39일 하루 km 합 서울 −17.6%·부산 −19.0%(최대
        −44.8%, 늘어난 날 0), 집합·점수 손실 0, HC 0, 39/39 OPTIMAL, B 최대 36ms. 합성 풀
        (LLM 유사 점수)에서도 서울 −19.9%·부산 −14.3%.

        거리만 최소화하면 시각은 여유 안에서 아무 값이나 돼 대기가 끼었다(실 덤프 39일 대기
        18 → 514분, 하루 최대 80분 — 전부 09시 영업이라 강제된 대기가 아니다). 그래서 Σ시작
        시각을 사전식 타이브레이크로 둔다: 거리 1m 가 Σ시작의 최대치보다 무거워(W) km 최적은
        그대로고, 같은 km 안에서 이른 시각을 고른다(측정: km 동일, 대기 514 → 35분).

        **OPTIMAL 일 때만 채택한다** — 결정론 한도·벽시계에 끊긴 FEASIBLE 은 부하에 따라
        달라질 수 있어서다. 못 쓰면 A 해 그대로(강등 아님 — OR_TOOLS 그대로) + WARNING.
        `wall_ms` ≤ 0 이면 돌리지 않는다(설정 0, 또는 A 가 백스톱에 끊기고 일자 몫도 없음).
        """
        vals = [a_solver.Value(v) for v in visit]
        if wall_ms <= 0 or sum(vals) < 2:
            return a_solver
        order = sorted((i for i, v in enumerate(vals) if v),
                       key=lambda i: (a_solver.Value(start[i]), i))
        for v, val in zip(visit, vals):
            m.Add(v == val)
        m.Add(sum(obj_terms) >= int(round(a_solver.ObjectiveValue())))
        on = {0, *(i + 1 for i in order)}  # 비방문 노드의 아크는 회로상 0 — 항이 필요 없다
        meters = []
        for i, j, lit in arcs:
            a = coords[i - 1] if i else problem.anchor
            b = coords[j - 1] if j else problem.anchor
            if i == j or i not in on or j not in on or a is None or b is None:
                continue
            road_km = self._est.estimate(a, b, problem.transport).distance_km_range[1]
            meters.append(int(round(road_km * 1000)) * lit)
        w = 24 * 60 * len(order) + 1  # > Σ시작 최대(분) — 시각은 거리 동률일 때만 가른다
        m.Minimize(w * sum(meters) + sum(start[i] for i in order))
        solver = cp_model.CpSolver()
        solver.parameters.max_deterministic_time = _REORDER_DET_LIMIT
        solver.parameters.max_time_in_seconds = wall_ms / 1000.0
        solver.parameters.random_seed = problem.seed % (2**31)
        solver.parameters.num_search_workers = 1
        m.ClearHints()
        self._hint_path(m, order, visit, arcs, solver)  # 변수 추가 없음 — A 순서가 완전 힌트
        if solver.Solve(m) == cp_model.OPTIMAL:
            return solver
        # det 가 한도 전이면 벽시계 백스톱이 끊은 것이다 — A 의 백스톱 경고와 같은 처지.
        _log.warning("재정렬 미채택 — OPTIMAL 아님, A 순서 그대로. det 가 한도 전이면 벽시계"
                     " 백스톱 — 같은 입력도 부하에 따라 다른 해가 된다 (det %.3f/%.1f, 벽시계"
                     " %dms)", solver.ResponseProto().deterministic_time, _REORDER_DET_LIMIT,
                     wall_ms)
        return a_solver

    @staticmethod
    def _hint_path(m: cp_model.CpModel, order: list[int], visit, arcs,
                   solver: cp_model.CpSolver) -> None:
        """노드 방문 순서 → **완전** 힌트 (TRIP-1176).

        종전엔 그리디 해의 visit=1·start 만 힌트했다(실 덤프 3,658 변수 중 10개). CP-SAT 은
        나머지(비방문 visit·아크 ~k²·소프트 항 보조 변수)를 hint_conflict_limit 안에 못
        채우고 ~20ms 만에 힌트를 버렸다("The solution hint is incomplete") — 그 뒤는
        힌트 없는 탐색이라 실행가능한 그리디 해가 있어도 3초 안에 해 0개였다.

        그래서 경로(방문·아크 리터럴)를 가정으로 걸고 한 번 풀어 시각·보조 변수까지 채운
        해를 통째로 힌트한다 — 경로가 고정되면 남는 건 시각 전파와 소수의 보조 불리언이라
        수 ms 다. 보조 변수를 손으로 계산하지 않으므로 소프트 항이 늘어도 완성이 성공하는 한
        힌트가 다시 불완전해지지 않는다. 이 힌트가 주는 것은 "그 순서의 최적 완성에서 출발" 까지다 —
        최종 해가 그리디 이상이라는 **보장은 아니다**(노드에 투영한 순서라 프리필터로 빠진
        POI 몫이 없고, 완성이 실패하면 아래 부분 힌트로 내려가며, 백스톱에 걸리면 탐색이
        중간에 끊긴다).

        경로가 모델과 어긋나면(예: 다중 영업창 — 모델은 최장 창만 쓰는데 그리디는 다른 창에
        놓았을 수 있다) 완성이 INFEASIBLE 이다. 그때는 경로 리터럴만 힌트한다(부분 힌트 — 탐색 방향만).

        빈 순서면 힌트를 걸지 않는다. 그리디는 영업 시작을 기다리지 않아(도착 시 닫혀 있으면
        버린다) 모델은 가해인데 그리디는 빈 날이 생긴다. 그 경로 완성은 반드시 INFEASIBLE 이고
        (AddCircuit 은 깊이0 자기루프가 없어 빈 회로 불가), 부분 힌트는 '전부 0' — 모델과
        모순이고 불완전하다. 힌트가 없는 편이 낫다(실 덤프는 용량 컷만으로도 풀린다).
        """
        if not order:
            return
        k = len(visit)
        on = set(order)
        path = [0, *(i + 1 for i in order), 0]
        succ = set(zip(path, path[1:]))
        # arcs[:k] 는 자기루프 (i+1, i+1, ¬visit[i]) — visit 와 같은 변수라 아크로 다시
        # 힌트하면 이중 힌트(MODEL_INVALID). visit 로 한 번, 아크는 arcs[k:] 만.
        lits = [visit[i] if i in on else visit[i].Not() for i in range(k)]
        lits += [lit if (a, b) in succ else lit.Not() for a, b, lit in arcs[k:]]
        m.AddAssumptions(lits)
        status = solver.Solve(m)
        m.ClearAssumptions()
        if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            for idx, value in enumerate(solver.ResponseProto().solution):
                m.AddHint(m.GetIntVarFromProtoIndex(idx), value)
            return
        for i in range(k):
            m.AddHint(visit[i], i in on)
        for a, b, lit in arcs[k:]:
            m.AddHint(lit, (a, b) in succ)

    @staticmethod
    def _capacity_cut(m: cp_model.CpModel, nodes, visit, inc: list[int],
                      ws: int, we: int) -> None:
        """하루 용량 컷 (TRIP-1176 — **중복 제약**: 모델의 실행가능 해 집합 불변).

        방문 순서 j1..jn 에서 첫 노드는 origin + inc 이후, 다음 노드는 앞 노드 끝 + 이동
        (≥ inc) 이후 시작하고 마지막 노드는 horizon 안에 끝난다 → Σ(체류 + inc)·visit ≤
        horizon − origin. inc_j = min(앵커 몫, 다른 노드에서 오는 이동 최소)이고 **핀의
        앵커 몫은 0** 이다 — 핀은 앵커 출발을 면제받는다(TRIP-1175). 여기에 앵커 이동을
        얹으면 창 시작에 핀된 첫 방문이 있는 하루에서 실행가능한 해를 잘라낸다.
        origin·horizon 은 핀이 창 밖에 걸칠 때 그 끝까지 넓힌다.

        왜 필요한가: 이 식이 없으면 LP 상계가 '전 후보 점수 합'이라(실 덤프 41,880 vs
        실제 해 4,000~5,500) 탐색이 하루에 안 들어가는 '많이 방문' 가지로 간다.

        시작 하한(`not_before`, TRIP-1182)이 있어도 그대로 유효하다 — 하한은 비고정 노드의
        정의역을 좁히기만 해서 그 모델의 해는 하한 없는 모델의 해이기도 하고, 이 식은 그
        모든 해에 성립한다. origin 을 하한으로 당기지 않는 것은 하한 앞의 핀도 세기 때문이다.
        """
        pins = [n for n in nodes if n["pin"] is not None]
        origin = min([ws] + [n["pin"] for n in pins])
        horizon = max([we] + [n["pin"] + n["stay"] for n in pins])
        m.Add(sum((n["stay"] + inc[j]) * visit[j] for j, n in enumerate(nodes))
              <= horizon - origin)

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

    def _food_cap_terms(self, m: cp_model.CpModel, nodes, visit) -> list:
        """FOOD 하루 상한 — 초과 1곳당 -food_excess_penalty (목적함수만, config 주석).

        위 카테고리 항과 같은 꼴이되 허용치에 공정 몫 바닥이 없다 — days=1 일자별 호출에서도
        켜져 있어야 해서다. 핀(고정 블록) 노드도 센다(카테고리 항의 len(idxs) 와 같은 기준).
        """
        penalty = int(self._cfg.food_excess_penalty * 1000)
        cap = self._cfg.food_daily_max
        idxs = [i for i, n in enumerate(nodes) if counts_as_food(n["poi"])]
        if penalty == 0 or len(idxs) <= cap:
            return []
        excess = m.NewIntVar(0, len(idxs) - cap, "foodx")
        m.Add(excess >= sum(visit[i] for i in idxs) - cap)
        return [-penalty * excess]

    def _meal_soft_terms(self, m: cp_model.CpModel, nodes, visit, start,
                         arcs) -> list:
        """식사 시간대 소프트 보정 항 (TRIP-379 — 하드 제약 아님, 목적함수만).

        규칙(폴백 어셈블리와 동일 의미):
          ① 각 식사 창(점심·저녁)에 FOOD 슬롯이 1개 배치되면 창당 +meal_bonus
          ② 창 밖 FOOD 배치는 건당 -meal_penalty (같은 창 두 번째 FOOD 도 창 밖 취급 —
             상쇄는 창당 1곳)
          ③ FOOD→FOOD 연속 배치(인접 아크)는 건당 -food_adjacent_penalty (기본 1.0 — 점수 축
             전체라 ①② 의 "한 단 미만" 원칙의 예외, config 주석)

        스케일 근거: 점수 항이 int(score·1000)이고 score ∈ [0,1]이므로 보정도 같은
        ×1000 축에 얹는다. 기본 보상 300·억제 200은 점수 한 단(0.2~0.3) 크기 —
        취향 점수 갭이 그보다 크면 점수 서열이 그대로 이기고(보정이 취향을 압도 금지),
        동률·근소 갭에서만 배치 시각·순서를 움직인다. 어느 항도 방문 가능성 자체를
        제약하지 않으므로 HC1~4 충족 해 집합은 불변(검증기 무접촉).
        """
        bonus = int(self._cfg.meal_bonus * 1000)
        penalty = int(self._cfg.meal_penalty * 1000)
        adjacent = int(self._cfg.food_adjacent_penalty * 1000)
        food = [i for i, n in enumerate(nodes)
                if n["poi"].category is PoiCategory.FOOD]
        if not food or (bonus == 0 and penalty == 0 and adjacent == 0):
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
                # 상쇄 자격은 창당 1곳 — b 는 ① 보상의 근거이자 ② 상쇄의 자격이다. 걸지 않으면
                # 같은 창 두 번째 FOOD 도 ② 를 상쇄받아 비용이 ③ 뿐이었다(QA 6회차 실측). b 만
                # 묶으므로 방문(visit)은 그대로 자유 — HC1~4 해 집합 불변.
                m.AddAtMostOne(lits)
                r = m.NewBoolVar(f"meal_win{w_idx}")
                m.AddBoolOr(lits).OnlyEnforceIf(r)  # r ⇒ 창에 FOOD ≥ 1
                terms.append(bonus * r)             # ① 창당 1회 보상
        # ② 창 밖 FOOD 억제: 방문 FOOD마다 -penalty, 창 안(b=1, 창당 1곳)이면 +penalty로 상쇄.
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
                terms.append(-adjacent * lit)
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

    def _meal_slots(self, ws: int, we: int, floor: int | None,
                    food_stay: int) -> list[tuple[int, int]]:
        """예약석이 노릴 식사창 — 하루 창·재계획 하한(`floor`)으로 잘라 FOOD 체류가 아직 들어가는
        창만. 하한이 두 창을 다 지나면 빈 목록(폴백도 그 구간에선 food-first 를 끈다).
        `meal_bonus == 0`(식사 보정 off)이면 빈 목록 — 보상이 없으면 점수 높은 후보를 밀어낼
        이유가 없다(폴백의 food-first 는 가중과 무관하게 돌지만, 그 구성은 운영값이 아니다)."""
        if self._cfg.meal_bonus <= 0:
            return []
        start = ws if floor is None else max(ws, floor)
        slots = [(max(lo, start), min(hi, we))
                 for lo, hi in (self._cfg.lunch_window_min, self._cfg.dinner_window_min)]
        return [(lo, hi) for lo, hi in slots if hi - lo >= food_stay]

    def _prefilter(self, cands: list[ScoredPoi], fixed_ids, day,
                   meal_slots: list[tuple[int, int]], food_stay: int) -> list[ScoredPoi]:
        """후보 > 60 일 때 노드로 남길 60 — 고정 블록 → 식사창 FOOD 예약석 → 점수순 (TRIP-1183).

        예약석: `meal_slots`(`_meal_slots`) 중 어느 창에든 영업창 안에서 체류가 들어가는 FOOD
        점수 상위 k건(k = 그 창 수). 점수만 보면 규칙 점수 모드에서 FOOD 가 86~108위라 전부
        잘려 OR 해는 식당 0, 같은 입력의 폴백(식사창 food-first)은 식당 4 로 갈렸다 —
        `meal_bonus` 는 프리필터 뒤 목적함수라 노드가 없으면 줄 대상이 없다. 자리만 남기고
        배치는 목적함수가 정한다(하드 제약 아님). 하한 뒤 앵커 이동분은 보지 않는다 — 노드
        단계에서 빠지면 그 석은 비지만 INV 와 무관한 풀 손실뿐이다.

        남긴 집합은 다시 점수 내림차순 + poi_id 로 정렬한다 — 해 품질이 노드 순서에 의존해서
        (예약석을 앞에 둔 채로 두면 부산 gourmet −13% 실측), 순서는 선정 규칙과 무관해야 한다.
        """
        rank = lambda c: (-c.score, str(c.poi_id))  # noqa: E731
        ranked = sorted(cands, key=rank)

        def seat_ok(c: ScoredPoi) -> bool:
            poi = self._pois[c.poi_id]
            if c.poi_id in fixed_ids or poi.category is not PoiCategory.FOOD:
                return False
            win = self._day_open_window(poi, day)
            return win is not None and any(
                max(lo, win[0]) + food_stay <= min(hi, win[1]) for lo, hi in meal_slots)

        seats = {c.poi_id for c in list(filter(seat_ok, ranked))[:len(meal_slots)]}
        # 안정 정렬 — 고정 먼저, 다음 예약석, 그 안에서는 점수순
        head = sorted(ranked, key=lambda c: (c.poi_id not in fixed_ids, c.poi_id not in seats))
        # FOOD 몫 상한 — 하루 상한(food_daily_max)을 넘는 FOOD 는 목적함수가 어차피 버리므로
        # 노드를 그 이상 채우면 비FOOD 자리만 뺏는다. 미식 취향에서 상위 60 이 전부 FOOD 라
        # 관광지 노드 0 → 상한 뒤 하루 3곳만 남던 것(2026-10-02 부산 미식 실측). 4배는 영업창·
        # 동선 선택 여지. 비FOOD 가 모자라면 넘친 FOOD 로 다시 채워 60 을 유지한다(풀 손실 없음).
        food_quota = max(len(seats), self._cfg.food_daily_max * 4)
        kept: list[ScoredPoi] = []
        spill: list[ScoredPoi] = []
        food_taken = 0
        for c in head:
            if len(kept) >= _PREFILTER_TOP_K:
                break
            food_like = c.poi_id not in fixed_ids and counts_as_food(self._pois[c.poi_id])
            if food_like and food_taken >= food_quota:
                spill.append(c)
                continue
            food_taken += food_like
            kept.append(c)
        kept += spill[:_PREFILTER_TOP_K - len(kept)]
        return sorted(kept, key=rank)

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
