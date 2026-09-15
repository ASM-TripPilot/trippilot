"""재계획 경계 (`POST /ai/v1/itinerary/replan`) — 계약과 명시 실패.

정본: `backend/docs/design/ai-backend-replan-연동-설계.md` §4·§5 (A-4).

증명하는 것 (실 LLM·실 벡터·실 DB 0):
  ① 조립이 이 경계를 구현하지 않으면 **503 명시 실패** — 빈 일정 200 으로 위장하지 않는다
  ② 조립이 구현하면 요청이 **그대로** 넘어가고 응답이 사영된다
  ③ `free_text` 상한 500 — DB(`replan_session.free_text varchar(500)`)와 같은 값
  ④ `scope` 는 닫힌 두 값만
  ⑤ 응답에 소요시간 계열 필드가 없다 (INV-3)
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from trippilot.api import schemas
from trippilot.api.app import create_app
from trippilot.api.routes import get_orchestrator


def _body(**over: object) -> dict:
    body: dict = {
        "trip_id": "trip-a4",
        "trip_context": {
            "destinations": ["제주"],
            "start_date": "2026-09-20",
            "end_date": "2026-09-22",
        },
        "target_date": "2026-09-21",
        "time_window": {"date": "2026-09-21", "start": "09:00", "end": "21:00"},
        "anchor": {"lat": 33.45, "lng": 126.56},
        "scope": "FULL_DAY",
        "from_instant": "2026-09-21T14:00:00+09:00",
        "locked_blocks": [],
        "current_slots": [
            {
                "poi_id": "poi-1",
                "start_at": "10:00",
                "end_at": "11:30",
                "placement_reason": "아침에 한적해서",
            }
        ],
        "reasons": ["weather"],
        "directives": ["INDOOR"],
        "free_text": "비 와서 실내로 바꿔줘",
        "preference_profile": {},
        "transport_mode": "대중교통",
        "saved_places": [],
        "excluded_poi_ids": [],
        "request_meta": {
            "request_id": "replan-a4-test",
            "requested_at": "2026-09-21T14:00:00+09:00",
            "deadline_ms": 25000,
        },
    }
    body.update(over)
    return body


# ── ① 미배선 = 503 (INV-4) ───────────────────────────────────────────


class _OldAssembly:
    """`replan` 을 모르는 구형 조립 — 다른 경계는 다 있다.

    `create_app()`(조립 자체가 미주입)으로 이걸 검증하면 **의존성 단계에서 먼저 503**
    이 나서 라우트의 가드가 실행되지도 않는다. 실제로 그렇게 짰다가 역검증에서
    걸렸다 — 라우트를 200 반환으로 망가뜨려도 테스트가 초록이었다.
    """

    def generate(self, request: object) -> object:  # pragma: no cover - 호출되지 않는다
        raise AssertionError("이 테스트는 replan 만 본다")


def test_assembly_without_replan_fails_loudly_instead_of_pretending_no_candidates() -> None:
    """조립이 이 경계를 구현하지 않으면 503 이다 — 200 + 빈 일정이 **아니다**.

    `empty_reason` 으로 위장하면 "후보가 없다"와 "배선이 없다"가 같은 응답이 되고,
    백엔드는 폴백 여부를 잘못 판정한다(자기 로컬 후보로 내려갈지, 오류로 올릴지).
    """
    app = create_app()
    app.dependency_overrides[get_orchestrator] = _OldAssembly

    res = TestClient(app).post("/ai/v1/itinerary/replan", json=_body())

    assert res.status_code == 503
    assert "itinerary" not in res.json()  # 빈 산출물로 위장하지 않는다


# ── ② 배선되면 그대로 위임 ───────────────────────────────────────────


class _WiredOrchestrator:
    """`replan` 만 구현한 최소 조립 — 라우트가 위임만 하는지 본다."""

    def __init__(self) -> None:
        self.seen: schemas.ReplanRequest | None = None

    def replan(self, request: schemas.ReplanRequest) -> schemas.ReplanResponse:
        self.seen = request
        return schemas.ReplanResponse(
            is_fallback=True,
            fallback_level=1,
            notes=["규칙 랭킹"],
            resolved_directives=["INDOOR"],
            unknown_directives=["NOPE"],
            empty_reason=schemas.ReplanEmptyReasonSchema(
                code="NO_CANDIDATE", params={"from": "17:00", "filter": "INDOOR"}
            ),
        )


def _wired() -> tuple[TestClient, _WiredOrchestrator]:
    app, orch = create_app(), _WiredOrchestrator()
    app.dependency_overrides[get_orchestrator] = lambda: orch
    return TestClient(app), orch


def test_request_reaches_the_assembly_unchanged() -> None:
    """라우트는 판단하지 않는다 — 재계획 의도 3종이 손실 없이 넘어가야 한다.

    `reasons`·`directives`·`free_text` 가 여기서 떨어지면 이 경계를 새로 만든 이유가
    사라진다(정본 §1 ③ — `generate` 재사용이 재계획 의도를 통째로 버렸다).
    """
    client, orch = _wired()

    client.post("/ai/v1/itinerary/replan", json=_body())

    assert orch.seen is not None
    assert orch.seen.reasons == ["weather"]
    assert orch.seen.directives == ["INDOOR"]
    assert orch.seen.free_text == "비 와서 실내로 바꿔줘"
    # 원 일정은 컨텍스트이자 후보 풀 합류 대상 — 추천 이유까지 따라와야 한다
    assert orch.seen.current_slots[0].placement_reason == "아침에 한적해서"


def test_unknown_directives_come_back_instead_of_disappearing() -> None:
    """모르는 지시를 **조용히 무시하지 않는다** — FE 가 알릴 수 있어야 한다."""
    client, _ = _wired()

    body = client.post("/ai/v1/itinerary/replan", json=_body()).json()

    assert body["unknown_directives"] == ["NOPE"]
    assert body["empty_reason"] == {
        "code": "NO_CANDIDATE",
        "params": {"from": "17:00", "filter": "INDOOR"},
    }


# ── ③④ 계약 경계값 ──────────────────────────────────────────────────


def test_free_text_limit_matches_the_column_it_is_stored_in() -> None:
    """상한 500 은 `replan_session.free_text varchar(500)` 과 같은 값이다.

    계약이 DB 보다 넓으면 저장에서 잘리고, 좁으면 저장된 값이 경계에서 거부된다.
    """
    client, _ = _wired()

    assert client.post("/ai/v1/itinerary/replan", json=_body(free_text="가" * 500)).status_code == 200
    assert client.post("/ai/v1/itinerary/replan", json=_body(free_text="가" * 501)).status_code == 422


def test_scope_is_a_closed_set() -> None:
    """`scope` 는 두 값뿐 — 자유 문자열이면 백엔드 오타가 조용히 통과한다."""
    client, _ = _wired()

    assert client.post("/ai/v1/itinerary/replan", json=_body(scope="PARTIAL_SLOTS")).status_code == 200
    assert client.post("/ai/v1/itinerary/replan", json=_body(scope="ALL")).status_code == 422


# ── ⑤ INV-3 ──────────────────────────────────────────────────────────


def test_response_carries_no_duration_field() -> None:
    """소요시간은 어느 경로로도 나가지 않는다 (INV-3) — 거리만."""
    raw = TestClient(create_app()).get("/openapi.json").json()
    replan_res = raw["components"]["schemas"]["ReplanResponse"]["properties"]

    assert "duration" not in str(replan_res).lower()
    assert "total_distance_km" in replan_res


# ── 이동수단 (후보 풀 반경) ───────────────────────────────────────────


def test_transport_mode_reaches_the_assembly_because_it_sets_the_pool_radius() -> None:
    """이동수단이 없으면 **후보 풀 반경이 틀린다** — 조용히 틀린다.

    `pool_builder` 가 `radius_km[transport]` 로 반경을 잡는데 도보 2km · 대중교통
    10km · 자차 20km 다(`poi_curation/config.py`). 이 필드가 계약에 없으면 배선이
    기본값(대중교통)으로 메우고, **도보 여행자에게 10km 밖 후보**가 간다 — 오류도
    로그도 없이 "제안은 나왔는데 갈 수 없는 곳"이 된다.

    `alternatives` 는 이 필드를 갖고 있었는데 `/replan` 초판에서 빠졌다(2026-09-16 발견).
    """
    client, orch = _wired()

    client.post("/ai/v1/itinerary/replan", json=_body(transport_mode="도보"))

    assert orch.seen is not None
    assert orch.seen.transport_mode == "도보"


def test_transport_mode_is_optional_so_older_callers_keep_working() -> None:
    """후미 선택 필드 — 백엔드가 아직 안 보내도 계약이 깨지지 않는다.

    다만 `None` 이 "대중교통"을 뜻하지는 **않는다**. 값을 못 받은 것과 대중교통을
    고른 것은 다른 사실이고, 배선이 기본값을 쓸 때 그 사실을 남겨야 한다.
    """
    client, orch = _wired()

    body = _body()
    del body["transport_mode"]
    assert client.post("/ai/v1/itinerary/replan", json=body).status_code == 200
    assert orch.seen is not None and orch.seen.transport_mode is None
