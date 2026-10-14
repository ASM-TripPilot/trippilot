"""TRIP-431 — 편집 경계 (`POST /ai/v1/itinerary/edit`), 자연어·구조화 겸용.

증명하는 것 (실 LLM 0 — UnwiredLlm·데모 시드):
  ① 비파괴 구조화 명령(MOVE) → APPLIED — 순서 반영 + 시각은 재타이밍·어셈블리 통과분(INV-2)
  ② 파괴적 명령(REMOVE) → confirm 없으면 CONFIRM_REQUIRED(명령 에코), confirm=true면 APPLIED
  ③ ADD — 풀 안 POI는 추가되고, 풀 밖 POI는 REJECTED (closed-set, INV-1)
  ④ 시각 키 params → REJECTED (시각은 어셈블리 소유)
  ⑤ REPLAN → REJECTED + generate 안내 (1단계 범위 밖)
  ⑥ 자연어 + LLM 미배선 → TRANSLATION_FAILED (자연어 경로만 정직 실패, INV-4)
  ⑦ command·utterance 동시/무송신 → 422
  ⑧ 응답 원문에 duration 토큰 없음(INV-3) · 미주입 앱 503
  ⑨ 예약(is_fixed) 슬롯은 닻 — 무관한 슬롯 편집은 APPLIED + 예약 시각 불변,
     예약 자체를 대상으로 하면 REJECTED("예약"), 예약 앞에 못 도착하면 HC2 (TRIP-526)
  ⑩ 좌표 미상 POI 와 인접하는 편집은 REJECTED("좌표 미상") — 이동 0분을 지어내지
     않는다(예약 슬롯도 예외 없음); 그 날 유일한 슬롯이면 인접이 없어 통과 (TRIP-525)
  ⑪ 풀 밖 현재 슬롯(다른 조건으로 생성된 원 일정)도 자연어로 편집된다 — 422 아님,
     정상 편집이면 APPLIED·해석 실패면 TRANSLATION_FAILED. 버튼·말 두 진입이 같은
     입력에 같은 판정 (TRIP-527 / TRIP-431 수렴 결정)
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from trippilot.api.app import create_app
from trippilot.api.wiring import DEMO_ANCHOR, build_dev_app, demo_poi_seed
from tests.fakes.fake_llm import FakeLlm

_SEED = {p.name: str(p.poi_id) for p in demo_poi_seed()}
# 앵커(제주 중간점) 반경 10km 안 시드 = 흑돼지거리·한라산 (wiring DEMO_ANCHOR 주석)
_PORK = _SEED["제주 흑돼지거리"]
_HALLASAN = _SEED["한라산"]
# 앵커 반경 밖(풀 밖)이지만 poi_db 에는 있다 — 좌표는 있고 추가·교체 대상은 못 된다
_WOLJEONG = _SEED["월정리 카페거리"]
_DAY = "2026-09-01"
# poi_db·풀 어디에도 없는 id — 좌표 미상 POI (test_add_outside_pool_rejected 와 같은 값)
_UNKNOWN = "99999999-9999-4999-8999-999999999999"


def _slot(poi_id: str, start: str, end: str, *, fixed: bool = False) -> dict:
    return {"poi_id": poi_id, "start_at": start, "end_at": end,
            "ends_next_day": False, "distance_range": None, "is_fixed": fixed}


# 일반 슬롯 2 + 예약(고정) 슬롯 1 (TRIP-526 재현 픽스처). 대중교통 추정(하버사인×1.3,
# 20km/h×1.5): 월정리→한라산 207분 · 한라산→흑돼지 112분 · 흑돼지→월정리 167분 —
# 원 배치는 전부 여유가 있다. 예약이 첫 슬롯이면 커서 시작이 우연히 원 시각과 같아
# 결함이 안 드러나므로 예약을 **마지막**에 둔다.
_FIXED_DAY = [_slot(_WOLJEONG, "08:00:00", "09:00:00"),
              _slot(_HALLASAN, "12:30:00", "13:30:00"),
              _slot(_PORK, "15:30:00", "16:30:00", fixed=True)]


def _body(*, command: dict | None = None, utterance: str | None = None,
          slots: list[dict] | None = None, confirm: bool = False) -> dict:
    if slots is None:
        slots = [_slot(_PORK, "10:00:00", "11:00:00"),
                 _slot(_HALLASAN, "13:00:00", "14:30:00")]
    body = {
        "trip_id": "trip431",
        "itinerary": {"days": [{"date": _DAY, "slots": slots}],
                      "day1_ready_at": None, "explanations": {},
                      "solve_mode": "OR_TOOLS", "is_fallback": False,
                      "freshness": None, "candidates_summary": None},
        "target_date": _DAY,
        "anchor": {"lat": DEMO_ANCHOR.lat, "lng": DEMO_ANCHOR.lng},
        "transport_mode": "대중교통",
        "confirm": confirm,
        "request_meta": {"request_id": "edit431", "requested_at":
                         f"{_DAY}T08:00:00+09:00"},
    }
    if command is not None:
        body["command"] = command
    if utterance is not None:
        body["utterance"] = utterance
    return body


def _post(client: TestClient, body: dict):
    return client.post("/ai/v1/itinerary/edit", json=body)


def _client() -> TestClient:
    return TestClient(build_dev_app(), raise_server_exceptions=False)


# ── ① 비파괴 구조화 → APPLIED ────────────────────────────────────────


def test_move_slot_applies_with_assembly_passed_times() -> None:
    with _client() as client:
        response = _post(client, _body(command={
            "op": "MOVE_SLOT", "params": {}, "affected_slots": [_HALLASAN]}))
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "APPLIED" and body["apply_mode"] == "AUTO_APPLY"
    slots = body["itinerary"]["days"][0]["slots"]
    assert [s["poi_id"] for s in slots] == [_HALLASAN, _PORK]  # 맨 앞으로 이동
    starts = [s["start_at"] for s in slots]
    assert starts == sorted(starts)  # 재타이밍 결과 시간순 (어셈블리 validate 통과분)


# ── ② 파괴적 → 확인 게이트 ──────────────────────────────────────────


def test_remove_requires_confirm_then_applies() -> None:
    command = {"op": "REMOVE_SLOT", "params": {}, "affected_slots": [_PORK]}
    with _client() as client:
        first = _post(client, _body(command=command))
        second = _post(client, _body(command=command, confirm=True))
    assert first.json()["status"] == "CONFIRM_REQUIRED"
    assert first.json()["command"]["op"] == "REMOVE_SLOT"  # FE 확인 표시용 에코
    assert first.json()["itinerary"] is None  # 확인 전 반영 없음
    body = second.json()
    assert body["status"] == "APPLIED"
    assert [s["poi_id"] for s in body["itinerary"]["days"][0]["slots"]] == [_HALLASAN]


# ── ③ ADD — closed-set (INV-1) ──────────────────────────────────────


def test_add_pool_poi_applies() -> None:
    with _client() as client:
        response = _post(client, _body(
            slots=[_slot(_PORK, "10:00:00", "11:00:00")],
            command={"op": "ADD_SLOT", "params": {"targetPoiId": _HALLASAN},
                     "affected_slots": []}))
    body = response.json()
    assert body["status"] == "APPLIED"
    ids = [s["poi_id"] for s in body["itinerary"]["days"][0]["slots"]]
    assert ids == [_PORK, _HALLASAN]


def test_add_outside_pool_rejected() -> None:
    with _client() as client:
        response = _post(client, _body(command={
            "op": "ADD_SLOT",
            "params": {"targetPoiId": _UNKNOWN},
            "affected_slots": []}))
    body = response.json()
    assert body["status"] == "REJECTED"
    assert "closed-set" in body["reason"]  # 풀 밖 POI — 지어내지 않는다 (INV-1)


# ── ④·⑤ 방어 규칙 ───────────────────────────────────────────────────


@pytest.mark.parametrize(
    "key", ["startTime", "eta", "arriveBy", "travelSecs", "arrive_by"])
def test_time_params_rejected(key: str) -> None:
    """게이트 ③과 동일 함수로 검사 — eta·arriveBy·travelSecs는 목록 복사 시절
    구조화 진입만 통과해 응답에 에코되던 회귀 케이스 (invariant-reviewer 재현)."""
    with _client() as client:
        response = _post(client, _body(command={
            "op": "MOVE_SLOT", "params": {key: "15:00"},
            "affected_slots": [_PORK]}))
    body = response.json()
    assert body["status"] == "REJECTED" and "시각" in body["reason"]


def test_poi_ref_keys_are_not_time_keys() -> None:
    """startPoiId·endPoiId·afterPoiId는 POI 참조지 시각 키가 아니다 — 맨몸
    start·end 토큰이 오탐하던 키들 (정확일치로 좁힌 근거의 회귀 방지)."""
    with _client() as client:
        response = _post(client, _body(command={
            "op": "MOVE_SLOT",
            "params": {"afterPoiId": _PORK, "startPoiId": _HALLASAN,
                       "endPoiId": _PORK},
            "affected_slots": [_HALLASAN]}))
    body = response.json()
    assert body["status"] == "APPLIED"


def test_replan_rejected_with_guidance() -> None:
    with _client() as client:
        response = _post(client, _body(command={
            "op": "REPLAN", "params": {}, "affected_slots": []}, confirm=True))
    body = response.json()
    assert body["status"] == "REJECTED" and "generate" in body["reason"]


# ── ⑥ 자연어 — LLM 미배선은 자연어 경로만 정직 실패 ──────────────────


def test_utterance_with_unwired_llm_fails_honestly() -> None:
    with _client() as client:
        response = _post(client, _body(utterance="한라산을 맨 앞으로 옮겨줘"))
    body = response.json()
    assert response.status_code == 200
    assert body["status"] == "TRANSLATION_FAILED"
    assert body["reason"]  # 사유 명시 (침묵 금지)


# ── ⑪ 풀 밖 현재 슬롯도 자연어로 편집 가능 (TRIP-527) ───────────────

# 월정리(앵커 반경 밖)를 포함한 하루 — 풀은 요청마다 잘리는 조각이라 원 일정 슬롯이
# 풀 밖인 것은 정상이다. 이 배치가 수정 전 422를 내던 재현 픽스처.
_POOL_OUTSIDE_DAY = [_slot(_HALLASAN, "08:00:00", "09:00:00"),
                     _slot(_WOLJEONG, "12:30:00", "13:30:00")]
# 자연어 진입이 번역해 낼 명령 — 아래 구조화 진입과 **같은 명령**이다 (수렴 비교용)
_MOVE_WOLJEONG = {"op": "MOVE_SLOT", "params": {}, "affected_slots": [_WOLJEONG]}
_CANNED_MOVE = (
    '{"editCommand": {"op": "MOVE_SLOT", "params": {},'
    f' "affectedSlots": ["{_WOLJEONG}"]}}}}'
)


def _fake_llm_client(canned: str) -> TestClient:
    """자연어 경로만 배선한 앱 — 편집은 번역 1회만 LLM을 쓴다 (실 호출 0)."""
    return TestClient(
        build_dev_app(llm=FakeLlm(canned=canned), model_id="m-fake"),
        raise_server_exceptions=False,
    )


def test_utterance_on_pool_outside_slot_is_not_422() -> None:
    """수정 전엔 번역 워커가 "풀 밖 = 호출측 버그"로 raise 해 422가 나갔다.

    422는 백엔드의 MinimalItineraryFallback 신호라, 편집 한 번이 일정을 최소본으로
    갈아엎는다. LLM 미배선이면 해석 실패지만 그건 200 + TRANSLATION_FAILED다.
    """
    with _client() as client:
        response = _post(client, _body(slots=_POOL_OUTSIDE_DAY,
                                       utterance="월정리를 맨 앞으로 옮겨줘"))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "TRANSLATION_FAILED" and body["reason"]


def test_utterance_edits_pool_outside_slot_and_applies() -> None:
    """번역만 성공하면 풀 밖 현재 슬롯도 정상 편집된다 — 게이트가 지목을 현재
    슬롯과 교차하기 때문(TRIP-527). 이전엔 여기서 명령 전체가 드롭됐다."""
    with _fake_llm_client(_CANNED_MOVE) as client:
        response = _post(client, _body(slots=_POOL_OUTSIDE_DAY,
                                       utterance="월정리를 맨 앞으로 옮겨줘"))
    body = response.json()
    assert body["status"] == "APPLIED", body
    ids = [s["poi_id"] for s in body["itinerary"]["days"][0]["slots"]]
    assert ids == [_WOLJEONG, _HALLASAN]


def test_button_and_utterance_entries_agree_on_the_same_command() -> None:
    """수렴 고정 (TRIP-431 팀 결정) — 같은 입력이면 두 진입의 판정·결과가 같다.

    수정 전: 버튼은 APPLIED, 말은 422(워커 raise) — 같은 슬롯에 다른 규칙이었다.
    """
    body = _body(slots=_POOL_OUTSIDE_DAY)
    with _client() as client:
        button = _post(client, {**body, "command": _MOVE_WOLJEONG})
    with _fake_llm_client(_CANNED_MOVE) as client:
        utterance = _post(client, {**body, "utterance": "월정리를 맨 앞으로 옮겨줘"})
    assert button.status_code == utterance.status_code == 200
    a, b = button.json(), utterance.json()
    assert a["status"] == b["status"] == "APPLIED"
    assert a["command"] == b["command"] and a["apply_mode"] == b["apply_mode"]
    assert a["itinerary"] == b["itinerary"]


def test_new_poi_outside_pool_stays_rejected_in_both_entries() -> None:
    """INV-1은 양쪽 그대로 — 새로 넣는 POI는 여전히 풀 안이어야 한다.

    (자연어는 게이트 드롭이라 TRANSLATION_FAILED, 구조화는 REJECTED — 둘 다
    "반영하지 않는다"로 수렴하고 사유가 실린다. 침묵 실패 없음, INV-4.)
    """
    add_outside = {"op": "ADD_SLOT", "params": {"targetPoiId": _WOLJEONG},
                   "affected_slots": []}
    canned = (
        '{"editCommand": {"op": "ADD_SLOT",'
        f' "params": {{"targetPoiId": "{_WOLJEONG}"}}, "affectedSlots": []}}}}'
    )
    with _client() as client:
        button = _post(client, _body(command=add_outside))
    with _fake_llm_client(canned) as client:
        utterance = _post(client, _body(utterance="월정리 카페거리도 추가해줘"))
    assert button.json()["status"] == "REJECTED"
    assert "closed-set" in button.json()["reason"]
    assert utterance.json()["status"] == "TRANSLATION_FAILED"
    assert "closed_set_violation" in utterance.json()["reason"]


# ── ⑨ 예약(고정) 슬롯 = 닻 (TRIP-526) ──────────────────────────────


def test_move_free_slot_keeps_fixed_slot_exactly() -> None:
    """예약과 무관한 슬롯을 옮겨도 APPLIED — 예약 슬롯은 원 시각 그대로(HC3 정확 일치).
    수정 전엔 재타이밍이 예약을 커서(09:00+112분)로 밀어 HC3 REJECTED 였다.
    커서가 예약보다 이르면 그 사이는 대기, 예약 뒤 슬롯은 예약 끝에서 이어진다."""
    with _client() as client:
        response = _post(client, _body(slots=_FIXED_DAY, command={
            "op": "MOVE_SLOT", "params": {"afterPoiId": _PORK},
            "affected_slots": [_WOLJEONG]}))
    body = response.json()
    assert body["status"] == "APPLIED", body
    slots = body["itinerary"]["days"][0]["slots"]
    assert [s["poi_id"] for s in slots] == [_HALLASAN, _PORK, _WOLJEONG]
    fixed = slots[1]
    assert (fixed["start_at"], fixed["end_at"]) == ("15:30:00", "16:30:00")
    assert fixed["is_fixed"] is True
    assert slots[2]["start_at"] > "16:30:00"  # 닻 끝 + 이동부터 커서


@pytest.mark.parametrize("command", [
    {"op": "MOVE_SLOT", "params": {}, "affected_slots": [_PORK]},
    {"op": "REMOVE_SLOT", "params": {}, "affected_slots": [_PORK]},
    {"op": "REPLACE_SLOT", "params": {"targetPoiId": _HALLASAN},
     "affected_slots": [_PORK]},
], ids=["move", "remove", "replace"])
def test_fixed_slot_cannot_be_edit_target(command: dict) -> None:
    with _client() as client:
        response = _post(client, _body(slots=_FIXED_DAY, command=command, confirm=True))
    body = response.json()
    assert body["status"] == "REJECTED" and "예약" in body["reason"]
    assert body["itinerary"] is None


def test_free_slot_before_fixed_without_travel_room_is_hc2_not_hc3() -> None:
    """일반 슬롯을 예약 앞으로 — 예약은 안 밀리고(HC3 무결) 도착 불가가 HC2 로 드러난다.
    조용히 맞추지 않는다(INV-2)."""
    with _client() as client:
        response = _post(client, _body(slots=_FIXED_DAY, command={
            "op": "MOVE_SLOT", "params": {}, "affected_slots": [_HALLASAN]}))
    body = response.json()
    assert body["status"] == "REJECTED"
    codes = {v["code"] for v in body["violations"]}
    assert "HC2" in codes and "HC3" not in codes, body["violations"]


def test_reorder_displacing_fixed_past_its_time_is_rejected() -> None:
    """REORDER_DAY 순열은 허용하되, 앞 슬롯 시작이 예약 시각을 이미 지나면 그 순서는
    불가(슬롯 시간순 불변식) — 시각을 지어내 맞추지 않고 사유와 함께 거부(INV-2·4)."""
    early_fixed = [_slot(_PORK, "10:00:00", "11:00:00", fixed=True),
                   _slot(_HALLASAN, "13:00:00", "14:00:00"),
                   _slot(_WOLJEONG, "17:30:00", "18:30:00")]
    with _client() as client:
        response = _post(client, _body(slots=early_fixed, command={
            "op": "REORDER_DAY", "params": {},
            "affected_slots": [_HALLASAN, _WOLJEONG, _PORK]}, confirm=True))
    body = response.json()
    assert body["status"] == "REJECTED" and "예약" in body["reason"]


# ── ⑩ 좌표 미상 POI 인접 = 거부 (TRIP-525) ─────────────────────────


@pytest.mark.parametrize("fixed", [False, True], ids=["free", "fixed"])
def test_add_next_to_unknown_coord_poi_is_rejected(fixed: bool) -> None:
    """좌표 없는 POI 옆에 추가 — 이동시간을 산출할 수 없으니 0분을 지어내지 않고 거부.
    수정 전엔 gap=0 으로 재타이밍하고 check_hc2 가 좌표 없음을 건너뛰어(의도된 c2 규칙)
    검증 도장을 달고 나갔다. 예약 슬롯이어도 예외가 아니다."""
    with _client() as client:
        response = _post(client, _body(
            slots=[_slot(_UNKNOWN, "10:00:00", "11:00:00", fixed=fixed)],
            command={"op": "ADD_SLOT", "params": {"targetPoiId": _HALLASAN},
                     "affected_slots": []}))
    body = response.json()
    assert body["status"] == "REJECTED" and "좌표 미상" in body["reason"]
    assert _UNKNOWN in body["reason"]
    assert body["itinerary"] is None


def test_unknown_coord_poi_alone_on_day_passes() -> None:
    """인접 구간이 없으면 좌표가 없어도 이동시간이 필요 없다 — 통과."""
    with _client() as client:
        response = _post(client, _body(
            slots=[_slot(_UNKNOWN, "10:00:00", "11:00:00")],
            command={"op": "MOVE_SLOT", "params": {}, "affected_slots": [_UNKNOWN]}))
    body = response.json()
    assert body["status"] == "APPLIED", body
    [slot] = body["itinerary"]["days"][0]["slots"]
    assert (slot["poi_id"], slot["start_at"], slot["end_at"]) == (
        _UNKNOWN, "10:00:00", "11:00:00")


# ── ⑦·⑧ 경계 위생 ───────────────────────────────────────────────────


def test_both_or_neither_entry_is_422() -> None:
    with _client() as client:
        both = _post(client, _body(
            command={"op": "CLEAR_DAY", "params": {}, "affected_slots": []},
            utterance="비워줘"))
        neither = _post(client, _body())
    assert both.status_code == 422
    assert neither.status_code == 422


def test_no_duration_tokens_in_response() -> None:
    with _client() as client:
        response = _post(client, _body(command={
            "op": "MOVE_SLOT", "params": {}, "affected_slots": [_HALLASAN]}))
    assert "duration" not in response.text.lower()  # INV-3


def test_unwired_app_fails_loudly() -> None:
    with TestClient(create_app(), raise_server_exceptions=False) as client:
        response = _post(client, _body(command={
            "op": "CLEAR_DAY", "params": {}, "affected_slots": []}))
    assert response.status_code == 503
