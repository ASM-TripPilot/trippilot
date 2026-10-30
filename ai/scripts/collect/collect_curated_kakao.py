"""웹에서 고른 인기 장소 목록 → 카카오 로컬로 속성을 채운 등록 제안 (출처 KAKAO_LOCAL).

이름은 사람이 웹 검색으로 고르고(`data/curated_popular_places.json`, 항목마다 근거 URL),
**속성은 지어내지 않는다** — 주소·도로명·좌표·카카오 분류를 카카오 키워드 검색이 준 값으로만
채운다. 매칭이 안 되면 싣지 않는다(목록에 이름이 있다는 것만으로 등록하지 않는다, INV-1).

    ① 카카오 키워드 검색       목록의 `query` 로, 상위 15건 중 이름·시도가 맞는 첫 건
    ② 이름 규칙               비여행지·나이트라이프 제외(유흥·라틴댄스 등) — 기존 규칙 그대로
    ③ 주소 복원               `resolve_address` (카카오는 "서울 마포구 …" 약칭으로 준다)
    ④ 이미 있음               공유본과 이름 포함+300m(같은 이름은 1km, `already`) — 찾으면 새로 넣지 않고
                              그 행 키를 `data/curated_trending_refs.json` 에 남긴다(병합이 `요즘 인기` 를 붙인다).
                              **클럽은 비교에서 뺀다** — 클럽은 이 목록 것만 남긴다(병합 규칙)
    ⑤ 수집 게이트             공유본 뒤에 붙여 주소 키 중복 병합. 밤 장소는 식당·카페 행과 병합하지 않는다

모든 산출 행 태그 끝에 `요즘 인기`(`TRENDING_TAG`)가 붙는다 — 규칙 점수의 인기 항 바닥(`scorer`).

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


from trippilot.domain.poi import NIGHTLIFE_TAG, TRENDING_TAG, PoiCategory  # noqa: E402
from trippilot.poi_curation.sourcing.collection_gate import SourcingCandidate  # noqa: E402
from trippilot.poi_curation.sourcing.localdata import (  # noqa: E402
    gate_against_tourapi,
    shared_tourapi_candidates,
    to_output_document,
)
from trippilot.poi_curation.sourcing.mapping import non_travel_reason  # noqa: E402
from trippilot.poi_curation.sourcing.overture import NIGHTLIFE_DETAIL, nightlife_tags  # noqa: E402
from trippilot.poi_curation.sourcing.overture_address import (  # noqa: E402
    dong_table,
    resolve_address,
    sido_abbreviations,
)

from collect_localdata import _MIGRATION, load_regions, region_check  # noqa: E402

SOURCE_NAME = "KAKAO_LOCAL"
CLUB = "클럽"
_NIGHT_KIND = {v: k for k, v in NIGHTLIFE_DETAIL.items()}  # 세부 태그 → 원천 카테고리(이름 규칙용)
_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"
_MAX_CALLS = 200   # ponytail: 목록 크기 상한 겸 무료 쿼터 보호(일 10만), 목록이 커지면 올린다


def _norm(s: str) -> str:
    return re.sub(r"[\s·.\-_()]", "", s).lower()


def pick(docs: list[dict], name: str, sido: str, addr: str | None = None) -> dict | None:
    """이름이 상호에 들어 있고 시도가 맞는 첫 건. 없으면 None — 비슷한 것을 고르지 않는다.

    `addr`(출처에 적힌 도로명·지번, 예: "이태원로27가길 8")가 있으면 카카오 주소에도 그게 있어야 한다 —
    `문`·`솔`·`법원` 처럼 짧은 상호는 이름만으로는 엉뚱한 가게가 잡힌다. 번지 뒤 숫자는 막는다(8 ≠ 80).
    """
    want = _norm(name)
    at = re.compile(re.escape(_norm(addr)) + r"(?!\d)") if addr else None
    for d in docs:
        road = d.get("road_address_name") or d.get("address_name") or ""
        if want not in _norm(d.get("place_name", "")) or not road.startswith(sido):
            continue
        if at and not any(at.search(_norm(d.get(k) or ""))
                          for k in ("road_address_name", "address_name")):
            continue
        return d
    return None


def already(shared: list[tuple[str, float, float, tuple[str, str]]], name: str,
            lat: float, lng: float) -> tuple[str, str] | None:
    """목록의 이름(`name`)이 공유본 상호 안에 있고 300m 안이면 같은 곳 — 그 행의 (출처, 번호).

    한 방향만 본다 — 반대로 보면 `명동`(TourAPI)이 `명동실탄사격장`을 삼킨다. `SamePlaceIndex`
    (같은 이름+50m)보다 넓다 — 큰 시설은 출처마다 좌표가 수백 m 갈리고(실측: 별마당도서관 201m·
    스몹 하남 159m), 카카오는 지점명을 붙인다(`스몹 하남점`). 찾은 행에는 병합이 `요즘 인기` 를
    붙인다(`merge_pois_docs.mark_trending`) — 유명한 곳일수록 이미 있어서다."""
    want = _norm(name)
    for other, olat, olng, key in shared:
        if want not in other:
            continue
        # 이름이 **똑같으면** 1km 까지 — 궁·마을·놀이공원은 출처마다 대표 좌표가 300m 넘게 갈린다
        # (실측: 북촌한옥마을 340m·이월드 320m·하늘공원 400m)
        if math.hypot((lat - olat) * 111_000, (lng - olng) * 88_000) < (1000 if want == other else 300):
            return key
    return None


def tags_for(kind: str, doc: dict, name: str) -> tuple[str, ...] | None:
    """밤 장소(세부 태그 표의 값)는 나이트라이프 계약, 그 밖은 카카오 분류의 마지막 칸. 끝에 `요즘 인기`.

    나이트라이프 제외 이름(유흥·라틴댄스 등)이면 None — 싣지 않는다.
    """
    if kind in _NIGHT_KIND:
        got = nightlife_tags(_NIGHT_KIND[kind], name)
        return None if got is None else (*got, TRENDING_TAG)
    leaf = (doc.get("category_name") or "").split(">")[-1].strip()
    return (leaf, TRENDING_TAG) if leaf else (TRENDING_TAG,)


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
    ap.add_argument("--trending", type=Path, default=_AI / "data" / "curated_trending_refs.json")
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
    # 우리 옛 산출(KAKAO_LOCAL)은 비교에서 뺀다 — 다시 돌리면 자기 자신을 "이미 있음"으로 본다.
    # 밤 장소는 밤 장소끼리, 그 밖은 식당·카페를 빼고 비교한다 — 실측: `서울타워` 가 `육첩반상
    # 남산서울타워점` 에, 광안리 바 `표류` 가 같은 상호의 인허가 음식점 행에 붙어 밤 장소가 못 됐다.
    named: dict[bool, list[tuple[str, float, float, tuple[str, str]]]] = {True: [], False: []}
    for p in shared:
        night = NIGHTLIFE_TAG in (p.get("tags") or [])
        if p.get("source") == SOURCE_NAME or len(n := _norm(p["poi"]["name"])) < 2 or \
                (not night and p["poi"]["category"] in ("FOOD", "CAFE")):
            continue
        named[night].append((n, p["poi"]["coord"]["lat"], p["poi"]["coord"]["lng"],
                             (p["source"], p["provenance"]["content_id"])))
    trending: dict[tuple[str, str], str] = {}

    stat: Counter[str] = Counter()
    cands: list[SourcingCandidate] = []
    misses: list[str] = []
    for s in seed:
        kind = s["kind"]
        doc = pick(_search(key, s["query"]), s["name"], s["sido"], s.get("addr"))
        if doc is None:
            stat["카카오 매칭 없음"] += 1
            misses.append(s["query"])
            continue
        name = doc["place_name"]
        tags = tags_for(kind, doc, name)
        if tags is None:
            stat["나이트라이프 제외"] += 1
            continue
        if (why := non_travel_reason(name, kind)):
            stat[f"비여행지:{why}"] += 1
            continue
        addr = resolve_address(doc.get("road_address_name") or doc.get("address_name"), regions,
                               abbrev=abbrev, dongs=dongs, region_check=region_check)
        if not addr:
            stat["지역 못 붙임"] += 1
            continue
        lat, lng = float(doc["y"]), float(doc["x"])
        if kind != CLUB and (hit := already(named[kind in _NIGHT_KIND], s["name"], lat, lng)):
            stat["이미 있음(이름 포함+300m) → 요즘 인기 표지"] += 1
            trending[hit] = s["query"]
            continue
        cands.append(SourcingCandidate(
            source_ref=doc["id"], kind=kind, name=name, address=addr, lat=lat, lng=lng,
            category=PoiCategory.ACTIVITY if kind in _NIGHT_KIND else PoiCategory(kind),
            category_codes=tags, open_hours=(), hours_raw=None, image_url=None,
            modified_at=None, source=SOURCE_NAME.lower()))
        stat["게이트로"] += 1
    assert sum(stat.values()) == len(seed), (stat, len(seed))
    print(f"[kakao] 목록 {len(seed)} → {dict(stat.most_common())}", file=sys.stderr)
    for q in misses:
        print(f"[kakao]   매칭 없음: {q}", file=sys.stderr)

    # 게이트도 우리 옛 산출과 비교하지 않는다 — 다시 돌리면 같은 주소의 자기 자신에 병합돼 사라진다
    # (실측 2026-10-18: 두 번째 실행에서 클럽 20곳이 전부 "병합"으로 빠졌다)
    # 밤 장소는 식당·카페 행과 병합하지 않는다 — 바는 대개 일반음식점(경양식)으로 인허가가 나 있어
    # 같은 주소·상호로 병합되면 밤 장소 표지 없이 FOOD 로 남는다(실측: 광안리 표류·베이스먼트).
    # 같은 가게가 FOOD 행과 밤 장소 행 둘로 있게 되는 것은 감수한다(#1315 사보타지와 같다).
    others = [p for p in shared if p.get("source") != SOURCE_NAME]
    no_food = [p for p in others if p["poi"]["category"] not in ("FOOD", "CAFE")]
    passed: list = []
    merged = 0
    drops: Counter[str] = Counter()
    for night in (False, True):
        part = [c for c in cands if (c.kind in _NIGHT_KIND) is night]
        o = gate_against_tourapi(
            shared_tourapi_candidates({**shared_doc, "proposals": no_food if night else others}),
            part, keep_source=SOURCE_NAME.lower())
        passed += o.passed
        merged += o.merged
        drops.update(o.drops)
    print(f"[kakao] 게이트: 통과 {len(passed)} · 병합 {merged} · 드롭 {dict(drops)}", file=sys.stderr)
    passed_refs = {g.candidate.source_ref for g in passed}
    for c in cands:
        if c.source_ref not in passed_refs:
            print(f"[kakao]   게이트 병합(주소 키): {c.name} | {c.address}", file=sys.stderr)
    out = to_output_document(passed, collected_at=datetime.now(UTC), stats={
        "seed": len(seed), "row_drops": dict(stat.most_common()), "kakao_misses": misses,
        "gate_merged": merged, "gate_drops": dict(drops), "passed": len(passed)})
    out["source"] = SOURCE_NAME
    for item in out["proposals"]:
        item["source"] = SOURCE_NAME
    args.output.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    args.trending.write_text(json.dumps({
        "_doc": "웹 큐레이션이 공유본의 기존 행과 맞춘 것 — 병합이 `요즘 인기` 태그를 붙인다(mark_trending).",
        "refs": [{"source": s, "content_id": c, "query": q} for (s, c), q in sorted(trending.items())],
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"[kakao] 기존 행 인기 표지 {len(trending)}건 → {args.trending}", file=sys.stderr)
    for item in out["proposals"]:
        print(f"[kakao]   {item['poi']['category']:9} {item['tags']} {item['poi']['name']} "
              f"| {item['provenance']['address']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
