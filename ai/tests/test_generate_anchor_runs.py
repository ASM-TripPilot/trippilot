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


# ── 리뷰 지적 회귀 (고정 블록·기간 밖·차선책) ─────────────────────────────


def _aba_body(pois_far: float = _FAR) -> tuple[dict, date]:
    body = _two_region_body()
    body["anchors"][1]["lat"] = _ANCHOR.lat + pois_far
    day3 = _DAY2 + timedelta(days=1)
    body["anchors"].append({"date": day3.isoformat(), "lat": _ANCHOR.lat, "lng": _ANCHOR.lng})
    body["time_windows"].append({"date": day3.isoformat(), "start": "09:00", "end": "21:00"})
    body["trip_context"]["end_date"] = day3.isoformat()
    return body, day3


def test_다른_구간의_고정_장소를_앞_구간이_자유_배치하지_않는다() -> None:
    """구간마다 자기 날짜 고정 블록만 넘기면 다른 날 고정 POI 를 자유 후보에서 빼는 장치가
    앞 구간에서 안 돈다 — 1일차가 p1 을 자유 배치하고 3일차 고정 p1 이 또 나왔다(리뷰 재현)."""
    body, day3 = _aba_body()
    body["fixed_blocks"] = [{"poi_id": "p1", "date": day3.isoformat(), "start": "10:00",
                             "dwell_min": 60}]

    response = make_client(pois=_POIS + _FAR_SET).post("/ai/v1/itinerary/generate", json=body)

    assert response.status_code == 200, response.text
    ids = [s["poi_id"] for d in response.json()["days"] for s in d["slots"]]
    assert len(ids) == len(set(ids)), ids
    assert "p1" in _day_ids(response.json(), day3)


def test_기간_밖_필수방문은_한_번_보고된다() -> None:
    """기간 밖 블록은 어느 구간 날짜에도 안 속해 전부 걸러지면 OUT_OF_RANGE 판정이 사라진다."""
    body = _two_region_body()
    body["fixed_blocks"] = [{"poi_id": "p4", "date": (_DAY1 - timedelta(days=5)).isoformat(),
                             "start": "10:00", "dwell_min": 60}]

    response = make_client(pois=_POIS + _FAR_SET).post("/ai/v1/itinerary/generate", json=body)

    assert response.status_code == 200, response.text
    reported = [(u["poi_id"], u["reason_code"]) for u in response.json()["unplaced_must_visits"]]
    assert reported == [("p4", "OUT_OF_RANGE")]


def test_차선책은_다른_구간에_배치된_장소를_가리키지_않는다() -> None:
    """차선책 계약은 "미배치 후보만" — 앞 구간은 뒤 구간이 무엇을 놓을지 모른다."""
    near = tuple(_poi(i, 0.002 * (i - 1)) for i in range(1, 19))
    body, _ = _aba_body()

    response = make_client(pois=near + _FAR_SET).post("/ai/v1/itinerary/generate", json=body)

    assert response.status_code == 200, response.text
    days = response.json()["days"]
    placed = {s["poi_id"] for d in days for s in d["slots"]}
    collisions = [(s["poi_id"], a["poi_id"]) for d in days for s in d["slots"]
                  for a in s.get("alternatives", []) if a["poi_id"] in placed]
    assert collisions == []


def test_시한이_바닥이면_남은_구간을_한_번에_풀고_그_사실을_남긴다() -> None:
    """구간마다 고정 비용(풀·날씨·거리)이 붙는다 — 몫이 어셈블리 바닥보다 작은데 계속 쪼개면
    백스톱 504 로 앞 구간 성공분까지 잃는다. 접으면 뒤 지역이 앞 앵커에 매달리므로 알린다."""
    body = _two_region_body()
    body["request_meta"]["deadline_ms"] = 6_000  # 이틀 → 구간당 3s < 바닥 5s

    response = make_client(pois=_POIS + _FAR_SET).post("/ai/v1/itinerary/generate", json=body)

    assert response.status_code == 200, response.text
    assert "generate:anchor_runs_folded" in response.json()["degradations"]
    assert [d["date"] for d in response.json()["days"]] == [_DAY1.isoformat(), _DAY2.isoformat()]
