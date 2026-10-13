"""U6-05 — 수집 게이트 5단 + 파이프라인 (호출 상한·게이트 연동·JSON 왕복·PBT).

실 호출 0 — fake HTTP + 내장 픽스처만 (TRIP-246).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest

from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.poi_curation.sourcing.collection_gate import (
    DROP_EXISTENCE,
    DROP_SCHEMA_COORD,
    DROP_SCHEMA_NAME,
    CollectionGate,
    SourcingCandidate,
)
from trippilot.poi_curation.sourcing.mapping import (
    REST_SEP,
    join_opening_hours_raw,
    parse_opening_hours_raw,
    split_opening_hours_raw,
)
from trippilot.poi_curation.sourcing.pipeline import (
    collect,
    refresh_proposal,
    to_output_document,
)
from trippilot.poi_curation.sourcing.tourapi import TourApiAdapter
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource
from trippilot.ports.poi_sourcing_port import SourcedDetail

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
    detail_raw: dict[str, str] | None = None,
    rest_raw: str | None = None,
) -> SourcingCandidate:
    return SourcingCandidate(
        source_ref=ref, kind="12", name=name, address=address, lat=lat, lng=lng,
        category=category, category_codes=("A01", "A0101", "A01010400"),
        open_hours=open_hours, hours_raw=hours_raw,
        image_url=image_url, modified_at="20260801120000",
        detail_raw=detail_raw or {}, rest_raw=rest_raw,
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
        _candidate("2", lat=33.4621, open_hours=hours, hours_raw="09:00~18:00",
                   rest_raw="매주 화요일"),
        _candidate("3", name="성산 일출봉", lat=33.4622,   # 공백 정규화로도 동명
                   detail_raw={"parking": "가능"}),
    ])
    assert len(report.passed) == 1 and report.merged == 2
    kept = report.passed[0]
    assert kept.poi.poi_id == "tourapi-1"           # 먼저 온 레코드 유지
    assert kept.poi.open_hours == hours             # 결측 영업시간은 병합으로 보충
    assert kept.candidate.hours_raw == "09:00~18:00"
    assert kept.candidate.rest_raw == "매주 화요일"    # 휴무 원문은 영업 원문의 짝으로 따라온다
    assert kept.candidate.detail_raw == {"parking": "가능"}  # 상세 원문도 같은 규칙
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
                     content_types=["12"], max_calls=2)
    assert len(http.calls) <= 2                      # 실제 HTTP 호출로 검증
    assert result.stats.http_calls == 2
    assert result.stats.budget_exhausted
    # 목록 1페이지(호출1) + 상세 1건(호출2) — 상세 못 받은 항목도 영업시간 없이 산출
    assert result.stats.listed == 2
    assert result.stats.passed == 2
    without_detail = next(p for p in result.report.passed
                          if str(p.poi.poi_id) == "tourapi-101")
    assert without_detail.poi.open_hours == ()       # 정보 없음 ≠ 배제


def test_예산은_타입별로_나눠_뒤_타입도_호출을_받는다() -> None:
    """앞 타입이 지역 예산을 다 먹으면 뒤 타입은 0건이 된다 — 실측으로 그렇게 됐다.

    강원 697건 중 음식점 1건, 경북·충남·경기·경남·전북 0건. 관광지(12)에서 예산이
    끊겨 음식점(39)까지 못 갔고, 그 지역 일정에는 점심·저녁 후보가 없다.
    """
    http = _happy_http()
    result = collect(_adapter(http), area_code="39",
                     content_types=["12", "39"], max_calls=2)
    kinds_called = {params["contentTypeId"] for url, params in http.calls
                    if url.endswith("/areaBasedList2")}
    assert kinds_called == {"12", "39"}              # 두 타입 다 목록을 받았다
    assert result.stats.http_calls == 2


def test_collect_unmapped_category_dropped_before_gate() -> None:
    http = FakeTourApiHttp(pages={("25", 1): envelope(
        [list_item("500", "동부 해안 코스", contenttypeid="25",
                   cat1="C01", cat2="C0112", cat3="C01120001")], 1)})
    result = collect(_adapter(http), area_code="39",
                     content_types=["25"], max_calls=500)
    assert result.stats.category_unmapped == 1
    assert result.stats.passed == 0 and result.stats.gate_drops == {}


def test_collect_address_missing_dropped_before_gate() -> None:
    """TRIP-535 — addr1 빈 레코드는 제안하지 않는다 (provenance.address가 백엔드
    행정구역 해석의 유일 입력 — 실측: 익선동 한옥거리 1건이 backend-ci 적색)."""
    http = FakeTourApiHttp(pages={("12", 1): envelope(
        [list_item("600", "익선동 한옥거리", addr1=""),
         list_item("601", "주소 있는 곳")], 2)})
    result = collect(_adapter(http), area_code="1",
                     content_types=["12"], max_calls=500)
    assert result.stats.address_missing == 1
    assert result.stats.passed == 1  # 주소 있는 쪽만 통과
    assert all(p.candidate.address for p in result.report.passed)
    s = result.stats
    assert s.passed + sum(s.gate_drops.values()) + s.merged \
        + s.category_unmapped + s.address_missing == s.listed


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
    # 파싱본과 별개로 원문 병행 — 휴무 원문도 같은 칸에 (런타임은 이 칸만 다시 파싱한다, TRIP-1226)
    assert p100["opening_hours_raw"] == "07:00~20:00\n휴무: 연중무휴"
    assert proposals["tourapi-300"]["opening_hours_raw"] == "09:00~18:00\n휴무: 매주 일요일"
    assert p100["provenance"]["content_id"] == "100"
    # 스킴은 어댑터가 올려 둔다 — 평문 HTTP 이미지는 iOS ATS 가 조용히 차단한다
    assert p100["provenance"]["image_url"] == "https://img/100.jpg"
    # poi 블록은 도메인 직렬화 왕복 스키마 그대로
    for p in restored["proposals"]:
        poi = Poi.from_dict(p["poi"])
        assert str(poi.poi_id) == p["provisional_id"]
        # 런타임이 원문 칸에서 읽는 영업시간 == 수집이 읽은 영업시간 (휴무 포함)
        assert parse_opening_hours_raw(p["opening_hours_raw"]) == poi.open_hours


def test_output_document_truncates_long_opening_hours_raw() -> None:
    """backend opening_hours varchar(200) — 거부가 아니라 절단 + 말줄임표.

    휴무 원문은 보존하고 영업 원문을 먼저 자른다(TRIP-1226) — 휴무가 잘려 나가면
    런타임이 휴무일에도 영업으로 읽는다.
    """
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
    assert len(raw) == 200 and raw.endswith(REST_SEP + "연중무휴")
    hours, rest = split_opening_hours_raw(raw)
    assert hours.endswith("…") and rest == "연중무휴"


_MUSEUM_REST = "동절기(12~2월) 휴관"   # 요일 없는 휴무 — 파서가 해석 못 한다


def test_휴무를_해석_못_해_영업시간을_포기한_건을_센다() -> None:
    """수집은 휴무를 해석 못 하면(요일도 무휴·비정기 휴일·점포별 상이도 아닌 글) 영업시간을 통째로 포기한다(`()`). 원문 칸에 휴무를
    함께 싣는 이상 런타임도 같은 `()` 다 — HC1 미적용, 종전엔 휴무가 칸에 없어 7일 창이었다.

    휴무 문구는 그래도 싣는다(결정·실측: data/README 「휴무를 해석 못 하는 POI」). 여기서는
    그 건수가 실행마다 stats 로 드러나는지 본다. 영업 원문을 못 읽은 것·상시 개방은 휴무
    탓이 아니라 세지 않는다.
    """
    http = FakeTourApiHttp(
        pages={("14", 1): envelope([
            list_item(cid, name, contenttypeid="14")
            for cid, name in (("700", "박물관"), ("701", "미술관"), ("702", "기념관"), ("703", "야외전시장"))
        ], 4)},
        intros={
            "700": envelope([intro_item("700", "14", "09:00~18:00", _MUSEUM_REST)], 1),
            "701": envelope([intro_item("701", "14", "09:00~18:00", "매주 월요일")], 1),
            "702": envelope([intro_item("702", "14", "전화 문의", "명절 당일")], 1),
            "703": envelope([intro_item("703", "14", "상시 개방", "동절기 휴장")], 1),
        },
    )
    result = collect(_adapter(http), area_code="39", content_types=["14"], max_calls=500)
    assert result.stats.passed == 4
    assert result.stats.rest_unparsed == 1
    doc = to_output_document(result, area_code="39", content_types=["14"], collected_at=_NOW)
    assert doc["stats"]["rest_unparsed"] == 1
    p700 = next(p for p in doc["proposals"] if p["provisional_id"] == "tourapi-700")
    assert p700["opening_hours_raw"] == "09:00~18:00" + REST_SEP + _MUSEUM_REST   # 문구는 화면에 나간다
    assert p700["poi"]["open_hours"] == []
    assert parse_opening_hours_raw(p700["opening_hours_raw"]) == ()               # 런타임 == 수집


def test_원문_칸_재파싱이_수집_판정과_다르면_센다() -> None:
    """런타임은 원문 칸만 다시 읽는다 — 칸이 수집 판정과 다르게 읽히는 통과분을 센다.

    ① 200자 절단이 휴무의 요일 토큰을 잘라냈다(수집은 월요일 휴무, 칸은 해석 불가 → `()`)
    ② 중복 병합이 영업시간은 뒤 레코드에서, 원문은 앞 레코드에서 가져왔다
    """
    # 괄호 단서는 파서가 건너뛰고 끝의 요일을 읽는다 — 절단이 그 요일을 잘라낸다
    long_rest = "매주 " + "(사정에 따라 변동될 수 있음) " * 6 + "월요일"
    http = FakeTourApiHttp(
        pages={("12", 1): envelope([
            list_item("800", "긴휴무관", mapx="126.60"),
            list_item("801", "성산일출봉"),
            list_item("802", "성산일출봉"),          # 801 과 같은 자리·이름 → 병합
            list_item("803", "멀쩡한곳", mapx="126.70"),
        ], 4)},
        intros={
            "800": envelope([intro_item("800", "12", "09:00~18:00 " + "관람 안내 " * 20, long_rest)], 1),
            "801": envelope([intro_item("801", "12", "전화 문의", "")], 1),
            "802": envelope([intro_item("802", "12", "09:00~18:00", "")], 1),
            "803": envelope([intro_item("803", "12", "09:00~18:00", "매주 월요일")], 1),
        },
    )
    result = collect(_adapter(http), area_code="39", content_types=["12"], max_calls=500)
    assert result.stats.merged == 1 and result.stats.passed == 3
    assert result.stats.raw_reparse_mismatch == 2
    assert result.stats.rest_unparsed == 0     # 수집 판정은 셋 다 창이 있다
    doc = to_output_document(result, area_code="39", content_types=["12"], collected_at=_NOW)
    mismatched = {p["provisional_id"] for p in doc["proposals"]
                  if parse_opening_hours_raw(p["opening_hours_raw"])
                  != Poi.from_dict(p["poi"]).open_hours}
    assert mismatched == {"tourapi-800", "tourapi-801"}
    assert doc["stats"]["raw_reparse_mismatch"] == 2


def test_output_document_carries_detail_raw_only_when_present() -> None:
    """상세 표시용 원문은 provenance.detail 로 — 없으면 키 자체가 없다 (TRIP-683 2단계)."""
    http = FakeTourApiHttp(
        pages={("39", 1): envelope([
            list_item("300", "올레국수", contenttypeid="39", mapx="126.53", mapy="33.4996",
                      cat1="A05", cat2="A0502", cat3="A05020100"),
            list_item("301", "삼대국수", contenttypeid="39", mapx="126.54", mapy="33.4990",
                      cat1="A05", cat2="A0502", cat3="A05020100"),
        ], 2)},
        intros={
            "300": envelope([intro_item("300", "39", "10:00~22:00", "연중무휴",
                                        firstmenu="고기국수", spendtime="1시간")], 1),
            "301": envelope([intro_item("301", "39", "10:00~22:00", "연중무휴")], 1),
        },
    )
    result = collect(_adapter(http), area_code="39", content_types=["39"], max_calls=500)
    doc = to_output_document(result, area_code="39", content_types=["39"], collected_at=_NOW)
    prov = {p["provisional_id"]: p["provenance"] for p in doc["proposals"]}
    assert prov["tourapi-300"]["detail"] == {"firstmenu": "고기국수"}   # spendtime 없음
    assert "detail" not in prov["tourapi-301"]


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
        + stats.category_unmapped + stats.address_missing == stats.listed


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


# ── 폐업 필터 (2단 실재, TRIP-280) ─────────────────────────────────────


def test_폐업_업소는_실재_단계에서_드롭된다() -> None:
    """**문 닫은 가게를 추천 후보에 넣는 것이 지금 실제로 일어나고 있었다.**

    2026-09-08 실측: 수집분의 음식점·카페 7,837건을 LOCALDATA 인허가와 대조하니
    210건(2.7%)이 폐업이었고, 그중 8년 전에 닫은 곳도 있었다. 좌표가 멀쩡해도
    실재하지 않으므로 2단(실재)에서 거른다.
    """
    from trippilot.poi_curation.sourcing.collection_gate import DROP_EXISTENCE_CLOSED

    gate = CollectionGate(closed_refs=frozenset({("tourapi", "closed-1")}))
    report = gate.apply([_candidate("open-1"), _candidate("closed-1", name="문닫은집")])

    assert [p.poi.name for p in report.passed] == ["성산일출봉"], "폐업분만 빠진다"
    assert len(report.passed) == 1
    assert report.drops.get(DROP_EXISTENCE_CLOSED) == 1


def test_폐업_목록_미주입이면_기존_동작_그대로() -> None:
    """근거가 없으면 판정하지 않는다 — 없다고 전부 통과시키는 것도, 막는 것도 아니다."""
    report = CollectionGate().apply([_candidate("a"), _candidate("b", name="다른집")])

    assert len(report.passed) == 2
    assert "existence_closed_business" not in report.drops


# ── 좌표 "0" 은 결측이다 — 권역 밖이 아니다 (회귀 고정) ────────────────
# TourAPI 는 좌표 결측을 `"0"` 으로 준다. 그대로 두면 (0,0)이 GeoPoint 를 통과한
# 뒤 한국 bbox 밖으로 떨어져 게이트 2단이 `existence_out_of_service_region` 으로
# 계상했다 — 결측이 "권역 밖"으로 둔갑해 통계가 원인을 숨겼다. 09-10 실측:
# 신규 31건 전부 이 사유였고, 그게 좌표 결측인지 진짜 권역 밖인지 로그로는
# 판별이 안 됐다. 결측은 1단(`schema_missing_or_invalid_coord`)이 잡아야 한다.


@pytest.mark.parametrize("raw", ["0", "0.0", 0, 0.0, "", None])
def test_zero_or_empty_coordinate_is_missing(raw) -> None:
    from trippilot.poi_curation.sourcing.tourapi import TourApiAdapter

    assert TourApiAdapter._opt_coord(raw) is None  # noqa: SLF001


@pytest.mark.parametrize("raw,expected", [("33.4580", 33.458), (126.9423, 126.9423)])
def test_real_coordinate_survives(raw, expected: float) -> None:
    from trippilot.poi_curation.sourcing.tourapi import TourApiAdapter

    assert TourApiAdapter._opt_coord(raw) == pytest.approx(expected)  # noqa: SLF001


def test_zero_coordinate_record_is_dropped_as_schema_not_existence() -> None:
    """드롭 사유가 바뀌는 것이 이 수정의 전부다 — 드롭 자체는 전에도 됐다."""
    from trippilot.poi_curation.sourcing.collection_gate import (
        DROP_EXISTENCE,
        DROP_SCHEMA_COORD,
        CollectionGate,
    )
    from trippilot.poi_curation.sourcing.tourapi import TourApiAdapter

    item = {"contentid": "1", "title": "좌표없는곳", "addr1": "서울특별시 종로구 종로 1",
            "mapx": "0", "mapy": "0", "cat1": "A02", "cat2": "A0201"}
    rec = TourApiAdapter._to_record(item, "12")  # noqa: SLF001
    assert rec.lat is None and rec.lng is None

    from trippilot.domain.poi import PoiCategory
    from trippilot.poi_curation.sourcing.collection_gate import SourcingCandidate

    c = SourcingCandidate(source_ref="1", kind="12", name="좌표없는곳",
                          address=rec.address, lat=rec.lat, lng=rec.lng,
                          category=PoiCategory.SIGHT, category_codes=(),
                          open_hours=(), hours_raw=None, image_url=None,
                          modified_at=None)
    report = CollectionGate().apply([c])
    assert report.drops.get(DROP_SCHEMA_COORD) == 1
    assert DROP_EXISTENCE not in report.drops


# ── 상세 조회 표지 · 되감기 재조회 (TRIP-1230 후속) ──────────────────────
# 일일 수집은 기제안·변경 없음 항목의 상세를 다시 받지 않는다 — #949(휴무 원문 동봉) 이전
# 수집분에는 벤더가 고치지 않는 한 휴무가 영영 안 붙는다. 그래서 상세를 받은 제안에 조회일
# 표지(`provenance.detail_fetched_on`)를 달고, 표지 없는 공유본 제안은 scripts/refetch_intro.py
# 가 content_id 로 상세만 다시 받아 `refresh_proposal` 로 정상 수집과 같은 제안을 다시 낸다.

_TODAY = _NOW.date().isoformat()


def _one(item: dict, intro: dict | None, *, max_calls: int = 500) -> dict | None:
    """목록 레코드 1건(+상세)을 정상 수집 → 제안 1건 (게이트 탈락이면 None). 공유본처럼 JSON 왕복."""
    kind, cid = item["contenttypeid"], item["contentid"]
    http = FakeTourApiHttp(pages={(kind, 1): envelope([item], 1)},
                           intros={cid: envelope([intro], 1)} if intro else {})
    result = collect(_adapter(http), area_code="39", content_types=[kind], max_calls=max_calls)
    doc = to_output_document(result, area_code="39", content_types=[kind], collected_at=_NOW)
    proposals = json.loads(json.dumps(doc, ensure_ascii=False))["proposals"]
    return proposals[0] if proposals else None


def _detail(intro: dict | None, cid: str = "100", kind: str = "12") -> SourcedDetail:
    """되감기가 content_id 로 받는 상세 — 같은 어댑터, 같은 fake."""
    http = FakeTourApiHttp(intros={cid: envelope([intro], 1)} if intro else {})
    return _adapter(http).fetch_detail(cid, kind)


def test_상세를_받은_제안에만_조회일_표지가_붙는다() -> None:
    """빈 응답("물어봤더니 없더라")도 받은 것이다 — 못 물어본 것(실패·예산 소진)만 표지가 없다.

    표지 없는 제안이 되감기 대상이다. 예산에 굶은 항목에 표지를 달면 영영 다시 안 묻는다 —
    기제안 색인이 같은 이유로 "상세 조회를 마쳤는가"를 기준으로 삼는다(TRIP-348 #280).
    """
    http = FakeTourApiHttp(
        pages={("12", 1): envelope([
            list_item("100", "성산일출봉"),
            list_item("101", "만장굴", mapx="126.7708", mapy="33.5284"),
            list_item("102", "비자림", mapx="126.8100", mapy="33.4900"),
            list_item("103", "사려니숲길", mapx="126.6200", mapy="33.4100"),
        ], 4)},
        intros={"100": envelope([intro_item("100", "12", "07:00~20:00", "")], 1),
                # 101 은 등록 없음 = 빈 응답
                "102": error_envelope("01", "APPLICATION_ERROR")},
    )
    result = collect(_adapter(http), area_code="39", content_types=["12"],
                     max_calls=4)   # 목록 1 + 상세 3 — 103 은 예산에 굶는다
    assert result.stats.detail_failures == 1 and result.stats.budget_exhausted
    doc = to_output_document(result, area_code="39", content_types=["12"], collected_at=_NOW)
    stamps = {p["provenance"]["content_id"]: p["provenance"].get("detail_fetched_on")
              for p in doc["proposals"]}
    assert stamps == {"100": _TODAY, "101": _TODAY, "102": None, "103": None}


_KIND_CODES = {   # 타입별로 카테고리가 매핑되는 분류 코드 (매핑 불가로 떨어지지 않게)
    "12": {}, "14": {}, "28": {}, "38": {},
    "39": {"cat1": "A05", "cat2": "A0502", "cat3": "A05020100"},
}
_HOURS_TEXT = st.one_of(
    st.sampled_from(["09:00~18:00", "10:00~22:00 (브레이크타임 15:00~17:00)", "상시 개방",
                     "11:00~21:00\n휴무: 가짜 구분자", "09:00~18:00 " + "관람 안내 " * 30, ""]),
    st.text(max_size=40),
)
_REST_TEXT = st.one_of(
    st.sampled_from(["매주 월요일", "연중무휴", "점포별 상이", "동절기 휴장",
                     "매주 월요일 / 1월 1일, 설·추석 당일", ""]),
    st.text(max_size=40),
)


@settings(max_examples=80, deadline=None)
@given(
    kind=st.sampled_from(sorted(_KIND_CODES)),
    name=st.one_of(st.sampled_from(["성산일출봉", " 카페 델문도 ", "GS25 제주점"]),
                   st.text(min_size=1, max_size=12)),
    hours=_HOURS_TEXT,
    rest=_REST_TEXT,
    extra=st.dictionaries(
        st.sampled_from(["parking", "usefee", "saleitem", "firstmenu", "spendtime"]),
        st.text(max_size=10), max_size=3),
    pre949=st.booleans(),
)
def test_pbt_되감기는_정상_수집과_같은_제안을_낸다(kind, name, hours, rest, extra, pre949) -> None:
    """같은 목록 레코드 + 같은 상세 → collect()+to_output_document 와 같은 제안(같은 표지 날짜).

    저장본은 공유본의 옛 모양 둘이다 — 상세를 못 받은 것(예산 굶주림), #949 이전이라 영업 원문만
    실린 것. 둘 다 #890 이전 수집이라 사진이 http 로 남아 있다(어댑터는 이제 https 로 올린다).
    게이트가 떨어뜨리는 이름(편의점·빈 이름)은 정상 수집에도 없으니 되감기도 None 이어야 한다.
    """
    item = list_item("100", name, contenttypeid=kind, firstimage="http://img/100.jpg",
                     **_KIND_CODES[kind])
    intro = intro_item("100", kind, hours, rest, **extra)
    full = _one(item, intro)
    stored = _one(item, None, max_calls=1)      # 목록만 — 원문·표지·상세 원문 없음
    if stored is None:                          # 게이트 탈락 이름 — 정상 수집도 탈락이다
        assert full is None
        return
    assert "detail_fetched_on" not in stored["provenance"]
    detail = _detail(intro, kind=kind)
    if pre949:
        stored["opening_hours_raw"] = join_opening_hours_raw(detail.hours_raw, None)
    stored["provenance"]["image_url"] = "http://img/100.jpg"
    assert refresh_proposal(stored, detail, fetched_on=_TODAY) == full


def test_빈_상세_응답은_알던_영업시간을_지우지_않는다() -> None:
    """백엔드는 재적재 때 원문 칸을 null 로도 덮어쓴다 — 정상 수집처럼 비우면 알던 영업시간이 사라진다.

    레포츠(28) 상세는 실측 86.7% 가 빈 응답이다. 영업 원문 없이 휴무만 온 응답도 같다 —
    원문 칸은 영업 원문이 있어야 생기므로(`join_opening_hours_raw`) 그대로 내면 null 이다.
    영업·휴무 원문은 한 응답의 짝이라 저장본의 쌍을 통째로 지킨다(게이트 병합과 같은 규칙).
    """
    stored = _one(list_item("100", "성산일출봉"),
                  intro_item("100", "12", "09:00~18:00", "매주 월요일", parking="가능"))
    del stored["provenance"]["detail_fetched_on"]                 # 표지 이전 수집분
    for fresh in (SourcedDetail(hours_raw=None, rest_raw=None),
                  SourcedDetail(hours_raw=None, rest_raw="매주 화요일")):
        out = refresh_proposal(stored, fresh, fetched_on="2026-10-05")
        assert out["opening_hours_raw"] == "09:00~18:00" + REST_SEP + "매주 월요일"
        assert out["poi"]["open_hours"] == stored["poi"]["open_hours"]      # 월요일 휴무 그대로
        assert out["provenance"]["detail"] == {"parking": "가능"}          # 상세 원문도 지킨다
        assert out["provenance"]["detail_fetched_on"] == "2026-10-05"     # 물어봤다 — 다시 안 묻는다
    # 새 응답에 상세 원문이 있으면 그것이 이긴다 (영업 원문과 별개 판정)
    out = refresh_proposal(stored, SourcedDetail(None, None, detail_raw={"parking": "불가"}),
                           fetched_on="2026-10-05")
    assert out["provenance"]["detail"] == {"parking": "불가"}


@settings(max_examples=60, deadline=None)
@given(
    stored_raw=st.one_of(
        st.sampled_from([REST_SEP + "매주 월요일", "09:00~18:00" + REST_SEP + "월" + REST_SEP + "화",
                         "10:00~22:00 " * 25]),
        st.text(min_size=1, max_size=260),
    ).filter(str.strip),
    hours=st.none() | st.text(min_size=1, max_size=40).map(str.strip).filter(bool),
    rest=st.none() | st.text(min_size=1, max_size=40).map(str.strip).filter(bool),
)
def test_pbt_저장본에_원문이_있으면_되감기가_원문_칸을_비우지_않는다(stored_raw, hours, rest) -> None:
    """적대적 저장본(구분자로 시작·구분자 둘·200자 초과 …)에도 원문 칸이 비지 않는다.

    새 응답에 영업 원문이 없으면 저장본 칸을 **글자 그대로** 지키고, 영업시간은 그 칸을 런타임과
    같은 방식으로 다시 읽은 값이다(`parse_opening_hours_raw` — 칸과 판정이 갈리지 않게).
    상세 응답은 어댑터를 거쳐 오므로 공백뿐인 값은 None 이다(`_opt_str`).
    """
    stored = _one(list_item("100", "성산일출봉"), None, max_calls=1)
    stored["opening_hours_raw"] = stored_raw
    out = refresh_proposal(stored, SourcedDetail(hours_raw=hours, rest_raw=rest),
                           fetched_on=_TODAY)
    assert out["opening_hours_raw"]
    if hours is None:
        assert out["opening_hours_raw"] == stored_raw
        assert Poi.from_dict(out["poi"]).open_hours == parse_opening_hours_raw(stored_raw)


def test_게이트가_떨어뜨리면_되감기도_내지_않는다() -> None:
    """수집 뒤에 생긴 규칙(관광 무관 이름 — TRIP-686)에 걸리면 정상 수집처럼 None — 저장본은 병합이 정리한다."""
    stored = _one(list_item("100", "성산일출봉"), None, max_calls=1)
    stored["poi"]["name"] = "GS25 제주점"
    assert refresh_proposal(stored, _detail(intro_item("100", "12", "07:00~20:00", "")),
                            fetched_on=_TODAY) is None
