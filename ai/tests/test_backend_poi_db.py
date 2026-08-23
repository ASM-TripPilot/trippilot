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
"""

from __future__ import annotations

import urllib.error

import pytest

from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.poi import DataQuality, PoiCategory, PoiSource
from trippilot.poi_curation.adapters.backend_poi_db import (
    BackendPoiDb,
    BackendPoiDbError,
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


def test_opening_hours_raw_string_parsed_to_week() -> None:
    """"09:00~18:00" 원문 → 요일 7건 (수집 게이트와 같은 파서 재사용)."""
    db, _ = _db([_row()])
    (poi,) = db.find_by_radius(GeoPoint(37.5, 127.0), 5.0)
    assert len(poi.open_hours) == 7
    assert all((oh.open_min, oh.close_min) == (540, 1080) for oh in poi.open_hours)


@pytest.mark.parametrize("raw", [None, "", "야간개장 상이", "09:00~13:00, 14:00~18:00"])
def test_unparseable_opening_hours_become_empty_not_invented(raw) -> None:
    """미보유·파싱 불가 → () — 지어내지 않는다 (풀 빌더가 통과+하위 정렬)."""
    db, _ = _db([_row(opening_hours=raw)])
    (poi,) = db.find_by_radius(GeoPoint(37.5, 127.0), 5.0)
    assert poi.open_hours == ()


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
