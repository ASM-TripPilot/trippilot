"""/edit 사이 넣기 — 경계 관통 (실 LLM·네트워크 0: 무배선 LLM 또는 FakeLlm + StaticPoiDb 서울 좌표).

"이태원에서 홍대로 넘어갈 때 한 군데 더"(2026-10-20 개발 서버에서 번역 불가)를 코드가 자리·후보까지 정해 LLM 없이
제안한다. 무배선 LLM 앱에서 APPLIED 가 나오면 번역기를 안 거쳤다는 뜻이다(거쳤으면 TRANSLATION_FAILED).
"""

from __future__ import annotations

import json
import logging

from fastapi.testclient import TestClient

from tests.fakes.fake_llm import FakeLlm
from trippilot.api.wiring import StaticPoiDb, build_dev_app
from trippilot.domain.common import GeoPoint, PoiId
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
