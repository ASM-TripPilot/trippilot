"""TRIP-473 — deadline_ms 선택화: 미지정 = 시간제약 없음 (FE 연동 팀 결정).

증명하는 것:
  ① deadline 미지정 generate → 200 + 슬롯 배치 (422 아님 — 와이어 하위호환 확장)
  ② 미지정 시 예산 계단에는 UNBOUNDED_DEADLINE_MS 대입 — 계단 구조 유지(INV-4),
     시간 때문에 강등되지 않을 뿐
  ③ 지정 시 기존과 동일 값 관통 (회귀 없음)
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from trippilot.api import wiring
from trippilot.api.schemas import RequestMetaSchema
from trippilot.api.wiring import UNBOUNDED_DEADLINE_MS, build_dev_app


def _generate_body_without_deadline() -> dict:
    return {
        "trip_id": "trip473-no-deadline",
        "generation_mode": "FULLY_AI",
        "trip_context": {
            "destinations": ["제주"], "start_date": "2026-09-01",
            "end_date": "2026-09-01", "companion_type": "혼자",
            "budget_level": "중간",
        },
        "anchors": [{"date": "2026-09-01", "lat": 33.4362, "lng": 126.5255}],
        "time_windows": [{"date": "2026-09-01", "start": "09:00", "end": "21:00"}],
        "fixed_blocks": [],
        "preference_profile": {
            "styles": ["자연"], "transport_modes": ["대중교통"], "budget_tier": "중간",
        },
        "request_meta": {
            "request_id": "trip473-no-deadline",
            "requested_at": "2026-09-01T08:00:00+09:00",
            # deadline_ms 없음 — 시간제약 없음
        },
        "excluded_poi_ids": [],
    }


def test_generate_without_deadline_succeeds() -> None:
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        response = client.post(
            "/ai/v1/itinerary/generate", json=_generate_body_without_deadline())
    assert response.status_code == 200
    assert any(day["slots"] for day in response.json()["days"])


def test_missing_deadline_maps_to_unbounded_budget() -> None:
    meta = RequestMetaSchema.model_validate(
        {"request_id": "r", "requested_at": "2026-09-01T08:00:00+09:00"})
    assert wiring._deadline_budget(meta) == UNBOUNDED_DEADLINE_MS


def test_explicit_deadline_passes_through_unchanged() -> None:
    meta = RequestMetaSchema.model_validate(
        {"request_id": "r", "requested_at": "2026-09-01T08:00:00+09:00",
         "deadline_ms": 5000})
    assert wiring._deadline_budget(meta) == 5000
