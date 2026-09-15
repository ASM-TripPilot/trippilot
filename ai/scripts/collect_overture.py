"""Overture Maps places 수집 — 지역별 등록 제안 산출 (TRIP-684).

TourAPI 단일 출처의 한계를 메운다. 실측(릴리스 `2026-08-19.0`, 한국 bbox):
한국 691,968건 중 화이트리스트·한글이름·야경규칙을 통과하는 **208,507건**.

    FOOD 130,760 · CAFE 45,309 · SIGHT 15,879 · SHOPPING 6,527
    NATURE 5,248 · CULTURE 4,060 · ACTIVITY 683 · **NIGHT_VIEW 41**

NIGHT_VIEW 는 우리 경계 8종 중 유일하게 0건이던 축이다. ACTIVITY 는 반대로
TourAPI(2,981)가 Overture(683)보다 강하다 — 덮어쓰지 않고 합쳐야 한다.

## 왜 지역별 파일인가

단일 `collected_pois.json` 에 20만 건을 넣으면 14MB → 150MB 가 된다. git 커밋·
백엔드 수신·리뷰가 모두 감당 못 한다. 그래서 광역 17개로 쪼개 낸다.

**공유본(`ai/data/collected_pois.json`) 은 건드리지 않는다.** 그 파일은 백엔드
IT(`PoiProposalRealDocumentIT`)·병합 스크립트·폐업 대조·CI 경로 필터가 물고
있어, 분할은 그 넷을 함께 옮기는 별건이다. 이 스크립트는 `ai/data/overture/`
아래에 따로 낸다 — 합류 지점은 그 작업에서 정한다.

## 좌표·라이선스

좌표는 이미 WGS84(EPSG:4326)라 변환이 없다. places 테마는 **CDLA Permissive
2.0** 으로 share-alike 가 없고 상업 이용이 자유롭다. 다만 레코드마다 원출처가
섞여 있어(Meta·Microsoft·Foursquare·AllThePlaces…) `sources` 를 그대로 보존한다
— Foursquare 출처분은 NOTICE 의무가 따로 있다.

    uv run python scripts/collect_overture.py --out data/overture
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from trippilot.poi_curation.sourcing.overture import (  # noqa: E402
    _CATEGORY_MAP,
    SOURCE_NAME,
    has_korean_name,
    map_category,
)

_RELEASE = "2026-08-19.0"
_S3 = ("s3://overturemaps-us-west-2/release/{rel}"
       "/theme=places/type=place/*")

# 광역 17개 bbox (lng_min, lat_min, lng_max, lat_max). 경계가 겹치는 구간은
# 앞선 지역이 가져간다 — 같은 POI 가 두 파일에 들어가지 않게 순서로 정한다.
_AREAS: dict[str, tuple[float, float, float, float]] = {
    "제주": (126.1, 33.0, 127.0, 33.6),
    "부산": (128.7, 34.9, 129.3, 35.4),
    "울산": (129.0, 35.4, 129.5, 35.8),
    "대구": (128.4, 35.7, 128.8, 36.0),
    "광주": (126.6, 35.0, 127.0, 35.3),
    "대전": (127.3, 36.2, 127.6, 36.5),
    "세종": (127.2, 36.4, 127.4, 36.7),
    "인천": (126.3, 37.3, 126.8, 37.7),
    "서울": (126.7, 37.4, 127.2, 37.7),
    "경기": (126.3, 36.9, 127.9, 38.3),
    "강원": (127.0, 37.0, 129.4, 38.6),
    "충북": (127.3, 36.0, 128.6, 37.2),
    "충남": (125.9, 35.9, 127.6, 37.1),
    "전북": (125.9, 35.3, 127.9, 36.2),
    "전남": (125.0, 33.9, 127.9, 35.5),
    "경북": (127.8, 35.6, 131.9, 37.6),
    "경남": (127.5, 34.5, 129.3, 35.9),
}


def _rows(con, bbox):
    cats = "','".join(_CATEGORY_MAP)
    return con.execute(f"""
      SELECT id,
             names.primary        AS nm,
             categories.primary   AS cat,
             bbox.xmin            AS lng,
             bbox.ymin            AS lat,
             addresses[1].freeform AS addr,
             sources[1].dataset   AS src
      FROM read_parquet('{_S3.format(rel=_RELEASE)}', hive_partitioning=1)
      WHERE bbox.xmin BETWEEN {bbox[0]} AND {bbox[2]}
        AND bbox.ymin BETWEEN {bbox[1]} AND {bbox[3]}
        AND categories.primary IN ('{cats}')
    """).fetchall()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path,
                    default=Path(__file__).resolve().parents[1] / "data" / "overture")
    ap.add_argument("--areas", default="", help="쉼표 목록 (비우면 17개 전부)")
    args = ap.parse_args()

    try:
        import duckdb
    except ImportError:
        print("[overture] duckdb 없음 — `uv run --with duckdb` 로 실행", file=sys.stderr)
        return 1

    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")

    wanted = [a.strip() for a in args.areas.split(",") if a.strip()] or list(_AREAS)
    args.out.mkdir(parents=True, exist_ok=True)
    seen: set[str] = set()      # 지역 bbox 가 겹쳐도 같은 POI 를 두 번 내지 않는다
    grand = Counter()

    for area in wanted:
        bbox = _AREAS.get(area)
        if bbox is None:
            print(f"[overture] 모르는 지역: {area}", file=sys.stderr)
            continue
        proposals, cats, drops = [], Counter(), Counter()
        for oid, nm, cat, lng, lat, addr, src in _rows(con, bbox):
            nm = (nm or "").strip()
            if oid in seen:
                drops["중복(지역경계)"] += 1
                continue
            if not has_korean_name(nm):
                drops["한글이름없음"] += 1
                continue
            mapped = map_category(cat, nm)
            if mapped is None:
                drops["카테고리·이름규칙"] += 1
                continue
            if lat is None or lng is None:
                # bbox 가 NULL 인 레코드는 좌표를 지어낼 수 없다. 게이트 1단이
                # 어차피 막지만, 여기서 round(None) 이 TypeError 로 배치를 죽인다.
                drops["좌표없음"] += 1
                continue
            seen.add(oid)
            cats[mapped.value] += 1
            proposals.append({
                "provisional_id": f"overture-{oid}",
                "source": SOURCE_NAME,
                "poi": {
                    "poi_id": f"overture-{oid}", "name": nm,
                    "category": mapped.value,
                    "coord": {"lat": round(lat, 7), "lng": round(lng, 7)},
                    "open_hours": [], "avg_cost": None, "rating": None,
                    "quality": "PARTIAL", "source": "PLACES_API", "confidence": None,
                },
                "tags": [cat],
                "region": area,
                "opening_hours_raw": None,
                # 레코드 원출처를 보존한다 — Foursquare 출처분은 NOTICE 의무가
                # 따로 붙는다(CDLA 안에 라이선스가 섞여 있다).
                "provenance": {"overture_id": oid, "dataset": src,
                               "address": addr, "category": cat},
            })
        doc = {
            "schema_version": 1, "source": SOURCE_NAME,
            "overture_release": _RELEASE,
            "collected_at": datetime.now(UTC).isoformat(),
            "region": area,
            "stats": {"proposals": len(proposals), "by_category": dict(cats),
                      "drops": dict(drops)},
            "proposals": proposals,
        }
        path = args.out / f"{area}.json"
        path.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
        grand.update(cats)
        print(f"[overture] {area:4} {len(proposals):7,}건  "
              f"({path.stat().st_size / 1e6:.1f}MB)  드롭 {dict(drops)}",
              file=sys.stderr)

    print(f"\n[overture] 합계 {sum(grand.values()):,}건", file=sys.stderr)
    for k, n in grand.most_common():
        print(f"    {k:11} {n:7,}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
