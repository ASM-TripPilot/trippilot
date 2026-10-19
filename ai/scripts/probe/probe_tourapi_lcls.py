"""TourAPI 분류 체계 이관 탐침 — 옛 cat1~3 이 비고 lclsSystm1~3 만 오는 항목이 얼마나 되나.

법정동 목록으로 바꾼 뒤 서울·부산·제주 관광지(12) 신규 993건 중 99% 가 `category_unmapped`
(옛 cat 코드로 카테고리를 정한다)로 버려졌다(10-19 run 39204955114). 지역 코드와 같은 이관인지 잰다.
읽기 전용, 호출 약 10건.
"""

from __future__ import annotations

import collections
import json
import os
import sys
import time
import urllib.parse
import urllib.request

_BASE = "https://apis.data.go.kr/B551011/KorService2"


def call(endpoint: str, **params: str) -> dict:
    q = {"serviceKey": os.environ["TOUR_API_KEY"], "MobileOS": "ETC", "MobileApp": "TripPilot",
         "_type": "json", **params}
    for n in range(3):
        try:
            with urllib.request.urlopen(f"{_BASE}/{endpoint}?{urllib.parse.urlencode(q)}", timeout=20) as r:
                return json.load(r)["response"]
        except Exception as e:  # noqa: BLE001
            print(f"  (재시도 {n + 1}: {type(e).__name__})")
            time.sleep(5 * (n + 1))
    return {}


def items(resp: dict) -> list[dict]:
    body = resp.get("body") or {}
    it = body.get("items") if isinstance(body.get("items"), dict) else {}
    x = (it or {}).get("item")
    return x if isinstance(x, list) else [x] if isinstance(x, dict) else []


def codes() -> int:
    """④ 새 분류 체계 이름표 — lclsSystmCode2 (대분류 → 중분류)."""
    print("## ④ lclsSystm 코드표\n")
    tops = items(call("lclsSystmCode2", numOfRows="100", pageNo="1"))
    for t in tops:
        c1 = t.get("lclsSystm1Cd") or t.get("code")
        print(f"- **{c1}** {t.get('lclsSystm1Nm') or t.get('name')}")
        for m in items(call("lclsSystmCode2", lclsSystm1=str(c1), numOfRows="100", pageNo="1")):
            print(f"  - {m.get('lclsSystm2Cd') or m.get('code')} {m.get('lclsSystm2Nm') or m.get('name')}")
    if tops:
        print("\n원문 키:", sorted(tops[0]))
    return 0


def main() -> int:
    if os.environ.get("PROBE_CODES"):
        return codes()
    keys = ("cat1", "cat2", "cat3", "lclsSystm1", "lclsSystm2", "lclsSystm3", "areacode", "lDongRegnCd")
    print("## ① 빠진 명소의 분류 칸\n")
    print("| 검색어 | contentid | 제목 | " + " | ".join(keys) + " |")
    print("|" + "---|" * (3 + len(keys)))
    for kw in ("경복궁", "해운대해수욕장", "광안리해수욕장", "감천문화마을", "천지연폭포", "남산서울타워"):
        for it in items(call("searchKeyword2", keyword=kw, numOfRows="2", pageNo="1"))[:2]:
            print(f"| {kw} | {it.get('contentid')} | {it.get('title')} | "
                  + " | ".join(repr(it.get(k)) for k in keys) + " |")
    print("\n## ② 서울 관광지 목록 100건 — 옛 cat 칸 / 새 lcls 칸 채움\n")
    rows = items(call("areaBasedList2", lDongRegnCd="11", contentTypeId="12", numOfRows="100", pageNo="1"))
    filled = collections.Counter()
    for it in rows:
        filled["cat1"] += bool(it.get("cat1"))
        filled["lclsSystm1"] += bool(it.get("lclsSystm1"))
        filled["cat 비고 lcls 있음"] += (not it.get("cat1")) and bool(it.get("lclsSystm1"))
        filled["areacode 빈"] += not it.get("areacode")
    print(f"표본 {len(rows)} · " + " · ".join(f"{k} {v}" for k, v in filled.items()))
    combos = collections.Counter((it.get("lclsSystm1"), it.get("lclsSystm2")) for it in rows)
    print("\nlclsSystm1·2 분포:", combos.most_common(20))
    print("\n## ③ 상세 한도 — detailIntro2 1건\n")
    r = call("detailIntro2", contentId="126508", contentTypeId="12")
    print("header:", (r.get("header") or {}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
