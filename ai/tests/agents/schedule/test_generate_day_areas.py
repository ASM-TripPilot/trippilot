"""생성 경로 — 여러 날이 날마다 다른 동네로 간다 (2026-10-20 사용자: "왜 항상 을지로 부근으로만 나와").

서울 2박3일(숙소 없음 → 앵커 = 시청)이 사흘 모두 시청 1km 안이었다(로컬 실측). 두 원인: 다일 반경 축소(×0.7 →
7km)가 강남역(8.8km)·성수(7.3km)를 풀에서 뺐고, 같은 앵커·같은 점수로 날마다 고르니 가장 몰린 곳이 매일 이겼다.
"""

from __future__ import annotations

from datetime import date

from trippilot.assembly_engine.travel import haversine_km
from trippilot.domain.common import GeoPoint
from trippilot.domain.poi import PoiCategory

from tests.agents.schedule.test_schedule_fixed_poi_index import _ANCHOR, _client, _poi, _request
from tests.fakes.in_memory_poi import InMemoryPoi

_DAYS = (date(2026, 10, 25), date(2026, 10, 26), date(2026, 10, 27))
_AREAS = {"을지로": _ANCHOR, "성수": GeoPoint(37.5446, 127.0557), "강남": GeoPoint(37.4979, 127.0276)}


def _area_pois():
    return tuple(
        _poi(f"{name}{i}", at.lat + 0.0003 * (i % 6), at.lng + 0.0003 * (i // 6),
             PoiCategory.FOOD if i % 4 == 0 else PoiCategory.SIGHT)
        for name, at in _AREAS.items() for i in range(30))


def _area_of(lat: float, lng: float) -> str:
    return min(_AREAS, key=lambda k: haversine_km(GeoPoint(lat, lng), _AREAS[k]))


def test_사흘이_서로_다른_동네로_간다() -> None:
    pois = _area_pois()
    coord = {str(p.poi_id): p.coord for p in pois}
    with _client(InMemoryPoi(pois)) as client:
        response = client.post("/ai/v1/itinerary/generate", json=_request(_DAYS, []))
    assert response.status_code == 200, response.text
    days = response.json()["days"]
    areas = []
    for d in days:
        slots = [coord[s["poi_id"]] for s in d["slots"]]
        assert slots, d
        names = {_area_of(c.lat, c.lng) for c in slots}
        assert len(names) == 1, (d["date"], names)  # 하루는 한 동네 안
        areas.append(names.pop())
    assert sorted(areas) == sorted(_AREAS), areas  # 사흘이 세 동네를 하나씩
