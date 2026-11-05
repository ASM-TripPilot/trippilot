"""교통 거점 표(`data/transit_hubs.json`)의 좌표를 카카오 키워드 검색으로 채운다 — 역·공항·터미널은 장소 DB 가 아니라 이 표로 푼다.

이름·별칭은 사람이 적고(사용자가 부르는 말 — "서울역"·"김포공항"), **좌표·카카오 상호·주소는 지어내지 않는다**: 카카오가 돌려준 건 중
분류가 거점 종류(기차역·공항·고속,시외버스터미널·여객)이고 상호에 `query` 가 들어 있는 첫 건만 쓴다. 못 맞추면 그 항목은 좌표 없이
남고 표 로더가 건너뛴다(없는 거점을 만들지 않는다, INV-1). 장소 DB 에 넣지 않는 까닭: 역은 가 볼 곳이 아니라 거리의 끝이다 —
`poi_public` 에 두면 "서울 가볼 만한 곳"에 서울역 1호선이 섞인다.

    cd ai
    uv run --env-file ../.env python scripts/collect/refresh_transit_hubs.py

키는 `KAKAO_REST_API_KEY`, 없으면 `KAKAO_CLIENT_ID`(같은 앱의 REST 키다). 항목 수만큼 호출한다(≈150, 일 쿼터 10만).
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

_AI = Path(__file__).resolve().parents[2]
_TABLE = _AI / "data" / "transit_hubs.json"
_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"
_HUB_CATEGORY = re.compile(r"기차역|지하철,전철|공항(?!주차장)|고속,시외버스터미널|여객선터미널")


def _norm(s: str) -> str:
    return re.sub(r"[\s·.\-_()]", "", s)


def pick(docs: list[dict], query: str) -> dict | None:
    """거점 분류이고 상호가 query 와 같은 건, 없으면 query 로 시작하는 첫 건(호선·청사가 뒤에 붙는다: "서울역 1호선"·"김해국제공항 국내선청사").
    들어 있기만 하면 "춘천역"이 "남춘천역"에 걸린다. 주차장·호텔·아파트·출구(같은 이름을 앞에 단다)는 분류에서 걸린다."""
    want = _norm(query)
    hubs = [d for d in docs if _HUB_CATEGORY.search(d["category_name"]) and "출구" not in d["category_name"]]
    exact = [d for d in hubs if _norm(d["place_name"]) == want]
    return next(iter(exact or [d for d in hubs if _norm(d["place_name"]).startswith(want)]), None)


def search(key: str, query: str) -> list[dict]:
    req = urllib.request.Request(f"{_URL}?{urllib.parse.urlencode({'query': query, 'size': 10})}",
                                 headers={"Authorization": f"KakaoAK {key}"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)["documents"]


def main() -> int:
    key = os.environ.get("KAKAO_REST_API_KEY") or os.environ.get("KAKAO_CLIENT_ID")
    if not key:
        print("[hubs] 키 없음 — KAKAO_REST_API_KEY 또는 KAKAO_CLIENT_ID", file=sys.stderr)
        return 2
    table = json.loads(_TABLE.read_text(encoding="utf-8"))
    missed: list[str] = []
    for hub in table["hubs"]:
        doc = pick(search(key, hub["query"]), hub["query"])
        if doc is None:
            missed.append(hub["name"])
            hub.pop("lat", None), hub.pop("lng", None)
            continue
        hub.update(lat=round(float(doc["y"]), 6), lng=round(float(doc["x"]), 6), kakao_name=doc["place_name"],
                   category=doc["category_name"].split(" > ")[-1], address=doc["address_name"])
    table["refreshed_at"] = datetime.now(UTC).strftime("%Y-%m-%d")
    _TABLE.write_text(json.dumps(table, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"[hubs] {len(table['hubs']) - len(missed)}/{len(table['hubs'])} 채움" + (f", 못 맞춤: {', '.join(missed)}" if missed else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
