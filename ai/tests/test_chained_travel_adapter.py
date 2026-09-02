"""ChainedTravelAdapter 테스트 (TRIP-422).

증명하는 것:
  ① TMAP 성공 시 실측값 변환 — is_estimated=False, source=tmap_*
  ② TMAP 실패 시 하버사인 폴백 — is_estimated=True, source=haversine_*
  ③ TravelPort Protocol 만족 — estimate 시그니처 정합
  ④ MeasuredTravel → TravelEstimate 변환 정합성 (distance_km, real_minutes)
  ⑤ 폴백도 실패하면 예외 상위 전파 (INV-4)
"""

from __future__ import annotations

import pytest

from trippilot.domain.common import GeoPoint, TransportMode
from trippilot.domain.travel import TravelEstimate
from trippilot.ports.travel_time_port import MeasuredTravel, TravelTimeError
from trippilot.assembly_engine.adapters.chained_travel import ChainedTravelAdapter

_JEJU_A = GeoPoint(33.450, 126.570)
_JEJU_B = GeoPoint(33.460, 126.580)


# ━━━ Fakes ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class FakeTmap:
    """TravelTimePort 가짜 — 고정값 반환."""

    def __init__(
        self,
        real_minutes: float = 12.5,
        distance_km: float = 3.456,
        source: str = "tmap_car",
    ) -> None:
        self._result = MeasuredTravel(
            real_minutes=real_minutes,
            distance_km=distance_km,
            source=source,
            approximated=False,
        )

    def measure(
        self, from_: GeoPoint, to: GeoPoint, mode: TransportMode
    ) -> MeasuredTravel:
        return self._result


class FailingTmap:
    """TravelTimePort 가짜 — 항상 TravelTimeError."""

    def measure(
        self, from_: GeoPoint, to: GeoPoint, mode: TransportMode
    ) -> MeasuredTravel:
        raise TravelTimeError("API down")


class FakeHaversine:
    """TravelPort 가짜 — 고정 추정값."""

    def estimate(
        self, from_: GeoPoint, to: GeoPoint, mode: TransportMode
    ) -> TravelEstimate:
        return TravelEstimate(
            distance_km_range=(1.0, 1.3),
            internal_minutes=5,
            is_estimated=True,
            source="haversine_fake",
        )


class FailingFallback:
    """TravelPort 가짜 — 폴백도 실패."""

    def estimate(
        self, from_: GeoPoint, to: GeoPoint, mode: TransportMode
    ) -> TravelEstimate:
        raise RuntimeError("Fallback also broken")


# ━━━ ① TMAP 성공 시 실측값 변환 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


def test_primary_success_returns_measured_estimate() -> None:
    adapter = ChainedTravelAdapter(
        primary=FakeTmap(real_minutes=12.5, distance_km=3.456, source="tmap_car"),
        fallback=FakeHaversine(),
    )
    result = adapter.estimate(_JEJU_A, _JEJU_B, TransportMode.CAR)

    assert result.is_estimated is False
    assert result.source == "tmap_car"
    assert result.distance_km_range == (3.456, 3.456)
    assert result.internal_minutes == 12  # round(12.5) = 12 (Python banker's rounding)


def test_primary_success_distance_range_is_single_value() -> None:
    """실측이므로 거리 범위 low == high."""
    adapter = ChainedTravelAdapter(
        primary=FakeTmap(distance_km=5.0),
        fallback=FakeHaversine(),
    )
    result = adapter.estimate(_JEJU_A, _JEJU_B, TransportMode.WALK)
    low, high = result.distance_km_range
    assert low == high == 5.0


def test_primary_success_minutes_rounded() -> None:
    """real_minutes float → internal_minutes int (반올림)."""
    adapter = ChainedTravelAdapter(
        primary=FakeTmap(real_minutes=7.3),
        fallback=FakeHaversine(),
    )
    result = adapter.estimate(_JEJU_A, _JEJU_B, TransportMode.CAR)
    assert result.internal_minutes == 7  # round(7.3) = 7

    adapter2 = ChainedTravelAdapter(
        primary=FakeTmap(real_minutes=7.6),
        fallback=FakeHaversine(),
    )
    result2 = adapter2.estimate(_JEJU_A, _JEJU_B, TransportMode.CAR)
    assert result2.internal_minutes == 8  # round(7.6) = 8


# ━━━ ② TMAP 실패 시 하버사인 폴백 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


def test_fallback_on_primary_failure() -> None:
    adapter = ChainedTravelAdapter(
        primary=FailingTmap(),
        fallback=FakeHaversine(),
    )
    result = adapter.estimate(_JEJU_A, _JEJU_B, TransportMode.CAR)

    assert result.is_estimated is True
    assert result.source == "haversine_fake"
    assert result.distance_km_range == (1.0, 1.3)
    assert result.internal_minutes == 5


def test_fallback_on_unexpected_exception() -> None:
    """TravelTimeError 외 예외도 폴백으로 처리."""

    class WeirdError:
        def measure(self, from_, to, mode):
            raise ConnectionResetError("network hiccup")

    adapter = ChainedTravelAdapter(
        primary=WeirdError(),  # type: ignore[arg-type]
        fallback=FakeHaversine(),
    )
    result = adapter.estimate(_JEJU_A, _JEJU_B, TransportMode.PUBLIC)
    assert result.is_estimated is True
    assert result.source == "haversine_fake"


# ━━━ ③ TravelPort Protocol 만족 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


def test_satisfies_travel_port_protocol() -> None:
    """ChainedTravelAdapter.estimate 시그니처가 TravelPort과 동일."""
    from trippilot.ports.travel_port import TravelPort

    adapter = ChainedTravelAdapter(
        primary=FakeTmap(),
        fallback=FakeHaversine(),
    )
    # 구조적 타이핑 — isinstance가 아니라 시그니처로 확인
    assert hasattr(adapter, "estimate")
    result = adapter.estimate(_JEJU_A, _JEJU_B, TransportMode.CAR)
    assert isinstance(result, TravelEstimate)


# ━━━ ④ 변환 정합성 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


def test_transit_source_preserved() -> None:
    """대중교통 source 문자열이 그대로 전달된다."""
    adapter = ChainedTravelAdapter(
        primary=FakeTmap(source="tmap_transit", real_minutes=25.0, distance_km=8.5),
        fallback=FakeHaversine(),
    )
    result = adapter.estimate(_JEJU_A, _JEJU_B, TransportMode.PUBLIC)
    assert result.source == "tmap_transit"
    assert result.is_estimated is False


# ━━━ ⑤ 양쪽 모두 실패 시 예외 전파 (INV-4) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


def test_both_fail_propagates_exception() -> None:
    """primary + fallback 모두 실패하면 예외가 상위로 전파된다."""
    adapter = ChainedTravelAdapter(
        primary=FailingTmap(),
        fallback=FailingFallback(),  # type: ignore[arg-type]
    )
    with pytest.raises(RuntimeError, match="Fallback also broken"):
        adapter.estimate(_JEJU_A, _JEJU_B, TransportMode.CAR)
