"""여행 당일 [적용]의 수리 — 지금(`request_meta.requested_at`, 현지) 전에 시작한 곳은 원 시각 그대로 (TRIP-1709 F1).

백엔드는 장소 구성이 바뀐 편집이면 편집안 전체를 `/repair` 로 보낸다. 수리는 '지금'을 몰라 첫 슬롯부터 밀어서, 이미 다녀온
방문이 새 시각으로 저장됐다(#1724 는 제안 단계만 고쳤다). 지난 곳을 핀으로만 두면 재검증 HC2 가 지난 간격을 잡아 통째로 수리
불가였다 — 그래서 빼고 되붙인다(편집 ⑤ 와 같은 태도).
"""
from __future__ import annotations

from datetime import datetime, timedelta

from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.travel import TravelEstimator
from trippilot.domain.common import GeoPoint, TransportMode

from tests.api.test_e2e_boundary import _ANCHOR, _DAY1, _DAY2, make_client

_EST = TravelEstimator(AssemblyConfig())


def _slot(pid, s, e, fixed=False):
    return {"poi_id": pid, "start_at": s, "end_at": e, "ends_next_day": False, "distance_range": None, "is_fixed": fixed}


def _repair(days, requested_at, **extra):
    itinerary = {"days": days, "solve_mode": "OR_TOOLS", "is_fallback": False}
    with make_client() as client:
        r = client.post("/ai/v1/itinerary/repair", json={
            "itinerary": itinerary, "violations": [],
            "request_meta": {"request_id": "r1709", "requested_at": requested_at, "deadline_ms": 5000}, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def _times(body, i=0):
    return [(s["poi_id"], s["start_at"], s["end_at"]) for s in body["repaired"]["days"][i]["slots"]]


_PAST = [_slot("p1", "09:00:00", "10:00:00"), _slot("p2", "10:05:00", "11:00:00"), _slot("p3", "11:05:00", "12:00:00")]


def test_trip_day_repair_keeps_started_visits_as_they_were() -> None:
    """14:00(05:00Z) — 이미 시작한 p1·p2·p3 는 그 시각 그대로(지난 간격 5분이 추정 19분보다 짧아도). 고치기 전: p2·p3 가 밀렸다."""
    body = _repair([{"date": _DAY1.isoformat(), "slots": [*_PAST, _slot("p4", "15:00:00", "16:00:00")]}],
                   "2026-08-05T05:00:00Z")
    assert _times(body) == [("p1", "09:00:00", "10:00:00"), ("p2", "10:05:00", "11:00:00"),
                            ("p3", "11:05:00", "12:00:00"), ("p4", "15:00:00", "16:00:00")]
    assert body["changes"] == []


def test_trip_day_repair_retimes_the_rest_from_the_place_you_are_at() -> None:
    """지금 있는 곳(가장 최근에 시작한 곳)이 출발점이다 — 다음 곳은 거기서 떠나 닿는 시각 이후로 민다(전방만)."""
    here = _slot("p3", "13:00:00", "14:30:00")
    body = _repair([{"date": _DAY1.isoformat(), "slots": [*_PAST[:2], here, _slot("p4", "14:35:00", "15:30:00")]}],
                   "2026-08-05T05:10:00Z")  # 14:10 — p3 진행 중
    got = _times(body)
    assert got[:3] == [("p1", "09:00:00", "10:00:00"), ("p2", "10:05:00", "11:00:00"), ("p3", "13:00:00", "14:30:00")]
    gap = _EST.estimate(GeoPoint(_ANCHOR.lat + 0.010, _ANCHOR.lng + 0.010),
                        GeoPoint(_ANCHOR.lat + 0.015, _ANCHOR.lng + 0.015), TransportMode.PUBLIC).internal_minutes
    expect = (datetime(2026, 8, 5, 14, 30) + timedelta(minutes=gap)).time().isoformat()
    assert got[3][0] == "p4" and got[3][1] == expect


def test_trip_day_repair_reads_requested_at_as_local_time() -> None:
    """UTC(…+00:00) 그대로 쓰면 05:00 이라 아무것도 '지난 곳'이 아니다 — 현지 14:00 으로 읽어야 지난 곳이 남는다."""
    body = _repair([{"date": _DAY1.isoformat(), "slots": [*_PAST, _slot("p4", "15:00:00", "16:00:00")]}],
                   "2026-08-05T05:00:00+00:00")
    assert _times(body)[1] == ("p2", "10:05:00", "11:00:00")


def test_trip_day_repair_leaves_past_days_and_still_repairs_a_day_not_yet_started() -> None:
    """어제는 전부 지난 곳 — 손 안 댄 어제 시각이 오늘 편집의 수리로 밀리지 않는다. 오늘은 아직 시작 전이면 종전처럼 HC2 만큼 민다."""
    body = _repair([{"date": _DAY1.isoformat(), "slots": list(_PAST)},
                    {"date": _DAY2.isoformat(), "slots": [_slot("p1", "10:00:00", "11:00:00"), _slot("p2", "11:05:00", "12:00:00")]}],
                   "2026-08-05T23:30:00Z")  # 08-06 08:30 KST
    assert _times(body, 0) == [(s["poi_id"], s["start_at"], s["end_at"]) for s in _PAST]
    assert _times(body, 1)[1][1] != "11:05:00"


def test_trip_day_repair_drops_the_fixed_block_of_a_held_slot() -> None:
    """뺀 지난 곳이 고정이면 그 고정 블록도 문제에서 빠져야 한다 — 안 빼면 HC3 미준수로 수리 불가."""
    body = _repair([{"date": _DAY1.isoformat(), "slots": [_slot("p1", "09:00:00", "10:00:00", True), *_PAST[1:],
                                                          _slot("p4", "15:00:00", "16:00:00")]}],
                   "2026-08-05T05:00:00Z")
    assert body["repaired"] is not None
    assert body["repaired"]["days"][0]["slots"][0]["is_fixed"] is True


def test_repair_before_the_trip_day_is_unchanged() -> None:
    """여행 전 요청(모든 슬롯이 지금 뒤) — 종전 수리 그대로(p2·p3 가 HC2 만큼 밀린다)."""
    body = _repair([{"date": _DAY1.isoformat(), "slots": list(_PAST)}], "2026-08-04T00:00:00Z")
    assert _times(body)[1][1] == "10:19:00"
