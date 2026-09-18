"""detailIntro2 실 응답 관측 — 필드명과 채움률을 잰다 (TRIP-683).

`fetch_detail()` 는 이 엔드포인트를 항목당 1콜 부르면서 응답 dict 에서 **채택
목록(`_DETAIL_FIELDS`)의 필드만 읽고 나머지를 버린다** (2단계 전에는 영업시간
2필드뿐이었다). 그 밖에 무엇이 오는지·채움률은 리포에 기록이 없고,
`tests/fakes/fake_tourapi_http.py` 도 우리가 읽는 필드만 흉내낸다 — 즉
**fake 가 실물과 갈라져도 테스트는 초록**이다. 채택 목록을 늘리려면 이 프로브로 먼저 잰다.

## 왜 수집 배치가 아니라 별도 프로브인가

수집 파이프라인은 "기제안·변경 없음이면 상세 호출도 안 나간다"를 불변식으로
지키고, 테스트 3건이 그것을 물고 있다(쿼터 절약의 본체). 지금 17개 지역 × 5
타입이 전부 완주라 스킵률이 100% 이므로 배치에 얹으면 그 불변식을 깨야 한다.
관측 때문에 수집 규칙을 무르는 것은 값이 안 맞는다 — 그래서 따로 돈다.

## 무엇을 보나

타입별로 목록 1페이지를 받아 앞 N 건의 상세를 조회하고:
  · 응답에 실제로 있는 **필드명 전체**
  · 필드별 **채움률**(값이 비어 있지 않은 비율)
필드가 있어도 늘 비어 있으면 안 실은 것과 같으므로, 쓸모를 가르는 건 후자다.

**상태를 건드리지 않는다.** 커서·기제안 색인을 읽지도 쓰지도 않고, 제안 문서도
만들지 않는다. 순수 관측이다.

    uv run python scripts/probe_intro2.py --area 1 --per-kind 20
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from trippilot.poi_curation.sourcing.tourapi import (  # noqa: E402
    TourApiAdapter,
    UrllibHttpClient,
)
from trippilot.ports.poi_sourcing_port import SourcingError  # noqa: E402

# 수집이 도는 5종. 39(음식점)에 카페가 섞여 있다 — cat3 A05020900 으로만 갈린다.
_KINDS = ("12", "14", "28", "38", "39")


def _refs_from_doc(path: Path) -> dict[str, list[str]]:
    """제안 문서 → contentTypeId 별 content_id 목록. 목록 호출을 안 하므로 그만큼 싸다."""
    doc = json.loads(path.read_text(encoding="utf-8"))
    refs: dict[str, list[str]] = {}
    for p in doc.get("proposals", []):
        prov = p.get("provenance") or {}
        kind, cid = prov.get("content_type_id"), prov.get("content_id")
        if kind and cid:
            refs.setdefault(str(kind), []).append(str(cid))
    return refs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--area", default="1", help="areaCode (기본 1=서울)")
    ap.add_argument("--per-kind", type=int, default=20,
                    help="타입당 상세 조회 건수 (채움률 표본 크기)")
    ap.add_argument("--kinds", default=",".join(_KINDS))
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--from-doc", type=Path, default=None,
                    help="제안 문서에서 content_id 를 뽑는다 — 목록 호출 0건. "
                         "이미 수집한 바로 그 POI 를 재므로 표본이 실제 후보풀과 같다")
    ap.add_argument("--dump", default="",
                    help="원문을 전부 남길 필드 쉼표 목록 (채택 목록 안의 것만 나온다). "
                         "채움률은 '값이 있다'까지만 말해 준다 — 그 값이 쓸 수 있는 "
                         "모양인지는 원문을 봐야 안다")
    args = ap.parse_args()

    dump_fields = [f.strip() for f in args.dump.split(",") if f.strip()]

    key = os.environ.get("TOUR_API_KEY", "").strip()
    if not key:
        print("[intro2] TOUR_API_KEY 없음 — 중단", file=sys.stderr)
        return 1

    kinds = [k.strip() for k in args.kinds.split(",") if k.strip()]
    # 목록 1콜 + 상세 per_kind 콜, 타입마다. 키링은 어댑터가 알아서 돈다.
    adapter = TourApiAdapter(
        UrllibHttpClient(), key,
        extra_keys=tuple(
            v for v in (os.environ.get("TOUR_API_KEY2", ""),
                        os.environ.get("TOUR_API_KEY3", "")) if v.strip()
        ),
        calls_per_key=len(kinds) * (args.per_kind + 2),
    )

    doc_refs = _refs_from_doc(args.from_doc) if args.from_doc else {}

    result: dict[str, dict] = {}
    for kind in kinds:
        if doc_refs:
            refs = doc_refs.get(kind, [])[: args.per_kind]
            if not refs:
                print(f"[intro2] type={kind} 제안 문서에 없음 — 건너뜀", file=sys.stderr)
                continue
        else:
            try:
                page = adapter.fetch_page(
                    area_code=args.area, kind=kind, page_no=1, rows=100)
            except SourcingError as e:
                print(f"[intro2] type={kind} 목록 실패: {e}", file=sys.stderr)
                continue
            refs = [r.source_ref for r in page.records if r.source_ref][: args.per_kind]
        dumped: dict[str, list[str]] = {f: [] for f in dump_fields}
        for ref in refs:
            try:
                detail = adapter.fetch_detail(ref, kind)
            except SourcingError:
                continue   # 표본은 있으면 좋은 것 — 개별 실패는 채움률에만 반영된다
            for f in dump_fields:
                if (v := detail.detail_raw.get(f)) is not None:
                    dumped[f].append(v)

        sample = adapter.intro_samples.get(kind, {})
        seen = adapter.intro_seen.get(kind, 0)
        counts = adapter.intro_filled.get(kind, {})
        if not seen:
            print(f"[intro2] type={kind} 상세 0건 — 건너뜀", file=sys.stderr)
            continue
        rates = sorted(((k, counts.get(k, 0) / seen) for k in sample),
                       key=lambda kv: (-kv[1], kv[0]))
        result[kind] = {"n": seen, "fields": len(sample),
                        "rates": {k: round(r, 3) for k, r in rates},
                        "sample": sample}
        if any(dumped.values()):
            result[kind]["dump"] = {f: v for f, v in dumped.items() if v}
        print(f"\n[intro2] type={kind} — 상세 {seen}건 · 응답 필드 {len(sample)}개")
        for k, r in rates:
            bar = "█" * int(r * 20)
            print(f"    {k:24} {r * 100:5.1f}%  {bar}")

    print(f"\n[intro2] 총 호출 {adapter._http_calls}건", file=sys.stderr)  # noqa: SLF001
    if args.out:
        args.out.write_text(json.dumps(result, ensure_ascii=False, indent=1),
                            encoding="utf-8")
        print(f"[intro2] {args.out} 기록", file=sys.stderr)
    return 0 if result else 1


if __name__ == "__main__":
    raise SystemExit(main())
