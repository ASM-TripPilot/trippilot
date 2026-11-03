"""여행코스(25) 수집 — 목록 → 구성(detailInfo2) → 한 줄에 코스 하나 (KB-5 요청, 2026-11-02). 실 호출 0."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts" / "collect"))

import collect_tour_courses as C  # noqa: E402
from trippilot.poi_curation.sourcing.tourapi import TourApiAdapter  # noqa: E402

from tests.fakes.fake_tourapi_http import FakeTourApiHttp, envelope, list_item  # noqa: E402


def _sub(cid: str, name: str, num: str) -> dict:
    return {"contentid": "900", "subcontentid": cid, "subname": name, "subnum": num}


def test_코스_구성은_순서대로_번호_없는_칸은_빼고_순서를_모르면_맨_뒤() -> None:
    http = FakeTourApiHttp(infos={"900": envelope([
        _sub("126508", "경복궁", "1"), _sub("", "이름만", "2"), _sub("126535", "남산서울타워", "0"),
        _sub("2733967", "광장시장", "")], 4)})
    got = TourApiAdapter(http, "k").fetch_course("900")
    assert got == (("126535", "남산서울타워", 0), ("126508", "경복궁", 1), ("2733967", "광장시장", None))
    (url, params), = http.calls
    assert url.endswith("/detailInfo2") and params["contentTypeId"] == "25"


def test_목록은_전국으로_끝까지_받고_지역을_걸지_않는다() -> None:
    """코스는 지역 칸이 대부분 비어 지역을 걸면 1,068개 중 수십 개만 온다(11-03 실측: 서울·제주 0)."""
    http = FakeTourApiHttp(pages={
        ("25", 1): envelope([list_item("900", "서울 궁궐 코스", contenttypeid="25", addr1="")], 101),
        ("25", 2): envelope([list_item("901", "남산 코스", contenttypeid="25", addr1="서울 중구 남산공원길 105")],
                            101, page_no=2),
    })
    got = C.list_courses(TourApiAdapter(http, "k"))
    assert got == [("900", "서울 궁궐 코스", ""), ("901", "남산 코스", "서울 중구 남산공원길 105")]
    assert all("lDongRegnCd" not in p and "areaCode" not in p for _, p in http.calls)


def test_받은_코스는_다시_부르지_않고_한_줄에_시도_정식명과_구성을_싣는다() -> None:
    http = FakeTourApiHttp(infos={"901": envelope([_sub("126535", "남산서울타워", "1")], 1)})
    have = {"900": {"course_id": "900"}}
    calls, failed = C.collect(TourApiAdapter(http, "k"), [("900", "a", ""), ("901", "남산 코스", "서울 중구 1")], have,
                              lambda addr: {"서울 중구 1": "서울특별시"}.get(addr), 10, "2026-11-03")
    assert (calls, failed) == (1, 0)
    assert have["901"] == {"course_id": "901", "title": "남산 코스", "area": "서울특별시",
                           "members": [{"content_id": "126535", "name": "남산서울타워", "order": 1}],
                           "collected_on": "2026-11-03"}
