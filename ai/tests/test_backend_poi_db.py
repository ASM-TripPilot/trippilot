"""TRIP-408 — BackendPoiDb: 백엔드 `/internal/pois` 정본 read 어댑터.

증명하는 것 (HTTP 는 전부 fake — 실 호출 0, D37):
  ① find_by_radius → GET /internal/pois + centerLat/centerLng/radiusKm + 토큰 헤더
  ② find_by_ids → POST /internal/pois/batch-get + {"poi_ids": [...]} (빈 집합은 무호출)
  ③ 행 매핑 — 경계 코드 → PoiCategory, 영업시간 원문 재사용 파서(parse_open_hours),
     미보유 → open_hours=() (배제 아님 — 풀 빌더 ⑤ 하위 정렬), 소스 MANUAL→SEED
  ④ 빈 배열 → 빈 튜플 (NO_CANDIDATES 를 그대로 보고 — 임의 대체 금지, INV-1)
  ⑤ HTTP 실패·비배열 응답 → BackendPoiDbError (빈 결과로 위장 금지, INV-4)
     + 백엔드 상태코드를 예외에 실어 경계가 책임 소재를 가르게 한다 (TRIP-436)
  ⑥ 계약 위반 행 1건은 스킵 — 풀 전체를 잃지 않는다
  ⑦ 스킵을 **값으로도 낸다** (TRIP-537, lookup_by_ids): 요청 대비 누락 id + 사유
     (not_found=백엔드가 안 줌 / mapping_failed=줬는데 못 읽음 + 원인 필드명)
  ⑧ 카테고리 enum 드리프트 — 백엔드 정본과 경계 코드 집합이 같다. 출처 enum 은 값마다 뜻이
     명시돼 있고, 모르는 출처는 행을 살리되 경고로 드러낸다 (TRIP-1224)
"""

from __future__ import annotations

import re
import urllib.error

import pytest

from pathlib import Path

from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.poi import DataQuality, PoiCategory, PoiSource
from trippilot.poi_curation.adapters.backend_poi_db import (
    _SOURCE_MAP,
    BackendPoiDb,
    BackendPoiDbError,
    _warn_unknown_source,
)


def _row(**over: object) -> dict:
    """PoiInternalController.PoiReadResponse 실 응답 형태 (snake_case)."""
    row = {
        "poi_id": "e0000000-0000-4000-8000-000000000001",
        "name_ko": "경복궁",
        "category": "SIGHT",
        "lat": 37.5796,
        "lng": 126.9770,
        "region": "서울",
        "opening_hours": "09:00~18:00",
        "data_status": "ACTIVE",
        "source": "TOURAPI",
        "saved_count": 12,
        "data_quality": "FULL",
        "distance_m": 1234.5,
    }
    row.update(over)
    return row


class FakeHttp:
    def __init__(self, response: object) -> None:
        self.response = response
        self.calls: list[dict] = []

    def request_json(self, method, url, *, params=None, body=None, headers=None):
        self.calls.append(
            {"method": method, "url": url, "params": params,
             "body": body, "headers": headers}
        )
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


def _db(response: object) -> tuple[BackendPoiDb, FakeHttp]:
    http = FakeHttp(response)
    return BackendPoiDb(http, "http://backend:8080/", "secret-token"), http


# ── ① 반경 조회 와이어 ───────────────────────────────────────────────


def test_find_by_radius_calls_internal_pois_with_token() -> None:
    db, http = _db([_row()])
    db.find_by_radius(GeoPoint(37.5796, 126.9770), 10.0)
    call = http.calls[0]
    assert call["method"] == "GET"
    assert call["url"] == "http://backend:8080/internal/pois"  # base 후행 슬래시 정리
    assert call["params"] == {
        "centerLat": "37.5796", "centerLng": "126.977", "radiusKm": "10.0"
    }
    assert call["headers"] == {"X-Service-Token": "secret-token"}


# ── ② 배치 조회 와이어 ───────────────────────────────────────────────


def test_find_by_ids_posts_batch_get() -> None:
    db, http = _db([_row()])
    db.find_by_ids(frozenset({PoiId("b"), PoiId("a")}))
    call = http.calls[0]
    assert call["method"] == "POST"
    assert call["url"] == "http://backend:8080/internal/pois/batch-get"
    assert call["body"] == {"poi_ids": ["a", "b"]}  # 정렬 — 결정론 호출
    assert call["headers"] == {"X-Service-Token": "secret-token"}


def test_find_by_ids_splits_batches_at_backend_limit() -> None:
    """201건 → 200 + 1 두 번 POST — 백엔드 MAX_BATCH_SIZE(200) 초과는 400 이라 생성 전체가 죽는다(TRIP-871)."""
    db, http = _db([])
    ids = frozenset(PoiId(f"{i:08d}-0000-4000-8000-000000000000") for i in range(201))

    lookup = db.lookup_by_ids(ids)

    bodies = [c["body"]["poi_ids"] for c in http.calls]
    assert [len(b) for b in bodies] == [200, 1]
    assert sorted(x for b in bodies for x in b) == sorted(str(i) for i in ids)  # 빠짐·중복 없이 전부
    assert len(lookup.misses) == 201  # 빈 응답 — 누락 사유는 청크와 무관하게 전량 not_found


def test_find_by_ids_empty_set_makes_no_call() -> None:
    db, http = _db([])
    assert db.find_by_ids(frozenset()) == ()
    assert http.calls == []


# ── ③ 행 매핑 ────────────────────────────────────────────────────────


def test_row_maps_to_domain_poi() -> None:
    db, _ = _db([_row()])
    (poi,) = db.find_by_radius(GeoPoint(37.5, 127.0), 5.0)
    assert poi.poi_id == PoiId("e0000000-0000-4000-8000-000000000001")
    assert poi.name == "경복궁"
    assert poi.category is PoiCategory.SIGHT
    assert (poi.coord.lat, poi.coord.lng) == (37.5796, 126.9770)
    assert poi.quality is DataQuality.FULL
    assert poi.source is PoiSource.PLACES_API  # TOURAPI → 벤더 수집분
    assert poi.avg_cost is None and poi.rating is None and poi.confidence is None
    assert poi.saved_count == 12  # 인기 신호 — 별점 대신 이걸 쓴다


def test_missing_saved_count_defaults_to_zero_not_error() -> None:
    """구 백엔드 응답(필드 없음)에서도 행을 잃지 않는다 — 인기 0으로 취급."""
    row = _row(); del row["saved_count"]
    db, _ = _db([row])
    (poi,) = db.find_by_radius(GeoPoint(37.5, 127.0), 5.0)
    assert poi.saved_count == 0


def test_opening_hours_raw_string_parsed_to_week() -> None:
    """"09:00~18:00" 원문 → 요일 7건 (수집 게이트와 같은 파서 재사용)."""
    db, _ = _db([_row()])
    (poi,) = db.find_by_radius(GeoPoint(37.5, 127.0), 5.0)
    assert len(poi.open_hours) == 7
    assert all((oh.open_min, oh.close_min) == (540, 1080) for oh in poi.open_hours)


@pytest.mark.parametrize("raw", [None, "", "야간개장 상이"])
def test_unparseable_opening_hours_become_empty_not_invented(raw) -> None:
    """미보유·파싱 불가 → () — 지어내지 않는다 (풀 빌더가 통과+하위 정렬)."""
    db, _ = _db([_row(opening_hours=raw)])
    (poi,) = db.find_by_radius(GeoPoint(37.5, 127.0), 5.0)
    assert poi.open_hours == ()


def test_분리_영업은_앞_창만_쓴다() -> None:
    """`09:00~13:00, 14:00~18:00`(점심 쉬는 가게)은 **앞 창만** 읽는다.

    종전에는 통째로 포기했다(시각 4회 → 확정 불가). 이제 첫 창을 쓴다 —
    지어낸 값이 아니라 원문에 있는 실제 영업창이고, 오후를 빠뜨리는 쪽이라
    **닫힌 시간에 일정을 넣지 않는다**(HC1 기준 안전한 방향).

    도메인은 하루 다중 창을 지원하고 어셈블러도 요일별 목록을 받는다. 그런데
    실 수집분 18,605건에서 이 모양은 **5건뿐**이라 다중 창 파싱을 짓지 않았다 —
    얻는 것보다 코드가 크다.
    """
    db, _ = _db([_row(opening_hours="09:00~13:00, 14:00~18:00")])
    (poi,) = db.find_by_radius(GeoPoint(37.5, 127.0), 5.0)
    assert len(poi.open_hours) == 7
    assert all((oh.open_min, oh.close_min) == (540, 780) for oh in poi.open_hours)


# ── 원문 칸에 실려 오는 휴무 (TRIP-1226) ─────────────────────────────────


def test_원문_칸의_휴무가_런타임에_반영된다() -> None:
    """수집이 영업 원문 뒤에 휴무 원문을 붙여 보낸다 — 갈라 읽지 않으면 월요일에도 영업이다.

    종전에는 이 칸을 휴무 없이(`parse_open_hours(원문, None)`) 읽어서, 수집 때 반영된
    주간 휴무가 런타임에 사라졌다(2026-10-02 실측: 주간 휴무 FOOD 312건).
    """
    db, _ = _db([_row(opening_hours="09:00~18:00\n휴무: 매주 월요일")])
    (poi,) = db.find_by_radius(GeoPoint(37.5, 127.0), 5.0)
    assert [oh.day_of_week for oh in poi.open_hours] == [1, 2, 3, 4, 5, 6]
    assert all((oh.open_min, oh.close_min) == (540, 1080) for oh in poi.open_hours)


def test_박물관_휴무_문구는_런타임에도_월요일만_뺀다() -> None:
    """연 단위 휴일이 붙어도 매주 휴무는 읽는다(TRIP-1230) — 종전엔 통째로 포기해 창까지 잃었다."""
    db, _ = _db([_row(opening_hours="09:00~18:00\n휴무: 매주 월요일, 1월 1일, 설날 및 추석 당일")])
    (poi,) = db.find_by_radius(GeoPoint(37.5, 127.0), 5.0)
    assert [oh.day_of_week for oh in poi.open_hours] == [1, 2, 3, 4, 5, 6]


@pytest.mark.parametrize("rest", [
    "점포별 상이",          # 어느 날 닫는지 모른다
    "동절기 휴장",          # 요일 없는 휴무
])
def test_해석할_수_없는_휴무면_수집_때처럼_포기한다(rest: str) -> None:
    """요일을 못 읽는 휴무는 주간 스케줄로 못 쓴다 — 7일 영업으로 읽으면 닫힌 날에 일정이 들어간다.

    대가: 이 POI 는 "정보 없음"이라 HC1 이 안 걸린다(종전엔 휴무가 칸에 없어 7일 창이었다).
    그래도 수집과 같게 읽는다 — 결정·실측은 data/README 「휴무를 해석 못 하는 POI」.
    """
    db, _ = _db([_row(opening_hours=f"09:00~18:00\n휴무: {rest}")])
    (poi,) = db.find_by_radius(GeoPoint(37.5, 127.0), 5.0)
    assert poi.open_hours == ()


def test_구분자_없는_옛_원문은_종전대로_읽는다() -> None:
    """백필 전 적재분·다른 출처 원문 — 휴무 칸이 없으면 종전과 같은 7일이다(하위호환)."""
    db, _ = _db([_row(opening_hours="10:00~22:00<br>※ 휴무일 및 운영시간은 업체 사정에 따라 변동")])
    (poi,) = db.find_by_radius(GeoPoint(37.5, 127.0), 5.0)
    assert len(poi.open_hours) == 7
    assert all((oh.open_min, oh.close_min) == (600, 1320) for oh in poi.open_hours)


def test_manual_source_maps_to_seed() -> None:
    db, _ = _db([_row(source="MANUAL"), _row(poi_id="x", source="KAKAO_LOCAL")])
    manual, kakao = db.find_by_radius(GeoPoint(37.5, 127.0), 5.0)
    assert manual.source is PoiSource.SEED
    assert kakao.source is PoiSource.PLACES_API


# ── ④ 후보 없음은 그대로 보고 ────────────────────────────────────────


def test_empty_response_returns_empty_tuple() -> None:
    db, _ = _db([])
    assert db.find_by_radius(GeoPoint(37.5, 127.0), 5.0) == ()


# ── ⑤ 실패는 예외 — 빈 결과 위장 금지 ────────────────────────────────


def test_http_failure_raises_not_empty() -> None:
    db, _ = _db(OSError("connection refused"))
    with pytest.raises(BackendPoiDbError, match="/internal/pois"):
        db.find_by_radius(GeoPoint(37.5, 127.0), 5.0)


def test_non_list_response_raises() -> None:
    db, _ = _db({"error": "unexpected"})
    with pytest.raises(BackendPoiDbError, match="배열이 아님"):
        db.find_by_radius(GeoPoint(37.5, 127.0), 5.0)


# ── ⑤' 상태코드를 실어 올린다 — 4xx 는 상대 장애가 아니다 (TRIP-436) ──


def _http_error(code: int) -> urllib.error.HTTPError:
    """UrllibJsonClient 가 실제로 흘리는 예외 형태(urlopen 비2xx) — 실 호출 0."""
    return urllib.error.HTTPError("http://backend:8080/x", code, "", None, None)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("code", "retryable"),
    [(400, False), (401, False), (403, False), (404, False), (500, True), (503, True)],
)
def test_http_error_carries_status_and_retryability(code: int, retryable: bool) -> None:
    """4xx 는 우리가 잘못 보낸 것 — 재시도해도 같다. 5xx 만 상대 장애라 재시도 가치가 있다."""
    db, _ = _db(_http_error(code))
    with pytest.raises(BackendPoiDbError) as caught:
        db.find_by_ids(frozenset({PoiId("NOT-A-UUID")}))
    assert caught.value.status == code
    assert caught.value.retryable is retryable


def test_connection_failure_has_no_status_but_is_retryable() -> None:
    """연결 실패는 상태코드가 없다 — 상대 장애 쪽으로 수렴한다."""
    db, _ = _db(OSError("connection refused"))
    with pytest.raises(BackendPoiDbError) as caught:
        db.find_by_radius(GeoPoint(37.5, 127.0), 5.0)
    assert caught.value.status is None
    assert caught.value.retryable is True


def test_non_list_response_is_not_retryable() -> None:
    """200 인데 계약 위반 — 재시도해도 같은 응답이라 재시도 신호를 켜지 않는다."""
    db, _ = _db({"error": "unexpected"})
    with pytest.raises(BackendPoiDbError) as caught:
        db.find_by_radius(GeoPoint(37.5, 127.0), 5.0)
    assert caught.value.status is None
    assert caught.value.retryable is False


# ── ⑥ 계약 위반 행은 스킵 — 풀 전체를 잃지 않는다 ────────────────────


def test_bad_row_skipped_others_survive(caplog: pytest.LogCaptureFixture) -> None:
    db, _ = _db([_row(category="알수없는코드"), _row(poi_id="ok")])
    with caplog.at_level("WARNING"):
        pois = db.find_by_radius(GeoPoint(37.5, 127.0), 5.0)
    assert [str(p.poi_id) for p in pois] == ["ok"]
    assert any("매핑 실패" in r.message for r in caplog.records)


# ── ⑦ 누락을 값으로 낸다 (TRIP-537) ──────────────────────────────────
# 로그만 남기면 호출자는 N건을 물어 M건을 받고도 왜 빠졌는지 모른다. 그 조용한
# 차집합이 검증 경계에서 "위반 0 = 통과"로 읽혔다(INV-4 침묵 실패).


def _ids(*raw: str) -> frozenset[PoiId]:
    return frozenset(PoiId(r) for r in raw)


def test_all_rows_mapped_means_no_misses() -> None:
    """전부 정상이면 누락 0 — 정상 경로가 조용한 것이 기본값이다."""
    db, _ = _db([_row(poi_id="a"), _row(poi_id="b")])
    lookup = db.lookup_by_ids(_ids("a", "b"))
    assert [str(p.poi_id) for p in lookup.pois] == ["a", "b"]
    assert lookup.misses == ()


def test_rows_backend_never_returned_are_not_found() -> None:
    """3건 요청 → 1건 회신: 나머지 둘이 사유와 함께 목록에 오른다."""
    db, _ = _db([_row(poi_id="a")])
    lookup = db.lookup_by_ids(_ids("a", "b", "c"))
    assert [(str(m.poi_id), m.reason) for m in lookup.misses] == [
        ("b", "not_found"), ("c", "not_found"),
    ]


def test_null_coordinate_row_is_mapping_failed_with_field_name() -> None:
    """돌려줬는데 좌표가 null — not_found 가 아니다. 어느 필드인지까지 낸다."""
    db, _ = _db([_row(poi_id="a", lat=None)])
    (miss,) = db.lookup_by_ids(_ids("a")).misses
    assert (str(miss.poi_id), miss.reason, miss.detail) == ("a", "mapping_failed", "lat")


def test_unknown_category_is_mapping_failed_not_silent_skip() -> None:
    """백엔드가 카테고리를 하나 추가하면 그 값의 POI 전부가 여기로 온다 — 소리 없이 빠지지 않는다."""
    db, _ = _db([_row(poi_id="a", category="PET_FRIENDLY")])
    (miss,) = db.lookup_by_ids(_ids("a")).misses
    assert (miss.reason, miss.detail) == ("mapping_failed", "category")


def test_unknown_data_quality_is_mapping_failed() -> None:
    db, _ = _db([_row(poi_id="a", data_quality="UNVERIFIED")])
    (miss,) = db.lookup_by_ids(_ids("a")).misses
    assert (miss.reason, miss.detail) == ("mapping_failed", "data_quality")


def test_mapping_failure_still_logs_and_keeps_other_rows(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """값으로 낸다고 로그를 걷어내지 않는다 — 운영 가시성은 그대로."""
    db, _ = _db([_row(poi_id="bad", lat=None), _row(poi_id="ok")])
    with caplog.at_level("WARNING"):
        lookup = db.lookup_by_ids(_ids("bad", "ok"))
    assert [str(p.poi_id) for p in lookup.pois] == ["ok"]
    assert [m.reason for m in lookup.misses] == ["mapping_failed"]
    assert any("매핑 실패" in r.message for r in caplog.records)


def test_empty_request_makes_no_call_and_no_misses() -> None:
    db, http = _db([])
    lookup = db.lookup_by_ids(frozenset())
    assert (lookup.pois, lookup.misses) == ((), ())
    assert http.calls == []


def test_find_by_ids_still_returns_only_pois() -> None:
    """기존 호출자(거리 렌더·설명)는 그대로 — 반환형을 안 바꾼 이유다."""
    db, _ = _db([_row(poi_id="a")])
    assert [str(p.poi_id) for p in db.find_by_ids(_ids("a", "b"))] == ["a"]


# ── ⑧ 경계 enum 드리프트 (TRIP-537) ──────────────────────────────────


def _backend_source(rel: str) -> str:
    """리포 안 백엔드 정본을 위로 올라가며 찾는다(모듈 위치 이동에 견딘다).

    못 찾으면 skip 이 아니라 **실패**다 — 파일이 사라진 채 초록이면 게이트가 없는
    것과 같다(백엔드 `AiBoundaryOpenApiTest.aiContractFile()` 과 같은 규약).
    """
    for parent in Path(__file__).resolve().parents:
        candidate = parent / rel
        if candidate.is_file():
            return candidate.read_text(encoding="utf-8")
    raise AssertionError(f"백엔드 정본을 찾지 못했습니다: {rel}")


_POI_KT = "backend/modules/place-data/src/main/kotlin/com/trippilot/placedata/domain/Poi.kt"


def test_boundary_category_codes_match_backend_canon() -> None:
    """백엔드 `PoiCategory.boundaryCode` 집합 == AI `PoiCategory` (내부 전용 STAY 제외).

    상대가 카테고리를 하나 추가하면 여기서 깨진다. 안 깨지면 그 카테고리의 POI 는
    전부 `mapping_failed` 로 떨어져 HC1·HC2 판정 밖으로 나간다 — 시끄러운 편이 낫다.
    """
    backend_codes = set(re.findall(r'->\s*"([A-Z_]+)"', _backend_source(_POI_KT)))
    ai_codes = {c.value for c in PoiCategory} - {PoiCategory.STAY.value}
    assert backend_codes == ai_codes


def test_backend_data_quality_values_are_known_to_ai() -> None:
    """백엔드가 내보낼 수 있는 data_quality 리터럴 ⊆ AI DataQuality (부분집합이면 족하다)."""
    controller = _backend_source(
        "backend/modules/place-data/src/main/kotlin/com/trippilot/placedata/"
        "adapter/in/web/PoiInternalController.kt"
    )
    line = next(ln for ln in controller.splitlines() if "dataQuality =" in ln)
    emitted = set(re.findall(r'"([A-Z_]+)"', line))
    assert emitted and emitted <= {q.value for q in DataQuality}


def test_every_backend_source_has_an_explicit_ai_meaning(caplog: pytest.LogCaptureFixture) -> None:
    """백엔드 `PoiSource` 값마다 AI 쪽 뜻이 **명시돼** 있다 — MANUAL 만 SEED, 나머지는 정형 수집분.

    모르는 출처를 PLACES_API 로 읽는 것은 안전망일 뿐이고(아래 테스트 — 경고가 난다), 뜻은 값마다
    `_SOURCE_MAP` 에 적는다. 새 출처가 WEB 처럼 confidence 를 요구하는 성격인지는 사람이 정해야
    하기 때문이다(LOCALDATA 일반음식점을 들이며 확인, TRIP-1224). 백엔드가 값을 늘리면 여기서
    깨진다 — ai-ci 가 `Poi.kt` 변경에도 돌아 **그 백엔드 PR 에서** 깨진다.
    """
    m = re.search(r"enum class PoiSource \{([^}]*)\}", _backend_source(_POI_KT))
    assert m is not None
    backend = {v.strip() for v in m.group(1).split(",") if v.strip()}
    assert backend == set(_SOURCE_MAP)

    db, _ = _db([_row(poi_id=s, source=s) for s in sorted(backend)])
    with caplog.at_level("WARNING"):
        got = {str(p.poi_id): p.source for p in db.find_by_radius(GeoPoint(37.5, 127.0), 5.0)}
    assert got == {s: PoiSource.SEED if s == "MANUAL" else PoiSource.PLACES_API for s in backend}
    assert not [r for r in caplog.records if "모르는 POI 출처" in r.getMessage()]


def test_unknown_source_keeps_the_row_but_is_warned_once_per_value(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """모르는 출처는 행을 살려 PLACES_API 로 읽되 조용히 흡수하지 않는다 — 값마다 한 번 경고.

    백엔드가 출처를 늘려 머지했는데 `_SOURCE_MAP` 이 못 따라온 사이의 런타임 안전망이다. 한
    응답에 같은 출처가 수백 행 오므로 경고는 값마다 첫 1회만 낸다(다음 요청도 조용하다).
    """
    _warn_unknown_source.cache_clear()
    db, _ = _db([_row(poi_id="a", source="OVERTURE"), _row(poi_id="b", source="OVERTURE"),
                 _row(poi_id="c", source=None)])
    with caplog.at_level("WARNING"):
        pois = db.find_by_radius(GeoPoint(37.5, 127.0), 5.0)
        db.find_by_radius(GeoPoint(37.5, 127.0), 5.0)
    assert [p.source for p in pois] == [PoiSource.PLACES_API] * 3
    warned = [r.getMessage() for r in caplog.records if "모르는 POI 출처" in r.getMessage()]
    assert len(warned) == 2
    assert any("'OVERTURE'" in w for w in warned) and any("None" in w for w in warned)
