"""웹에서 고른 인기 장소 목록 → 카카오 로컬로 속성을 채운 등록 제안 (출처 KAKAO_LOCAL).

이름은 사람이 웹 검색으로 고르고(`data/curated_popular_places.json`, 항목마다 근거 URL),
**속성은 지어내지 않는다** — 주소·도로명·좌표·카카오 분류를 카카오 키워드 검색이 준 값으로만
채운다. 매칭이 안 되면 싣지 않는다(목록에 이름이 있다는 것만으로 등록하지 않는다, INV-1).

    ① 카카오 키워드 검색       목록의 `query` 로, 상위 15건 중 이름·시도가 맞는 첫 건
    ② 이름 규칙               비여행지·나이트라이프 제외(유흥·라틴댄스 등) — 기존 규칙 그대로
    ③ 주소 복원               `resolve_address` (카카오는 "서울 마포구 …" 약칭으로 준다)
    ④ 이미 있음               공유본과 이름 포함+300m(`already`) — **클럽은 비교에서 뺀다**.
                              클럽은 이 목록 것만 남기므로(병합 규칙) 옛 행과 겹쳐도 새로 넣어야 한다
    ⑤ 수집 게이트             TourAPI 공유본 뒤에 붙여 주소 키 중복 병합

    cd ai
    uv run --env-file ../../.env python scripts/collect/collect_curated_kakao.py -o /tmp/kakao.json
    uv run python scripts/collect/merge_pois_docs.py --allow-mixed \\
        -o data/collected_pois.json data/collected_pois.json /tmp/kakao.json

키는 `KAKAO_REST_API_KEY`, 없으면 `KAKAO_CLIENT_ID`(같은 앱의 REST 키다).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import urllib.parse
import urllib.request
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

_AI = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_AI / "src"))
sys.path.insert(0, str(_AI / "scripts" / "collect"))


from trippilot.domain.poi import PoiCategory  # noqa: E402
from trippilot.poi_curation.sourcing.collection_gate import SourcingCandidate  # noqa: E402
from trippilot.poi_curation.sourcing.localdata import (  # noqa: E402
    gate_against_tourapi,
    shared_tourapi_candidates,
    to_output_document,
)
from trippilot.poi_curation.sourcing.mapping import non_travel_reason  # noqa: E402
from trippilot.poi_curation.sourcing.overture import nightlife_tags  # noqa: E402
from trippilot.poi_curation.sourcing.overture_address import (  # noqa: E402
    dong_table,
    resolve_address,
    sido_abbreviations,
)

from collect_localdata import _MIGRATION, load_regions, region_check  # noqa: E402

SOURCE_NAME = "KAKAO_LOCAL"
CLUB = "클럽"
_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"
_MAX_CALLS = 200   # ponytail: 목록 크기 상한 겸 무료 쿼터 보호(일 10만), 목록이 커지면 올린다


def _norm(s: str) -> str:
    return re.sub(r"[\s·.\-_()]", "", s).lower()


def pick(docs: list[dict], name: str, sido: str) -> dict | None:
    """이름이 상호에 들어 있고 시도가 맞는 첫 건. 없으면 None — 비슷한 것을 고르지 않는다."""
    want = _norm(name)
    for d in docs:
        addr = d.get("road_address_name") or d.get("address_name") or ""
        if want in _norm(d.get("place_name", "")) and addr.startswith(sido):
            return d
    return None


def already(shared: list[tuple[str, float, float]], name: str, lat: float, lng: float) -> bool:
    """목록의 이름(`name`)이 공유본 상호 안에 있고 300m 안이면 같은 곳. 한 방향만 본다 — 반대로
    보면 `명동`(TourAPI)이 `명동실탄사격장`을 삼킨다. `SamePlaceIndex`(같은 이름+50m)보다 넓다 —
    큰 시설은 출처마다 좌표가 수백 m 갈리고(실측: 별마당도서관 201m·스몹 하남 159m),
    카카오는 지점명을 붙인다(`스몹 하남점`)."""
    want = _norm(name)
    for other, olat, olng in shared:
        if want in other and \
                math.hypot((lat - olat) * 111_000, (lng - olng) * 88_000) < 300:
            return True
    return False


def tags_for(kind: str, doc: dict, name: str) -> tuple[str, ...] | None:
    """클럽은 나이트라이프 계약(태그 두 칸), 그 밖은 카카오 분류의 마지막 칸."""
    if kind == CLUB:
        return nightlife_tags("dance_club", name)
    leaf = (doc.get("category_name") or "").split(">")[-1].strip()
    return (leaf,) if leaf else ()


def _search(key: str, query: str) -> list[dict]:
    req = urllib.request.Request(f"{_URL}?{urllib.parse.urlencode({'query': query, 'size': 15})}",
                                 headers={"Authorization": f"KakaoAK {key}"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)["documents"]


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--seed", type=Path, default=_AI / "data" / "curated_popular_places.json")
    ap.add_argument("--pois", type=Path, default=_AI / "data" / "collected_pois.json")
    ap.add_argument("-o", "--output", type=Path, required=True)
    args = ap.parse_args(argv)
    key = os.environ.get("KAKAO_REST_API_KEY") or os.environ.get("KAKAO_CLIENT_ID")
    if not key:
        print("[kakao] 키 없음 — KAKAO_REST_API_KEY 또는 KAKAO_CLIENT_ID", file=sys.stderr)
        return 2

    seed = json.loads(args.seed.read_text(encoding="utf-8"))["places"][:_MAX_CALLS]
    regions = load_regions(_MIGRATION / "R__seed_region_catalog.sql")
    abbrev = sido_abbreviations(regions)
    shared_doc = json.loads(args.pois.read_text(encoding="utf-8"))
    shared = shared_doc["proposals"]
    dongs = dong_table(((p.get("provenance") or {}).get("address") or "" for p in shared), regions)
    named = [(n, p["poi"]["coord"]["lat"], p["poi"]["coord"]["lng"])
             for p in shared if len(n := _norm(p["poi"]["name"])) >= 2]

    stat: Counter[str] = Counter()
    cands: list[SourcingCandidate] = []
    misses: list[str] = []
    for s in seed:
        kind = s["kind"]
        doc = pick(_search(key, s["query"]), s["name"], s["sido"])
        if doc is None:
            stat["카카오 매칭 없음"] += 1
            misses.append(s["query"])
            continue
        name = doc["place_name"]
        tags = tags_for(kind, doc, name)
        if tags is None:
            stat["나이트라이프 제외"] += 1
            continue
        if (why := non_travel_reason(name)):
            stat[f"비여행지:{why}"] += 1
            continue
        addr = resolve_address(doc.get("road_address_name") or doc.get("address_name"), regions,
                               abbrev=abbrev, dongs=dongs, region_check=region_check)
        if not addr:
            stat["지역 못 붙임"] += 1
            continue
        lat, lng = float(doc["y"]), float(doc["x"])
        if kind != CLUB and already(named, s["name"], lat, lng):
            stat["이미 있음(이름 포함+300m)"] += 1
            continue
        cands.append(SourcingCandidate(
            source_ref=doc["id"], kind=kind, name=name, address=addr, lat=lat, lng=lng,
            category=PoiCategory.ACTIVITY if kind == CLUB else PoiCategory(kind),
            category_codes=tags, open_hours=(), hours_raw=None, image_url=None,
            modified_at=None, source=SOURCE_NAME.lower()))
        stat["게이트로"] += 1
    assert sum(stat.values()) == len(seed), (stat, len(seed))
    print(f"[kakao] 목록 {len(seed)} → {dict(stat.most_common())}", file=sys.stderr)
    for q in misses:
        print(f"[kakao]   매칭 없음: {q}", file=sys.stderr)

    outcome = gate_against_tourapi(shared_tourapi_candidates(shared_doc), cands,
                                   keep_source=SOURCE_NAME.lower())
    print(f"[kakao] 게이트: 통과 {len(outcome.passed)} · 병합 {outcome.merged} "
          f"· 드롭 {dict(outcome.drops)}", file=sys.stderr)
    out = to_output_document(outcome.passed, collected_at=datetime.now(UTC), stats={
        "seed": len(seed), "row_drops": dict(stat.most_common()), "kakao_misses": misses,
        "gate_merged": outcome.merged, "gate_drops": dict(outcome.drops),
        "passed": len(outcome.passed)})
    out["source"] = SOURCE_NAME
    for item in out["proposals"]:
        item["source"] = SOURCE_NAME
    args.output.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    for item in out["proposals"]:
        print(f"[kakao]   {item['poi']['category']:9} {item['tags']} {item['poi']['name']} "
              f"| {item['provenance']['address']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
