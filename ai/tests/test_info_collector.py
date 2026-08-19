"""TRIP-406 — WeatherProvider·InfoCollector (실 호출 0건, fake만).

증명하는 것:
  [Provider]
  ① 성공: InfoPacket(OK) — daily는 ISO 키(JSON-safe), 강수 80%↑만 트리거,
     FreshnessMeta(KMA·주입 now·TTL) 필수 동봉
  ② 실패: 예외를 던지지 않고 WEATHER_UNKNOWN + 사유 보존 + freshness 없음 (IO-7)
  [InfoCollector]
  ③ 정보 요구표 라우팅: GENERATE_SCHEDULE → WEATHER만 수집, 요구표 밖 intent는 빈 묶음
  ④ 미등록 Provider는 건너뛴다 (기능 부재 ≠ 실패 — 패킷 자체가 없음)
  ⑤ Provider가 계약을 어기고 예외를 새어 보내도 UNAVAILABLE 패킷으로 수렴 (INV-4)
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from trippilot.domain.common import GeoPoint
from trippilot.domain.freshness import InfoPacket, ProviderKind, ProviderStatus
from trippilot.orchestrator.info_collector import InfoCollector
from trippilot.providers.weather import WeatherProvider

_ANCHOR = GeoPoint(35.1587, 129.1604)
_D1 = date(2026, 8, 20)
_D2 = date(2026, 8, 21)
_NOW = datetime(2026, 8, 19, 9, 0, tzinfo=timezone.utc)
_PARAMS = {"anchor": _ANCHOR, "days": (_D1, _D2), "now": _NOW}


class _FakePort:
    def __init__(self, forecast) -> None:
        self._forecast = forecast
        self.calls: list = []

    def daily_forecast(self, coord, days):
        self.calls.append((coord, tuple(days)))
        return self._forecast


class _FailingPort:
    def daily_forecast(self, coord, days):
        raise TimeoutError("kma down")


# ── ① Provider 성공 ──────────────────────────────────────────────────


def test_provider_success_packet_with_triggers_and_freshness() -> None:
    port = _FakePort({_D1: 80, _D2: 79})
    packet = WeatherProvider(port).fetch(_PARAMS)

    assert packet.provider is ProviderKind.WEATHER
    assert packet.status is ProviderStatus.OK
    assert packet.data["daily"] == {"2026-08-20": 80, "2026-08-21": 79}  # ISO 키
    assert packet.data["triggers"] == ("2026-08-20",)  # 80%가 경계 — 79는 미달
    assert packet.freshness is not None
    assert packet.freshness.source == "KMA"
    assert packet.freshness.fetched_at == _NOW
    assert port.calls == [(_ANCHOR, (_D1, _D2))]


# ── ② Provider 실패 — 상태값으로 수렴 ────────────────────────────────


def test_provider_failure_returns_status_not_exception() -> None:
    packet = WeatherProvider(_FailingPort()).fetch(_PARAMS)

    assert packet.status is ProviderStatus.WEATHER_UNKNOWN
    assert "TimeoutError" in packet.data["reason"]  # 사유 보존 (침묵 금지)
    assert packet.freshness is None


# ── ③ 요구표 라우팅 ──────────────────────────────────────────────────


def test_collector_routes_by_requirements_table() -> None:
    collector = InfoCollector(
        {ProviderKind.WEATHER: WeatherProvider(_FakePort({_D1: 10}))}
    )

    packets = collector.collect("GENERATE_SCHEDULE", _PARAMS)
    assert set(packets) == {ProviderKind.WEATHER}
    assert packets[ProviderKind.WEATHER].status is ProviderStatus.OK

    assert collector.collect("REFLECT", _PARAMS) == {}  # 요구표 밖 — 빈 묶음


# ── ④ 미등록 Provider — 기능 부재 ────────────────────────────────────


def test_collector_skips_unregistered_provider() -> None:
    packets = InfoCollector({}).collect("GENERATE_SCHEDULE", _PARAMS)
    assert packets == {}  # 패킷 자체가 없다 — 실패 상태값도 아님


# ── ⑤ 계약 위반 예외 — UNAVAILABLE 수렴 ──────────────────────────────


def test_collector_converts_leaked_exception_to_unavailable() -> None:
    class _BrokenProvider:
        def fetch(self, params: dict) -> InfoPacket:
            raise RuntimeError("contract violation")

    packets = InfoCollector({ProviderKind.WEATHER: _BrokenProvider()}).collect(
        "GENERATE_SCHEDULE", _PARAMS
    )

    packet = packets[ProviderKind.WEATHER]
    assert packet.status is ProviderStatus.UNAVAILABLE
    assert "RuntimeError" in packet.data["reason"]
