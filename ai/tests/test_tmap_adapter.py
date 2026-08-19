"""TmapRouteAdapter 검증 — 실 호출 0건 (fake HTTP만, D37) (TRIP-382·405).

픽스처는 TMAP 문서 형태 기준(자동차·보행 features[].properties / 대중교통
metaData.plan.itineraries[]) — 실 응답 드리프트는 실키 첫 실행(smoke_itinerary)
에서 검증한다.
  ① 매핑 — 초→분·미터→km, 좌표(X=경도·Y=위도), appKey 헤더, 요청 1건=호출 1건
  ② 수단 라우팅 — CAR /tmap/routes, WALK /tmap/routes/pedestrian,
     PUBLIC /transit/routes 실측 (근사 제거, TRIP-405)
  ③ 실패 승격 — HTTP 예외·형식 오류는 TravelTimeError (침묵 금지, INV-4)
"""

from __future__ import annotations

import pytest

from trippilot.solver_engine.adapters.tmap import TmapRouteAdapter
from trippilot.domain.common import GeoPoint, TransportMode
from trippilot.ports.travel_time_port import TravelTimeError

_FROM = GeoPoint(35.1587, 129.1604)  # 값 자체는 임의 (부산 근방)
_TO = GeoPoint(35.1796, 129.0756)


def _payload(total_time_sec: float, total_distance_m: float) -> dict:
    """문서 기준 응답 — totalTime 없는 선행 feature(경유 라인 등)를 섞어 탐색 검증."""
    return {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": {"index": 0, "pointType": "S"}},
            {"type": "Feature",
             "properties": {"totalTime": total_time_sec,
                            "totalDistance": total_distance_m}},
        ],
    }


class FakeHttp:
    """호출 기록 + 고정 응답(또는 예외) 1건."""

    def __init__(self, payload: object = None, error: Exception | None = None) -> None:
        self._payload = payload
        self._error = error
        self.calls: list[tuple[str, dict, dict]] = []

    def post_json(self, url: str, headers, body) -> object:
        self.calls.append((url, dict(headers), dict(body)))
        if self._error is not None:
            raise self._error
        return self._payload


# ── ① 매핑 ───────────────────────────────────────────────────────────


def test_maps_seconds_to_minutes_and_meters_to_km():
    http = FakeHttp(_payload(1830, 12345))
    measured = TmapRouteAdapter(http, "k").measure(_FROM, _TO, TransportMode.CAR)
    assert measured.real_minutes == 30.5  # 1830초 → 30.5분
    assert measured.distance_km == 12.345  # 12345m → 12.345km
    assert len(http.calls) == 1  # 메서드 1회 = HTTP 1건 (재시도 없음)


def test_sends_app_key_header_and_xy_coordinates():
    http = FakeHttp(_payload(60, 1000))
    TmapRouteAdapter(http, "secret-key").measure(_FROM, _TO, TransportMode.CAR)
    url, headers, body = http.calls[0]
    assert headers["appKey"] == "secret-key"
    # TMAP은 X=경도, Y=위도 (문자열)
    assert (body["startX"], body["startY"]) == (str(_FROM.lng), str(_FROM.lat))
    assert (body["endX"], body["endY"]) == (str(_TO.lng), str(_TO.lat))


# ── ② 수단 라우팅 ────────────────────────────────────────────────────


def test_car_uses_routes_endpoint_without_approximation():
    http = FakeHttp(_payload(60, 1000))
    measured = TmapRouteAdapter(http, "k").measure(_FROM, _TO, TransportMode.CAR)
    assert http.calls[0][0].endswith("/tmap/routes")
    assert measured.approximated is False
    assert measured.source == "tmap_car"


def test_walk_uses_pedestrian_endpoint():
    http = FakeHttp(_payload(60, 1000))
    measured = TmapRouteAdapter(http, "k").measure(_FROM, _TO, TransportMode.WALK)
    assert http.calls[0][0].endswith("/tmap/routes/pedestrian")
    assert measured.approximated is False
    assert measured.source == "tmap_pedestrian"


def _transit_payload(itineraries: list) -> dict:
    return {"metaData": {"requestParameters": {}, "plan": {"itineraries": itineraries}}}


def test_public_uses_transit_endpoint_without_approximation():
    """대중교통 실측 (TRIP-405) — 보행 근사 제거, count=1·version 불요."""
    http = FakeHttp(_transit_payload([{"totalTime": 2400, "totalDistance": 8000}]))
    measured = TmapRouteAdapter(http, "k").measure(_FROM, _TO, TransportMode.PUBLIC)
    url, headers, body = http.calls[0]
    assert url.endswith("/transit/routes")
    assert headers["appKey"] == "k"
    assert body["count"] == 1
    assert "version" not in body  # 자동차·보행 전용 필드
    assert measured.approximated is False
    assert measured.source == "tmap_transit"
    assert measured.real_minutes == 40.0  # 2400초
    assert measured.distance_km == 8.0


def test_transit_falls_back_to_legs_distance_sum():
    """totalDistance 없는 경로 — legs[].distance 합산 (문서상 표기 갈림 방어)."""
    http = FakeHttp(_transit_payload([
        {"totalTime": 600,
         "legs": [{"distance": 300}, {"mode": "TRANSFER"}, {"distance": 700}]},
    ]))
    measured = TmapRouteAdapter(http, "k").measure(_FROM, _TO, TransportMode.PUBLIC)
    assert measured.real_minutes == 10.0
    assert measured.distance_km == 1.0  # 300 + 700 = 1000m


@pytest.mark.parametrize("payload", [
    {"result": {"status": 11, "message": "출발지 도착지 간 거리가 너무 가깝습니다"}},  # itineraries 없음
    {"metaData": {"plan": {"itineraries": [{"fare": {}}]}}},  # totalTime 없음
    {"metaData": {"plan": {"itineraries": [{"totalTime": 600}]}}},  # 거리 정보 전무
])
def test_transit_malformed_payload_raises(payload):
    adapter = TmapRouteAdapter(FakeHttp(payload), "k")
    with pytest.raises(TravelTimeError):
        adapter.measure(_FROM, _TO, TransportMode.PUBLIC)


# ── ③ 실패 승격 ──────────────────────────────────────────────────────


def test_http_failure_raises_travel_time_error_with_cause():
    boom = OSError("connection refused")
    adapter = TmapRouteAdapter(FakeHttp(error=boom), "k")
    with pytest.raises(TravelTimeError) as exc:
        adapter.measure(_FROM, _TO, TransportMode.CAR)
    assert exc.value.__cause__ is boom


@pytest.mark.parametrize("payload", [
    "not-a-dict",                                     # JSON 객체 아님
    {},                                               # features 없음
    {"features": [{"properties": {"index": 0}}]},     # totalTime 있는 feature 없음
    {"features": [{"properties": {"totalTime": 60}}]},  # totalDistance 누락
])
def test_malformed_payload_raises_travel_time_error(payload):
    adapter = TmapRouteAdapter(FakeHttp(payload), "k")
    with pytest.raises(TravelTimeError):
        adapter.measure(_FROM, _TO, TransportMode.WALK)
