"""수집 산출물(등록 제안 JSON) 여러 개 → 합본 문서 하나 (팀 공유본 갱신용).

`ai-poi-collect` 는 **실행 한 번 분량**만 artifact 로 남기고(보존 30일), 누적본을
어디에도 두지 않는다. 팀 공유본(`ai/data/collected_pois.json`)을 최신 실행 하나로
갈아끼우면 앞선 실행에서만 나온 POI 가 조용히 사라진다 — 그래서 합친다.

사용법:
    cd ai
    gh run download <RUN_ID> -n collected-pois -D /tmp/poi/<RUN_ID>   # 여러 실행 반복
    uv run python scripts/merge_pois_docs.py -o data/collected_pois.json /tmp/poi/*/collected_pois.json

같은 content_id 는 **나중 수집분이 이긴다**(재제안 = 변경 감지분). 재실행해도 결과가
같다(멱등). stats 는 합치지 않는다 — 실행별 수치(per_area·gate_drops)를 더하면 의미가
뭉개지므로 실행별 원문을 `merged_from` 에 그대로 남기고, 합본에 대해 참인 것만 `stats`
에 둔다. 스키마 정본은 `poi_curation/sourcing/pipeline.py` 의 `to_output_document`.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from trippilot.poi_curation.sourcing.mapping import (  # noqa: E402
    non_travel_reason,
    parse_open_hours,
)


def merge(docs: list[dict]) -> dict:
    """수집 시각 순으로 합친다 — 나중 문서가 같은 content_id 를 덮어쓴다."""
    docs = sorted(docs, key=lambda d: d["collected_at"])
    proposals: dict[str, dict] = {}
    areas: list[str] = []
    types: list[str] = []
    for d in docs:
        for a in d.get("area_codes") or [d.get("area_code")]:
            if a and a not in areas:
                areas.append(a)
        for t in d.get("content_types", []):
            if t not in types:
                types.append(t)
        for p in d["proposals"]:
            proposals[p["provenance"]["content_id"]] = p
    return {
        "schema_version": docs[-1]["schema_version"],
        "source": docs[-1]["source"],
        "collected_at": docs[-1]["collected_at"],
        "area_codes": sorted(areas, key=int),
        "content_types": sorted(types, key=int),
        "stats": {"merged_runs": len(docs), "unique_proposals": len(proposals)},
        "merged_from": [
            {
                "collected_at": d["collected_at"],
                "proposals": len(d["proposals"]),
                "stats": d.get("stats", {}),
            }
            for d in docs
        ],
        "proposals": list(proposals.values()),
    }


def reparse_open_hours(proposals: list[dict]) -> int:
    """`open_hours` 가 비었는데 원문이 있는 제안을 **현재 파서로 다시** 읽는다.

    파서를 고쳐도 이미 수집된 것에는 소급되지 않는다 — 증분 색인이 "변경 없음"으로
    스킵해 상세를 다시 안 받고, 받아도 파싱은 수집 시점에 한 번뿐이다. 그래서
    `상시 개방` 을 종일로 읽게 고친(PR #280) 뒤에도 공유본엔 그게 결측으로 남아
    있었다. 2026-09-17 실측: 결측 15,859건 중 **2,490건**이 원문만 있고 파싱이
    비어 있었고, 현재 파서로 전부 살아난다 — HC1 사각 85.2% → 71.8%.

    외부 호출 0. 원문(`opening_hours_raw`)이 정본이고 `open_hours` 는 그 파생이라,
    파생을 최신 규칙으로 다시 내는 것은 데이터를 바꾸는 게 아니다. 이미 값이
    있으면 건드리지 않는다 — 수집 시점 판정을 병합이 뒤집지 않는다.
    """
    n = 0
    for p in proposals:
        poi = p.get("poi") or {}
        raw = p.get("opening_hours_raw")
        if poi.get("open_hours") or not raw:
            continue
        hours = parse_open_hours(raw, None)
        if hours:
            poi["open_hours"] = [asdict(h) for h in hours]
            n += 1
    return n


def drop_non_travel(proposals: list[dict]) -> dict[str, int]:
    """관광 무관으로 **지금 판정되는** 제안을 뺀다. 사유별 건수를 돌려준다.

    수집 게이트 5단이 이미 같은 판정을 하지만 **수집 시점에만** 한다. 규칙을 고쳐도
    이미 수집된 것에는 소급되지 않고, 병합은 게이트를 타지 않는다 — 실측(2026-09-26):
    공유본 18,607건에 현재 규칙으로 걸리는 것이 2건 남아 있었다(`이마트24 강릉여고점`).
    규칙이 09-16 에 들어왔는데 공유본은 09-13 수집분이라 그렇다.

    영업시간 재파싱(`reparse_open_hours`)과 **같은 자리·같은 이유**다: 판정 규칙을
    고치면 다음 병합에서 기존 수집분에 소급된다. 외부 호출 0.

    ⚠️ 이 검사는 **이름만** 본다(`_NON_TRAVEL` — 오탐 0 을 실데이터로 확인한 좁은
    규칙). 카테고리 화이트리스트는 벤더 원 분류가 필요해 제안 문서에 없으므로 여기서
    못 한다 — 그건 수집 게이트의 몫이고, Overture·OSM 이 합류할 때 거기서 걸린다.
    """
    kept: list[dict] = []
    dropped: dict[str, int] = {}
    for p in proposals:
        name = (p.get("poi") or {}).get("name") or ""
        if (reason := non_travel_reason(name)) is not None:
            dropped[reason] = dropped.get(reason, 0) + 1
            continue
        kept.append(p)
    proposals[:] = kept
    return dropped


def _self_check() -> None:
    """덮어쓰기 방향 — 나중 수집분이 이긴다."""
    def doc(at, name):
        return {
            "schema_version": 1, "source": "TOURAPI", "collected_at": at,
            "area_code": "1", "content_types": ["12"], "stats": {},
            "proposals": [{"provenance": {"content_id": "x"}, "poi": {"name": name}}],
        }
    out = merge([doc("2026-08-02T00:00:00+00:00", "새것"), doc("2026-08-01T00:00:00+00:00", "옛것")])
    assert out["proposals"][0]["poi"]["name"] == "새것", out
    assert out["stats"] == {"merged_runs": 2, "unique_proposals": 1}, out
    print("[merge] self-check 통과")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("files", nargs="*", help="collected_pois.json 경로들")
    parser.add_argument("-o", "--output", help="합본 저장 경로 (생략 시 표준출력)")
    parser.add_argument("--self-check", action="store_true", help="병합 규칙 자체 검증만")
    args = parser.parse_args(argv)

    if args.self_check:
        _self_check()
        return 0

    docs = []
    for f in args.files:
        try:
            docs.append(json.loads(Path(f).read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError) as e:
            print(f"[merge] 파일 건너뜀 (읽기 실패): {f} — {e}", file=sys.stderr)
    if not docs:
        print("[merge] 읽은 문서가 없습니다", file=sys.stderr)
        return 1

    out = merge(docs)
    recovered = reparse_open_hours(out["proposals"])
    if recovered:
        print(f"[merge] 영업시간 재파싱 — {recovered}건 살림 (원문은 있었는데 파싱이 비어 있던 것)",
              file=sys.stderr)
    # 관광 무관 소급 제거 — 규칙이 수집 뒤에 들어왔거나 고쳐졌으면 여기서 걸린다.
    if (dropped := drop_non_travel(out["proposals"])):
        detail = " · ".join(f"{k} {v}" for k, v in sorted(dropped.items()))
        print(f"[merge] 관광 무관 제거 — {sum(dropped.values())}건 ({detail})", file=sys.stderr)
        out["stats"]["unique_proposals"] = len(out["proposals"])
    text = json.dumps(out, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")
    else:
        print(text)
    print(f"[merge] 실행 {len(docs)}개 → 제안 {sum(len(d['proposals']) for d in docs)}건(중복포함)"
          f" → 유니크 {out['stats']['unique_proposals']}건"
          + (f" → {args.output}" if args.output else ""), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
