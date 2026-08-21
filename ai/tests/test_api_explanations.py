"""TRIP-479 — 설명 분리: generate 생략 옵션 + POST /ai/v1/itinerary/explanations.

증명하는 것 (실 LLM 0 — 스파이·fake):
  ① include_explanations=false generate → 설명 워커 미호출 (요청된 생략, 강등 아님)
  ② 기본값(true) generate → 워커 호출 경로 유지 (하위호환 회귀 가드)
  ③ /explanations 성공 — slot_key(BR-U2-04) → 설명 맵 회신
  ④ LLM 폴백 → 200 + 빈 맵 + 사유 (설명은 부가 정보 — 5xx 아님, 침묵 금지)
  ⑤ 미등록 POI뿐 → no_registered_pois (근거 없이 지어내지 않음)
  ⑥ 미주입 앱 → 503
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from trippilot.api import wiring
from trippilot.api.app import create_app
from trippilot.api.wiring import build_dev_app, demo_poi_seed
from trippilot.domain.llm import PoiExplanation, TypedResult
from trippilot.domain.common import PoiId

_SEED = demo_poi_seed()
_DAY = "2026-09-01"


class SpyExplainer:
    """ExplanationWorker 대역 — 호출 계수 + 고정 설명 반환."""

    def __init__(self, *, fallback: bool = False) -> None:
        self.calls = 0
        self.fallback = fallback

    def explain(self, pool, ordered_poi_ids, persona, trace_id, now, *,
                timeout_sec=None):
        self.calls += 1
        if self.fallback:
            return TypedResult(value=None, is_fallback=True,
                               error="llm down (fake)", call_record=None)
        return TypedResult(
            value=tuple(PoiExplanation(poi_id=p, text=f"{p} 추천 이유")
                        for p in ordered_poi_ids),
            is_fallback=False, error=None, call_record=None,
        )


@pytest.fixture()
def spy(monkeypatch: pytest.MonkeyPatch) -> SpyExplainer:
    instance = SpyExplainer()
    monkeypatch.setattr(wiring, "ExplanationWorker", lambda gateway: instance)
    return instance


def _generate_body(include: bool | None) -> dict:
    body = {
        "trip_id": "trip479",
        "generation_mode": "FULLY_AI",
        "trip_context": {"destinations": ["제주"], "start_date": _DAY,
                         "end_date": _DAY, "companion_type": "혼자",
                         "budget_level": "중간"},
        "anchors": [{"date": _DAY, "lat": wiring.DEMO_ANCHOR.lat,
                     "lng": wiring.DEMO_ANCHOR.lng}],
        "time_windows": [{"date": _DAY, "start": "09:00", "end": "21:00"}],
        "fixed_blocks": [],
        "preference_profile": {"styles": ["자연"], "transport_modes": ["대중교통"],
                               "budget_tier": "중간"},
        "request_meta": {"request_id": "trip479", "requested_at":
                         f"{_DAY}T08:00:00+09:00", "deadline_ms": 20000},
        "excluded_poi_ids": [],
    }
    if include is not None:
        body["include_explanations"] = include
    return body


def _slot(poi_id: str, start: str, end: str) -> dict:
    return {"poi_id": poi_id, "start_at": start, "end_at": end,
            "ends_next_day": False, "distance_range": None, "is_fixed": False}


def _explanations_body(*poi_ids: str) -> dict:
    slots = [_slot(p, f"{9 + i:02d}:00:00", f"{10 + i:02d}:00:00")
             for i, p in enumerate(poi_ids)]
    return {
        "trip_id": "trip479",
        "itinerary": {"days": [{"date": _DAY, "slots": slots}],
                      "day1_ready_at": None, "explanations": {},
                      "solve_mode": "OR_TOOLS", "is_fallback": False,
                      "freshness": None, "candidates_summary": None},
        "request_meta": {"request_id": "trip479-exp", "requested_at":
                         f"{_DAY}T08:00:00+09:00"},
    }


# ── ①·② generate 생략 옵션 ──────────────────────────────────────────


def test_generate_skip_flag_never_calls_explainer(spy: SpyExplainer) -> None:
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        response = client.post("/ai/v1/itinerary/generate",
                               json=_generate_body(include=False))
    assert response.status_code == 200
    assert spy.calls == 0  # 요청된 생략 — 설명 LLM 경로 진입 자체가 없다
    assert response.json()["explanations"] == {}


def test_generate_default_still_calls_explainer(spy: SpyExplainer) -> None:
    """플래그 미지정 = 기존 동작 (하위호환) — 설명 경로 유지."""
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        response = client.post("/ai/v1/itinerary/generate",
                               json=_generate_body(include=None))
    assert response.status_code == 200
    assert spy.calls == 1
    assert response.json()["explanations"]  # 스파이 설명이 실렸다


# ── ③~⑤ /explanations 경계 ──────────────────────────────────────────


def test_explanations_returns_slot_keyed_map(spy: SpyExplainer) -> None:
    ids = [str(p.poi_id) for p in _SEED[:2]]
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        response = client.post("/ai/v1/itinerary/explanations",
                               json=_explanations_body(*ids))
    assert response.status_code == 200
    body = response.json()
    assert body["is_fallback"] is False
    assert set(body["explanations"]) == {f"{_DAY}#{p}" for p in ids}  # BR-U2-04
    assert all("추천 이유" in v for v in body["explanations"].values())


def test_explanations_llm_fallback_is_honest_200(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    instance = SpyExplainer(fallback=True)
    monkeypatch.setattr(wiring, "ExplanationWorker", lambda gateway: instance)
    ids = [str(_SEED[0].poi_id)]
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        response = client.post("/ai/v1/itinerary/explanations",
                               json=_explanations_body(*ids))
    assert response.status_code == 200  # 설명은 부가 정보 — 5xx로 일정 흐름을 막지 않는다
    body = response.json()
    assert body["explanations"] == {} and body["is_fallback"] is True
    assert body["reason"] and "fallback" in body["reason"]


def test_explanations_unregistered_pois_report_reason(spy: SpyExplainer) -> None:
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        response = client.post("/ai/v1/itinerary/explanations",
                               json=_explanations_body("00000000-0000-4000-8000-999999999999"))
    assert response.status_code == 200
    body = response.json()
    assert body["explanations"] == {} and body["reason"] == "no_registered_pois"
    assert spy.calls == 0  # 근거 없는 설명을 지어내러 가지 않는다


# ── ⑥ 미주입 앱 ─────────────────────────────────────────────────────


def test_unwired_app_fails_loudly() -> None:
    with TestClient(create_app(), raise_server_exceptions=False) as client:
        response = client.post("/ai/v1/itinerary/explanations",
                               json=_explanations_body(str(_SEED[0].poi_id)))
    assert response.status_code == 503
