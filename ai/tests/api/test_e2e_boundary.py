"""U5-05 — 경계 E2E 관통 테스트 (TRIP-241).

FastAPI TestClient + **실 오케스트레이터·실 M7·실 C1·실 C2** + fake 어댑터(LLM·POI DB·
페르소나 저장소·시계·트레이스)로 전 구간을 관통한다 — 실 LLM·외부 API 호출 0 (D37).

    HTTP 요청(백엔드 Jackson 형태) → routes → wiring 어댑터 → ScheduleCoordinator
    → M7 후보풀 → C1 점수·설명 → C2 어셈블리 → 응답 JSON

증명하는 것:
  ① 생성 관통: 200 + 유효 일정(슬롯 ⊆ 후보풀 INV-1 · 시간순 INV-2 · INV-3 필드 부재),
     그리고 그 응답을 **validate 라우트에 되먹여** HC 위반 0을 HTTP로 확인
  ② day1 2단계(TRIP-293): 1차(day1·5000ms) 배정 POI를 2차 excluded로 → 병합 중복 0
  ③ 폴백 관통(INV-4): LLM 전면 실패여도 200(5xx 아님 — PR #104), 체인 강등까지 겹치면
     200 + is_fallback=true
  ④ validate·repair 관통: 위반 일정 → 위반 목록(day_index 포함) → repair 수리 후
     재검증 위반 0, 수리 불가는 200 + repaired=null(IO-7)
  ④-보강 미검증 보고(TRIP-537): 미등록 POI 가 낀 일정은 HC1·HC2 판정 밖인데
     위반 0 으로만 보였다 — 이제 `unverified_slots` 에 사유와 함께 실린다(INV-4).
     영업정보 없는 등록 POI 는 HC1 만 판정 밖이라 HOURS_UNKNOWN 으로 실린다(상황 감지 INV-SA-2) —
     원문이 있어도 해석하지 못하면(재현 둘, 정본 조회 어댑터의 실 행 매핑) 같다
  ⑤ 에러 계약: 모순 고정블록 409 · 잘못된 스키마/조립 불가 입력 422
  ⑥ 로컬 스모크 조립(main.py 경로): build_dev_app이 fake만으로 200을 낸다
"""

from __future__ import annotations

import json
import uuid
from dataclasses import replace
from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from trippilot.agents.schedule.budget import OrchestratorConfig
from trippilot.api.app import create_app
from trippilot.api.wiring import build_dev_app, build_orchestrator, DEMO_ANCHOR
from trippilot.llm_gateway.config import C1Config
from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.travel import TravelEstimator
from trippilot.domain.common import BudgetLevel, GeoPoint, TransportMode
from trippilot.domain.llm import ModelTier
from trippilot.domain.persona import CompanionType, PersonaSummary, TasteTag
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource
from trippilot.poi_curation.adapters.backend_poi_db import BackendPoiDb
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
        {"explanations": [{"poiId": i, "tags": ["#조용한", "#취향저격", "#여유", "#산책", "#힐링"]} for i in ids]}
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
    assembly_config: AssemblyConfig | None = None,
    orchestrator_config: OrchestratorConfig | None = None,
) -> TestClient:
    """실 조립(build_orchestrator) + fake 어댑터 — 테스트 공용 진입점."""
    ids = tuple(str(p.poi_id) for p in pois)
    orchestrator = build_orchestrator(
        llm=llm if llm is not None
        else RoutingLlm(_scores_json(*ids), _explanations_json(*ids)),
        poi_db=InMemoryPoi(pois),
        context_store=_PersonaStore(),
        c1_config=_C1CFG,
        assembly_config=assembly_config,
        orchestrator_config=orchestrator_config,
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


def _hours_unknown(poi_ids: list[str]) -> list[dict]:
    """영업정보 없는 픽스처 POI(open_hours=())의 미판정 보고 — HC1 만 못 봤다(상황 감지 INV-SA-2). 첫 등장 순·중복 없음."""
    return [{"poi_id": p, "reason_code": "HOURS_UNKNOWN", "detail": ""} for p in dict.fromkeys(poi_ids)]


def _validate_body(itinerary: dict, deadline_ms: int = 20_000) -> dict:
    return {"itinerary": itinerary, "request_meta": _meta(deadline_ms)}


# ── ① 생성 관통 ──────────────────────────────────────────────────────


def test_generate_pierces_http_to_assembly() -> None:
    """HTTP → 라우트 → 오케스트레이터 → M7 → C1 → C2 → 응답 JSON 전 구간."""
    with make_client() as client:
        response = client.post("/ai/v1/itinerary/generate", json=_request())

        assert response.status_code == 200, response.text
        body = response.json()

        # 와이어 계약 키 (백엔드 ScheduleAgentWire가 읽는 전부 + TRIP-350 additive)
        assert set(body) == {
            "days", "day1_ready_at", "explanations", "solve_mode",
            "is_fallback", "freshness", "candidates_summary", "unplaced_must_visits",
            "scoring_mode", "degradations",
        }
        assert body["solve_mode"] == "OR_TOOLS"     # 1차 단계가 실제로 해를 냈다
        assert body["is_fallback"] is False

        # INV-1: 배치된 슬롯 전부 후보 풀 안
        placed = _slot_ids(body)
        assert placed and set(placed) <= _POOL_IDS
        # INV-2: 시각은 어셈블리 검증값 — 일자 안에서 시간순·비중첩
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

        # HC 통과를 HTTP로 증명: generate 응답을 validate에 되먹이면 위반 0 — 픽스처는 영업정보가 없어
        # HC1 은 못 본 것으로 함께 실린다(위반 0 이 영업시간 통과로 읽히지 않게)
        revalidated = client.post(
            "/ai/v1/itinerary/validate", json=_validate_body(body)
        )
        assert revalidated.status_code == 200
        assert revalidated.json() == {"violations": [], "unverified_slots": _hours_unknown(placed)}


# ── ①-보강 고정 블록 is_fixed 관통 (TRIP-343) ────────────────────────
# 회귀: 어셈블리가 DaySolution.fixed_blocks를 비워 응답 is_fixed가 상시 false였다 —
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
    starved = AssemblyConfig(or_tools_min_ms=10**9)   # DL-2: 1차 단계 상시 스킵
    with make_client(llm=FailingLlm(), assembly_config=starved) as client:
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


def test_llm_and_primary_assembly_down_falls_back_to_rule_chain() -> None:
    """LLM 실패 + OR-Tools 단계 진입 불가(시한 요구 초과) → 최후 보루가 200을 낸다."""
    starved = AssemblyConfig(or_tools_min_ms=10**9)   # DL-2: 1차 단계 상시 스킵
    with make_client(llm=FailingLlm(), assembly_config=starved) as client:
        response = client.post("/ai/v1/itinerary/generate", json=_request())

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["is_fallback"] is True              # AI가 이미 마친 폴백 결과물
    assert body["solve_mode"] == "RULE_FALLBACK"
    assert _slot_ids(body)                          # 빈손이 아니다 (침묵 실패 금지)


def test_fixed_block_zero_dwell_is_not_422() -> None:
    """TRIP-1391 — 스키마는 dwell_min ≥ 0 인데 0 이면 end == start 로 422 였다. 0 = 미지정(기본 체류)."""
    zero = ({"poi_id": "p1", "date": _DAY1.isoformat(), "start": "10:00", "dwell_min": 0},)
    with make_client() as client:
        response = client.post("/ai/v1/itinerary/generate", json=_request(fixed_blocks=zero))
    assert response.status_code == 200, response.text
    pinned = [s for d in response.json()["days"] for s in d["slots"] if s["poi_id"] == "p1"]
    assert pinned and pinned[0]["start_at"].startswith("10:00") and pinned[0]["is_fixed"] is True
    assert pinned[0]["end_at"] > pinned[0]["start_at"]


# ── ③″ 조용한 처리 밝히기 (TRIP-1392) ─────────────────────────────────


def _with(**over) -> dict:
    body = _request()
    for path, value in over.items():
        if path == "transport_modes":
            body["preference_profile"]["transport_modes"] = value
        else:
            body[path] = value
    return body


@pytest.mark.parametrize("body,code", [
    (_with(time_windows=[{"date": "2026-09-01", "start": "09:00", "end": "21:00"}]),
     "request:window_outside_trip"),
    (_with(fixed_blocks=[{"poi_id": "p1", "date": _DAY1.isoformat(), "start": "10:00"}],
           excluded_poi_ids=["p1"]), "request:fixed_overrides_excluded"),
    (_with(transport_modes=["킥보드"]), "request:transport_unknown"),
    (_with(time_windows=[{"date": _DAY1.isoformat(), "start": "09:00", "end": "09:30"}]),
     "generate:empty_day"),
], ids=["window_outside_trip", "fixed_and_excluded", "transport_unknown", "empty_day"])
def test_generate_names_what_it_silently_adjusted(body: dict, code: str) -> None:
    """200 이어도 무엇을 다르게 처리했는지 `degradations` 에 싣는다 — 말없이 나가지 않는다(INV-4)."""
    with make_client() as client:
        response = client.post("/ai/v1/itinerary/generate", json=body)
    assert response.status_code == 200, response.text
    assert code in response.json()["degradations"], response.json()["degradations"]


def test_generate_warns_when_a_fixed_place_is_in_another_city() -> None:
    """부산 장소를 서울 일정에 고정하면 그 1곳만 든 하루가 말없이 나갔다(329km, DEV 10-13)."""
    far = Poi(poi_id="far", name="먼 곳", category=PoiCategory.SIGHT,
              coord=GeoPoint(_ANCHOR.lat - 2.5, _ANCHOR.lng - 1.0), open_hours=(), avg_cost=None,
              rating=4.0, quality=DataQuality.FULL, source=PoiSource.SEED, confidence=None)
    body = _request(fixed_blocks=({"poi_id": "far", "date": _DAY1.isoformat(), "start": "12:00"},))
    with make_client(pois=_POIS + (far,)) as client:
        out = client.post("/ai/v1/itinerary/generate", json=body).json()
    assert "request:fixed_far_from_anchor" in out["degradations"], out["degradations"]


def test_generate_reads_jacha_as_car_and_reports_nothing_for_a_clean_request() -> None:
    with make_client() as client:
        clean = client.post("/ai/v1/itinerary/generate", json=_request()).json()
        jacha = client.post("/ai/v1/itinerary/generate",
                            json=_with(transport_modes=["자차"])).json()
    assert not [d for d in clean["degradations"] if d.startswith(("request:", "generate:empty"))]
    assert "request:transport_unknown" not in jacha["degradations"]


# ── ③′ 일자별 시간창 (TRIP-1389) ─────────────────────────────────────
# 회귀: 첫 날 창이 전 일자에 적용돼, 출발일 12시까지인 3일 여행에 출발일 창 밖 슬롯이 놓였다.

_DAY3 = date(2026, 8, 7)
_WINDOWS = {_DAY1: ("15:00", "21:00"), _DAY2: ("09:00", "21:00"), _DAY3: ("09:00", "12:00")}
_MANY_POIS = tuple(_poi(i, 0.003 * (i - 1)) for i in range(1, 19))


@pytest.mark.parametrize("assembly_config", [None, AssemblyConfig(or_tools_min_ms=10**9)],
                         ids=["or_tools", "rule_fallback"])
def test_generate_keeps_each_day_inside_its_own_window(assembly_config) -> None:
    body = _request(dates=tuple(_WINDOWS))
    body["time_windows"] = [{"date": d.isoformat(), "start": s, "end": e}
                            for d, (s, e) in _WINDOWS.items()]
    with make_client(pois=_MANY_POIS, assembly_config=assembly_config) as client:
        response = client.post("/ai/v1/itinerary/generate", json=body)
        assert response.status_code == 200, response.text
        out = response.json()
        days = {d["date"]: d["slots"] for d in out["days"]}
        assert days[_DAY1.isoformat()] and days[_DAY3.isoformat()], out
        for d, (start, end) in _WINDOWS.items():
            for slot in days.get(d.isoformat(), []):
                assert start <= slot["start_at"][:5] and slot["end_at"][:5] <= end, (d, slot)


# ── ③‴ 영업시간 모르는 곳은 새벽에 안 놓는다 (TRIP-1397) ────────────────


def test_unknown_hours_are_not_placed_overnight_but_user_pins_are_kept() -> None:
    """창을 00:00~23:59 로 주면 정보 없음(=종일)이라 새벽 00:17·02:32 에 놓였다(DEV 10-13)."""
    body = _request(window=("00:00", "23:59"),
                    fixed_blocks=({"poi_id": "p1", "date": _DAY1.isoformat(),
                                   "start": "01:00", "dwell_min": 60},))
    with make_client(pois=_MANY_POIS) as client:
        response = client.post("/ai/v1/itinerary/generate", json=body)
    assert response.status_code == 200, response.text
    slots = [s for d in response.json()["days"] for s in d["slots"]]
    pinned = [s for s in slots if s["poi_id"] == "p1"]
    assert pinned and pinned[0]["start_at"].startswith("01:00")  # 사용자가 고정한 곳은 추정을 안 건다
    free = [s for s in slots if s["poi_id"] != "p1"]
    assert free and all("07:00" <= s["start_at"][:5] and s["end_at"][:5] <= "23:00" for s in free), free


def test_generate_turns_on_route_weight_so_a_day_stays_in_one_area() -> None:
    """TRIP-1398 — 생성은 경로 감점이 0 이라 하루 한가운데 먼 곳이 끼었다(광화문 + 북한산)."""
    from trippilot.api import schemas
    from trippilot.api.wiring import KST, _GENERATE_ROUTE_WEIGHT, _domain_generate_request

    domain = _domain_generate_request(
        schemas.GenerateItineraryRequest.model_validate(_request()), KST)
    assert domain.travel_weight == _GENERATE_ROUTE_WEIGHT > 0
    # 숙소는 오가는 곳 — 숙소 거리는 고르는 기준이 아니다(2026-10-19). 재계획 경로는 기본 False.
    assert domain.ignore_anchor_distance is True


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


def test_validate_measures_hc2_with_the_trip_transport() -> None:
    """편집·되돌리기 재검증 — 수단이 오면 HC2 를 그 수단으로 잰다(repair 와 같은 `transport_modes`·첫 인식 토큰).

    간격을 자차 이동에 딱 맞췄다. 종전엔 수단 칸이 없어 대중교통으로 재 자차 여행의 [적용]·수동 편집이 HC2 로 표시됐다.
    칸이 없으면 종전 그대로(대중교통) — 같은 간격이 HC2 다.
    """
    p1, p6 = _POIS[0].coord, _POIS[5].coord  # ≈3.5km
    car, public = (TravelEstimator(AssemblyConfig()).estimate(p1, p6, m).internal_minutes
                   for m in (TransportMode.CAR, TransportMode.PUBLIC))
    assert car < public  # 전제 — 자차로는 닿고 대중교통으로는 모자란 간격
    arrive = (datetime(2026, 8, 5, 11, 0) + timedelta(minutes=car)).time().isoformat()
    body = _validate_body(_payload([_slot("p1", "10:00:00", "11:00:00"), _slot("p6", arrive, "13:00:00")]))
    with make_client() as client:
        by_car = client.post("/ai/v1/itinerary/validate", json={**body, "transport_modes": ["택시", "자가용"]})
        absent = client.post("/ai/v1/itinerary/validate", json=body)
        by_public = client.post("/ai/v1/itinerary/validate", json={**body, "transport_modes": ["대중교통"]})

    assert by_car.status_code == absent.status_code == 200, (by_car.text, absent.text)
    assert by_car.json()["violations"] == []
    assert [v["code"] for v in absent.json()["violations"]] == ["HC2"]
    assert absent.json() == by_public.json()  # 칸이 없으면 대중교통 — 종전 판정과 같다


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
        assert revalidated.json() == {"violations": [], "unverified_slots": _hours_unknown(["p1", "p2"])}


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
    assert response.json() == {"repaired": None, "changes": [], "unverified_slots": _hours_unknown(["p1", "p2"])}


# ── ④-보강 미검증 보고 (TRIP-537) ────────────────────────────────────
# c2 규칙("정보 없음은 막지 않는다")은 그대로다 — 바뀌는 것은 **알린다**는 것뿐.


_UNREGISTERED = "zzz-not-in-poi-db"

# _VIOLATING 과 같은 시각 배치인데 두 번째 POI 만 미등록 — 등록돼 있으면 HC2 위반이
# 뜨는 간격이다. 즉 위반 0 은 "통과"가 아니라 "판정 못 함"이라는 것이 이 대조로 드러난다.
_UNVERIFIABLE = [
    _slot("p1", "10:00:00", "11:00:00"),
    _slot(_UNREGISTERED, "11:05:00", "12:00:00"),
]


def test_unregistered_poi_is_reported_as_unverified_not_as_pass() -> None:
    with make_client() as client:
        response = client.post(
            "/ai/v1/itinerary/validate", json=_validate_body(_payload(_UNVERIFIABLE))
        )

    assert response.status_code == 200
    body = response.json()
    # 위반은 없다 — HC2 를 아예 못 봤기 때문이다(같은 간격이 _VIOLATING 에선 HC2 다)
    assert [v for v in body["violations"] if v["code"] in ("HC1", "HC2")] == []
    assert body["unverified_slots"] == [
        {"poi_id": _UNREGISTERED, "reason_code": "NOT_REGISTERED", "detail": ""}
    ] + _hours_unknown(["p1"])  # 미등록이 먼저, 영업정보 없는 등록 POI 가 뒤
    for banned in _BANNED_TOKENS:                    # INV-3 — 새 필드에도 적용
        assert banned not in response.text, f"INV-3 위반: {banned!r}"


# 영업정보가 있는 픽스처 — 하루 종일 연다(HC1 이 실제로 적용되되 이 시나리오의 시각을 막지 않는다).
_POIS_WITH_HOURS = tuple(
    replace(p, open_hours=tuple(OpenHour(d, 0, 1440) for d in range(7))) for p in _POIS)


def test_fully_registered_itinerary_reports_no_unverified_slots() -> None:
    """전부 등록되고 영업정보가 있으면 빈 목록 = 모든 슬롯이 실제로 HC1·HC2 판정을 받았다."""
    with make_client(pois=_POIS_WITH_HOURS) as client:
        response = client.post(
            "/ai/v1/itinerary/validate", json=_validate_body(_payload(_VIOLATING))
        )

    assert response.status_code == 200
    body = response.json()
    assert body["unverified_slots"] == []
    assert any(v["code"] == "HC2" for v in body["violations"])   # 판정은 실제로 돌았다


def test_registered_poi_without_hours_is_hours_unknown_not_pass() -> None:
    """등록됐어도 영업정보가 없으면 HC1 은 못 봤다 — HOURS_UNKNOWN. HC2 는 판정됐다(위반이 나온다).

    상황 감지 INV-SA-2: 위반 0 만 보고 장소 감지가 이 슬롯을 '영업시간 확인'으로 접었다(원문 해석 실패 ≈ 8.5%).
    """
    with make_client() as client:
        response = client.post(
            "/ai/v1/itinerary/validate", json=_validate_body(_payload(_VIOLATING))
        )

    assert response.status_code == 200
    body = response.json()
    assert body["unverified_slots"] == _hours_unknown(["p1", "p2"])
    assert [v["code"] for v in body["violations"]] == ["HC2"]


# 해석에 실패하는 원문 꼴 둘(공유본 원문 23,712곳 중 2,005곳) — 원문은 있는데 영업 창이 0건이다. 백엔드는 원문이
# 있으면 영업시간을 안다고 보고(openingHoursKnown) 묻는다 — 그래서 위반 0 이 장소 감지에서 '확인'으로 접혔다.
_UNPARSED_HOURS = {"raw-winter": "09:00~18:00\n휴무: 동절기 휴장", "raw-words": "매일 오전 열시부터 저녁까지"}


class _BatchRows:
    """`/internal/pois/batch-get` 대역 — 받은 행을 그대로 돌려준다(HttpJson 구조 계약, 실 호출 0)."""

    def __init__(self, rows: list[dict]) -> None:
        self._rows = rows

    def request_json(self, method, url, *, params=None, body=None, headers=None):  # noqa: ANN001
        return self._rows


def _backend_pois(raw_hours: dict[str, str]) -> tuple[Poi, ...]:
    """정본 조회 어댑터(`BackendPoiDb`)의 실 행 매핑으로 만든 POI — 원문 → 영업 창 해석을 손으로 흉내내지 않는다."""
    rows = [
        {"poi_id": pid, "name_ko": pid, "category": "SIGHT", "lat": _ANCHOR.lat, "lng": _ANCHOR.lng,
         "opening_hours": raw, "source": "TOURAPI", "saved_count": 0, "data_quality": "FULL"}
        for pid, raw in raw_hours.items()
    ]
    return BackendPoiDb(_BatchRows(rows), "http://backend.test", "t").lookup_by_ids(frozenset(raw_hours)).pois


def test_unparsed_hours_raw_is_reported_as_hours_unknown() -> None:
    """재현 둘 — 원문을 해석하지 못하면 영업 창 0건 → HC1 미적용 → `HOURS_UNKNOWN` 으로 실린다(상황 감지 INV-SA-2).

    대조군(해석되는 원문)은 같은 일정에서 HC1 판정을 받아 목록에 없다 — 셋의 차이는 원문 해석뿐이다.
    """
    pois = _backend_pois({**_UNPARSED_HOURS, "raw-ok": "09:00~18:00"})
    assert {p.poi_id: len(p.open_hours) for p in pois} == {"raw-winter": 0, "raw-words": 0, "raw-ok": 7}  # 전제
    itinerary = _payload([
        _slot("raw-winter", "10:00:00", "11:00:00"),
        _slot("raw-words", "13:00:00", "14:00:00"),
        _slot("raw-ok", "16:00:00", "17:00:00"),
    ])

    with make_client(pois=pois) as client:
        response = client.post("/ai/v1/itinerary/validate", json=_validate_body(itinerary))

    assert response.status_code == 200
    assert response.json() == {"violations": [], "unverified_slots": _hours_unknown(["raw-winter", "raw-words"])}


def test_repair_also_reports_unverified_slots() -> None:
    """Plan-B 는 validate 없이 repair 만 부르기도 한다 — 같은 침묵이 되돌아오면 안 된다."""
    with make_client() as client:
        response = client.post(
            "/ai/v1/itinerary/repair",
            json={"itinerary": _payload(_UNVERIFIABLE), "violations": [],
                  "request_meta": _meta()},
        )

    assert response.status_code == 200
    assert response.json()["unverified_slots"] == [
        {"poi_id": _UNREGISTERED, "reason_code": "NOT_REGISTERED", "detail": ""}
    ] + _hours_unknown(["p1"])


# ── ⑤ 에러 계약 ──────────────────────────────────────────────────────


def test_contradictory_fixed_blocks_return_409() -> None:
    """같은 POI를 겹치는 시각에 이중 고정 → 모든 어셈블리 단계 실패 → 409 (d08, 500 아님)."""
    conflicting = (
        {"poi_id": "p1", "date": _DAY1.isoformat(), "start": "10:00", "dwell_min": 60},
        {"poi_id": "p1", "date": _DAY1.isoformat(), "start": "10:30", "dwell_min": 60},
    )
    with make_client() as client:
        response = client.post(
            "/ai/v1/itinerary/generate", json=_request(fixed_blocks=conflicting)
        )

    assert response.status_code == 409, response.text
    body = response.json()
    assert body["error_code"] == "ASSEMBLY_CONFLICT"
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
