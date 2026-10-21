"""자차 여행의 주차 거점 — 가까운 장소들은 차를 한 번 세우고 걸어서 돈다 (2026-10-21 사용자 "매번 자차로 움직이지 않고
어느 정도 가까우면 걸어가게 하고 주차했던 곳으로 돌아가게").

증명하는 것:
  ① 묶기(`plan_parking`): 걷는 거리 안 장소는 한 거점, 멀면 혼자. 결정론. 거점 양쪽 끝 둘이 1.1km 넘게 떨어지면 한쪽만 붙는다
  ② 조립 추정기(CAR + 계획): 같은 거점 = 걷기(주차 여유 없음) · 떠나기 = 거점까지 걷기 + 운전 + 여유 · 거점 없는 지점(숙소)은 운전
     계획 없는 자차(검증·수리·편집): 700m 이하 걷기 — 어느 쌍이든 생성이 잡아 둔 시간보다 더 요구하지 않는다(속성, HC2 정합)
  ③ 화면 문구: 걷는 구간 "도보", 떠나는 구간 "자가용 … (주차장 도보 0.4km 포함)", 첫 숫자가 합친 거리(FE 총거리 파서)
  ④ 화면 감싸개(`WalkFirst`): 운전 구간만 거점에서 거점까지 실측, 걷는 꼬리는 거리에 더하고 walk_km 로 남긴다
"""

from __future__ import annotations

import re

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.api.wiring import _render_distance
from trippilot.assembly_engine.config import WALK_HARD_MAX_KM, AssemblyConfig
from trippilot.assembly_engine.parking import plan_parking
from trippilot.assembly_engine.travel import PARKED_SOURCE, WALKED_SOURCE, TravelEstimator, WalkFirst, haversine_km
from trippilot.domain.common import GeoPoint, TransportMode
from trippilot.domain.travel import TravelEstimate

C, W = TransportMode.CAR, TransportMode.WALK
_CFG = AssemblyConfig()
_KM_LAT = 1 / 111.195


def _at(north_km: float, east_km: float = 0.0) -> GeoPoint:  # 직선 km 로 좌표를 놓는다(위도 37.5 부근, 경도는 cos 보정)
    return GeoPoint(37.5 + north_km * _KM_LAT, 127.0 + east_km * _KM_LAT / 0.7934)


H, A, B, F, Z = _at(0), _at(0.3), _at(-0.3), _at(0, 5.0), _at(0, -3.0)  # 거점·이웃 둘·먼 곳·숙소(계획 밖)
PLAN = plan_parking([H, A, B, F], walk_max_km=_CFG.public_walk_max_km, detour_factor=_CFG.detour_factor)
EST, PLAIN = TravelEstimator(_CFG, PLAN), TravelEstimator(_CFG)


# ① ─────────────────────────────────────────────────────────────────────────

def test_가까운_셋은_한_거점_먼_곳은_혼자() -> None:
    assert PLAN.hub_of(A) == PLAN.hub_of(B) == PLAN.hub_of(H) == H  # 이웃이 가장 많은 H 가 거점
    assert PLAN.hub_of(F) == F and PLAN.hub_of(Z) is None
    assert PLAN.walk_clusters == 1


def test_거점_양쪽_끝이_1_1km_넘게_떨어지면_한쪽만_붙는다() -> None:
    near, far = _at(0.5), _at(-0.5)  # 거점에서 각 0.65km(도로) — 둘 사이는 1.3km 로 절대 상한을 넘는다
    plan = plan_parking([H, near, far], walk_max_km=0.7, detour_factor=1.3)
    assert sorted(p == H for p in (plan.hub_of(near), plan.hub_of(far))) == [False, True]


@settings(max_examples=60, deadline=None)
@given(st.lists(st.tuples(st.floats(0, 3, allow_nan=False), st.floats(0, 3, allow_nan=False)), min_size=2, max_size=12))
def test_묶음_불변식_결정론_거점거리_상한_안_장소끼리_1_1km_안(points: list[tuple[float, float]]) -> None:
    pts = [_at(n, e) for n, e in points]
    plan = plan_parking(pts, walk_max_km=0.7, detour_factor=1.3)
    assert plan == plan_parking(reversed(pts), walk_max_km=0.7, detour_factor=1.3)  # 입력 순서와 무관
    for p in set(pts):
        hub = plan.hub_of(p)
        assert hub is not None and haversine_km(p, hub) * 1.3 <= 0.7 + 1e-9
        for q in set(pts):
            if plan.hub_of(q) == hub:
                assert haversine_km(p, q) * 1.3 <= WALK_HARD_MAX_KM + 1e-9


# ② ─────────────────────────────────────────────────────────────────────────

def test_같은_거점_안은_걷고_주차_여유가_없다() -> None:
    walked = EST.estimate(H, A, C)  # 거점 ↔ 이웃, 도로 0.39km
    assert walked.source == WALKED_SOURCE and walked.walk_km == 0.0
    assert walked.internal_minutes == PLAIN.estimate(H, A, W).internal_minutes - _CFG.buffer_min


def test_거점을_떠날_때는_거점까지_걷고_운전한다() -> None:
    leaving = EST.estimate(A, F, C)
    drive, back = PLAIN.estimate(H, F, C), PLAIN.estimate(A, H, W)
    assert leaving.source == PARKED_SOURCE
    # 한 번에 반올림하므로 항별 합과 ±1분 — 그리고 계획 없는 직행 운전 요구보다 작지 않다(HC2 정합)
    assert abs(leaving.internal_minutes - (drive.internal_minutes + back.internal_minutes - _CFG.buffer_min)) <= 1
    assert leaving.internal_minutes >= PLAIN.estimate(A, F, C).internal_minutes
    assert leaving.distance_km_range[1] == pytest.approx(drive.distance_km_range[1] + back.distance_km_range[1], abs=0.002)
    assert leaving.walk_km == pytest.approx(back.distance_km_range[1], abs=0.002)
    assert leaving.distance_km_range[0] <= leaving.distance_km_range[1]


def test_숙소에서_들어갈_때는_거점에_주차하고_걷는다_거점_없는_둘_사이는_그냥_운전() -> None:
    entering = EST.estimate(Z, A, C)
    assert entering.source == PARKED_SOURCE and entering.walk_km == pytest.approx(0.39, abs=0.01)
    plain = EST.estimate(Z, F, C)
    assert plain.source == "haversine_x_detour" and plain.walk_km == 0.0
    assert plain == PLAIN.estimate(Z, F, C)


def test_계획이_없는_자차는_700m_이하만_걷고_나머지는_운전이다() -> None:
    """검증·수리·편집은 생성의 계획을 받지 못한다 — 대중교통과 같은 규칙으로 재되, 생성보다 더 요구하지 않아야 한다(아래 속성)."""
    assert PLAIN.estimate(H, A, C).source == WALKED_SOURCE          # 도로 0.39km
    assert PLAIN.estimate(A, B, C).source == "haversine_x_detour"   # 도로 0.78km — 운전 + 주차 여유


def test_같은_거점이라도_700m_넘는_구간은_운전_요구만큼은_잡아_둔다() -> None:
    """거점 양쪽의 두 장소(도로 0.78km): 걷기 16분 < 운전 2분+여유 15분 — 계획 없는 재검증이 요구할 17분을 예약한다."""
    walked = EST.estimate(A, B, C)
    assert walked.source == WALKED_SOURCE
    assert walked.internal_minutes == max(PLAIN.estimate(A, B, W).internal_minutes - _CFG.buffer_min,
                                          PLAIN.estimate(A, B, C).internal_minutes)


@settings(max_examples=80, deadline=None)
@given(st.lists(st.tuples(st.floats(0, 4, allow_nan=False), st.floats(0, 4, allow_nan=False)), min_size=2, max_size=10),
       st.data())
def test_속성_계획_없는_재검증은_생성이_잡아_둔_시간보다_더_요구하지_않는다(points: list[tuple[float, float]], data) -> None:
    """HC2 정합 — 생성(계획 있음)이 예약한 분 ≥ 검증·수리·편집(계획 없음)이 요구하는 분. 어느 쌍(숙소 포함)이든."""
    pts = [_at(n, e) for n, e in points]
    est = TravelEstimator(_CFG, plan_parking(pts, walk_max_km=_CFG.public_walk_max_km, detour_factor=_CFG.detour_factor))
    anchor = _at(-1.0, -1.0)
    a = data.draw(st.sampled_from(pts + [anchor]))
    b = data.draw(st.sampled_from(pts + [anchor]))
    planned, plain = est.estimate(a, b, C), PLAIN.estimate(a, b, C)
    assert planned.internal_minutes >= plain.internal_minutes
    assert planned.distance_km_range[0] <= planned.distance_km_range[1]
    assert planned.walk_km >= 0 and (planned.walk_km == 0) == (planned.source != PARKED_SOURCE)


# ③ ─────────────────────────────────────────────────────────────────────────

def test_문구는_구간의_수단과_주차장_도보를_적는다() -> None:
    assert _render_distance(EST.estimate(A, B, C), C).endswith("· 도보 추정")
    leaving = _render_distance(EST.estimate(A, F, C), C)
    assert leaving.endswith("· 자가용 추정 (주차장 도보 0.4km 포함)"), leaving
    first = float(re.match(r"약 (\d+\.\d)km", leaving).group(1))  # FE legDistance 는 첫 숫자를 총거리로 더한다
    assert first == round(EST.estimate(A, F, C).distance_km_range[1], 1)
    assert not any(tok in leaving for tok in ("분", "시간"))  # INV-3


# ④ ─────────────────────────────────────────────────────────────────────────

class _Port:
    def __init__(self) -> None:
        self.calls: list[tuple[GeoPoint, GeoPoint, TransportMode]] = []

    def estimate(self, from_: GeoPoint, to: GeoPoint, mode: TransportMode) -> TravelEstimate:
        self.calls.append((from_, to, mode))
        return TravelEstimate((6.0, 6.0), 12, False, "tmap")


def test_화면_감싸개는_운전_구간만_거점_사이로_실측하고_걷는_꼬리를_더한다() -> None:
    port = _Port()
    shown = WalkFirst(port, EST).estimate(A, F, C)
    assert port.calls == [(H, F, C)]
    assert shown.is_estimated is False and shown.distance_km_range == (6.39, 6.39) and shown.walk_km == pytest.approx(0.39, abs=0.001)
    assert _render_distance(shown, C) == "약 6.4km · 자가용 (주차장 도보 0.4km 포함)"


def test_화면_감싸개는_걷는_구간에_실경로를_부르지_않는다() -> None:
    port = _Port()
    assert WalkFirst(port, EST).estimate(A, B, C).source == WALKED_SOURCE and port.calls == []
