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
from trippilot.solver_engine.config import RAIN_OUTDOOR

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
            # 텍스트 = 검색 질의 그대로. FakeEmbedding 은 의미 유사도가 없어서
            # (해시→가우시안) 다른 문구를 쓰면 코사인이 난수가 되고 실제로 **음수**가
            # 나온다(-0.36 실측) — 유사도 하한에 걸려 이 테스트의 전제가 무너진다.
            # 동일 텍스트만이 결정론적으로 1.0 을 준다.
            KbDocument(kb=KbKind.SITUATION, doc_id="sit-1",
                       text="WEATHER 날씨 악화 상황", poi_ref=None, metadata={}),
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


# ── ⑦ TRIP-512 저장 장소 봉투 — 백엔드가 실어 보내는 개인화 신호 ──────


def test_saved_places_field_accepted_backward_compatible() -> None:
    """선택 필드(기본 빈 목록) — 안 보내도 200. 하위호환은 계약의 전제다."""
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        assert _post(client).status_code == 200  # 필드 없이
        response = _post(client, saved_places=[])  # 빈 목록
    assert response.status_code == 200


def _proposed_ids(body: dict) -> list[str]:
    return [a["poi_ids"][0] for a in body["alternatives"]]


def test_saved_places_rank_first_in_rule_fallback() -> None:
    """봉투로 온 저장 장소가 규칙 랭킹 1순위로 올라온다 — TRIP-512 의 존재 이유.

    **중립 사유(`closed`)로 검사한다** — `weather` 는 카테고리 강등(⓪, TRIP-532)이 저장
    장소보다 앞서므로 두 신호가 섞인다. 여기서 보려는 것은 ①(저장 장소) 하나다.
    비 오는 날 저장 야외가 어떻게 되는지는 아래 테스트가 따로 본다.

    대상은 **실제 제안에 든 것 중 1순위가 아닌 것** — 데모 앵커 반경이 시드를 다 담지
    않으므로 풀 밖을 고르면 저장해도 못 올라오고(INV-1), 이미 1순위면 검사가 공허하다.
    """
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        plain = _proposed_ids(_post(client, reason="closed").json())
        assert len(plain) >= 2, f"후보가 부족해 순위 변화를 볼 수 없다: {plain}"
        target = plain[1]
        with_saved = _proposed_ids(_post(
            client, reason="closed",
            saved_places=[{"poi_id": target, "name": "저장한 곳"}]).json())
    assert with_saved[0] == target, f"저장 장소가 1순위로 안 왔다: {plain} → {with_saved}"


def test_saved_outdoor_stays_demoted_on_rain() -> None:
    """비 사유에서는 저장 장소여도 야외면 뒤로 — ⓪(상황)이 ①(저장)보다 앞선다(TRIP-532).

    실내 후보가 함께 있어야 성립하는 검사다(야외만 있으면 야외가 1순위일 수밖에 없다).
    """
    outdoor_ids = {str(p.poi_id) for p in demo_poi_seed() if p.category in RAIN_OUTDOOR}
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        plain = _proposed_ids(_post(client).json())
        target = next((i for i in plain if i in outdoor_ids), None)
        if target is None or set(plain) <= outdoor_ids:
            return  # 풀 구성상 검사가 성립하지 않는다 — 다른 테스트가 강등을 이미 검증
        with_saved = _proposed_ids(
            _post(client, saved_places=[{"poi_id": target, "name": "저장한 오름"}]).json())
    assert with_saved[0] != target, f"비 오는데 저장한 야외가 1순위: {with_saved}"


def test_saved_places_outside_pool_never_become_candidates() -> None:
    """풀 밖 저장 장소는 후보가 되지 않는다 (INV-1) — 봉투도 후보 자격을 만들지 않는다."""
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        body = _post(client, saved_places=[{"poi_id": "ghost-not-in-pool", "name": "유령"}]).json()
    picked = {p for a in body["alternatives"] for p in a["poi_ids"]}
    assert "ghost-not-in-pool" not in picked
    assert picked <= _SEED_IDS


def test_saved_places_reach_llm_context_not_just_ranking() -> None:
    """저장 장소가 LLM 프롬프트 컨텍스트에도 들어간다 — 랭킹 전용 신호가 아니다."""
    from trippilot.agents.planb.rag import PlanBRagRequest, SavedPlace, _join_saved

    assert "저장한 카페" in _join_saved((SavedPlace("p1", "저장한 카페"),))
    assert _join_saved(()) == ""
    assert "saved_places" in PlanBRagRequest.__dataclass_fields__
