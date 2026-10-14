"""OdsayTransitAdapter·ByModeTravelTime 검증 — 실 호출 0건 (fake HTTP만, D37).

픽스처는 ODsay 문서 형태 기준(result.path[].info — totalTime **분**·totalDistance 미터) —
실 응답 드리프트는 실키 첫 실행에서 검증한다(TMAP 선례).
  ① 매핑 — 분 그대로·미터→km, 좌표(X=경도·Y=위도), apiKey 쿼리, 요청 1건=호출 1건, 첫 경로
  ② 실패 승격 — 본문 오류(객체·배열·errorCode)는 TravelTimeError + __cause__.code,
     HTTP 예외 메시지에 키가 실리지 않음, 대중교통 외 수단은 호출 없이 거부 (INV-4)
  ③ 수단별 1차 — PUBLIC 은 ODsay·CAR/WALK 는 TMAP, 미배선 수단은 TravelTimeError
  ④ 체인 합성 — ODsay -98(700m 이내) 은 하버사인 폴백 + 경고에 코드가 실린다
  ⑤ 조립 — main._travel_chain: 두 키·TMAP 만·ODsay 만·둘 다 없음
"""

from __future__ import annotations

import logging

import pytest

import main
from trippilot.assembly_engine.adapters.chained_travel import ByModeTravelTime, ChainedTravelAdapter
from trippilot.assembly_engine.adapters.odsay import OdsayApiError, OdsayTransitAdapter
from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.travel import TravelEstimator
from trippilot.domain.common import GeoPoint, TransportMode
from trippilot.ports.travel_time_port import MeasuredTravel, TravelTimeError

_FROM = GeoPoint(33.4996, 126.5312)  # 제주시청 근방 — 값 자체는 임의
_TO = GeoPoint(33.2541, 126.5601)  # 서귀포


def _payload(total_minutes: float, total_distance_m: float) -> dict:
    """문서 기준 응답 — info 없는 선행 path 를 섞어 탐색 검증."""
    return {"result": {"searchType": 0, "path": [
        {"pathType": 2},
        {"pathType": 2, "info": {"totalTime": total_minutes, "totalDistance": total_distance_m,
                                 "payment": 1150, "busTransitCount": 1}},
        {"pathType": 2, "info": {"totalTime": 999, "totalDistance": 999999}},
    ]}}


class FakeHttp:
    """호출 기록 + 고정 응답(또는 예외) 1건."""

    def __init__(self, payload: object = None, error: Exception | None = None) -> None:
        self._payload = payload
        self._error = error
        self.calls: list[tuple[str, dict]] = []

    def get_json(self, url: str, params) -> object:
        self.calls.append((url, dict(params)))
        if self._error is not None:
            raise self._error
        return self._payload


# ── ① 매핑 ───────────────────────────────────────────────────────────


def test_maps_minutes_as_is_and_meters_to_km_from_the_first_route():
    http = FakeHttp(_payload(47, 31250))
    measured = OdsayTransitAdapter(http, "k").measure(_FROM, _TO, TransportMode.PUBLIC)
    assert measured == MeasuredTravel(real_minutes=47.0, distance_km=31.25,
                                      source="odsay_transit", approximated=False)
    assert len(http.calls) == 1  # 메서드 1회 = HTTP 1건 (재시도 없음)


def test_sends_api_key_query_and_xy_coordinates():
    http = FakeHttp(_payload(10, 1000))
    OdsayTransitAdapter(http, "secret-key").measure(_FROM, _TO, TransportMode.PUBLIC)
    url, params = http.calls[0]
    assert url == "https://api.odsay.com/v1/api/searchPubTransPathT"
    assert params["apiKey"] == "secret-key"
    # ODsay 는 X=경도, Y=위도
    assert (params["SX"], params["SY"]) == (str(_FROM.lng), str(_FROM.lat))
    assert (params["EX"], params["EY"]) == (str(_TO.lng), str(_TO.lat))


# ── ② 실패 승격 ──────────────────────────────────────────────────────


@pytest.mark.parametrize("body", [
    {"error": {"code": "-98", "msg": "출발지와 도착지가 700m 이내"}},
    {"error": [{"code": "-98", "message": "too close"}]},
    {"result": None, "errorCode": -98},
])
def test_body_errors_become_travel_time_error_with_the_code_as_cause(body):
    with pytest.raises(TravelTimeError) as exc:
        OdsayTransitAdapter(FakeHttp(body), "k").measure(_FROM, _TO, TransportMode.PUBLIC)
    assert isinstance(exc.value.__cause__, OdsayApiError)
    assert exc.value.__cause__.code == "-98"


@pytest.mark.parametrize("body", [
    "not-a-dict",
    {"result": {}},
    {"result": {"path": [{"info": {"totalDistance": 100}}]}},
    {"result": {"path": [{"info": {"totalTime": 5}}]}},
])
def test_malformed_bodies_are_promoted_not_zeroed(body):
    with pytest.raises(TravelTimeError):
        OdsayTransitAdapter(FakeHttp(body), "k").measure(_FROM, _TO, TransportMode.PUBLIC)


def test_http_failure_is_promoted_without_leaking_the_key():
    http = FakeHttp(error=OSError("https://api.odsay.com/...?apiKey=secret-key timed out"))
    with pytest.raises(TravelTimeError) as exc:
        OdsayTransitAdapter(http, "secret-key").measure(_FROM, _TO, TransportMode.PUBLIC)
    assert "secret-key" not in str(exc.value)
    assert exc.value.__cause__ is http._error


@pytest.mark.parametrize("mode", [TransportMode.CAR, TransportMode.WALK])
def test_non_transit_modes_are_refused_without_a_call(mode):
    http = FakeHttp(_payload(10, 1000))
    with pytest.raises(TravelTimeError):
        OdsayTransitAdapter(http, "k").measure(_FROM, _TO, mode)
    assert http.calls == []


# ── ③ 수단별 1차 ─────────────────────────────────────────────────────


class _Fixed:
    def __init__(self, source: str) -> None:
        self.source = source
        self.modes: list[TransportMode] = []

    def measure(self, from_, to, mode):
        self.modes.append(mode)
        return MeasuredTravel(real_minutes=1.0, distance_km=1.0, source=self.source,
                              approximated=False)


def test_by_mode_routes_public_to_odsay_and_the_rest_to_tmap():
    tmap, odsay = _Fixed("tmap_car"), _Fixed("odsay_transit")
    router = ByModeTravelTime({TransportMode.CAR: tmap, TransportMode.WALK: tmap,
                               TransportMode.PUBLIC: odsay})
    assert router.measure(_FROM, _TO, TransportMode.PUBLIC).source == "odsay_transit"
    assert router.measure(_FROM, _TO, TransportMode.CAR).source == "tmap_car"
    assert router.measure(_FROM, _TO, TransportMode.WALK).source == "tmap_car"
    assert odsay.modes == [TransportMode.PUBLIC] and tmap.modes == [TransportMode.CAR, TransportMode.WALK]


def test_by_mode_promotes_an_unwired_mode():
    router = ByModeTravelTime({TransportMode.PUBLIC: _Fixed("odsay_transit")})
    with pytest.raises(TravelTimeError):
        router.measure(_FROM, _TO, TransportMode.CAR)


# ── ④ 체인 합성 ──────────────────────────────────────────────────────


def test_too_close_falls_back_to_haversine_and_the_warning_carries_the_code(caplog):
    odsay = OdsayTransitAdapter(FakeHttp({"error": {"code": "-98", "msg": "700m 이내"}}), "k")
    chain = ChainedTravelAdapter(primary=ByModeTravelTime({TransportMode.PUBLIC: odsay}),
                                 fallback=TravelEstimator(AssemblyConfig()))
    with caplog.at_level(logging.WARNING):
        estimate = chain.estimate(_FROM, _TO, TransportMode.PUBLIC)
    assert estimate.is_estimated is True
    assert estimate.source.startswith("haversine")
    [record] = [r for r in caplog.records if "travel_primary_failed" in r.getMessage()]
    assert "status=-98" in record.getMessage() and "cause=OdsayApiError" in record.getMessage()
    assert "k" != record.getMessage()  # 키·원문은 안 싣는다 — 종류·코드만


# ── ⑤ 조립 ───────────────────────────────────────────────────────────


def _wired(monkeypatch, *, tmap: str | None, odsay: str | None) -> dict:
    for name, value in (("TMAP_API_KEY", tmap), ("ODSAY_API_KEY", odsay)):
        if value is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, value)
    chain = main._travel_chain()
    if chain is None:
        return {}
    return {mode: type(adapter).__name__ for mode, adapter in chain._primary._by_mode.items()}


def test_both_keys_give_tmap_for_car_walk_and_odsay_for_public(monkeypatch):
    assert _wired(monkeypatch, tmap="t", odsay="o") == {
        TransportMode.CAR: "TmapRouteAdapter", TransportMode.WALK: "TmapRouteAdapter",
        TransportMode.PUBLIC: "OdsayTransitAdapter"}


def test_tmap_only_keeps_public_on_tmap_so_subscribing_the_product_just_works(monkeypatch):
    assert _wired(monkeypatch, tmap="t", odsay=None)[TransportMode.PUBLIC] == "TmapRouteAdapter"


def test_odsay_only_wires_public_alone(monkeypatch):
    assert _wired(monkeypatch, tmap=None, odsay="o") == {TransportMode.PUBLIC: "OdsayTransitAdapter"}


def test_no_keys_means_no_chain(monkeypatch):
    assert _wired(monkeypatch, tmap=None, odsay=None) == {}
