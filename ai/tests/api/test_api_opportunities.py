"""POST /ai/v1/planb/opportunities — 기회 카드 경계 (situation-awareness BR-SA-22 · DEC-SA-6, LLM 0회).

판정 규칙 자체는 `tests/orchestrator/test_opportunity.py` 가 본다. 여기는 경계가 하는 일만 본다.

증명하는 것:
  ① 구형 조립(핸들러 없음)은 503 명시 실패
  ② 배선된 앱이 행사장·요즘 인기 카드를 와이어로 사영한다 — 기간은 일 단위, 거리는 문자열(시각·소요시간 없음,
     INV-2·3). 슬롯의 장소와 일정에 있는 곳은 카드가 되지 않는다
  ③ LLM 을 부르지 않는다
  ④ 행사 미배선 → `events_unwired` · 행사 조회 실패·패킷 형식 위반 → `events_unavailable: …` — 요즘 인기는 낸다.
     저장소가 잘려 왔으면(LOW) 받은 만큼 쓰고 `events_low`
  ⑤ 장소 조회가 한 번이라도 실패하면 본 만큼도 내지 않는다 — 빈 목록 + `poi_lookup_unavailable: …`
  ⑥ 시한의 70%를 넘기면 거기서 멈추고 부분 결과 + `poi_lookup_partial: deadline` (시한 미지정 = 제약 없음)
  ⑦ 반경 조회는 슬롯 8개까지, 요청 순서대로 — 넘치면 `poi_lookup_partial: slot_cap`
  ⑧ 요청 검증 422: 슬롯 0개·31개, 일정 장소 301개, 모르는 키
  ⑨ [PBT] 요청·응답 스키마는 JSON 왕복에서 값이 보존된다 (situation-awareness NFR §8 — PBT-02 왕복 ③)
"""

from __future__ import annotations

import math
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.api import opportunities, schemas
from trippilot.api.app import create_app
from trippilot.api.wiring import build_dev_app
from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.event import EventInfo, EventType
from trippilot.domain.freshness import ProviderKind
from trippilot.domain.poi import TRENDING_TAG, DataQuality, Poi, PoiCategory, PoiSource
from trippilot.orchestrator.info_collector import InfoCollector
from trippilot.poi_curation.adapters.backend_poi_db import BackendPoiDbError
from trippilot.providers.event import EventProvider

from tests.fakes.fake_llm import FeatureRoutingLlm
from tests.fakes.in_memory_poi import InMemoryPoi

URL = "/ai/v1/planb/opportunities"
_KST = timezone(timedelta(hours=9))
_BASE = GeoPoint(37.5665, 126.9780)  # 서울시청 근방 (값 자체는 임의)
_M_PER_DEG_LAT = 111_195.08  # 하버사인 지구 반지름(6371.0088km) 기준 위도 1도 — 자오선 위 거리 = 북쪽 미터


def _at(north_m: float) -> GeoPoint:
    return GeoPoint(_BASE.lat + north_m / _M_PER_DEG_LAT, _BASE.lng)


def _poi(pid: str, name: str, north_m: float, *, category: PoiCategory = PoiCategory.SIGHT,
         tags: tuple[str, ...] = ()) -> Poi:
    return Poi(PoiId(pid), name, category, _at(north_m), (), None, None,
               DataQuality.FULL, PoiSource.SEED, None, tags=tags)


# 슬롯 둘(시청 0m · 북쪽 3km). 거리는 .5m 에 둬서 표시 문자열의 m 절삭이 부동소수 오차에 흔들리지 않게 했다.
_POIS = (
    _poi("p-slot1", "덕수궁", 0, tags=(TRENDING_TAG,)),                          # 슬롯 장소 자신
    _poi("p-slot2", "북촌한옥마을", 3000),
    _poi("p-garden", "남산공원 야외식물원", 400.5, category=PoiCategory.NATURE),  # 행사장
    _poi("p-bakery", "성수 베이커리", 2499.5, category=PoiCategory.CAFE, tags=(TRENDING_TAG,)),
    _poi("p-library", "서울도서관", 300, category=PoiCategory.CULTURE, tags=(TRENDING_TAG,)),  # 일정에 있음
)
_FEST = EventInfo("tourapi-2786391", "남산공원 야외식물원 국화 축제", EventType.FESTIVAL,
                  date(2026, 10, 18), date(2026, 10, 22), _at(420), "서울 중구 삼일대로 231")

_VENUE_CARD = {
    "key": "event:tourapi-2786391", "kind": "EVENT_VENUE",
    "event_name": "남산공원 야외식물원 국화 축제", "start": "2026-10-18", "end": "2026-10-22",
    "poi_id": "p-garden", "poi_name": "남산공원 야외식물원",
    "near_slot_key": "2026-10-20#p-slot1", "distance_label": "약 400m",
}
_TRENDING_CARD = {
    "key": "trending:p-bakery", "kind": "TRENDING", "event_name": None, "start": None, "end": None,
    "poi_id": "p-bakery", "poi_name": "성수 베이커리",
    "near_slot_key": "2026-10-20#p-slot2", "distance_label": "약 500m",
}


def _coord(north_m: float) -> dict:
    c = _at(north_m)
    return {"lat": c.lat, "lng": c.lng}


def _meta(deadline_ms: int | None = 3000) -> dict:
    meta = {"request_id": "opp-1", "requested_at": "2026-10-20T10:00:00+09:00"}
    if deadline_ms is not None:
        meta["deadline_ms"] = deadline_ms
    return meta


def _body(**over) -> dict:
    body = {
        "date": "2026-10-20",
        "slots": [
            {"slot_key": "2026-10-20#p-slot1", "poi_id": "p-slot1", "coord": _coord(0)},
            {"slot_key": "2026-10-20#p-slot2", "poi_id": "p-slot2", "coord": _coord(3000)},
        ],
        "planned_poi_ids": ["p-library"],
        "request_meta": _meta(),
    }
    body.update(over)
    return body


class _Store:
    """EventPort 대역 — 실물(JsonEventStore)처럼 목록과 절단 여부를 주거나, 읽다가 예외를 던진다."""

    def __init__(self, events=(), error: Exception | None = None, truncated: bool = False) -> None:
        self._events, self._error, self._truncated = tuple(events), error, truncated

    def search_events(self, start, end):
        if self._error is not None:
            raise self._error
        return tuple(e for e in self._events if e.start <= end and start <= e.end), self._truncated


class _CorruptEventProvider:
    """실 EventProvider 패킷에서 행사 한 건의 기간 칸을 지운다 — Provider 의 형식 위반 재현."""

    def __init__(self, inner: EventProvider) -> None:
        self._inner = inner

    def fetch(self, params: dict):
        packet = self._inner.fetch(params)
        events = [dict(e) for e in packet.data["events"]]
        del events[0]["start"]
        return replace(packet, data={"events": events})


class _DownPoiDb(InMemoryPoi):
    """실물(BackendPoiDb)이 백엔드 장애를 말하는 방식 그대로 — `BackendPoiDbError` 를 던진다.
    첫 슬롯 조회는 성공하고 둘째에서 끊긴다(일부만 본 상태)."""

    def __init__(self, seed) -> None:
        super().__init__(seed)
        self.calls = 0

    def find_by_radius(self, center, radius_km):
        self.calls += 1
        if self.calls > 1:
            raise BackendPoiDbError("GET /internal/pois 실패: <urlopen error [Errno 61] Connection refused>",
                                    retryable=True)
        return super().find_by_radius(center, radius_km)


class _TickingPoiDb(InMemoryPoi):
    """반경 조회 한 번마다 가짜 단조시계가 `step_s` 만큼 간다 — 조회한 중심을 순서대로 적는다."""

    def __init__(self, seed, step_s: float) -> None:
        super().__init__(seed)
        self.now, self._step, self.centers = 0.0, step_s, []

    def find_by_radius(self, center, radius_km):
        self.centers.append((center, radius_km))
        self.now += self._step
        return super().find_by_radius(center, radius_km)


def _post(app, body: dict):
    with TestClient(app) as client:
        return client.post(URL, json=body)


# ── ①② ───────────────────────────────────────────────────────────────


def test_구형_조립은_503_명시_실패() -> None:
    assert _post(create_app(), _body()).status_code == 503


def test_행사장과_요즘_인기_카드를_와이어로_사영하고_슬롯_장소와_일정에_있는_곳은_뺀다() -> None:
    app = build_dev_app(poi_db=InMemoryPoi(_POIS), events=_Store([_FEST]))

    response = _post(app, _body())

    assert response.status_code == 200, response.text
    assert response.json() == {"opportunities": [_VENUE_CARD, _TRENDING_CARD], "notes": []}


def test_LLM_을_부르지_않는다() -> None:
    llm = FeatureRoutingLlm({})
    app = build_dev_app(llm=llm, model_id="m-fake", poi_db=InMemoryPoi(_POIS), events=_Store([_FEST]))

    assert _post(app, _body()).status_code == 200
    assert llm.requests == []


# ── ④⑤ 재료 실패 ─────────────────────────────────────────────────────


def test_행사_저장소가_배선되지_않으면_요즘_인기만_내고_노트로_말한다() -> None:
    response = _post(build_dev_app(poi_db=InMemoryPoi(_POIS)), _body())

    assert response.json() == {"opportunities": [_TRENDING_CARD], "notes": ["events_unwired"]}


def test_행사_조회가_실패하면_요즘_인기만_내고_노트로_말한다() -> None:
    broken = _Store(error=ValueError("Invalid isoformat string: '2026-13-01'"))

    response = _post(build_dev_app(poi_db=InMemoryPoi(_POIS), events=broken), _body())

    assert response.json() == {
        "opportunities": [_TRENDING_CARD],
        "notes": ["events_unavailable: ValueError: Invalid isoformat string: '2026-13-01'"],
    }


def test_행사_저장소가_잘려_왔으면_받은_만큼_쓰고_노트로_말한다() -> None:
    app = build_dev_app(poi_db=InMemoryPoi(_POIS), events=_Store([_FEST], truncated=True))

    response = _post(app, _body())

    assert response.json() == {"opportunities": [_VENUE_CARD, _TRENDING_CARD], "notes": ["events_low"]}


def test_장소_조회가_도중에_실패하면_본_만큼도_내지_않고_빈_목록과_노트() -> None:
    """첫 슬롯 근처의 행사장 카드는 이미 보였지만 내지 않는다 — 일부만 본 동선으로 권하지 않는다."""
    poi_db = _DownPoiDb(_POIS)

    response = _post(build_dev_app(poi_db=poi_db, events=_Store([_FEST])), _body())

    assert poi_db.calls == 2
    assert response.status_code == 200
    assert response.json() == {"opportunities": [], "notes": ["poi_lookup_unavailable: BackendPoiDbError"]}


# ── ⑥⑦ 조회 예산 ─────────────────────────────────────────────────────


def _find(poi_db: _TickingPoiDb, body: dict, provider=None) -> schemas.OpportunitiesResponse:
    info = InfoCollector({ProviderKind.EVENT: provider or EventProvider(_Store([_FEST]))})
    request = schemas.OpportunitiesRequest.model_validate(body)
    return opportunities.find(info, poi_db, request, _KST, monotonic=lambda: poi_db.now)


def test_행사_패킷_형식이_깨졌으면_요즘_인기만_내고_노트로_말한다() -> None:
    corrupt = _CorruptEventProvider(EventProvider(_Store([_FEST])))

    response = _find(_TickingPoiDb(_POIS, step_s=0.0), _body(), provider=corrupt)

    assert [o.key for o in response.opportunities] == ["trending:p-bakery"]
    assert response.notes == ["events_unavailable: KeyError"]


def test_시한의_70퍼센트를_넘기면_거기서_멈추고_부분_결과와_노트() -> None:
    """시한 2s → 예산 1.4s. 첫 조회가 1.5s 걸렸으면 두 번째 슬롯은 묻지 않는다."""
    poi_db = _TickingPoiDb(_POIS, step_s=1.5)

    response = _find(poi_db, _body(request_meta=_meta(deadline_ms=2000)))

    assert len(poi_db.centers) == 1
    assert [o.key for o in response.opportunities] == ["event:tourapi-2786391"]  # 둘째 슬롯 근처는 못 봤다
    assert response.notes == ["poi_lookup_partial: deadline"]


def test_시한이_없으면_조회를_멈추지_않는다() -> None:
    poi_db = _TickingPoiDb(_POIS, step_s=1000.0)

    response = _find(poi_db, _body(request_meta=_meta(deadline_ms=None)))

    assert len(poi_db.centers) == 2
    assert [o.key for o in response.opportunities] == ["event:tourapi-2786391", "trending:p-bakery"]
    assert response.notes == []


def test_반경_조회는_요청_순서대로_슬롯_8개까지만_한다() -> None:
    slots = [{"slot_key": f"k{i}", "poi_id": f"p-x{i}", "coord": _coord(100 * i)} for i in range(10)]
    poi_db = _TickingPoiDb(_POIS, step_s=0.0)

    response = _find(poi_db, _body(slots=slots))

    assert [c for c, _ in poi_db.centers] == [_at(100 * i) for i in range(8)]
    assert all(math.isclose(r, 1.0) for _, r in poi_db.centers)  # 남은 슬롯 1km
    assert response.notes == ["poi_lookup_partial: slot_cap"]


# ── ⑧ 요청 검증 ──────────────────────────────────────────────────────


@pytest.mark.parametrize("over", [
    {"slots": []},
    {"slots": [{"slot_key": f"k{i}", "poi_id": "p", "coord": _coord(0)} for i in range(31)]},
    {"planned_poi_ids": [f"p{i}" for i in range(301)]},
    {"trigger": {"kind": "MANUAL"}},
], ids=["슬롯_0개", "슬롯_31개", "일정_장소_301개", "모르는_키"])
def test_계약_밖_요청은_422(over: dict) -> None:
    response = _post(build_dev_app(poi_db=InMemoryPoi(_POIS)), _body(**over))

    assert response.status_code == 422, response.text


# ── ⑨ 스키마 왕복 (PBT) ──────────────────────────────────────────────

_texts = st.text(min_size=1, max_size=12)
_dates = st.dates(date(2000, 1, 1), date(2100, 12, 31))
_metas = st.builds(
    schemas.RequestMetaSchema, request_id=_texts,
    requested_at=st.datetimes(datetime(2000, 1, 1), datetime(2100, 1, 1),
                              timezones=st.sampled_from((None, timezone.utc, _KST))),
    deadline_ms=st.none() | st.integers(1, 600_000))
_slots = st.builds(
    schemas.OpportunitySlotSchema, slot_key=st.text(min_size=1, max_size=80), poi_id=_texts,
    coord=st.builds(schemas.CoordSchema, lat=st.floats(-90, 90), lng=st.floats(-180, 180)))
_requests = st.builds(
    schemas.OpportunitiesRequest, date=_dates, slots=st.lists(_slots, min_size=1, max_size=30),
    planned_poi_ids=st.lists(_texts, max_size=8), request_meta=_metas)
_cards = st.builds(
    schemas.OpportunitySchema, key=_texts, kind=st.sampled_from(("EVENT_VENUE", "EVENT_NEARBY", "TRENDING")),
    event_name=st.none() | _texts, start=st.none() | _dates, end=st.none() | _dates, poi_id=_texts,
    poi_name=_texts, near_slot_key=_texts, distance_label=_texts)
_responses = st.builds(
    schemas.OpportunitiesResponse, opportunities=st.lists(_cards, max_size=3), notes=st.lists(_texts, max_size=4))


@settings(max_examples=300, deadline=None)
@given(st.one_of(_requests, _responses))
def test_PBT_요청과_응답은_JSON_왕복에서_값이_보존된다(model) -> None:
    """백엔드가 보내고 받는 와이어 그대로 — 날짜·시각대·None·kind 리터럴·최대 3장이 손실 없이 돌아온다."""
    assert type(model).model_validate_json(model.model_dump_json()) == model
