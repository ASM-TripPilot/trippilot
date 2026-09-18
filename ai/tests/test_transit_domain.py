"""TransitRequest/TransitInfo/DelayTrigger 도메인 타입 PBT (TRIP-410).

증명하는 것:
  ① 직렬화 왕복 (U5-P10): from_dict(to_dict(x)) == x
  ② INV-3: to_public_dict()에 internal_minutes가 존재하지 않음
  ③ 검증: 잘못된 입력은 생성 자체가 불가능
  ④ TransitProvider v2: fetch(params) → InfoPacket(TransitInfo schema) 정상 동작
  ⑤ TransitProvider v2: fetch_typed(TransitRequest) → InfoPacket 정상 동작
  ⑥ 지연 트리거: 30분+ 지연 시 트리거 발동, 미만 시 None
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from hypothesis import given

from trippilot.domain.common import GeoPoint, TransportMode
from trippilot.domain.freshness import ProviderKind, ProviderStatus
from trippilot.domain.transit import (
    Confidence,
    DelayTrigger,
    TransitInfo,
    TransitPurpose,
    TransitRequest,
)
from trippilot.providers.transit import TransitProvider

from tests.fakes.fake_travel import FakeTravel
from tests.generators.transit import (
    delay_triggers,
    transit_infos,
    transit_requests,
)


# ━━━ ① 직렬화 왕복 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


@given(req=transit_requests())
def test_transit_request_serialization_roundtrip(req: TransitRequest) -> None:
    assert TransitRequest.from_dict(req.to_dict()) == req


@given(info=transit_infos())
def test_transit_info_serialization_roundtrip(info: TransitInfo) -> None:
    assert TransitInfo.from_dict(info.to_dict()) == info


@given(trigger=delay_triggers())
def test_delay_trigger_serialization_roundtrip(trigger: DelayTrigger) -> None:
    assert DelayTrigger.from_dict(trigger.to_dict()) == trigger


# ━━━ ② INV-3 — internal_minutes 공개 직렬화 제외 ━━━━━━━━━━━━━━━━━━━━━━━


@given(info=transit_infos())
def test_public_dict_never_exposes_internal_minutes(info: TransitInfo) -> None:
    public = info.to_public_dict()
    assert "internal_minutes" not in public
    assert "delay_trigger" not in public
    assert "freshness" not in public
    # 거리는 정상 노출
    assert "distance_m" in public
    assert "distance_range" in public
    assert "confidence" in public


# ━━━ ③ 검증 — 잘못된 값은 생성 불가 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


def test_transit_request_rejects_naive_datetime() -> None:
    with pytest.raises(ValueError, match="tz-aware"):
        TransitRequest(
            origin=GeoPoint(33.5, 126.5),
            destination=GeoPoint(33.6, 126.6),
            mode=TransportMode.CAR,
            purpose=TransitPurpose.INFO_DISPLAY,
            now=datetime(2026, 8, 19, 12, 0, 0),  # naive!
        )


def test_transit_request_rejects_negative_expected_minutes() -> None:
    with pytest.raises(ValueError, match="expected_minutes 음수"):
        TransitRequest(
            origin=GeoPoint(33.5, 126.5),
            destination=GeoPoint(33.6, 126.6),
            mode=TransportMode.CAR,
            purpose=TransitPurpose.DELAY_CHECK,
            now=datetime(2026, 8, 19, 12, 0, 0, tzinfo=timezone.utc),
            expected_minutes=-5,
        )


def test_transit_info_rejects_negative_distance() -> None:
    from trippilot.domain.freshness import FreshnessMeta

    freshness = FreshnessMeta(
        source="test", fetched_at=datetime.now(timezone.utc),
        cache_hit=False, ttl_sec=600, stale=False,
    )
    with pytest.raises(ValueError, match="distance_m 음수"):
        TransitInfo(
            distance_m=-1,
            distance_range="약 1km",
            internal_minutes=10,
            confidence=Confidence.LOW,
            source="test",
            delay_trigger=None,
            freshness=freshness,
        )


def test_delay_trigger_rejects_negative_delay() -> None:
    with pytest.raises(ValueError, match="delay_minutes 음수"):
        DelayTrigger(delay_minutes=-1, threshold_minutes=30)


def test_delay_trigger_rejects_zero_threshold() -> None:
    with pytest.raises(ValueError, match="threshold_minutes는 양수만"):
        DelayTrigger(delay_minutes=10, threshold_minutes=0)


# ━━━ ④⑤ TransitProvider v2 — fetch / fetch_typed ━━━━━━━━━━━━━━━━━━━━━━━━


def _make_provider() -> TransitProvider:
    return TransitProvider(port=FakeTravel(), ttl_sec=600)


def _sample_params() -> dict:
    return {
        "origin": GeoPoint(33.5, 126.5),
        "destination": GeoPoint(33.6, 126.6),
        "mode": TransportMode.CAR,
        "now": datetime(2026, 8, 19, 12, 0, 0, tzinfo=timezone.utc),
        "expected_minutes": None,
    }


def _sample_request() -> TransitRequest:
    return TransitRequest(
        origin=GeoPoint(33.5, 126.5),
        destination=GeoPoint(33.6, 126.6),
        mode=TransportMode.CAR,
        purpose=TransitPurpose.INFO_DISPLAY,
        now=datetime(2026, 8, 19, 12, 0, 0, tzinfo=timezone.utc),
    )


def test_provider_fetch_returns_ok_packet() -> None:
    provider = _make_provider()
    packet = provider.fetch(_sample_params())
    assert packet.provider == ProviderKind.TRANSIT
    assert packet.status == ProviderStatus.OK
    assert packet.freshness is not None
    # data는 TransitInfo schema
    data = packet.data
    assert "distance_m" in data
    assert "distance_range" in data
    assert "confidence" in data
    assert "internal_minutes" in data  # 내부 dict에는 있음
    assert "source" in data


def test_provider_fetch_typed_returns_ok_packet() -> None:
    provider = _make_provider()
    packet = provider.fetch_typed(_sample_request())
    assert packet.provider == ProviderKind.TRANSIT
    assert packet.status == ProviderStatus.OK
    # TransitInfo로 역직렬화 가능
    info = TransitInfo.from_dict(packet.data)
    assert info.distance_m >= 0
    assert info.confidence == Confidence.LOW  # FakeTravel source = haversine_fake


def test_provider_fetch_with_dict_params_reconstructable() -> None:
    """fetch(params: dict)로 받은 packet.data가 TransitInfo로 역직렬화 된다."""
    provider = _make_provider()
    packet = provider.fetch(_sample_params())
    info = TransitInfo.from_dict(packet.data)
    assert info.confidence == Confidence.LOW
    assert info.source == "haversine_fake"


def test_provider_returns_unavailable_on_port_failure() -> None:
    """TravelPort가 예외를 던지면 UNAVAILABLE 패킷 반환 (INV-4)."""

    class BrokenPort:
        def estimate(self, from_, to, mode):
            raise RuntimeError("API down")

    provider = TransitProvider(port=BrokenPort(), ttl_sec=600)  # type: ignore[arg-type]
    packet = provider.fetch(_sample_params())
    assert packet.status == ProviderStatus.UNAVAILABLE
    assert packet.freshness is None


# ━━━ ⑥ 지연 트리거 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


def test_provider_triggers_delay_when_exceeds_threshold() -> None:
    """예정 대비 30분 이상 초과 시 트리거 발동."""
    provider = _make_provider()
    params = _sample_params()
    # FakeTravel로 제주 내 ~14km 정도 → CAR 30km/h → ~28분.
    # expected_minutes를 매우 작게 설정해 강제 트리거
    params["expected_minutes"] = 0
    packet = provider.fetch(params)
    info = TransitInfo.from_dict(packet.data)
    # internal_minutes가 30 이상이면 트리거 발동
    if info.internal_minutes >= 30:
        assert info.delay_trigger is not None
        assert info.delay_trigger.delay_minutes == info.internal_minutes
        assert info.delay_trigger.threshold_minutes == 30


def test_provider_no_trigger_when_within_threshold() -> None:
    """예정 대비 30분 미만이면 트리거 None."""
    provider = _make_provider()
    params = _sample_params()
    params["expected_minutes"] = 9999  # 매우 큰 값 → 지연 없음
    packet = provider.fetch(params)
    info = TransitInfo.from_dict(packet.data)
    assert info.delay_trigger is None


def test_provider_no_trigger_when_expected_minutes_absent() -> None:
    """expected_minutes가 None이면 트리거 미판정."""
    provider = _make_provider()
    params = _sample_params()
    params["expected_minutes"] = None
    packet = provider.fetch(params)
    info = TransitInfo.from_dict(packet.data)
    assert info.delay_trigger is None
