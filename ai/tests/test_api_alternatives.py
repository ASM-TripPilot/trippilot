"""TRIP-428 — Plan-B 대안 제안 경계 (`POST /ai/v1/itinerary/alternatives`).

증명하는 것 (실 LLM·실 벡터·실 DB 0 — D37):
  ① 기본 조립(build_dev_app: UnwiredLlm·Unwired 벡터) — 데모 시드 앵커 요청이
     200 + 규칙 랭킹 폴백(fallback_level 1) + 시드 poi_id만 제안(INV-1),
     notes에 검색 강등 사유가 남는다(침묵 금지)
  ② 후보 0(반경 밖 앵커) — 대안 0 + empty_reason 정직 보고, 임의 대체 없음
  ③ excluded_poi_ids — 제외한 POI는 제안에 없다
  ④ INV-2·3 — 응답 원문에 시각·순서·duration 계열 필드 없음
  ⑤ 벡터 실주입(인메모리+해시 fake) — 상황 KB 문서가 retrieved에 잡힌다
  ⑥ 미주입 앱(create_app) — 503 명시 실패(INV-4)
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from tests.fakes.fake_embedding import FakeEmbedding
from tests.fakes.in_memory_vector_store import InMemoryVectorStore
from trippilot.agents.planb.kb_retrieval import index_documents
from trippilot.api.app import create_app
from trippilot.api.wiring import DEMO_ANCHOR, build_dev_app, demo_poi_seed
from trippilot.domain.kb import KbDocument, KbKind

_SEED_IDS = {str(p.poi_id) for p in demo_poi_seed()}


def _request_body(**over: object) -> dict:
    body = {
        "trigger": {
            "kind": "WEATHER",
            "schedule_id": "sched-428",
            "affected_date": "2026-09-01",
            "payload": {},
        },
        "reason": "weather",
        "anchor": {"lat": DEMO_ANCHOR.lat, "lng": DEMO_ANCHOR.lng},
        "dates": ["2026-09-01"],
        "budget_level": "중간",
        "transport_mode": "대중교통",
        "excluded_poi_ids": [],
        "request_meta": {
            "request_id": "alt-428-test",
            "requested_at": "2026-09-01T08:00:00+09:00",
            "deadline_ms": 5000,
        },
    }
    body.update(over)
    return body


def _post(client: TestClient, **over: object):
    return client.post("/ai/v1/itinerary/alternatives", json=_request_body(**over))


# ── ①~④ 기본 조립 (Unwired 벡터·LLM — 규칙 랭킹 강등 경로) ──────────


def test_default_assembly_returns_rule_ranked_seed_alternatives() -> None:
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        response = _post(client)
    assert response.status_code == 200
    body = response.json()
    assert body["pool_size"] > 0
    assert body["alternatives"], body
    assert body["is_fallback"] is True and body["fallback_level"] == 1  # 규칙 랭킹
    picked = {p for a in body["alternatives"] for p in a["poi_ids"]}
    assert picked <= _SEED_IDS  # INV-1 — 데모 시드 밖 poi_id 없음
    # 벡터 미배선은 침묵하지 않는다 — 검색 강등 사유가 notes에 남는다
    assert any("retrieve" in n for n in body["notes"]), body["notes"]


def test_empty_pool_reports_no_candidates_without_inventing() -> None:
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        response = _post(client, anchor={"lat": 37.4846, "lng": 130.9057})  # 울릉도
    assert response.status_code == 200
    body = response.json()
    assert body["pool_size"] == 0 and body["alternatives"] == []
    assert body["fallback_level"] == 2
    assert body["empty_reason"] == "no_candidates"


def test_excluded_poi_ids_never_proposed() -> None:
    excluded = sorted(_SEED_IDS)[:2]
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        response = _post(client, excluded_poi_ids=excluded)
    assert response.status_code == 200
    picked = {p for a in response.json()["alternatives"] for p in a["poi_ids"]}
    assert picked.isdisjoint(excluded)


def test_response_carries_no_time_or_duration_fields() -> None:
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        response = _post(client)
    raw = response.text.lower()
    for banned in ("duration", "start_at", "end_at", "eta"):
        assert banned not in raw, f"응답에 {banned} 노출 (INV-2·3)"


def test_affected_reasons_field_accepted_backward_compatible() -> None:
    """TRIP-516 — 선택 필드 affected_reasons 수용 (미배선 경로에서도 200, 회귀 0)."""
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        response = _post(client, affected_reasons={
            next(iter(_SEED_IDS)): "조용한 카페라 추천했던 곳"})
    assert response.status_code == 200
    assert response.json()["pool_size"] > 0


# ── ⑤ 벡터 실주입 — 상황 KB가 검색 컨텍스트로 잡힌다 ─────────────────


def test_injected_vector_store_feeds_situation_retrieval() -> None:
    embedding, store = FakeEmbedding(dim=32), InMemoryVectorStore()
    index_documents(
        (
            KbDocument(kb=KbKind.SITUATION, doc_id="sit-1",
                       text="우천 시 실내 대안 우선", poi_ref=None, metadata={}),
        ),
        embedding, store,
    )
    app = build_dev_app(vector_store=store, embedding=embedding)
    with TestClient(app, raise_server_exceptions=False) as client:
        response = _post(client)
    body = response.json()
    assert response.status_code == 200
    assert body["retrieved"]["SITUATION"] == 1  # KB 문서가 검색됐다
    assert not any("retrieve" in n for n in body["notes"])  # 검색 강등 없음


# ── ⑥ 미주입 앱 — 503 명시 실패 ──────────────────────────────────────


def test_unwired_app_fails_loudly() -> None:
    with TestClient(create_app(), raise_server_exceptions=False) as client:
        response = _post(client)
    assert response.status_code == 503
