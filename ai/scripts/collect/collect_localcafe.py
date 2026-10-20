"""LOCALDATA 휴게음식점 → 카페 등록 제안 (사용자 결정 2026-10-19).

일정에 카페가 거의 안 나온다 — 서울시청 10km 안 공유본 CAFE 126곳(FOOD 12,728곳). 인허가 대장의
휴게음식점 중 카페·찻집을 앵커 둘레에 넣는다. 규칙·수치의 근거는
`trippilot.poi_curation.sourcing.localcafe` 모듈 주석에 있다. 식당 보강(`collect_localdata.py`)과 같은
길을 타고, 다른 것은 공백 앵커가 아니라 **전 앵커**·가까운 순이 아니라 **큰 순**이라는 것뿐이다:

    원본 CSV(영업 중·커피숍/전통찻집/떡카페·체인 제외·좌표 변환) → 앵커(숙소 + 선택 가능 지역 중심)
    → 앵커당 2km 안 시설총규모 큰 8곳 → 수집 게이트(TourAPI 공유본과 같은 곳은 병합)
    → ai/data/collected_localcafe.json

사용법 — pyproj 는 실행할 때만 붙인다(식당 스크립트와 같다):

    cd ai
    uv run --with pyproj python scripts/collect/collect_localcafe.py ~/dev/trippilot/restaurant_data/식품_휴게음식점.csv

원본: 공공데이터포털 「행정안전부_휴게음식점」 https://www.data.go.kr/data/15006730/fileData.do
      (cp949 · 약 210MB · 폐업 포함 65만 행). **리포에 커밋하지 않는다.** `match_business_status.py` 가
      읽는 그 파일이다.
적재: 이 문서는 **배포가 붓지 않는다** — 배포의 POI 적재 Job 은 공유본 `collected_pois.json` 만 읽는다.
      `--close-missing` 으로 따로 붓지 마라: 미포함 정리는 출처(LOCALDATA) 단위라 식당 수만 곳이 목록 밖으로
      읽힌다(서버가 409 로 막는다). 넣는 길은 PR 본문 · `ai/data/README.md` §collected_localcafe.json.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from collect_localdata import _MIGRATION, load_regions, load_stays, region_centers, region_check  # noqa: E402

from trippilot.domain.common import GeoPoint  # noqa: E402
from trippilot.domain.poi import PoiCategory  # noqa: E402
from trippilot.poi_curation.sourcing.collection_gate import _haversine_m  # noqa: E402
from trippilot.poi_curation.sourcing.localcafe import (  # noqa: E402
    PER_ANCHOR,
    SOURCE,
    pick_largest_near,
    to_cafe,
)
from trippilot.poi_curation.sourcing.localdata import (  # noqa: E402
    PICK_RADIUS_KM,
    SOURCE_NAME,
    gate_against_tourapi,
    shared_tourapi_candidates,
    to_output_document,
)

_AI = Path(__file__).resolve().parents[2]
# 일정에 카페가 없다는 문제를 잰 자 — 서울시청 반경 10km(대중교통 당일 후보풀 반경)
_CITY_HALL = GeoPoint(37.5665, 126.9780)
_SEOUL_KM = 10.0


def _seoul(points: list[GeoPoint]) -> int:
    return sum(_haversine_m(_CITY_HALL, p) <= _SEOUL_KM * 1000 for p in points)


def main() -> int:
    ap = argparse.ArgumentParser(description="LOCALDATA 휴게음식점 → 카페 등록 제안")
    ap.add_argument("csv", type=Path, help="행정안전부_휴게음식점 CSV (cp949)")
    ap.add_argument("--out", type=Path, default=_AI / "data" / "collected_localcafe.json")
    ap.add_argument("--pois", type=Path, default=_AI / "data" / "collected_pois.json",
                    help="공유본 — 중복 병합 기준")
    ap.add_argument("--per-anchor", type=int, default=PER_ANCHOR, help=f"앵커당 상한 (기본 {PER_ANCHOR})")
    args = ap.parse_args()

    try:
        from pyproj import Transformer
    except ImportError:
        print("[localcafe] pyproj 없음 — `uv run --with pyproj python scripts/collect/collect_localcafe.py …` 로 실행",
              file=sys.stderr)
        return 1
    if not args.csv.is_file():
        print(f"[localcafe] 원본을 찾지 못했습니다: {args.csv}", file=sys.stderr)
        return 2

    # 1) 원본 — 영업 중·채택 업태·관광 무관 이름·체인·고속도로 휴게소 제외·좌표 변환(EPSG:5174 → WGS84)
    to_wgs84 = Transformer.from_crs("EPSG:5174", "EPSG:4326", always_xy=True).transform
    rows, row_drops, cafes, updated_max = 0, Counter(), [], ""
    with args.csv.open(encoding="cp949", errors="replace", newline="") as f:
        for row in csv.DictReader(f):
            rows += 1
            out = to_cafe(row, to_wgs84)
            if isinstance(out, str):
                row_drops[out] += 1
                continue
            cafes.append(out)
            updated_max = max(updated_max, out[0].modified_at or "")
    assert sum(row_drops.values()) + len(cafes) == rows   # 두 통이 원본 행수를 정확히 나눠 갖는다
    print(f"[localcafe] 원본 {rows:,}행 → 후보 {len(cafes):,}곳  드롭 {dict(row_drops.most_common())}",
          file=sys.stderr)

    # 2) 앵커 — 공백만이 아니라 전부(카페는 어디나 얇다). 게이트에는 공유본 전 카테고리를 넘긴다
    tour = shared_tourapi_candidates(json.loads(args.pois.read_text(encoding="utf-8")))
    stays = load_stays(_MIGRATION / "R__seed_stay.sql")
    regions = load_regions(_MIGRATION / "R__seed_region_catalog.sql")
    centers = region_centers(stays, regions)
    anchors = [p for p, _ in stays] + centers

    # 3) 선별(큰 순) → 게이트(공유본과 같은 곳은 병합으로 빠진다)
    picks = pick_largest_near(anchors, cafes, per_anchor=args.per_anchor)
    outcome = gate_against_tourapi(tour, picks, keep_source=SOURCE)
    passed = outcome.passed

    by_type = Counter(p.candidate.category_codes[0] for p in passed)
    by_sido = Counter(p.candidate.address.split()[0] for p in passed if p.candidate.address)
    regions_seen = Counter(region_check(p.candidate.address or "", regions) for p in passed)
    seoul_before = _seoul([GeoPoint(c.lat, c.lng) for c in tour if c.category is PoiCategory.CAFE])
    seoul_added = _seoul([p.poi.coord for p in passed])
    stats = {
        "source_file": args.csv.name,
        "source_updated_max": updated_max,
        "rows": rows,
        "row_drops": dict(row_drops.most_common()),
        "candidates": len(cafes),
        "criteria": {"pick_radius_km": PICK_RADIUS_KM, "per_anchor": args.per_anchor,
                     "rank": "시설총규모 내림차순"},
        "anchors": {"stays": len(stays), "region_centers": len(centers)},
        "picked": len(picks),
        "gate_merged": outcome.merged,
        "gate_drops": dict(outcome.drops),
        "passed": len(passed),
        "by_type": dict(by_type.most_common()),
        "by_sido": dict(by_sido.most_common()),
        # 백엔드 RegionResolver 를 흉내 낸 예상 — 실제 값은 수신 응답의 regionUnresolved 다
        "region_check": dict(regions_seen.most_common()),
        "seoul_city_hall_10km": {"shared_cafe": seoul_before, "added": seoul_added},
    }
    doc = to_output_document(passed, collected_at=datetime.now(UTC), stats=stats)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"[localcafe] 앵커 숙소 {len(stays):,} + 지역 중심 {len(centers)} → 선별 {len(picks):,} → 게이트 병합 "
          f"{outcome.merged} · 드롭 {dict(outcome.drops)} → 제안 {len(passed):,}곳 "
          f"({args.out.stat().st_size / 1e6:.1f}MB, source={SOURCE_NAME})", file=sys.stderr)
    print(f"[localcafe] 업태 {dict(by_type.most_common())}", file=sys.stderr)
    print(f"[localcafe] 시도 {dict(by_sido.most_common())}", file=sys.stderr)
    print(f"[localcafe] 지역 코드 예상 {dict(regions_seen)}", file=sys.stderr)
    print(f"[localcafe] 서울시청 {_SEOUL_KM:g}km 안 카페 — 공유본 {seoul_before:,} + 이번 {seoul_added:,}",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
