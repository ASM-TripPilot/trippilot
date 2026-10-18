"""assistant-orchestrator T009 — PoiInfoProvider · ProviderKind.POI_INFO · 요구표 행 (실 호출 0, fake만).

증명하는 것:
  [Provider]
  ① 전부 찾음 → OK, 행 모양 {poi_id,name,category,lat,lng,hours_label,fee,source_ref} 정확,
     FreshnessMeta(M7·주입 now·TTL 24h) 동봉
  ② 일부 누락 → LOW + data["misses"] 에 id (조용한 차집합 금지, TRIP-537) — 성공이라 신선도 필수
  ③ poi_db 예외 → UNAVAILABLE + 사유 보존 + freshness 없음 (IO-7, DL-5)
  ④ hours_label 요일 규칙 — `on` 의 요일(없으면 `now`), 휴무 증명 None, 정보 없음·밤 영업 문구
  ⑤ fee — 기본 빈 표면 전부 None, 0(무료)과 None(불명)을 가른다
  [PBT]
  ⑥ hours_label 규칙은 agents/planb/composition.hours_label 과 같다 (FD DE §2.9 — 함수의 집은 미결 #16)
  ⑦ 요청 id = 행 ∪ 누락(겹침 없음), OK ⇔ 누락 0, 패킷은 JSON-safe
  [InfoCollector]
  ⑧ GET_POI_INFO 행 = (POI_INFO,), 조립기가 와이어 형(str id·ISO 날짜)을 받고 now 없으면 채운다
"""

from __future__ import annotations

import json
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from tests.fakes.in_memory_poi import InMemoryPoi
from tests.generators.poi import pois
from trippilot.agents.planb import composition
from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.freshness import FreshnessMeta, ProviderKind, ProviderStatus
from trippilot.domain.intent import Intent
from trippilot.domain.poi import (
    NIGHTLIFE_TAG,
    DataQuality,
    OpenHour,
    Poi,
    PoiCategory,
    PoiSource,
)
from trippilot.orchestrator.info_collector import INFO_REQUIREMENTS, InfoCollector
from trippilot.poi_curation.place_fees import FeeTable
from trippilot.providers import poi_info
from trippilot.providers.poi_info import PoiInfoProvider

_KST = timezone(timedelta(hours=9))
_NOW = datetime(2026, 10, 19, 9, 0, tzinfo=_KST)  # 월요일 (weekday 0)
_ON = date(2026, 10, 21)  # 수요일 (weekday 2) — now 와 다른 요일이어야 ④ 가 구분된다
_COORD = GeoPoint(33.458, 126.942)
_ROW_KEYS = frozenset(
    {"poi_id", "name", "category", "lat", "lng", "hours_label", "fee", "source_ref"})

assert _NOW.weekday() == 0 and _ON.weekday() == 2


def _poi(pid: str, *, hours=(), tags=(), source_ref=None,
         name="성산일출봉", category=PoiCategory.SIGHT) -> Poi:
    return Poi(
        poi_id=PoiId(pid), name=name, category=category, coord=_COORD,
        open_hours=tuple(hours), avg_cost=None, rating=None, quality=DataQuality.FULL,
        source=PoiSource.SEED, confidence=None, tags=tuple(tags), source_ref=source_ref,
    )


def _params(*ids: str, on: date | None = _ON) -> dict:
    return {"poi_ids": frozenset(PoiId(i) for i in ids), "on": on, "now": _NOW}


_WED_HOURS = (
    OpenHour(2, 9 * 60, 18 * 60),
    OpenHour(2, 19 * 60, 22 * 60),
    OpenHour(0, 10 * 60, 20 * 60),  # 월요일 — on(수) 과 now(월) 을 가르는 미끼
)


# ── ① 전부 찾음 ──────────────────────────────────────────────────────


def test_all_found_is_ok_with_exact_rows_and_freshness() -> None:
    db = InMemoryPoi((_poi("p1", hours=_WED_HOURS, source_ref="tour-1"),))
    fees = FeeTable(won={"tour-1": 5000})

    packet = PoiInfoProvider(db, fees).fetch(_params("p1"))

    assert packet.provider is ProviderKind.POI_INFO
    assert packet.status is ProviderStatus.OK
    assert packet.data == {
        "pois": [{
            "poi_id": "p1", "name": "성산일출봉", "category": "SIGHT",
            "lat": 33.458, "lng": 126.942,
            "hours_label": "09:00~18:00, 19:00~22:00",  # on=수요일 창만, 월요일 창은 아님
            "fee": 5000, "source_ref": "tour-1",
        }],
        "misses": [],
    }
    assert packet.freshness == FreshnessMeta(
        source="M7", fetched_at=_NOW, cache_hit=False, ttl_sec=86400, stale=False)


# ── ② 일부 누락 → LOW ────────────────────────────────────────────────


def test_missing_ids_are_reported_as_low_not_silently_dropped() -> None:
    db = InMemoryPoi((_poi("p1"),))

    packet = PoiInfoProvider(db).fetch(_params("p1", "ghost"))

    assert packet.status is ProviderStatus.LOW
    assert [r["poi_id"] for r in packet.data["pois"]] == ["p1"]
    assert packet.data["misses"] == ["ghost"]
    assert packet.freshness is not None  # LOW 는 성공 — 신선도 필수 (BR-AF-06)


def test_nothing_found_is_still_low_with_every_id_in_misses() -> None:
    packet = PoiInfoProvider(InMemoryPoi()).fetch(_params("a", "b"))

    assert packet.status is ProviderStatus.LOW
    assert packet.data["pois"] == []
    assert sorted(packet.data["misses"]) == ["a", "b"]


# ── ③ poi_db 예외 → UNAVAILABLE ──────────────────────────────────────


class _BrokenDb:
    def lookup_by_ids(self, ids):
        raise TimeoutError("backend down")


def test_db_failure_is_unavailable_with_reason_not_exception() -> None:
    packet = PoiInfoProvider(_BrokenDb()).fetch(_params("p1"))  # type: ignore[arg-type]

    assert packet.status is ProviderStatus.UNAVAILABLE
    assert "TimeoutError" in packet.data["reason"] and "backend down" in packet.data["reason"]
    assert packet.freshness is None


# ── ④ hours_label 요일 규칙 ──────────────────────────────────────────


def _label_of(poi: Poi, *, on: date | None) -> str | None:
    packet = PoiInfoProvider(InMemoryPoi((poi,))).fetch(_params(str(poi.poi_id), on=on))
    return packet.data["pois"][0]["hours_label"]


def test_hours_label_uses_on_weekday_and_falls_back_to_now_weekday() -> None:
    poi = _poi("p1", hours=_WED_HOURS)
    assert _label_of(poi, on=_ON) == "09:00~18:00, 19:00~22:00"  # 수요일 창
    assert _label_of(poi, on=None) == "10:00~20:00"  # on 없음 → now(월요일) 창


def test_hours_label_proven_closed_is_none_but_unknown_is_a_phrase() -> None:
    assert _label_of(_poi("p1", hours=_WED_HOURS), on=date(2026, 10, 22)) is None  # 목요일 창 없음 = 휴무 증명
    assert _label_of(_poi("p1"), on=_ON) == "영업시간 정보 없음"  # 정보 없음은 막지 않는다 (HC1)
    assert _label_of(_poi("p1", tags=(NIGHTLIFE_TAG,)), on=_ON) == "밤 영업(추정 20:00~04:00)"


# ── ⑤ fee ────────────────────────────────────────────────────────────


def test_fee_defaults_to_unknown_and_keeps_free_distinct_from_unknown() -> None:
    db = InMemoryPoi((
        _poi("free", source_ref="t-free"),
        _poi("paid", source_ref="t-paid"),
        _poi("unknown", source_ref="t-none"),
        _poi("noref"),
    ))

    by_id = {r["poi_id"]: r["fee"]
             for r in PoiInfoProvider(db).fetch(_params("free", "paid", "unknown", "noref")).data["pois"]}
    assert by_id == {"free": None, "paid": None, "unknown": None, "noref": None}  # 기본 빈 표

    fees = FeeTable(won={"t-free": 0, "t-paid": 12000})
    by_id = {r["poi_id"]: r["fee"]
             for r in PoiInfoProvider(db, fees).fetch(_params("free", "paid", "unknown", "noref")).data["pois"]}
    assert by_id == {"free": 0, "paid": 12000, "unknown": None, "noref": None}


# ── ⑥ PBT — 규칙은 PlanB 조합기와 같다 ──────────────────────────────


@settings(max_examples=200)
@given(poi=pois(), tags=st.sampled_from([(), (NIGHTLIFE_TAG,)]),
       weekday=st.integers(min_value=0, max_value=6))
def test_hours_label_rule_equals_planb_composition(poi: Poi, tags, weekday: int) -> None:
    """providers 가 agents 를 import 하지 않아 사본을 둔다 — 두 집이 갈라지면 여기서 드러난다 (미결 #16)."""
    poi = replace(poi, tags=tags)
    assert poi_info.hours_label(poi, weekday) == composition.hours_label(poi, weekday)


# ── ⑦ PBT — 요청 id 는 행 아니면 누락 ───────────────────────────────


@settings(max_examples=100)
@given(seed=st.lists(pois(), unique_by=lambda p: p.poi_id, max_size=5),
       extra=st.lists(st.text(min_size=1, max_size=8), max_size=3),
       on=st.one_of(st.none(), st.dates()))
def test_requested_ids_are_exactly_rows_plus_misses(seed, extra, on) -> None:
    requested = frozenset(p.poi_id for p in seed) | frozenset(PoiId(x) for x in extra)

    packet = PoiInfoProvider(InMemoryPoi(tuple(seed))).fetch(
        {"poi_ids": requested, "on": on, "now": _NOW})

    rows = {r["poi_id"] for r in packet.data["pois"]}
    misses = set(packet.data["misses"])
    assert rows | misses == {str(i) for i in requested}
    assert not (rows & misses)
    assert packet.status is (ProviderStatus.OK if not misses else ProviderStatus.LOW)
    assert all(frozenset(r) == _ROW_KEYS for r in packet.data["pois"])
    json.dumps(packet.to_dict())  # InfoPacket.data 는 JSON-safe 계약


# ── ⑧ InfoCollector 요구표 행 + 조립기 ──────────────────────────────


def test_requirements_row_routes_get_poi_info_to_poi_info_provider() -> None:
    assert INFO_REQUIREMENTS[Intent.GET_POI_INFO] == (ProviderKind.POI_INFO,)
    collector = InfoCollector({
        ProviderKind.POI_INFO: PoiInfoProvider(InMemoryPoi((_poi("p1", hours=_WED_HOURS),)))})

    # 와이어 형 — id 는 str 목록, 날짜·시각은 ISO 문자열
    packets = collector.collect(
        Intent.GET_POI_INFO,
        {"poi_ids": ["p1", "ghost"], "on": _ON.isoformat(), "now": _NOW.isoformat()})

    assert set(packets) == {ProviderKind.POI_INFO}
    packet = packets[ProviderKind.POI_INFO]
    assert packet.status is ProviderStatus.LOW
    assert packet.data["pois"][0]["hours_label"] == "09:00~18:00, 19:00~22:00"  # on 의 요일
    assert packet.data["misses"] == ["ghost"]
    assert packet.freshness is not None and packet.freshness.fetched_at == _NOW


def test_collector_fills_now_when_missing_like_transit() -> None:
    collector = InfoCollector({ProviderKind.POI_INFO: PoiInfoProvider(InMemoryPoi((_poi("p1"),)))})

    packet = collector.collect(Intent.GET_POI_INFO, {"poi_ids": ["p1"]})[ProviderKind.POI_INFO]

    assert packet.status is ProviderStatus.OK
    assert packet.freshness is not None and packet.freshness.fetched_at.tzinfo is not None


def test_other_intents_do_not_collect_poi_info() -> None:
    collector = InfoCollector({ProviderKind.POI_INFO: PoiInfoProvider(InMemoryPoi())})
    assert collector.collect(Intent.GET_WEATHER, {"poi_ids": ["p1"]}) == {}


@pytest.mark.parametrize("intent", [i for i in INFO_REQUIREMENTS if i is not Intent.GET_POI_INFO])
def test_poi_info_is_only_in_the_get_poi_info_row(intent: Intent) -> None:
    """그 외 의도의 행은 바꾸지 않는다 (FD DE §2.9)."""
    assert ProviderKind.POI_INFO not in INFO_REQUIREMENTS[intent]
