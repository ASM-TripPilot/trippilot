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
    added, _ = store.upsert("부산", (
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
    added, _ = store.upsert("부산", (
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
    # 쿼리 12건 + 지오코딩 — 쿼리 수를 늘릴 때마다 여기가 먼저 깨진다(예산 부족).
    # 상한이 아니라 접합부를 보는 테스트라 넉넉히 준다.
    client = NaverSearchClient(_RoutingHttp(), "i", "s", max_calls=30)
    stats = collect_region("부산", client=client, worker=_FakeWorker(),
                           store=store, today=_TODAY, now=_NOW)

    assert stats == {"region": "부산", "snippets": 1, "extracted": 1,
                     "generic_dropped": 0, "geocoded": 1, "added": 1,
                     "backfilled": 0,  # 신규 등록이라 백필 대상 아님
                     "fallback": False, "error": None}
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


def test_geocode_step_failure_falls_through(tmp_path) -> None:
    """지오코딩 HTTP 실패(403 등)는 배치를 죽이지 않는다 — 다음 단계 시도 후 좌표만 포기."""
    import sys
    from pathlib import Path as _P
    sys.path.insert(0, str(_P(__file__).resolve().parents[1] / "scripts"))
    from collect_events import _geocode
    from trippilot.background.kakao_local import KakaoLocalClient

    class _E:
        name = "행사"
        address = "주소"

    class _BoomHttp:
        def get_json(self, url, headers, params):
            raise OSError("HTTP Error 403: Forbidden")

    naver = NaverSearchClient(_BoomHttp(), "i", "s", 10)
    kakao = KakaoLocalClient(_BoomHttp(), "kk", 10)
    assert _geocode(_E(), "부산", naver, kakao) is None  # 예외 전파 없이 None


# ── TRIP-421 품질 3종 (실측 2026-08-21 기반) ─────────────────────────


def test_region_bounds_reject_cross_region_coord() -> None:
    """서울 행사에 부산 좌표(실측 오매칭) — 정합 위반은 좌표 폐기."""
    import sys
    from pathlib import Path as _P
    sys.path.insert(0, str(_P(__file__).resolve().parents[1] / "scripts"))
    from collect_events import coord_in_region

    busan = GeoPoint(35.327, 129.295)
    assert coord_in_region("서울", busan) is False
    assert coord_in_region("부산", busan) is True
    assert coord_in_region("서울", GeoPoint(37.57, 127.07)) is True
    assert coord_in_region("미지의지역", busan) is True  # 막을 근거 없음 — 통과


def test_generic_name_filter() -> None:
    import sys
    from pathlib import Path as _P
    sys.path.insert(0, str(_P(__file__).resolve().parents[1] / "scripts"))
    from collect_events import is_generic_name

    assert is_generic_name("콘서트-광주", "광주") is True
    assert is_generic_name("마을축제", "울산") is True
    assert is_generic_name("복합문화행사", "세종") is True
    assert is_generic_name("무주반딧불축제", "전북") is False
    assert is_generic_name("서울세계불꽃축제 2026", "서울") is False


def test_dedup_absorbs_name_variants(tmp_path) -> None:
    """연도·회차·괄호·후행 장르어·수식 접두어 변형이 전부 1건으로 수렴."""
    from trippilot.background.event_store import normalize_name

    assert normalize_name("2026 세종한글축제") == normalize_name("세종한글축제")
    assert normalize_name("제6회 감악산 꽃별여행") == normalize_name("감악산 꽃별여행")
    assert (normalize_name("「모래 위에 피는 K-MUSIC」 공연")
            == normalize_name("모래 위에 피는 K-MUSIC"))

    store = JsonEventStore(tmp_path / "e.json")
    d = _TODAY + timedelta(days=10)
    store.upsert("서울", (_event("서울세계불꽃축제 2026", d, d),), _NOW)
    added, _ = store.upsert("서울", (
        _event("한화와 함께하는 서울세계불꽃축제 2026", d, d),  # 포함 변형
    ), _NOW)
    assert added == 0 and store.counts()["events"] == 1


def test_sanitize_retroactively_cleans_store(tmp_path) -> None:
    import sys
    from pathlib import Path as _P
    sys.path.insert(0, str(_P(__file__).resolve().parents[1] / "scripts"))
    from collect_events import coord_in_region, is_generic_name

    store = JsonEventStore(tmp_path / "e.json")
    d = _TODAY + timedelta(days=5)
    store.upsert("서울", (
        _event("동대문구 맥주축제", d, d, coord=GeoPoint(35.327, 129.295)),  # 오매칭 좌표
        _event("서울세계불꽃축제", d, d),
    ), _NOW)
    store.upsert("광주", (_event("콘서트-광주", d, d),), _NOW)  # 저품질
    store.upsert("세종", (_event("세종한글축제", d, d),), _NOW)
    # 변형 중복은 upsert가 이미 막으므로, 소급 정리 검증용으로 직접 주입
    store._doc["events"].append(
        {**_event("2026 세종한글축제", d, d).to_dict(),
         "region": "세종", "collected_at": "2026-08-21T00:00:00+09:00"})

    cleaned = store.sanitize(
        drop_event=lambda region, e: is_generic_name(e.name, region),
        coord_ok=coord_in_region,
    )
    assert cleaned == {"dropped": 1, "coord_cleared": 1, "deduped": 1}
    found, _ = store.search_events(d, d)
    names = {e.name for e in found}
    assert "콘서트-광주" not in names and "2026 세종한글축제" not in names
    assert next(e for e in found if "맥주축제" in e.name).coord is None  # 좌표만 제거


def test_중복이어도_좌표가_없던_레코드는_새_좌표를_받는다(tmp_path) -> None:
    """**이 버그로 매일 지오코딩 성공분이 통째로 버려지고 있었다.**

    2026-08-25 실측: 그날 57건 중 19건을 지오코딩에 성공했는데 저장소 좌표는
    한 건도 늘지 않았다(신규 10건 전부 coord=None). dedup 이 중복분을 skip 하면서
    좌표만 딸려 사라진 것이다. 좌표 없는 행사는 근접 POI 부착에서 제외되므로
    (`event_affinity.py`) "수집은 됐는데 쓰이지 않는" 상태가 누적됐다.
    """
    store = JsonEventStore(tmp_path / "e.json")
    d = _TODAY + timedelta(days=3)
    added, backfilled = store.upsert("부산", (_event("좌표없는축제", d, d),), _NOW)
    assert (added, backfilled) == (1, 0)

    # 같은 행사를 좌표와 함께 다시 만난다 (다음날 재수집에서 지오코딩 성공한 경우)
    added, backfilled = store.upsert("부산", (
        _event("좌표없는축제", d, d, coord=GeoPoint(35.15, 129.11)),
    ), _NOW)

    assert (added, backfilled) == (0, 1), "신규는 아니지만 좌표는 채워져야 한다"
    found, _ = store.search_events(d, d)
    assert found[0].coord is not None and found[0].coord.lat == 35.15


def test_기존_좌표는_재수집이_덮어쓰지_않는다(tmp_path) -> None:
    """백필은 **빈 칸만** 채운다. 덮어쓰면 재수집이 값을 흔드는 원래 문제로 돌아간다."""
    store = JsonEventStore(tmp_path / "e.json")
    d = _TODAY + timedelta(days=3)
    store.upsert("부산", (_event("축제", d, d, coord=GeoPoint(35.15, 129.11)),), _NOW)

    added, backfilled = store.upsert("부산", (
        _event("축제", d, d, coord=GeoPoint(37.50, 127.00)),  # 엉뚱한 좌표로 재수집
    ), _NOW)

    assert (added, backfilled) == (0, 0)
    found, _ = store.search_events(d, d)
    assert found[0].coord.lat == 35.15, "먼저 얻은 좌표가 이긴다"


# ── 주소 정리·행정단위 판정 (좌표 품질, 2026-08-25) ────────────────────


@pytest.mark.parametrize(("address", "expected"), [
    # 실측 저장소에서 뽑은 실제 주소들이다
    ("레인보우힐링관광지 일원", "레인보우힐링관광지"),
    ("53281 경남 거제시 둔덕면 하둔리 644-2 둔덕가족생활체육공원 일원",
     "경남 거제시 둔덕면 하둔리 644-2 둔덕가족생활체육공원"),
    ("김대중컨벤션센터 전시장 A, B, C, 다목적홀 외", "김대중컨벤션센터 전시장 A"),
    ("경기아트센터", "경기아트센터"),
])
def test_주소_꼬리를_정리한다(address, expected) -> None:
    """지오코더가 못 읽는 군더더기(일원·나열·괄호·우편번호)를 걷어낸다."""
    import sys
    from pathlib import Path as _P
    sys.path.insert(0, str(_P(__file__).resolve().parents[1] / "scripts"))
    from collect_events import clean_address

    assert clean_address(address) == expected


@pytest.mark.parametrize(("address", "is_admin"), [
    ("경상북도 예천군", True),      # 군청 대표점이 나온다 — 행사 위치가 아니다
    ("울산광역시 남구", True),
    ("경기도 안산시", True),
    ("대구", True),                # 접미사 없는 광역명 단독
    ("경기아트센터", False),        # ← 접미사를 선택으로 두면 여기서 오탐이 났었다
    ("레인보우힐링관광지", False),
    ("여의도 한강공원", False),
    ("DDP", False),
    ("세종특별자치시 다솜로 216", False),  # 번지가 있으면 실제 위치
])
def test_행정단위만_있는_주소를_가려낸다(address, is_admin) -> None:
    """**좌표율을 올리려다 추천 품질을 떨어뜨리는 거래를 막는다.**

    시·군·구 대표점은 부착 반경 1km(`event_affinity.ATTACH_RADIUS_KM`) 안의
    POI 들에 근거 없는 보너스를 준다. 2026-08-25 실측에서 좌표 보유 27건 중
    8건이 이 부류였다 — 지표만 후하고 실제로는 틀린 좌표다.
    """
    import sys
    from pathlib import Path as _P
    sys.path.insert(0, str(_P(__file__).resolve().parents[1] / "scripts"))
    from collect_events import is_admin_only

    assert is_admin_only(address) is is_admin


# ── 캡 안에 무엇을 넣는가 (2026-08-27) ─────────────────────────────────


def test_날짜_있는_스니펫이_캡_안에_먼저_들어간다(tmp_path, monkeypatch) -> None:
    """**토큰을 안 늘리고 실효 입력을 올리는 유일한 레버다.**

    캡(80)이 도착 순서대로 자르면 뒤쪽 쿼리 결과가 통째로 버려지고, 그 80칸의
    절반은 날짜 없는 스니펫이 차지한다(실측 평균 39/80). 날짜가 없으면 프롬프트
    규칙("날짜 불명확 행사 제외, 추측 금지")과 게이트가 원천 배제하므로 그 칸은
    처음부터 값을 만들 수 없다. 버리지 않고 **순서만** 바꾼다.
    """
    import sys
    from pathlib import Path as _P
    sys.path.insert(0, str(_P(__file__).resolve().parents[1] / "scripts"))
    import collect_events as ce

    monkeypatch.setattr(ce, "SNIPPET_CAP", 3)
    seen: list = []

    class _Worker:
        def extract(self, region, start, end, pairs, trace_id, now, *, timeout_sec):
            seen.extend(pairs)

            class _R:
                value = ()
                is_fallback = False
                error = None
            return _R()

    class _Client:
        calls_used = 0

        def search(self, kind, query, display=10):
            # 날짜 없는 것이 **먼저** 도착한다 — 도착 순서대로면 캡이 이것들로 찬다
            return [
                {"title": "대전 가볼만한 곳 BEST", "description": "추천 모음"},
                {"title": "대전 맛집 리스트", "description": "정리"},
                {"title": "대전 0시 축제", "description": "9월 5일 개막"},
                {"title": "대전 과학축제", "description": "10월 3일부터"},
            ]

    ce.collect_region(
        "대전", client=_Client(), worker=_Worker(),
        store=JsonEventStore(tmp_path / "e.json"),
        today=_TODAY, now=_NOW,
    )

    assert len(seen) == 3, "캡만큼만 들어간다"
    dated = [p for p in seen if ce._DATE_HINT_RE.search(f"{p[0]} {p[1]}")]
    assert len(dated) == 2, f"날짜 있는 2건이 모두 들어가야 한다: {seen}"
    assert seen[0][0] == "대전 0시 축제" and seen[1][0] == "대전 과학축제", (
        f"날짜 있는 것이 앞에 와야 한다: {[p[0] for p in seen]}"
    )


def test_같은_입력이면_같은_순서_결정론(tmp_path) -> None:
    """정렬이 결정론을 깨면 안 된다 — 같은 입력에 같은 프롬프트가 나가야
    실패를 재현할 수 있다. 같은 그룹 안에서는 원래 순서가 유지된다(stable sort)."""
    import sys
    from pathlib import Path as _P
    sys.path.insert(0, str(_P(__file__).resolve().parents[1] / "scripts"))
    import collect_events as ce

    pairs = [("a 축제", "설명"), ("b 축제", "9월 1일"), ("c 축제", "설명"),
             ("d 축제", "10월 2일")]
    first = sorted(pairs, key=lambda p: not ce._DATE_HINT_RE.search(f"{p[0]} {p[1]}"))
    second = sorted(pairs, key=lambda p: not ce._DATE_HINT_RE.search(f"{p[0]} {p[1]}"))

    assert first == second
    assert [p[0] for p in first] == ["b 축제", "d 축제", "a 축제", "c 축제"]
