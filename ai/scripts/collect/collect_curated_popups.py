"""웹에서 고른 팝업스토어(`data/curated_popups.json`) → 행사 저장소에 POPUP 으로 등록.

팝업은 **기간 달린 정보이지 POI가 아니다** — 행사로 싣는다(`domain/event.py`). 후보 풀에
들어가지 않고 근처 1km 장소에 가산점만 준다(`event_affinity`, INV-1). 끝난 지 7일이 지나면
저장소가 지운다(`purge_expired`) — 장소 DB 에 넣으면 지울 길이 없다.

좌표는 카카오 주소검색으로 채운다(행사 수집과 같은 클라이언트·같은 약관 해석). 못 채워도
행사는 남는다(근처 부착만 빠진다 — 저장소 규약). 이미 끝난 팝업은 싣지 않는다.

    cd ai
    uv run --env-file ../../.env python scripts/collect/collect_curated_popups.py \\
        --store data/collected_events.json

매일 행사 수집(`ai-event-collect.yml`) 뒤에도 돈다 — 저장소가 중복을 거르므로 몇 번 돌려도 같다.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import sys
from pathlib import Path

_AI = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_AI / "src"))

from trippilot.background.event_store import JsonEventStore  # noqa: E402
from trippilot.background.kakao_local import KakaoLocalClient  # noqa: E402
from trippilot.background.naver_search import UrllibHttpClient  # noqa: E402
from trippilot.domain.event import EventInfo, EventType  # noqa: E402

KST = dt.timezone(dt.timedelta(hours=9))


def region_of(event: EventInfo) -> str:
    """주소 첫 낱말 = 행사 저장소의 지역 이름("서울 성동구 …" → 서울). 목록은 그 꼴로만 적는다."""
    return (event.address or "").split()[0]


def to_events(popups: list[dict], today: dt.date) -> list[EventInfo]:
    """끝나지 않은 팝업 → 좌표 없는 EventInfo. id 는 이름+시작일 해시라 재실행해도 같다."""
    out = []
    for p in popups:
        start, end = dt.date.fromisoformat(p["start"]), dt.date.fromisoformat(p["end"])
        if end < today:
            continue
        digest = hashlib.sha1(f"{p['name']}|{p['start']}".encode()).hexdigest()[:16]
        out.append(EventInfo(event_id=f"popup-{digest}", name=p["name"], event_type=EventType.POPUP,
                             start=start, end=end, coord=None, address=p["address"]))
    return out


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--seed", type=Path, default=_AI / "data" / "curated_popups.json")
    ap.add_argument("--store", type=Path,
                    default=Path(os.environ.get("EVENTS_STORE") or _AI / "data" / "collected_events.json"))
    args = ap.parse_args(argv)
    now = dt.datetime.now(KST)
    events = to_events(json.loads(args.seed.read_text(encoding="utf-8"))["popups"], now.date())

    key = os.environ.get("KAKAO_REST_API_KEY") or os.environ.get("KAKAO_CLIENT_ID")
    if key:
        kakao = KakaoLocalClient(UrllibHttpClient(), key, max_calls=len(events))
        events = [e if (c := kakao.address_to_coord(e.address or "")) is None
                  else EventInfo(e.event_id, e.name, e.event_type, e.start, e.end, c, e.address)
                  for e in events]
    else:
        print("[popups] 카카오 키 없음 — 좌표 없이 싣는다(근처 가산점은 빠진다)", file=sys.stderr)

    store = JsonEventStore(args.store)
    added = backfilled = 0
    for region in sorted({region_of(e) for e in events}):
        a, b = store.upsert(region, [e for e in events if region_of(e) == region], now,
                            covered=False, authoritative=True)
        added, backfilled = added + a, backfilled + b
    store.save()
    print(f"[popups] 진행 중 {len(events)}건 · 좌표 {sum(e.coord is not None for e in events)} · "
          f"신규 {added} · 좌표백필 {backfilled} → {args.store}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
