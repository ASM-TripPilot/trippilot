"""날짜별 앵커가 다른 generate — 지역이 바뀌는 여행이 첫 지역 하나로 접히지 않는다.

`_domain_generate_request` 가 `min(request.anchors, key=date)` 하나로 접어 풀·출발·귀착이 전부
첫 날 앵커에 매달렸다. "서울 2박 + 인천 1박" 의 2차 생성(2~4일차)은 앵커가 [서울, 인천, 인천]
으로 오는데 인천 이틀이 서울 장소로 채워졌다(2026-10-04 사용자 보고 — BE #932 가 날짜별 앵커를
실어 보내기 시작했지만 AI 가 접었다).

방향: 같은 앵커가 이어지는 날짜 구간마다 따로 푼다 — 앞 구간에 배치된 장소는 뒤 구간의 제외로
넘긴다(BE 2단계 생성과 같은 방식). 어셈블리·풀 조립은 손대지 않는다.

증명하는 것 (실 LLM·실 API 0):
  ① 두 지역 이틀 — 각 날의 장소가 그 날 앵커 쪽 지역에서만 나온다
  ② 앵커가 하나면 종전과 바이트 동일한 응답 (분할 없음)
  ③ 구간을 넘어 같은 장소가 두 번 나오지 않는다
"""

from __future__ import annotations

from dataclasses import replace
from datetime import date, timedelta

from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.poi import Poi

from tests.test_e2e_boundary import _ANCHOR, _POIS, _poi, _request, make_client

_DAY1 = date(2026, 8, 5)
_DAY2 = _DAY1 + timedelta(days=1)
# 위도 0.3° ≈ 33km 북쪽 — 대중교통 다일 반경(10km × 0.7)을 한참 넘는다
_FAR = 0.3


def _shifted(i: int) -> Poi:
    base = _poi(i, 0.005 * (i - 1))
    return replace(base, poi_id=PoiId(f"q{i}"), name=f"q{i}",
                   coord=GeoPoint(base.coord.lat + _FAR, base.coord.lng))


_NEAR_IDS = {str(p.poi_id) for p in _POIS}
_FAR_SET = tuple(_shifted(i) for i in range(1, 7))
_FAR_IDS = {str(p.poi_id) for p in _FAR_SET}


def _two_region_body() -> dict:
    body = _request(dates=(_DAY1, _DAY2))
    body["anchors"] = [
        {"date": _DAY1.isoformat(), "lat": _ANCHOR.lat, "lng": _ANCHOR.lng},
        {"date": _DAY2.isoformat(), "lat": _ANCHOR.lat + _FAR, "lng": _ANCHOR.lng},
    ]
    return body


def _day_ids(body: dict, day: date) -> list[str]:
    return [s["poi_id"] for d in body["days"] if d["date"] == day.isoformat()
            for s in d["slots"]]


def test_날짜마다_그_날_앵커_쪽_장소로_짠다() -> None:
    client = make_client(pois=_POIS + _FAR_SET)

    response = client.post("/ai/v1/itinerary/generate", json=_two_region_body())

    assert response.status_code == 200, response.text
    body = response.json()
    day1, day2 = _day_ids(body, _DAY1), _day_ids(body, _DAY2)
    assert day1 and set(day1) <= _NEAR_IDS, day1
    assert day2 and set(day2) <= _FAR_IDS, f"2일차가 1일차 지역에 매달렸다: {day2}"


def test_구간을_넘어_같은_장소가_두_번_나오지_않는다() -> None:
    client = make_client(pois=_POIS + _FAR_SET)
    body = _two_region_body()
    # 셋째 날을 첫 지역으로 되돌린다 — A·B·A 세 구간, 첫·셋째가 같은 풀을 본다
    day3 = _DAY2 + timedelta(days=1)
    body["anchors"].append({"date": day3.isoformat(), "lat": _ANCHOR.lat, "lng": _ANCHOR.lng})
    body["time_windows"].append({"date": day3.isoformat(), "start": "09:00", "end": "21:00"})
    body["trip_context"]["end_date"] = day3.isoformat()

    response = client.post("/ai/v1/itinerary/generate", json=body)

    assert response.status_code == 200, response.text
    ids = [s["poi_id"] for d in response.json()["days"] for s in d["slots"]]
    assert len(ids) == len(set(ids)), ids
    assert [d["date"] for d in response.json()["days"]] == [
        _DAY1.isoformat(), _DAY2.isoformat(), day3.isoformat()]


def test_앵커가_하나면_종전과_같은_응답이다() -> None:
    body = _request(dates=(_DAY1, _DAY2))

    first = make_client().post("/ai/v1/itinerary/generate", json=body)
    second = make_client(pois=_POIS + _FAR_SET).post("/ai/v1/itinerary/generate", json=body)

    assert first.status_code == second.status_code == 200
    assert first.json()["days"] == second.json()["days"]
