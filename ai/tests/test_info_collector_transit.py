"""TRIP-423 — InfoCollector Transit v2 타입 호출 테스트.

증명하는 것:
  ① REPLAN intent에서 TRANSIT Provider가 수집된다
  ② InfoCollector가 TransitRequest를 조립해 fetch_typed()를 호출한다
  ③ fetch_typed() 없는 Provider에는 기존대로 fetch(params) 폴백
  ④ Transit Provider 실패 시 UNAVAILABLE 패킷으로 수렴 (INV-4)
"""

from __future__ import annotations

from datetime import datetime, timezone

from trippilot.domain.common import GeoPoint, TransportMode
from trippilot.domain.freshness import InfoPacket, ProviderKind, ProviderStatus
from trippilot.domain.transit import TransitInfo, TransitRequest
from trippilot.orchestrator.info_collector import InfoCollector
from trippilot.providers.transit import TransitProvider

from tests.fakes.fake_travel import FakeTravel

_ORIGIN = GeoPoint(33.5, 126.5)
_DEST = GeoPoint(33.6, 126.6)
_NOW = datetime(2026, 8, 19, 12, 0, 0, tzinfo=timezone.utc)

_REPLAN_PARAMS = {
    "origin": _ORIGIN,
    "destination": _DEST,
    "mode": TransportMode.CAR,
    "now": _NOW,
    "expected_minutes": None,
}


# ── ① REPLAN intent에서 Transit 수집 ────────────────────────────────


def test_replan_collects_transit_provider() -> None:
    transit = TransitProvider(port=FakeTravel(), ttl_sec=600)
    collector = InfoCollector({ProviderKind.TRANSIT: transit})

    packets = collector.collect("REPLAN", _REPLAN_PARAMS)
    assert ProviderKind.TRANSIT in packets
    assert packets[ProviderKind.TRANSIT].status is ProviderStatus.OK


# ── ② fetch_typed()가 호출된다 — TransitInfo schema 확인 ─────────────


def test_replan_transit_uses_typed_call() -> None:
    """InfoCollector가 fetch_typed(TransitRequest)를 사용하면 data가 TransitInfo schema."""
    transit = TransitProvider(port=FakeTravel(), ttl_sec=600)
    collector = InfoCollector({ProviderKind.TRANSIT: transit})

    packets = collector.collect("REPLAN", _REPLAN_PARAMS)
    packet = packets[ProviderKind.TRANSIT]

    # TransitInfo로 역직렬화 가능해야 한다
    info = TransitInfo.from_dict(packet.data)
    assert info.distance_m >= 0
    assert info.confidence.value == "LOW"  # FakeTravel = haversine_fake
    assert info.source == "haversine_fake"


# ── ③ fetch_typed 없는 Provider는 기존대로 fetch(params) ─────────────


def test_non_transit_provider_uses_fetch_dict() -> None:
    """Weather Provider에는 fetch_typed가 없으므로 fetch(params)로 호출."""

    class FakeWeatherProvider:
        def fetch(self, params: dict) -> InfoPacket:
            from trippilot.domain.freshness import FreshnessMeta
            return InfoPacket(
                provider=ProviderKind.WEATHER,
                status=ProviderStatus.OK,
                data={"daily": {}, "triggers": ()},
                freshness=FreshnessMeta(
                    source="KMA", fetched_at=_NOW,
                    cache_hit=False, ttl_sec=3600, stale=False,
                ),
            )

    collector = InfoCollector({
        ProviderKind.WEATHER: FakeWeatherProvider(),
        ProviderKind.TRANSIT: TransitProvider(port=FakeTravel()),
    })

    packets = collector.collect("REPLAN", _REPLAN_PARAMS)
    assert packets[ProviderKind.WEATHER].status is ProviderStatus.OK
    assert packets[ProviderKind.TRANSIT].status is ProviderStatus.OK


# ── ④ Transit Provider 실패 → UNAVAILABLE ────────────────────────────


def test_transit_failure_returns_unavailable() -> None:
    """TravelPort 예외 → TransitProvider가 UNAVAILABLE 반환."""

    class BrokenPort:
        def estimate(self, from_, to, mode):
            raise RuntimeError("port down")

    transit = TransitProvider(port=BrokenPort(), ttl_sec=600)  # type: ignore[arg-type]
    collector = InfoCollector({ProviderKind.TRANSIT: transit})

    packets = collector.collect("REPLAN", _REPLAN_PARAMS)
    assert packets[ProviderKind.TRANSIT].status is ProviderStatus.UNAVAILABLE


# ── ⑤ params에 now 없으면 자동 주입 ──────────────────────────────────


def test_transit_auto_injects_now_if_missing() -> None:
    """params에 now가 없으면 현재 시각을 자동 주입."""
    transit = TransitProvider(port=FakeTravel(), ttl_sec=600)
    collector = InfoCollector({ProviderKind.TRANSIT: transit})

    params_no_now = {
        "origin": _ORIGIN,
        "destination": _DEST,
        "mode": TransportMode.CAR,
    }
    packets = collector.collect("REPLAN", params_no_now)
    assert packets[ProviderKind.TRANSIT].status is ProviderStatus.OK


# ── ⑥ GENERATE_SCHEDULE에는 Transit 수집 안 함 ──────────────────────


def test_generate_schedule_does_not_collect_transit() -> None:
    transit = TransitProvider(port=FakeTravel(), ttl_sec=600)
    collector = InfoCollector({ProviderKind.TRANSIT: transit})

    packets = collector.collect("GENERATE_SCHEDULE", _REPLAN_PARAMS)
    assert ProviderKind.TRANSIT not in packets
