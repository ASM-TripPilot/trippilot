"""U5-05 — 경계 E2E 관통 테스트 (TRIP-241).

FastAPI TestClient + **실 오케스트레이터·실 M7·실 C1·실 C2** + fake 어댑터(LLM·POI DB·
페르소나 저장소·시계·트레이스)로 전 구간을 관통한다 — 실 LLM·외부 API 호출 0 (D37).

    HTTP 요청(백엔드 Jackson 형태) → routes → wiring 어댑터 → ItineraryOrchestrator
    → M7 후보풀 → C1 점수·설명 → C2 솔버 → 응답 JSON

증명하는 것:
  ① 생성 관통: 200 + 유효 일정(슬롯 ⊆ 후보풀 INV-1 · 시간순 INV-2 · INV-3 필드 부재),
     그리고 그 응답을 **validate 라우트에 되먹여** HC 위반 0을 HTTP로 확인
  ② day1 2단계(TRIP-293): 1차(day1·5000ms) 배정 POI를 2차 excluded로 → 병합 중복 0
  ③ 폴백 관통(INV-4): LLM 전면 실패여도 200(5xx 아님 — PR #104), 체인 강등까지 겹치면
     200 + is_fallback=true
  ④ validate·repair 관통: 위반 일정 → 위반 목록(day_index 포함) → repair 수리 후
     재검증 위반 0, 수리 불가는 200 + repaired=null(IO-7)
  ⑤ 에러 계약: 모순 고정블록 409 · 잘못된 스키마/조립 불가 입력 422
  ⑥ 로컬 스모크 조립(main.py 경로): build_dev_app이 fake만으로 200을 낸다
"""

from __future__ import annotations

import json
import uuid
from datetime import date

from fastapi.testclient import TestClient

from trippilot.api.app import create_app
from trippilot.api.wiring import build_dev_app, build_orchestrator, DEMO_ANCHOR
from trippilot.llm_gateway.config import C1Config
from trippilot.solver_engine.config import SolverConfig
from trippilot.domain.common import BudgetLevel, GeoPoint
from trippilot.domain.llm import ModelTier
from trippilot.domain.persona import CompanionType, PersonaSummary, TasteTag
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.ports.llm_port import LlmRequest, LlmResponse

from tests.fakes.fake_clock import FakeClock
from tests.fakes.fake_llm import FailingLlm
from tests.fakes.in_memory_poi import InMemoryPoi
from tests.fakes.in_memory_trace import InMemoryTrace

_DAY1 = date(2026, 8, 5)
_DAY2 = date(2026, 8, 6)
_ANCHOR = GeoPoint(37.751, 128.876)
_PERSONA = PersonaSummary(
    taste_tags=(TasteTag.NATURE,), companion=CompanionType.SOLO, budget=BudgetLevel.MID
)
_C1CFG = C1Config(model_ids={ModelTier.LIGHT: "m-light", ModelTier.HEAVY: "m-heavy"})

# INV-3/IO-3 — 응답 JSON 어디에도 나가면 안 되는 토큰(기존 계약 테스트와 동일 목록).
_BANNED_TOKENS = ("duration", "minutes", "stay_min", "dwell_min", "internal_",
                  "travel_time", "elapsed", "is_llm_score", "score")


# ── fake 어댑터 ──────────────────────────────────────────────────────


def _poi(i: int, off: float = 0.0) -> Poi:
    return Poi(
        poi_id=f"p{i}",
        name=f"POI{i}",
        category=PoiCategory.SIGHT,
        coord=GeoPoint(_ANCHOR.lat + off, _ANCHOR.lng + off),
        open_hours=(),  # 정보 없음 → HC1 미적용
        avg_cost=None,
        rating=4.0,
        quality=DataQuality.FULL,
        source=PoiSource.SEED,
        confidence=None,
    )


_POIS = tuple(_poi(i, 0.005 * (i - 1)) for i in range(1, 7))  # p1..p6, 반경 안
_POOL_IDS = {f"p{i}" for i in range(1, 7)}


def _scores_json(*ids: str) -> str:
    return json.dumps(
        {"scores": [{"poiId": i, "score": 0.9, "reason": "r"} for i in ids]}
    )


def _explanations_json(*ids: str) -> str:
    return json.dumps(
        {"explanations": [{"poiId": i, "text": "취향에 맞는 조용한 곳이라"} for i in ids]}
    )


class RoutingLlm:
    """feature별 canned 응답 — 프롬프트 내용으로 분기 (결정론, 실 호출 0, D37).

    설명 프롬프트(prompts/explanation.yaml)에만 "추천 이유" 문구가 있다.
    """

    def __init__(self, scores: str, explanations: str) -> None:
        self._scores = scores
        self._explanations = explanations

    def invoke(self, request: LlmRequest) -> LlmResponse:
        text = self._explanations if "추천 이유" in request.prompt else self._scores
        return LlmResponse(
            raw_text=text,
            input_tokens=len(request.prompt),
            output_tokens=len(text),
            latency_ms=1,
            model_id=request.model_id,
        )


class _PersonaStore:
    def get(self, ref):  # noqa: ANN001 — ContextStore 구조 계약
        return _PERSONA


def make_client(
    *,
    llm: object | None = None,
    pois: tuple[Poi, ...] = _POIS,
    solver_config: SolverConfig | None = None,
) -> TestClient:
    """실 조립(build_orchestrator) + fake 어댑터 — 테스트 공용 진입점."""
    ids = tuple(str(p.poi_id) for p in pois)
    orchestrator = build_orchestrator(
        llm=llm if llm is not None
        else RoutingLlm(_scores_json(*ids), _explanations_json(*ids)),
        poi_db=InMemoryPoi(pois),
        context_store=_PersonaStore(),
        c1_config=_C1CFG,
        solver_config=solver_config,
        clock=FakeClock(),
        trace=InMemoryTrace(),
    )
    return TestClient(create_app(orchestrator), raise_server_exceptions=False)


# ── 요청 빌더 (백엔드 Jackson SNAKE_CASE 형태) ───────────────────────


def _meta(deadline_ms: int = 20_000) -> dict:
    return {
        "request_id": "req-e2e-241",
        "requested_at": "2026-08-05T08:00:00+09:00",
        "deadline_ms": deadline_ms,
    }


def _request(
    *,
    dates: tuple[date, ...] = (_DAY1,),
    window: tuple[str, str] = ("09:00", "21:00"),
    deadline_ms: int = 20_000,
    excluded: tuple[str, ...] = (),
    fixed_blocks: tuple[dict, ...] = (),
) -> dict:
    return {
        "trip_id": "trip-241",
        "generation_mode": "FULLY_AI",
        "trip_context": {
            "destinations": ["강릉"],
            "start_date": min(dates).isoformat(),
            "end_date": max(dates).isoformat(),
            "companion_type": "혼자",
            "budget_level": "중간",
        },
        "anchors": [
            {"date": d.isoformat(), "lat": _ANCHOR.lat, "lng": _ANCHOR.lng}
            for d in dates
        ],
        "time_windows": [
            {"date": d.isoformat(), "start": window[0], "end": window[1]}
            for d in dates
        ],
        "fixed_blocks": list(fixed_blocks),
        "preference_profile": {
            "styles": ["자연"],
            "activities": [],
            "food_tastes": [],
            "transport_modes": ["대중교통"],
            "pace": "균형있게",
            "companion_types": ["혼자"],
            "pet_friendly": False,
            "budget_tier": "중간",
        },
        "recommendation_strength": None,
        "request_meta": _meta(deadline_ms),
        "excluded_poi_ids": list(excluded),
    }


def _slot_ids(body: dict) -> list[str]:
    return [s["poi_id"] for d in body["days"] for s in d["slots"]]


def _validate_body(itinerary: dict, deadline_ms: int = 20_000) -> dict:
    return {"itinerary": itinerary, "request_meta": _meta(deadline_ms)}


# ── ① 생성 관통 ──────────────────────────────────────────────────────


def test_generate_pierces_http_to_solver() -> None:
    """HTTP → 라우트 → 오케스트레이터 → M7 → C1 → C2 → 응답 JSON 전 구간."""
    with make_client() as client:
        response = client.post("/ai/v1/itinerary/generate", json=_request())

        assert response.status_code == 200, response.text
        body = response.json()

        # 와이어 계약 키 (백엔드 ScheduleAgentWire가 읽는 전부 + TRIP-350 additive)
        assert set(body) == {
            "days", "day1_ready_at", "explanations", "solve_mode",
            "is_fallback", "freshness", "candidates_summary", "unplaced_must_visits",
        }
        assert body["solve_mode"] == "OR_TOOLS"     # 1차 단계가 실제로 해를 냈다
        assert body["is_fallback"] is False

        # INV-1: 배치된 슬롯 전부 후보 풀 안
        placed = _slot_ids(body)
        assert placed and set(placed) <= _POOL_IDS
        # INV-2: 시각은 솔버 검증값 — 일자 안에서 시간순·비중첩
        for day in body["days"]:
            times = [(s["start_at"], s["end_at"]) for s in day["slots"]]
            assert times == sorted(times)
            for (_, prev_end), (next_start, _) in zip(times, times[1:]):
                assert prev_end <= next_start
        # 설명 관통: 실 C1 ExplanationWorker 경유, 키 규약 "{date}#{poi_id}" (BR-U2-04)
        assert body["explanations"]
        for key in body["explanations"]:
            d, _, poi_id = key.partition("#")
            assert d == _DAY1.isoformat() and poi_id in set(placed)
        # INV-3: 소요시간류 토큰이 응답 어디에도 없다
        for banned in _BANNED_TOKENS:
            assert banned not in response.text, f"INV-3/IO-3 위반: {banned!r}"

        # HC 통과를 HTTP로 증명: generate 응답을 validate에 되먹이면 위반 0
        revalidated = client.post(
            "/ai/v1/itinerary/validate", json=_validate_body(body)
        )
        assert revalidated.status_code == 200
        assert revalidated.json() == {"violations": []}


# ── ①-보강 고정 블록 is_fixed 관통 (TRIP-343) ────────────────────────
# 회귀: 솔버가 DaySolution.fixed_blocks를 비워 응답 is_fixed가 상시 false였다 —
# 백엔드가 false를 저장·왕복하면 validate/repair의 HC3 검증 집합이 비어 버린다.


_FIXED_P1 = (
    {"poi_id": "p1", "date": _DAY1.isoformat(), "start": "10:00", "dwell_min": 60},
)


def test_generate_fixed_block_slot_is_fixed_true() -> None:
    """고정 블록 포함 generate → 해당 슬롯만 is_fixed=true (OR-Tools 경로)."""
    with make_client() as client:
        response = client.post(
            "/ai/v1/itinerary/generate", json=_request(fixed_blocks=_FIXED_P1)
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["solve_mode"] == "OR_TOOLS"
    slots = [s for d in body["days"] for s in d["slots"]]
    p1 = next(s for s in slots if s["poi_id"] == "p1")
    assert p1["is_fixed"] is True                                    # 회귀 핵심
    assert (p1["start_at"], p1["end_at"]) == ("10:00:00", "11:00:00")  # HC3 시각 그대로
    assert all(s["is_fixed"] is False for s in slots if s["poi_id"] != "p1")


def test_generate_fixed_block_is_fixed_true_on_rule_fallback_path() -> None:
    """최후 보루(규칙 폴백) 경로에서도 is_fixed=true — INV-4 폴백이라고 잃지 않는다."""
    starved = SolverConfig(or_tools_min_ms=10**9)   # DL-2: 1차 단계 상시 스킵
    with make_client(llm=FailingLlm(), solver_config=starved) as client:
        response = client.post(
            "/ai/v1/itinerary/generate", json=_request(fixed_blocks=_FIXED_P1)
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["solve_mode"] == "RULE_FALLBACK"
    p1 = next(s for d in body["days"] for s in d["slots"] if s["poi_id"] == "p1")
    assert p1["is_fixed"] is True


# ── ② day1 2단계 관통 (TRIP-293) ─────────────────────────────────────


def test_day1_two_phase_merge_has_no_duplicate_pois() -> None:
    with make_client() as client:
        phase1 = client.post(
            "/ai/v1/itinerary/generate",
            json=_request(dates=(_DAY1,), window=("09:00", "13:00"),
                          deadline_ms=5_000),
        )
        assert phase1.status_code == 200
        day1_ids = _slot_ids(phase1.json())
        assert day1_ids  # 1차가 실제로 배정했다

        phase2 = client.post(
            "/ai/v1/itinerary/generate",
            json=_request(dates=(_DAY2,), deadline_ms=20_000,
                          excluded=tuple(day1_ids)),
        )
        assert phase2.status_code == 200
        day2_ids = _slot_ids(phase2.json())
        assert day2_ids  # 남은 후보로 2차도 배정했다

    # 두 응답 병합 시 POI 중복 0 (제외 목록이 실제로 관통했다)
    assert set(day1_ids) & set(day2_ids) == set()
    assert {d["date"] for d in phase1.json()["days"]} == {_DAY1.isoformat()}
    assert {d["date"] for d in phase2.json()["days"]} == {_DAY2.isoformat()}


# ── ③ 폴백 관통 (INV-4 · PR #104) ────────────────────────────────────


def test_llm_failure_still_returns_valid_itinerary_200() -> None:
    """LLM 전면 실패 → 규칙 점수로 강등되지만 5xx가 아니라 유효한 일정 200."""
    with make_client(llm=FailingLlm()) as client:
        response = client.post("/ai/v1/itinerary/generate", json=_request())

    assert response.status_code == 200, response.text
    body = response.json()
    placed = _slot_ids(body)
    assert placed and set(placed) <= _POOL_IDS      # INV-1 유지
    assert "error_code" not in body                 # 오류 바디 아님 — 폴백은 200


def test_llm_and_primary_solver_down_falls_back_to_rule_chain() -> None:
    """LLM 실패 + OR-Tools 단계 진입 불가(시한 요구 초과) → 최후 보루가 200을 낸다."""
    starved = SolverConfig(or_tools_min_ms=10**9)   # DL-2: 1차 단계 상시 스킵
    with make_client(llm=FailingLlm(), solver_config=starved) as client:
        response = client.post("/ai/v1/itinerary/generate", json=_request())

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["is_fallback"] is True              # AI가 이미 마친 폴백 결과물
    assert body["solve_mode"] == "RULE_FALLBACK"
    assert _slot_ids(body)                          # 빈손이 아니다 (침묵 실패 금지)


# ── ④ validate · repair 관통 ─────────────────────────────────────────


def _payload(slots: list[dict]) -> dict:
    """HC2 위반 시나리오용 수기 일정 — p1→p2 이동에 약 19분 필요."""
    return {
        "days": [{"date": _DAY1.isoformat(), "slots": slots}],
        "day1_ready_at": None,
        "explanations": {},
        "solve_mode": "OR_TOOLS",
        "is_fallback": False,
        "freshness": None,
        "candidates_summary": None,
    }


def _slot(poi_id: str, start: str, end: str, *, is_fixed: bool = False) -> dict:
    return {"poi_id": poi_id, "start_at": start, "end_at": end,
            "ends_next_day": False, "distance_range": None, "is_fixed": is_fixed}


_VIOLATING = [
    _slot("p1", "10:00:00", "11:00:00"),
    _slot("p2", "11:05:00", "12:00:00"),  # 간격 5분 < 이동 소요 → HC2
]


def test_validate_reports_violations_with_day_index() -> None:
    with make_client() as client:
        response = client.post(
            "/ai/v1/itinerary/validate", json=_validate_body(_payload(_VIOLATING))
        )

    assert response.status_code == 200                 # 위반은 정상 응답 (IO-7)
    violations = response.json()["violations"]
    assert violations
    hc2 = next(v for v in violations if v["code"] == "HC2")
    assert hc2["slot_ref"] == "p2"
    assert (hc2["day_index"], hc2["slot_index"]) == (0, 1)
    assert hc2["detail"]                               # 침묵 금지 — 사유가 있다


def test_repair_fixes_then_revalidates_clean() -> None:
    """repair 관통: 위반 일정 → 시각 전방 이동 수리 → 재검증 위반 0 (전부 HTTP로)."""
    with make_client() as client:
        repaired_response = client.post(
            "/ai/v1/itinerary/repair",
            json={"itinerary": _payload(_VIOLATING),
                  "violations": [{"code": "HC2", "slot_ref": "p2",
                                  "detail": "이동시간 부족"}],
                  "request_meta": _meta()},
        )
        assert repaired_response.status_code == 200, repaired_response.text
        body = repaired_response.json()
        assert body["repaired"] is not None
        assert body["changes"]                          # RepairChange → 문자열 렌더
        assert all(isinstance(c, str) and c for c in body["changes"])
        assert any("p2" in c for c in body["changes"])  # 무엇이 움직였는지 드러난다
        # POI 불변(시각·순서만 조정) — Plan-B 최소 조정 계약
        assert _slot_ids(body["repaired"]) == ["p1", "p2"]
        for banned in _BANNED_TOKENS:                   # INV-3은 수리 응답에도 적용
            assert banned not in repaired_response.text

        revalidated = client.post(
            "/ai/v1/itinerary/validate", json=_validate_body(body["repaired"])
        )
        assert revalidated.status_code == 200
        assert revalidated.json() == {"violations": []}


def test_repair_honest_failure_when_fixed_slot_blocks_shift() -> None:
    """수리 불가(위반 슬롯이 고정이라 이동 금지) → 200 + repaired=null (IO-7)."""
    pinned = [
        _slot("p1", "10:00:00", "11:00:00"),
        _slot("p2", "11:05:00", "12:00:00", is_fixed=True),  # HC3 고정 — 이동 불가
    ]
    with make_client() as client:
        response = client.post(
            "/ai/v1/itinerary/repair",
            json={"itinerary": _payload(pinned), "violations": [],
                  "request_meta": _meta()},
        )

    assert response.status_code == 200
    assert response.json() == {"repaired": None, "changes": []}


# ── ⑤ 에러 계약 ──────────────────────────────────────────────────────


def test_contradictory_fixed_blocks_return_409() -> None:
    """같은 POI를 다른 시각에 이중 고정 → 모든 솔버 단계 실패 → 409 (d08, 500 아님)."""
    conflicting = (
        {"poi_id": "p1", "date": _DAY1.isoformat(), "start": "10:00", "dwell_min": 60},
        {"poi_id": "p1", "date": _DAY1.isoformat(), "start": "13:00", "dwell_min": 60},
    )
    with make_client() as client:
        response = client.post(
            "/ai/v1/itinerary/generate", json=_request(fixed_blocks=conflicting)
        )

    assert response.status_code == 409, response.text
    body = response.json()
    assert body["error_code"] == "SOLVER_CONFLICT"
    assert body["retryable"] is False
    assert body["message"]


def test_schema_violations_return_422() -> None:
    base = _request()
    cases = [
        {**base, "excluded_poi_id": ["oops"]},          # 미지 필드 — 드리프트 침묵 금지
        {**base, "time_windows": []},                   # 최소 1일
        {**base, "anchors": []},                        # 조립 불가 — 앵커 없음 (어댑터)
        {**base, "fixed_blocks": [{"poi_id": "p9"}]},   # ANYTIME — date/start/dwell_min 필수 (스키마, M1)
    ]
    with make_client() as client:
        for payload in cases:
            response = client.post("/ai/v1/itinerary/generate", json=payload)
            assert response.status_code == 422, (payload, response.text)
            assert response.json()["error_code"] in {
                "VALIDATION_ERROR", "DOMAIN_INVARIANT_VIOLATION"
            }


# ── ⑥ 로컬 스모크 조립 (main.py 경로) ────────────────────────────────


def test_dev_app_assembly_serves_health_and_generate() -> None:
    """build_dev_app: 실 LLM·실 DB 없이 기동 — /health 유지 + 규칙 폴백 일정 200."""
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json() == {"status": "UP", "service": "ai"}

        request = _request()
        request["anchors"] = [{"date": _DAY1.isoformat(),
                               "lat": DEMO_ANCHOR.lat, "lng": DEMO_ANCHOR.lng}]
        response = client.post("/ai/v1/itinerary/generate", json=request)
        assert response.status_code == 200, response.text
        placed = _slot_ids(response.json())
        assert placed  # 데모 시드에서 실제 배정이 일어났다
        # 백엔드 AiSlot.poiId는 UUID 타입 — 응답 poi_id 전건이 파싱 가능해야
        # 역직렬화·후속 조인이 산다 (TRIP-344, 감사 F2).
        for poi_id in placed:
            uuid.UUID(poi_id)
