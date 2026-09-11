"""POST /ai/v1/notification/copies — 리마인드 문구 경계.

증명하는 것:
  ① 구형 조립(핸들러 없음)은 503 명시 실패
  ② 응답 스키마에 시각·duration 필드가 없다 (INV-3)
  ③ 배선된 조립 + 성공 LLM → 200 + copies 실제 생성 (경계→wiring→워커 관통 확인)
  ④ 일부 항목만 실패 → degraded=true + 성공분만 copies (INV-4, 침묵 금지)
  ⑤ 전부 실패 → 200 + 빈 copies + fallback_mode="backend_constant"
  ⑥ 드롭 발생 시 FallbackEvent(component="api.wiring")가 **배치당 1회** 발행된다 —
     응답 바디와 별개인 관측 신호(드롭률 계측의 유일한 소스, INV-4)
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from trippilot.api.app import create_app
from trippilot.api.wiring import build_dev_app
from trippilot.domain.observability import FallbackEvent

from tests.fakes.fake_llm import FailingLlm, FakeLlm, ScriptedVisionLlm
from tests.fakes.in_memory_trace import InMemoryTrace

URL = "/ai/v1/notification/copies"

REQUEST = {
    "request_meta": {"request_id": "r-1", "requested_at": "2026-09-12T09:00:00Z", "deadline_ms": 8000},
    "trip_title": "제주 3일",
    "items": [
        {
            "schedule_key": "k1",
            "kind": "TRIP_DAY",
            "date": "2026-09-13",
            "slots": [{"name": "성산일출봉", "category": "관광지"}],
        }
    ],
}


def test_unwired_app_returns_503() -> None:
    client = TestClient(create_app())
    assert client.post(URL, json=REQUEST).status_code == 503


def test_response_has_no_time_fields() -> None:
    from trippilot.api.schemas import ReminderCopySchema

    fields = set(ReminderCopySchema.model_fields)
    assert fields == {"schedule_key", "title", "body"}
    assert not any("duration" in f or "time" in f for f in fields)


def test_wired_app_returns_generated_copy() -> None:
    """배선된 앱 + 성공 LLM → 200 + copies 실제 생성, degraded=false (관통 확인)."""
    canned = (
        '{"title": "성산일출봉 다녀오기", "body": "오늘은 성산일출봉 방문일이에요", '
        '"places": ["성산일출봉"]}'
    )
    app = build_dev_app(llm=FakeLlm(canned=canned), model_id="m-fake")
    with TestClient(app) as client:
        res = client.post(URL, json=REQUEST)
        assert res.status_code == 200
        body = res.json()
        assert body["degraded"] is False
        assert body["fallback_mode"] is None
        assert body["copies"] == [
            {
                "schedule_key": "k1",
                "title": "성산일출봉 다녀오기",
                "body": "오늘은 성산일출봉 방문일이에요",
            }
        ]


TWO_ITEM_REQUEST = {
    "request_meta": {"request_id": "r-2", "requested_at": "2026-09-12T09:00:00Z", "deadline_ms": 8000},
    "trip_title": "제주 3일",
    "items": [
        {
            "schedule_key": "k1",
            "kind": "TRIP_DAY",
            "date": "2026-09-13",
            "slots": [{"name": "성산일출봉", "category": "관광지"}],
        },
        {
            "schedule_key": "k2",
            "kind": "TRIP_DAY",
            "date": "2026-09-14",
            "slots": [{"name": "우도", "category": "관광지"}],
        },
    ],
}


def test_wired_app_partial_failure_reports_degraded_with_only_successful_copies() -> None:
    """일부 항목 게이트 드롭 → 성공분만 copies + degraded=true (INV-4 매핑 검증).

    카운팅(dropped 수)은 워커 유닛 테스트가 이미 증명한다 — 여기서 증명하는 건 그
    카운트를 경계 응답(copies·degraded·fallback_mode)으로 옮기는 이 핸들러의 매핑이다.
    """
    ok_json = (
        '{"title": "성산일출봉 다녀오기", "body": "오늘은 성산일출봉 방문일이에요", '
        '"places": ["성산일출봉"]}'
    )
    app = build_dev_app(llm=ScriptedVisionLlm(ok_json, "이건 JSON이 아니다"), model_id="m-fake")
    with TestClient(app) as client:
        res = client.post(URL, json=TWO_ITEM_REQUEST)
        assert res.status_code == 200
        body = res.json()
        assert body["copies"] == [
            {
                "schedule_key": "k1",
                "title": "성산일출봉 다녀오기",
                "body": "오늘은 성산일출봉 방문일이에요",
            }
        ]
        assert body["degraded"] is True
        assert body["fallback_mode"] == "backend_constant"


def test_wired_app_all_failures_returns_empty_copies_with_backend_constant() -> None:
    """전부 실패해도 5xx 아닌 200 + 빈 copies — 백엔드가 기존 상수로 채운다(INV-4)."""
    app = build_dev_app(llm=FailingLlm(), model_id="m-fake")
    with TestClient(app) as client:
        res = client.post(URL, json=REQUEST)
        assert res.status_code == 200
        body = res.json()
        assert body["copies"] == []
        assert body["degraded"] is True
        assert body["fallback_mode"] == "backend_constant"


def test_dropped_items_emit_one_fallback_event_per_batch_not_per_item() -> None:
    """드롭 발생 시 FallbackEvent(component="api.wiring")가 배치당 정확히 1건 —
    응답 바디(copies/degraded/fallback_mode) 검증과는 독립적인 관측 신호 검증이다.
    삭제해도 전체 스위트가 초록일 수 있는 emit(...) 호출이라 별도로 관측한다.
    """
    trace = InMemoryTrace()
    # 2항목 모두 드롭 — "배치당 1회"를 "드롭 건수만큼"과 구별하려면 드롭이 2건 이상이어야 한다.
    app = build_dev_app(llm=FailingLlm(), model_id="m-fake", trace=trace)
    with TestClient(app) as client:
        res = client.post(URL, json=TWO_ITEM_REQUEST)
        assert res.status_code == 200
        assert res.json()["degraded"] is True

    wiring_events = [
        e for e in trace.of_type(FallbackEvent) if e.component == "api.wiring"
    ]
    assert len(wiring_events) == 1  # 항목 2건 다 드롭됐어도 배치당 1건
    event = wiring_events[0]
    assert event.from_mode == "llm_reminder_copy"
    assert event.to_mode == "backend_constant"
