"""/edit 날마다 동네 — 경계 관통 (실 LLM·네트워크 0: 무배선 LLM + StaticPoiDb 서울 좌표, spec 004).

"1일차는 종로 2일차는 강남구쪽으로 일정을 바꾸어줘"(2026-10-22 개발 서버에서 "그렇게는 바꿀 수 없어요")를 편집 에이전트 ①b 가
결정론으로 읽고, 재구성 콘센트가 그 날들을 동네 풀로 ScheduleAgent 에 다시 푼다. 무배선 LLM 앱에서 APPLIED 가 나오면 번역기를 안
거쳤다는 뜻이다(거쳤으면 TRANSLATION_FAILED·REJECTED REPLAN).
"""

from __future__ import annotations

import json
import logging
import re

from fastapi.testclient import TestClient

from tests.fakes.fake_llm import FakeLlm

from trippilot.api.wiring import StaticPoiDb, build_dev_app
from trippilot.assembly_engine.travel import haversine_km
from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource

D1, D2, D3 = "2026-10-24", "2026-10-25", "2026-10-26"  # 토·일·월
JONGNO, GANGNAM = GeoPoint(37.5703, 126.9910), GeoPoint(37.4979, 127.0276)  # 다시 짜기 동네 표(KNOWN_AREAS)와 같은 중심
_SAID = "지금 짜여진 일정 변경하고 싶은데, 1일차는 종로 2일차는 강남구쪽으로 일정을 바꾸어줘"


def _poi(n: int, name: str, cat: PoiCategory, lat: float, lng: float) -> Poi:
    return Poi(PoiId(f"00000000-0000-4000-8000-{n:012d}"), name, cat, GeoPoint(lat, lng), (), None, None,
               DataQuality.FULL, PoiSource.SEED, None)


GYEONGBOK = _poi(1, "경복궁", PoiCategory.SIGHT, 37.5796, 126.9770)            # 종로 1.6km — 동네 안 원 일정
GYEONGNI = _poi(2, "경리단길", PoiCategory.SIGHT, 37.5385, 126.9888)
YEONNAM = _poi(3, "연남동 경의선숲길", PoiCategory.NATURE, 37.5600, 126.9230)
MANGWON = _poi(4, "망원한강공원", PoiCategory.NATURE, 37.5552, 126.8950)
MUSEUM = _poi(5, "국립중앙박물관", PoiCategory.CULTURE, 37.5240, 126.9803)
HYOCHANG = _poi(6, "효창공원", PoiCategory.NATURE, 37.5446, 126.9616)
YEOUIDO = _poi(7, "여의도한강공원", PoiCategory.NATURE, 37.5284, 126.9326)       # 3일차(손 안 댐)
JONGNO_SIDE = tuple(_poi(100 + i, f"종로 명소{i}", cat, 37.5703 + dy, 126.9910 + dx) for i, (cat, dy, dx) in enumerate((
    (PoiCategory.SIGHT, 0.004, -0.006), (PoiCategory.CAFE, -0.002, 0.003), (PoiCategory.FOOD, 0.001, -0.002),
    (PoiCategory.CULTURE, 0.006, 0.004), (PoiCategory.SHOPPING, -0.004, -0.004), (PoiCategory.ART, 0.003, 0.007),
    (PoiCategory.FOOD, -0.006, 0.001), (PoiCategory.CAFE, 0.008, -0.002))))
GANGNAM_SIDE = tuple(_poi(200 + i, f"강남 명소{i}", cat, 37.4979 + dy, 127.0276 + dx) for i, (cat, dy, dx) in enumerate((
    (PoiCategory.SIGHT, 0.004, -0.006), (PoiCategory.CAFE, -0.002, 0.003), (PoiCategory.FOOD, 0.001, -0.002),
    (PoiCategory.SHOPPING, 0.006, 0.004), (PoiCategory.ART, -0.004, -0.004), (PoiCategory.ACTIVITY, 0.003, 0.007),
    (PoiCategory.FOOD, -0.006, 0.001), (PoiCategory.CAFE, 0.008, -0.002))))
SEED = (GYEONGBOK, GYEONGNI, YEONNAM, MANGWON, MUSEUM, HYOCHANG, YEOUIDO, *JONGNO_SIDE, *GANGNAM_SIDE)
_INDEX = {str(p.poi_id): p for p in SEED}


def _slot(p: Poi, start: str, end: str, *, fixed: bool = False) -> dict:
    return {"poi_id": str(p.poi_id), "start_at": start, "end_at": end, "ends_next_day": False,
            "distance_range": None, "is_fixed": fixed}


_DAY1 = [_slot(GYEONGBOK, "09:00:00", "10:30:00"), _slot(GYEONGNI, "11:30:00", "13:00:00"),
         _slot(YEONNAM, "15:00:00", "16:30:00"), _slot(MANGWON, "17:30:00", "19:00:00")]
_DAY2 = [_slot(MUSEUM, "10:00:00", "12:00:00"), _slot(HYOCHANG, "13:00:00", "14:30:00")]
_DAY3 = [_slot(YEOUIDO, "10:00:00", "12:00:00")]


def _body(*, utterance: str | None = _SAID, command: dict | None = None, day2: list | None = None,
          at: str = "2026-10-22T10:00:00+09:00", target: str = D1, transport: str = "대중교통",
          confirm: bool = True) -> dict:
    body = {
        "trip_id": "trip-day-area", "target_date": target,
        "itinerary": {"days": [{"date": D1, "slots": _DAY1}, {"date": D2, "slots": day2 or _DAY2},
                               {"date": D3, "slots": _DAY3}],
                      "day1_ready_at": None, "explanations": {}, "solve_mode": "OR_TOOLS",
                      "is_fallback": False, "freshness": None, "candidates_summary": None},
        "anchor": {"lat": 37.5636, "lng": 126.9834},  # 숙소(명동) — 기본 풀 중심
        "transport_mode": transport, "confirm": confirm,
        "request_meta": {"request_id": "day-area-1", "requested_at": at, "deadline_ms": 7_500},
    }
    if command is not None:
        body["command"] = command
    elif utterance is not None:
        body["utterance"] = utterance
    return body


def _post(body: dict, seed=SEED, llm: FakeLlm | None = None) -> dict:
    # 기본은 LLM 무배선 — 번역기를 타면 실패한다. llm 을 주면 번역기가 그 답을 낸다(종전 길 회귀)
    app = build_dev_app(poi_db=StaticPoiDb(seed), **({"llm": llm, "model_id": "m-fake"} if llm else {}))
    with TestClient(app, raise_server_exceptions=False) as client:
        res = client.post("/ai/v1/itinerary/edit", json=body)
    assert res.status_code == 200, res.text
    return res.json()


def _day(body: dict, date: str) -> list[dict]:
    """그 날 슬롯 — 응답이 덧붙이는 차선책 칸(`alternatives`)은 빼고 본다(입력과 견주려고)."""
    return [{k: v for k, v in s.items() if k != "alternatives"}
            for s in next(d["slots"] for d in body["itinerary"]["days"] if d["date"] == date)]


def _within(slots: list[dict], center: GeoPoint, km: float = 3.0) -> bool:
    return all(haversine_km(_INDEX[s["poi_id"]].coord, center) <= km for s in slots if not s["is_fixed"])


def _log(caplog) -> dict:
    (line,) = [r.getMessage() for r in caplog.records if r.getMessage().startswith("edit_day_area ")]
    return json.loads(line.removeprefix("edit_day_area "))


# ── 다시 짠다 (LLM 0회) ─────────────────────────────────────────────────


def test_rebuilds_each_day_around_its_area_without_llm(caplog) -> None:
    caplog.set_level(logging.INFO)
    body = _post(_body())
    assert body["status"] == "APPLIED", body
    day1, day2 = _day(body, D1), _day(body, D2)
    assert _within(day1, JONGNO) and _within(day2, GANGNAM)
    assert str(GYEONGBOK.poi_id) in {s["poi_id"] for s in day1}  # 동네 안 원 일정은 남는다
    assert len(day1) >= 2 and len(day2) >= 2
    assert _day(body, D3) == _DAY3  # 손 안 댄 날은 그대로
    assert body["command"]["op"] == "SET_DAY_AREAS"
    assert body["command"]["params"] == {D1: "종로", D2: "강남구"}
    # 다시 짠 날의 슬롯은 예약이 아니다 — 남긴 원 슬롯(경복궁)도. 예약으로 저장되면 다음 편집이 막힌다(2026-10-23 리뷰)
    assert not any(s["is_fixed"] for s in day1 + day2)
    assert set(body["command"]["affected_slots"]) >= {str(GYEONGNI.poi_id), str(MUSEUM.poi_id)}  # 빠진 원 슬롯
    log = _log(caplog)
    assert (log["outcome"], log["days"], log["source"]) == ("APPLIED", 2, "utterance")
    assert "종로" not in json.dumps(log, ensure_ascii=False)  # 발화·동네 이름은 로그에 싣지 않는다


def test_target_date_does_not_limit_the_days_said() -> None:
    """BE 의 targetDate 는 분류가 실은 날 하나다 — 말이 두 날을 정했으면 두 날 다(spec 004 비판 ③)."""
    body = _post(_body(target=D2))
    assert body["status"] == "APPLIED" and _within(_day(body, D1), JONGNO) and _within(_day(body, D2), GANGNAM)


def test_one_day_only() -> None:
    body = _post(_body(utterance="2일차 일정을 강남구 쪽으로 바꿔줘", target=D2))
    assert body["status"] == "APPLIED"
    assert _within(_day(body, D2), GANGNAM) and _day(body, D1) == _DAY1
    assert body["command"]["params"] == {D2: "강남구"}


def test_rebuilt_days_carry_their_distances() -> None:
    """다시 짠 날들의 구간 거리 — BE 카드 diff 가 그린다(종전엔 전부 null). 첫 슬롯(출발점 모름)과 손 안 댄 날은 null, 거리만(INV-3)."""
    body = _post(_body())
    assert body["status"] == "APPLIED", body
    for day in (D1, D2):
        first, *rest = _day(body, day)
        assert first["distance_range"] is None and rest
        assert all(re.fullmatch(r"약 \d+\.\dkm · (도보|대중교통) 추정", s["distance_range"] or "") for s in rest), rest
    assert [s["distance_range"] for s in _day(body, D3)] == [None]


def test_reservation_keeps_its_time_even_outside_the_area() -> None:
    day2 = [_slot(MUSEUM, "10:00:00", "12:00:00", fixed=True), _slot(HYOCHANG, "13:00:00", "14:30:00")]
    body = _post(_body(day2=day2))
    assert body["status"] == "APPLIED", body
    kept = [s for s in _day(body, D2) if s["poi_id"] == str(MUSEUM.poi_id)]
    assert kept and (kept[0]["start_at"], kept[0]["end_at"], kept[0]["is_fixed"]) == ("10:00:00", "12:00:00", True)
    assert [s["is_fixed"] for s in _day(body, D2) if s["poi_id"] != str(MUSEUM.poi_id)] == [False] * (len(_day(body, D2)) - 1)
    assert _within(_day(body, D2), GANGNAM)


def test_structured_command_takes_the_same_path() -> None:
    body = _post(_body(command={"op": "SET_DAY_AREAS", "params": {D1: "종로", D2: "강남"}, "affected_slots": []}))
    assert body["status"] == "APPLIED" and _within(_day(body, D1), JONGNO) and _within(_day(body, D2), GANGNAM)


def test_car_trip_rebuilds_too() -> None:
    body = _post(_body(transport="렌터카"))
    assert body["status"] == "APPLIED", body


def test_destructive_without_confirm_asks_first() -> None:
    body = _post(_body(confirm=False))
    assert body["status"] == "CONFIRM_REQUIRED"
    assert body["command"]["op"] == "SET_DAY_AREAS" and body["itinerary"] is None


# ── 여행 당일 ───────────────────────────────────────────────────────────


def test_today_keeps_what_started_and_starts_new_visits_after_now() -> None:
    body = _post(_body(utterance="오늘은 종로 쪽으로 바꿔줘", at="2026-10-24T13:10:00+09:00"))
    assert body["status"] == "APPLIED", body
    day1 = _day(body, D1)
    started = [s for s in day1 if s["poi_id"] in {str(GYEONGBOK.poi_id), str(GYEONGNI.poi_id)}]
    assert [(s["start_at"], s["end_at"]) for s in started] == [("09:00:00", "10:30:00"), ("11:30:00", "13:00:00")]
    fresh = [s for s in day1 if s not in started]
    assert fresh and all(s["start_at"] >= "13:11:00" for s in fresh)
    assert _within(fresh, JONGNO)
    assert not any(s["is_fixed"] for s in day1)  # 다녀온 곳·진행 중인 곳도 예약이 아니다


def test_past_day_is_not_changed() -> None:
    body = _post(_body(utterance="1일차는 종로로 바꿔줘", at="2026-10-25T09:00:00+09:00"))
    assert (body["status"], body["reason"]) == ("REJECTED", "day_area: past_day(1일차)")


# ── 못 하면 사유 (INV-4) ────────────────────────────────────────────────


def test_day_outside_the_trip() -> None:
    body = _post(_body(utterance="4일차는 종로 쪽으로 바꿔줘"))
    assert (body["status"], body["reason"]) == ("REJECTED", "day_area: day_out_of_trip(4일차)")


def test_unknown_and_far_areas() -> None:
    unknown = _post(_body(utterance="1일차는 화성탐사기지 쪽으로 바꿔줘"))
    assert (unknown["status"], unknown["reason"]) == ("REJECTED", "day_area: area_unknown(화성탐사기지)")
    far = _post(_body(utterance="1일차는 해운대 쪽으로 바꿔줘"))
    assert (far["status"], far["reason"]) == ("REJECTED", "day_area: area_far(해운대)")


def test_thin_area_is_said_not_widened() -> None:
    body = _post(_body(utterance="1일차는 잠실 쪽으로 바꿔줘"))  # 시드에 잠실 둘레 장소가 없다
    assert body["status"] == "REJECTED" and body["reason"].startswith("day_area: pool_thin(잠실:")


def test_other_edits_still_take_the_old_road() -> None:
    """이 꼴이 아니면 ①b 는 비켜선다 — 번역기(무배선)로 가서 종전 실패가 난다."""
    body = _post(_body(utterance="2일차는 카페 위주로 바꿔줘"))
    assert body["status"] == "TRANSLATION_FAILED"


def test_one_place_replacement_still_goes_to_the_translator() -> None:
    """'1일차 경복궁 바꿔줘'는 한 곳 바꾸기다 — ①b 가 가로채면 경복궁을 남기고 나머지를 갈아엎었다(2026-10-23 리뷰). 번역기 길 그대로."""
    target = JONGNO_SIDE[0]
    canned = json.dumps({"editCommand": {"op": "REPLACE_SLOT", "params": {"targetPoiId": str(target.poi_id)},
                                         "affectedSlots": [str(GYEONGBOK.poi_id)]}, "applyMode": "AUTO_APPLY"})
    body = _post(_body(utterance="1일차 경복궁 바꿔줘"), llm=FakeLlm(canned))
    assert body["status"] == "APPLIED" and body["command"]["op"] == "REPLACE_SLOT", body
    assert [s["poi_id"] for s in _day(body, D1)][0] == str(target.poi_id) and _day(body, D2) == _DAY2


def test_reservation_closed_that_day_is_said_not_dropped() -> None:
    """예약이 그 날 쉬는 곳이라 조립이 뺐으면 조용히 지우지 않는다(INV-4) — 사유를 단다."""
    weekday_only = _poi(9, "평일만 여는 곳", PoiCategory.CULTURE, 37.4990, 127.0290)
    closed = Poi(weekday_only.poi_id, weekday_only.name, weekday_only.category, weekday_only.coord,
                 tuple(OpenHour(d, 600, 1080) for d in range(5)), None, None, DataQuality.FULL, PoiSource.SEED, None)
    day2 = [_slot(closed, "10:00:00", "12:00:00", fixed=True), _slot(HYOCHANG, "13:00:00", "14:30:00")]  # 2일차 = 일요일
    body = _post(_body(utterance="2일차 일정을 강남 쪽으로 바꿔줘", target=D2, day2=day2), seed=(*SEED, closed))
    assert body["status"] == "REJECTED" and body["reason"].startswith("day_area: fixed_dropped(")


def _validate(body: dict) -> list:
    app = build_dev_app(poi_db=StaticPoiDb(SEED))
    with TestClient(app, raise_server_exceptions=False) as client:
        res = client.post("/ai/v1/itinerary/validate", json={
            "itinerary": body["itinerary"], "request_meta": {"request_id": "v-1", "requested_at": "2026-10-24T13:10:00+09:00"}})
    assert res.status_code == 200, res.text
    return res.json()["violations"]


def test_today_with_a_finished_reservation_still_rebuilds() -> None:
    """다녀온 예약이 있는 날 — 2차 리뷰: 검증이 예약 블록을 찾지 못해 HC3 로 늘 거절됐다. 다녀온 예약은 그 시각 그대로 예약으로 남는다."""
    day1 = [_slot(GYEONGBOK, "09:00:00", "10:30:00", fixed=True), *_DAY1[1:]]
    body = _body(utterance="오늘은 종로 쪽으로 바꿔줘", at="2026-10-24T13:10:00+09:00")
    body["itinerary"]["days"][0]["slots"] = day1
    out = _post(body)
    assert out["status"] == "APPLIED", out
    kept = next(s for s in _day(out, D1) if s["poi_id"] == str(GYEONGBOK.poi_id))
    assert (kept["start_at"], kept["end_at"], kept["is_fixed"]) == ("09:00:00", "10:30:00", True)


def test_today_first_new_visit_is_reachable_from_where_the_user_is() -> None:
    """지금 있는 곳(마지막으로 끝난 곳) → 첫 새 방문 이동을 잰다 — 2차 리뷰: 검증에서 빼서 갈 수 없는 첫 방문이 나갔다(INV-2)."""
    out = _post(_body(utterance="오늘은 종로 쪽으로 바꿔줘", at="2026-10-24T13:10:00+09:00"))
    assert out["status"] == "APPLIED", out
    assert [v for v in _validate(out) if v["code"] == "HC2"] == []


def test_today_uses_the_time_from_now_not_from_the_next_planned_slot() -> None:
    """저녁 예약 하나만 남은 날 — 지금부터 그 예약 전까지를 채운다(2차 리뷰: 다음 원 슬롯 시각부터 세어 빈 날로 거절됐다)."""
    day1 = [*_DAY1[:2], _slot(MANGWON, "17:30:00", "19:00:00", fixed=True)]
    body = _body(utterance="오늘은 종로 쪽으로 바꿔줘", at="2026-10-24T13:10:00+09:00")
    body["itinerary"]["days"][0]["slots"] = day1
    out = _post(body)
    assert out["status"] == "APPLIED", out
    fresh = [s for s in _day(out, D1) if s["poi_id"] not in {x["poi_id"] for x in day1}]
    assert fresh and all("13:11:00" <= s["start_at"] < "17:30:00" for s in fresh)


def test_a_date_check_failure_is_observed_without_names(caplog) -> None:
    caplog.set_level(logging.INFO)
    _post(_body(utterance="1일차는 종로로 바꿔줘", at="2026-10-25T09:00:00+09:00"))
    log = _log(caplog)
    assert (log["outcome"], log["reason"]) == ("REJECTED", "day_area: past_day")
