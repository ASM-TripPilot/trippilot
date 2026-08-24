"""RFL 경계 관통 (TRIP-429): /ai/v1/reflection/{generate,nudge} — 계약 §3·§5 + INV-3·INV-4.

TestClient + build_dev_app 실조립(경계→wiring→compose 코어→게이트웨이) 관통 —
실 LLM·외부 API 호출 0 (D37, e2e boundary ⑥ 선례). 증명하는 것:

  ① UnwiredLlm(기본 조립): generate 3회 전부 실패 → **200 + is_fallback=true**
     (5xx 아님 — INV-4 정직 강등) ∧ 응답 최상위 키 집합 = 계약 §3 봉투+본문 키
     ∧ 응답 원문에 duration류 금칙 토큰 부재(INV-3) — nudge는 결정론 기본 문구 200
  ② 스크립트 LLM(유효 템플릿 JSON): generate 200 + is_fallback=false + scenes 실림
     + 장면 참조 전부 요청 방문 내 (INV-1 사영)
  ③ 미배선 조립(create_app 단독): 두 라우트 모두 503 명시 실패 — 침묵 금지
  ④ visits 0건은 경계 422 (BR-U6R-15의 경계측 방어)
"""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from trippilot.api.app import create_app
from trippilot.api.wiring import build_dev_app
from trippilot.llm_gateway.workers.reflection_nudge import FALLBACK_NUDGE_MESSAGE

from tests.fakes.fake_llm import FakeLlm

_GEN_URL = "/ai/v1/reflection/generate"
_NUDGE_URL = "/ai/v1/reflection/nudge"

# 계약 §3 — ReflectionTemplate.to_dict() 키 (시각·순서·duration 필드 자체가 없다)
_CONTRACT_KEYS = {
    "template_id", "kind", "format", "generated_at",
    "is_fallback", "cover", "scenes", "hashtags",
}
# INV-3/IO-3 — 응답 원문 어디에도 나가면 안 되는 토큰 (기존 경계 계약 목록의 회고 사영)
_BANNED_TOKENS = ("duration", "minutes", "stay_min", "dwell_min", "travel_time", "elapsed")


def _meta() -> dict:
    return {"request_id": "req-rfl-429", "requested_at": "2026-08-20T09:00:00+09:00"}


def _gen_request() -> dict:
    return {
        "request_meta": _meta(),
        "kind": "TRIP_SUMMARY",
        "region": "부산",
        "start_date": "2026-08-01",
        "end_date": "2026-08-02",
        "visits": [
            {"ref": {"date": "2026-08-01", "poi_id": "poi-1"}, "poi_name": "감천문화마을",
             "category": "SIGHT", "order_in_day": 1, "photo_count": 3},
            {"ref": {"date": "2026-08-02", "poi_id": "poi-2"}, "poi_name": "해운대",
             "category": "NATURE", "order_in_day": 1, "photo_count": 0},
        ],
        "events": [{"kind": "PLAN_B", "date": "2026-08-01", "detail": "휴무로 코스 변경"}],
        "persona_summary": "느긋한 일정 선호",
        "weather_summary": "이틀 다 맑음",
    }


def _nudge_request() -> dict:
    return {
        "request_meta": _meta(),
        "destination": "부산",
        "trip_days": 2,  # 와이어 필드명에 duration 토큰 금지 (INV-3 계약 가드)
        "persona_summary": "느긋한 일정 선호",
        "highlight_places": ["해운대"],
    }


def _assert_no_banned_tokens(raw_text: str) -> None:
    lowered = raw_text.lower()
    for token in _BANNED_TOKENS:
        assert token not in lowered, f"INV-3 금칙 토큰 유출: {token}"


# ── ① UnwiredLlm — 폴백 200 + 계약 키 + INV-3 ────────────────


def test_generate_unwired_llm_returns_200_fallback_with_contract_keys() -> None:
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        res = client.post(_GEN_URL, json=_gen_request())
        assert res.status_code == 200  # 5xx 아님 — 정직 강등 (INV-4)
        body = res.json()
        assert body["is_fallback"] is True
        assert set(body) == _CONTRACT_KEYS  # 계약 §3 — 초과·누락 키 0
        assert body["kind"] == "TRIP_SUMMARY" and body["format"] == "CARD_NEWS"
        # 봉투 하위 키도 계약 §3 밖 키 금지 (시각·순서 필드 부재)
        assert {"title", "subtitle"} <= set(body["cover"]) <= {"title", "subtitle", "photo_slot"}
        for scene in body["scenes"]:
            assert {"layout", "caption"} <= set(scene) <= {
                "layout", "caption", "photo_slot", "source_event"}
        _assert_no_banned_tokens(res.text)  # INV-3 — 응답 원문 전체 스캔


def test_generate_unwired_llm_is_deterministic() -> None:
    """같은 요청 두 번 → 같은 폴백 응답 (고정 템플릿·requested_at 주입 — wall-clock 0)."""
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        first = client.post(_GEN_URL, json=_gen_request())
        second = client.post(_GEN_URL, json=_gen_request())
        assert first.status_code == second.status_code == 200
        assert first.json() == second.json()


def test_nudge_unwired_llm_returns_deterministic_default_message() -> None:
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        res = client.post(_NUDGE_URL, json=_nudge_request())
        assert res.status_code == 200
        body = res.json()
        assert body == {"message": FALLBACK_NUDGE_MESSAGE, "is_fallback": True}
        # 결정론 — 재호출 동일
        assert client.post(_NUDGE_URL, json=_nudge_request()).json() == body
        _assert_no_banned_tokens(res.text)


# ── ② 스크립트 LLM — 성공 경로 200 + scenes 실림 ─────────────

# 요청(_gen_request) 방문 기록과 정합하는 위반 0 템플릿 — 조기 종료 1회 채택
_CANNED_BODY = {
    "cover": {
        "title": "이틀의 기록",
        "subtitle": "{region} · {start_date}~{end_date}",
        "photo_slot": {"visit_ref": {"date": "2026-08-01", "poi_id": "poi-1"}},
    },
    "scenes": [
        {"layout": "PHOTO_FULL",
         "photo_slot": {"visit_ref": {"date": "2026-08-01", "poi_id": "poi-1"}},
         "caption": "첫날은 {poi:0.name}부터"},
        {"layout": "STATS", "caption": "{visit_count}곳 · {distance_km}km"},
        {"layout": "MAP", "caption": "우리가 지나온 길"},
    ],
    "hashtags": ["#부산여행"],
}


def test_generate_scripted_llm_returns_template_with_scenes() -> None:
    canned = json.dumps({"template": _CANNED_BODY}, ensure_ascii=False)
    app = build_dev_app(llm=FakeLlm(canned=canned), model_id="m-fake")
    with TestClient(app, raise_server_exceptions=False) as client:
        res = client.post(_GEN_URL, json=_gen_request())
        assert res.status_code == 200
        body = res.json()
        assert body["is_fallback"] is False
        assert set(body) == _CONTRACT_KEYS
        assert [s["layout"] for s in body["scenes"]] == ["PHOTO_FULL", "STATS", "MAP"]
        assert body["hashtags"] == ["#부산여행"]
        # INV-1 사영 — 장면·표지 참조 전부 요청 방문 기록 내
        allowed = {("2026-08-01", "poi-1"), ("2026-08-02", "poi-2")}
        slots = [s["photo_slot"] for s in body["scenes"] if s.get("photo_slot")]
        if body["cover"].get("photo_slot"):
            slots.append(body["cover"]["photo_slot"])
        assert all(
            (s["visit_ref"]["date"], s["visit_ref"]["poi_id"]) in allowed for s in slots
        )
        _assert_no_banned_tokens(res.text)


# ── ③·④ — 미배선 503 · 경계 검증 422 ────────────────────────


def test_unwired_orchestrator_returns_503_not_silence() -> None:
    with TestClient(create_app(), raise_server_exceptions=False) as client:
        assert client.post(_GEN_URL, json=_gen_request()).status_code == 503
        assert client.post(_NUDGE_URL, json=_nudge_request()).status_code == 503


def test_generate_rejects_zero_visits_at_boundary() -> None:
    request = _gen_request()
    request["visits"] = []  # BR-U6R-15 — 방문 0건은 진입 불가
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        assert client.post(_GEN_URL, json=request).status_code == 422
