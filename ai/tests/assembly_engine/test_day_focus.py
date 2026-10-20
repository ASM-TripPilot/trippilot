"""여러 날 생성을 날마다 다른 동네로 (2026-10-20 사용자 — "왜 항상 을지로 부근으로만 나와, 강남도 연희동도 성수동도").

서울 2박3일(숙소 없음 → 앵커 = 시청)이 사흘 모두 시청 1km 안이었다(로컬 실측, 취향 없음). 점수가 몰린 곳
여럿을 서로 떨어지게 골라 날마다 하나씩 주고, 그날 자유 후보를 그 근처로 좁힌다.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from trippilot.assembly_engine.day_focus import FOCUS_KM, focus_candidates, pick_day_focus
from trippilot.assembly_engine.travel import haversine_km
from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource

_D = (date(2026, 10, 30), date(2026, 10, 31), date(2026, 11, 1))
_CITY_HALL = GeoPoint(37.5665, 126.9780)
_SEONGSU = GeoPoint(37.5446, 127.0557)
_GANGNAM = GeoPoint(37.4979, 127.0276)


def _poi(pid: str, at: GeoPoint) -> Poi:
    return Poi(PoiId(pid), pid, PoiCategory.SIGHT, at, (), None, None, DataQuality.FULL, PoiSource.SEED, None)


def _cluster(prefix: str, at: GeoPoint, n: int, score: float) -> list[tuple[Poi, ScoredPoi]]:
    return [(_poi(f"{prefix}{i}", GeoPoint(at.lat + 0.0002 * i, at.lng)), ScoredPoi(PoiId(f"{prefix}{i}"), score, False))
            for i in range(n)]


def _split(rows):
    return {p.poi_id: p for p, _ in rows}, tuple(c for _, c in rows)


def test_점수가_몰린_동네를_서로_떨어지게_날마다_하나씩() -> None:
    index, cands = _split(_cluster("c", _CITY_HALL, 30, 0.9) + _cluster("s", _SEONGSU, 20, 0.8)
                          + _cluster("g", _GANGNAM, 20, 0.7))
    focus = pick_day_focus(cands, index, _D)
    centers = [focus[d] for d in _D]
    assert haversine_km(centers[0], _CITY_HALL) < 1.0  # 가장 많이 몰린 곳이 첫날
    assert haversine_km(centers[1], _SEONGSU) < 1.0
    assert haversine_km(centers[2], _GANGNAM) < 1.0


def test_떨어진_동네가_날보다_적으면_남는_날은_좁히지_않는다() -> None:
    index, cands = _split(_cluster("c", _CITY_HALL, 30, 0.9))
    focus = pick_day_focus(cands, index, _D)
    assert list(focus) == [_D[0]]


def test_하루짜리는_좁히지_않는다() -> None:
    index, cands = _split(_cluster("c", _CITY_HALL, 30, 0.9) + _cluster("g", _GANGNAM, 20, 0.7))
    assert pick_day_focus(cands, index, _D[:1]) == {}


def test_그날_후보는_그_동네_근처만_모자라면_좁히지_않는다() -> None:
    rows = _cluster("c", _CITY_HALL, 40, 0.9) + _cluster("g", _GANGNAM, 5, 0.7)
    index, cands = _split(rows)
    near_hall = focus_candidates(cands, index, _CITY_HALL)
    assert {str(c.poi_id)[0] for c in near_hall} == {"c"}
    assert all(haversine_km(index[c.poi_id].coord, _CITY_HALL) <= FOCUS_KM for c in near_hall)
    assert focus_candidates(cands, index, _GANGNAM) == cands  # 강남 근처 5곳 — 하루를 못 채운다
    assert focus_candidates(cands, index, None) == cands
