"""시각이 거꾸로 든 날 — 화면 순서(배열)에서 위 카드보다 일찍 시작하는 카드가 있는 날.

편집은 '순서 = 배열'이라(BE INV-U3-02) 이런 날이 저장될 수 있다 — 고정·방문 완료 카드를 사이에 둔
끌어 옮기기, 시각을 골라 끝에 넣은 추가. 종전에는 도메인 불변식(`DaySolution` 시간순)이 422 로
새어 나가 BE 가 판정 보류로 저장했고, 위반 배지가 뜨지 않았다(운영 여행 3개, 2026-11-03~08).

경계별 정책을 잠근다:
  ① validate — 200 + 그런 카드마다 위반 `SLOT_ORDER`(위치는 요청 배열 기준), 나머지 HC 는 시각 순으로 판정
  ② repair — 200 + `repaired=null`(수리 불가, IO-7). 앞으로만 미는 수리는 순서를 지키며 못 고친다
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


# ── ① validate ─────────────────────────────────────────────────────────────

def test_validate_flags_the_card_earlier_than_one_above_it() -> None:
    body = _validate((_DAY, _DRAGGED))
    assert _order(body) == [(0, 2, _WOLJEONG)]
    flagged = next(v for v in body["violations"] if v["code"] == "SLOT_ORDER")
    assert flagged["reason_code"] is None  # HC1 하위 코드가 아니다 — 장소 감지가 알림으로 읽지 않는다
    assert "분" not in flagged["detail"]  # 시각만, 소요시간 없음(INV-3)
    # 나머지 판정은 그대로 돈다 — 시각 순(흑돼지 → 월정리 → 한라산)으로 본 이동이 빠듯하다
    assert "HC2" in {v["code"] for v in body["violations"]}, body["violations"]


def test_validate_flags_every_card_below_a_later_one_not_just_neighbours() -> None:
    """13시 아래 9시·10시 — 둘 다 위의 13시보다 이르다(바로 위만 보면 10시를 놓친다)."""
    body = _validate((_DAY, [_slot(_HALLASAN, "13:00:00", "14:00:00"),
                             _slot(_PORK, "09:00:00", "10:00:00"),
                             _slot(_WOLJEONG, "10:00:00", "11:00:00")]))
    assert _order(body) == [(0, 1, _PORK), (0, 2, _WOLJEONG)]


def test_validate_equal_starts_are_not_out_of_order() -> None:
    body = _validate((_DAY, [_slot(_PORK, "10:00:00", "11:00:00"),
                             _slot(_HALLASAN, "10:00:00", "12:00:00")]))
    assert _order(body) == []


def test_validate_points_at_the_bad_day_only() -> None:
    body = _validate((_DAY, [_slot(_PORK, "10:00:00", "11:00:00")]),
                     (_DAY2, [_slot(_HALLASAN, "13:00:00", "14:00:00"),
                              _slot(_WOLJEONG, "10:00:00", "11:00:00")]))
    assert _order(body) == [(1, 1, _WOLJEONG)]


def test_validate_untimed_card_keeps_array_positions() -> None:
    """시각 없는 카드는 비교 밖이지만 위치는 요청 배열 그대로다(앱이 그 칸에 배지를 단다)."""
    body = _validate((_DAY, [_slot(_PORK, "12:00:00", "13:00:00"),
                             _slot(_WOLJEONG, None, None),
                             _slot(_HALLASAN, "10:00:00", "11:00:00")]))
    assert _order(body) == [(0, 2, _HALLASAN)]


def test_validate_in_order_day_has_no_order_violation() -> None:
    body = _validate((_DAY, [_slot(_PORK, "09:00:00", "10:00:00"),
                             _slot(_HALLASAN, "12:00:00", "13:00:00")]))
    assert _order(body) == []


# ── ② repair ───────────────────────────────────────────────────────────────

def test_repair_answers_unrepairable_instead_of_422() -> None:
    with _client() as client:
        response = client.post("/ai/v1/itinerary/repair", json={
            "itinerary": _itinerary((_DAY, _DRAGGED)), "request_meta": _meta()})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["repaired"] is None
    assert body["changes"] == []


def test_repair_in_order_day_still_repairs() -> None:
    """회귀 가드 — 순서가 맞는 날은 종전대로 수리한다(빠듯한 이동을 앞으로 민다)."""
    with _client() as client:
        response = client.post("/ai/v1/itinerary/repair", json={
            "itinerary": _itinerary((_DAY, [_slot(_PORK, "09:00:00", "10:00:00"),
                                            _slot(_HALLASAN, "10:30:00", "11:30:00")])),
            "request_meta": _meta()})
    assert response.status_code == 200, response.text
    assert response.json()["repaired"] is not None


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
