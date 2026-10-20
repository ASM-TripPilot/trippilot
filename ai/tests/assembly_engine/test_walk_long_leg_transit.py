"""도보 여행도 도로 1.5km 이상은 대중교통이다 — 2026-10-20 사용자("아무리 도보를 선택했어도 1.5km 이상이면
대중교통 태우게 해. 그렇게 시간 반영도 하고").

증명하는 것:
  ① 조립 추정기: 도보 요청의 도로 1.5km 이상 구간은 같은 거리 대중교통 요청과 같은 분으로 잰다(걸을 때보다 짧다).
     바로 아래는 종전처럼 걷는다
  ② 화면 거리 감싸개: 그 구간은 실경로를 대중교통으로 부르고 실측값을 그대로 쓰며, 이름표는 "대중교통"이다
"""

from __future__ import annotations

from trippilot.api.wiring import _render_distance
from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.travel import TRANSIT_SOURCE, TravelEstimator, WalkFirst
from trippilot.domain.common import GeoPoint, TransportMode
from trippilot.domain.travel import TravelEstimate

W, P = TransportMode.WALK, TransportMode.PUBLIC
_CFG = AssemblyConfig()
_ORIGIN = GeoPoint(37.5, 127.0)


def _road_north(road_km: float) -> GeoPoint:
    return GeoPoint(37.5 + road_km / _CFG.detour_factor / 111.195, 127.0)


# ① ─────────────────────────────────────────────────────────────────────────

def test_도보_여행의_먼_구간은_대중교통_시간으로_잰다() -> None:
    est = TravelEstimator(_CFG)
    to = _road_north(_CFG.walk_transit_from_km + 0.05)

    far = est.estimate(_ORIGIN, to, W)

    assert far.source == TRANSIT_SOURCE
    assert far.internal_minutes == est.estimate(_ORIGIN, to, P).internal_minutes
    walked = TravelEstimator(AssemblyConfig(walk_transit_from_km=99.0)).estimate(_ORIGIN, to, W)
    assert far.internal_minutes < walked.internal_minutes          # 하루에 더 넣을 수 있다


def test_1_5km_아래는_걷는다() -> None:
    near = TravelEstimator(_CFG).estimate(_ORIGIN, _road_north(_CFG.walk_transit_from_km - 0.05), W)

    assert near.source == "haversine_x_detour"


# ② ─────────────────────────────────────────────────────────────────────────

class _Port:
    """실경로 자리 — 받은 수단을 적고 실측값을 돌려준다."""

    def __init__(self) -> None:
        self.modes: list[TransportMode] = []

    def estimate(self, from_, to, mode):  # noqa: ANN001
        self.modes.append(mode)
        return TravelEstimate(distance_km_range=(2.3, 2.3), internal_minutes=21, is_estimated=False,
                              source="odsay")


def test_화면_거리는_대중교통_실경로로_재고_이름표는_대중교통() -> None:
    port = _Port()
    wrapped = WalkFirst(port, TravelEstimator(_CFG))

    far = wrapped.estimate(_ORIGIN, _road_north(2.0), W)

    assert port.modes == [P]
    assert (far.distance_km_range, far.is_estimated) == ((2.3, 2.3), False)
    assert _render_distance(far, W) == "약 2.3km · 대중교통"


def test_화면_거리의_가까운_구간은_도보_그대로() -> None:
    port = _Port()

    near = WalkFirst(port, TravelEstimator(_CFG)).estimate(_ORIGIN, _road_north(1.0), W)

    assert port.modes == [W]
    assert _render_distance(near, W) == "약 2.3km · 도보"
