#!/usr/bin/env python3
"""숙소 콘텐츠 커버리지 측정 — TourAPI 숙박(contentTypeId=32) vs 우리 정본 12,782곳.

정본: backend/docs/design/숙소콘텐츠-수집-설계.md §3 (칸 0)

**아무것도 등록하지 않는다.** 재는 것이 전부다 — 이 숫자가 칸 1(수집·병합) 착수 여부를 정한다.
커버리지가 낮으면 트랙을 접는 것이 맞고, 그 판단을 코드를 다 짠 뒤에 하면 비싸다.

## 왜 POI 수집에 32 를 더하지 않나

수집 커서가 `cursors[지역][타입]` 이라 POI 상태에 숙박 커서가 생긴다. 매핑표가 숙박을 버리므로
(`sourcing/mapping.py`) **매일 긁어와 매일 버리는 일이 영구히 돌고**, POI 통계도 오염된다.
그래서 스크립트·상태·워크플로를 분리한다. 예산 때문이 아니다 — POI 는 3,000 중 260 만 쓴다.

## 매칭 키가 주소가 아닌 이유

폐업 대조는 `addr_key()`(주소 4요소)를 썼지만 **우리 시드에 주소가 없다**(그게 이 트랙이 있는
이유다). 양쪽에 다 있는 것은 상호명과 좌표뿐이라 `norm_name()` + 좌표 근접으로 붙인다.
이름이 안 맞으면 붙이지 않는다 — 좌표만으로 붙이면 같은 건물의 다른 숙소에 남의 사진을 단다.

거리 임계값은 **하나로 정하지 않고 여러 값을 함께 보고**한다. 하나를 골라 두면 그 수가 임계값
선택에 얼마나 민감한지를 아무도 모른다.

사용법:
    TOUR_API_KEY=... python3 ai/scripts/measure_stay_coverage.py
    # 총건수만(17회 호출):  STAY_MEASURE_COUNT_ONLY=1
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
import sys
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from trippilot.poi_curation.sourcing.pipeline import resolve_area_codes  # noqa: E402
from trippilot.poi_curation.sourcing.tourapi import (  # noqa: E402
    TourApiAdapter,
    UrllibHttpClient,
)
from trippilot.ports.poi_sourcing_port import SourcedPlaceRecord  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from match_business_status import norm_name  # noqa: E402

LOG = logging.getLogger("stay-measure")

STAY_KIND = "32"
ROWS = 100
#: 우리 좌표는 EPSG:5174→WGS84 **변환값**, TourAPI 는 자체 측정값이라 같은 숙소도 어긋난다.
#: 하나로 정하지 않고 곡선을 본다(설계 §3.1).
THRESHOLDS_M = (100, 300, 500)
#: 근접 후보를 찾을 격자. 위도 0.01° ≈ 1.1km 라 500m 임계값을 이웃 칸까지 보면 충분히 덮는다.
GRID = 0.01
EARTH_M = 6_371_000.0

_SEED_ROW = re.compile(
    r"\(\s*'(?P<src>[^']*)'\s*,\s*'(?P<ref>[^']*)'\s*,\s*'(?P<name>(?:[^']|'')*)'\s*,"
    r"\s*(?P<lat>-?\d+\.?\d*)\s*,\s*(?P<lng>-?\d+\.?\d*)\s*,"
)


def _seed_path() -> Path:
    """리포 루트를 위로 찾아 시드를 연다 — 상대 깊이를 세면 위치가 바뀔 때 조용히 깨진다."""
    here = Path(__file__).resolve()
    for d in here.parents:
        p = d / "backend/app/src/main/resources/db/migration/R__seed_stay.sql"
        if p.is_file():
            return p
    raise SystemExit("숙소 시드를 찾지 못했습니다 — R__seed_stay.sql")


def load_ours() -> list[tuple[str, float, float]]:
    """정본 숙소 (이름, 위도, 경도). SQL 을 읽는다 — DB 없이 돌아야 CI·로컬이 같다."""
    rows = []
    for m in _SEED_ROW.finditer(_seed_path().read_text(encoding="utf-8")):
        rows.append((m["name"].replace("''", "'"), float(m["lat"]), float(m["lng"])))
    if not rows:
        raise SystemExit("시드에서 숙소를 한 건도 못 읽었습니다 — 정규식이 형식과 어긋납니다")
    return rows


def haversine_m(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    d_lat = math.radians(b_lat - a_lat)
    d_lng = math.radians(b_lng - a_lng)
    h = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(a_lat)) * math.cos(math.radians(b_lat)) * math.sin(d_lng / 2) ** 2
    )
    return 2 * EARTH_M * math.asin(min(1.0, math.sqrt(h)))


def build_index(ours: list[tuple[str, float, float]]) -> dict[tuple[int, int], list]:
    """좌표 격자 색인 — 12,782 × N 전수 비교를 피한다."""
    idx: dict[tuple[int, int], list] = defaultdict(list)
    for name, lat, lng in ours:
        idx[(int(lat / GRID), int(lng / GRID))].append((norm_name(name), lat, lng))
    return idx


def nearest_named_match(rec: SourcedPlaceRecord, idx) -> float | None:
    """이름이 맞는 것 중 **가장 가까운** 거리(m). 이름이 안 맞으면 None.

    `pick()` 을 그대로 쓰지 않는 이유: 그쪽은 영업상태로 동점을 가르는데(폐업 대조 문맥)
    여기서는 거리로 가른다. 이름 비교 규칙(정확 → 부분 포함)만 같다.
    """
    if rec.lat is None or rec.lng is None:
        return None
    key = norm_name(rec.name)
    if len(key) < 2:
        return None
    gy, gx = int(rec.lat / GRID), int(rec.lng / GRID)
    best: float | None = None
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            for ours_key, lat, lng in idx.get((gy + dy, gx + dx), ()):
                if ours_key != key and not _contains(key, ours_key):
                    continue
                d = haversine_m(rec.lat, rec.lng, lat, lng)
                if best is None or d < best:
                    best = d
    return best


def _contains(a: str, b: str) -> bool:
    """양방향 부분 포함(2글자 이상) — `pick()` 과 같은 규칙."""
    return len(a) >= 2 and len(b) >= 2 and (a in b or b in a)


def measure(adapter: TourApiAdapter, areas: list[str], count_only: bool) -> dict:
    idx = build_index(load_ours())
    per_area: dict[str, dict] = {}
    calls = 0
    seen: set[str] = set()
    with_image = matched = matched_with_image = 0
    matched_at: dict[int, int] = {t: 0 for t in THRESHOLDS_M}
    total_items = 0

    for area in areas:
        first = adapter.fetch_page(area, STAY_KIND, 1, 1 if count_only else ROWS)
        calls += 1
        area_total = first.total_count
        per_area[area] = {"total": area_total, "scanned": 0, "with_image": 0, "matched": 0}
        total_items += area_total
        if count_only:
            continue

        pages = -(-area_total // ROWS)
        for page_no in range(1, pages + 1):
            page = first if page_no == 1 else adapter.fetch_page(area, STAY_KIND, page_no, ROWS)
            if page_no > 1:
                calls += 1
            for rec in page.records:
                # 같은 숙소가 여러 지역에 뜨는 일이 있다 — 두 번 세면 비율이 거짓이 된다.
                if rec.source_ref in seen:
                    continue
                seen.add(rec.source_ref)
                per_area[area]["scanned"] += 1
                has_img = bool(rec.image_url)
                if has_img:
                    with_image += 1
                    per_area[area]["with_image"] += 1
                d = nearest_named_match(rec, idx)
                if d is None:
                    continue
                for t in THRESHOLDS_M:
                    if d <= t:
                        matched_at[t] += 1
                if d <= max(THRESHOLDS_M):
                    matched += 1
                    per_area[area]["matched"] += 1
                    if has_img:
                        matched_with_image += 1
        LOG.info("지역 %s — 총 %d · 훑음 %d · 사진 %d · 매칭 %d",
                 area, area_total, per_area[area]["scanned"],
                 per_area[area]["with_image"], per_area[area]["matched"])

    scanned = len(seen)
    return {
        "measured_at": datetime.now(UTC).isoformat(),
        "count_only": count_only,
        "areas": areas,
        "http_calls": calls,
        "tourapi_total": total_items,
        "scanned_unique": scanned,
        "with_image": with_image,
        "matched_by_threshold_m": matched_at,
        "matched": matched,
        "matched_with_image": matched_with_image,
        # 이 값이 판정선이다(설계 §3) — 우리 정본에서 **실제로 채워지는 칸**의 비율.
        "fill_rate_pct": round(100 * matched_with_image / len(load_ours()), 1) if scanned else 0.0,
        "per_area": per_area,
    }


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="[stay-measure] %(levelname)s %(message)s")
    key = os.environ.get("TOUR_API_KEY", "").strip()
    if not key:
        # POI 배치와 같은 규약 — 키가 없으면 건너뛰고 **성공 종료**한다.
        LOG.warning("TOUR_API_KEY 미설정 — 측정을 건너뜁니다.")
        return 0
    extra = tuple(k for k in (os.environ.get("TOUR_API_KEY2"), os.environ.get("TOUR_API_KEY3")) if k)
    adapter = TourApiAdapter(
        UrllibHttpClient(), key,
        extra_keys=extra,
        calls_per_key=int(os.environ.get("TOURAPI_MAX_CALLS") or "1000") if extra else None,
    )
    areas = resolve_area_codes(None, os.environ.get("TOURAPI_AREA_CODES"))
    result = measure(adapter, areas, bool(os.environ.get("STAY_MEASURE_COUNT_ONLY")))

    out = Path(os.environ.get("STAY_MEASURE_OUTPUT") or "stay_coverage.json")
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    LOG.info(
        "총 %d · 훑음 %d · 사진 %d · 매칭 %d · 채워지는 칸 %.1f%% · 호출 %d",
        result["tourapi_total"], result["scanned_unique"], result["with_image"],
        result["matched"], result["fill_rate_pct"], result["http_calls"],
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
