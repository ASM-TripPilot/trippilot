"""TourAPI 지역 코드 이관 탐침 — areaCode 로 거르면 법정동 코드(lDongRegnCd)보다 얼마나 덜 오나.

매일 POI 수집은 `areaBasedList2` 를 `areaCode` 로 부른다. KorService2 가 지역을 법정동 코드로
옮긴 뒤 `searchFestival2` 는 areaCode 로 0건이었다(10-18). 같은 일이 목록에도 일어나는지,
공유본에 없는 명소(경복궁·해운대해수욕장 …)가 그 때문인지 실호출로 잰다.

    ① 지역 × 유형마다 totalCount: areaCode=N vs lDongRegnCd=M (numOfRows=1 — 건수만)
    ② 빠진 명소를 searchKeyword2 로 찾아 areacode·lDongRegnCd 칸이 비었는지

읽기 전용 — 수집 상태·공유본을 건드리지 않는다. 호출 약 20건.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
import urllib.request

_BASE = "https://apis.data.go.kr/B551011/KorService2"
_AREAS = [("1", "11", "서울"), ("6", "26", "부산"), ("39", "50", "제주")]
_KINDS = [("12", "관광지"), ("39", "음식점")]
_MISSING = ["경복궁", "해운대해수욕장", "광안리해수욕장", "감천문화마을", "천지연폭포"]


def call(endpoint: str, **params: str) -> dict:
    q = {"serviceKey": os.environ["TOUR_API_KEY"], "MobileOS": "ETC", "MobileApp": "TripPilot",
         "_type": "json", **params}
    url = f"{_BASE}/{endpoint}?{urllib.parse.urlencode(q)}"
    for n in range(3):
        try:
            with urllib.request.urlopen(url, timeout=20) as r:
                return json.load(r)["response"]["body"]
        except Exception as e:  # noqa: BLE001 — 탐침: 끊기면 다시
            print(f"  (재시도 {n + 1}: {type(e).__name__})")
            time.sleep(5 * (n + 1))
    return {}


def items(body: dict) -> list[dict]:
    it = (body.get("items") or {}) if isinstance(body.get("items"), dict) else {}
    x = it.get("item")
    return x if isinstance(x, list) else [x] if isinstance(x, dict) else []


def sweep() -> int:
    """⑤ 알려진 코드 밖에서 살아 있는 시도 코드 찾기 — 광주·전남 통합(전남광주통합특별시)·세종."""
    known = {"11", "26", "27", "28", "30", "31", "41", "51", "43", "44", "52", "47", "48", "50"}
    print("## ⑤ 살아 있는 lDongRegnCd (알려진 14개 제외)\n")
    print("| lDongRegnCd | 관광지 | 표본 주소 |")
    print("|---|---|---|")
    for code in [str(c) for c in range(10, 61)] + ["36110", "3611"]:
        if code in known:
            continue
        b = call("areaBasedList2", lDongRegnCd=code, contentTypeId="12", numOfRows="1", pageNo="1")
        if b.get("totalCount"):
            print(f"| {code} | {b.get('totalCount')} | {(items(b) or [{}])[0].get('addr1', '')} |")
    for kw in ("세종호수공원", "국립세종도서관", "무등산", "양림동"):
        for it in items(call("searchKeyword2", keyword=kw, numOfRows="2", pageNo="1"))[:2]:
            print(f"| {kw} → {it.get('lDongRegnCd')!r} / {it.get('lDongSignguCd')!r} | | {it.get('addr1')} |")
    return 0


def main() -> int:
    if os.environ.get("PROBE_CODES") == "sweep":
        return sweep()
    if os.environ.get("PROBE_CODES"):
        return codes()
    print("## ① 목록 총 건수 — areaCode vs lDongRegnCd\n")
    print("| 지역 | 유형 | areaCode | lDongRegnCd | 비율 |")
    print("|---|---|---|---|---|")
    for area, ldong, name in _AREAS:
        for kind, kname in _KINDS:
            a = call("areaBasedList2", areaCode=area, contentTypeId=kind, numOfRows="1", pageNo="1")
            b = call("areaBasedList2", lDongRegnCd=ldong, contentTypeId=kind, numOfRows="1", pageNo="1")
            ta, tb = a.get("totalCount"), b.get("totalCount")
            ratio = f"{ta / tb:.0%}" if isinstance(ta, int) and isinstance(tb, int) and tb else "-"
            print(f"| {name} | {kname} | {ta} | {tb} | {ratio} |")
    print("\n## ② 공유본에 없던 명소 — 지역 칸이 비었나\n")
    print("| 검색어 | contentid | 제목 | 유형 | areacode | lDongRegnCd | 수정일 |")
    print("|---|---|---|---|---|---|---|")
    for kw in _MISSING:
        for it in items(call("searchKeyword2", keyword=kw, numOfRows="3", pageNo="1"))[:3]:
            print(f"| {kw} | {it.get('contentid')} | {it.get('title')} | {it.get('contenttypeid')} | "
                  f"{it.get('areacode')!r} | {it.get('lDongRegnCd')!r} | {it.get('modifiedtime')} |")
    return 0


def codes() -> int:
    """③ 법정동 시도 코드 17개(+ 강원·전북 옛 코드)의 관광지 건수와 표본 주소 — 어느 코드가 살아 있나,
    ④ 옛 areaCode 31~39 의 표본 주소 — 리포 `AREA_NAMES` 가 맞나."""
    print("## ③ lDongRegnCd 별 관광지 건수 · 표본 주소\n")
    print("| lDongRegnCd | 관광지 | 표본 주소 |")
    print("|---|---|---|")
    for code in ("11", "26", "27", "28", "29", "30", "31", "36", "41", "42", "51",
                 "43", "44", "45", "52", "46", "47", "48", "50"):
        b = call("areaBasedList2", lDongRegnCd=code, contentTypeId="12", numOfRows="1", pageNo="1")
        first = (items(b) or [{}])[0]
        print(f"| {code} | {b.get('totalCount')} | {first.get('addr1', '')} |")
    print("\n## ④ 옛 areaCode 표본 주소\n")
    print("| areaCode | 관광지 | 표본 주소 |")
    print("|---|---|---|")
    for code in ("31", "32", "33", "34", "35", "36", "37", "38", "39"):
        b = call("areaBasedList2", areaCode=code, contentTypeId="12", numOfRows="1", pageNo="1")
        first = (items(b) or [{}])[0]
        print(f"| {code} | {b.get('totalCount')} | {first.get('addr1', '')} |")
    return 0


if __name__ == "__main__":
    sys.exit(main())
