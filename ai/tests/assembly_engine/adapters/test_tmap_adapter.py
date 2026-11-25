"""TmapRouteAdapter 검증 — 실 호출 0건 (fake HTTP만, D37) (TRIP-382·405).

픽스처는 TMAP 문서 형태 기준(자동차·보행 features[].properties / 대중교통
metaData.plan.itineraries[]) — 실 응답 드리프트는 실키 첫 실행(smoke_itinerary)
에서 검증한다.
  ① 매핑 — 초→분·미터→km, 좌표(X=경도·Y=위도), appKey 헤더, 요청 1건=호출 1건
  ② 수단 라우팅 — CAR /tmap/routes, WALK /tmap/routes/pedestrian,
     PUBLIC /transit/routes 실측 (근사 제거, TRIP-405)
  ③ 실패 승격 — HTTP 예외·형식 오류는 TravelTimeError (침묵 금지, INV-4)
  ④ 키 여러 개 — 번갈아 쓰기, 키 문제(401·403·429)만 다음 키로, 막힌 (키, 수단)은 쉼
"""

from __future__ import annotations

import logging
import re
import threading
import urllib.error

import pytest

from trippilot.assembly_engine.adapters.tmap import _KEY_REST_S, TmapRouteAdapter
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


# ── ④ 키 여러 개 번갈아 쓰기 (2026-11-25) ─────────────────────────────


def _http_error(status: int) -> urllib.error.HTTPError:
    """실 클라이언트(urllib)가 4xx·5xx 에 던지는 그 예외 — 어댑터는 `code` 로 키 문제를 가린다."""
    return urllib.error.HTTPError("https://apis.openapi.sk.com/x", status, "x", None, None)


class KeyedHttp:
    """키·경로마다 다른 응답 — `fail[(appKey, 경로 끝)]` 이 있으면 그 예외, 없으면 정상 응답. 부른 키를 순서대로 적는다."""

    def __init__(self, fail: dict[tuple[str, str], Exception] | None = None) -> None:
        self.fail = dict(fail or {})
        self.keys: list[str] = []

    def post_json(self, url: str, headers, body) -> object:
        key = headers["appKey"]
        self.keys.append(key)
        for (failing_key, path), error in self.fail.items():
            if key == failing_key and url.endswith(path):
                raise error
        if url.endswith("/transit/routes"):
            return _transit_payload([{"totalTime": 600, "totalDistance": 1000}])
        return _payload(60, 1000)


def test_single_key_string_still_works_as_before():
    http = KeyedHttp()
    TmapRouteAdapter(http, "only").measure(_FROM, _TO, TransportMode.CAR)
    assert http.keys == ["only"]


def test_keys_take_turns():
    http = KeyedHttp()
    adapter = TmapRouteAdapter(http, ["a", "b"])
    for _ in range(4):
        adapter.measure(_FROM, _TO, TransportMode.CAR)
    assert http.keys == ["a", "b", "a", "b"]  # 호출마다 다음 키 — 한도를 고르게 나눠 쓴다


def test_no_key_at_all_is_refused_at_construction():
    with pytest.raises(ValueError):
        TmapRouteAdapter(KeyedHttp(), [])


@pytest.mark.parametrize("status", [401, 403, 429])
def test_a_key_scoped_failure_falls_over_to_the_next_key_in_the_same_call(status):
    """한도(429)·인증(401)·미구독/무효(403)는 그 키의 문제다 — 같은 호출 안에서 다음 키로 넘겨 실측을 살린다."""
    http = KeyedHttp({("a", "/tmap/routes"): _http_error(status)})
    adapter = TmapRouteAdapter(http, ["a", "b"], clock=lambda: 0.0)
    for _ in range(4):
        assert adapter.measure(_FROM, _TO, TransportMode.CAR).source == "tmap_car"
    # 막힌 키는 첫 실패 뒤로 쉰다 — 차례마다 실패 한 번을 먼저 치르지 않는다
    assert http.keys == ["a", "b", "b", "b", "b"]


class _OddCode(Exception):
    """`code` 가 HTTP 상태(int)가 아닌 예외 — 다른 클라이언트·라이브러리 예외가 이런 속성을 가질 수 있다."""

    def __init__(self, code: object) -> None:
        super().__init__("odd")
        self.code = code


@pytest.mark.parametrize("error", [TimeoutError("timed out"), _http_error(500), _http_error(400),
                                   _OddCode("403"), _OddCode(["403"]), _OddCode(403.0)])
def test_failures_that_are_not_about_the_key_do_not_fall_over(error):
    """시한·5xx·요청 오류는 어느 키로 보내도 같다 — 넘기지 않고(호출 1건) 그 키를 쉬게 하지도 않는다.
    `code` 가 int 상태가 아닌 예외(문자열·해시 불가·실수)도 같다 — 어떤 예외든 TravelTimeError 로 감싸는 계약을 지킨다."""
    http = KeyedHttp({("a", "/tmap/routes"): error})
    adapter = TmapRouteAdapter(http, ["a", "b"], clock=lambda: 0.0)
    with pytest.raises(TravelTimeError) as exc:
        adapter.measure(_FROM, _TO, TransportMode.CAR)
    assert exc.value.__cause__ is error
    assert http.keys == ["a"]
    adapter.measure(_FROM, _TO, TransportMode.CAR)  # 다음 차례는 b
    with pytest.raises(TravelTimeError):
        adapter.measure(_FROM, _TO, TransportMode.CAR)  # 쉬지 않았으니 a 차례가 다시 온다
    assert http.keys == ["a", "b", "a"]


def test_a_resting_key_is_asked_again_once_its_rest_ends():
    now = [0.0]
    http = KeyedHttp({("a", "/tmap/routes"): _http_error(429)})
    adapter = TmapRouteAdapter(http, ["a", "b"], clock=lambda: now[0])
    for _ in range(3):
        adapter.measure(_FROM, _TO, TransportMode.CAR)
    assert http.keys.count("a") == 1
    now[0] = _KEY_REST_S - 1  # 쉼이 끝나기 직전 — 아직 묻지 않는다(쉼이 짧아지면 막힌 키 차례마다 실패를 다시 치른다)
    for _ in range(4):
        adapter.measure(_FROM, _TO, TransportMode.CAR)
    assert http.keys.count("a") == 1
    now[0] = _KEY_REST_S + 1
    del http.fail[("a", "/tmap/routes")]  # 한도가 풀렸다
    for _ in range(4):
        adapter.measure(_FROM, _TO, TransportMode.CAR)
    assert http.keys.count("a") == 3  # 쉼이 끝나 다시 번갈아 쓴다


def test_rest_is_per_mode_so_an_unsubscribed_product_does_not_bench_the_key():
    """403 은 상품(경로)별이다 — 대중교통 미구독 키도 자동차·보행은 된다(2026-11-25 두 키 실호출로 확인)."""
    http = KeyedHttp({("a", "/transit/routes"): _http_error(403)})
    adapter = TmapRouteAdapter(http, ["a", "b"], clock=lambda: 0.0)
    assert adapter.measure(_FROM, _TO, TransportMode.PUBLIC).source == "tmap_transit"  # a 403 → b
    http.keys.clear()
    for _ in range(4):
        adapter.measure(_FROM, _TO, TransportMode.CAR)
    assert sorted(http.keys) == ["a", "a", "b", "b"]
    http.keys.clear()
    for _ in range(4):
        adapter.measure(_FROM, _TO, TransportMode.PUBLIC)
    assert http.keys == ["b"] * 4  # a 의 자동차 성공이 a 의 대중교통 쉼을 풀지 않는다


def test_when_every_key_fails_the_last_error_is_raised_with_its_cause():
    last = _http_error(429)
    http = KeyedHttp({("a", "/tmap/routes"): _http_error(403), ("b", "/tmap/routes"): last})
    adapter = TmapRouteAdapter(http, ["a", "b"], clock=lambda: 0.0)
    with pytest.raises(TravelTimeError) as exc:
        adapter.measure(_FROM, _TO, TransportMode.CAR)
    assert exc.value.__cause__ is last and http.keys == ["a", "b"]


def test_while_every_key_rests_each_call_still_asks_exactly_one_key():
    """두 키가 다 막혀 쉬는 동안은(한도 소진·미구독) 호출 1건 = HTTP 1건이다 — 실패할 호출을 키 수만큼 겹쳐 내지 않는다.
    아예 안 부르지는 않는다: 한도가 풀렸는지·상품이 구독됐는지는 불러 봐야 안다(키 하나일 때의 종전 동작과 같다).
    쉼이 끝난 키는 다시 넘김 대상이라, 전부 막힌 채로 쉼이 끝나면 그때 한 번은 다시 두 키를 다 묻는다."""
    http = KeyedHttp({("a", "/transit/routes"): _http_error(403), ("b", "/transit/routes"): _http_error(403)})
    adapter = TmapRouteAdapter(http, ["a", "b"], clock=lambda: 0.0)
    with pytest.raises(TravelTimeError):
        adapter.measure(_FROM, _TO, TransportMode.PUBLIC)
    assert http.keys == ["a", "b"]  # 첫 호출만 두 키를 다 물었다
    for _ in range(4):
        with pytest.raises(TravelTimeError) as exc:
            adapter.measure(_FROM, _TO, TransportMode.PUBLIC)
        assert exc.value.__cause__.code == 403 and "403" in str(exc.value)  # 체인 경고·스모크가 읽는 자리
    assert http.keys == ["a", "b", "b", "a", "b", "a"]  # 이후는 차례인 키 하나씩


def test_a_resting_key_that_answers_again_is_live_at_once():
    """다 쉬는 중에 물어본 키가 답하면 그 키는 바로 돌아온다 — 쉼이 끝날 때까지 죽은 키와 번갈아 실패하지 않는다."""
    http = KeyedHttp({("a", "/tmap/routes"): _http_error(429), ("b", "/tmap/routes"): _http_error(429)})
    adapter = TmapRouteAdapter(http, ["a", "b"], clock=lambda: 0.0)
    with pytest.raises(TravelTimeError):
        adapter.measure(_FROM, _TO, TransportMode.CAR)
    del http.fail[("b", "/tmap/routes")]  # b 의 한도만 풀렸다
    http.keys.clear()
    for _ in range(4):
        adapter.measure(_FROM, _TO, TransportMode.CAR)  # 첫 차례가 b — 답했으니 살아났고, a 는 계속 쉰다
    assert http.keys == ["b", "b", "b", "b"]


def test_a_single_key_makes_exactly_one_http_call_per_measure_as_before():
    http = KeyedHttp({("only", "/transit/routes"): _http_error(403)})
    adapter = TmapRouteAdapter(http, "only")
    for _ in range(3):
        with pytest.raises(TravelTimeError) as exc:
            adapter.measure(_FROM, _TO, TransportMode.PUBLIC)
        assert exc.value.__cause__.code == 403
    assert http.keys == ["only"] * 3


def test_falling_over_leaves_a_warning_without_the_key_value(caplog):
    """다음 키가 살리면 호출은 성공이라 체인 경고가 안 남는다 — 넘어간 순간 이 한 줄이 한도 소진의 유일한 흔적이다."""
    http = KeyedHttp({("secret-a", "/tmap/routes"): _http_error(429)})
    adapter = TmapRouteAdapter(http, ["secret-a", "secret-b"], clock=lambda: 0.0)
    with caplog.at_level(logging.WARNING):
        for _ in range(3):
            adapter.measure(_FROM, _TO, TransportMode.CAR)
    [record] = [r for r in caplog.records if "tmap_key_failover" in r.getMessage()]
    message = record.getMessage()
    # 순번 칸 이름은 `key=` 가 아니다 — 로그 덤프(aws-dev-logs)의 자격 가림이 `KEY…=값` 꼴을 지워 몇 번째 키인지 못 보게 된다
    assert "slot=1/2" in message and "mode=CAR" in message and "status=429" in message
    assert "secret" not in message
    # deploy/eks/runtime_kb.py `_CREDENTIAL` 의 `KEY=값` 가지 그대로(ai 테스트는 deploy 패키지를 import 하지 못한다)
    assert re.search(r"(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z_]*=\S+", message, re.IGNORECASE) is None


def test_three_keys_bench_each_failed_key_and_keep_the_rotation_order():
    """쉬는 것은 그 호출의 차례 키가 아니라 **실패한 그 키**다 — 두 번째 시도에서 막힌 키도 쉰다. 넘김은 순번대로."""
    http = KeyedHttp({("a", "/tmap/routes"): _http_error(429), ("b", "/tmap/routes"): _http_error(429)})
    adapter = TmapRouteAdapter(http, ["a", "b", "c"], clock=lambda: 0.0)
    for _ in range(4):
        adapter.measure(_FROM, _TO, TransportMode.CAR)
    assert http.keys == ["a", "b", "c", "c", "c", "c"]


def test_each_mode_rotates_its_own_turn():
    """순번은 수단별이다 — 한도가 상품(수단)별이라, 자동차·보행이 번갈아 들어와도 수단마다 두 키를 고르게 쓴다.
    순번을 수단이 같이 쓰면 자동차는 늘 한 키, 보행은 늘 다른 키로만 간다."""
    http = KeyedHttp()
    adapter = TmapRouteAdapter(http, ["a", "b"])
    used: dict[TransportMode, list[str]] = {TransportMode.CAR: [], TransportMode.WALK: []}
    for _ in range(4):
        for mode in (TransportMode.CAR, TransportMode.WALK):
            adapter.measure(_FROM, _TO, mode)
            used[mode].append(http.keys[-1])
    assert used == {TransportMode.CAR: ["a", "b", "a", "b"], TransportMode.WALK: ["a", "b", "a", "b"]}


def test_a_burst_that_finds_one_key_blocked_warns_once_and_still_measures_every_leg(caplog):
    """조립 뒤 거리는 스레드풀로 한꺼번에 나간다 — 막힌 키를 동시에 만난 호출이 여럿이어도 경고는 그 키가
    쉬러 가는 순간 한 줄이다(줄 수가 한도 소진 횟수로 읽히게). 넘김은 호출마다 그대로라 구간은 전부 실측된다."""
    blocked = threading.Barrier(4, timeout=5)

    class BurstHttp(KeyedHttp):
        def post_json(self, url, headers, body):
            if headers["appKey"] == "a":
                self.keys.append("a")
                blocked.wait()  # a 차례인 네 호출이 모두 출발한 뒤에야 실패가 돌아온다
                raise _http_error(429)
            return super().post_json(url, headers, body)

    http = BurstHttp()
    adapter = TmapRouteAdapter(http, ["a", "b"], clock=lambda: 0.0)
    sources: list[str] = []
    with caplog.at_level(logging.WARNING):
        threads = [threading.Thread(target=lambda: sources.append(adapter.measure(_FROM, _TO, TransportMode.CAR).source))
                   for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
    assert sources == ["tmap_car"] * 8
    assert http.keys.count("a") == 4
    assert len([r for r in caplog.records if "tmap_key_failover" in r.getMessage()]) == 1
