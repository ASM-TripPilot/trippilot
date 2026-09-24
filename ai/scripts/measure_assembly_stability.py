"""어셈블리 OR 단계 안정성 실측 — 언제 해를 못 내는가.

## 왜 있나

OR-Tools 단계는 후보가 많아지면 3초 벽시계 안에 **첫 실행가능해조차 못 찾는
경우**가 있다. 그러면 `_solve_day` 가 None → `solve` 전체가 None → 규칙 폴백
(그리디) 강등이고, 사용자에게는 `is_fallback`/`solve_mode` 로만 드러난다.

여행 속도(pace, TRIP-906) 작업 중 실측으로 드러났고, 후속 티켓
**"OR 단계가 큰 후보풀에서 해를 못 낸다"** 의 근거 하네스다.

## 실측으로 확인된 것 (2026-09-19, 이 스크립트로)

무보정 기준선(pace 없음), 후보풀 크기별 6~8회 반복:

    후보 20곳 → 해없음 0/8      후보 45곳 → 해없음 1/6
    후보 30곳 → 해없음 0/8      후보 50곳 → 해없음 8/8   ← 전량 실패
    후보 40곳 → 해없음 0/8      후보 60곳 → 해없음 0/6

**풀 크기에 단조가 아니다.** 50곳은 전량 실패인데 60곳은 전량 성공이다.
체류 배율을 바꿔도 마찬가지로 조합마다 갈린다(60곳은 ×0.9 가 어렵고,
45곳은 ×0.95 가 어렵다). 같은 조합은 재현된다 — 6/6 이거나 0/6 이고
중간이 거의 없어, 벽시계 잡음이 아니라 **그 인스턴스가 어렵다**는 뜻이다.
따라서 반복 횟수를 늘려도 답은 안 바뀐다.

## 착수자가 알아야 할 것

- `_PREFILTER_TOP_K = 60` 이라 실서비스가 닿는 크기는 60 이하다. 위 구간은
  가상이 아니다.
- **시한을 올리면 풀린다 — 경계는 6초와 12초 사이다.** 후보 50곳에서:

      3,000ms → 3/3 해없음      12,000ms → 0/3 (7슬롯)
      6,000ms → 3/3 해없음      25,000ms → 0/3 (8슬롯)

  즉 탐색 구조의 문제가 아니라 시한 문제다. 다만 **시한만 올리면 끝이 아니다**
  — OR 단계가 받는 몫은 `remaining_ms // len(days)` 라 일자 수로 나뉜다.
  3일 여행이면 12초를 주려 해도 일자당 4초라 같은 자리에서 다시 막힌다.
  그래서 손댈 것이 `or_tools_limit_ms` 단독이 아니라 **일자 분배 방식**일 수
  있다(예: 실패한 일자에 남은 예산을 몰아주기). 전체 마감(TRIP-376)과의
  관계를 같이 봐야 한다.
- `num_search_workers = 1` 은 성능 설정이 아니라 **결정론 계약**이다(FD §4).
  워커를 늘리면 같은 입력 같은 출력 보증이 흔들린다 — 시한 쪽이 먼저다.

## 사용법

    cd ai
    uv run python scripts/measure_assembly_stability.py                 # 기본 스윕
    uv run python scripts/measure_assembly_stability.py --pool 45,50,60 --repeat 6
    uv run python scripts/measure_assembly_stability.py --limit-ms 3000,6000,12000
    uv run python scripts/measure_assembly_stability.py --pace           # pace 3값 비교

실 API 0건 — 좌표·영업시간을 합성해 만든다. pytest 대상이 아니다.
"""

from __future__ import annotations

import argparse
import time
from datetime import date, datetime, timedelta, timezone

from trippilot.assembly_engine.config import STAY_DEFAULT_MIN, AssemblyConfig
from trippilot.assembly_engine.fallback_assembler import RuleFallbackAssembler
from trippilot.assembly_engine.ortools_assembler import OrToolsAssembler
from trippilot.assembly_engine.travel import TravelEstimator
from trippilot.domain.common import (
    BudgetLevel,
    GeoPoint,
    Pace,
    PoiId,
    ScheduleId,
    TransportMode,
)
from trippilot.domain.itinerary import ItineraryProblem, TimeWindow
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource

_KST = timezone(timedelta(hours=9))
_DAY = date(2026, 9, 1)
_CATS = (PoiCategory.SIGHT, PoiCategory.FOOD, PoiCategory.CAFE, PoiCategory.NATURE,
         PoiCategory.CULTURE, PoiCategory.SHOPPING, PoiCategory.ACTIVITY,
         PoiCategory.NIGHT_VIEW)

# 하루 창 09~21시. 후보 1/3 은 짧은 영업창(10~17시, 미술관형) — 체류가 길어질 때
# 조용히 탈락하는 경로가 실측에 잡히도록 섞는다.
_DAY_OPEN, _DAY_CLOSE = 9 * 60, 21 * 60
_SHORT_OPEN, _SHORT_CLOSE = 10 * 60, 17 * 60


def build_problem(n: int, *, pace: Pace | None = None):
    """후보 n곳짜리 하루 문제. 좌표는 격자, 점수는 내림차순 — 전부 결정론."""
    pois, cands = [], []
    for i in range(n):
        hours = ((_SHORT_OPEN, _SHORT_CLOSE) if i % 3 == 0
                 else (_DAY_OPEN, _DAY_CLOSE))
        poi = Poi(
            PoiId(f"m{i}"), f"m{i}", _CATS[i % len(_CATS)],
            GeoPoint(33.500 + 0.006 * (i % 7), 126.520 + 0.006 * (i // 7)),
            tuple(OpenHour(day_of_week=d, open_min=hours[0], close_min=hours[1])
                  for d in range(7)),
            None, None, DataQuality.FULL, PoiSource.SEED, None)
        pois.append(poi)
        cands.append(ScoredPoi(poi.poi_id, 0.9 - 0.01 * i, False))
    problem = ItineraryProblem(
        schedule_id=ScheduleId("s-stability"), days=(_DAY,),
        candidates=tuple(cands), fixed_blocks=(),
        budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=TimeWindow(datetime(2026, 9, 1, 9, 0, tzinfo=_KST),
                              datetime(2026, 9, 1, 21, 0, tzinfo=_KST)),
        seed=7, pace=pace)
    return problem, {p.poi_id: p for p in pois}


def run_once(problem, index, cfg, *, engine: str = "or", budget_ms: int = 15_000):
    """budget_ms 는 **어셈블리 단계가 받는 잔여 전부**다 — 일자당 상한과 다르다.

    퍼사드는 체인 단계에 잔여를 통째로 넘기고(TRIP-376), OR 단계가 일자당
    `or_tools_limit_ms` 로 스스로 자른다. 둘을 같은 값으로 재면 "안 쓴 예산"이
    없는 것처럼 보여 실패 구제 경로가 아예 안 돈다.
    """
    est = TravelEstimator(cfg)
    asm = (OrToolsAssembler(index, est, cfg) if engine == "or"
           else RuleFallbackAssembler(index, est, cfg))
    t0 = time.perf_counter()
    out = asm.solve(problem, remaining_ms=budget_ms)
    ms = int((time.perf_counter() - t0) * 1000)
    slots = None if out is None else sum(len(d.slots) for d in out.days)
    return slots, ms


def sweep(pools, limits, paces, repeat: int, budget_ms: int) -> None:
    print(f"{'후보':>5} {'시한ms':>7} {'pace':>9} | "
          f"{'해없음':>8} {'OR슬롯':>10} {'폴백':>5} {'중앙ms':>7}")
    print("-" * 62)
    for n in pools:
        for limit_ms in limits:
            cfg = AssemblyConfig(or_tools_limit_ms=limit_ms, or_tools_min_ms=50)
            for pace in paces:
                problem, index = build_problem(n, pace=pace)
                runs = [run_once(problem, index, cfg, budget_ms=budget_ms)
                        for _ in range(repeat)]
                none_n = sum(1 for s, _ in runs if s is None)
                got = sorted({s for s, _ in runs if s is not None})
                times = sorted(ms for _, ms in runs)
                fb, _ = run_once(problem, index, cfg, engine="fb",
                                 budget_ms=budget_ms)
                print(f"{n:>5} {limit_ms:>7} {str(pace.value if pace else '-'):>9} | "
                      f"{f'{none_n}/{repeat}':>8} {str(got or '-'):>10} "
                      f"{str(fb):>5} {times[len(times) // 2]:>7}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__ and __doc__.splitlines()[0])
    ap.add_argument("--pool", default="20,30,40,45,50,60",
                    help="후보풀 크기 (쉼표 구분). 프리필터 상한이 60이다")
    ap.add_argument("--limit-ms", default="3000",
                    help="or_tools_limit_ms (쉼표 구분). 시한만 올려 풀리는지 본다")
    ap.add_argument("--repeat", type=int, default=6,
                    help="조합당 반복. 같은 조합은 재현되므로 6이면 충분하다")
    ap.add_argument("--budget-ms", type=int, default=15_000,
                    help="어셈블리 단계가 받는 잔여 전부. 일자당 상한과 다르다")
    ap.add_argument("--pace", action="store_true",
                    help="pace 3값을 함께 비교 (기본은 무보정만)")
    args = ap.parse_args()

    pools = [int(x) for x in args.pool.split(",")]
    limits = [int(x) for x in args.limit_ms.split(",")]
    paces = [None, *list(Pace)] if args.pace else [None]

    print(f"기본 체류(분): "
          f"{ {c.value: v for c, v in STAY_DEFAULT_MIN.items()} }")
    print(f"하루 창 09:00~21:00 · PUBLIC · 후보 1/3 은 짧은 영업창(10~17시)")
    print(f"어셈블리 잔여 예산 {args.budget_ms}ms (일자당 상한과 별개)\n")
    sweep(pools, limits, paces, args.repeat, args.budget_ms)


if __name__ == "__main__":
    main()
