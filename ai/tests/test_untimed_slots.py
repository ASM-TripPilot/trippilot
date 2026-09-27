"""시간 미정 슬롯 (TRIP-827) — start_at·end_at null 이 경계마다 어떻게 다뤄지는가.

FE 가 "시간대 설정" 칩으로 그리는 슬롯이다. 백엔드가 저장은 하는데 스키마가
required 라 검증·재계획 왕복에서 422 였다 — nullable 완화의 계약이 여기 있다.

정책 셋을 잠근다:
  ① 검증(validate)·재계획(replan)은 **받는다** — 시각 주장이 없으니 시간 검증
     대상이 아니고, 후보 합류는 poi_id 로 한다
  ② 산출을 되돌려주는 경계(repair·edit)는 **명시 거부** — 건너뛰면 응답 일정에서
     사용자 저장 슬롯이 조용히 사라진다. 배치는 미지원이고 그걸 숨기지 않는다
  ③ **산출은 항상 시각이 있다**(INV-2) — 스키마가 nullable 로 넓어져도 생성
     응답에 null 이 새어 나가면 안 된다
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from trippilot.api.wiring import build_dev_app

from tests.test_api_replan_wired import _DIRECTIVES, _body as _replan_body


def _client(app):
    return TestClient(app, raise_server_exceptions=False)


_UNTIMED = {"poi_id": "e0000000-0000-4000-8000-000000000003",
            "start_at": None, "end_at": None}
_TIMED = {"poi_id": "e0000000-0000-4000-8000-000000000002",
          "start_at": "12:00", "end_at": "13:00"}


def _payload(*slots) -> dict:
    return {
        "days": [{"date": "2026-09-21", "slots": list(slots)}],
        "is_fallback": False,
        "solve_mode": "OR_TOOLS",
    }


def _meta() -> dict:
    return {"request_id": "untimed-test",
            "requested_at": "2026-09-21T08:00:00+09:00", "deadline_ms": 20000}


# ── ① 받는 경계 ─────────────────────────────────────────────────────────────

def test_validate_accepts_untimed_and_verifies_the_timed_rest() -> None:
    with _client(build_dev_app(directives=_DIRECTIVES)) as client:
        response = client.post("/ai/v1/itinerary/validate", json={
            "itinerary": _payload(_TIMED, _UNTIMED), "request_meta": _meta(),
        })
    assert response.status_code == 200, response.text


def test_replan_accepts_untimed_current_slot() -> None:
    """비고정 미정 슬롯의 시각은 아무도 안 읽는다 — 후보 합류는 poi_id 다."""
    with _client(build_dev_app(directives=_DIRECTIVES)) as client:
        response = client.post("/ai/v1/planb/replan", json=_replan_body(
            current_slots=[{**_UNTIMED, "is_fixed": False}],
        ))
    assert response.status_code == 200, response.text


# ── ② 거부하는 경계 — 소실 방지 ─────────────────────────────────────────────

def test_repair_rejects_untimed_instead_of_dropping_it() -> None:
    """건너뛰면 수리 응답에서 저장 슬롯이 사라진다 — 미지원을 422 로 말한다."""
    with _client(build_dev_app(directives=_DIRECTIVES)) as client:
        response = client.post("/ai/v1/itinerary/repair", json={
            "itinerary": _payload(_TIMED, _UNTIMED), "request_meta": _meta(),
        })
    assert response.status_code == 422, response.text
    assert "시간 미정" in response.text


def test_fixed_slot_without_time_is_rejected_everywhere() -> None:
    """시각 없는 고정은 HC3 로 표현 불가 — 비고정 취급하면 고정한 곳이 움직인다."""
    with _client(build_dev_app(directives=_DIRECTIVES)) as client:
        replan = client.post("/ai/v1/planb/replan", json=_replan_body(
            current_slots=[{**_UNTIMED, "is_fixed": True}],
        ))
        validate = client.post("/ai/v1/itinerary/validate", json={
            "itinerary": _payload({**_UNTIMED, "is_fixed": True}),
            "request_meta": _meta(),
        })
    assert replan.status_code == 422, replan.text
    assert validate.status_code == 422, validate.text


def test_half_timed_slot_is_malformed_not_untimed() -> None:
    """반쪽 시각은 미정이 아니라 기형이다 — 정책과 무관하게 422."""
    with _client(build_dev_app(directives=_DIRECTIVES)) as client:
        response = client.post("/ai/v1/itinerary/validate", json={
            "itinerary": _payload({"poi_id": "p1", "start_at": "12:00",
                                   "end_at": None}),
            "request_meta": _meta(),
        })
    assert response.status_code == 422
    assert "반쪽" in response.text


# ── ③ 산출은 항상 시각이 있다 (INV-2) ───────────────────────────────────────

def test_generate_output_never_emits_null_times() -> None:
    """스키마가 nullable 로 넓어진 것은 **입력**을 위해서다. 산출은 어셈블리
    검증값만 사영되므로 null 이 있을 수 없고, 이 테스트가 그 사실을 계약으로
    바꾼다 — 깨지면 INV-2 가 스키마 완화에 쓸려 나간 것이다.
    """
    body = {
        "trip_id": "trip-untimed-out",
        "generation_mode": "FULLY_AI",
        "trip_context": {"destinations": ["제주"], "start_date": "2026-09-21",
                         "end_date": "2026-09-21"},
        "anchors": [{"date": "2026-09-21", "lat": 33.4996, "lng": 126.5312}],
        "time_windows": [{"date": "2026-09-21", "start": "09:00", "end": "21:00"}],
        "fixed_blocks": [],
        "preference_profile": {},
        "request_meta": _meta(),
        "excluded_poi_ids": [],
    }
    with _client(build_dev_app(directives=_DIRECTIVES)) as client:
        response = client.post("/ai/v1/itinerary/generate", json=body)
    assert response.status_code == 200, response.text
    slots = [s for day in response.json()["days"] for s in day["slots"]]
    assert slots
    assert all(s["start_at"] is not None and s["end_at"] is not None
               for s in slots), "산출에 시각 null 이 새어 나갔다 (INV-2)"
