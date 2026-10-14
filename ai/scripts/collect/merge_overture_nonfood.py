"""Overture 지역 파일 → 비식당 등록 제안. `collect_overture.py` 와 공유본 사이의 빠진 칸.

`collect_overture.py` 는 bbox 추출만 한다(`data/overture/<지역>.json`). 그 결과를 공유본에
넣으려면 **주소 복원 · 좌표 거부권 · 수집 게이트 · LLM 판정** 네 단계가 더 필요한데, 서울
994곳(#1249)과 부산·제주 127곳(#1253)을 즉석 스크립트로 두 번 돌렸다. 세 번째가 되기 전에
리포에 넣는다 — 공유본의 OVERTURE 1,112행이 지금은 리포만 보고 재현되지 않는다.

## 단계

    ① 식당·카페 제외          LOCALDATA 가 그쪽을 담당한다(서울 식당 14,648곳을 그걸로 넣었다)
    ② 이름 규칙              아파트·출입구(`overture.map_category`)·비여행지(`non_travel_reason`)
    ③ 주소 복원              `overture_address.resolve_address` — 약칭·시군구 접두·동 표
    ④ 좌표 거부권            복원한 시도가 좌표와 어긋나면 버린다(`SidoVeto`)
    ⑤ 수집 게이트            TourAPI 공유본 뒤에 붙여 중복 병합(`gate_against_tourapi`)
    ⑥ LLM 판정               규칙이 못 가르는 아파트(`classify_overture_nonfood.py` 산출)

⑥ 은 **미판정을 미채택으로** 다룬다 — 판정 파일에 없으면 넣지 않는다. 판정을 아직 안
받았으면 `--skip-verdicts` 로 ⑤ 까지만 돌려 후보 문서를 내고, 그걸 분류기에 먹인 뒤
다시 돌린다(2패스). 그래야 LLM 에 **게이트를 통과한 것만** 태운다.

⚠️ ⑥ 은 "가 볼 곳인가"만 묻고 **카테고리가 맞는지는 안 본다.** 원천이 틀린 분류를 보내면
그대로 통과한다 — 실측: `VR플러스 남포`(VR 오락실)가 Overture 카테고리 `park` 로 와서
NATURE 가 됐고, LLM 은 "VR체험장"으로 알아보면서도 accept 했다(프롬프트 기준으론 맞다).
이름만으로는 못 고치는 원천 오류라, 배치가 커지면 판정에 "분류가 맞나"를 더해야 한다.

    cd ai
    # 1패스 — 후보를 낸다
    uv run python scripts/collect/merge_overture_nonfood.py 부산 제주 \
        --skip-verdicts -o /tmp/cand.json
    # 2패스 — 판정을 받아 최종 문서를 낸다
    LLM_PROVIDER=anthropic uv run --env-file ../../.env \
        python scripts/classify/classify_overture_nonfood.py /tmp/cand.json
    uv run python scripts/collect/merge_overture_nonfood.py 부산 제주 -o /tmp/final.json
    # 공유본에 합치는 것은 기존 경로다
    uv run python scripts/collect/merge_pois_docs.py --allow-mixed \
        -o data/collected_pois.json data/collected_pois.json /tmp/final.json
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

_AI = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_AI / "src"))
sys.path.insert(0, str(_AI / "scripts" / "collect"))

from trippilot.domain.common import GeoPoint  # noqa: E402
from trippilot.domain.poi import PoiCategory  # noqa: E402
from trippilot.poi_curation.sourcing.collection_gate import SourcingCandidate  # noqa: E402
from trippilot.poi_curation.sourcing.localdata import (  # noqa: E402
    gate_against_tourapi,
    shared_tourapi_candidates,
    to_output_document,
)
from trippilot.poi_curation.sourcing.mapping import non_travel_reason  # noqa: E402
from trippilot.poi_curation.sourcing.overture import SOURCE_NAME, map_category  # noqa: E402
from trippilot.poi_curation.sourcing.overture_address import (  # noqa: E402
    SamePlaceIndex,
    SidoVeto,
    dong_table,
    resolve_address,
    sido_abbreviations,
)

from collect_localdata import _MIGRATION, load_regions, region_check  # noqa: E402

_FOOD = {PoiCategory.FOOD, PoiCategory.CAFE}
# Overture 비식당은 거친 카테고리 한 칸으로 온다 — 이름 규칙이 거기서 아파트를 가른다
_LANDMARK = "landmark_and_historical_building"


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("areas", nargs="+", help="지역 이름 (data/overture/<이름>.json)")
    ap.add_argument("--src", type=Path, default=_AI / "data" / "overture")
    ap.add_argument("--pois", type=Path, default=_AI / "data" / "collected_pois.json",
                    help="공유본 — 동 표·좌표 거부권·중복 병합의 기준")
    ap.add_argument("--verdicts", type=Path,
                    default=_AI / "data" / "overture_nonfood_verdicts.json")
    ap.add_argument("--skip-verdicts", action="store_true",
                    help="1패스 — 게이트까지만 돌려 후보를 낸다(LLM 판정 전)")
    ap.add_argument("-o", "--output", type=Path, help="생략하면 표준출력")
    args = ap.parse_args(argv)

    regions = load_regions(_MIGRATION / "R__seed_region_catalog.sql")
    abbrev = sido_abbreviations(regions)
    shared_doc = json.loads(args.pois.read_text(encoding="utf-8"))
    shared = shared_doc["proposals"]
    dongs = dong_table(((p.get("provenance") or {}).get("address") or "" for p in shared),
                       regions)
    sido_names = {n for _, n, _, lvl, _ in regions if lvl == "SIDO"}
    veto = SidoVeto(
        (GeoPoint(p["poi"]["coord"]["lat"], p["poi"]["coord"]["lng"]), tokens[0])
        for p in shared
        if (tokens := (((p.get("provenance") or {}).get("address") or "").split()))
        and len(tokens) >= 2 and tokens[0] in sido_names
    )
    # 게이트가 놓치는 쌍을 먼저 뺀다 — 사유는 `SamePlaceIndex` 주석
    same = SamePlaceIndex((p["poi"]["name"],
                           GeoPoint(p["poi"]["coord"]["lat"], p["poi"]["coord"]["lng"]))
                          for p in shared)
    print(f"[overture] 공유본 {len(shared):,} · 동 표 {len(dongs):,} · 시도 약칭 {len(abbrev)}",
          file=sys.stderr)

    stat: Counter[str] = Counter()
    cands: list[SourcingCandidate] = []
    rows = 0
    for area in args.areas:
        path = args.src / f"{area}.json"
        if not path.is_file():
            print(f"[overture] 없음, 건너뜀: {path}", file=sys.stderr)
            continue
        proposals = json.loads(path.read_text(encoding="utf-8"))["proposals"]
        rows += len(proposals)
        for p in proposals:
            poi, prov = p["poi"], (p.get("provenance") or {})
            if PoiCategory(poi["category"]) in _FOOD:
                stat["식당·카페(LOCALDATA 담당)"] += 1
                continue
            name = poi["name"]
            if map_category(_LANDMARK, name) is None:
                stat["이름 규칙(아파트·출입구)"] += 1
                continue
            if (why := non_travel_reason(name)):
                stat[f"비여행지:{why}"] += 1
                continue
            addr = resolve_address(prov.get("address"), regions, abbrev=abbrev,
                                  dongs=dongs, region_check=region_check)
            if not addr:
                stat["지역 못 붙임"] += 1
                continue
            lat, lng = poi["coord"]["lat"], poi["coord"]["lng"]
            if veto.rejects(addr, lat, lng):
                stat["좌표와 시도 불일치"] += 1
                continue
            if same.has(name, lat, lng):
                stat["이미 있음(이름+50m, 카테고리 무관)"] += 1
                continue
            kind = prov.get("category") or ""
            cands.append(SourcingCandidate(
                source_ref=prov.get("overture_id") or prov["content_id"],
                kind=kind, name=name, address=addr, lat=lat, lng=lng,
                category=PoiCategory(poi["category"]), category_codes=(kind,),
                open_hours=(), hours_raw=None, image_url=None, modified_at=None,
                source=SOURCE_NAME.lower()))
            stat["게이트로"] += 1
    print(f"[overture] 입력 {rows:,} → {dict(stat.most_common())}", file=sys.stderr)
    # 한 행은 드롭이거나 후보다 — 둘 다 아니면 어딘가에서 조용히 샜다
    assert sum(stat.values()) == rows, (sum(stat.values()), rows)

    outcome = gate_against_tourapi(shared_tourapi_candidates(shared_doc), cands,
                                   keep_source=SOURCE_NAME.lower())
    print(f"[overture] 게이트: 통과 {len(outcome.passed):,} · 병합 {outcome.merged} "
          f"· 드롭 {dict(outcome.drops)}", file=sys.stderr)

    passed = list(outcome.passed)
    triage: dict[str, int] = {}
    if not args.skip_verdicts:
        verdicts = json.loads(args.verdicts.read_text(encoding="utf-8"))["verdicts"]
        counted: Counter[str] = Counter()
        kept = []
        for g in passed:
            v = verdicts.get(g.candidate.source_ref) or {}
            label = ("accept" if v.get("verdict") == "accept"
                     else "reject" if v else "미판정(미채택)")
            counted[label] += 1
            if label == "accept":
                kept.append(g)
        passed, triage = kept, dict(counted.most_common())
        print(f"[overture] LLM 판정: {triage}", file=sys.stderr)

    doc = to_output_document(passed, collected_at=datetime.now(UTC), stats={
        "areas": list(args.areas),
        "selection": "비식당 + 지역이 이름 대조로 풀리는 것만 (최근접 이웃은 거부권만)",
        "row_drops": dict(stat.most_common()),
        "gate_merged": outcome.merged,
        "gate_drops": dict(outcome.drops),
        **({"llm_triage": triage} if triage else {"llm_triage": "미적용(--skip-verdicts)"}),
        "passed": len(passed),
        "by_category": dict(Counter(g.poi.category.value for g in passed).most_common()),
    })
    # `to_output_document` 은 LOCALDATA 용이라 출처 이름이 거기 박혀 있다 — 덮어쓴다
    doc["source"] = SOURCE_NAME
    for item in doc["proposals"]:
        item["source"] = SOURCE_NAME
    text = json.dumps(doc, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(text, encoding="utf-8")
    else:
        print(text)
    print(f"[overture] {len(passed):,}건"
          + (f" → {args.output}" if args.output else ""), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
