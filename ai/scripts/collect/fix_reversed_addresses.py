"""공유본의 **지역이 두 번 적힌** OVERTURE 주소를 바로잡는다 (한 번 쓰는 보정).

## 어쩌다 생겼나

Overture 일부 레코드는 주소를 **뒤집어** 준다 — `과천동 489-6번지 과천시 경기도 KR`.
#1249(서울 994) 당시 파이프라인은 그 꼴을 못 풀어 앞에 지역을 그대로 붙였다:

    경기도 과천시  ⟨과천동 489-6번지 과천시 경기도 KR⟩
    경기도 고양시 일산서구  ⟨대한민국 경기도 고양시 대화동 2324⟩

실측 **54곳**이 이 모양이다(전부 #1249 분, #1253 분은 0).

## 왜 지금 고치나 — 그냥 두면 조용히 54곳을 잃는다

지역 코드는 **지금은 맞다.** 그 POI 들은 제대로 된 여행에 노출된다. 문제는 둘이다:

1. 사용자에게 보이는 주소 문자열이 틀렸다
2. `overture_address.resolve_address` 가 이 꼴을 **거부한다**(머리를 정리해도 지역명이
   남으면 포기 — 지어 붙이는 것보다 포기가 맞다는 판단). 그래서 다음 재수집에서 이 54곳은
   "지역 못 붙임"이 되어 **목록에서 빠지고, 목록 부재는 퇴출로 이어진다**

## 어떻게 고치나 — 세 단계, 좌표는 안 쓴다

    ① 접두 떼기   첫 토큰이 시도고 그 뒤가 그 시도의 시군구면(한/두 토큰) 그만큼이 우리가 붙인 것
    ② 꼬리 떼기   나라·시도·시군구 조각이 꼬리에 있으면 뗀다 (뒤집힌 꼴의 잔재)
    ③ 다시 풀기   남은 원문을 지금 resolver 로 푼다

③ 이 실패하면 **접두만 남긴다**(`서울특별시 마포구`). 번지까지는 못 살리지만 지역은
사실이고, 그러면 다음 재수집에서도 풀린다 — 퇴출 위험이 사라진다.

실측 결과: 깨끗하게 복구 **38** · 접두만 남김 **16** · 실패 0.

    cd ai
    uv run python scripts/collect/fix_reversed_addresses.py            # 미리보기
    uv run python scripts/collect/fix_reversed_addresses.py --write
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

_AI = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_AI / "src"))
sys.path.insert(0, str(_AI / "scripts" / "collect"))

from trippilot.poi_curation.sourcing.overture_address import (  # noqa: E402
    dong_table,
    resolve_address,
    sido_abbreviations,
)

from collect_localdata import _MIGRATION, load_regions, region_check  # noqa: E402
from merge_pois_docs import dumps_doc  # noqa: E402

# 보이지 않는 방향 제어 문자 — `경기도‎` 처럼 붙어 와서 토큰 비교를 깬다
_INVISIBLE = re.compile(r"[​-‏‪-‮﻿]")
_COUNTRY = {"KR", "Korea", "KOREA", "대한민국", "한국"}


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--pois", type=Path, default=_AI / "data" / "collected_pois.json")
    ap.add_argument("--write", action="store_true", help="주지 않으면 미리보기만")
    args = ap.parse_args(argv)

    regions = load_regions(_MIGRATION / "R__seed_region_catalog.sql")
    abbrev = sido_abbreviations(regions)
    sido_names = {n for _, n, _, lvl, _ in regions if lvl == "SIDO"}
    sido_of = {c: n for c, n, _, lvl, _ in regions if lvl == "SIDO"}
    by_sido: dict[str, set[str]] = defaultdict(set)
    for _, name, sido_code, level, _ in regions:
        if level == "SIGUNGU":
            by_sido[sido_of.get(sido_code, "")].add(name)
    # 두 토큰 시군구의 **각 조각**도 떼야 한다 — 꼬리의 `고양시`·앞의 `일산서구`
    parts = {t for gus in by_sido.values() for g in gus for t in g.split()}
    tail_drop = _COUNTRY | sido_names | parts | set(abbrev)

    doc = json.loads(args.pois.read_text(encoding="utf-8"))
    proposals = doc["proposals"]
    dongs = dong_table([(p.get("provenance") or {}).get("address") or ""
                        for p in proposals], regions)

    def split_prefix(address: str) -> tuple[str, str]:
        """(우리가 붙인 접두, 남은 원문). 접두가 없으면 ("", 원문)."""
        t = _INVISIBLE.sub("", address).split()
        if not t or t[0] not in sido_names:
            return "", " ".join(t)
        gus = by_sido[t[0]]
        if len(t) >= 3 and " ".join(t[1:3]) in gus:
            return " ".join(t[:3]), " ".join(t[3:])
        if len(t) >= 2 and t[1] in gus:
            return " ".join(t[:2]), " ".join(t[2:])
        return t[0], " ".join(t[1:])

    def trim(address: str) -> str:
        """양끝의 지역·나라 조각을 뗀다 — 뒤집힌 꼴은 양쪽에 다 남는다."""
        t = [x for x in address.split() if x]
        while t and t[-1].strip(",") in tail_drop:
            t.pop()
        while t and t[0].strip(",") in tail_drop:
            t.pop(0)
        return " ".join(t)

    def is_broken(address: str) -> bool:
        return any(address.count(s) > 1 for s in sido_names)

    stat: Counter[str] = Counter()
    rows: list[tuple[str, str, str]] = []
    for p in proposals:
        prov = p.get("provenance") or {}
        addr = prov.get("address") or ""
        if p.get("source") != "OVERTURE" or not is_broken(addr):
            continue
        prefix, rest = split_prefix(addr)
        got = resolve_address(trim(rest), regions, abbrev=abbrev, dongs=dongs,
                              region_check=region_check)
        # **지역을 옮기지 않는다.** 복원이 다른 시군구를 가리키면 둘 중 어느 쪽이 맞는지
        # 모른다 — 지금 적재된 지역이 틀렸다는 증거가 없으므로 건드리지 않는다.
        # (실데이터에 원천 꼬리가 접두와 어긋나는 것이 있다: `탑베이비` 는 꼬리가 은평구,
        #  접두가 강남구인데 `신사동` 은 강남구다 — 이런 걸 말없이 옮기면 안 된다.)
        if got and prefix and split_prefix(got)[0] != prefix:
            stat["지역이 달라져 건드리지 않음"] += 1
            print(f"   ⚠ {p['poi']['name'][:20]:22} {prefix} → {split_prefix(got)[0]}"
                  f"  ({addr[:40]})", file=sys.stderr)
            continue
        if got and not is_broken(got):
            stat["깨끗하게 복구"] += 1
        elif prefix and region_check(prefix, regions) == "sigungu":
            # 번지는 잃지만 지역은 사실이고, 다음 재수집에서 풀린다
            got, _ = prefix, stat.update(["접두만 남김"])
        else:
            stat["실패(그대로 둔다)"] += 1
            continue
        rows.append((p["poi"]["name"], addr, got))
        if args.write:
            prov["address"] = got

    print(f"[주소보정] {dict(stat.most_common())}", file=sys.stderr)
    for name, before, after in rows[:15]:
        print(f"   {name[:20]:22} {before[:44]:46}\n        → {after}", file=sys.stderr)
    if len(rows) > 15:
        print(f"   … 그리고 {len(rows) - 15}곳", file=sys.stderr)

    if not args.write:
        print("[주소보정] --write 없음 — 아무것도 안 바꿨다", file=sys.stderr)
        return 0
    args.pois.write_text(dumps_doc(doc), encoding="utf-8")  # 공유본 형식은 한 곳에서(`merge_pois_docs.dumps_doc`)
    print(f"[주소보정] {len(rows)}곳 고쳤다 → {args.pois}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
