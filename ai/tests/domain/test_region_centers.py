"""지역 중심 표 — 가장 구체적인 이름이 이기고, 표에 없는 지역은 지어내지 않는다."""

from trippilot.domain.common import GeoPoint
from trippilot.domain.region_centers import region_center


def test_most_specific_name_wins_and_unknown_is_none() -> None:
    assert region_center("부산 해운대") == (GeoPoint(35.1631, 129.1635), 3.0)  # '부산'보다 긴 '해운대'
    assert region_center("제주 애월") == (GeoPoint(33.4628, 126.3316), 4.0)
    assert region_center("서울특별시") == region_center("서울")
    assert region_center("강원도") is None  # 도 이름은 한 점으로 대표할 수 없다
    assert region_center("") is None
