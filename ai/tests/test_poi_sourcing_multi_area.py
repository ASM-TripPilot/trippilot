"""TRIP-246 후속 — 전국 다지역 공평 순회 + 키 3개 (실 호출 0, fake만).

검증:
① 균등 분할: 총 예산을 미완주 지역 수로 floor 분할 — 지역별 호출 분포 정확성
② 나머지·조기 종료분 이월: 회전 순서상 다음 지역으로 (라운드로빈 포인터 기준)
③ 라운드로빈 포인터 회전: 매 실행 다음 지역부터 시작 + 상태 왕복으로 이어짐
④ 완주 지역 후순위: 배분에서 제외, 잔여 예산으로만 마지막에
⑤ env 해석: 단수 TOURAPI_AREA_CODE 하위호환 · 기본 광역 17개
⑥ 키링 3개: k1→k2→k3 전환 시퀀스 (키당 상한 정확)
⑦ PBT: 임의 지역 수·키당 상한에서 "총 호출 ≤ 키 수×키당 상한 ∧ 격차 ≤ 1"
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.poi_curation.sourcing.pipeline import (
    AREA_NAMES,
    DEFAULT_AREA_CODES,
    collect_areas,
    resolve_area_codes,
    to_multi_output_document,
)
from trippilot.poi_curation.sourcing.state import (
    CollectState,
    KindCursor,
    parse_state,
    state_to_dict,
)
from trippilot.poi_curation.sourcing.tourapi import TourApiAdapter

from tests.fakes.fake_tourapi_http import (
    FakeTourApiHttp,
    envelope,
    intro_item,
    list_item,
)

_NOW = datetime(2026, 8, 11, 4, 0, tzinfo=UTC)


def _adapter(http: FakeTourApiHttp) -> TourApiAdapter:
    return TourApiAdapter(http, "test-key")


def _bottomless(area: str, *, pages: int = 40) -> dict:
    """완주 불가 지역 픽스처 — 어느 페이지든 빈 목록 + totalCount 큼.

    상세 호출이 없어 호출 1건 = 페이지 1장 — 배분 정확성 검증이 단순해진다.
    """
    return {
        (area, "12", p): envelope([], 1_000_000, page_no=p)
        for p in range(1, pages + 1)
    }


def _tiny(area: str) -> dict:
    """1호출 완주 지역 픽스처 — totalCount 0 (조기 종료분 이월 검증용)."""
    return {(area, "12", 1): envelope([], 0)}


def _area_calls(http: FakeTourApiHttp) -> dict[str, int]:
    counts: dict[str, int] = {}
    for _, params in http.calls:
        area = params["areaCode"]
        counts[area] = counts.get(area, 0) + 1
    return counts


# ── ① 균등 분할 — 미완주 지역 floor 배분 ─────────────────────────
def test_budget_split_evenly_across_incomplete_areas() -> None:
    http = FakeTourApiHttp(
        pages={**_bottomless("1"), **_bottomless("2"), **_bottomless("39")})
    result = collect_areas(_adapter(http), area_codes=["1", "2", "39"],
                           content_types=["12"], max_calls=6)
    assert _area_calls(http) == {"1": 2, "2": 2, "39": 2}
    assert [a for a, _ in result.area_results] == ["1", "2", "39"]  # env 순서 고정


def test_budget_smaller_than_area_count_serves_head_of_rotation() -> None:
    """예산 < 지역 수 — 회전 순서 앞쪽 지역만 1건씩, 나머지는 다음 실행 몫."""
    http = FakeTourApiHttp(
        pages={**_bottomless("1"), **_bottomless("2"), **_bottomless("39")})
    collect_areas(_adapter(http), area_codes=["1", "2", "39"],
                  content_types=["12"], max_calls=2)
    assert _area_calls(http) == {"1": 1, "2": 1}


# ── ② 나머지·조기 종료분 이월 ────────────────────────────────────
def test_division_remainder_follows_rotation_pointer() -> None:
    """7호출 ÷ 3지역 = 몫 2 + 나머지 1 — 나머지는 포인터 지역부터 +1."""
    http = FakeTourApiHttp(
        pages={**_bottomless("1"), **_bottomless("2"), **_bottomless("39")})
    result = collect_areas(_adapter(http), area_codes=["1", "2", "39"],
                           content_types=["12"], max_calls=7,
                           state=CollectState(next_area="2"))
    assert _area_calls(http) == {"2": 3, "39": 2, "1": 2}
    assert http.calls[0][1]["areaCode"] == "2"       # 시작 지역 = 포인터
    assert result.next_state.next_area == "39"       # 다음 실행은 그 다음 지역부터


def test_early_exit_unused_budget_carries_to_next_area() -> None:
    """지역이 자기 몫을 다 못 쓰면(1호출 완주) 미사용분은 다음 지역으로 이월."""
    http = FakeTourApiHttp(
        pages={**_tiny("1"), **_bottomless("2"), **_bottomless("39")})
    result = collect_areas(_adapter(http), area_codes=["1", "2", "39"],
                           content_types=["12"], max_calls=6)
    assert _area_calls(http) == {"1": 1, "2": 3, "39": 2}  # 몫 2 → 1만 쓰고 +1 이월
    assert result.next_state.cursors[("1", "12")].completed


# ── ③ 라운드로빈 포인터 회전 — 상태 왕복으로 이어짐 ────────────────
def test_pointer_rotates_each_run_and_survives_state_roundtrip() -> None:
    fixtures = {**_bottomless("1"), **_bottomless("2"), **_bottomless("39")}
    areas = ["1", "2", "39"]

    def run(state: CollectState | None):
        http = FakeTourApiHttp(pages=dict(fixtures))
        result = collect_areas(_adapter(http), area_codes=areas,
                               content_types=["12"], max_calls=3, state=state)
        return http, result

    http1, first = run(None)                          # 포인터 없음 → 목록 처음부터
    assert http1.calls[0][1]["areaCode"] == "1"
    assert first.next_state.next_area == "2"

    # 직렬화 → 파싱 왕복 (스크립트 기록 경로와 동일한 형태)
    restored = parse_state(json.dumps(state_to_dict(
        first.next_state, last_run={"at": "2026-08-11T04:00:00+00:00"})))
    assert restored.next_area == "2"

    http2, second = run(restored)
    assert http2.calls[0][1]["areaCode"] == "2"       # 다음 실행은 다음 지역부터
    assert second.next_state.next_area == "39"

    http3, third = run(second.next_state)
    assert http3.calls[0][1]["areaCode"] == "39"
    assert third.next_state.next_area == "1"          # 순환 (wrap-around)


def test_pointer_area_missing_from_list_starts_from_head() -> None:
    """env 목록 변경으로 포인터 지역이 사라짐 — 처음부터 (결정론 유지)."""
    http = FakeTourApiHttp(pages={**_bottomless("1"), **_bottomless("2")})
    result = collect_areas(_adapter(http), area_codes=["1", "2"],
                           content_types=["12"], max_calls=2,
                           state=CollectState(next_area="99"))
    assert http.calls[0][1]["areaCode"] == "1"
    assert result.next_state.next_area == "2"


def test_old_state_without_pointer_parses_as_none() -> None:
    old = json.dumps({"schema_version": 1, "cursors": {}, "proposed": {}})
    assert parse_state(old).next_area is None         # 구버전 상태 하위호환


def test_invalid_pointer_type_rejected_all_or_nothing() -> None:
    bad = json.dumps({"schema_version": 1, "cursors": {}, "proposed": {},
                      "next_area": 39})
    with pytest.raises(ValueError):
        parse_state(bad)


# ── ④ 완주 지역 후순위 — 잔여 예산으로만 마지막에 ─────────────────
def test_completed_area_excluded_from_split_gets_nothing_without_leftover() -> None:
    state = CollectState(cursors={("1", "12"): KindCursor(next_page=1,
                                                          completed=True)})
    http = FakeTourApiHttp(pages={**_bottomless("2")})
    collect_areas(_adapter(http), area_codes=["1", "2"],
                  content_types=["12"], max_calls=4, state=state)
    assert _area_calls(http) == {"2": 4}              # 완주 지역 호출 0


def test_completed_area_visited_last_with_leftover_budget() -> None:
    """회전 순서상 앞이어도 완주 지역은 뒤로 — 잔여 예산으로 색인 스킵 재순회."""
    state = CollectState(cursors={("1", "12"): KindCursor(next_page=1,
                                                          completed=True)})
    http = FakeTourApiHttp(pages={**_tiny("1"), **_tiny("2")})
    result = collect_areas(_adapter(http), area_codes=["1", "2"],
                           content_types=["12"], max_calls=4, state=state)
    assert [p["areaCode"] for _, p in http.calls] == ["2", "1"]
    assert [a for a, _ in result.area_results] == ["2", "1"]


# ── ⑤ env 해석 — 단수 하위호환 · 기본 17개 ───────────────────────
def test_resolve_defaults_to_all_17_metro_areas() -> None:
    codes = resolve_area_codes(None, None)
    assert codes == ["1", "2", "3", "4", "5", "6", "7", "8", "31", "32", "33",
                     "34", "35", "36", "37", "38", "39"]
    assert codes == list(DEFAULT_AREA_CODES)
    assert AREA_NAMES["39"] == "제주" and AREA_NAMES["1"] == "서울"


def test_resolve_singular_env_wins_for_backward_compat() -> None:
    assert resolve_area_codes("39", "1,2,3") == ["39"]  # 설정 시 그것만


def test_resolve_list_env_parses_commas_and_blanks() -> None:
    assert resolve_area_codes(None, " 1, 2 ,39, ") == ["1", "2", "39"]
    assert resolve_area_codes("", "") == list(DEFAULT_AREA_CODES)  # ''=미설정


# ── 산출 문서 — 합산 통계 + per_area 분해 ─────────────────────────
def test_multi_output_document_aggregates_with_per_area_breakdown() -> None:
    http = FakeTourApiHttp(
        pages={
            **_tiny("1"),
            ("39", "12", 1): envelope([
                list_item("100", "성산일출봉"),
                list_item("101", "만장굴", mapx="126.7708", mapy="33.5284"),
            ], total_count=2),
        },
        intros={"100": envelope([intro_item("100", "12", "07:00~20:00",
                                            "연중무휴")], 1)},
    )
    result = collect_areas(_adapter(http), area_codes=["1", "39"],
                           content_types=["12"], max_calls=10)
    doc = to_multi_output_document(result, area_codes=["1", "39"],
                                   content_types=["12"], collected_at=_NOW)
    restored = json.loads(json.dumps(doc, ensure_ascii=False))  # JSON 왕복
    assert restored["area_codes"] == ["1", "39"]
    stats = restored["stats"]
    assert stats["per_area"]["1"] == {"calls": 1, "passed": 0, "skipped": 0}
    assert stats["per_area"]["39"] == {"calls": 3, "passed": 2, "skipped": 0}
    assert stats["http_calls"] == 4 and stats["passed"] == 2
    assert not stats["budget_exhausted"]
    assert {p["provisional_id"] for p in restored["proposals"]} \
        == {"tourapi-100", "tourapi-101"}


def test_collect_areas_rejects_empty_inputs() -> None:
    http = FakeTourApiHttp()
    with pytest.raises(ValueError):
        collect_areas(_adapter(http), area_codes=[], content_types=["12"],
                      max_calls=10)
    with pytest.raises(ValueError):
        collect_areas(_adapter(http), area_codes=["39"], content_types=["12"],
                      max_calls=0)


# ── ⑥ 키링 3개 — k1→k2→k3 전환 시퀀스 ────────────────────────────
def test_three_key_ring_rotates_k1_k2_k3_in_order() -> None:
    http = FakeTourApiHttp(pages={
        ("12", 1): envelope([list_item("100", "성산일출봉"),
                             list_item("101", "만장굴")], 4),
        ("12", 2): envelope([list_item("102", "천지연폭포"),
                             list_item("103", "협재해수욕장")], 4, page_no=2),
    })
    adapter = TourApiAdapter(http, "k1", extra_keys=("k2", "k3"),
                             calls_per_key=2)
    result = collect_areas(adapter, area_codes=["39"], content_types=["12"],
                           max_calls=6, rows_per_page=2)
    # 호출 시퀀스: 목록1·상세·상세·목록2·상세·상세 — 키당 상한 2에서 정확히 전환
    assert [p["serviceKey"] for _, p in http.calls] \
        == ["k1", "k1", "k2", "k2", "k3", "k3"]
    (_, r), = result.area_results
    assert r.stats.passed == 4                        # 산출은 단일 키 실행과 동일


# ── ⑦ PBT — 총 호출 ≤ 키 수×키당 상한 ∧ 지역별 격차 ≤ 1 ──────────
@settings(max_examples=40, deadline=None)
@given(n_areas=st.integers(min_value=1, max_value=6),
       calls_per_key=st.integers(min_value=1, max_value=10),
       pointer=st.integers(min_value=0, max_value=5))
def test_pbt_fair_split_within_three_key_budget(n_areas, calls_per_key,
                                                pointer) -> None:
    """임의 지역 수·키당 상한·포인터: 총 호출 ≤ 3키×키당 상한, 완주 없는
    지역들 사이 호출 격차 ≤ 1 (몫+이월 상한), 키 전환은 k1→k2→k3 블록."""
    areas = [str(i + 1) for i in range(n_areas)]
    http = FakeTourApiHttp(
        pages={k: v for a in areas for k, v in _bottomless(a).items()})
    adapter = TourApiAdapter(http, "k1", extra_keys=("k2", "k3"),
                             calls_per_key=calls_per_key)
    budget = 3 * calls_per_key                        # 총 예산 = 키 수 × 키당 상한
    result = collect_areas(adapter, area_codes=areas, content_types=["12"],
                           max_calls=budget,
                           state=CollectState(next_area=areas[pointer % n_areas]))
    counts = _area_calls(http)
    assert sum(counts.values()) == len(http.calls) <= budget
    per_area = [counts.get(a, 0) for a in areas]
    assert max(per_area) - min(per_area) <= 1         # 공평 — 격차 ≤ 1
    assert max(per_area) <= budget // n_areas + 1     # 몫 + 이월 상한
    keys = [p["serviceKey"] for _, p in http.calls]
    assert keys == sorted(keys)                       # k1 블록 → k2 블록 → k3 블록
    assert keys.count("k1") <= calls_per_key
    assert keys.count("k2") <= calls_per_key
    assert keys.count("k3") <= calls_per_key
    # 통계 정합 — 지역별 http_calls 합 = 실제 호출 수
    assert sum(r.stats.http_calls for _, r in result.area_results) \
        == len(http.calls)
