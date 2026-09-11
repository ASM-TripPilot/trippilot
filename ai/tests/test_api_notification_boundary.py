"""POST /ai/v1/notification/copies — 리마인드 문구 경계.

증명하는 것:
  ① 구형 조립(핸들러 없음)은 503 명시 실패
  ② 응답 스키마에 시각·duration 필드가 없다 (INV-3)
  ③ 배선된 조립 + 성공 LLM → 200 + copies 실제 생성 (경계→wiring→워커 관통 확인)
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from trippilot.api.app import create_app
from trippilot.api.wiring import build_dev_app

from tests.fakes.fake_llm import FakeLlm

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
