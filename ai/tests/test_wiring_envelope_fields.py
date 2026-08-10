"""TRIP-341 — generate 봉투 부가 필드(candidates_summary·day1_ready_at·distance_ranges) 실값 관통.

기존에는 wiring이 네 필드를 상시 null/빈 값으로 내보냈다("산출 구조체 필드를 기본값으로
채워 넘기지 말 것" 안티패턴의 그 모양). 코드가 실제로 아는 사실만 채운다:

  ① candidates_summary: M7 풀 실측(BR-U2-05) — level·pool_size·shortfall_categories
  ② day1_ready_at: 주입 now + 단조시계 경과. **이 응답이 여행 1일차를 포함할 때만** —
     2차 생성(나머지 일자) 응답에는 null (지어내지 않는다)
  ③ distance_range: 직전 지점(첫 슬롯=그 날의 앵커)과의 거리 문자열(BR-U2-08) —
     거리만, 소요시간류 토큰 0 (INV-3 — 이번 작업 최대 위험 지점)
  ④ freshness: 도메인 Poi에 수집 시각 메타가 없다 → **계속 null** (풀 생성 시각을
     수집 시각인 척 싣지 않는다)
  ⑤ repair 봉투: 원 요청 컨텍스트가 없다 → 부가 필드는 기존대로 null/빈 값

스타일·조립은 test_e2e_boundary.py와 동일(실 조립 + fake 어댑터, 실 호출 0 — D37).
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone

from trippilot.api.wiring import _distance_ranges
from trippilot.solver_engine.config import SolverConfig
from trippilot.solver_engine.travel import TravelEstimator
from trippilot.domain.common import GeoPoint, PoiId, ScheduleId, TransportMode
from trippilot.domain.itinerary import DaySolution, ItinerarySolution, SolveMode, VisitSlot

from tests.test_e2e_boundary import (
    _ANCHOR,
    _BANNED_TOKENS,
    _DAY1,
    _DAY2,
    _meta,
    _request,
    make_client,
)

_KST = timezone(timedelta(hours=9))

# 계약 예시 "약 1.2km · 도보 추정" (protocols.py · backend Itinerary.kt BR-U2-08).
# e2e 요청의 transport_modes=["대중교통"] → PUBLIC 라벨.
_DISTANCE_PATTERN = re.compile(r"^약 \d+\.\dkm · 대중교통 추정$")


# ── ① candidates_summary — 풀 실측 관통 ─────────────────────────────


def test_generate_candidates_summary_reflects_pool_facts() -> None:
    """e2e 풀 = p1..p6 전부 SIGHT → LOW · pool_size=6 · 나머지 7개 카테고리 부족."""
    with make_client() as client:
        response = client.post("/ai/v1/itinerary/generate", json=_request())

    assert response.status_code == 200, response.text
    summary = response.json()["candidates_summary"]
    assert summary is not None
    assert summary["level"] == "LOW"
    assert summary["pool_size"] == 6
    assert set(summary["shortfall_categories"]) == {
        "FOOD", "CAFE", "NIGHT_VIEW", "NATURE", "CULTURE", "ACTIVITY", "SHOPPING"
    }


# ── ② day1_ready_at — 시계 파생 + 1일차 포함 조건 ────────────────────


def test_generate_day1_ready_at_comes_from_injected_clock() -> None:
    """정지 FakeClock(경과 0) → day1_ready_at == requested_at (wall-clock 미개입)."""
    with make_client() as client:
        response = client.post("/ai/v1/itinerary/generate", json=_request())

    assert response.status_code == 200, response.text
    ready_at = response.json()["day1_ready_at"]
    assert ready_at is not None
    assert datetime.fromisoformat(ready_at) == datetime.fromisoformat(
        _meta()["requested_at"]
    )


def test_generate_day1_ready_at_null_on_phase2_without_trip_day1() -> None:
    """2차 생성(여행 1일차 미포함) 응답에는 1일차 준비 시각을 지어 싣지 않는다."""
    phase2 = _request(dates=(_DAY2,))
    phase2["trip_context"]["start_date"] = _DAY1.isoformat()  # 여행 자체는 DAY1 시작

    with make_client() as client:
        response = client.post("/ai/v1/itinerary/generate", json=phase2)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["day1_ready_at"] is None
    assert body["candidates_summary"] is not None  # 다른 부가 필드는 독립적으로 산출


# ── ③ distance_range — 값 존재 + INV-3 (거리만) ──────────────────────


def test_generate_slots_carry_distance_only_strings() -> None:
    with make_client() as client:
        response = client.post("/ai/v1/itinerary/generate", json=_request())

    assert response.status_code == 200, response.text
    slots = [s for d in response.json()["days"] for s in d["slots"]]
    assert slots
    for slot in slots:  # 첫 슬롯 포함 전부 — 직전 지점(앵커·앞 슬롯) 좌표를 안다
        rendered = slot["distance_range"]
        assert rendered is not None
        assert _DISTANCE_PATTERN.fullmatch(rendered), rendered
        # INV-3: 소요시간류 언급 0 — 한국어 "분"·숫자시각 표기까지 막는다
        assert "분" not in rendered and "시간" not in rendered
        for banned in _BANNED_TOKENS:
            assert banned not in rendered
    # 응답 전문에도 금지 토큰 0 (기존 e2e 가드와 동일 기준 재확인)
    for banned in _BANNED_TOKENS:
        assert banned not in response.text


# ── ④ freshness — 산출 불가는 계속 null (지어내지 않는다) ────────────


def test_generate_freshness_stays_null_no_collection_meta_in_domain() -> None:
    with make_client() as client:
        response = client.post("/ai/v1/itinerary/generate", json=_request())

    assert response.status_code == 200, response.text
    assert response.json()["freshness"] is None


# ── ⑤ repair 봉투 — 원 컨텍스트가 없어 부가 필드는 그대로 null ───────


def test_repair_envelope_keeps_extras_null() -> None:
    itinerary = {
        "days": [{"date": _DAY1.isoformat(), "slots": [
            {"poi_id": "p1", "start_at": "10:00:00", "end_at": "11:00:00",
             "ends_next_day": False, "distance_range": None, "is_fixed": False},
            {"poi_id": "p2", "start_at": "11:05:00", "end_at": "12:00:00",
             "ends_next_day": False, "distance_range": None, "is_fixed": False},
        ]}],
        "day1_ready_at": None,
        "explanations": {},
        "solve_mode": "OR_TOOLS",
        "is_fallback": False,
        "freshness": None,
        "candidates_summary": None,
    }
    with make_client() as client:
        response = client.post(
            "/ai/v1/itinerary/repair",
            json={"itinerary": itinerary,
                  "violations": [{"code": "HC2", "slot_ref": "p2",
                                  "detail": "이동시간 부족"}],
                  "request_meta": _meta()},
        )

    assert response.status_code == 200, response.text
    repaired = response.json()["repaired"]
    assert repaired is not None
    assert repaired["day1_ready_at"] is None
    assert repaired["candidates_summary"] is None
    assert repaired["freshness"] is None


# ── 화이트박스: 좌표 미상 구간은 산출하지 않고 다음 구간까지 전파 ────


def _slot(poi_id: str, hh: int) -> VisitSlot:
    start = datetime(2026, 8, 5, hh, 0, tzinfo=_KST)
    return VisitSlot(
        poi_id=PoiId(poi_id), start_at=start, end_at=start + timedelta(hours=1),
        stay_min=60, score=0.0, is_llm_score=False,
    )


def test_distance_ranges_skip_unknown_coords_and_anchorless_days() -> None:
    day1 = DaySolution(
        date=_DAY1,
        slots=(_slot("p1", 10), _slot("px", 12), _slot("p2", 14)),  # px 좌표 미상
        fixed_blocks=(),
    )
    day2 = DaySolution(date=_DAY2, slots=(_slot("p1", 10), _slot("p2", 12)),
                       fixed_blocks=())
    solution = ItinerarySolution(
        schedule_id=ScheduleId("s-1"), days=(day1, day2), is_fallback=False,
        solve_mode=SolveMode.OR_TOOLS, solver_run=None,
    )
    coords: dict[PoiId, GeoPoint] = {
        PoiId("p1"): GeoPoint(_ANCHOR.lat + 0.01, _ANCHOR.lng),
        PoiId("p2"): GeoPoint(_ANCHOR.lat + 0.02, _ANCHOR.lng),
    }
    anchors: dict[date, GeoPoint] = {_DAY1: _ANCHOR}  # DAY2는 앵커 없음

    rendered = _distance_ranges(
        solution, anchors, coords, TravelEstimator(SolverConfig()),
        TransportMode.PUBLIC,
    )

    assert set(rendered) == {
        f"{_DAY1.isoformat()}#p1",        # 앵커 → p1
        f"{_DAY2.isoformat()}#p2",        # p1 → p2 (앵커 없는 날의 둘째 슬롯부터)
    }
    # px(좌표 미상) 자신과 그 다음 구간(px→p2)은 산출하지 않는다 — 지어내지 않는다
    assert f"{_DAY1.isoformat()}#px" not in rendered
    assert f"{_DAY1.isoformat()}#p2" not in rendered
    assert f"{_DAY2.isoformat()}#p1" not in rendered  # 첫 슬롯인데 앵커 좌표 미상
    for value in rendered.values():
        assert value.startswith("약 ") and "km" in value and "분" not in value
