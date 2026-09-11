"""j06 공유 카드 경계 관통 (TRIP-429 후속): `POST /ai/v1/reflection/share-card`.

TestClient + build_dev_app 실조립(경계→wiring→워커→게이트웨이) 관통 —
실 LLM·외부 API 호출 0 (D37). 증명하는 것:

  ① UnwiredLlm(기본 조립): **200 + is_fallback=true** (5xx 아님 — INV-4 정직 강등)
     ∧ 응답 키 집합 = 계약 3키 ∧ 응답 원문에 duration류 금칙 토큰 부재(INV-3)
     ∧ 결정론(같은 요청 두 번 = 같은 응답) — 폴백 문구는 FE가 지금 쓰던 모양 그대로
  ② 스크립트 LLM(유효 JSON): 200 + is_fallback=false + 캡션·해시태그 실림
  ③ LLM 실패 시 경계가 **정적 폴백**으로 수렴하고 FallbackEvent가 남는다
     (직행 패턴의 방어 분기는 component="api.wiring" — U6 Reflect FD §2.1 관측 규칙)
  ④ 미배선 조립(create_app 단독): 503 명시 실패 — 침묵 금지
  ⑤ visits 0건은 경계 422 (요청 스키마를 `/generate`와 공유한다는 사실의 사영)
  ⑥ 응답 스키마가 커밋된 openapi 계약과 같은 키를 쓴다

**기존 `/generate`·`/nudge` 응답은 건드리지 않는다** — 새 경로 추가뿐이다.
"""

from __future__ import annotations

import json
from datetime import timezone

from fastapi.testclient import TestClient

from trippilot.api.app import create_app
from trippilot.api import schemas
from trippilot.api.wiring import (
    StaticPersonaStore,
    StaticPoiDb,
    build_dev_app,
    build_orchestrator,
    demo_poi_seed,
)
from trippilot.llm_gateway.config import C1Config
from trippilot.domain.common import BudgetLevel
from trippilot.domain.llm import ModelTier, TypedResult
from trippilot.domain.observability import FallbackEvent
from trippilot.domain.persona import CompanionType, PersonaSummary

from tests.fakes.fake_llm import FailingLlm, FakeLlm, TimeoutForModelsLlm
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.test_api_openapi_contract import CONTRACT_PATH

_URL = "/ai/v1/reflection/share-card"

# 계약 — ShareCardCopy.to_dict() 키 (시각·순서·duration 필드 자체가 없다)
_CONTRACT_KEYS = {"caption", "hashtags", "is_fallback"}
_BANNED_TOKENS = ("duration", "minutes", "stay_min", "dwell_min", "travel_time", "elapsed")


def _request() -> dict:
    """`/generate`와 **같은 스키마** — 백엔드가 회고 생성과 같은 재료를 보내면 된다."""
    return {
        "request_meta": {
            "request_id": "req-share-429",
            "requested_at": "2026-08-20T09:00:00+09:00",
        },
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


def _assert_no_banned_tokens(raw_text: str) -> None:
    lowered = raw_text.lower()
    for token in _BANNED_TOKENS:
        assert token not in lowered, f"INV-3 금칙 토큰 유출: {token}"


# ── ① UnwiredLlm — 정적 폴백 200 + 계약 키 + INV-3 ──────────


def test_unwired_llm_returns_200_static_fallback() -> None:
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        res = client.post(_URL, json=_request())
        assert res.status_code == 200  # 5xx 아님 — 정직 강등 (INV-4)
        body = res.json()
        assert set(body) == _CONTRACT_KEYS  # 초과·누락 키 0
        assert body["is_fallback"] is True
        # FE가 지금 기계 조립하던 모양 그대로 — 폴백이 곧 종전 동작이다
        assert body["caption"] == "부산 여행의 기록"
        assert body["hashtags"] == ["#부산여행"]
        _assert_no_banned_tokens(res.text)


def test_unwired_llm_is_deterministic() -> None:
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        first = client.post(_URL, json=_request())
        second = client.post(_URL, json=_request())
        assert first.status_code == second.status_code == 200
        assert first.json() == second.json()


# ── ② 스크립트 LLM — 성공 경로 200 ───────────────────────────

_CANNED = json.dumps(
    {
        "share_card": {
            "caption": "{region}에서 보낸 이틀, 감천문화마을 골목이 오래 남습니다.",
            "hashtags": ["#부산여행", "#감천문화마을"],
            "places": ["감천문화마을"],
        }
    },
    ensure_ascii=False,
)


def test_scripted_llm_returns_llm_copy() -> None:
    app = build_dev_app(llm=FakeLlm(canned=_CANNED), model_id="m-fake")
    with TestClient(app, raise_server_exceptions=False) as client:
        res = client.post(_URL, json=_request())
        assert res.status_code == 200
        body = res.json()
        assert set(body) == _CONTRACT_KEYS
        assert body["is_fallback"] is False
        assert body["caption"].startswith("{region}에서 보낸 이틀")
        assert body["hashtags"] == ["#부산여행", "#감천문화마을"]
        _assert_no_banned_tokens(res.text)


def test_scripted_llm_violation_converges_to_static_fallback() -> None:
    """게이트 전량 탈락도 정적 폴백 200 — 침묵하지 않고 is_fallback으로 드러낸다."""
    bad = json.dumps(
        {"share_card": {"caption": "30분 만에 닿은 바다", "hashtags": []}},
        ensure_ascii=False,
    )
    app = build_dev_app(llm=FakeLlm(canned=bad), model_id="m-fake")
    with TestClient(app, raise_server_exceptions=False) as client:
        body = client.post(_URL, json=_request()).json()
        assert body["is_fallback"] is True and body["caption"] == "부산 여행의 기록"


# ── ③ 폴백 계측 — FallbackEvent 발행 ─────────────────────────


def _wired(llm, trace: InMemoryTrace):
    return build_orchestrator(
        llm=llm,
        poi_db=StaticPoiDb(demo_poi_seed()),
        context_store=StaticPersonaStore(
            PersonaSummary(taste_tags=(), companion=CompanionType.SOLO,
                           budget=BudgetLevel.MID)
        ),
        c1_config=C1Config(
            model_ids={ModelTier.LIGHT: "m-l", ModelTier.HEAVY: "m-h"}),
        trace=trace,
        tz=timezone.utc,
    )


def test_llm_failure_emits_fallback_event_and_static_copy() -> None:
    trace = InMemoryTrace()
    response = _wired(FailingLlm(), trace).reflection_share_card(
        schemas.ReflectionGenerateRequest(**_request())
    )
    assert response.is_fallback is True and response.caption == "부산 여행의 기록"
    modes = {(e.from_mode, e.to_mode) for e in trace.of_type(FallbackEvent)}
    assert ("llm_share_card", "static_copy") in modes


def test_empty_value_without_fallback_flag_is_reported_by_the_boundary() -> None:
    """방어 분기 — 게이트 완화 시 계측 없는 침묵 폴백이 되지 않게 경계가 발행한다.

    직행 패턴의 발행 주체는 경계다: component는 "api.wiring" (FD §2.1 관측 규칙) —
    에이전트 이름을 지어 붙이면 거짓 관측이 된다.
    """

    class _EmptyWorker:
        def generate(self, request, trace_id, now, *, timeout_sec=None) -> TypedResult:
            return TypedResult(
                value=None, is_fallback=False, error=None, call_record=None)

    trace = InMemoryTrace()
    orchestrator = _wired(FakeLlm(canned=_CANNED), trace)
    orchestrator._share_card_worker = _EmptyWorker()

    response = orchestrator.reflection_share_card(
        schemas.ReflectionGenerateRequest(**_request())
    )

    assert response.is_fallback is True and response.caption == "부산 여행의 기록"
    events = [
        e for e in trace.of_type(FallbackEvent) if e.component == "api.wiring"
    ]
    assert len(events) == 1
    assert events[0].stage == "agent"
    assert (events[0].from_mode, events[0].to_mode) == ("llm_share_card", "static_copy")


def test_request_deadline_is_passed_through_to_the_llm_call() -> None:
    """`/generate`와 같은 스키마의 같은 필드를 한 경계만 쓰면 예산이 조용히 버려진다.

    `deadline_ms` 가 실리는 순간 이 경계만 C1Config 기본 타임아웃으로 도는 것을 막는다
    (TRIP-522와 같은 함정 — 마감을 넘기는 쪽이 보이지 않는다).
    """
    llm = TimeoutForModelsLlm(_CANNED)  # 타임아웃 모델 0 — 받은 요청만 기록한다
    request = _request()
    request["request_meta"]["deadline_ms"] = 4000

    _wired(llm, InMemoryTrace()).reflection_share_card(
        schemas.ReflectionGenerateRequest(**request)
    )

    assert len(llm.requests) == 1
    assert llm.requests[0].timeout_sec == 4.0  # 4000ms 관통 (기본 10.0 아님)


# ── ④⑤⑥ 미배선 503 · 경계 검증 422 · 계약 대조 ─────────────


def test_unwired_orchestrator_returns_503_not_silence() -> None:
    with TestClient(create_app(), raise_server_exceptions=False) as client:
        assert client.post(_URL, json=_request()).status_code == 503


def test_rejects_zero_visits_at_boundary() -> None:
    request = _request()
    request["visits"] = []  # BR-U6R-15 — 방문 0건은 진입 불가
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        assert client.post(_URL, json=request).status_code == 422


def test_response_keys_match_committed_openapi_contract() -> None:
    """응답 스키마가 와이어 정본(`ai/docs/openapi.json`)과 같은 키를 쓴다."""
    doc = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    schema = doc["components"]["schemas"]["ShareCardCopyResponse"]
    assert set(schema["properties"]) == _CONTRACT_KEYS
    # 요청은 `/generate`와 같은 스키마를 재사용한다 (새 요청 타입 없음)
    ref = doc["paths"][_URL]["post"]["requestBody"]["content"]["application/json"]
    assert ref["schema"]["$ref"].endswith("/ReflectionGenerateRequest")
