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
from pathlib import Path


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
