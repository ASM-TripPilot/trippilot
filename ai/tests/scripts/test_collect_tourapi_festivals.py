"""TourAPI 공식 축제 → 행사(FESTIVAL) — 끝난 것·결측 거르기, 좌표 결측, 키링 경유 호출 (2026-10-18)."""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts" / "collect"))

from collect_tourapi_festivals import region_of, to_event  # noqa: E402

from trippilot.domain.event import EventType  # noqa: E402
from trippilot.poi_curation.sourcing.tourapi import TourApiAdapter  # noqa: E402

_TODAY = dt.date(2026, 10, 18)


def _item(**kw) -> dict:
    base = {"contentid": "3500001", "title": "서울세계불꽃축제", "addr1": "서울특별시 영등포구 여의동로 330",
            "eventstartdate": "20261003", "eventenddate": "20261025", "mapx": "126.93", "mapy": "37.52",
            "lDongRegnCd": "11"}
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
    items, total = TourApiAdapter(http, "K").search_festivals("20261018", 1, 100)
    assert (len(items), total) == (1, 1)
    url, params = http.calls[0]
    assert url.endswith("/searchFestival2")
    assert params["serviceKey"] == "K" and params["eventStartDate"] == "20261018"
    assert "areaCode" not in params    # KorService2 에서 areaCode 로 거르면 0건(10-18 실측)


def test_지역은_법정동_시도_코드로_읽고_모르는_코드는_지어내지_않는다() -> None:
    assert region_of(_item(lDongRegnCd="50")) == "제주"
    assert region_of(_item(lDongRegnCd="51")) == region_of(_item(lDongRegnCd="42")) == "강원"
    assert region_of(_item(lDongRegnCd="", addr1="전라남도 여수시 돌산읍")) == "전남"   # 코드가 비면 주소로
    assert region_of(_item(lDongRegnCd="", addr1="광주광역시 동구")) == "광주"
    assert region_of(_item(lDongRegnCd="", addr1="")) is None


class _Flaky:
    """처음 `fails` 번은 끊기고 그 뒤로 응답한다 — data.go.kr SSL 핸드셰이크 시간 초과 재현."""

    def __init__(self, fails: int) -> None:
        self.fails = fails

    def search_festivals(self, open_from, page, rows):
        from trippilot.ports.poi_sourcing_port import SourcingError
        if self.fails:
            self.fails -= 1
            raise SourcingError("searchFestival2 호출 실패: URLError: handshake timed out")
        return [_item()], 1


def test_끊기면_간격을_두고_다시_받고_세_번_끊기면_그_쪽만_건너뛴다() -> None:
    from collect_tourapi_festivals import fetch_page
    assert fetch_page(_Flaky(2), "20261018", 1, pause_sec=0) == ([_item()], 1)   # 두 번 끊겨도 세 번째에
    assert fetch_page(_Flaky(3), "20261018", 1, pause_sec=0) is None
