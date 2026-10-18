"""TourAPI 공식 축제 → 행사(FESTIVAL) — 끝난 것·결측 거르기, 좌표 결측, 키링 경유 호출 (2026-10-18)."""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts" / "collect"))

from collect_tourapi_festivals import to_event  # noqa: E402

from trippilot.domain.event import EventType  # noqa: E402
from trippilot.poi_curation.sourcing.tourapi import TourApiAdapter  # noqa: E402

_TODAY = dt.date(2026, 10, 18)


def _item(**kw) -> dict:
    base = {"contentid": "3500001", "title": "서울세계불꽃축제", "addr1": "서울특별시 영등포구 여의동로 330",
            "eventstartdate": "20261003", "eventenddate": "20261025", "mapx": "126.93", "mapy": "37.52"}
    return {**base, **kw}


def test_진행_중인_축제는_좌표와_함께_FESTIVAL_로() -> None:
    e = to_event(_item(), _TODAY)
    assert e is not None and e.event_type is EventType.FESTIVAL and e.event_id == "tourapi-3500001"
    assert (e.coord.lat, e.coord.lng) == (37.52, 126.93)


def test_끝난_것_기간_없는_것은_싣지_않고_좌표_0_은_결측이다() -> None:
    assert to_event(_item(eventenddate="20261017"), _TODAY) is None
    assert to_event(_item(eventstartdate=""), _TODAY) is None
    assert to_event(_item(mapx="0", mapy="0"), _TODAY).coord is None


class _Http:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    def get_json(self, url, params):
        self.calls.append((url, dict(params)))
        return {"response": {"header": {"resultCode": "0000"},
                             "body": {"items": {"item": [_item()]}, "totalCount": 1}}}


def test_축제_목록은_searchFestival2_를_키와_함께_부른다() -> None:
    http = _Http()
    items, total = TourApiAdapter(http, "K").search_festivals("1", "20260620", 1, 100)
    assert (len(items), total) == (1, 1)
    url, params = http.calls[0]
    assert url.endswith("/searchFestival2")
    assert params["serviceKey"] == "K" and params["eventStartDate"] == "20260620"
