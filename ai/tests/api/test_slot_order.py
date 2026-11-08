"""시각이 거꾸로 든 날 — 화면 순서(배열)에서 위 카드보다 일찍 시작하는 카드가 있는 날.

편집은 '순서 = 배열'이라(BE INV-U3-02) 이런 날이 저장될 수 있다 — 고정·방문 완료 카드를 사이에 둔
끌어 옮기기, 시각을 골라 넣은 추가(끝이든 카드 사이든). 종전에는 도메인 불변식(`DaySolution` 시간순)이
422 로 새어 나가 BE 가 판정 보류로 저장했고, 위반 배지가 뜨지 않았다(운영 여행 3개, 2026-11-03~08).

경계별 정책을 잠근다:
  ① validate — 200 + 위반 `SLOT_ORDER`(위치는 받은 배열의 그 칸), 나머지 HC 는 시각 순으로 판정.
     배지는 이른 카드에 달되, 그 카드가 고정이고 그 위의 늦은 카드가 모두 고정이 아니면 늦은 카드들에 단다
  ② repair — 200 + `repaired=null`(수리 불가, IO-7). 고정이 아닌 이른 카드도 뒤로 밀어 맞추지 않는다
  ③ explanations — 받는다(설명은 날짜#장소 키라 순서와 무관)
  ④ edit — 여전히 422. 위치 지시('두 번째 장소')를 화면 순서로 해석하는 경계라 세우면 다른 칸을 고친다
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from trippilot.api.wiring import DEMO_ANCHOR, build_dev_app, demo_poi_seed

_SEED = {p.name: str(p.poi_id) for p in demo_poi_seed()}
_PORK = _SEED["제주 흑돼지거리"]
_HALLASAN = _SEED["한라산"]
_WOLJEONG = _SEED["월정리 카페거리"]
_UNKNOWN = "99999999-9999-4999-8999-999999999999"  # 장소 정본에 없는 id
_DAY = "2026-09-01"
_DAY2 = "2026-09-02"


def _slot(poi_id: str | None, start: str | None, end: str | None, *, fixed: bool = False) -> dict:
    return {"poi_id": poi_id, "start_at": start, "end_at": end,
            "ends_next_day": False, "distance_range": None, "is_fixed": fixed}


def _itinerary(*days: tuple[str, list[dict]]) -> dict:
    return {"days": [{"date": d, "slots": s} for d, s in days],
            "day1_ready_at": None, "explanations": {},
            "solve_mode": "OR_TOOLS", "is_fallback": False,
            "freshness": None, "candidates_summary": None}


def _meta() -> dict:
    return {"request_id": "slot-order", "requested_at": f"{_DAY}T07:00:00+09:00",
            "deadline_ms": 20000}


# 끌어 옮기기 재현 — 12시 카드를 고정 10시 30분 카드 위로 끌었다(앱 함정 문서의 [09, 12, 고정 10] 꼴)
_DRAGGED = [_slot(_PORK, "09:00:00", "10:00:00"),
            _slot(_HALLASAN, "12:00:00", "13:00:00"),
            _slot(_WOLJEONG, "10:30:00", "11:00:00", fixed=True)]
# 시각을 골라 끝에 넣은 추가 — 새 카드는 고정이 아니다(앱 bulkAdd)
_ADDED_LAST = [_slot(_PORK, "09:00:00", "10:00:00"),
               _slot(_HALLASAN, "12:00:00", "13:00:00"),
               _slot(_WOLJEONG, "10:00:00", "11:00:00")]


def _client() -> TestClient:
    return TestClient(build_dev_app(), raise_server_exceptions=False)


def _validate(*days: tuple[str, list[dict]]) -> dict:
    with _client() as client:
        response = client.post("/ai/v1/itinerary/validate", json={
            "itinerary": _itinerary(*days), "request_meta": _meta()})
    assert response.status_code == 200, response.text
    return response.json()


def _order(body: dict) -> list[tuple[int | None, int | None, str]]:
    return [(v["day_index"], v["slot_index"], v["slot_ref"])
            for v in body["violations"] if v["code"] == "SLOT_ORDER"]


def _details(body: dict) -> list[str]:
    return [v["detail"] for v in body["violations"] if v["code"] == "SLOT_ORDER"]


def _repair(*days: tuple[str, list[dict]]) -> dict:
    with _client() as client:
        response = client.post("/ai/v1/itinerary/repair", json={
            "itinerary": _itinerary(*days), "request_meta": _meta()})
    assert response.status_code == 200, response.text
    return response.json()


# ── ① validate ─────────────────────────────────────────────────────────────

def test_validate_flags_the_card_earlier_than_one_above_it() -> None:
    body = _validate((_DAY, _ADDED_LAST))
    assert _order(body) == [(0, 2, _WOLJEONG)]
    assert _details(body) == ["10:00 시작이 위 일정 12:00 보다 이르다"]  # 시각만, 소요시간 없음(INV-3)
    flagged = next(v for v in body["violations"] if v["code"] == "SLOT_ORDER")
    assert flagged["reason_code"] is None  # HC1 하위 코드가 아니다 — 장소 감지가 알림으로 읽지 않는다
    # 나머지 판정은 그대로 돈다 — 시각 순(흑돼지 → 월정리 → 한라산)으로 본 이동이 빠듯하다. 이동 위반은 시각상 다음 장소에
    # 붙는다(월정리·한라산) — 화면의 바로 위 카드 기준이 아니며, 순서를 고친 뒤의 판정과 같다
    assert sorted(v["slot_index"] for v in body["violations"] if v["code"] == "HC2") == [1, 2], body["violations"]


def test_validate_flags_the_dragged_card_not_the_fixed_one_below_it() -> None:
    """고정 카드는 못 옮긴다 — 그 위로 끌려 온 늦은 카드에 단다(고정에 달면 다시 짜기가 표시를 물려받는다)."""
    body = _validate((_DAY, _DRAGGED))
    assert _order(body) == [(0, 1, _HALLASAN)]
    assert _details(body) == ["12:00 시작이 아래 고정 일정 10:30 보다 늦다"]


def test_validate_flags_the_fixed_card_when_the_later_one_above_is_fixed_too() -> None:
    """위의 늦은 카드에 고정이 있으면 옮겨서 풀 수 없다 — 이른 고정 카드에 단다(표시를 빼먹지 않는다)."""
    both_fixed = _validate((_DAY, [_slot(_HALLASAN, "12:00:00", "13:00:00", fixed=True),
                                   _slot(_WOLJEONG, "10:30:00", "11:00:00", fixed=True)]))
    assert _order(both_fixed) == [(0, 1, _WOLJEONG)]
    mixed = _validate((_DAY, [_slot(_HALLASAN, "12:00:00", "13:00:00", fixed=True),
                              _slot(_PORK, "13:00:00", "14:00:00"),
                              _slot(_WOLJEONG, "10:30:00", "11:00:00", fixed=True)]))
    assert _order(mixed) == [(0, 2, _WOLJEONG)]


def test_validate_flags_every_card_below_a_later_one_not_just_neighbours() -> None:
    """13시 아래 9시·10시 — 둘 다 위의 13시보다 이르다(바로 위만 보면 10시를 놓친다)."""
    body = _validate((_DAY, [_slot(_HALLASAN, "13:00:00", "14:00:00"),
                             _slot(_PORK, "09:00:00", "10:00:00"),
                             _slot(_WOLJEONG, "10:00:00", "11:00:00")]))
    assert _order(body) == [(0, 1, _PORK), (0, 2, _WOLJEONG)]


def test_validate_places_the_badge_on_the_repeated_place_that_is_out_of_order() -> None:
    """같은 장소가 두 번 들어도 첫 일치가 아니라 그 칸이다 — 같은 날·다른 날 둘 다."""
    same_day = _validate((_DAY, [_slot(_PORK, "09:00:00", "10:00:00"),
                                 _slot(_HALLASAN, "13:00:00", "14:00:00"),
                                 _slot(_PORK, "10:00:00", "11:00:00")]))
    assert _order(same_day) == [(0, 2, _PORK)]
    other_day = _validate((_DAY, [_slot(_PORK, "12:00:00", "13:00:00")]),
                          (_DAY2, [_slot(_HALLASAN, "13:00:00", "14:00:00"),
                                   _slot(_PORK, "10:00:00", "11:00:00")]))
    assert _order(other_day) == [(1, 1, _PORK)]


def test_validate_equal_starts_are_not_out_of_order() -> None:
    body = _validate((_DAY, [_slot(_PORK, "10:00:00", "11:00:00"),
                             _slot(_HALLASAN, "10:00:00", "12:00:00")]))
    assert _order(body) == []
    # 같은 시작은 화면 순서 그대로 세운다 — 겹침(HC2)은 화면에서 아래인 한라산 쪽에 붙는다
    assert [v["slot_index"] for v in body["violations"] if v["code"] == "HC2"] == [1]


def test_validate_compares_within_a_day_only() -> None:
    """날마다 따로 본다 — 다음 날 09시는 전날 13시보다 이르지만 거꾸로가 아니다."""
    body = _validate((_DAY, [_slot(_HALLASAN, "13:00:00", "14:00:00")]),
                     (_DAY2, [_slot(_PORK, "09:00:00", "10:00:00")]))
    assert _order(body) == []


def test_validate_points_at_the_bad_day_only() -> None:
    body = _validate((_DAY, [_slot(_PORK, "10:00:00", "11:00:00")]),
                     (_DAY2, [_slot(_HALLASAN, "13:00:00", "14:00:00"),
                              _slot(_WOLJEONG, "10:00:00", "11:00:00")]))
    assert _order(body) == [(1, 1, _WOLJEONG)]


def test_validate_untimed_card_keeps_array_positions() -> None:
    """시각 없는 카드는 비교 밖이지만 위치는 받은 배열 그대로다(앱이 그 칸에 배지를 단다)."""
    body = _validate((_DAY, [_slot(_PORK, "12:00:00", "13:00:00"),
                             _slot(_WOLJEONG, None, None),
                             _slot(_HALLASAN, "10:00:00", "11:00:00")]))
    assert _order(body) == [(0, 2, _HALLASAN)]


def test_validate_untimed_card_is_not_compared() -> None:
    """시각 없는 카드를 어떤 시각으로도 치지 않는다 — 9시·(미정)·10시는 거꾸로가 아니다."""
    body = _validate((_DAY, [_slot(_PORK, "09:00:00", "10:00:00"),
                             _slot(_WOLJEONG, None, None),
                             _slot(_HALLASAN, "10:00:00", "11:00:00")]))
    assert _order(body) == []


def test_validate_in_order_day_has_no_order_violation() -> None:
    body = _validate((_DAY, [_slot(_PORK, "09:00:00", "10:00:00"),
                             _slot(_HALLASAN, "12:00:00", "13:00:00")]))
    assert _order(body) == []


# ── ② repair ───────────────────────────────────────────────────────────────

def test_repair_does_not_push_a_picked_time_to_fix_the_order() -> None:
    """고정이 아닌 이른 카드는 뒤로 밀면 맞출 수 있지만 사용자가 고른 시각이라 덮지 않는다 — 수리 불가."""
    body = _repair((_DAY, _ADDED_LAST))
    assert body["repaired"] is None
    assert body["changes"] == []


def test_repair_answers_unrepairable_for_a_fixed_card_below_a_later_one() -> None:
    assert _repair((_DAY, _DRAGGED))["repaired"] is None


def test_repair_unrepairable_still_reports_unverified_slots() -> None:
    """수리 불가로 일찍 답해도 판정 못 한 칸은 싣는다 — 빈 목록으로 지우지 않는다(INV-4)."""
    body = _repair((_DAY, [*_ADDED_LAST, _slot(_UNKNOWN, "14:00:00", "15:00:00")]))
    assert body["repaired"] is None
    assert {(u["poi_id"], u["reason_code"]) for u in body["unverified_slots"]} >= {(_UNKNOWN, "NOT_REGISTERED")}


def test_repair_in_order_day_still_repairs() -> None:
    """회귀 가드 — 순서가 맞는 날은 종전대로 수리한다(빠듯한 이동을 앞으로 민다)."""
    body = _repair((_DAY, [_slot(_PORK, "09:00:00", "10:00:00"),
                           _slot(_HALLASAN, "10:30:00", "11:30:00")]))
    assert body["repaired"] is not None


# ── ③ explanations ─────────────────────────────────────────────────────────

def test_explanations_accept_an_out_of_order_day() -> None:
    with _client() as client:
        response = client.post("/ai/v1/itinerary/explanations", json={
            "trip_id": "slot-order", "itinerary": _itinerary((_DAY, _DRAGGED)),
            "request_meta": _meta()})
    assert response.status_code == 200, response.text


# ── ④ edit ─────────────────────────────────────────────────────────────────

def test_edit_still_rejects_an_out_of_order_day() -> None:
    with _client() as client:
        response = client.post("/ai/v1/itinerary/edit", json={
            "trip_id": "slot-order", "itinerary": _itinerary((_DAY, _DRAGGED)),
            "target_date": _DAY,
            "anchor": {"lat": DEMO_ANCHOR.lat, "lng": DEMO_ANCHOR.lng},
            "transport_mode": "대중교통", "confirm": False,
            "command": {"op": "MOVE_SLOT", "params": {"beforePoiId": _PORK},
                        "affected_slots": [_HALLASAN]},
            "request_meta": _meta()})
    assert response.status_code == 422, response.text
    assert "시간순" in response.text  # 다른 형식 오류가 아니라 순서 때문이다
