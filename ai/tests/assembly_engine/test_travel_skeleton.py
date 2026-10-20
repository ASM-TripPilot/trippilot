"""U1 walking skeleton — travel 수직 절편 PBT.

증명하는 것:
  ① 직렬화 왕복 (U5-P10): from_dict(to_dict(x)) == x
  ② INV-3        : to_public_dict()에 internal_minutes가 존재하지 않음
  ③ 결정론 (U5-P4): 같은 입력 → FakeTravel이 항상 같은 출력
"""

from __future__ import annotations

from hypothesis import given

from trippilot.domain.common import GeoPoint, TransportMode
from trippilot.domain.travel import TravelEstimate
from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.travel import TravelEstimator

from tests.fakes.fake_travel import FakeTravel
from tests.generators.geo import geo_points, transport_modes
from tests.generators.travel import travel_estimates


# ① 직렬화 왕복 — 저장/복원해도 안 깨진다 (U5-P10)
@given(est=travel_estimates())
def test_travel_estimate_serialization_roundtrip(est: TravelEstimate) -> None:
    assert TravelEstimate.from_dict(est.to_dict()) == est


# ② INV-3 — 시간이 공개 직렬화로 새어나가지 않는다
@given(est=travel_estimates())
def test_public_dict_never_exposes_internal_minutes(est: TravelEstimate) -> None:
    public = est.to_public_dict()
    assert "internal_minutes" not in public
    # 거리는 정상 노출
    assert "distance_km_range" in public


# ③ 결정론 — FakeTravel은 같은 입력에 같은 값 (U5-P4)
@given(a=geo_points(), b=geo_points(), mode=transport_modes())
def test_fake_travel_is_deterministic(a, b, mode) -> None:
    fake = FakeTravel()
    first = fake.estimate(a, b, mode)
    second = fake.estimate(a, b, mode)
    assert first == second
    # 산출물 자체도 불변식 만족 (범위 low ≤ high)
    assert first.distance_km_range[0] <= first.distance_km_range[1]


# ── 대중교통 짧은 구간은 걷는다 (TRIP-405 후속) ─────────────────────────
# 배경: BUFFER(15분)는 정류장 대기·환승 모델이라 걸어갈 땐 안 붙는다. 그대로 두면
# 500m 를 18분으로 계산해 하루에 넣을 장소가 줄어든다 (해운대 리허설 6구간 전부
# 과대추정). 두 값을 재서 빠른 쪽을 쓴다 — 사람이 실제로 하는 선택.

def _est(km: float, mode: TransportMode) -> TravelEstimate:
    """위도 1도 ≈ 111.19km — 원하는 직선거리를 만드는 두 점."""
    cfg = AssemblyConfig()
    return TravelEstimator(cfg).estimate(
        GeoPoint(35.0, 129.0), GeoPoint(35.0 + km / 111.19, 129.0), mode)


def test_대중교통_짧은_구간은_도보로_잰다() -> None:
    e = _est(0.3, TransportMode.PUBLIC)
    assert e.source == "haversine_x_detour(walk)"
    assert e.internal_minutes < _est(0.3, TransportMode.WALK).internal_minutes  # 버퍼 없음


def test_대중교통_먼_구간은_그대로_대중교통() -> None:
    e = _est(3.0, TransportMode.PUBLIC)
    assert e.source == "haversine_x_detour"


def test_도보_치환은_대중교통보다_느려지지_않는다() -> None:
    """min() 이므로 어떤 거리에서도 기존 대중교통 추정보다 크면 안 된다."""
    cfg = AssemblyConfig()
    for km in (0.05, 0.2, 0.5, 0.7, 0.9, 1.2, 2.0, 5.0, 20.0):
        road = km * cfg.detour_factor
        transit_only = int(round(
            road / cfg.speeds_kmph[TransportMode.PUBLIC] * 60
            * cfg.safety[TransportMode.PUBLIC])) + cfg.buffer_min
        assert _est(km, TransportMode.PUBLIC).internal_minutes <= transit_only


def test_600m_이하는_계산상_대중교통이_빨라도_걷는다() -> None:
    """사람은 600m 를 버스로 가지 않는다 — 속도 상수가 바뀌어도 이 바닥은 유지된다."""
    cfg = AssemblyConfig()
    # 도보를 일부러 느리게 만들어 min() 만으로는 대중교통이 이기게 한다
    slow = AssemblyConfig(speeds_kmph={**cfg.speeds_kmph, TransportMode.WALK: 0.5})
    km = (cfg.public_walk_max_km - 0.05) / cfg.detour_factor   # 기준은 도로 km (2026-10-19)
    e = TravelEstimator(slow).estimate(
        GeoPoint(35.0, 129.0), GeoPoint(35.0 + km / 111.19, 129.0), TransportMode.PUBLIC)
    assert e.source == "haversine_x_detour(walk)"


def test_600m_바로_위는_빠른_쪽을_따른다() -> None:
    cfg = AssemblyConfig()
    slow = AssemblyConfig(speeds_kmph={**cfg.speeds_kmph, TransportMode.WALK: 0.5})
    km = (cfg.public_walk_max_km + 0.05) / cfg.detour_factor
    e = TravelEstimator(slow).estimate(
        GeoPoint(35.0, 129.0), GeoPoint(35.0 + km / 111.19, 129.0), TransportMode.PUBLIC)
    assert e.source == "haversine_x_detour"   # 도보가 느리므로 대중교통


def test_도보_모드_자체는_바뀌지_않는다() -> None:
    """치환은 PUBLIC 요청에만 적용된다 — WALK 요청은 버퍼 포함 그대로."""
    assert _est(0.3, TransportMode.WALK).source == "haversine_x_detour"


def test_거리에_대해_단조_증가한다() -> None:
    """min() 이 두 단조 함수의 최소라 단조성은 유지된다 (U5-P4 결정론과 별개)."""
    mins = [_est(km, TransportMode.PUBLIC).internal_minutes
            for km in (0.1, 0.5, 1.0, 2.0, 5.0, 10.0)]
    assert mins == sorted(mins)


# ── 긴 구간은 시외 속도 (DEV 2026-10-14: 제주시 → 성산 38km 를 240분으로 재 오전이 통째로 비었다) ──

def test_긴_구간은_시외_속도로_재서_도시_속도보다_짧다() -> None:
    city_only = TravelEstimator(AssemblyConfig(long_speeds_kmph={
        m: s for m, s in AssemblyConfig().speeds_kmph.items()}))
    a, b = GeoPoint(35.0, 129.0), GeoPoint(35.0 + 38.4 / 111.19, 129.0)
    new = TravelEstimator(AssemblyConfig()).estimate(a, b, TransportMode.PUBLIC).internal_minutes
    old = city_only.estimate(a, b, TransportMode.PUBLIC).internal_minutes
    assert new < 150 < old  # 2시간 반 안쪽 — 실제 1.5~2시간에 안전계수


def test_도시_안_구간은_종전과_같다() -> None:
    city_only = AssemblyConfig(long_speeds_kmph=dict(AssemblyConfig().speeds_kmph))
    for km in (0.5, 2.0, 5.0, 11.0):  # 도로 ≤ 15km (직선 × 1.3)
        for mode in TransportMode:
            a, b = GeoPoint(35.0, 129.0), GeoPoint(35.0 + km / 111.19, 129.0)
            assert (TravelEstimator(AssemblyConfig()).estimate(a, b, mode).internal_minutes
                    == TravelEstimator(city_only).estimate(a, b, mode).internal_minutes)


def test_긴_구간까지_거리에_대해_단조_증가한다() -> None:
    """경계(도로 15km)에서 시간이 줄거나 튀지 않는다 — 구간별 합이라서."""
    mins = [_est(km, mode).internal_minutes
            for mode in (TransportMode.PUBLIC, TransportMode.CAR)
            for km in (10.0, 11.5, 11.6, 12.0, 20.0, 40.0, 80.0)]
    pub, car = mins[:7], mins[7:]
    assert pub == sorted(pub) and car == sorted(car)
