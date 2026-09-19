"""요금 값이 어디에 있는지 훑는다 — 엔드포인트·필드 전수 스캔 (탐색용 1회성).

## 왜 필요했나

`usefee` 실측(서울 598건): 타입 14(문화시설)에만 있고, 입장료로 신뢰할 수 있는
금액은 조회분의 14.4%. 후보풀 전체로는 **0.9%** 다. 나머지 96.9% 를 채울 수
있는지를 답하려면 "다른 데 값이 있나"를 봐야 하는데, 리포에 기록이 없다.

`probe_intro2.py` 와 다른 점 두 가지:
  · **엔드포인트가 여럿이다** — `detailIntro2`(소개정보) 외에 `detailInfo2`(반복정보).
    후자는 infoname/infotext 쌍이라 필드명이 고정이 아니고, 어댑터에 메서드가 없다
  · **채택 목록을 거치지 않는다** — 응답의 모든 필드를 본다. 무엇을 채택할지
    정하려고 재는 것이라 채택 목록으로 걸러 보면 순환이다

그래서 어댑터를 쓰지 않고 직접 호출한다. **탐색이 끝나면 이 스크립트는 지울 수 있다** —
채택이 정해지면 그때부터는 `_DETAIL_FIELDS` 가 정본이다.

## 무엇을 재나

필드마다 ① 채움률 ② **`원` 금액이 들어 있는 비율** ③ 표본. ②가 핵심이다 —
`usetime`·`expguide` 같은 산문 필드에 요금이 섞여 있을 수 있고, 그건 필드명으로는
안 보인다.

    uv run python scripts/probe_fee_sources.py --from-doc data/collected_pois.json \
        --kinds 12,14,28,38,39 --per-kind 80 --out fee_sources.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

_BASE = "https://apis.data.go.kr/B551011/KorService2"
_OK = "0000"
# `원` 이 붙은 수만 금액으로 본다 — 나이(`25~64세`)·인원(`20인 이상`)을 배제한다.
_WON = re.compile(r"(?:\d{1,3}(?:,\d{3})+|\d+)\s*원")


def _get(endpoint: str, params: dict[str, str], key: str, timeout: float = 10.0) -> list[dict]:
    q = urllib.parse.urlencode({
        "serviceKey": key, "MobileOS": "ETC", "MobileApp": "TripPilot",
        "_type": "json", **params})
    with urllib.request.urlopen(f"{_BASE}/{endpoint}?{q}", timeout=timeout) as r:
        body = json.loads(r.read().decode("utf-8"))
    resp = body.get("response", {})
    if (resp.get("header") or {}).get("resultCode") != _OK:
        raise RuntimeError(f"{endpoint}: {(resp.get('header') or {}).get('resultMsg')}")
    items = ((resp.get("body") or {}).get("items") or {})
    if not isinstance(items, dict):
        return []          # 결과 0건이면 items 가 빈 문자열로 온다
    got = items.get("item") or []
    return got if isinstance(got, list) else [got]


def _refs_from_doc(path: Path) -> dict[str, list[str]]:
    doc = json.loads(path.read_text(encoding="utf-8"))
    refs: dict[str, list[str]] = {}
    for p in doc.get("proposals", []):
        prov = p.get("provenance") or {}
        if (k := prov.get("content_type_id")) and (c := prov.get("content_id")):
            refs.setdefault(str(k), []).append(str(c))
    return refs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-doc", type=Path, required=True)
    ap.add_argument("--kinds", default="12,14,28,38,39")
    ap.add_argument("--per-kind", type=int, default=80)
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--endpoints", default="detailIntro2,detailInfo2",
                    help="부를 엔드포인트. 필드를 이미 아는 2차 실측이면 하나로 줄여 "
                         "호출을 반으로 뺀다")
    ap.add_argument("--dump-fields", default="",
                    help="원문을 **전부** 남길 필드 쉼표 목록 (반복정보는 'info:이용요금'). "
                         "`[content_id, 원문]` 쌍으로 남아 제안 문서와 조인된다 — "
                         "표본 4건으로는 분포를 못 보고, 값만 남기면 카테고리별로 못 가른다")
    args = ap.parse_args()

    want_eps = tuple(e.strip() for e in args.endpoints.split(",") if e.strip())
    dump_fields = [f.strip() for f in args.dump_fields.split(",") if f.strip()]

    keys = [k for k in (os.environ.get(n, "").strip()
                        for n in ("TOUR_API_KEY", "TOUR_API_KEY2", "TOUR_API_KEY3")) if k]
    if not keys:
        print("[fee] TOUR_API_KEY 없음 — 중단", file=sys.stderr)
        return 1

    refs = _refs_from_doc(args.from_doc)
    calls = 0
    result: dict[str, dict] = {}

    for kind in (k.strip() for k in args.kinds.split(",") if k.strip()):
        ids = refs.get(kind, [])[: args.per_kind]
        if not ids:
            print(f"[fee] type={kind} 제안 문서에 없음 — 건너뜀", file=sys.stderr)
            continue
        seen = 0
        filled: dict[str, int] = defaultdict(int)     # 필드 → 값 있음
        priced: dict[str, int] = defaultdict(int)     # 필드 → `원` 금액 포함
        samples: dict[str, list[str]] = defaultdict(list)
        info_names: dict[str, int] = defaultdict(int)  # 반복정보 infoname 빈도
        dumped: dict[str, list[str]] = {f: [] for f in dump_fields}

        for cid in ids:
            row: dict[str, str] = {}
            for endpoint, params in (
                (e, {"contentId": cid, "contentTypeId": kind}) for e in want_eps
            ):
                key = keys[(calls // 900) % len(keys)]   # 키당 900콜에서 다음 키로
                calls += 1
                try:
                    items = _get(endpoint, params, key)
                except Exception as e:                    # noqa: BLE001 — 탐색이다
                    print(f"[fee] {endpoint} {cid}: {e}", file=sys.stderr)
                    continue
                if endpoint == "detailIntro2":
                    for k, v in (items[0] if items else {}).items():
                        row[k] = str(v or "")
                else:
                    # 반복정보는 (infoname, infotext) 쌍 — 이름이 곧 필드다
                    for it in items:
                        name = str(it.get("infoname") or "").strip()
                        if name:
                            info_names[name] += 1
                            row[f"info:{name}"] = str(it.get("infotext") or "")
            seen += 1
            for f in dump_fields:
                if (v := row.get(f, "").strip()):
                    # **식별자를 같이 남긴다.** 값만 남기면 제안 문서와 조인할 수 없어
                    # 카테고리·지역별로 다시 묶지 못한다 — 값의 분포는 대개 우리
                    # 카테고리별로 갈리므로(자연은 거의 무료, 전시는 유료) 한 덩어리
                    # 사분위는 설계 근거가 못 된다. 실제로 조인이 필요해져서 재수집했다.
                    dumped[f].append([cid, v])
            for k, v in row.items():
                if not v.strip():
                    continue
                filled[k] += 1
                if _WON.search(v):
                    priced[k] += 1
                    if len(samples[k]) < 4:
                        samples[k].append(v[:160])

        if not seen:
            continue
        rows = sorted(
            ((k, filled[k] / seen, priced[k] / seen) for k in filled),
            key=lambda t: (-t[2], -t[1], t[0]))
        result[kind] = {
            "n": seen,
            "fields": {k: {"fill": round(f, 3), "won": round(w, 3),
                           "samples": samples.get(k, [])} for k, f, w in rows},
            "info_names": dict(sorted(info_names.items(), key=lambda kv: -kv[1])),
        }
        if any(dumped.values()):
            result[kind]["dump"] = {f: v for f, v in dumped.items() if v}
        print(f"\n[fee] type={kind} — {seen}건")
        print(f"    {'필드':30} {'채움':>7} {'원금액':>7}")
        for k, f, w in rows:
            if f < 0.02 and w == 0:
                continue
            mark = "  ←" if w >= 0.1 else ""
            print(f"    {k:30} {f * 100:6.1f}% {w * 100:6.1f}%{mark}")

    print(f"\n[fee] 총 호출 {calls}건", file=sys.stderr)
    if args.out:
        args.out.write_text(json.dumps(result, ensure_ascii=False, indent=1),
                            encoding="utf-8")
        print(f"[fee] {args.out} 기록", file=sys.stderr)
    return 0 if result else 1


if __name__ == "__main__":
    raise SystemExit(main())
