"""생성 경로 감점(travel_weight) 실측 (TRIP-1398)

사용: PYTHONPATH=src uv run python scripts/measure/measure_generate_route_weight.py <시드 수> <psv 폴더>
psv = 로컬 DB app.poi 에서 앵커 ±0.063°·±0.08° 를 `poi_id|category|lat|lng|saved_count` 로 뽑은 것.
실 POI 풀(로컬 DB) × 앵커 5곳 × 시드, OR 1일 09~21시.

규칙 점수(LLM 없음)로 같은 풀을 w=0 / 0.02 / 0.05 로 풀어 도로 km·방문 수·점수 합을 비교한다.
"""
import random
import statistics
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.ortools_assembler import OrToolsAssembler
from trippilot.assembly_engine.scorer import build_rule_score
from trippilot.assembly_engine.travel import TravelEstimator
from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId, ScheduleId, TransportMode
from trippilot.domain.itinerary import ItineraryProblem, TimeWindow
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource

KST = timezone(timedelta(hours=9))
CFG = AssemblyConfig()
EST = TravelEstimator(CFG)
DAY = date(2026, 10, 15)
CAT = {"맛집": PoiCategory.FOOD, "명소": PoiCategory.SIGHT, "액티비티": PoiCategory.ACTIVITY,
       "자연": PoiCategory.NATURE, "카페": PoiCategory.CAFE, "문화": PoiCategory.CULTURE,
       "쇼핑": PoiCategory.SHOPPING, "야경": PoiCategory.NIGHT_VIEW}
ANCHORS = {"gwanghwamun": (37.5759, 126.9768), "hongdae": (37.5563, 126.9236),
           "gangnam": (37.4979, 127.0276), "haeundae": (35.1587, 129.1604),
           "gangneung": (37.7519, 128.8761)}
WEIGHTS = (0.0, 0.02, 0.05)


def load(name: str) -> list[Poi]:
    out = []
    for line in Path(sys.argv[2] if len(sys.argv) > 2 else ".") / f"{name}.psv".read_text().splitlines():
        pid, cat, lat, lng, saved = line.split("|")
        if cat not in CAT:
            continue
        out.append(Poi(poi_id=PoiId(pid), name=pid[:8], category=CAT[cat],
                       coord=GeoPoint(float(lat), float(lng)), open_hours=(), avg_cost=None,
                       rating=None, quality=DataQuality.FULL, source=PoiSource.SEED,
                       confidence=None, saved_count=int(saved)))
    return out


def road_km(sol, index, anchor) -> float:
    total = 0.0
    for d in sol.days:
        pts = [anchor, *(index[s.poi_id].coord for s in d.slots), anchor]
        if len(pts) > 2:
            total += sum(EST.estimate(a, b, TransportMode.PUBLIC).distance_km_range[1]
                         for a, b in zip(pts, pts[1:]))
    return total


def main(seeds: int) -> None:
    rows: dict[float, list[tuple[float, int, float]]] = {w: [] for w in WEIGHTS}
    for name, (lat, lng) in ANCHORS.items():
        pois = load(name)
        index = {p.poi_id: p for p in pois}
        anchor = GeoPoint(lat, lng)
        for seed in range(seeds):
            rnd = random.Random(seed)
            cands = tuple(ScoredPoi(p.poi_id, round(min(1.0, max(0.0, build_rule_score(
                p, BudgetLevel.MID, anchor, seed) + rnd.uniform(-0.05, 0.05))), 4), False)
                for p in pois)
            base = ItineraryProblem(
                schedule_id=ScheduleId("m"), days=(DAY,), candidates=cands, fixed_blocks=(),
                budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
                day_window=TimeWindow(datetime(2026, 10, 15, 9, tzinfo=KST),
                                      datetime(2026, 10, 15, 21, tzinfo=KST)),
                seed=seed, anchor=anchor)
            score = {c.poi_id: c.score for c in cands}
            line = [name, seed]
            for w in WEIGHTS:
                from dataclasses import replace
                sol = OrToolsAssembler(index, EST, CFG).solve(replace(base, travel_weight=w),
                                                              remaining_ms=20_000)
                if sol is None:
                    line.append("none")
                    continue
                slots = [s for d in sol.days for s in d.slots]
                km = road_km(sol, index, anchor)
                rows[w].append((km, len(slots), sum(score[s.poi_id] for s in slots)))
                line.append(f"w{w}: {km:.1f}km n={len(slots)} s={rows[w][-1][2]:.2f}")
            print(*line, sep=" | ", flush=True)
    print("\n요약(중앙값)")
    for w in WEIGHTS:
        if rows[w]:
            km, n, s = zip(*rows[w])
            print(f"w={w}: 도로 {statistics.median(km):.1f}km (평균 {statistics.mean(km):.1f}) · "
                  f"방문 {statistics.median(n)} · 점수합 {statistics.median(s):.2f} · 표본 {len(km)}")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 3)
