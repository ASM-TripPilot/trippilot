"""TRIP-350 — generate 응답 `unplaced_must_visits` 회신 필드.

백엔드와 PR #104에서 확정한 계약의 AI측 구현 검증. 배경(TRIP-328): 백엔드가 기간 밖
must_visit을 fixed_blocks에 실어 보내면 HC3가 범위 밖 날짜를 스킵해 **침묵 드롭**됐다
— 응답만 보면 "왜 안 들어갔는지" 알 수 없었다. 이 필드가 그 보고 채널이다.

증명하는 것:
  ① e2e 관통(실 조립): 전부 배치 → 빈 배열 / 기간 밖 블록 → 200 + OUT_OF_RANGE
     (침묵 드롭 해소 — 종전에는 응답만으로 구분 불가였던 케이스)
  ② day1 2단계(TRIP-293) 오보 금지: 기간 안·2차로 미뤄진 일자 블록은 보고하지 않는다
  ③ 판정 규칙 단위 검증(judge_unplaced_must_visits — 순수 함수):
     WINDOW_CONFLICT는 요청 fixed_blocks끼리 창 겹침이 **증명될 때만**, 그 외
     미배치는 NO_FEASIBLE_SLOT, 기간 밖은 겹침보다 우선(OUT_OF_RANGE)
  ④ 직렬화: reason_code 닫힌 집합(Literal) + INV-3 토큰 부재
  ⑤ 409 회귀: 해소 불가 모순은 여전히 409 — 200 부분 성공 채널이 409를 약화시키지 않는다
  ⑥ PBT: 모든 fixed_block은 {배치됨, 유예(2차 소관), unplaced 보고됨} 중 정확히
     하나에 속한다 — 완전성·건전성
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from pydantic import ValidationError

from trippilot.api import schemas
from trippilot.api.wiring import (
    KST,
    REASON_NO_FEASIBLE_SLOT,
    REASON_OUT_OF_RANGE,
    REASON_WINDOW_CONFLICT,
    judge_unplaced_must_visits,
)
from trippilot.domain.common import PoiId, ScheduleId
from trippilot.domain.itinerary import (
    DaySolution,
    ItinerarySolution,
    SolveMode,
    VisitSlot,
)

from tests.test_e2e_boundary import (
    _BANNED_TOKENS,
    _DAY1,
    _DAY2,
    _request,
    _slot_ids,
    make_client,
)

_DAY_OUT = date(2026, 8, 20)  # 여행 기간(8/5~8/6) 밖


# ── 판정 입력 빌더 (순수 함수 단위 검증·PBT 공용) ─────────────────────


def _schema_request(
    *,
    trip_start: date,
    trip_end: date,
    requested_days: tuple[date, ...],
    fixed_blocks: tuple[dict, ...],
) -> schemas.GenerateItineraryRequest:
    body = _request(dates=requested_days, fixed_blocks=fixed_blocks)
    body["trip_context"]["start_date"] = trip_start.isoformat()
    body["trip_context"]["end_date"] = trip_end.isoformat()
    return schemas.GenerateItineraryRequest.model_validate(body)


def _block(poi_id: str, d: date, start: str, dwell_min: int = 60) -> dict:
    return {"poi_id": poi_id, "date": d.isoformat(), "start": start,
            "dwell_min": dwell_min}


def _slot_for(block: dict) -> VisitSlot:
    """블록과 poi·시각 정확 일치(HC3 기준) 슬롯 — '배치됨'을 구성한다."""
    start = datetime.combine(
        date.fromisoformat(block["date"]),
        time.fromisoformat(block["start"]),
        tzinfo=KST,
    )
    return VisitSlot(
        poi_id=PoiId(block["poi_id"]), start_at=start,
        end_at=start + timedelta(minutes=block["dwell_min"]),
        stay_min=block["dwell_min"], score=0.0, is_llm_score=False,
    )


def _solution(days: tuple[date, ...], slots: tuple[VisitSlot, ...]) -> ItinerarySolution:
    by_day: dict[date, list[VisitSlot]] = {d: [] for d in days}
    for s in slots:
        by_day.setdefault(s.start_at.date(), []).append(s)
    return ItinerarySolution(
        schedule_id=ScheduleId("s-350"),
        days=tuple(
            DaySolution(date=d, slots=tuple(sorted(ss, key=lambda s: s.start_at)),
                        fixed_blocks=())
            for d, ss in sorted(by_day.items())
        ),
        is_fallback=False,
        solve_mode=SolveMode.OR_TOOLS,
        assembly_run=None,
    )


# ── ① e2e 관통 (실 조립 — HTTP → 판정 → 직렬화) ──────────────────────


def test_all_placed_yields_empty_report() -> None:
    """전부 배치(기간 안 고정 블록 포함) → unplaced_must_visits == [] (기본값 증명)."""
    fixed = (_block("p1", _DAY1, "10:00"),)
    with make_client() as client:
        response = client.post(
            "/ai/v1/itinerary/generate", json=_request(fixed_blocks=fixed)
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert "p1" in _slot_ids(body)
    assert body["unplaced_must_visits"] == []


def test_out_of_range_block_is_reported_not_silently_dropped() -> None:
    """침묵 드롭(TRIP-328) 해소: 기간 밖 블록 → 200 + OUT_OF_RANGE 보고.

    종전에는 HC3가 범위 밖 날짜를 스킵해 200 응답만으로는 "요청이 무시됐다"는
    사실 자체를 알 수 없었다 — 이제 응답이 스스로 증언한다.
    """
    out_of_range = (_block("p9", _DAY_OUT, "10:00"),)
    with make_client() as client:
        response = client.post(
            "/ai/v1/itinerary/generate",
            json=_request(dates=(_DAY1,), fixed_blocks=out_of_range),
        )

    assert response.status_code == 200, response.text  # 409 아님 — 부분 성공
    body = response.json()
    assert "p9" not in _slot_ids(body)  # 여전히 해에는 없다 (지어내지 않는다)
    assert body["unplaced_must_visits"] == [
        {"poi_id": "p9", "reason_code": "OUT_OF_RANGE"}
    ]


# ── ② day1 2단계 오보 금지 (TRIP-293) ────────────────────────────────


def test_phase1_does_not_misreport_deferred_day2_block() -> None:
    """기간 안(day2)·이 요청의 time_windows 밖 블록 = 2차 소관 — 보고하지 않는다."""
    deferred = (_block("p2", _DAY2, "10:00"),)
    body = _request(dates=(_DAY1,), fixed_blocks=deferred)
    body["trip_context"]["end_date"] = _DAY2.isoformat()  # 여행 기간은 day2까지

    with make_client() as client:
        response = client.post("/ai/v1/itinerary/generate", json=body)

    assert response.status_code == 200, response.text
    assert response.json()["unplaced_must_visits"] == []


# ── ③ 판정 규칙 단위 검증 (순수 함수) ────────────────────────────────


def test_window_conflict_only_when_overlap_is_proven() -> None:
    """기간 안 미배치 2건: 겹침 증명된 쪽만 WINDOW_CONFLICT, 없는 쪽은 NO_FEASIBLE_SLOT."""
    placed = _block("pA", _DAY1, "10:00")
    overlapping = _block("pB", _DAY1, "10:30")   # pA(10:00~11:00)와 겹침
    disjoint = _block("pC", _DAY1, "15:00")      # 누구와도 겹치지 않음
    request = _schema_request(
        trip_start=_DAY1, trip_end=_DAY1, requested_days=(_DAY1,),
        fixed_blocks=(placed, overlapping, disjoint),
    )
    solution = _solution((_DAY1,), (_slot_for(placed),))  # pB·pC 미배치

    report = judge_unplaced_must_visits(request, solution, KST)

    assert [(r.poi_id, r.reason_code) for r in report] == [
        ("pB", REASON_WINDOW_CONFLICT),
        ("pC", REASON_NO_FEASIBLE_SLOT),
    ]


def test_out_of_range_takes_precedence_over_overlap() -> None:
    """기간 밖 블록은 겹침이 있어도 OUT_OF_RANGE — 계약상 WINDOW_CONFLICT는 '기간 안' 전제."""
    outside_a = _block("pA", _DAY_OUT, "10:00")
    outside_b = _block("pB", _DAY_OUT, "10:30")  # 서로 겹치지만 둘 다 기간 밖
    request = _schema_request(
        trip_start=_DAY1, trip_end=_DAY1, requested_days=(_DAY1,),
        fixed_blocks=(outside_a, outside_b),
    )
    report = judge_unplaced_must_visits(request, _solution((_DAY1,), ()), KST)

    assert {(r.poi_id, r.reason_code) for r in report} == {
        ("pA", REASON_OUT_OF_RANGE), ("pB", REASON_OUT_OF_RANGE),
    }


def test_placed_block_never_reported() -> None:
    """배치됨(HC3 기준 정확 일치) → 보고 제외 — '정확히 한 번' 분할의 배치측."""
    block = _block("pA", _DAY1, "10:00")
    request = _schema_request(
        trip_start=_DAY1, trip_end=_DAY1, requested_days=(_DAY1,),
        fixed_blocks=(block,),
    )
    report = judge_unplaced_must_visits(
        request, _solution((_DAY1,), (_slot_for(block),)), KST
    )
    assert report == ()


# ── ④ 직렬화 — 닫힌 집합 · INV-3 ─────────────────────────────────────


def test_reason_code_is_closed_set() -> None:
    """미지 reason_code는 스키마(Literal)가 거부한다 — 백엔드 분기 안전."""
    with pytest.raises(ValidationError):
        schemas.UnplacedMustVisitSchema(poi_id="p1", reason_code="LATE")
    ok = schemas.UnplacedMustVisitSchema(poi_id="p1", reason_code="NO_FEASIBLE_SLOT")
    assert ok.reason_code == "NO_FEASIBLE_SLOT"


def test_report_serialization_has_no_duration_tokens_inv3() -> None:
    """보고 필드가 실린 응답에도 소요시간류 토큰이 없다(INV-3)."""
    out_of_range = (_block("p9", _DAY_OUT, "10:00"),)
    with make_client() as client:
        response = client.post(
            "/ai/v1/itinerary/generate",
            json=_request(dates=(_DAY1,), fixed_blocks=out_of_range),
        )

    assert response.status_code == 200
    assert response.json()["unplaced_must_visits"]  # 보고가 실제로 실렸다
    for banned in _BANNED_TOKENS:
        assert banned not in response.text, f"INV-3/IO-3 위반: {banned!r}"


# ── ⑤ 409 회귀 — 보고 채널이 에러 계약을 약화시키지 않는다 ───────────


def test_contradictory_fixed_blocks_still_409_not_partial_success() -> None:
    """해소 불가 모순(같은 POI 이중 고정)은 여전히 409 — unplaced 200으로 위장 금지."""
    conflicting = (
        _block("p1", _DAY1, "10:00"),
        _block("p1", _DAY1, "13:00"),
    )
    with make_client() as client:
        response = client.post(
            "/ai/v1/itinerary/generate", json=_request(fixed_blocks=conflicting)
        )

    assert response.status_code == 409, response.text
    assert response.json()["error_code"] == "ASSEMBLY_CONFLICT"
    assert "unplaced_must_visits" not in response.text  # 오류 바디는 무변경


# ── ⑥ PBT — 완전성·건전성 (모든 블록은 정확히 한 범주) ───────────────


_BASE = date(2026, 8, 5)


@st.composite
def _cases(draw) -> tuple:  # noqa: ANN001 — hypothesis composite 규약
    period_len = draw(st.integers(min_value=1, max_value=4))
    period = tuple(_BASE + timedelta(days=i) for i in range(period_len))
    requested = tuple(sorted(draw(
        st.sets(st.sampled_from(period), min_size=1)
    )))
    n_blocks = draw(st.integers(min_value=0, max_value=5))
    blocks: list[tuple[dict, bool]] = []
    for i in range(n_blocks):
        offset = draw(st.integers(min_value=-2, max_value=period_len + 1))
        hour = draw(st.integers(min_value=8, max_value=19))
        minute = draw(st.sampled_from((0, 30)))
        dwell = draw(st.integers(min_value=30, max_value=120))
        try_place = draw(st.booleans())
        blocks.append((
            _block(f"b{i}", _BASE + timedelta(days=offset),
                   f"{hour:02d}:{minute:02d}", dwell),
            try_place,
        ))
    return period, requested, tuple(blocks)


def _window(block: dict) -> tuple[datetime, datetime]:
    start = datetime.combine(
        date.fromisoformat(block["date"]),
        time.fromisoformat(block["start"]), tzinfo=KST,
    )
    return start, start + timedelta(minutes=block["dwell_min"])


@settings(max_examples=100)
@given(_cases())
def test_pbt_every_block_in_exactly_one_category(case: tuple) -> None:
    """완전성·건전성: 모든 fixed_block은 {배치됨, 유예, unplaced 보고됨} 중 정확히 하나.

    - 배치됨(해에 정확 일치 슬롯) → 절대 보고되지 않는다 (건전성)
    - 유예(기간 안 ∧ 이 요청의 일자 밖 ∧ 미배치) → 보고되지 않는다 (2차 소관 — 오보 금지)
    - 그 외 미배치 → 반드시 보고된다 (완전성 — 침묵 드롭 0), 사유는:
      기간 밖 ⇔ OUT_OF_RANGE / 겹침 증명 ⇒ WINDOW_CONFLICT / 겹침 없음 ⇒ NO_FEASIBLE_SLOT
    """
    period, requested, blocks = case
    trip_start, trip_end = period[0], period[-1]
    # '배치'는 요청된 일자에서만 성립한다(어셈블리는 요청 일자만 푼다)
    placed = tuple(
        b for b, try_place in blocks
        if try_place and date.fromisoformat(b["date"]) in set(requested)
    )
    request = _schema_request(
        trip_start=trip_start, trip_end=trip_end, requested_days=requested,
        fixed_blocks=tuple(b for b, _ in blocks),
    )
    solution = _solution(requested, tuple(_slot_for(b) for b in placed))

    report = judge_unplaced_must_visits(request, solution, KST)
    reported = {r.poi_id: r.reason_code for r in report}
    placed_ids = {b["poi_id"] for b in placed}

    for b, _ in blocks:
        poi, d = b["poi_id"], date.fromisoformat(b["date"])
        in_period = trip_start <= d <= trip_end
        if poi in placed_ids:                      # 배치됨 → 미보고
            assert poi not in reported
        elif in_period and d not in set(requested):  # 유예 → 미보고 (오보 금지)
            assert poi not in reported
        elif not in_period:                        # 기간 밖 → OUT_OF_RANGE
            assert reported[poi] == REASON_OUT_OF_RANGE
        else:                                      # 판정 대상 일자 미배치 → 보고 필수
            s1, e1 = _window(b)
            overlap = any(
                other is not b and s1 < _window(other)[1] and _window(other)[0] < e1
                for other, _ in blocks
            )
            expected = (REASON_WINDOW_CONFLICT if overlap
                        else REASON_NO_FEASIBLE_SLOT)
            assert reported[poi] == expected

    # 건전성: 보고된 poi는 전부 요청 블록에서 나왔다 (지어낸 보고 없음)
    assert set(reported) <= {b["poi_id"] for b, _ in blocks}
