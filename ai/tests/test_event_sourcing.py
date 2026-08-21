"""TRIP-421 — 행사 웹소싱 배치 부품 (실 호출 0, fake만, D37).

증명하는 것:
  [NaverSearchClient]
  ① API HUB 계약 — 엔드포인트·인증 헤더·query 파라미터, items 반환
  ② 하드캡 — 상한 도달 시 호출 **전에** CallBudgetExceeded (초과 호출 0건)
  ③ 형식 밖 응답은 빈 목록 (배치 계속 — 쿼리 1건만 빈손)
  [보조 규칙]
  ④ 태그 제거·지역 검색 좌표 변환 (1e7 배 정수, 한반도 밖은 None)
  [JsonEventStore]
  ⑤ 왕복 영속 + EventPort(search_events) 기간 교차 조회
  ⑥ dedup(이름 공백 제거+기간) — 재수집·다출처 중복 흡수
  ⑦ 만료 청소 — 종료 +7일 지난 레코드만 삭제
  ⑧ 커버리지·로테이션 포인터 영속
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from trippilot.background.event_store import JsonEventStore
from trippilot.background.naver_search import (
    CallBudgetExceeded,
    NaverSearchClient,
    coord_from_local_item,
    strip_tags,
)
from trippilot.domain.common import GeoPoint
from trippilot.domain.event import EventInfo, EventType

_NOW = datetime(2026, 8, 20, 4, 40, tzinfo=timezone(timedelta(hours=9)))
_TODAY = _NOW.date()


class _FakeHttp:
    def __init__(self, payload=None) -> None:
        self._payload = payload if payload is not None else {"items": []}
        self.calls: list[tuple[str, dict, dict]] = []

    def get_json(self, url, headers, params):
        self.calls.append((url, dict(headers), dict(params)))
        return self._payload


# ── ①·②·③ 클라이언트 ────────────────────────────────────────────────


def test_client_sends_hub_contract() -> None:
    http = _FakeHttp({"items": [{"title": "부산 <b>불꽃축제</b>", "description": "d"}]})
    client = NaverSearchClient(http, "cid", "csec", max_calls=10)
    items = client.search("webkr", "부산 축제", display=5)

    url, headers, params = http.calls[0]
    assert url == "https://naverapihub.apigw.ntruss.com/search/v1/webkr"
    assert headers["X-NCP-APIGW-API-KEY-ID"] == "cid"
    assert headers["X-NCP-APIGW-API-KEY"] == "csec"
    assert params == {"query": "부산 축제", "display": "5"}
    assert items[0]["title"] == "부산 <b>불꽃축제</b>"
    with pytest.raises(ValueError):
        client.search("shopping", "q")  # 종료된 API — 미지원 종류 차단


def test_client_hard_cap_blocks_before_calling() -> None:
    http = _FakeHttp()
    client = NaverSearchClient(http, "i", "s", max_calls=2)
    client.search("webkr", "a")
    client.search("blog", "b")
    with pytest.raises(CallBudgetExceeded):
        client.search("webkr", "c")
    assert len(http.calls) == 2  # 상한 초과 HTTP 호출 0건 — 캡이 1급 계약
    assert client.calls_used == 2


def test_client_malformed_payload_is_empty_list() -> None:
    assert NaverSearchClient(_FakeHttp("bad"), "i", "s", 5).search("news", "q") == []
    assert NaverSearchClient(_FakeHttp({"x": 1}), "i", "s", 5).search("news", "q") == []


# ── ④ 보조 규칙 ──────────────────────────────────────────────────────


def test_strip_tags_and_local_coord_conversion() -> None:
    assert strip_tags("부산 <b>불꽃축제</b> 개최") == "부산 불꽃축제 개최"
    coord = coord_from_local_item({"mapx": "1291186000", "mapy": "351532000"})
    assert coord == GeoPoint(35.1532, 129.1186)
    assert coord_from_local_item({"mapx": "bad", "mapy": "1"}) is None
    assert coord_from_local_item({}) is None
    # 1e7 배가 아닌 옛 카텍 좌표 오해 방지 — 한반도 밖이면 None
    assert coord_from_local_item({"mapx": "309650", "mapy": "552095"}) is None


# ── ⑤~⑧ 저장소 ───────────────────────────────────────────────────────


def _event(name: str, start: date, end: date, coord=None) -> EventInfo:
    return EventInfo(event_id=f"id-{name}", name=name, event_type=EventType.FESTIVAL,
                     start=start, end=end, coord=coord, address=None)


def test_store_roundtrip_and_period_query(tmp_path) -> None:
    path = tmp_path / "events.json"
    store = JsonEventStore(path)
    added = store.upsert("부산", (
        _event("불꽃축제", _TODAY, _TODAY + timedelta(days=2),
               coord=GeoPoint(35.15, 129.11)),
        _event("겨울축제", _TODAY + timedelta(days=90), _TODAY + timedelta(days=92)),
    ), _NOW)
    store.pointer = 5
    store.save()
    assert added == 2

    reloaded = JsonEventStore(path)
    found, truncated = reloaded.search_events(_TODAY, _TODAY + timedelta(days=7))
    assert truncated is False
    assert [e.name for e in found] == ["불꽃축제"]  # 기간 밖(90일 뒤)은 제외
    assert found[0].coord == GeoPoint(35.15, 129.11)
    assert reloaded.pointer == 5
    assert reloaded.coverage("부산") is not None and reloaded.coverage("서울") is None


def test_store_dedup_by_normalized_name_and_period(tmp_path) -> None:
    store = JsonEventStore(tmp_path / "events.json")
    store.upsert("부산", (_event("부산 불꽃축제", _TODAY, _TODAY),), _NOW)
    added = store.upsert("부산", (
        _event("부산불꽃 축제", _TODAY, _TODAY),      # 공백 차이 — 같은 행사
        _event("부산 불꽃축제", _TODAY + timedelta(days=30),
               _TODAY + timedelta(days=30)),          # 같은 이름, 다른 기간 — 다른 행사
    ), _NOW)
    assert added == 1
    assert store.counts()["events"] == 2


def test_store_purges_only_beyond_grace(tmp_path) -> None:
    store = JsonEventStore(tmp_path / "events.json")
    store.upsert("부산", (
        _event("오래끝남", _TODAY - timedelta(days=20), _TODAY - timedelta(days=10)),
        _event("막끝남", _TODAY - timedelta(days=5), _TODAY - timedelta(days=3)),
        _event("진행중", _TODAY, _TODAY + timedelta(days=1)),
    ), _NOW)
    assert store.purge_expired(_TODAY) == 1  # 유예 7일 안(막끝남)·진행중은 유지
    names = {e.name for e in store.search_events(
        _TODAY - timedelta(days=30), _TODAY + timedelta(days=30))[0]}
    assert names == {"막끝남", "진행중"}


# ── 배치 접합부 — collect_region 관통 (fake 검색·fake 워커) ──────────


def test_collect_region_glue(tmp_path) -> None:
    import sys
    from pathlib import Path as _P
    sys.path.insert(0, str(_P(__file__).resolve().parents[1] / "scripts"))
    from collect_events import collect_region

    class _RoutingHttp:
        """local 검색이면 좌표 item, 그 외면 스니펫 item."""

        def get_json(self, url, headers, params):
            if url.endswith("/local"):
                return {"items": [{"mapx": "1291186000", "mapy": "351532000"}]}
            return {"items": [{"title": "부산 <b>불꽃축제</b> 개최",
                               "description": "8월 22일 광안리"}]}

    class _FakeWorker:
        def extract(self, region, period_start, period_end, snippets,
                    trace_id, now, *, timeout_sec=None):
            assert snippets and snippets[0][0] == "부산 불꽃축제 개최"  # 태그 제거됨
            class _R:
                value = (_event("부산불꽃축제", period_start, period_start),)
                is_fallback = False
                error = None
            return _R()

    store = JsonEventStore(tmp_path / "events.json")
    client = NaverSearchClient(_RoutingHttp(), "i", "s", max_calls=10)
    stats = collect_region("부산", client=client, worker=_FakeWorker(),
                           store=store, today=_TODAY, now=_NOW)

    assert stats == {"region": "부산", "snippets": 1, "extracted": 1,
                     "geocoded": 1, "added": 1, "fallback": False, "error": None}
    found, _ = store.search_events(_TODAY, _TODAY)
    assert found[0].coord == GeoPoint(35.1532, 129.1186)  # 지역 검색 좌표 부여됨


def test_collect_region_geocodes_via_address_fallback(tmp_path) -> None:
    """행사명 질의 실패 → 주소 폴백 질의로 좌표 확보 (첫 배치 실측 1/4 대응)."""
    import sys
    from pathlib import Path as _P
    sys.path.insert(0, str(_P(__file__).resolve().parents[1] / "scripts"))
    from collect_events import collect_region

    class _AddressOnlyHttp:
        def __init__(self) -> None:
            self.local_queries: list[str] = []

        def get_json(self, url, headers, params):
            if url.endswith("/local"):
                self.local_queries.append(params["query"])
                if "달빛축제공원" in params["query"]:  # 주소 질의만 적중
                    return {"items": [{"mapx": "1266400000", "mapy": "374000000"}]}
                return {"items": []}
            return {"items": [{"title": "송도맥주축제", "description": "d"}]}

    class _FakeWorker:
        def extract(self, region, period_start, period_end, snippets,
                    trace_id, now, *, timeout_sec=None):
            class _R:
                value = (EventInfo(
                    event_id="e", name="송도맥주축제", event_type=EventType.FESTIVAL,
                    start=period_start, end=period_start, coord=None,
                    address="인천 송도 달빛축제공원"),)
                is_fallback = False
                error = None
            return _R()

    http = _AddressOnlyHttp()
    store = JsonEventStore(tmp_path / "events.json")
    stats = collect_region("인천", client=NaverSearchClient(http, "i", "s", 20),
                           worker=_FakeWorker(), store=store, today=_TODAY, now=_NOW)

    assert http.local_queries == ["인천 송도맥주축제", "인천 송도 달빛축제공원"]
    assert stats["geocoded"] == 1
    found, _ = store.search_events(_TODAY, _TODAY)
    assert found[0].coord == GeoPoint(37.4, 126.64)


def test_kakao_geocode_chain(tmp_path) -> None:
    """카카오 배선 시 체인: 네이버 행사명 → 카카오 주소 → 카카오 키워드 (TRIP-421)."""
    import sys
    from pathlib import Path as _P
    sys.path.insert(0, str(_P(__file__).resolve().parents[1] / "scripts"))
    from collect_events import _geocode
    from trippilot.background.kakao_local import KakaoLocalClient

    class _E:
        name = "송도맥주축제"
        address = "인천 송도 달빛축제공원"

    class _KakaoHttp:
        def __init__(self) -> None:
            self.urls: list[str] = []

        def get_json(self, url, headers, params):
            self.urls.append(url)
            assert headers["Authorization"] == "KakaoAK kk"
            if url.endswith("address.json"):
                return {"documents": [{"x": "126.64", "y": "37.40"}]}
            return {"documents": []}

    naver = NaverSearchClient(_FakeHttp({"items": []}), "i", "s", 10)  # 행사명 실패
    kakao = KakaoLocalClient(_KakaoHttp(), "kk", 10)
    coord = _geocode(_E(), "인천", naver, kakao)

    assert coord == GeoPoint(37.40, 126.64)  # 카카오 주소검색이 잡았다
    assert kakao.calls_used == 1  # 주소에서 적중 — 키워드까지 안 감

    # 카카오도 상한 규약 동일 — 초과 호출 0건
    capped = KakaoLocalClient(_KakaoHttp(), "kk", 0)
    with pytest.raises(CallBudgetExceeded):
        capped.address_to_coord("아무 주소")
