"""도보 여행의 "1.5km 이상은 대중교통" 규칙은 **화면에 보이는 실측 거리**로도 지킨다 (2026-10-20 개발 서버 실측 후속).

#1464 의 판정은 조립 추정 거리(직선 × 1.3)로 한다. 실측 경로가 그보다 길면 "약 1.6km · 도보"처럼 규칙을
어긴 줄이 보일 수 있다. 그래서 화면 거리 감싸개(`WalkFirst`)가 실측이 기준을 넘으면 대중교통으로 바꿔 잰다.
시각은 걷기로 잡혀 있지만 대중교통이 더 빠르므로 일정은 그대로 성립한다.

증명하는 것:
  ① 추정은 기준 아래인데 실측이 넘는 도보 구간 → 대중교통으로 다시 재고 이름표는 "대중교통"
  ② 실측도 기준 아래면 도보 그대로 (업체 호출 1회)
  ③ 실경로가 없는(추정기뿐인) 배선에서는 아무것도 바뀌지 않는다
"""

from __future__ import annotations

from trippilot.api.wiring import _render_distance
from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.travel import TravelEstimator, WalkFirst
from trippilot.domain.common import GeoPoint, TransportMode
from trippilot.domain.travel import TravelEstimate

W, P = TransportMode.WALK, TransportMode.PUBLIC
_CFG = AssemblyConfig()
_ORIGIN = GeoPoint(37.5, 127.0)


def _road_north(road_km: float) -> GeoPoint:
    return GeoPoint(37.5 + road_km / _CFG.detour_factor / 111.195, 127.0)


class _Port:
    """실경로 자리 — 수단별로 정해진 실측 거리를 돌려주고, 받은 수단을 적는다."""

    def __init__(self, measured_km: float) -> None:
        self.measured_km = measured_km
        self.modes: list[TransportMode] = []

    def estimate(self, from_, to, mode):  # noqa: ANN001
        self.modes.append(mode)
        return TravelEstimate(distance_km_range=(self.measured_km, self.measured_km), internal_minutes=20,
                              is_estimated=False, source="odsay" if mode is P else "tmap")


def test_추정은_아래인데_실측이_넘는_도보_구간은_대중교통으로_바꾼다() -> None:
    port = _Port(measured_km=1.6)
    near = _road_north(_CFG.walk_transit_from_km - 0.1)            # 추정 1.4km → 조립은 걷기로 잡았다

    out = WalkFirst(port, TravelEstimator(_CFG)).estimate(_ORIGIN, near, W)

    assert port.modes == [W, P]
    assert _render_distance(out, W) == "약 1.6km · 대중교통"


def test_실측도_아래면_도보_그대로() -> None:
    port = _Port(measured_km=1.4)

    out = WalkFirst(port, TravelEstimator(_CFG)).estimate(_ORIGIN, _road_north(1.3), W)

    assert port.modes == [W]
    assert _render_distance(out, W) == "약 1.4km · 도보"


def test_실경로가_없으면_바뀌지_않는다() -> None:
    est = TravelEstimator(_CFG)
    near = _road_north(_CFG.walk_transit_from_km - 0.1)

    assert WalkFirst(est, est).estimate(_ORIGIN, near, W) == est.estimate(_ORIGIN, near, W)
