"""U5-03 — 경계 계약 테스트 (TRIP-239).

정본 대조 대상: `backend/modules/itinerary-generation/.../domain/ScheduleAgentPort.kt`
(백엔드가 실제로 보내는 형태) + `adapter/out/external/ScheduleAgentWire.kt`(받는 형태).

여기서 고정하는 것:
1. 백엔드가 snake_case로 직렬화한 요청 JSON이 **그대로** 파싱된다
2. 응답 필드명이 백엔드 와이어 타입과 일치한다
3. **INV-3** — 응답 JSON 어디에도 소요시간류 필드가 없다(백엔드 계약 테스트와 같은 검사)
4. 산출물 스키마 왕복 — generate 응답을 그대로 validate/repair 요청에 실을 수 있다
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Mapping, Sequence

from fastapi.testclient import TestClient

from trippilot.api.app import create_app
from trippilot.api.schemas import GenerateItineraryRequest, ItineraryPayload
from trippilot.domain.common import PoiId, ScheduleId
from trippilot.domain.freshness import FreshnessMeta
from trippilot.domain.itinerary import (
    DaySolution,
    FixedBlock,
    ItinerarySolution,
    SolveMode,
    TimeWindow,
    Violation,
    VisitSlot,
)

KST = timezone(timedelta(hours=9))
DAY = date(2026, 8, 10)
FIXED_POI = PoiId("11111111-1111-4111-8111-111111111111")
FREE_POI = PoiId("22222222-2222-4222-8222-222222222222")


# ───────────────────────── 테스트 더블 ─────────────────────────


@dataclass
class FakeSummary:
    level: str = "LOW"
    pool_size: int | None = 12
    shortfall_categories: Sequence[str] = field(default_factory=lambda: ["미식"])


@dataclass
class FakeUnplaced:
    poi_id: str
    reason_code: str


@dataclass
class FakeOutcome:
    solution: ItinerarySolution
    explanations: Mapping[str, str] = field(default_factory=dict)
    distance_ranges: Mapping[str, str] = field(default_factory=dict)
    freshness: FreshnessMeta | None = None
    candidates_summary: FakeSummary | None = None
    day1_ready_at: datetime | None = None
    unplaced_must_visits: Sequence[FakeUnplaced] = ()


@dataclass
class FakeRepairOutcome:
    repaired: FakeOutcome | None
    changes: Sequence[str] = field(default_factory=list)


class FakeOrchestrator:
    """구조적 타이핑으로만 API와 만난다 — 실 오케스트레이터(TRIP-237) import 없음."""

    def __init__(self, outcome: FakeOutcome,
                 violations: Sequence[Violation] = ()) -> None:
        self.outcome = outcome
        self.violations = list(violations)
        self.seen: list[object] = []

    def generate(self, request):  # noqa: ANN001 — 구조적 계약
        self.seen.append(request)
        return self.outcome

    def validate(self, request):  # noqa: ANN001
        self.seen.append(request)
        return self.violations

    def repair(self, request):  # noqa: ANN001
        self.seen.append(request)
        return FakeRepairOutcome(repaired=self.outcome, changes=["10:30 → 11:00"])


def make_solution() -> ItinerarySolution:
    """고정 블록 1 + 자정 넘김 슬롯 1 — is_fixed·ends_next_day 사영을 함께 고정한다."""
    fixed = FixedBlock(
        poi_id=FIXED_POI,
        window=TimeWindow(
            start=datetime(2026, 8, 10, 12, 0, tzinfo=KST),
            end=datetime(2026, 8, 10, 13, 0, tzinfo=KST),
        ),
        reason="must_visit",
    )
    slots = (
        VisitSlot(
            poi_id=FIXED_POI,
            start_at=datetime(2026, 8, 10, 12, 0, tzinfo=KST),
            end_at=datetime(2026, 8, 10, 13, 0, tzinfo=KST),
            stay_min=60,
            score=0.9,
            is_llm_score=True,
        ),
        VisitSlot(
            poi_id=FREE_POI,
            start_at=datetime(2026, 8, 10, 23, 30, tzinfo=KST),
            end_at=datetime(2026, 8, 11, 0, 30, tzinfo=KST),  # 자정 넘김(HC4)
            stay_min=60,
            score=0.7,
            is_llm_score=False,
        ),
    )
    return ItinerarySolution(
        schedule_id=ScheduleId("sched-1"),
        days=(DaySolution(date=DAY, slots=slots, fixed_blocks=(fixed,)),),
        is_fallback=False,
        solve_mode=SolveMode.OR_TOOLS,
        solver_run=None,
    )


def make_outcome() -> FakeOutcome:
    return FakeOutcome(
        solution=make_solution(),
        explanations={f"2026-08-10#{FIXED_POI}": "미식 취향을 반영했어요"},
        distance_ranges={f"2026-08-10#{FREE_POI}": "약 1.2km · 도보 추정"},
        freshness=FreshnessMeta(
            source="M7_CACHE",
            fetched_at=datetime(2026, 8, 10, 0, 0, 4, tzinfo=timezone.utc),
            cache_hit=True,
            ttl_sec=3600,
            stale=False,
        ),
        candidates_summary=FakeSummary(),
        day1_ready_at=datetime(2026, 8, 10, 0, 0, 4, tzinfo=timezone.utc),
    )


def client(orchestrator: object | None = None) -> TestClient:
    return TestClient(create_app(orchestrator), raise_server_exceptions=False)


# 백엔드가 실제로 보내는 형태 — Jackson SNAKE_CASE + JavaTimeModule(ISO 문자열).
# LocalTime 은 초를 생략해 나올 수 있어("09:00") 두 표기를 섞어 고정한다.
BACKEND_REQUEST: dict = {
    "trip_id": "33333333-3333-4333-8333-333333333333",
    "generation_mode": "FULLY_AI",
    "trip_context": {
        "destinations": ["부산"],
        "start_date": "2026-08-10",
        "end_date": "2026-08-12",
        "companion_type": "친구",
        "budget_level": "중간",
    },
    "anchors": [{"date": "2026-08-10", "lat": 35.1, "lng": 129.0}],
    "time_windows": [{"date": "2026-08-10", "start": "09:00", "end": "21:00"}],
    "fixed_blocks": [
        {
            "poi_id": FIXED_POI,
            "date": "2026-08-10",
            "start": "12:00:00",
            "dwell_min": 60,
        }
    ],
    "preference_profile": {
        "styles": ["미식"],
        "activities": ["야경"],
        "food_tastes": ["해산물"],
        "transport_modes": ["대중교통"],
        "pace": "균형있게",
        "companion_types": ["친구"],
        "pet_friendly": False,
        "budget_tier": "중간",
    },
    "recommendation_strength": None,
    "request_meta": {
        "request_id": "req-1",
        "requested_at": "2026-08-10T00:00:00Z",
        "deadline_ms": 20000,
    },
    "excluded_poi_ids": [],
}


# ───────────────────────── 요청: 백엔드 DTO 대응 ─────────────────────────


def test_backend_input_json_parses_as_is() -> None:
    """백엔드 ScheduleAgentInput 직렬화본이 손실 없이 파싱된다(필드명 정합)."""
    parsed = GenerateItineraryRequest.model_validate(BACKEND_REQUEST)
    assert parsed.trip_context.destinations == ["부산"]
    assert parsed.time_windows[0].start.hour == 9
    assert parsed.fixed_blocks[0].dwell_min == 60
    assert parsed.request_meta.deadline_ms == 20000


def test_two_phase_day1_fields_reach_orchestrator() -> None:
    """day1 2단계(TRIP-293): 1차 5초·단일 day, 2차 excluded_poi_ids 가 그대로 전달된다."""
    orchestrator = FakeOrchestrator(make_outcome())
    phase1 = {**BACKEND_REQUEST,
              "request_meta": {**BACKEND_REQUEST["request_meta"], "deadline_ms": 5000}}
    phase2 = {**BACKEND_REQUEST, "excluded_poi_ids": [FIXED_POI, FREE_POI]}

    with client(orchestrator) as c:
        assert c.post("/ai/v1/itinerary/generate", json=phase1).status_code == 200
        assert c.post("/ai/v1/itinerary/generate", json=phase2).status_code == 200

    assert orchestrator.seen[0].request_meta.deadline_ms == 5000
    assert orchestrator.seen[0].excluded_poi_ids == []
    assert orchestrator.seen[1].excluded_poi_ids == [FIXED_POI, FREE_POI]


def test_generation_mode_accepts_both_casings() -> None:
    """계약 문서는 소문자(fully_ai), Kotlin enum은 대문자 — 둘 다 받는다."""
    lower = {**BACKEND_REQUEST, "generation_mode": "co_plan"}
    assert GenerateItineraryRequest.model_validate(lower).generation_mode.value == "CO_PLAN"


# ───────────────────────── 응답: 와이어 필드 정합 ─────────────────────────


def test_generate_response_matches_backend_wire_fields() -> None:
    with client(FakeOrchestrator(make_outcome())) as c:
        response = c.post("/ai/v1/itinerary/generate", json=BACKEND_REQUEST)

    assert response.status_code == 200
    body = response.json()
    # AiScheduleResponse(ScheduleAgentWire.kt) 가 읽는 키 전부 (+TRIP-350 additive)
    assert set(body) == {
        "days", "day1_ready_at", "explanations", "solve_mode",
        "is_fallback", "freshness", "candidates_summary", "unplaced_must_visits",
    }
    assert body["unplaced_must_visits"] == []  # 기본 = 전부 배치됨
    assert body["solve_mode"] == "OR_TOOLS"  # AI 4값 그대로 — 3값 축약은 백엔드 어댑터 몫
    assert body["is_fallback"] is False
    assert set(body["freshness"]) == {"source", "fetched_at", "cache_hit", "ttl_sec", "stale"}
    assert set(body["candidates_summary"]) == {"level", "pool_size", "shortfall_categories"}
    assert body["candidates_summary"]["pool_size"] == 12

    day = body["days"][0]
    assert day["date"] == "2026-08-10"
    assert set(day) == {"date", "slots"}
    assert set(day["slots"][0]) == {
        "poi_id", "start_at", "end_at", "ends_next_day", "distance_range", "is_fixed",
    }


def test_slot_projection_uses_solver_values_only() -> None:
    """INV-2: 시각·순서는 솔버 검증값(VisitSlot) 사영. is_fixed·ends_next_day도 해에서 파생."""
    with client(FakeOrchestrator(make_outcome())) as c:
        slots = c.post("/ai/v1/itinerary/generate", json=BACKEND_REQUEST).json()["days"][0]["slots"]

    first, second = slots
    assert (first["start_at"], first["end_at"]) == ("12:00:00", "13:00:00")
    assert first["is_fixed"] is True and first["ends_next_day"] is False
    assert first["distance_range"] is None            # 키가 없으면 지어내지 않는다
    assert second["ends_next_day"] is True            # 23:30 → 다음날 00:30 (HC4)
    assert second["is_fixed"] is False
    assert second["distance_range"] == "약 1.2km · 도보 추정"


def test_response_has_no_duration_fields_inv3() -> None:
    """INV-3 — 응답 JSON 어디에도 소요시간이 없다.

    백엔드 계약 테스트(ScheduleAgentContractTest)가 `shouldNotContain "minutes"` 로
    같은 검사를 한다. 도메인 VisitSlot의 stay_min·score·is_llm_score도 새어나가면 안 된다.
    """
    with client(FakeOrchestrator(make_outcome())) as c:
        raw = c.post("/ai/v1/itinerary/generate", json=BACKEND_REQUEST).text

    for banned in ("duration", "minutes", "stay_min", "dwell_min",
                   "internal_", "travel_time", "elapsed", "is_llm_score", "score"):
        assert banned not in raw, f"INV-3/IO-3 위반 — 응답에 {banned!r} 노출: {raw}"
    assert "distance_range" in raw  # 거리만 표시한다


# ───────────────────────── 왕복 · validate · repair ─────────────────────────


def test_payload_round_trips_into_validate_request() -> None:
    """generate 응답 → validate/repair 요청 본문으로 그대로 실린다(같은 형태 왕복)."""
    orchestrator = FakeOrchestrator(
        make_outcome(),
        violations=[Violation(code="HC2", slot_ref=FREE_POI, detail="이동시간 부족")],
    )
    with client(orchestrator) as c:
        generated = c.post("/ai/v1/itinerary/generate", json=BACKEND_REQUEST).json()

        # 스키마 왕복: 직렬화본 → 모델 → 직렬화본 동일
        payload = ItineraryPayload.model_validate(generated)
        assert json.loads(payload.model_dump_json()) == generated

        response = c.post(
            "/ai/v1/itinerary/validate",
            json={"itinerary": generated, "request_meta": BACKEND_REQUEST["request_meta"]},
        )

    assert response.status_code == 200
    # 수퍼셋 발신: FREE_POI 는 day0 의 두 번째 슬롯 — 직렬화 시점 스캔으로 (0, 1) 계산
    assert response.json() == {
        "violations": [{
            "code": "HC2", "slot_ref": FREE_POI, "detail": "이동시간 부족",
            "day_index": 0, "slot_index": 1,
        }]
    }


def test_violation_indices_computed_by_scanning_itinerary() -> None:
    """수퍼셋 발신: 위치 인덱스는 요청 itinerary 스캔으로 계산 — 첫 슬롯은 (0, 0)."""
    orchestrator = FakeOrchestrator(
        make_outcome(),
        violations=[Violation(code="HC1", slot_ref=FIXED_POI, detail="이용시간 밖")],
    )
    with client(orchestrator) as c:
        generated = c.post("/ai/v1/itinerary/generate", json=BACKEND_REQUEST).json()
        body = c.post(
            "/ai/v1/itinerary/validate",
            json={"itinerary": generated, "request_meta": BACKEND_REQUEST["request_meta"]},
        ).json()

    violation = body["violations"][0]
    assert (violation["day_index"], violation["slot_index"]) == (0, 0)
    # 기존 필드 회귀 없음 — code/slot_ref/detail 은 그대로 유지된다(수퍼셋)
    assert (violation["code"], violation["slot_ref"], violation["detail"]) == (
        "HC1", FIXED_POI, "이용시간 밖",
    )


def test_unplaced_violation_indices_are_null() -> None:
    """HC3 미배치 위반: 슬롯이 없어서 위반인 것 — 인덱스는 null이 정직한 값(지어내지 않는다)."""
    unplaced = "99999999-9999-4999-8999-999999999999"
    orchestrator = FakeOrchestrator(
        make_outcome(),
        violations=[
            Violation(code="HC3", slot_ref=PoiId(unplaced), detail="필수방문 미배치"),
            Violation(code="HC2", slot_ref=None, detail="슬롯 무관 위반"),
        ],
    )
    with client(orchestrator) as c:
        generated = c.post("/ai/v1/itinerary/generate", json=BACKEND_REQUEST).json()
        body = c.post(
            "/ai/v1/itinerary/validate",
            json={"itinerary": generated, "request_meta": BACKEND_REQUEST["request_meta"]},
        ).json()

    first, second = body["violations"]
    assert first["slot_ref"] == unplaced
    assert first["day_index"] is None and first["slot_index"] is None
    assert second["slot_ref"] is None
    assert second["day_index"] is None and second["slot_index"] is None


def test_validate_returns_200_with_empty_violations() -> None:
    """위반 없음도 정상 200 (IO-7 — 실패 상태값은 예외가 아니다)."""
    with client(FakeOrchestrator(make_outcome())) as c:
        generated = c.post("/ai/v1/itinerary/generate", json=BACKEND_REQUEST).json()
        response = c.post(
            "/ai/v1/itinerary/validate",
            json={"itinerary": generated, "request_meta": BACKEND_REQUEST["request_meta"]},
        )
    assert response.status_code == 200
    assert response.json()["violations"] == []


def test_repair_returns_repaired_payload_and_changes() -> None:
    with client(FakeOrchestrator(make_outcome())) as c:
        generated = c.post("/ai/v1/itinerary/generate", json=BACKEND_REQUEST).json()
        response = c.post(
            "/ai/v1/itinerary/repair",
            json={
                "itinerary": generated,
                "violations": [{"code": "HC2", "slot_ref": FREE_POI, "detail": "x"}],
                "request_meta": BACKEND_REQUEST["request_meta"],
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"repaired", "changes"}
    assert body["repaired"] == generated
    assert body["changes"] == ["10:30 → 11:00"]
    assert "minutes" not in response.text  # INV-3 은 수리 응답에도 적용된다


def test_repair_unrepairable_is_200_with_null() -> None:
    """수리 불가는 오류가 아니다 — 200 + repaired=null (IO-7). 오류로 내면 백엔드가 폴백한다."""

    class Unrepairable(FakeOrchestrator):
        def repair(self, request):  # noqa: ANN001
            return FakeRepairOutcome(repaired=None, changes=[])

    with client(Unrepairable(make_outcome())) as c:
        generated = c.post("/ai/v1/itinerary/generate", json=BACKEND_REQUEST).json()
        response = c.post(
            "/ai/v1/itinerary/repair",
            json={"itinerary": generated, "violations": [],
                  "request_meta": BACKEND_REQUEST["request_meta"]},
        )

    assert response.status_code == 200
    assert response.json() == {"repaired": None, "changes": []}
