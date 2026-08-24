"""TRIP-348 — 수집 커서 이어가기 (재개·기제안 스킵·완주 마킹·상태 왕복).

실 호출 0 — fake HTTP + 내장 픽스처만. 검증:
① 재개: 커서 상태 → 그 pageNo부터 시작 (fake가 받은 pageNo 시퀀스로 검증)
② 스킵: 색인 항목(기제안·modifiedtime 동일)은 미수록 + 상세 호출 0 + 카운트
③ modifiedtime 변경 항목은 재수록 (갱신 제안) + 색인 갱신
④ 상태 왕복: 실행 후 기록된 상태(직렬화→파싱)로 다음 실행이 이어서 재개
⑤ 손상·부재 상태 → 처음부터 + WARNING (우아한 강등)
⑥ 완주 마킹 → 다음 실행은 처음부터 재순회하되 색인 스킵으로 싸게 통과
⑦ PBT: 임의 색인·픽스처에서 "스킵된 항목은 산출에 없고 상세 호출도 없다"
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.poi_curation.sourcing.pipeline import collect
from trippilot.poi_curation.sourcing.state import (
    CollectState,
    KindCursor,
    load_state,
    parse_state,
    state_to_dict,
)
from trippilot.poi_curation.sourcing.tourapi import TourApiAdapter

from tests.fakes.fake_tourapi_http import FakeTourApiHttp, envelope, list_item

_PIPELINE_LOGGER = "trippilot.poi_curation.sourcing.pipeline"
_STATE_LOGGER = "trippilot.poi_curation.sourcing.state"
_MTIME = "20260801120000"  # list_item 기본 modifiedtime


def _adapter(http: FakeTourApiHttp) -> TourApiAdapter:
    return TourApiAdapter(http, "test-key")


def _two_page_http() -> FakeTourApiHttp:
    """kind=12, rows=2 기준 2페이지 픽스처 (총 4건)."""
    return FakeTourApiHttp(pages={
        ("12", 1): envelope([list_item("100", "성산일출봉"),
                             list_item("101", "만장굴")], 4),
        ("12", 2): envelope([list_item("102", "천지연폭포"),
                             list_item("103", "협재해수욕장")], 4, page_no=2),
    })


def _list_page_nos(http: FakeTourApiHttp) -> list[str]:
    return [p["pageNo"] for url, p in http.calls if url.endswith("/areaBasedList2")]


def _detail_ids(http: FakeTourApiHttp) -> list[str]:
    return [p["contentId"] for url, p in http.calls if url.endswith("/detailIntro2")]


def _proposal_refs(result) -> set[str]:
    return {p.candidate.source_ref for p in result.report.passed}


# ── ① 재개 — 커서 pageNo부터 시작 ─────────────────────────────────
def test_resume_starts_from_cursor_page(caplog) -> None:
    http = _two_page_http()
    state = CollectState(cursors={("39", "12"): KindCursor(next_page=2)})
    with caplog.at_level(logging.INFO, logger=_PIPELINE_LOGGER):
        result = collect(_adapter(http), area_code="39", content_types=["12"],
                         max_calls=500, rows_per_page=2, state=state)
    assert _list_page_nos(http) == ["2"]             # 1페이지 재확인 없음
    assert result.stats.resumed_from == {"12": 2}
    assert "재개: kind=12 page=2부터" in caplog.text
    assert _proposal_refs(result) == {"102", "103"}


def test_resume_ignores_cursor_of_other_area() -> None:
    """커서는 (지역, 타입) 단위 — 다른 지역 커서로는 재개하지 않는다."""
    http = _two_page_http()
    state = CollectState(cursors={("1", "12"): KindCursor(next_page=2)})
    result = collect(_adapter(http), area_code="39", content_types=["12"],
                     max_calls=500, rows_per_page=2, state=state)
    assert _list_page_nos(http) == ["1", "2"]
    assert result.stats.resumed_from == {}


# ── ② 스킵 — 기제안·변경 없음은 미수록 + 상세 호출 0 ──────────────
def test_skip_unchanged_no_proposal_and_no_detail_call() -> None:
    http = _two_page_http()
    state = CollectState(proposed={"100": _MTIME, "103": _MTIME})
    result = collect(_adapter(http), area_code="39", content_types=["12"],
                     max_calls=500, rows_per_page=2, state=state)
    assert result.stats.skipped_unchanged == 2
    assert _proposal_refs(result) == {"101", "102"}   # 색인 항목 미수록
    assert set(_detail_ids(http)) == {"101", "102"}   # 스킵 항목은 상세 호출도 안 나감
    assert result.stats.listed == 2                   # 스킵은 목록 확보분에서도 제외


# ── ③ modifiedtime 변경 항목은 재수록 (갱신 제안) ─────────────────
def test_changed_modifiedtime_is_reproposed_and_index_updated() -> None:
    http = _two_page_http()
    state = CollectState(proposed={"100": "20250101000000"})  # 과거 mtime
    result = collect(_adapter(http), area_code="39", content_types=["12"],
                     max_calls=500, rows_per_page=2, state=state)
    assert result.stats.skipped_unchanged == 0
    assert "100" in _proposal_refs(result)            # 갱신 제안으로 재수록
    assert "100" in _detail_ids(http)
    assert result.next_state.proposed["100"] == _MTIME  # 색인은 새 mtime으로 갱신


# ── ④ 상태 왕복 — 기록된 상태로 다음 실행이 이어서 재개 ────────────
def test_state_roundtrip_resumes_next_run() -> None:
    # 1차: 예산 3 → 목록 p1 + 상세 2건에서 소진, p2 미도달
    first_http = _two_page_http()
    first = collect(_adapter(first_http), area_code="39", content_types=["12"],
                    max_calls=3, rows_per_page=2)
    assert first.stats.budget_exhausted
    assert first.next_state.cursors[("39", "12")] == KindCursor(next_page=2)
    assert set(first.next_state.proposed) == {"100", "101"}

    # 직렬화 → 파싱 왕복 (스크립트 기록 경로와 동일한 형태)
    text = json.dumps(state_to_dict(first.next_state,
                                    last_run={"at": "2026-08-11T04:00:00+00:00"}),
                      ensure_ascii=False)
    restored = parse_state(text)
    assert restored.cursors == dict(first.next_state.cursors)
    assert restored.proposed == dict(first.next_state.proposed)

    # 2차: 복원 상태로 p2부터 재개 — p1 재확인 없이 나머지만 수집
    second_http = _two_page_http()
    second = collect(_adapter(second_http), area_code="39", content_types=["12"],
                     max_calls=500, rows_per_page=2, state=restored)
    assert _list_page_nos(second_http) == ["2"]
    assert _proposal_refs(second) == {"102", "103"}
    assert set(second.next_state.proposed) == {"100", "101", "102", "103"}
    assert second.next_state.cursors[("39", "12")] == KindCursor(next_page=1,
                                                                 completed=True)


# ── ⑤ 손상·부재 상태 → 처음부터 + WARNING (우아한 강등) ────────────
def test_corrupt_state_file_degrades_with_warning(tmp_path: Path, caplog) -> None:
    path = tmp_path / "collect_state.json"
    path.write_text("{손상된 JSON", encoding="utf-8")
    with caplog.at_level(logging.WARNING, logger=_STATE_LOGGER):
        state = load_state(path)
    assert state.cursors == {} and state.proposed == {}
    assert "상태 파일 손상" in caplog.text


def test_missing_state_file_degrades_with_warning(tmp_path: Path, caplog) -> None:
    with caplog.at_level(logging.WARNING, logger=_STATE_LOGGER):
        state = load_state(tmp_path / "없는파일.json")
    assert state.cursors == {} and state.proposed == {}
    assert "상태 파일 없음" in caplog.text


@pytest.mark.parametrize("text", [
    json.dumps({"schema_version": 99, "cursors": {}, "proposed": {}}),  # 버전 불일치
    json.dumps({"schema_version": 1, "cursors": {"39": {"12": {"next_page": 0,
                "completed": False}}}, "proposed": {}}),                # 커서 값 오류
    json.dumps({"schema_version": 1, "cursors": {}, "proposed": {"100": 1}}),
    json.dumps([1, 2, 3]),                                              # 객체 아님
])
def test_parse_state_is_all_or_nothing(text: str) -> None:
    """일부 손상이면 전체 거부 — 쓰기 경로 입력의 관용 파싱 금지 (안티패턴 로그)."""
    with pytest.raises(ValueError):
        parse_state(text)


# ── ⑥ 완주 마킹 → 재순회는 색인 스킵으로 싸게 ─────────────────────
def test_full_run_marks_kind_completed() -> None:
    result = collect(_adapter(_two_page_http()), area_code="39",
                     content_types=["12"], max_calls=500, rows_per_page=2)
    assert result.next_state.cursors[("39", "12")].completed
    assert result.stats.completed_kinds == ("12",)


def test_completed_kind_retraverses_cheaply_with_index_skips() -> None:
    full = collect(_adapter(_two_page_http()), area_code="39",
                   content_types=["12"], max_calls=500, rows_per_page=2)
    http = _two_page_http()
    rerun = collect(_adapter(http), area_code="39", content_types=["12"],
                    max_calls=500, rows_per_page=2, state=full.next_state)
    assert _list_page_nos(http) == ["1", "2"]        # 처음부터 재순회하되
    assert _detail_ids(http) == []                   # 상세 호출 0 — 싸게 통과
    assert rerun.stats.http_calls == 2
    assert rerun.stats.skipped_unchanged == 4 and rerun.stats.passed == 0
    assert rerun.stats.completed_kinds == ("12",)    # 완주 상태 유지
    assert rerun.next_state.proposed == dict(full.next_state.proposed)


def test_budget_exhausted_before_kind_keeps_prior_cursor() -> None:
    """호출 0건인 kind는 커서를 건드리지 않는다 — 완주 마킹 보존."""
    state = CollectState(cursors={("39", "39"): KindCursor(next_page=1,
                                                           completed=True)})
    http = _two_page_http()
    result = collect(_adapter(http), area_code="39", content_types=["12", "39"],
                     max_calls=1, rows_per_page=2, state=state)  # kind=12에서 소진
    assert result.next_state.cursors[("39", "39")] == KindCursor(next_page=1,
                                                                 completed=True)


# ── ⑦ PBT — 스킵된 항목은 산출에 없고 상세 호출도 없다 ─────────────
_pbt_items = st.lists(
    st.tuples(st.integers(min_value=1, max_value=9999), st.booleans()),
    min_size=0, max_size=12, unique_by=lambda t: t[0],
)


@settings(max_examples=40, deadline=None)
@given(pairs=_pbt_items)
def test_pbt_skipped_items_absent_from_output_and_calls(pairs) -> None:
    """임의 기제안 색인·픽스처: 색인 항목(변경 없음)은 제안·상세 호출 어디에도 없다."""
    items = [list_item(str(ref), f"장소{ref}") for ref, _ in pairs]
    known = {str(ref) for ref, proposed in pairs if proposed}
    http = FakeTourApiHttp(pages={("12", 1): envelope(items, len(items))})
    result = collect(_adapter(http), area_code="39", content_types=["12"],
                     max_calls=500,
                     state=CollectState(proposed={r: _MTIME for r in known}))
    assert _proposal_refs(result) & known == set()
    assert set(_detail_ids(http)) & known == set()
    assert result.stats.skipped_unchanged == len(known)
    assert result.stats.listed == len(items) - len(known)
    # 통계 정합은 스킵 하에서도 유지 (기존 불변식의 확장)
    s = result.stats
    assert s.passed + sum(s.gate_drops.values()) + s.merged \
        + s.category_unmapped + s.address_missing == s.listed
