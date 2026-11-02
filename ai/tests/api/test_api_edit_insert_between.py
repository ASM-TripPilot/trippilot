"""/edit 사이 넣기 — 경계 관통 (실 LLM·네트워크 0: 무배선 LLM 또는 FakeLlm + StaticPoiDb 서울 좌표).

"이태원에서 홍대로 넘어갈 때 한 군데 더"(2026-10-20 개발 서버에서 번역 불가)를 코드가 자리·후보까지 정해 LLM 없이
제안한다. 무배선 LLM 앱에서 APPLIED 가 나오면 번역기를 안 거쳤다는 뜻이다(거쳤으면 TRANSLATION_FAILED).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from tests.fakes.fake_llm import FakeLlm
from trippilot.api.wiring import StaticPoiDb, build_dev_app
from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.travel import TravelEstimator, haversine_km
from trippilot.domain.common import GeoPoint, PoiId, TransportMode
from trippilot.domain.poi import NIGHTLIFE_TAG, DataQuality, OpenHour, Poi, PoiCategory, PoiSource

_DAY = "2026-10-21"  # 수요일(weekday 2)


def _poi(n: int, name: str, cat: PoiCategory, lat: float, lng: float, *, tags=(), hours=()) -> Poi:
    return Poi(PoiId(f"00000000-0000-4000-8000-{n:012d}"), name, cat, GeoPoint(lat, lng), tuple(hours),
               None, None, DataQuality.FULL, PoiSource.SEED, None, tags=tuple(tags))


GYEONGBOK = _poi(1, "경복궁", PoiCategory.SIGHT, 37.5796, 126.9770)
GYEONGNI = _poi(2, "경리단길", PoiCategory.SIGHT, 37.5385, 126.9888)            # 이태원 권역(이름엔 없음)
YEONNAM = _poi(3, "연남동 경의선숲길", PoiCategory.NATURE, 37.5600, 126.9230)   # 홍대 권역(이름엔 없음)
MANGWON = _poi(4, "망원한강공원", PoiCategory.NATURE, 37.5552, 126.8950)
HYOCHANG = _poi(10, "효창공원", PoiCategory.NATURE, 37.5446, 126.9616)          # 구간 위
GONGDEOK_CAFE = _poi(12, "공덕 카페", PoiCategory.CAFE, 37.5440, 126.9510)       # 구간 위 — 가장 가운데
MAPO_FOOD = _poi(13, "마포 식당", PoiCategory.FOOD, 37.5450, 126.9500)           # 구간 위, 먹는 곳
GANGNAM_CAFE = _poi(14, "강남 카페", PoiCategory.CAFE, 37.4979, 127.0276)        # 구간 밖
BAR = _poi(15, "공덕 칵테일바", PoiCategory.FOOD, 37.5448, 126.9530, tags=(NIGHTLIFE_TAG,))

DAY = (GYEONGBOK, GYEONGNI, YEONNAM, MANGWON)
SEED = (*DAY, HYOCHANG, GONGDEOK_CAFE, MAPO_FOOD, GANGNAM_CAFE, BAR)
_SAID = "이태원에서 홍대로 넘어갈 때 한 군데 더 추가했으면 좋겠어"


def _slot(p: Poi, start: str, end: str) -> dict:
    return {"poi_id": str(p.poi_id), "start_at": start, "end_at": end, "ends_next_day": False,
            "distance_range": None, "is_fixed": False}


_SLOTS = [_slot(GYEONGBOK, "09:00:00", "10:00:00"), _slot(GYEONGNI, "11:00:00", "12:30:00"),
          _slot(YEONNAM, "15:00:00", "16:30:00"), _slot(MANGWON, "17:30:00", "19:00:00")]


def _body(*, utterance: str | None = None, command: dict | None = None, day2: list | None = None,
          at: str = "2026-10-20T20:00:00+09:00", anchor=(37.5636, 126.9834), deadline_ms: int | None = None) -> dict:
    days = [{"date": _DAY, "slots": _SLOTS}]
    if day2 is not None:
        days.append({"date": "2026-10-22", "slots": day2})
    meta = {"request_id": "ins-1", "requested_at": at}
    if deadline_ms is not None:
        meta["deadline_ms"] = deadline_ms
    body = {
        "trip_id": "trip-insert", "target_date": _DAY,
        "itinerary": {"days": days, "day1_ready_at": None, "explanations": {}, "solve_mode": "OR_TOOLS",
                      "is_fallback": False, "freshness": None, "candidates_summary": None},
        "anchor": {"lat": anchor[0], "lng": anchor[1]},  # 기본: 숙소(명동) — 기본 풀 중심
        "transport_mode": "대중교통", "confirm": True, "request_meta": meta,
    }
    if utterance is not None:
        body["utterance"] = utterance
    if command is not None:
        body["command"] = command
    return body


def _post(body: dict, seed=SEED, llm: FakeLlm | None = None) -> dict:
    app = build_dev_app(poi_db=StaticPoiDb(seed), **({"llm": llm, "model_id": "m-fake"} if llm else {}))
    with TestClient(app, raise_server_exceptions=False) as client:
        res = client.post("/ai/v1/itinerary/edit", json=body)
    assert res.status_code == 200, res.text
    return res.json()


def _ids(body: dict) -> list[str]:
    return [s["poi_id"] for s in body["itinerary"]["days"][0]["slots"]]


def _insert_log(caplog) -> dict:
    (line,) = [r.getMessage() for r in caplog.records if r.getMessage().startswith("edit_insert ")]
    return json.loads(line.removeprefix("edit_insert "))


# ── 코드가 자리·후보를 정한다 (LLM 0회) ────────────────────────────────────


def test_between_inserts_on_the_way_without_llm(caplog) -> None:
    caplog.set_level(logging.INFO)
    body = _post(_body(utterance=_SAID))
    assert body["status"] == "APPLIED", body
    assert _ids(body) == [str(p.poi_id) for p in (GYEONGBOK, GYEONGNI, GONGDEOK_CAFE, YEONNAM, MANGWON)]
    slots = body["itinerary"]["days"][0]["slots"]
    assert [s["start_at"] for s in slots[:2]] == ["09:00:00", "11:00:00"]  # 앞쪽은 그대로
    assert slots[3]["start_at"] >= "15:00:00"  # 뒤는 앞당기지 않는다(keep_earlier)
    assert body["command"]["params"] == {"targetPoiId": str(GONGDEOK_CAFE.poi_id),
                                         "afterPoiId": str(GYEONGNI.poi_id), "beforePoiId": str(YEONNAM.poi_id)}
    log = _insert_log(caplog)
    assert (log["outcome"], log["shape"], log["resolved_by"], log["pool_source"], log["tried"]) == (
        "APPLIED", "BETWEEN", ["region", "region"], "segment", 1)
    assert "이태원" not in json.dumps(log, ensure_ascii=False)  # 발화·이름은 로그에 싣지 않는다


def test_kind_and_negated_kind() -> None:
    cafe = _post(_body(utterance="이태원이랑 홍대 사이에 카페 하나 넣어줘"))
    assert cafe["status"] == "APPLIED" and _ids(cafe)[2] == str(GONGDEOK_CAFE.poi_id)
    seed = (*DAY, GONGDEOK_CAFE, MAPO_FOOD)
    not_cafe = _post(_body(utterance="경리단길 들렀다가 연남동 가기 전에 카페 말고 한 군데 더 넣어줘"), seed=seed)
    assert not_cafe["status"] == "APPLIED" and _ids(not_cafe)[2] == str(MAPO_FOOD.poi_id)  # 카페 말고 = 카페 제외


def test_already_planned_elsewhere_is_not_a_candidate() -> None:
    body = _post(_body(utterance=_SAID, day2=[_slot(GONGDEOK_CAFE, "10:00:00", "11:00:00")]))
    assert body["status"] == "APPLIED" and _ids(body)[2] == str(HYOCHANG.poi_id)  # 다음 후보


def test_segment_pool_covers_what_the_base_pool_misses(caplog) -> None:
    """기본 풀 중심(부산)이 구간에서 멀어도 구간 풀이 같은 공급 경로로 채운다 — 시한이 짧으면 부르지 않는다."""
    caplog.set_level(logging.INFO)
    far = _post(_body(utterance=_SAID, anchor=(35.1577, 129.0596)))
    assert far["status"] == "APPLIED" and _ids(far)[2] == str(GONGDEOK_CAFE.poi_id)
    caplog.clear()
    short = _post(_body(utterance=_SAID, anchor=(35.1577, 129.0596), deadline_ms=1_500))
    assert short["status"] == "REJECTED" and short["reason"] == "insert_between: no_candidates"
    assert _insert_log(caplog)["pool_source"] == "base"


def test_place_from_the_segment_pool_gets_its_distance() -> None:
    """기본 풀(부산)에 없는 곳을 구간 풀에서 넣어도 거리가 실린다 — 좌표는 에이전트 ⑤ 가 본 장소(구간 풀까지)라 다시 조회하지 않는다.
    BE 카드 diff 의 ADDED 줄이 그리는 값이다. 첫 슬롯은 출발점을 몰라 null."""
    body = _post(_body(utterance=_SAID, anchor=(35.1577, 129.0596)))
    assert body["status"] == "APPLIED" and _ids(body)[2] == str(GONGDEOK_CAFE.poi_id)
    distances = [s["distance_range"] for s in body["itinerary"]["days"][0]["slots"]]
    assert distances[0] is None and all(distances[1:]), distances  # 넣은 곳과 그 다음 곳까지


# ── 실패는 사유 있는 상태값 (INV-4) ───────────────────────────────────────


def test_no_candidates_is_rejected_not_appended() -> None:
    body = _post(_body(utterance=_SAID), seed=(*DAY, GANGNAM_CAFE))
    assert body["status"] == "REJECTED" and body["reason"] == "insert_between: no_candidates"
    assert body["violations"] == []


def test_all_rejected_carries_no_violations_of_a_place_nobody_chose() -> None:
    late = (OpenHour(2, 20 * 60, 22 * 60),)  # 수요일 20:00~22:00 — 구간 시각엔 닫혀 HC1
    seed = (*DAY, _poi(20, "늦게 여는 전시", PoiCategory.CULTURE, 37.5446, 126.9616, hours=late),
            _poi(21, "늦게 여는 공원", PoiCategory.NATURE, 37.5420, 126.9650, hours=late))
    body = _post(_body(utterance=_SAID), seed=seed)
    assert body["status"] == "REJECTED" and body["violations"] == [], body
    assert body["reason"] == "insert_between: all_rejected(tried=2)"


def test_past_gap_on_the_trip_day_is_rejected() -> None:
    body = _post(_body(utterance=_SAID, at=f"{_DAY}T15:30:00+09:00"))  # 연남동(15:00)이 이미 시작했다
    assert body["status"] == "REJECTED" and body["reason"] == "insert_between: past_gap"


def test_in_transit_insert_never_starts_before_now() -> None:
    body = _post(_body(utterance=_SAID, at=f"{_DAY}T13:10:00+09:00"))  # 경리단길(12:30)을 떠나 이동 중
    assert body["status"] == "APPLIED", body
    added = body["itinerary"]["days"][0]["slots"][2]
    assert added["poi_id"] == str(GONGDEOK_CAFE.poi_id) and added["start_at"] >= "13:10:00"


def test_unresolved_falls_back_to_the_translator_with_reason() -> None:
    body = _post(_body(utterance="부산에서 홍대로 넘어갈 때 한 군데 더 넣어줘"))
    assert body["status"] == "TRANSLATION_FAILED"
    assert "insert_between: unresolved_from" in body["reason"]


def test_translator_dropping_the_position_is_not_silently_appended() -> None:
    canned = json.dumps({"editCommand": {"op": "ADD_SLOT", "params": {"targetPoiId": str(HYOCHANG.poi_id)},
                                         "affectedSlots": []}})
    body = _post(_body(utterance="남산 가기 전에 한 군데 더 넣어줘"), llm=FakeLlm(canned=canned))  # 남산 슬롯이 없다
    assert body["status"] == "TRANSLATION_FAILED" and "position_dropped (unresolved_to)" in body["reason"], body


# ── 기준점 있는 ADD — 버튼(구조화)·말(번역) 두 진입이 같은 자리에 ─────────────────


def test_anchored_add_lands_in_place_in_both_entries() -> None:
    params = {"targetPoiId": str(HYOCHANG.poi_id), "afterPoiId": str(GYEONGNI.poi_id)}
    button = _post(_body(command={"op": "ADD_SLOT", "params": params, "affected_slots": []}))
    canned = json.dumps({"editCommand": {"op": "ADD_SLOT", "params": params, "affectedSlots": []}})
    said = _post(_body(utterance="효창공원을 경리단길 끝나고 넣어줘"), llm=FakeLlm(canned=canned))  # 이름 지목 = 번역기 몫
    for res in (button, said):
        assert res["status"] == "APPLIED", res
        assert _ids(res)[1:4] == [str(GYEONGNI.poi_id), str(HYOCHANG.poi_id), str(YEONNAM.poi_id)]
    assert button["itinerary"] == said["itinerary"]


def test_anchors_of_different_gaps_are_rejected_not_appended() -> None:
    params = {"targetPoiId": str(HYOCHANG.poi_id), "afterPoiId": str(GYEONGNI.poi_id),
              "beforePoiId": str(MANGWON.poi_id)}
    body = _post(_body(command={"op": "ADD_SLOT", "params": params, "affected_slots": []}))
    assert body["status"] == "REJECTED" and "이웃이 아님" in body["reason"]


def test_named_add_without_anchor_gets_the_position_from_code() -> None:
    """번역이 "무엇"(효창공원)만 주고 기준점을 빼도 코드가 말의 자리(경리단길 끝나고)를 채운다 — 2026-10-22 실측에서 맨 끝에 붙었다."""
    canned = json.dumps({"editCommand": {"op": "ADD_SLOT", "params": {"targetPoiId": str(HYOCHANG.poi_id)},
                                         "affectedSlots": []}})
    body = _post(_body(utterance="효창공원을 경리단길 끝나고 넣어줘"), llm=FakeLlm(canned=canned))
    assert body["status"] == "APPLIED", body
    assert _ids(body)[1:4] == [str(GYEONGNI.poi_id), str(HYOCHANG.poi_id), str(YEONNAM.poi_id)]
    slots = body["itinerary"]["days"][0]["slots"]
    assert slots[3]["start_at"] >= "15:00:00"  # 기준점 있는 추가 — 뒤를 앞당기지 않는다
    unknown = _post(_body(utterance="효창공원을 남산 다음에 넣어줘"), llm=FakeLlm(canned=canned))  # 남산 슬롯이 없다
    assert unknown["status"] == "TRANSLATION_FAILED" and "position_dropped (unresolved_from)" in unknown["reason"]


# ── 2026-10-22 리뷰 확정 지적 ────────────────────────────────────────────


def test_utc_requested_at_still_floors_on_the_local_clock() -> None:
    """BE 는 requested_at 을 UTC(…Z)로 보낸다 — 하한을 그대로 쓰면 슬롯이 UTC 벽시계(04:10)로 나갔다. 분 올림은 조립 하한과 같다."""
    body = _post(_body(utterance=_SAID, at=f"{_DAY}T04:10:37.482913Z"))  # = 13:10:37 KST, 이동 중
    assert body["status"] == "APPLIED", body
    added = body["itinerary"]["days"][0]["slots"][2]
    assert added["poi_id"] == str(GONGDEOK_CAFE.poi_id) and added["start_at"] == "13:11:00"


def test_named_place_with_one_more_goes_to_the_translator_and_keeps_the_position() -> None:
    """이름 + '하나 더'를 결정론이 가로채 다른 곳을 넣었다 — 번역이 무엇(효창공원)을, 코드가 어디를 맡는다."""
    canned = json.dumps({"editCommand": {"op": "ADD_SLOT", "params": {"targetPoiId": str(HYOCHANG.poi_id)},
                                         "affectedSlots": []}})
    body = _post(_body(utterance="이태원에서 홍대로 넘어갈 때 효창공원 하나 더 넣어줘"), llm=FakeLlm(canned=canned))
    assert body["status"] == "APPLIED", body
    assert _ids(body)[1:4] == [str(GYEONGNI.poi_id), str(HYOCHANG.poi_id), str(YEONNAM.poi_id)]


def test_before_the_airport_lands_at_the_end_of_the_day() -> None:
    """'공항 가기 전에'는 종전 끝 추가가 맞던 말이다 — '못 알아들음'으로 바꾸지 않고 마지막 일정 뒤에 넣는다(LLM 0회)."""
    mangwon_cafe = _poi(30, "망원 카페", PoiCategory.CAFE, 37.5560, 126.8970)  # 마지막 일정(망원한강공원) 1km 안
    body = _post(_body(utterance="공항 가기 전에 카페 하나 넣어줘"), seed=(*SEED, mangwon_cafe))
    assert body["status"] == "APPLIED", body
    assert _ids(body) == [*(str(p.poi_id) for p in DAY), str(mangwon_cafe.poi_id)]


def test_chained_clause_does_not_guess_the_gap() -> None:
    """'경복궁 보고 나서 점심 먹고 …' — 첫 자리 말에 붙이면 점심 앞에 끼운다. 어느 틈인지 단정하지 않는다."""
    canned = json.dumps({"editCommand": {"op": "ADD_SLOT", "params": {"targetPoiId": str(GONGDEOK_CAFE.poi_id)},
                                         "affectedSlots": []}})
    body = _post(_body(utterance="경복궁 보고 나서 점심 먹고 카페 하나 넣어줘"), llm=FakeLlm(canned=canned))
    assert body["status"] == "TRANSLATION_FAILED" and "ambiguous_clause" in body["reason"], body


def test_car_trip_insert_is_validated_with_the_car() -> None:
    """재타이밍은 자차, 검증 문제는 대중교통이라 자차 여행의 사이 넣기가 늘 HC2 로 떨어졌다 — 검증 수단을 요청 수단에 맞춘다."""
    body = _post({**_body(utterance=_SAID), "transport_mode": "자가용"})
    assert body["status"] == "APPLIED", body


def test_translator_anchored_add_gets_the_same_trip_day_rules() -> None:
    """번역이 기준점을 채워 온 추가도 지난 자리 거부·지금 이후 시작을 탄다(`_apply` 한 곳)."""
    canned = json.dumps({"editCommand": {"op": "ADD_SLOT", "params": {
        "targetPoiId": str(HYOCHANG.poi_id), "afterPoiId": str(GYEONGNI.poi_id)}, "affectedSlots": []}})
    past = _post(_body(utterance="효창공원을 경리단길 끝나고 넣어줘", at=f"{_DAY}T15:30:00+09:00"), llm=FakeLlm(canned=canned))
    assert past["status"] == "REJECTED" and "past_gap" in past["reason"], past
    transit = _post(_body(utterance="효창공원을 경리단길 끝나고 넣어줘", at=f"{_DAY}T13:40:00+09:00"),
                    llm=FakeLlm(canned=canned))
    assert transit["status"] == "APPLIED" and transit["itinerary"]["days"][0]["slots"][2]["start_at"] >= "13:40:00"


class _RecordingPoiDb(StaticPoiDb):
    """반경 조회 인자를 적는다 — 구간 풀이 실제로 구간 원으로 모였는지, 비면 기본 풀로 돌아가는지 본다."""

    def __init__(self, seed: tuple[Poi, ...], *, empty_after: int | None = None) -> None:
        super().__init__(seed)
        self.calls: list[tuple[GeoPoint, float]] = []
        self._empty_after = empty_after

    def find_by_radius(self, center: GeoPoint, radius_km: float) -> tuple[Poi, ...]:
        self.calls.append((center, radius_km))
        if self._empty_after is not None and len(self.calls) > self._empty_after:
            return ()  # 두 번째 조회가 일시 실패해 빈 풀로 흡수된 경우
        return super().find_by_radius(center, radius_km)


def _post_db(body: dict, db: StaticPoiDb) -> dict:
    with TestClient(build_dev_app(poi_db=db), raise_server_exceptions=False) as client:
        res = client.post("/ai/v1/itinerary/edit", json=body)
    assert res.status_code == 200, res.text
    return res.json()


def test_segment_pool_is_fetched_on_the_detour_circle_and_an_empty_one_falls_back() -> None:
    db = _RecordingPoiDb(SEED)
    assert _post_db(_body(utterance=_SAID), db)["status"] == "APPLIED"
    (_, base_km), (center, km) = db.calls
    d = haversine_km(GYEONGNI.coord, YEONNAM.coord)
    assert abs(km - (d + 2.0) / 2) < 1e-6 and km < base_km  # 대중교통 우회 2km 타원을 덮는 원 — 기본 풀(10km)보다 좁다
    assert haversine_km(center, GeoPoint((GYEONGNI.coord.lat + YEONNAM.coord.lat) / 2,
                                         (GYEONGNI.coord.lng + YEONNAM.coord.lng) / 2)) < 1e-6
    flaky = _RecordingPoiDb(SEED, empty_after=1)
    body = _post_db(_body(utterance=_SAID), flaky)
    assert body["status"] == "APPLIED" and _ids(body)[2] == str(GONGDEOK_CAFE.poi_id)  # 기본 풀로 계속한다


def test_inserted_stay_is_capped_at_an_hour() -> None:
    long_day = [_slot(GYEONGBOK, "09:00:00", "11:00:00"), _slot(GYEONGNI, "11:30:00", "13:30:00"),
                _slot(YEONNAM, "17:00:00", "19:00:00"), _slot(MANGWON, "19:30:00", "21:30:00")]  # 체류 120분
    body = _post({**_body(utterance=_SAID), "itinerary": {**_body()["itinerary"], "days": [{"date": _DAY, "slots": long_day}]}})
    assert body["status"] == "APPLIED", body
    added = body["itinerary"]["days"][0]["slots"][2]
    start, end = (int(added[k][:2]) * 60 + int(added[k][3:5]) for k in ("start_at", "end_at"))
    assert end - start == 60


def test_one_sided_gaps_at_the_ends_of_the_day() -> None:
    """마지막 일정 뒤·첫 일정 앞 — 한쪽 끝만 있는 틈도 사유 없는 예외 없이 그 자리에 넣는다."""
    mangwon_cafe = _poi(30, "망원 카페", PoiCategory.CAFE, 37.5560, 126.8970)
    after_last = _post(_body(utterance="망원한강공원 다음에 갈 만한 곳 하나 추가해줘"), seed=(*SEED, mangwon_cafe))
    assert after_last["status"] == "APPLIED" and _ids(after_last)[-1] == str(mangwon_cafe.poi_id)
    samcheong = _poi(31, "삼청 갤러리", PoiCategory.ART, 37.5830, 126.9810)  # 경복궁 0.5km
    before_first = _post(_body(utterance="경복궁 가기 전에 한 군데 더 넣어줘"), seed=(*SEED, samcheong))
    assert before_first["status"] == "APPLIED" and _ids(before_first)[:2] == [str(samcheong.poi_id), str(GYEONGBOK.poi_id)]


def test_named_add_on_the_trip_day_gets_the_same_rules_when_code_fills_the_position() -> None:
    canned = json.dumps({"editCommand": {"op": "ADD_SLOT", "params": {"targetPoiId": str(HYOCHANG.poi_id)},
                                         "affectedSlots": []}})
    past = _post(_body(utterance="효창공원을 경리단길 끝나고 넣어줘", at=f"{_DAY}T15:30:00+09:00"), llm=FakeLlm(canned=canned))
    assert past["status"] == "REJECTED" and "past_gap" in past["reason"], past
    transit = _post(_body(utterance="효창공원을 경리단길 끝나고 넣어줘", at=f"{_DAY}T13:10:00+09:00"),
                    llm=FakeLlm(canned=canned))
    assert transit["status"] == "APPLIED" and transit["itinerary"]["days"][0]["slots"][2]["start_at"] >= "13:10:00"


def test_car_trip_remove_is_validated_with_the_car_too() -> None:
    """검증 수단 맞춤은 편집 전반의 결함이었다 — 자차 여행의 빼기도 대중교통 HC2 로 떨어졌다(develop 재현)."""
    command = {"op": "REMOVE_SLOT", "params": {}, "affected_slots": [str(YEONNAM.poi_id)]}
    body = _post({**_body(command=command), "transport_mode": "자가용"})
    assert body["status"] == "APPLIED", body


# ── 2026-10-22 2차 리뷰 확정 지적 ────────────────────────────────────────


def test_other_days_are_not_revalidated_by_this_edit() -> None:
    """검증은 고친 날만 — 생성이 다른 추정기로 잡은 다른 날을 기본 추정기로 다시 재면 모든 편집이 막혔다(develop 부터)."""
    tight = [_slot(GYEONGBOK, "09:00:00", "10:00:00"),  # 7km 를 5분 — 기본 추정기로는 HC2
             {**_slot(MANGWON, "10:05:00", "11:00:00"), "is_fixed": True}]  # 다른 날의 예약 — 고친 날만 볼 때 HC3 도 그 날만
    body = _post(_body(utterance=_SAID, day2=tight))
    assert body["status"] == "APPLIED", body


def test_unreadable_position_with_a_cue_is_not_appended() -> None:
    """자리 단서는 있는데 못 읽었다 — 번역의 기준점 없는 추가를 맨 끝에 붙이면 '반영됨' 위장이다."""
    canned = json.dumps({"editCommand": {"op": "ADD_SLOT", "params": {"targetPoiId": str(HYOCHANG.poi_id)},
                                         "affectedSlots": []}})
    body = _post(_body(utterance="효창공원 경리단길 다음 순서로 넣어줘"), llm=FakeLlm(canned=canned))
    assert body["status"] == "TRANSLATION_FAILED" and "position_unread" in body["reason"], body


def test_neighbourhood_station_resolves_to_its_neighbourhood() -> None:
    body = _post(_body(utterance="홍대입구역 가기 전에 카페 하나 넣어줘"))
    assert body["status"] == "APPLIED" and _ids(body)[2] == str(GONGDEOK_CAFE.poi_id), body


# ── 여행 당일 편집 — 지난 곳은 그 시각 그대로 ─────────────────────────────


def test_trip_day_button_edits_keep_visited_slots_and_flow_the_rest_from_now() -> None:
    """앱 교체 버튼(REPLACE)·빼기·끝 추가가 하루를 첫 슬롯부터 다시 흘려 다녀온 곳의 시각까지 바꿨다(develop 부터). BE 의 UTC(…Z) 지금을
    현지 분 올림으로 — 그 전에 시작한 곳은 그대로, 뒤만 지금부터 다시 흘린다. 지난 예약(경복궁)도 ⑤ 검증(HC3)을 막지 않는다."""
    visited = [{**_SLOTS[0], "is_fixed": True}, _SLOTS[1]]  # 09:00 예약 · 11:00~12:30 — 13:10 엔 둘 다 끝났다
    for command in ({"op": "REPLACE_SLOT", "params": {"targetPoiId": str(HYOCHANG.poi_id)},
                     "affected_slots": [str(YEONNAM.poi_id)]},
                    {"op": "REMOVE_SLOT", "params": {}, "affected_slots": [str(YEONNAM.poi_id)]},
                    {"op": "ADD_SLOT", "params": {"targetPoiId": str(HYOCHANG.poi_id)}, "affected_slots": []}):
        body = _body(command=command, at=f"{_DAY}T04:10:37Z")  # = 13:10:37 KST
        body = _post({**body, "itinerary": {**body["itinerary"], "days": [{"date": _DAY, "slots": [*visited, *_SLOTS[2:]]}]}})
        assert body["status"] == "APPLIED", (command["op"], body)
        slots = body["itinerary"]["days"][0]["slots"]
        assert [(s["poi_id"], s["start_at"], s["end_at"], s["is_fixed"]) for s in slots[:2]] == [
            (s["poi_id"], s["start_at"], s["end_at"], s["is_fixed"]) for s in visited], command["op"]
        assert all(s["start_at"] >= "13:11:00" for s in slots[2:]), (command["op"], slots)


def test_trip_day_leaving_where_you_are_counts_the_trip_from_there() -> None:
    """지금 있는 곳(경리단길 11:00~12:30, 지금 11:30)을 바꾸거나 빼면 다음 곳은 거기서 지금 떠나 닿는 시각부터다. 그 앞 닻(경복궁)에서
    커서를 흘리면 효창공원·연남동이 지금 바로(11:30) 시작한다 — 경리단길에서 이동 30·52분 거리다(2026-10-30 리뷰 재현)."""
    est = TravelEstimator(AssemblyConfig())
    for command, first in (({"op": "REPLACE_SLOT", "params": {"targetPoiId": str(HYOCHANG.poi_id)},
                             "affected_slots": [str(GYEONGNI.poi_id)]}, HYOCHANG),
                           ({"op": "REMOVE_SLOT", "params": {}, "affected_slots": [str(GYEONGNI.poi_id)]}, YEONNAM)):
        body = _post(_body(command=command, at=f"{_DAY}T02:30:00Z"))  # = 11:30 KST
        assert body["status"] == "APPLIED", (command["op"], body)
        slots = body["itinerary"]["days"][0]["slots"]
        arrive = datetime(2026, 10, 21, 11, 30) + timedelta(
            minutes=est.estimate(GYEONGNI.coord, first.coord, TransportMode.PUBLIC).internal_minutes)
        assert (slots[0]["start_at"], slots[1]["poi_id"]) == ("09:00:00", str(first.poi_id)), (command["op"], slots)
        assert slots[1]["start_at"] == f"{arrive:%H:%M:%S}", (command["op"], slots)
