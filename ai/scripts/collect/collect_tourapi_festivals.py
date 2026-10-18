"""TourAPI 공식 축제·행사(`searchFestival2`) → 행사 저장소(FESTIVAL).

매일 행사 수집은 네이버 검색 + LLM 추출이라 **보도에 오른 것만** 잡힌다. 지자체가 TourAPI 에
등록한 축제는 기간·주소·좌표가 원천에서 오므로 지오코딩 없이 근처 가산점(1km)에 바로 쓰인다.
Plan-B "동선 근처 오늘 행사" 판정도 같은 저장소를 읽는다.

    지역 17곳 × 목록 1~2쪽(100건) ≈ 하루 20~35호출 — POI 수집과 같은 키링·같은 키당 상한을 나눠 쓴다
    시작일이 오늘 −120일 이후인 것만 받는다(그 전에 시작해 아직 하는 축제는 드물다) · 끝난 것은 싣지 않는다

키: TOUR_API_KEY(필수) · TOUR_API_KEY2 · TOUR_API_KEY3 — `collect_pois.py` 와 같다.
매일 행사 수집(`ai-event-collect.yml`) 뒤에 돈다. 저장소가 중복을 거르므로 몇 번 돌려도 같다.
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import sys
from pathlib import Path

_AI = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_AI / "src"))

from trippilot.background.event_store import JsonEventStore  # noqa: E402
from trippilot.domain.common import GeoPoint  # noqa: E402
from trippilot.domain.event import EventInfo, EventType  # noqa: E402
from trippilot.poi_curation.sourcing.pipeline import AREA_NAMES  # noqa: E402
from trippilot.poi_curation.sourcing.tourapi import TourApiAdapter, UrllibHttpClient  # noqa: E402

KST = dt.timezone(dt.timedelta(hours=9))
LOOKBACK_DAYS = 120
ROWS = 100
_MAX_PAGES = 3   # ponytail: 지역당 300건 상한 — 서울·경기도 실측 전엔 모른다, 잘리면 로그에 남긴다


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


def to_event(item: dict, today: dt.date) -> EventInfo | None:
    """끝나지 않았고 기간·이름이 온전한 것만. id 는 contentid 라 재실행해도 같다."""
    start, end = _date(item.get("eventstartdate")), _date(item.get("eventenddate"))
    name, ref = str(item.get("title") or "").strip(), str(item.get("contentid") or "").strip()
    if not (start and end and name and ref) or end < today or end < start:
        return None
    return EventInfo(event_id=f"tourapi-{ref}", name=name, event_type=EventType.FESTIVAL,
                     start=start, end=end, coord=_coord(item),
                     address=str(item.get("addr1") or "").strip() or None)


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
    since = (now.date() - dt.timedelta(days=LOOKBACK_DAYS)).strftime("%Y%m%d")

    store = JsonEventStore(args.store)
    totals = {"items": 0, "kept": 0, "coord": 0, "added": 0, "backfilled": 0, "truncated": []}
    for code, region in AREA_NAMES.items():
        events: list[EventInfo] = []
        for page in range(1, _MAX_PAGES + 1):
            items, total = adapter.search_festivals(code, since, page, ROWS)
            totals["items"] += len(items)
            events += [e for i in items if (e := to_event(i, now.date())) is not None]
            if page * ROWS >= total:
                break
        else:
            totals["truncated"].append(region)
        added, backfilled = store.upsert(region, events, now, covered=False)
        totals["kept"] += len(events)
        totals["coord"] += sum(e.coord is not None for e in events)
        totals["added"] += added
        totals["backfilled"] += backfilled
    store.save()
    print(f"[festivals] 원문 {totals['items']} → 진행·예정 {totals['kept']}(좌표 {totals['coord']}) · "
          f"신규 {totals['added']} · 좌표백필 {totals['backfilled']}"
          + (f" · ⚠ {_MAX_PAGES}쪽에서 잘림: {totals['truncated']}" if totals["truncated"] else ""),
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
