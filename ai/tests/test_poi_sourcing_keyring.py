"""TRIP-246 후속 — TourAPI 키 2개 로테이션 (키링, 연속 이어가기 — 병렬 아님).

실 호출 0 — fake HTTP 만. 검증 4종:
① 전환 시점 정확성 (키당 상한 N → 키 1 호출 정확히 N 후 키 2)
② 전환 후 연속성 (같은 페이지 재호출 0 — 단일 키 실행과 시퀀스 동일)
③ 총 상한 = 키 수 × 키당 상한 불변식 (PBT)
④ 키 2 미설정 회귀 (기존 단일 키 동작과 완전 동일)
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.poi_curation.sourcing.pipeline import collect, to_output_document
from trippilot.poi_curation.sourcing.tourapi import TourApiAdapter

from tests.fakes.fake_tourapi_http import FakeTourApiHttp, envelope, list_item

_NOW = datetime(2026, 8, 11, 4, 0, tzinfo=UTC)
_TOURAPI_LOGGER = "trippilot.poi_curation.sourcing.tourapi"


def _two_page_http(*, total_count: int = 4) -> FakeTourApiHttp:
    """kind=12, rows=2 기준 2페이지 픽스처 — 호출 시퀀스: 목록1·상세·상세·목록2·상세·상세."""
    return FakeTourApiHttp(pages={
        ("12", 1): envelope([list_item("100", "성산일출봉"),
                             list_item("101", "만장굴")], total_count),
        ("12", 2): envelope([list_item("102", "천지연폭포"),
                             list_item("103", "협재해수욕장")], total_count, page_no=2),
    })


def _service_keys(http: FakeTourApiHttp) -> list[str]:
    return [params["serviceKey"] for _, params in http.calls]


def _calls_without_key(http: FakeTourApiHttp) -> list[tuple[str, dict]]:
    return [(url, {k: v for k, v in params.items() if k != "serviceKey"})
            for url, params in http.calls]


# ── ① 전환 시점 정확성 ────────────────────────────────────────────
def test_switches_to_second_key_after_exactly_calls_per_key() -> None:
    http = _two_page_http()
    adapter = TourApiAdapter(http, "k1", extra_keys=("k2",), calls_per_key=3)
    collect(adapter, area_code="39", content_types=["12"],
            max_calls=6, rows_per_page=2)
    assert _service_keys(http) == ["k1"] * 3 + ["k2"] * 3


def test_switch_logs_info_with_cumulative_calls(caplog) -> None:
    http = _two_page_http()
    adapter = TourApiAdapter(http, "k1", extra_keys=("k2",), calls_per_key=3)
    with caplog.at_level(logging.INFO, logger=_TOURAPI_LOGGER):
        collect(adapter, area_code="39", content_types=["12"],
                max_calls=6, rows_per_page=2)
    assert "키 전환: 1→2, 누적 3호출" in caplog.text


# ── ② 전환 후 연속성 — 중복 크롤 0 ────────────────────────────────
def test_rotation_continues_sequence_without_recrawl() -> None:
    """키 전환은 시퀀스를 이어간다 — 단일 키 실행과 요청 순서·내용이 동일(키만 다름)."""
    single = _two_page_http()
    collect(TourApiAdapter(single, "k1"), area_code="39",
            content_types=["12"], max_calls=6, rows_per_page=2)
    rotated = _two_page_http()
    result = collect(TourApiAdapter(rotated, "k1", extra_keys=("k2",), calls_per_key=3),
                     area_code="39", content_types=["12"],
                     max_calls=6, rows_per_page=2)
    assert _calls_without_key(rotated) == _calls_without_key(single)
    # 목록 페이지 재호출 0
    list_pages = [(p["contentTypeId"], p["pageNo"]) for url, p in rotated.calls
                  if url.endswith("/areaBasedList2")]
    assert len(list_pages) == len(set(list_pages))
    # 산출도 단일 키 실행과 동일 (키는 산출물에 나타나지 않는다)
    assert result.stats.listed == 4 and result.stats.passed == 4


def test_last_key_exhaustion_partial_output_and_normal_exit() -> None:
    """마지막 키까지 소진: 기존과 동일한 부분 산출 + 정상 종료 (예외 없음)."""
    http = _two_page_http(total_count=6)   # 3페이지 예정이나 예산 6으로 2페이지에서 끝
    adapter = TourApiAdapter(http, "k1", extra_keys=("k2",), calls_per_key=3)
    result = collect(adapter, area_code="39", content_types=["12"],
                     max_calls=6, rows_per_page=2)
    assert result.stats.budget_exhausted
    assert result.stats.http_calls == 6
    assert result.stats.passed == 4        # 확보분까지 산출 (부분 성공 = 성공)


# ── ③ 총 상한 = 키 수 × 키당 상한 (PBT) ──────────────────────────
_items = st.lists(
    st.integers(min_value=1, max_value=9999), min_size=0, max_size=12, unique=True,
).map(lambda refs: [list_item(str(ref), f"장소{ref}") for ref in refs])


@settings(max_examples=40, deadline=None)
@given(items=_items, calls_per_key=st.integers(min_value=1, max_value=15))
def test_pbt_total_budget_is_keys_times_per_key_cap(items, calls_per_key) -> None:
    """임의 픽스처·임의 키당 상한: 키별 호출 ≤ 상한, 총 호출 ≤ 2×상한, 키 순서 결정론."""
    http = FakeTourApiHttp(pages={("12", 1): envelope(items, len(items))})
    adapter = TourApiAdapter(http, "k1", extra_keys=("k2",),
                             calls_per_key=calls_per_key)
    result = collect(adapter, area_code="39", content_types=["12"],
                     max_calls=2 * calls_per_key)
    keys = _service_keys(http)
    assert len(keys) <= 2 * calls_per_key
    assert result.stats.http_calls == len(keys)
    k1_calls = min(len(keys), calls_per_key)   # 키 1이 상한까지 먼저, 이후 전부 키 2
    assert keys == ["k1"] * k1_calls + ["k2"] * (len(keys) - k1_calls)
    assert len(keys) - k1_calls <= calls_per_key


# ── ④ 키 2 미설정 회귀 — 기존 동작과 완전 동일 ────────────────────
def test_single_key_behaves_exactly_as_before(caplog) -> None:
    """extra_keys 없음(스크립트의 TOUR_API_KEY2 미설정 경로) = 기존 단일 키 동작."""
    http = _two_page_http(total_count=6)
    with caplog.at_level(logging.INFO, logger=_TOURAPI_LOGGER):
        result = collect(TourApiAdapter(http, "k1"), area_code="39",
                         content_types=["12"], max_calls=6, rows_per_page=2)
    assert set(_service_keys(http)) == {"k1"}    # 키 전환 없음
    assert "키 전환" not in caplog.text
    assert result.stats.http_calls == 6 and result.stats.budget_exhausted
    doc = to_output_document(result, area_code="39", content_types=["12"],
                             collected_at=_NOW)
    assert json.dumps(doc, ensure_ascii=False)   # 산출 문서 직렬화 가능 (스키마 불변)


def test_extra_keys_require_positive_calls_per_key() -> None:
    http = FakeTourApiHttp()
    with pytest.raises(ValueError):
        TourApiAdapter(http, "k1", extra_keys=("k2",))
    with pytest.raises(ValueError):
        TourApiAdapter(http, "k1", extra_keys=("k2",), calls_per_key=0)
