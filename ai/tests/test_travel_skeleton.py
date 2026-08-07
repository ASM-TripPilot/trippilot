"""U1 walking skeleton — travel 수직 절편 PBT.

증명하는 것:
  ① 직렬화 왕복 (U5-P10): from_dict(to_dict(x)) == x
  ② INV-3        : to_public_dict()에 internal_minutes가 존재하지 않음
  ③ 결정론 (U5-P4): 같은 입력 → FakeTravel이 항상 같은 출력
"""

from __future__ import annotations

from hypothesis import given

from trippilot.domain.travel import TravelEstimate

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
