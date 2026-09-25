"""POI → Google `place_id` 해결 — 영업시간 보강의 선행 작업. **무료다.**

## 왜 미리 해 두나

영업시간(`Place Details Enterprise`, $20/1,000)은 `place_id` 로 부른다. id 를 매번
검색으로 찾으면 호출이 두 배가 된다. 그런데 **`place_id` 는 Google 약관의 유일한
저장 예외**라 한 번 받아 영구 보관할 수 있다:

    "The place ID ... is exempt from the caching restrictions ...
     You can therefore store place ID values indefinitely."

그래서 검색은 오프라인 1회, 런타임은 상세만 부른다.

## ⚠️ FieldMask 가 요금을 정한다 — 늘리지 마라

Text Search 는 **요청한 필드 중 가장 비싼 티어**로 과금된다. `places.id` 만 요청하면
**Text Search Essentials = 무료**지만, 여기에 이름·주소를 더하는 순간 Pro 로 올라가
$32/1,000 이 된다. 아래 `_FIELD_MASK` 가 `places.id` 하나인 것은 그래서다.

**이름 확인용으로 `places.displayName` 을 넣고 싶어질 것이다. 넣지 마라** — 8,603건
이면 $275 다. 대조가 필요하면 표본만 따로 받아서 눈으로 본다.

## 잘못 붙는 것을 줄이는 장치

검색은 동명이인을 잡는다(`시청` 은 전국에 있다). 좌표를 주고 반경을 좁혀 그 안에서만
찾게 한다 — 틀린 id 를 저장하면 **엉뚱한 가게의 영업시간으로 일정을 짠다.** 반경 밖은
아예 안 받고, 결과가 둘 이상이면 저장하지 않는다(모호하면 포기 — 지어내기 금지).

    uv run python scripts/resolve_place_ids.py --doc data/collected_pois.json \\
        --out data/place_ids.json --max-calls 2000
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

_ENDPOINT = "https://places.googleapis.com/v1/places:searchText"
# **이 하나만 요청한다** — 필드가 곧 요금 티어다 (모듈 주석 참조).
_FIELD_MASK = "places.id"
# 이보다 멀면 동명 다른 장소다. 300m 는 실재 검증에서 출처 간 좌표 편차 p99(163m)를
# 덮으려고 고른 값이고, 같은 이유로 여기서도 쓴다.
_RADIUS_M = 300.0


def _search(name: str, lat: float, lng: float, key: str, timeout: float = 10.0) -> list[dict]:
    body = json.dumps({
        "textQuery": name,
        "languageCode": "ko",
        "maxResultCount": 2,          # 2건 받아 **모호하면 버리려고** — 1이면 못 가린다
        "locationBias": {"circle": {
            "center": {"latitude": lat, "longitude": lng},
            "radius": _RADIUS_M,
        }},
    }).encode("utf-8")
    req = urllib.request.Request(_ENDPOINT, data=body, headers={
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": _FIELD_MASK,
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        payload = json.loads(r.read().decode("utf-8"))
    places = payload.get("places")
    return places if isinstance(places, list) else []


def _targets(doc: dict, *, only_missing_hours: bool) -> list[tuple[str, str, float, float]]:
    """(content_id, 이름, lat, lng). 영업시간이 이미 있으면 뺀다 — 물을 이유가 없다."""
    out = []
    for p in doc.get("proposals", []):
        poi = p.get("poi") or {}
        prov = p.get("provenance") or {}
        cid = prov.get("content_id")
        lat, lng = poi.get("lat"), poi.get("lng")
        if not cid or lat is None or lng is None or not poi.get("name"):
            continue
        if only_missing_hours and poi.get("open_hours"):
            continue
        out.append((str(cid), poi["name"], float(lat), float(lng)))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--doc", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--max-calls", type=int, default=2000,
                    help="이번 실행의 호출 상한. 무료 SKU 지만 상한은 둔다 — "
                         "FieldMask 를 잘못 건드리면 유료가 되기 때문이다")
    ap.add_argument("--all", action="store_true",
                    help="영업시간이 있는 POI 까지 전부. 기본은 **없는 것만**")
    args = ap.parse_args()

    key = (os.environ.get("GOOGLE_MAPS_API_KEY") or "").strip()
    if not key:
        print("[place_id] GOOGLE_MAPS_API_KEY 없음 — 중단", file=sys.stderr)
        return 1

    doc = json.loads(args.doc.read_text(encoding="utf-8"))
    prev: dict = json.loads(args.out.read_text(encoding="utf-8")) if args.out.exists() else {}
    ids: dict[str, str] = dict(prev.get("place_ids") or {})
    targets = _targets(doc, only_missing_hours=not args.all)
    todo = [t for t in targets if t[0] not in ids]

    print(f"[place_id] 대상 {len(todo):,}건 (기해결 {len(ids):,}건 건너뜀) · "
          f"상한 {args.max_calls:,}콜", file=sys.stderr)

    calls = 0
    stat: Counter[str] = Counter()
    for cid, name, lat, lng in todo:
        if calls >= args.max_calls:
            print(f"[place_id] 상한 도달 — {len(todo) - calls:,}건 남김", file=sys.stderr)
            break
        calls += 1
        try:
            places = _search(name, lat, lng, key)
        except Exception as e:                      # noqa: BLE001
            stat["호출 실패"] += 1
            print(f"[place_id] {cid} {name}: {e}", file=sys.stderr)
            continue
        if not places:
            stat["못 찾음"] += 1
            continue
        if len(places) > 1:
            # **모호하면 버린다.** 틀린 id 를 저장하면 엉뚱한 가게의 영업시간으로
            # 일정을 짠다 — 빠뜨리는 것보다 나쁘다.
            stat["모호(2건 이상)"] += 1
            continue
        pid = places[0].get("id")
        if not isinstance(pid, str) or not pid:
            stat["응답 이상"] += 1
            continue
        ids[cid] = pid
        stat["해결"] += 1
        if calls % 200 == 0:
            time.sleep(1)                           # 벤더 배려

    print(f"\n[place_id] 호출 {calls:,}", file=sys.stderr)
    for k, v in stat.most_common():
        print(f"    {k:14} {v:,}", file=sys.stderr)

    args.out.write_text(json.dumps({
        "source": "google:places:searchText",
        "fetched_at": time.strftime("%Y-%m-%d"),
        "attempted": len(targets),
        "place_ids": ids,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[place_id] {args.out} 기록 — 누적 {len(ids):,}건 · "
          f"남은 대상 {max(0, len(todo) - calls):,}건", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
