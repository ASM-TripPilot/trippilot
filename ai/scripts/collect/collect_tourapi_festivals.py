"""TourAPI 공식 축제·행사(`searchFestival2`) → 행사 저장소(FESTIVAL).

매일 행사 수집은 네이버 검색 + LLM 추출이라 **보도에 오른 것만** 잡힌다. 지자체가 TourAPI 에
등록한 축제는 기간·주소·좌표가 원천에서 오므로 지오코딩 없이 근처 가산점(1km)에 바로 쓰인다.
Plan-B "동선 근처 오늘 행사" 판정도 같은 저장소를 읽는다.

    전국을 한 번에 쪽(100건) 단위로 받는다 — 오늘 이후에도 열려 있는 것만(`eventStartDate`=오늘)
    지역은 항목의 법정동 시도 코드(`lDongRegnCd`)로 읽는다. `areaCode` 로 거르면 0건이다(KorService2 이관)
    POI 수집과 같은 키링을 뒤 키부터 쓴다 · 하루 5~15호출

키: TOUR_API_KEY(필수) · TOUR_API_KEY2 · TOUR_API_KEY3 — `collect_pois.py` 와 같다.
매일 행사 수집(`ai-event-collect.yml`) 뒤에 돈다. 저장소가 중복을 거르므로 몇 번 돌려도 같다.
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

_AI = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_AI / "src"))

from trippilot.background.event_store import JsonEventStore  # noqa: E402
from trippilot.domain.common import GeoPoint  # noqa: E402
from trippilot.domain.event import EventInfo, EventType  # noqa: E402
from trippilot.poi_curation.sourcing.tourapi import TourApiAdapter, UrllibHttpClient  # noqa: E402
from trippilot.ports.poi_sourcing_port import SourcingError  # noqa: E402

KST = dt.timezone(dt.timedelta(hours=9))
ROWS = 100
_MAX_PAGES = 15   # ponytail: 전국 1,500건 상한 — 잘리면 로그에 남긴다, 넘치면 올린다

# 법정동 시도 코드 → 행사 저장소 지역 이름(`collect_events.DEFAULT_REGIONS` 와 같은 낱말).
# 강원·전북은 특별자치도 전환으로 코드가 바뀌었다(42→51, 45→52) — 둘 다 받는다.
LDONG_REGION = {
    "11": "서울", "26": "부산", "27": "대구", "28": "인천", "29": "광주", "30": "대전",
    "31": "울산", "36": "세종", "41": "경기", "42": "강원", "51": "강원", "43": "충북",
    "44": "충남", "45": "전북", "52": "전북", "46": "전남", "47": "경북", "48": "경남", "50": "제주",
    "12": "전남",   # 전남광주통합특별시(광주·전남 통합) — 10-18 탐침: 옛 29·46 은 0건
}


def _date(v: object) -> dt.date | None:
    try:
        return dt.datetime.strptime(str(v), "%Y%m%d").date()
    except ValueError:
        return None


def _coord(item: dict) -> GeoPoint | None:
    """mapy=위도·mapx=경도. TourAPI 는 결측을 "0"·"" 로 준다 — 결측은 결측으로(근처 부착만 빠진다)."""
    try:
        lat, lng = float(item.get("mapy") or 0), float(item.get("mapx") or 0)
    except ValueError:
        return None
    return GeoPoint(lat, lng) if lat and lng else None


# 주소 첫 낱말 → 지역 — 법정동 코드가 비어 오는 항목의 보충(10-18 첫 실행: 220건 중 24건, 전남·광주 0건).
_ADDR_REGION = {
    "서울": "서울", "부산": "부산", "대구": "대구", "인천": "인천", "광주": "광주", "대전": "대전",
    "울산": "울산", "세종": "세종", "경기": "경기", "강원": "강원", "충청북도": "충북", "충북": "충북",
    "충청남도": "충남", "충남": "충남", "전라북도": "전북", "전북": "전북", "전라남도": "전남",
    "전남": "전남", "경상북도": "경북", "경북": "경북", "경상남도": "경남", "경남": "경남", "제주": "제주",
}


def region_of(item: dict) -> str | None:
    """`lDongRegnCd`(앞 두 자리)로 지역, 비었으면 주소 첫 낱말로. 둘 다 모르면 None — 지어내지 않는다."""
    if (region := LDONG_REGION.get(str(item.get("lDongRegnCd") or "")[:2])):
        return region
    head = (str(item.get("addr1") or "").split() or [""])[0]
    return next((r for prefix, r in _ADDR_REGION.items() if head.startswith(prefix)), None)


def to_event(item: dict, today: dt.date) -> EventInfo | None:
    """끝나지 않았고 기간·이름이 온전한 것만. id 는 contentid 라 재실행해도 같다."""
    start, end = _date(item.get("eventstartdate")), _date(item.get("eventenddate"))
    name, ref = str(item.get("title") or "").strip(), str(item.get("contentid") or "").strip()
    if not (start and end and name and ref) or end < today or end < start:
        return None
    return EventInfo(event_id=f"tourapi-{ref}", name=name, event_type=EventType.FESTIVAL,
                     start=start, end=end, coord=_coord(item),
                     address=str(item.get("addr1") or "").strip() or None)


def fetch_page(adapter: TourApiAdapter, open_from: str, page: int,
               attempts: int = 3, pause_sec: float = 5.0) -> tuple[list[dict], int] | None:
    """한 쪽을 받는다 — 실패하면 한 번 더, 그래도 실패면 None(경고 로그).

    data.go.kr 은 GitHub 러너에서 SSL 핸드셰이크가 가끔 끊긴다 — POI 수집도 같은 오류로 쪽을
    건너뛴다(10-17 런). 첫 실행이 첫 호출에서 이걸 맞아 통째로 날아갔다(10-18, #1336).
    끊김은 몇 초씩 이어진다 — 바로 다시 부르면 또 끊겼다(10-18 run 39135854660: 2회 연속).
    그래서 시도 사이를 점점 벌린다(5s·10s). 받지 못한 날도 저장소의 어제 것은 그대로 남는다.
    """
    for n in range(1, attempts + 1):
        try:
            return adapter.search_festivals(open_from, page, ROWS)
        except SourcingError as e:
            print(f"[festivals] WARNING {page}쪽 실패({n}/{attempts}): {e}", file=sys.stderr)
            if n < attempts:
                time.sleep(pause_sec * n)
    return None


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--store", type=Path,
                    default=Path(os.environ.get("EVENTS_STORE") or _AI / "data" / "collected_events.json"))
    args = ap.parse_args(argv)
    # 키는 **뒤에서부터** 쓴다 — POI 수집이 1번 키부터 키당 상한까지 채우므로, 마지막 키가
    # 그날 가장 덜 쓰인다(겹쳐도 POI 쪽 키링이 한도 소진 키를 퇴출하고 다음 키로 넘어간다)
    keys = [k for k in (os.environ.get(f"TOUR_API_KEY{s}") for s in ("3", "2", "")) if k]
    if not keys:
        print("[festivals] TOUR_API_KEY 없음 — 생략", file=sys.stderr)
        return 0
    per_key = int(os.environ.get("FESTIVAL_CALLS_PER_KEY") or "30")
    adapter = TourApiAdapter(UrllibHttpClient(), keys[0], extra_keys=keys[1:],
                             calls_per_key=per_key if len(keys) > 1 else None)
    now = dt.datetime.now(KST)
    open_from = now.date().strftime("%Y%m%d")

    by_region: dict[str, list[EventInfo]] = defaultdict(list)
    stat: Counter[str] = Counter()
    page, total = 0, 1
    while page * ROWS < total:
        page += 1
        if page > _MAX_PAGES:
            stat["잘림(쪽 상한)"] += 1
            break
        got = fetch_page(adapter, open_from, page)
        if got is None:
            stat["쪽 실패"] += 1
            continue
        items, total = got
        stat["원문"] += len(items)
        for item in items:
            if (event := to_event(item, now.date())) is None:
                stat["끝남·결측"] += 1
            elif (region := region_of(item)) is None:
                stat["지역 불명"] += 1
            else:
                by_region[region].append(event)

    store = JsonEventStore(args.store)
    added = backfilled = 0
    for region, events in sorted(by_region.items()):
        a, b = store.upsert(region, events, now, covered=False)
        added, backfilled = added + a, backfilled + b
    store.save()
    kept = [e for es in by_region.values() for e in es]
    print(f"[festivals] {dict(stat)} → 진행·예정 {len(kept)}(좌표 {sum(e.coord is not None for e in kept)}) · "
          f"지역 {dict(Counter({r: len(es) for r, es in by_region.items()}).most_common())} · "
          f"신규 {added} · 좌표백필 {backfilled}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
