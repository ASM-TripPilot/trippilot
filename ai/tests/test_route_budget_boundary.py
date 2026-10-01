"""조립 뒤 화면 거리 시한 — HTTP 경계 관통 (TRIP-1179).

`build_dev_app(travel_port=ChainedTravelAdapter(느린 가짜 TMAP))` 로 /generate·/replan 을
친다. 기존 테스트는 travel_port 를 한 건도 주입하지 않아 실경로 분기가 무테스트였다.
외부 호출 0 (D37) — TMAP 자리는 가짜 TravelTimePort 다.

증명하는 것:
  ① 늦은 구간이 있어도 응답은 조립 + 1.5s + ε 안에 온다 — 못 끝난 구간만 '… 추정'
  ② 추정이 있으면 FallbackEvent(stage='distance') 1건, 와이어 키는 그대로
  ③ 시한 미전송(600s)에서도 같은 상한
  ④ 벤더 실패(403)는 시한 초과와 따로 센다 — 사유에 vendor=n/n
  ⑤ travel_port 미주입(TravelEstimator)이면 현행 경로 그대로 — 이벤트 0·구간당 1호출·응답 동일
  ⑥ /replan: 같은 구간은 한 번만 실측하고 total_distance_km 이 같은 표를 쓴다
"""

from __future__ import annotations

import threading
import time
from collections import Counter

from fastapi.testclient import TestClient

from trippilot.api.wiring import build_dev_app
from trippilot.assembly_engine.adapters.chained_travel import ChainedTravelAdapter
from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.travel import TravelEstimator
from trippilot.domain.observability import FallbackEvent
from trippilot.ports.travel_time_port import MeasuredTravel, TravelTimeError

from tests.fakes.in_memory_poi import InMemoryPoi
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.test_api_replan_wired import _DIRECTIVES, _body
from tests.test_e2e_boundary import _BANNED_TOKENS, _POIS, _request

_GENERATE = "/ai/v1/itinerary/generate"
_REPLAN = "/ai/v1/planb/replan"
_CAP_S = 1.5
_EPS_S = 1.0   # CI 호스트 흔들림 여유 — 막힌 구간은 10s 라 구분에는 충분하다


class SlowTmap:
    """TravelTimePort 가짜 — n 번째 호출마다 막히거나(block_every), 항상 403(fail)."""

    def __init__(self, *, block_every: int = 0, fail: bool = False) -> None:
        self.block_every, self.fail = block_every, fail
        self.release = threading.Event()
        self.legs: Counter = Counter()
        self._lock = threading.Lock()

    def measure(self, a, b, mode):  # noqa: ANN001 — TravelTimePort 구조 계약
        with self._lock:
            self.legs[(a, b, mode)] += 1
            n = sum(self.legs.values())
        if self.fail:
            raise TravelTimeError("/transit/routes 호출 실패: HTTPError: HTTP Error 403")
        if self.block_every and n % self.block_every == 0:
            self.release.wait(10)
        return MeasuredTravel(real_minutes=10.0, distance_km=1.234,
                              source="fake_tmap", approximated=False)


def _chain(port: SlowTmap) -> ChainedTravelAdapter:
    return ChainedTravelAdapter(port, TravelEstimator(AssemblyConfig()))


def _generate(travel_port, req: dict | None = None):  # noqa: ANN001
    trace = InMemoryTrace()
    app = build_dev_app(poi_db=InMemoryPoi(_POIS), travel_port=travel_port, trace=trace)
    with TestClient(app, raise_server_exceptions=False) as client:
        t = time.monotonic()
        response = client.post(_GENERATE, json=req or _request())
        dt = time.monotonic() - t
    return response, dt, trace


def _distances(body: dict) -> list[str]:
    out = []
    for day in body["days"]:
        for slot in day["slots"]:
            out.append(slot["distance_range"])
            out += [a["distance_range"] for a in slot.get("alternatives") or []]
    return [x for x in out if x]


def _keys(node, path: str = "") -> set[str]:  # noqa: ANN001
    """응답 JSON 의 키 경로 집합 — 와이어 모양 비교용."""
    if isinstance(node, dict):
        return {f"{path}.{k}" for k in node} | {
            p for k, v in node.items() for p in _keys(v, f"{path}.{k}")}
    if isinstance(node, list):
        return {p for v in node for p in _keys(v, f"{path}[]")}
    return set()


def _distance_events(trace: InMemoryTrace) -> list[FallbackEvent]:
    return [e for e in trace.of_type(FallbackEvent) if e.stage == "distance"]


def _base_seconds() -> float:
    """늦은 구간 없는 같은 조립의 벽시계 — '조립' 몫의 기준선."""
    port = SlowTmap()
    _, dt, _ = _generate(_chain(port))
    return dt


# ── ① ② 일부 구간만 추정 ─────────────────────────────────────────────


def test_late_legs_only_are_estimated_and_response_is_bounded() -> None:
    base = _base_seconds()
    fast_response, _, _ = _generate(_chain(SlowTmap()))
    port = SlowTmap(block_every=3)
    try:
        response, dt, trace = _generate(_chain(port))
    finally:
        port.release.set()

    assert response.status_code == 200, response.text
    assert sum(port.legs.values()) >= 3, port.legs   # 막힌 구간이 실제로 있었다
    strings = _distances(response.json())
    assert any(s.endswith("추정") for s in strings), strings
    assert any(s == "약 1.2km · 대중교통" for s in strings), strings
    assert dt <= base + _CAP_S + _EPS_S, (dt, base)
    events = _distance_events(trace)
    assert len(events) == 1, events
    assert events[0].component == "api.wiring"
    assert (events[0].from_mode, events[0].to_mode) == ("route_api", "haversine_x_detour")
    assert "budget=" in events[0].reason and "budget_ms=" in events[0].reason
    for s in strings:   # INV-3 — 거리만
        assert "분" not in s and "시간" not in s
        assert not any(tok in s for tok in _BANNED_TOKENS)
    assert _keys(response.json()) == _keys(fast_response.json())   # 와이어 키 무변경


def test_all_measured_emits_no_distance_event() -> None:
    response, _, trace = _generate(_chain(SlowTmap()))
    assert response.status_code == 200, response.text
    assert all(not s.endswith("추정") for s in _distances(response.json()))
    assert _distance_events(trace) == []


# ── ③ 시한 미전송 ────────────────────────────────────────────────────


def test_unsent_deadline_is_capped_at_the_boundary() -> None:
    base = _base_seconds()
    req = _request()
    req["request_meta"].pop("deadline_ms")
    port = SlowTmap(block_every=1)
    try:
        response, dt, trace = _generate(_chain(port), req)
    finally:
        port.release.set()
    assert response.status_code == 200, response.text
    strings = _distances(response.json())
    assert strings and all(s.endswith("추정") for s in strings)
    assert dt <= base + _CAP_S + _EPS_S, (dt, base)
    assert len(_distance_events(trace)) == 1


# ── ④ 벤더 실패 ──────────────────────────────────────────────────────


def test_vendor_403_is_counted_apart_from_budget() -> None:
    response, _, trace = _generate(_chain(SlowTmap(fail=True)))
    assert response.status_code == 200, response.text
    n = len(_distances(response.json()))
    (event,) = _distance_events(trace)
    assert f"vendor={n}/{n}" in event.reason and f"budget=0/{n}" in event.reason, event.reason


# ── ⑤ 미주입 = 현행 경로 ─────────────────────────────────────────────


class SpyEstimator(TravelEstimator):
    """TravelEstimator 그대로 — 호출 수·스레드만 적는다."""

    def __init__(self) -> None:
        super().__init__(AssemblyConfig())
        self.calls: list[int] = []

    def estimate(self, from_, to, mode):  # noqa: ANN001
        self.calls.append(threading.get_ident())
        return super().estimate(from_, to, mode)


def test_without_route_api_the_current_path_is_untouched() -> None:
    plain, _, plain_trace = _generate(None)
    spy = SpyEstimator()
    spied, _, _ = _generate(spy)

    assert plain.status_code == spied.status_code == 200
    assert _distance_events(plain_trace) == []
    # 구간당 정확히 1호출·한 스레드 — 두 패스·스레드풀을 안 탄다
    assert len(spy.calls) == len(_distances(spied.json())) > 0
    assert len(set(spy.calls)) == 1
    mask = lambda body: {**body, "day1_ready_at": None}  # noqa: E731 — 실시계 값
    assert mask(plain.json()) == mask(spied.json())


# ── ⑥ /replan ────────────────────────────────────────────────────────


def _replan(port: SlowTmap):
    trace = InMemoryTrace()
    app = build_dev_app(directives=_DIRECTIVES, travel_port=_chain(port), trace=trace)
    with TestClient(app, raise_server_exceptions=False) as client:
        return client.post(_REPLAN, json=_body()), trace


def test_replan_measures_each_leg_once_and_total_uses_the_same_table() -> None:
    port = SlowTmap()
    response, trace = _replan(port)

    assert response.status_code == 200, response.text
    body = response.json()
    strings = _distances(body["itinerary"])
    assert strings and all(s == "약 1.2km · 대중교통" for s in strings), strings
    assert set(port.legs.values()) == {1}, port.legs          # 종전: 구간마다 2회
    assert body["total_distance_km"] == round(1.234 * len(strings), 1)
    assert _distance_events(trace) == []
    assert not any(n.startswith("distance_estimated") for n in body["notes"])


def test_replan_notes_estimated_legs() -> None:
    response, trace = _replan(SlowTmap(fail=True))

    assert response.status_code == 200, response.text
    body = response.json()
    n = len(_distances(body["itinerary"]))
    assert f"distance_estimated:{n}/{n}" in body["notes"], body["notes"]
    assert len(_distance_events(trace)) == 1
