"""/edit·/validate·/repair 의 여행 컨텍스트 — 취향·날마다 창·여행 첫날(편집 요청 칸)과 액티비티 취향 도보 상한. 실 LLM·네트워크 0.

증명하는 것:
  ① /edit 이 세 칸(`preference_profile`·`time_windows`·`trip_start_date`)을 받는다 — 종전엔 모르는 칸이라 422 였다
  ② 사이 넣기는 같은 길 모양이면 취향 카테고리를 먼저 고른다 — 규칙이다(무배선 LLM 앱에서 APPLIED)
  ③ 날 재구성은 취향을 규칙 점수로만 쓴다 — 점수 LLM 을 부르지 않고(강등 0), 취향 카테고리가 하루에 더 들어간다
  ④ 'N일차'는 여행 첫날부터 센다(대화와 같은 셈) — 일정이 여행 둘째 날부터 있어도
  ⑤ 빈 날에 넣는 첫 곳은 그 날 창의 시작에 둔다(창이 없으면 종전 10:00)
  ⑥ 액티비티 취향 대중교통 여행은 편집 재타이밍·⑤·validate·repair 가 생성과 같은 1.0km 걷기로 잰다. 자차는 그대로다
"""

from __future__ import annotations

import logging

from fastapi.testclient import TestClient

from tests.api import test_api_edit_day_area as area
from tests.api import test_api_edit_insert_between as ins
from trippilot.api.wiring import StaticPoiDb, build_dev_app
from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.poi.poi import DataQuality, Poi, PoiCategory, PoiSource

_ACTIVE = {"activities": ["테마파크"]}  # 생성 `_wanted_categories` → ACTIVITY → 도보 상한 1.0km
_DAY = "2026-10-21"
_ROAD = 1.3  # 우회계수 — 직선 × 1.3 = 화면·추정의 도로 km


def _north(n: int, road_km: float, cat: PoiCategory = PoiCategory.SIGHT) -> Poi:
    """같은 경선 위 북쪽으로 도로 `road_km` 떨어진 곳(영업시간 정보 없음 — HC1 은 보지 않는다)."""
    return Poi(PoiId(f"00000000-0000-4000-8000-{n:012d}"), f"곳{n}", cat,
               GeoPoint(37.55 + road_km / _ROAD / 111.195, 126.98), (), None, None, DataQuality.FULL, PoiSource.SEED, None)


A, X, B, NEW = _north(1, 0.0), _north(2, 3.0), _north(3, 0.75), _north(4, 0.4)
_SEED = (A, X, B, NEW)


def _slot(p: Poi, start: str, end: str) -> dict:
    return {"poi_id": str(p.poi_id), "start_at": start, "end_at": end, "ends_next_day": False,
            "distance_range": None, "is_fixed": False}


def _itinerary(*days: tuple[str, list]) -> dict:
    return {"days": [{"date": d, "slots": s} for d, s in days], "day1_ready_at": None, "explanations": {},
            "solve_mode": "OR_TOOLS", "is_fallback": False, "freshness": None, "candidates_summary": None}


def _meta(rid: str = "ctx-1") -> dict:
    return {"request_id": rid, "requested_at": "2026-10-20T20:00:00+09:00"}


def _edit(command: dict, *, transport: str = "대중교통", target: str = _DAY, days=None, **extra) -> dict:
    body = {"trip_id": "trip-ctx", "target_date": target,
            "itinerary": _itinerary(*(days or ((_DAY, [_slot(A, "10:00:00", "11:00:00"), _slot(X, "12:00:00", "13:00:00"),
                                                       _slot(B, "14:00:00", "15:00:00")]),))),
            "anchor": {"lat": A.coord.lat, "lng": A.coord.lng}, "transport_mode": transport, "confirm": True,
            "command": command, "request_meta": _meta()}
    return {**body, **extra}


def _post(path: str, body: dict, seed=_SEED) -> dict:
    with TestClient(build_dev_app(poi_db=StaticPoiDb(seed)), raise_server_exceptions=False) as client:
        res = client.post(path, json=body)
    assert res.status_code == 200, res.text
    return res.json()


def _slots(body: dict, key: str = "itinerary", date: str = _DAY) -> list[dict]:
    return next(d["slots"] for d in body[key]["days"] if d["date"] == date)


_REMOVE_X = {"op": "REMOVE_SLOT", "params": {}, "affected_slots": [str(X.poi_id)]}


# ── ① 칸을 받는다 ────────────────────────────────────────────────────────


def test_edit_accepts_the_trip_context_fields() -> None:
    body = _post("/ai/v1/itinerary/edit", _edit(
        _REMOVE_X, preference_profile={"styles": ["자연"]}, trip_start_date="2026-10-20",
        time_windows=[{"date": _DAY, "start": "09:00:00", "end": "21:00:00"}]))
    assert body["status"] == "APPLIED", body


# ── ⑥ 액티비티 취향 — 생성과 같은 1.0km 걷기 ─────────────────────────────


def test_activity_trip_retimes_a_short_leg_as_a_walk() -> None:
    """A→B 도로 0.75km — 기본(700m)은 대중교통 18분, 액티비티 취향은 걷기 16분(생성이 잡은 것과 같다). 이름표도 '도보'다."""
    plain = _slots(_post("/ai/v1/itinerary/edit", _edit(_REMOVE_X)))
    active = _slots(_post("/ai/v1/itinerary/edit", _edit(_REMOVE_X, preference_profile=_ACTIVE)))
    assert [s["start_at"] for s in plain] == ["10:00:00", "11:18:00"]
    assert [s["start_at"] for s in active] == ["10:00:00", "11:16:00"]
    assert plain[1]["distance_range"].endswith("· 대중교통 추정")
    assert active[1]["distance_range"].endswith("· 도보 추정")  # 시각과 이름표가 같은 추정기다


def test_car_trip_keeps_its_estimate_even_with_an_activity_taste() -> None:
    """자차는 계획 없는 자차 추정 그대로(운전 17분) — 상한을 올리면 걷기(16분)로 다시 잡는다. 생성의 주차 계획보다 더 걷게 하지 않는다."""
    plain = _slots(_post("/ai/v1/itinerary/edit", _edit(_REMOVE_X, transport="렌터카")))
    active = _slots(_post("/ai/v1/itinerary/edit", _edit(_REMOVE_X, transport="렌터카", preference_profile=_ACTIVE)))
    assert [s["start_at"] for s in plain] == [s["start_at"] for s in active] == ["10:00:00", "11:17:00"]


def _gap16() -> dict:
    """A→B 0.75km 를 걷기 16분에 맞춘 하루 — 생성이 액티비티 취향으로 잡는 간격이다."""
    return _itinerary((_DAY, [_slot(A, "10:00:00", "11:00:00"), _slot(B, "11:16:00", "12:00:00")]))


def test_validate_measures_a_walked_leg_with_the_trip_taste() -> None:
    def codes(**extra) -> list[str]:
        return [v["code"] for v in _post("/ai/v1/itinerary/validate", {
            "itinerary": _gap16(), "request_meta": _meta("v-ctx"), **extra})["violations"]]

    assert codes() == ["HC2"]  # 종전 — 대중교통 18분으로 재 '맞지 않는 곳'
    assert codes(preference_profile=_ACTIVE) == []
    assert codes(preference_profile={"activities": ["역사문화"]}) == ["HC2"]  # 액티비티가 아닌 취향은 종전 그대로
    assert codes(preference_profile=_ACTIVE, transport_modes=["렌터카"]) == ["HC2"]  # 자차는 상한을 걸지 않는다(운전 17분)


def test_repair_does_not_push_a_walked_leg_to_transit_time() -> None:
    def repaired(**extra) -> tuple[list[str], list]:
        body = _post("/ai/v1/itinerary/repair", {"itinerary": _gap16(), "violations": [], "request_meta": _meta("r-ctx"),
                                                 **extra})
        return [s["start_at"] for s in _slots(body, "repaired")], body["changes"]

    starts, changes = repaired()
    assert starts == ["10:00:00", "11:18:00"] and changes  # 종전 — 걸어서 잡은 간격을 대중교통 시간만큼 민다
    assert repaired(preference_profile=_ACTIVE) == (["10:00:00", "11:16:00"], [])


# ── ⑤ 빈 날의 시작 = 그 날 창의 시작 ──────────────────────────────────────


def test_first_place_on_an_empty_day_starts_at_that_days_window() -> None:
    add = {"op": "ADD_SLOT", "params": {"targetPoiId": str(NEW.poi_id)}, "affected_slots": []}
    days = ((_DAY, [_slot(A, "10:00:00", "11:00:00")]), ("2026-10-22", []))
    plain = _post("/ai/v1/itinerary/edit", _edit(add, target="2026-10-22", days=days))
    late = _post("/ai/v1/itinerary/edit", _edit(add, target="2026-10-22", days=days, time_windows=[
        {"date": "2026-10-22", "start": "15:00:00", "end": "21:00:00"}]))
    assert [s["start_at"] for s in _slots(plain, date="2026-10-22")] == ["10:00:00"]  # 종전 기본값
    assert [s["start_at"] for s in _slots(late, date="2026-10-22")] == ["15:00:00"]  # 첫날 15시 도착이면 15시부터


# ── ② 사이 넣기 순위 — 취향 카테고리 먼저 ─────────────────────────────────


def test_between_insert_prefers_the_trip_taste() -> None:
    """같은 구간에 공덕 카페(가장 가운데)와 효창공원(자연)이 있다 — 자연 취향이면 효창공원이다. 무배선 LLM — 번역기를 안 거친다."""
    plain = ins._post(ins._body(utterance=ins._SAID))
    liked = ins._post({**ins._body(utterance=ins._SAID), "preference_profile": {"activities": ["자연"]}})
    assert plain["status"] == liked["status"] == "APPLIED", (plain, liked)
    assert ins._ids(plain)[2] == str(ins.GONGDEOK_CAFE.poi_id)
    assert ins._ids(liked)[2] == str(ins.HYOCHANG.poi_id)


def test_said_kind_beats_the_taste() -> None:
    """'카페 하나'라고 했으면 자연 취향이어도 카페다 — 말한 것이 취향을 이긴다."""
    body = ins._post({**ins._body(utterance="이태원이랑 홍대 사이에 카페 하나 넣어줘"),
                      "preference_profile": {"activities": ["자연"]}})
    assert body["status"] == "APPLIED" and ins._ids(body)[2] == str(ins.GONGDEOK_CAFE.poi_id)


# ── ③ 날 재구성 — 취향은 규칙 점수로만 ────────────────────────────────────


def _rebuild_log(caplog) -> dict:
    return area._log(caplog)


def test_day_area_rebuild_scores_the_taste_by_rule_without_llm(caplog) -> None:
    caplog.set_level(logging.INFO)
    plain = area._post(area._body())
    plain_log = _rebuild_log(caplog)
    caplog.clear()
    cafe = area._post({**area._body(), "preference_profile": {"activities": ["카페"]}})
    cafe_log = _rebuild_log(caplog)
    assert plain["status"] == cafe["status"] == "APPLIED", (plain, cafe)
    assert "degraded:1" in plain_log["notes"]  # 종전 — 취향이 없어 persona_unavailable 강등
    assert "degraded:0" in cafe_log["notes"]  # 취향이 실렸고 LLM 을 부르지 않았다(무배선 LLM — 불렀으면 c1_fallback 강등)

    def cafes(body: dict) -> int:
        return sum(area._INDEX[s["poi_id"]].category is PoiCategory.CAFE
                   for d in (area.D1, area.D2) for s in area._day(body, d))

    assert cafes(cafe) > cafes(plain)


def test_activity_taste_rebuild_passes_its_own_walking_legs() -> None:
    """액티비티 취향의 날 재구성은 1.0km 까지 걸어서 푼다 — ⑤ 가 풀이와 같은 추정기로 재야 APPLIED 다.

    공용 추정기(700m)로 다시 재면 그 걷기 구간(0.7~0.75km, 간격 15~16분)이 HC2 다 — ⑤ 가 공용이었다면 이 편집은 REJECTED 였다.
    BE [적용] 재검증도 같은 취향을 실어야 같은 판정이 난다(validate `preference_profile`)."""
    body = area._post({**area._body(), "preference_profile": _ACTIVE})
    assert body["status"] == "APPLIED", body

    def hc2(**extra) -> list:
        res = _post("/ai/v1/itinerary/validate", {"itinerary": body["itinerary"], "request_meta": _meta("v-area"), **extra},
                    seed=area.SEED)
        return [v for v in res["violations"] if v["code"] == "HC2"]

    assert hc2()  # 공용 700m 로 재면 걷기 구간이 '맞지 않는 곳' — 이 재구성이 700m 를 넘게 걸었다는 뜻이다
    assert hc2(preference_profile=_ACTIVE) == []


# ── ④ 'N일차' = 여행 첫날 + N − 1 ────────────────────────────────────────


def test_nth_day_counts_from_the_trip_start() -> None:
    """여행은 10-23 부터인데 일정은 10-24 부터다 — '2일차'는 10-24(대화와 같은 셈). 종전엔 받은 일정의 첫 날부터 세 10-25 였다."""
    said = "2일차 일정을 강남구 쪽으로 바꿔줘"
    plain = area._post(area._body(utterance=said))
    counted = area._post({**area._body(utterance=said), "trip_start_date": "2026-10-23"})
    assert plain["command"]["params"] == {area.D2: "강남구"}
    assert counted["status"] == "APPLIED" and counted["command"]["params"] == {area.D1: "강남구"}, counted
    first = area._post({**area._body(utterance="1일차는 종로 쪽으로 바꿔줘"), "trip_start_date": "2026-10-23"})
    assert (first["status"], first["reason"]) == ("REJECTED", "day_area: day_out_of_trip(1일차)")  # 일정 없는 날은 고치지 않는다
