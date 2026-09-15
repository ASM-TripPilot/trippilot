"""OpenStreetMap 수집 — Overture 가 약한 네 축만 (TRIP-685).

    tourism=viewpoint  NIGHT_VIEW   2,692  (Overture 101 — 27배)
    natural=peak       NATURE      18,488  (Overture 2,417 — 7.6배)
    shop=*             SHOPPING    59,221  (Overture 6,527 — 9.1배)
    natural=beach      NATURE       1,525  (Overture 0 — 단독)

음식점·카페·명소·박물관은 Overture 가 더 많이 준다 — 겹치는 축까지 받으면 얻는
것 없이 ODbL 노출만 커지므로 **일부러 뺐다**(`sourcing/osm.py` 비교표).

## Overpass 를 쓰되 쪼갠다

Overpass 는 대량 추출용이 아니다(공용 인스턴스, 타임아웃·과부하 정책). 그래서
**태그별 × 지역별**로 나눠 던지고 사이에 간격을 둔다. 한 번에 전국 `shop=*`
5.9만을 요청하면 504 가 난다.

    uv run python scripts/collect_osm.py --areas 제주 --tags viewpoint,beach
    uv run python scripts/collect_osm.py --out data/osm

## 라이선스

ODbL-1.0. 산출 문서에 `attribution`·`license` 를 싣는다 — 받는 쪽이 의무를
모를 수 없게. **앱 화면 고지(`© OpenStreetMap contributors`)는 프론트엔드
작업이고 이 스크립트 밖이다.**
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from trippilot.poi_curation.sourcing.osm import (  # noqa: E402
    ATTRIBUTION,
    LICENSE,
    SOURCE_NAME,
    has_korean_name,
    map_tags,
)

# 공용 인스턴스 둘 — 앞이 죽으면 뒤로. overpass-api.de 가 406·connection refused 로
# 불안정해 실측에서 kumi 미러로 전건을 받았다.
_ENDPOINTS = (
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
)

# 태그별 Overpass 필터. `shop` 은 키 존재만 본다(값이 수백 종).
_TAG_FILTERS = {
    "viewpoint": '["tourism"="viewpoint"]',
    "peak": '["natural"="peak"]',
    "beach": '["natural"="beach"]',
    "shop": '["shop"]',
}

# 광역 17개 bbox (south, west, north, east — Overpass 순서). collect_overture 와
# 같은 경계를 쓴다 — 두 출처가 다른 지역 정의를 쓰면 교차 중복 판정이 어긋난다.
_AREAS: dict[str, tuple[float, float, float, float]] = {
    "제주": (33.0, 126.1, 33.6, 127.0), "부산": (34.9, 128.7, 35.4, 129.3),
    "울산": (35.4, 129.0, 35.8, 129.5), "대구": (35.7, 128.4, 36.0, 128.8),
    "광주": (35.0, 126.6, 35.3, 127.0), "대전": (36.2, 127.3, 36.5, 127.6),
    "세종": (36.4, 127.2, 36.7, 127.4), "인천": (37.3, 126.3, 37.7, 126.8),
    "서울": (37.4, 126.7, 37.7, 127.2), "경기": (36.9, 126.3, 38.3, 127.9),
    "강원": (37.0, 127.0, 38.6, 129.4), "충북": (36.0, 127.3, 37.2, 128.6),
    "충남": (35.9, 125.9, 37.1, 127.6), "전북": (35.3, 125.9, 36.2, 127.9),
    "전남": (33.9, 125.0, 35.5, 127.9), "경북": (35.6, 127.8, 37.6, 131.9),
    "경남": (34.5, 127.5, 35.9, 129.3),
}


def _query(bbox, filt: str) -> str:
    s, w, n, e = bbox
    return (f"[out:json][timeout:90];"
            f"(node{filt}({s},{w},{n},{e});way{filt}({s},{w},{n},{e}););"
            f"out center tags;")


def _fetch(q: str, pause: float) -> list[dict]:
    """Overpass 호출. 엔드포인트를 돌아가며 재시도하되 **지어내지 않는다** —
    전부 실패하면 예외를 올려 그 지역·태그가 빈 것을 부르는 쪽이 알게 한다.
    """
    last: Exception | None = None
    for attempt, url in enumerate(_ENDPOINTS * 2):
        try:
            req = urllib.request.Request(
                url, data=urllib.parse.urlencode({"data": q}).encode(),
                headers={"User-Agent": "TripPilot/1.0 (POI collection; ODbL)"})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode("utf-8")).get("elements", [])
        except Exception as e:   # noqa: BLE001 — 다음 엔드포인트로 넘어간다
            last = e
            print(f"    재시도({attempt + 1}) {type(e).__name__}", file=sys.stderr)
            time.sleep(pause * (attempt + 1))
    raise RuntimeError(f"Overpass 전 엔드포인트 실패: {last}")


def _coord(el: dict) -> tuple[float, float] | None:
    if el.get("type") == "node":
        lat, lon = el.get("lat"), el.get("lon")
    else:                                   # way → out center 가 준 중심점
        c = el.get("center") or {}
        lat, lon = c.get("lat"), c.get("lon")
    return (float(lat), float(lon)) if lat is not None and lon is not None else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path,
                    default=Path(__file__).resolve().parents[1] / "data" / "osm")
    ap.add_argument("--areas", default="")
    ap.add_argument("--tags", default=",".join(_TAG_FILTERS))
    ap.add_argument("--pause", type=float, default=8.0,
                    help="호출 간 간격(초) — 공용 인스턴스 예의")
    args = ap.parse_args()

    areas = [a.strip() for a in args.areas.split(",") if a.strip()] or list(_AREAS)
    tags = [t.strip() for t in args.tags.split(",") if t.strip()]
    args.out.mkdir(parents=True, exist_ok=True)
    grand = Counter()

    for area in areas:
        bbox = _AREAS.get(area)
        if bbox is None:
            print(f"[osm] 모르는 지역: {area}", file=sys.stderr)
            continue
        proposals, cats, drops = [], Counter(), Counter()
        seen: set[str] = set()
        for tag in tags:
            filt = _TAG_FILTERS.get(tag)
            if filt is None:
                print(f"[osm] 모르는 태그: {tag}", file=sys.stderr)
                continue
            els = _fetch(_query(bbox, filt), args.pause)
            for el in els:
                t = el.get("tags") or {}
                oid = f"{el.get('type')}/{el.get('id')}"
                if oid in seen:
                    drops["중복(태그간)"] += 1
                    continue
                name = (t.get("name") or "").strip()
                if not has_korean_name(name):
                    drops["한글이름없음"] += 1
                    continue
                cat = map_tags(t)
                if cat is None:
                    drops["태그·이름규칙"] += 1
                    continue
                xy = _coord(el)
                if xy is None:
                    drops["좌표없음"] += 1
                    continue
                seen.add(oid)
                cats[cat.value] += 1
                proposals.append({
                    "provisional_id": f"osm-{el['type'][0]}{el['id']}",
                    "source": SOURCE_NAME,
                    "poi": {
                        "poi_id": f"osm-{el['type'][0]}{el['id']}", "name": name,
                        "category": cat.value,
                        "coord": {"lat": round(xy[0], 7), "lng": round(xy[1], 7)},
                        "open_hours": [], "avg_cost": None, "rating": None,
                        "quality": "PARTIAL", "source": "PLACES_API",
                        "confidence": None,
                    },
                    "tags": [f"{k}={v}" for k, v in sorted(t.items())
                             if k in ("tourism", "natural", "shop")],
                    "region": area,
                    "opening_hours_raw": t.get("opening_hours"),
                    "provenance": {"osm_id": oid, "address": t.get("addr:full"),
                                   "tag": tag},
                })
            print(f"[osm] {area:4} {tag:9} 원본 {len(els):6,} → 누적 {len(proposals):6,}",
                  file=sys.stderr)
            time.sleep(args.pause)

        doc = {
            "schema_version": 1, "source": SOURCE_NAME,
            # 받는 쪽이 라이선스 의무를 모를 수 없게 문서에 싣는다.
            "license": LICENSE, "attribution": ATTRIBUTION,
            "collected_at": datetime.now(UTC).isoformat(), "region": area,
            "stats": {"proposals": len(proposals), "by_category": dict(cats),
                      "drops": dict(drops)},
            "proposals": proposals,
        }
        path = args.out / f"{area}.json"
        path.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
        grand.update(cats)
        print(f"[osm] {area:4} 합계 {len(proposals):,}건 "
              f"({path.stat().st_size / 1e6:.1f}MB) 드롭 {dict(drops)}", file=sys.stderr)

    print(f"\n[osm] 전체 {sum(grand.values()):,}건 · {ATTRIBUTION}", file=sys.stderr)
    for k, n in grand.most_common():
        print(f"    {k:11} {n:7,}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
