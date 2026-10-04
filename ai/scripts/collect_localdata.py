"""LOCALDATA 일반음식점 → 식당 공백 지역 보강 등록 제안 (TRIP-1224).

TourAPI 음식점만으로는 숙소 22.9% 가 반경 7km 안 식당 6곳 미만이다(군 지역 49.6%). 그 공백
지역에만 지방행정 인허가 대장의 영업 중 식당을 골라 넣는다 — 규칙·수치의 근거는
`trippilot.poi_curation.sourcing.localdata` 모듈 주석에 있다. 이 스크립트는 읽고·고르고·쓰기만 한다:

    원본 CSV(영업 중·채택 업태·좌표 변환) → 앵커(숙소 + 선택 가능 지역 중심)
    → 공백 앵커(7km 안 TourAPI FOOD < 6) → 앵커당 2km 안 가까운 12곳 → 수집 게이트(TourAPI 와 병합)
    → ai/data/collected_localdata.json

사용법 — **pyproj 는 이 스크립트에서만 쓴다.** pyproject 의존성에 넣지 않고 실행할 때만 붙인다:

    cd ai
    uv run --with pyproj python scripts/collect_localdata.py ~/dev/trippilot/restaurant_data/식품_일반음식점.csv
    uv run --with pyproj python scripts/collect_localdata.py <csv> --per-anchor 8 --out /tmp/localdata.json

원본: 공공데이터포털 「전국일반음식점표준데이터」 https://www.data.go.kr/data/15096283/standard.do
      (이용허락범위 제한 없음 · cp949 · 약 700MB · 폐업 포함 229만 행). **리포에 커밋하지 않는다.**
      내려받기는 사람 몫이다(data.go.kr 로그인) — `match_business_status.py` 와 같은 파일이다.
입력: 공유본 `ai/data/collected_pois.json`(TourAPI — 공백 판정·중복 병합 기준) ·
      `R__seed_stay.sql`(숙소 앵커) · `R__seed_region_catalog.sql`(지역 중심 앵커·지역 코드 점검).
갱신: 월 1회 다시 만들어 **`--close-missing` 으로** 붓는다. 수신이 관리번호 멱등 upsert 라 플래그 없이 부으면
      다음 생성에서 빠진 식당(폐업·공백 해소)이 문서에서만 빠지고 정본에는 ACTIVE 로 남는다(`ai/data/README.md` §갱신).
적재: 백엔드 V2.61(출처 LOCALDATA) 이후
      `python3 backend/scripts/ingest_pois.py --close-missing ai/data/collected_localdata.json`.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from trippilot.domain.common import GeoPoint  # noqa: E402
from trippilot.poi_curation.sourcing.localdata import (  # noqa: E402
    GAP_MIN_FOOD,
    GAP_RADIUS_KM,
    PER_ANCHOR,
    PICK_RADIUS_KM,
    SOURCE_NAME,
    gap_anchors,
    gate_against_tourapi,
    pick_near,
    shared_food_candidates,
    to_candidate,
    to_output_document,
)

_AI = Path(__file__).resolve().parents[1]
_MIGRATION = _AI.parent / "backend/app/src/main/resources/db/migration"

# 생성 시드 한 줄 — gen_stay_seed.py / gen_region_seed.py 가 쓰는 모양 그대로.
_STAY_ROW = re.compile(r"^\s*\('LOCALDATA', '(?:[^']|'')*', '(?:[^']|'')*', ([0-9.]+), ([0-9.]+), "
                       r"'(?:[^']|'')*', '(\d+)'")
_REGION_ROW = re.compile(r"^\s*\('(\d+)', '([^']+)', '(\d+)', '([^']+)', '(SIDO|SIGUNGU)', (true|false)\)")


def load_stays(path: Path) -> list[tuple[GeoPoint, str]]:
    """숙소 시드 → (좌표, 지역 코드)."""
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        m = _STAY_ROW.match(line)
        if m:
            out.append((GeoPoint(float(m[1]), float(m[2])), m[3]))
    return out


def load_regions(path: Path) -> list[tuple[str, str, str, str, bool]]:
    """카탈로그 시드 → (코드, 이름, 시도 코드, 단계, 선택 가능)."""
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        m = _REGION_ROW.match(line)
        if m:
            out.append((m[1], m[2], m[3], m[5], m[6] == "true"))
    return out


def region_centers(stays: list[tuple[GeoPoint, str]],
                   regions: list[tuple[str, str, str, str, bool]]) -> list[GeoPoint]:
    """숙소 없는 여행의 앵커 — `R__update_region_center` 를 숙소 좌표만으로 재현한다.

    정본 계산은 숙소 + ACTIVE POI 의 코드 접두사 평균이고 자료가 없는 목적지는 시도 중심이다.
    POI 를 빼는 이유: 그 반복 마이그레이션이 마지막으로 돈 시점의 POI 집합을 여기서 알 수 없고
    (수집분은 마이그레이션 뒤에 API 로 들어온다), 숙소 1.3만 곳이 평균을 지배한다.
    """
    pts: dict[str, list[GeoPoint]] = defaultdict(list)
    for p, code in stays:
        pts[code].append(p)

    def center(prefix: str) -> GeoPoint | None:
        members = [p for code, ps in pts.items() if code.startswith(prefix) for p in ps]
        if not members:
            return None
        return GeoPoint(sum(p.lat for p in members) / len(members),
                        sum(p.lng for p in members) / len(members))

    out = []
    for code, _, sido_code, _, selectable in regions:
        if selectable and (c := center(code) or center(sido_code)) is not None:
            out.append(c)
    return out


def region_check(address: str, regions: list[tuple[str, str, str, str, bool]]) -> str:
    """백엔드 `RegionResolver` 가 이 주소에 무엇을 붙일지 — sigungu · sido_only · unresolved.

    sido_only 는 시도 코드로 접힌 것(세종처럼 단층제면 정상, 아니면 시군구 이름이 카탈로그와 다르다).
    unresolved 는 첫 토큰이 시도 정식 명칭이 아니다 — 백엔드 응답 `regionUnresolved` 로 나온다.
    """
    tokens = address.split()
    sido = next((code for code, name, _, level, _ in regions if level == "SIDO" and name == tokens[0]), None)
    if sido is None:
        return "unresolved"
    under = {name for code, name, sc, level, _ in regions if level == "SIGUNGU" and sc == sido}
    two = " ".join(tokens[1:3]) if len(tokens) >= 3 else None
    return "sigungu" if (two in under or (len(tokens) >= 2 and tokens[1] in under)) else "sido_only"


def main() -> int:
    ap = argparse.ArgumentParser(description="LOCALDATA 일반음식점 → 식당 공백 지역 보강 등록 제안")
    ap.add_argument("csv", type=Path, help="전국일반음식점표준데이터 CSV (cp949)")
    ap.add_argument("--out", type=Path, default=_AI / "data" / "collected_localdata.json")
    ap.add_argument("--pois", type=Path, default=_AI / "data" / "collected_pois.json",
                    help="TourAPI 공유본 — 공백 판정·중복 병합 기준")
    ap.add_argument("--per-anchor", type=int, default=PER_ANCHOR, help=f"앵커당 상한 (기본 {PER_ANCHOR})")
    args = ap.parse_args()

    try:
        from pyproj import Transformer
    except ImportError:
        print("[localdata] pyproj 없음 — `uv run --with pyproj python scripts/collect_localdata.py …` 로 실행",
              file=sys.stderr)
        return 1
    if not args.csv.is_file():
        print(f"[localdata] 원본을 찾지 못했습니다: {args.csv}", file=sys.stderr)
        return 2

    # 1) 원본 — 영업 중·채택 업태·관광 무관 이름·고속도로 휴게소 제외·좌표 변환(EPSG:5174 중부원점 TM → WGS84)
    to_wgs84 = Transformer.from_crs("EPSG:5174", "EPSG:4326", always_xy=True).transform
    rows, row_drops, candidates, updated_max = 0, Counter(), [], ""
    with args.csv.open(encoding="cp949", errors="replace", newline="") as f:
        for row in csv.DictReader(f):
            rows += 1
            out = to_candidate(row, to_wgs84)
            if isinstance(out, str):
                row_drops[out] += 1
                continue
            candidates.append(out)
            updated_max = max(updated_max, out.modified_at or "")
    print(f"[localdata] 원본 {rows:,}행 → 후보 {len(candidates):,}곳  드롭 {dict(row_drops.most_common())}",
          file=sys.stderr)

    # 2) 앵커와 공백 — TourAPI 공유본 FOOD 기준
    tour_food = shared_food_candidates(json.loads(args.pois.read_text(encoding="utf-8")))
    food_pts = [GeoPoint(c.lat, c.lng) for c in tour_food]
    stays = load_stays(_MIGRATION / "R__seed_stay.sql")
    regions = load_regions(_MIGRATION / "R__seed_region_catalog.sql")
    centers = region_centers(stays, regions)
    gap_stays = gap_anchors([p for p, _ in stays], food_pts)
    gap_centers = gap_anchors(centers, food_pts)
    gaps = gap_stays + gap_centers
    print(f"[localdata] 앵커 숙소 {len(stays):,} + 지역 중심 {len(centers)} → 공백 "
          f"{len(gap_stays):,} + {len(gap_centers)} (TourAPI FOOD {len(tour_food):,})", file=sys.stderr)

    # 3) 선별 → 게이트(TourAPI 와 같은 가게는 병합으로 빠진다)
    picks = pick_near(gaps, candidates, per_anchor=args.per_anchor)
    outcome = gate_against_tourapi(tour_food, picks)
    passed = outcome.passed
    passed_pts = [p.poi.coord for p in passed]

    by_type = Counter(p.candidate.category_codes[0] for p in passed)
    by_sido = Counter(p.candidate.address.split()[0] for p in passed if p.candidate.address)
    regions_seen = Counter(region_check(p.candidate.address or "", regions) for p in passed)
    uncovered = gap_anchors(gaps, passed_pts, radius_km=PICK_RADIUS_KM, min_food=1)
    still_gap = gap_anchors(gaps, food_pts + passed_pts)
    stats = {
        "source_file": args.csv.name,
        "source_updated_max": updated_max,
        "rows": rows,
        "row_drops": dict(row_drops.most_common()),
        "candidates": len(candidates),
        "criteria": {"gap_radius_km": GAP_RADIUS_KM, "gap_min_food": GAP_MIN_FOOD,
                     "pick_radius_km": PICK_RADIUS_KM, "per_anchor": args.per_anchor},
        "anchors": {"stays": len(stays), "region_centers": len(centers),
                    "gap_stays": len(gap_stays), "gap_region_centers": len(gap_centers)},
        "picked": len(picks),
        "gate_merged": outcome.merged,
        "gate_drops": dict(outcome.drops),
        "passed": len(passed),
        "by_type": dict(by_type.most_common()),
        "by_sido": dict(by_sido.most_common()),
        # 백엔드 RegionResolver 를 흉내 낸 예상 — 실제 값은 수신 응답의 regionUnresolved 다
        "region_check": dict(regions_seen.most_common()),
        "gap_anchors_without_pick_2km": len(uncovered),
        "gap_anchors_still_below_min_7km": len(still_gap),
    }
    doc = to_output_document(passed, collected_at=datetime.now(UTC), stats=stats)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"[localdata] 선별 {len(picks):,} → 게이트 병합 {outcome.merged} · 드롭 {dict(outcome.drops)} "
          f"→ 제안 {len(passed):,}곳 ({args.out.stat().st_size / 1e6:.1f}MB, source={SOURCE_NAME})",
          file=sys.stderr)
    print(f"[localdata] 업태 {dict(by_type.most_common())}", file=sys.stderr)
    print(f"[localdata] 시도 {dict(by_sido.most_common())}", file=sys.stderr)
    print(f"[localdata] 지역 코드 예상 {dict(regions_seen)} · 공백 앵커 중 2km 안 보강 0곳 {len(uncovered)}"
          f" · 보강 뒤에도 7km 안 FOOD<{GAP_MIN_FOOD} {len(still_gap)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
