"""U6-05 — 수집 게이트 5단 + 파이프라인 (호출 상한·게이트 연동·JSON 왕복·PBT).

실 호출 0 — fake HTTP + 내장 픽스처만 (TRIP-246).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.poi_curation.sourcing.collection_gate import (
    DROP_EXISTENCE,
    DROP_SCHEMA_COORD,
    DROP_SCHEMA_NAME,
    CollectionGate,
    SourcingCandidate,
)
from trippilot.poi_curation.sourcing.pipeline import collect, to_output_document
from trippilot.poi_curation.sourcing.tourapi import TourApiAdapter
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource

from tests.fakes.fake_tourapi_http import (
    FakeTourApiHttp,
    envelope,
    error_envelope,
    intro_item,
    list_item,
)

_NOW = datetime(2026, 8, 11, 4, 0, tzinfo=UTC)


def _candidate(
    ref: str = "1",
    *,
    name: str = "성산일출봉",
    lat: float | None = 33.462,
    lng: float | None = 126.9425,
    category: PoiCategory = PoiCategory.NATURE,
    open_hours: tuple[OpenHour, ...] = (),
    hours_raw: str | None = None,
    image_url: str | None = None,
    address: str | None = "제주특별자치도 서귀포시 성산읍",
) -> SourcingCandidate:
    return SourcingCandidate(
        source_ref=ref, kind="12", name=name, address=address, lat=lat, lng=lng,
        category=category, category_codes=("A01", "A0101", "A01010400"),
        open_hours=open_hours, hours_raw=hours_raw,
        image_url=image_url, modified_at="20260801120000",
    )


# ── 수집 게이트 5단 ──────────────────────────────────────────────
def test_gate_drops_by_reason_and_counts() -> None:
    report = CollectionGate().apply([
        _candidate("1"),                                  # 통과
        _candidate("2", name="  "),                       # 1단 — 이름 없음
        _candidate("3", lat=None),                        # 1단 — 좌표 없음
        _candidate("4", lat=95.0),                        # 1단 — 좌표 범위 밖
        _candidate("5", lat=35.68, lng=139.76),           # 2단 — 권역(한국 bbox) 밖
    ])
    assert [p.poi.poi_id for p in report.passed] == ["tourapi-1"]
    assert report.drops == {
        DROP_SCHEMA_NAME: 1,
        DROP_SCHEMA_COORD: 2,
        DROP_EXISTENCE: 1,
    }


def test_gate_merges_near_duplicates_filling_missing_hours() -> None:
    """3단 — 50m 이내·동일 카테고리·동명 → 병합 (먼저 온 것 유지 + 결측 보충)."""
    hours = (OpenHour(0, 540, 1080),)
    report = CollectionGate().apply([
        _candidate("1"),
        _candidate("2", lat=33.4621, open_hours=hours, hours_raw="09:00~18:00"),
        _candidate("3", name="성산 일출봉", lat=33.4622),   # 공백 정규화로도 동명
    ])
    assert len(report.passed) == 1 and report.merged == 2
    kept = report.passed[0]
    assert kept.poi.poi_id == "tourapi-1"           # 먼저 온 레코드 유지
    assert kept.poi.open_hours == hours             # 결측 영업시간은 병합으로 보충
    assert kept.candidate.hours_raw == "09:00~18:00"
    assert report.drops == {}                        # 병합은 드롭이 아니다


def test_gate_does_not_merge_far_or_other_category() -> None:
    report = CollectionGate().apply([
        _candidate("1"),
        _candidate("2", lat=33.475),                              # ≫50m
        _candidate("3", category=PoiCategory.SIGHT),              # 카테고리 다름
    ])
    assert len(report.passed) == 3 and report.merged == 0


def test_gate_trust_and_policy_stages() -> None:
    """4단 출처·품질 태깅 + 5단 가격 미저장 — 백엔드 판정 기준과 동형."""
    hours = (OpenHour(0, 540, 1080),)
    report = CollectionGate().apply([
        _candidate("1", open_hours=hours, image_url="http://img/1.jpg"),
        _candidate("2", lat=33.51),  # 영업시간·사진 없음
    ])
    full, partial = report.passed
    assert full.poi.source is PoiSource.PLACES_API   # 정형 API — WEB 아님
    assert full.poi.quality is DataQuality.FULL      # 영업시간+대표사진 완비
    assert partial.poi.quality is DataQuality.PARTIAL
    assert all(p.poi.avg_cost is None for p in report.passed)  # 5단 — 가격 미저장
    assert all(p.poi.rating is None for p in report.passed)    # 미제공 값 지어내지 않음


# ── 파이프라인: fake HTTP 관통 ──────────────────────────────────
def _happy_http() -> FakeTourApiHttp:
    return FakeTourApiHttp(
        pages={
            ("12", 1): envelope([
                list_item("100", "성산일출봉", firstimage="http://img/100.jpg"),
                list_item("101", "만장굴", mapx="126.7708", mapy="33.5284",
                          cat3="A01011900"),
            ], total_count=2),
            ("39", 1): envelope([
                list_item("300", "올레국수", contenttypeid="39", mapx="126.5300",
                          mapy="33.4996", cat1="A05", cat2="A0502", cat3="A05020100"),
            ], total_count=1),
        },
        intros={
            "100": envelope([intro_item("100", "12", "07:00~20:00", "연중무휴")], 1),
            "300": envelope([intro_item("300", "39", "09:00~18:00", "매주 일요일")], 1),
        },
    )


def test_collect_happy_path_gate_passes_and_stats() -> None:
    result = collect(_adapter(_happy_http()), area_code="39",
                     content_types=["12", "39"], max_calls=500)
    stats = result.stats
    assert stats.listed == 3 and stats.passed == 3
    assert stats.http_calls == 5  # 목록 2 + 상세 3
    assert not stats.budget_exhausted
    by_id = {str(p.poi.poi_id): p.poi for p in result.report.passed}
    assert by_id["tourapi-100"].open_hours[0] == OpenHour(0, 420, 1200)
    assert by_id["tourapi-300"].category is PoiCategory.FOOD
    assert {h.day_of_week for h in by_id["tourapi-300"].open_hours} == {0, 1, 2, 3, 4, 5}


def _adapter(http: FakeTourApiHttp) -> TourApiAdapter:
    return TourApiAdapter(http, "test-key")


def test_collect_respects_call_budget_with_partial_output() -> None:
    """상한 도달 시: HTTP 호출 정확히 ≤N + 그 시점까지 산출 + 정상 종료(부분 성공)."""
    http = _happy_http()
    result = collect(_adapter(http), area_code="39",
                     content_types=["12", "39"], max_calls=2)
    assert len(http.calls) <= 2                      # 실제 HTTP 호출로 검증
    assert result.stats.http_calls == 2
    assert result.stats.budget_exhausted
    # 목록 1페이지(호출1) + 상세 1건(호출2) — 상세 못 받은 항목도 영업시간 없이 산출
    assert result.stats.listed == 2
    assert result.stats.passed == 2
    without_detail = next(p for p in result.report.passed
                          if str(p.poi.poi_id) == "tourapi-101")
    assert without_detail.poi.open_hours == ()       # 정보 없음 ≠ 배제


def test_collect_unmapped_category_dropped_before_gate() -> None:
    http = FakeTourApiHttp(pages={("25", 1): envelope(
        [list_item("500", "동부 해안 코스", contenttypeid="25",
                   cat1="C01", cat2="C0112", cat3="C01120001")], 1)})
    result = collect(_adapter(http), area_code="39",
                     content_types=["25"], max_calls=500)
    assert result.stats.category_unmapped == 1
    assert result.stats.passed == 0 and result.stats.gate_drops == {}


def test_collect_page_failure_logged_and_skipped() -> None:
    # 에러 코드는 **키와 무관한** 것이어야 한다 — 키 관련 코드(30 미등록·22 한도초과 등)는
    # TRIP-348 이후 "이 키로는 앞으로도 안 된다"는 신호라 다음 타입까지 멈춘다.
    # 여기가 검증하려는 건 "한 페이지가 실패해도 다음 타입은 진행한다"이므로 일반 오류를 쓴다.
    http = FakeTourApiHttp(
        pages={("12", 1): error_envelope("01", "APPLICATION_ERROR"),
               ("39", 1): envelope([list_item(
                   "300", "올레국수", contenttypeid="39", mapx="126.53",
                   mapy="33.4996", cat1="A05", cat2="A0502", cat3="A05020100")], 1)})
    result = collect(_adapter(http), area_code="39",
                     content_types=["12", "39"], max_calls=500)
    assert result.stats.page_failures == 1           # 실패 페이지는 스킵 (침묵 금지 — 카운트)
    assert result.stats.passed == 1                  # 다음 타입은 정상 진행


def test_단일_키가_거부되면_남은_예산을_태우지_않는다() -> None:
    """키가 하나뿐인데 그 키가 죽었으면 뒤 호출은 전부 실패가 확정이다.

    계속 두드리면 아무것도 못 얻으면서 예산만 태운다 — 한도초과(22)로 죽은 경우엔
    남의 쿼터까지 갉는다. 대신 조용히 성공으로 끝내지도 않는다(page_failures 로 드러난다).
    """
    http = FakeTourApiHttp(
        pages={("12", 1): error_envelope("22", "LIMITED_NUMBER_OF_SERVICE_REQUESTS"),
               ("39", 1): envelope([list_item("300", "올레국수", contenttypeid="39")], 1)})
    result = collect(_adapter(http), area_code="39",
                     content_types=["12", "39"], max_calls=500)
    assert len(http.calls) == 1                      # 첫 거부 이후로는 안 두드린다
    assert result.stats.passed == 0
    assert result.stats.page_failures >= 1           # 침묵하지 않는다


def test_collect_detail_failure_continues_without_hours() -> None:
    http = FakeTourApiHttp(
        pages={("12", 1): envelope([list_item("100", "성산일출봉")], 1)},
        intros={"100": error_envelope()},
    )
    result = collect(_adapter(http), area_code="39",
                     content_types=["12"], max_calls=500)
    assert result.stats.detail_failures == 1
    assert result.stats.passed == 1
    assert result.report.passed[0].poi.open_hours == ()


# ── 산출 JSON — 백엔드 정본 스키마 병행 필드 + 왕복 ─────────────────
def test_output_document_schema_roundtrip_and_backend_fields() -> None:
    result = collect(_adapter(_happy_http()), area_code="39",
                     content_types=["12", "39"], max_calls=500)
    doc = to_output_document(result, area_code="39", content_types=["12", "39"],
                             collected_at=_NOW)
    restored = json.loads(json.dumps(doc, ensure_ascii=False))  # JSON 왕복
    assert restored["source"] == "TOURAPI"           # 백엔드 poi.source CHECK 어휘
    proposals = {p["provisional_id"]: p for p in restored["proposals"]}
    p100 = proposals["tourapi-100"]
    assert p100["source"] == "TOURAPI"
    assert p100["tags"] == ["자연관광지", "산"]        # cat2/cat3 코드가 아니라 명칭
    assert p100["region"] == "제주시"                 # addr1에서 시·군·구 추출
    assert p100["opening_hours_raw"] == "07:00~20:00"  # 파싱본과 별개로 원문 병행
    assert p100["provenance"]["content_id"] == "100"
    assert p100["provenance"]["image_url"] == "http://img/100.jpg"
    # poi 블록은 도메인 직렬화 왕복 스키마 그대로
    for p in restored["proposals"]:
        poi = Poi.from_dict(p["poi"])
        assert str(poi.poi_id) == p["provisional_id"]


def test_output_document_truncates_long_opening_hours_raw() -> None:
    """backend opening_hours varchar(200) — 거부가 아니라 절단 + 말줄임표."""
    long_hours = "10:00~22:00 " + "브레이크타임 안내 " * 30
    http = FakeTourApiHttp(
        pages={("39", 1): envelope([list_item(
            "300", "올레국수", contenttypeid="39", mapx="126.53", mapy="33.4996",
            cat1="A05", cat2="A0502", cat3="A05020100")], 1)},
        intros={"300": envelope([intro_item("300", "39", long_hours, "연중무휴")], 1)},
    )
    result = collect(_adapter(http), area_code="39", content_types=["39"], max_calls=500)
    doc = to_output_document(result, area_code="39", content_types=["39"],
                             collected_at=_NOW)
    raw = doc["proposals"][0]["opening_hours_raw"]
    assert len(raw) == 200 and raw.endswith("…")


def test_output_document_region_extraction_failure_is_null() -> None:
    report = CollectionGate().apply([_candidate("1", address="번지 미상")])
    from trippilot.poi_curation.sourcing.pipeline import CollectResult, CollectStats
    result = CollectResult(report=report, stats=CollectStats(
        http_calls=0, listed=1, page_failures=0, detail_failures=0,
        category_unmapped=0, gate_drops={}, merged=0, passed=1,
        budget_exhausted=False))
    doc = to_output_document(result, area_code="39", content_types=["12"],
                             collected_at=_NOW)
    assert doc["proposals"][0]["region"] is None     # 추출 실패 = null (지어내기 금지)


# ── PBT — 상한 불변식 + 산출 결정론 ───────────────────────────────
_items = st.lists(
    st.tuples(st.integers(min_value=1, max_value=9999), st.booleans()),
    min_size=0, max_size=12, unique_by=lambda t: t[0],
).map(lambda pairs: [
    list_item(str(ref), f"장소{ref}",
              # valid=False면 좌표 결손 — 게이트 1단 드롭 대상
              mapx="126.5" if valid else "", mapy="33.45" if valid else "")
    for ref, valid in pairs
])


@settings(max_examples=40, deadline=None)
@given(items=_items, max_calls=st.integers(min_value=1, max_value=30))
def test_pbt_call_budget_invariant(items, max_calls) -> None:
    """임의 픽스처·임의 상한: HTTP 호출 수 ≤ 상한, 통계 정합, 정상 종료."""
    http = FakeTourApiHttp(pages={("12", 1): envelope(items, len(items))})
    result = collect(_adapter(http), area_code="39",
                     content_types=["12"], max_calls=max_calls)
    assert len(http.calls) <= max_calls
    assert result.stats.http_calls == len(http.calls)
    stats = result.stats
    assert stats.listed == len(items)  # 1페이지 확보분은 상한과 무관하게 전부 목록화
    assert stats.passed + sum(stats.gate_drops.values()) + stats.merged \
        + stats.category_unmapped == stats.listed


@settings(max_examples=25, deadline=None)
@given(items=_items)
def test_pbt_output_is_deterministic(items) -> None:
    """같은 픽스처 → 같은 산출 문서 (수집 시각 고정 시 바이트 동일)."""
    def run() -> dict:
        http = FakeTourApiHttp(pages={("12", 1): envelope(items, len(items))})
        result = collect(_adapter(http), area_code="39",
                         content_types=["12"], max_calls=500)
        return to_output_document(result, area_code="39", content_types=["12"],
                                  collected_at=_NOW)
    assert json.dumps(run(), ensure_ascii=False) == json.dumps(run(), ensure_ascii=False)
