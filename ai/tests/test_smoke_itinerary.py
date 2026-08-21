"""smoke_itinerary 순수 로직 검증 — 실 호출 0건 (fake만, D37) (TRIP-372).

스크립트 본체(scripts/smoke_itinerary.py)는 pytest 대상이 아니지만, 선택·샘플
순수 로직과 기록 스키마는 여기서 fake 데이터로 검증한다:
  ① 날짜 시드 결정론 — 같은 (날짜, 데이터)는 항상 같은 선택, 날짜가 바뀌면 변주
  ② 반경 샘플 규칙 — 앵커 포함 6~8개, 전부 앵커 8km 이내
  ③ 부족 시 재시도 — 흩어진 시군구는 건너뛰고 밀집 시군구로, 전부 실패면 명시 에러
  ④ 기록 JSON 스키마 — 계약 키 전량 + 슬롯 이름 매핑
  ⑤ 생성 관통 1건 — LLM 미주입(UnwiredLlm 경로: 규칙 점수 폴백)으로 200 + INV-1
  ⑥ 인접 슬롯 실경로 검증 (TRIP-382) — 쌍 구성·오차 계산·키 부재 생략·legs 스키마
"""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

import pytest

from trippilot.api.wiring import UnwiredLlm
from trippilot.solver_engine.travel import haversine_km
from trippilot.domain.common import GeoPoint, TransportMode
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource

# scripts/ 는 패키지가 아니다 — 스크립트와 같은 방식(동일 디렉토리 경로)으로 import
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from smoke_itinerary import (  # noqa: E402
    RehearsalError,
    _request_body,
    Selection,
    SelectionError,
    attach_leg_verification,
    build_leg_pairs,
    load_proposals,
    measure_legs,
    run_rehearsal,
    select_rehearsal_pois,
)

# 위도 0.01° ≈ 1.11km — 밀집 클러스터(±0.03° ≈ 3km)와 산개 배치(0.2° ≈ 22km) 구분에 사용
_BASE = GeoPoint(35.1796, 129.0756)  # 부산 근방 (값 자체는 임의)


def _poi(pid: str, lat: float, lng: float, name: str | None = None) -> Poi:
    return Poi(
        poi_id=pid,
        name=name or f"장소-{pid}",
        category=PoiCategory.SIGHT,
        coord=GeoPoint(lat, lng),
        open_hours=(),
        avg_cost=None,
        rating=4.0,
        quality=DataQuality.FULL,
        source=PoiSource.PLACES_API,
        confidence=None,
    )


def _cluster(region: str, prefix: str, n: int, lat0: float, lng0: float) -> list[dict]:
    """반경 ~3km 안 밀집 POI n개 제안 — 어느 앵커에서도 서로 8km 이내."""
    return [
        {"poi": _poi(f"{prefix}{i}", lat0 + 0.003 * i, lng0 + 0.003 * i).to_dict(),
         "region": region}
        for i in range(n)
    ]


def _scattered(region: str, prefix: str, n: int, lat0: float, lng0: float) -> list[dict]:
    """0.2°(≈22km) 간격 산개 POI n개 — 어떤 앵커든 반경 8km 안은 자기 자신뿐."""
    return [
        {"poi": _poi(f"{prefix}{i}", lat0 + 0.2 * i, lng0).to_dict(), "region": region}
        for i in range(n)
    ]


def _doc(proposals: list[dict]) -> dict:
    return {"proposals": proposals}


def _entries(proposals: list[dict]):
    return load_proposals(_doc(proposals))


_TWO_REGIONS = (
    _cluster("부산 해운대구", "h", 10, _BASE.lat, _BASE.lng)
    + _cluster("부산 수영구", "s", 10, _BASE.lat + 1.0, _BASE.lng)
)


# ── ① 날짜 시드 결정론 ───────────────────────────────────────────────


def test_same_date_same_data_is_reproducible():
    entries = _entries(_TWO_REGIONS)
    first = select_rehearsal_pois(entries, "2026-08-14")
    second = select_rehearsal_pois(entries, "2026-08-14")
    assert first.region == second.region
    assert first.anchor.poi_id == second.anchor.poi_id
    assert [str(p.poi_id) for p in first.pois] == [str(p.poi_id) for p in second.pois]


def test_proposal_order_does_not_change_selection():
    entries = _entries(_TWO_REGIONS)
    reordered = _entries(list(reversed(_TWO_REGIONS)))
    assert select_rehearsal_pois(entries, "2026-08-14") == select_rehearsal_pois(
        reordered, "2026-08-14"
    )


def test_different_dates_vary_selection():
    """날마다 다른 선택 — 고정 시드라 결과 집합도 고정이다 (플레이크 아님)."""
    entries = _entries(_TWO_REGIONS)
    dates = [f"2026-08-{d:02d}" for d in range(10, 20)]
    picks = {
        (s.region, str(s.anchor.poi_id), tuple(str(p.poi_id) for p in s.pois))
        for s in (select_rehearsal_pois(entries, day) for day in dates)
    }
    assert len(picks) > 1


# ── ② 반경 샘플 규칙 ─────────────────────────────────────────────────


def test_sample_size_and_radius_bounds():
    entries = _entries(_TWO_REGIONS)
    for day in ("2026-08-14", "2026-08-15", "2026-08-16"):
        s = select_rehearsal_pois(entries, day)
        assert 6 <= len(s.pois) <= 8
        assert s.anchor.poi_id in {p.poi_id for p in s.pois}
        assert all(haversine_km(s.anchor.coord, p.coord) <= 8.0 for p in s.pois)
        assert len({str(p.poi_id) for p in s.pois}) == len(s.pois)  # 중복 없음


def test_radius_pool_may_cross_region_boundary():
    """반경 풀은 시군구 경계를 넘는다 — 인접 시군구 POI도 유효한 후보."""
    # 같은 좌표 클러스터를 두 시군구로 반씩 — 어느 쪽이 뽑혀도 상대편이 반경 안
    proposals = (
        _cluster("부산 중구", "a", 4, _BASE.lat, _BASE.lng)
        + _cluster("부산 동구", "b", 4, _BASE.lat + 0.01, _BASE.lng)
    )
    s = select_rehearsal_pois(_entries(proposals), "2026-08-14")
    prefixes = {str(p.poi_id)[0] for p in s.pois}
    assert prefixes == {"a", "b"}  # 6개 이상이려면 두 시군구 모두에서 뽑아야 한다


# ── ③ 부족 시 재시도·최종 실패 ───────────────────────────────────────


def test_retries_into_dense_region_when_scattered():
    proposals = (
        _scattered("강원 산개군", "x", 8, _BASE.lat + 3.0, _BASE.lng)
        + _cluster("부산 해운대구", "h", 10, _BASE.lat, _BASE.lng)
    )
    entries = _entries(proposals)
    for day in (f"2026-08-{d:02d}" for d in range(10, 20)):
        s = select_rehearsal_pois(entries, day)
        assert s.region == "부산 해운대구"  # 산개 시군구는 어떤 날에도 선택될 수 없다


def test_all_regions_scattered_raises_explicit_error():
    proposals = [
        p
        for i in range(6)  # 재시도 상한(5회)보다 많은 산개 시군구
        for p in _scattered(f"산개군-{i}", f"r{i}", 6, _BASE.lat + 3.0 * i, _BASE.lng)
    ]
    with pytest.raises(SelectionError):
        select_rehearsal_pois(_entries(proposals), "2026-08-14")


def test_no_region_proposals_raises():
    proposals = [{"poi": _poi("n0", _BASE.lat, _BASE.lng).to_dict(), "region": None}]
    with pytest.raises(SelectionError):
        select_rehearsal_pois(_entries(proposals), "2026-08-14")


# ── ④·⑤ 생성 관통 1건 (UnwiredLlm — 규칙 점수 폴백) + 기록 스키마 ────


def test_rehearsal_passthrough_and_result_schema():
    entries = _entries(_TWO_REGIONS)
    smoke_date = dt.date(2026, 8, 14)
    selection = select_rehearsal_pois(entries, smoke_date.isoformat())
    result = run_rehearsal(
        selection, llm=UnwiredLlm(), model_id="dev-unwired", smoke_date=smoke_date
    )
    assert set(result) == {
        "date", "region", "anchor", "poi_names", "slots",
        "solve_mode", "is_fallback", "llm_used", "weather", "latency_ms",
    }
    assert result["weather"] is None  # 날씨 미주입 — 기록도 없음 (TRIP-409)
    assert result["date"] == "2026-08-14"
    assert result["region"] == selection.region
    assert set(result["anchor"]) == {"poi_id", "name", "lat", "lng"}
    assert result["anchor"]["poi_id"] == str(selection.anchor.poi_id)
    assert result["poi_names"] == [p.name for p in selection.pois]
    assert result["llm_used"] is False  # UnwiredLlm — 성공 호출 0건 (정직한 강등)
    assert isinstance(result["latency_ms"], int)
    ids = {str(p.poi_id): p.name for p in selection.pois}
    assert len(result["slots"]) >= 1
    for slot in result["slots"]:
        assert set(slot) == {"date", "start", "end", "name", "poi_id"}
        assert slot["poi_id"] in ids  # 슬롯 poi ⊆ 선택 집합 (INV-1 사영)
        assert slot["name"] == ids[slot["poi_id"]]
    assert "legs" not in result  # 실경로 검증은 별도 선택 단계 (TRIP-382)


def test_request_body_builds_three_day_trip_without_deadline():
    """TRIP-476 — 기본 3일: 날짜별 앵커·창 3건, deadline_ms 미포함(무제한, TRIP-473)."""
    selection = select_rehearsal_pois(_entries(_TWO_REGIONS), "2026-08-14")
    body = _request_body(selection, dt.date(2026, 8, 14), None)
    dates = [f"2026-08-{d}" for d in (15, 16, 17)]
    assert body["trip_context"]["start_date"] == dates[0]
    assert body["trip_context"]["end_date"] == dates[-1]
    assert [a["date"] for a in body["anchors"]] == dates
    assert [w["date"] for w in body["time_windows"]] == dates
    assert "deadline_ms" not in body["request_meta"]


def test_request_body_single_day_backward_compatible():
    """SMOKE_DAYS=1 경로 — 종전 1일 형태 그대로 (deadline 지정도 관통)."""
    selection = select_rehearsal_pois(_entries(_TWO_REGIONS), "2026-08-14")
    body = _request_body(selection, dt.date(2026, 8, 14), 20_000, days=1)
    assert body["trip_context"]["start_date"] == body["trip_context"]["end_date"] == "2026-08-15"
    assert len(body["anchors"]) == len(body["time_windows"]) == 1
    assert body["request_meta"]["deadline_ms"] == 20_000


def test_rehearsal_rejects_empty_days():
    """선택 POI가 전부 배치 불가여도 침묵하지 않는다 — 슬롯 0건은 명시 실패."""
    entries = _entries(_TWO_REGIONS)
    selection = select_rehearsal_pois(entries, "2026-08-14")
    # deadline이 아니라 선택 집합 바깥 검증을 직접 깨긴 어렵다 — 슬롯 0건 경로는
    # 앵커에서 8km 안이지만 전 POI가 심야에만 여는 극단 데이터로 유도한다.
    from trippilot.domain.poi import OpenHour

    closed = tuple(
        Poi(
            poi_id=p.poi_id, name=p.name, category=p.category, coord=p.coord,
            open_hours=tuple(OpenHour(day_of_week=d, open_min=0, close_min=1)
                             for d in range(7)),  # 00:00~00:01 — 창(09~20시)과 무교집합
            avg_cost=p.avg_cost, rating=p.rating, quality=p.quality,
            source=p.source, confidence=p.confidence,
        )
        for p in selection.pois
    )
    bad = type(selection)(region=selection.region, anchor=closed[0], pois=closed)
    with pytest.raises(RehearsalError):
        run_rehearsal(
            bad, llm=UnwiredLlm(), model_id="dev-unwired",
            smoke_date=dt.date(2026, 8, 14),
        )


# ── ⑥ 인접 슬롯 실경로 검증 (TRIP-382) — fake만, 실 호출 0 ────────────

from trippilot.solver_engine.config import SolverConfig  # noqa: E402
from trippilot.solver_engine.travel import TravelEstimator  # noqa: E402
from trippilot.ports.travel_time_port import (  # noqa: E402
    MeasuredTravel,
    TravelTimeError,
)

_ESTIMATOR = TravelEstimator(SolverConfig())


class FakeTravel:
    """고정 실측(분) 반환 — fail_after 번째 호출부터는 TravelTimeError."""

    def __init__(self, real_minutes: float, fail_after: int | None = None) -> None:
        self._real = real_minutes
        self._fail_after = fail_after
        self.calls = 0

    def measure(self, from_, to, mode) -> MeasuredTravel:
        self.calls += 1
        if self._fail_after is not None and self.calls > self._fail_after:
            raise TravelTimeError("한도 초과 (fake)")
        return MeasuredTravel(
            real_minutes=self._real, distance_km=1.0,
            source="fake", approximated=True,
        )


def _leg_selection(n: int = 4) -> Selection:
    """일렬 POI n개 — p0 앵커. 0.01° ≈ 1.1km 간격 (전부 반경 안)."""
    pois = [_poi(f"p{i}", _BASE.lat + 0.01 * i, _BASE.lng) for i in range(n)]
    return Selection(region="부산 해운대구", anchor=pois[0], pois=tuple(pois))


def _slot(poi_id: str) -> dict:
    return {"start": "09:00", "end": "10:00", "name": f"장소-{poi_id}",
            "poi_id": poi_id}


def test_leg_pairs_include_anchor_and_adjacent_slots():
    selection = _leg_selection(4)
    # 첫 슬롯이 앵커 자신 — 앵커→첫 슬롯은 0거리라 제외되고 인접 쌍만 남는다
    pairs = build_leg_pairs(selection, [_slot("p0"), _slot("p1"), _slot("p2")])
    assert [(str(a.poi_id), str(b.poi_id)) for a, b in pairs] == [
        ("p0", "p1"), ("p1", "p2")
    ]
    # 첫 슬롯이 앵커가 아니면 앵커→첫 슬롯 leg가 맨 앞에 붙는다
    pairs = build_leg_pairs(selection, [_slot("p1"), _slot("p2"), _slot("p3")])
    assert [(str(a.poi_id), str(b.poi_id)) for a, b in pairs] == [
        ("p0", "p1"), ("p1", "p2"), ("p2", "p3")
    ]


def test_leg_pairs_skip_day_boundary():
    """다일 일정 — 마지막 슬롯→다음날 첫 슬롯 쌍은 실측 대상이 아니다 (TRIP-476)."""
    selection = _leg_selection(5)
    slots = [dict(_slot("p1"), date="2026-08-15"), dict(_slot("p2"), date="2026-08-15"),
             dict(_slot("p3"), date="2026-08-16"), dict(_slot("p4"), date="2026-08-16")]
    pairs = build_leg_pairs(selection, slots)
    assert [(str(a.poi_id), str(b.poi_id)) for a, b in pairs] == [
        ("p0", "p1"), ("p1", "p2"),  # 앵커(첫날 취급)→p1 + 첫날 인접쌍
        ("p3", "p4"),                # 둘째날 인접쌍 — p2→p3(일경계)는 제외
    ]


def test_leg_pairs_capped_at_max():
    selection = _leg_selection(8)
    slots = [_slot(f"p{i}") for i in range(1, 8)]  # 앵커 leg 포함 7건 후보
    assert len(build_leg_pairs(selection, slots)) == 6  # MAX_LEGS 절단


def test_measure_legs_err_pct_formula():
    selection = _leg_selection(2)
    pairs = build_leg_pairs(selection, [_slot("p1")])
    est = _ESTIMATOR.estimate(
        selection.pois[0].coord, selection.pois[1].coord, TransportMode.PUBLIC
    ).internal_minutes
    legs, failure = measure_legs(
        pairs, travel=FakeTravel(real_minutes=20.0), estimator=_ESTIMATOR
    )
    assert failure is None
    assert legs == [{
        "from": "장소-p0", "to": "장소-p1", "mode": "PUBLIC", "est_min": est,
        "real_min": 20.0, "err_pct": round((est - 20.0) / 20.0 * 100, 1),
    }]


def test_measure_legs_zero_real_has_no_err_pct():
    selection = _leg_selection(2)
    pairs = build_leg_pairs(selection, [_slot("p1")])
    legs, failure = measure_legs(
        pairs, travel=FakeTravel(real_minutes=0.0), estimator=_ESTIMATOR
    )
    assert failure is None
    assert legs[0]["err_pct"] is None  # 비율 정의 불가 — 지어내지 않는다


def test_measure_legs_stops_at_first_failure_with_partial_legs():
    selection = _leg_selection(4)
    pairs = build_leg_pairs(selection, [_slot("p1"), _slot("p2"), _slot("p3")])
    travel = FakeTravel(real_minutes=10.0, fail_after=1)
    legs, failure = measure_legs(pairs, travel=travel, estimator=_ESTIMATOR)
    assert len(legs) == 1  # 실패 전까지의 부분 실측만
    assert failure is not None and "한도 초과" in failure
    assert travel.calls == 2  # 실패 지점에서 중단 — 남은 쌍에 호출 반복 없음


class ModeGatedTravel:
    """허용 모드만 성공, 나머지는 403 — 폴백 체인 검증용 (allowed=None이면 전부 403)."""

    def __init__(self, allowed: TransportMode | None) -> None:
        self._allowed = allowed
        self.calls: list[TransportMode] = []

    def measure(self, from_, to, mode) -> MeasuredTravel:
        self.calls.append(mode)
        if mode is not self._allowed:
            raise TravelTimeError("HTTP 403 Forbidden (fake)")
        return MeasuredTravel(
            real_minutes=12.0, distance_km=1.0, source="fake", approximated=True,
        )


def test_measure_legs_falls_back_past_403_without_extra_probe():
    """PUBLIC·CAR 403 → 같은 쌍을 WALK로 재시도해 확정 — 프로브 이중 호출 없음."""
    selection = _leg_selection(3)
    pairs = build_leg_pairs(selection, [_slot("p1"), _slot("p2")])
    travel = ModeGatedTravel(allowed=TransportMode.WALK)
    legs, failure = measure_legs(pairs, travel=travel, estimator=_ESTIMATOR)
    assert failure is None
    assert [leg["mode"] for leg in legs] == ["WALK", "WALK"]
    # 첫 쌍에서 체인 소진(2회 403 + 1회 성공), 이후 쌍은 확정 수단으로 1회씩
    assert travel.calls == [TransportMode.PUBLIC, TransportMode.CAR,
                            TransportMode.WALK, TransportMode.WALK]


def test_measure_legs_all_modes_403_reports_failure():
    """WALK까지 403 — 남은 수단이 없으면 실패를 그대로 보고한다 (침묵 금지)."""
    selection = _leg_selection(2)
    pairs = build_leg_pairs(selection, [_slot("p1")])
    legs, failure = measure_legs(
        pairs, travel=ModeGatedTravel(allowed=None), estimator=_ESTIMATOR
    )
    assert legs == []
    assert failure is not None and "403" in failure


def test_measure_legs_explicit_mode_does_not_fall_back():
    """호출자가 수단을 고정하면 403이라도 다른 수단으로 바꾸지 않는다."""
    legs, failure = measure_legs(
        build_leg_pairs(_leg_selection(2), [_slot("p1")]),
        travel=ModeGatedTravel(allowed=TransportMode.WALK),
        estimator=_ESTIMATOR,
        mode=TransportMode.PUBLIC,
    )
    assert legs == [] and failure is not None and "403" in failure


def test_attach_skips_without_travel_port():
    """키 부재(travel=None) — legs 없이 그대로, 예외 없음 (리허설 성패와 분리)."""
    selection = _leg_selection(2)
    result = {"slots": [_slot("p1")]}
    attach_leg_verification(result, selection, None, _ESTIMATOR)
    assert "legs" not in result


def test_attach_skips_when_all_calls_fail():
    selection = _leg_selection(2)
    result = {"slots": [_slot("p1")]}
    attach_leg_verification(
        result, selection, FakeTravel(10.0, fail_after=0), _ESTIMATOR
    )
    assert "legs" not in result  # 실측 0건 — 빈 legs 를 기록하지 않는다


def test_attach_records_legs_schema():
    selection = _leg_selection(3)
    result = {"slots": [_slot("p1"), _slot("p2")]}
    attach_leg_verification(result, selection, FakeTravel(15.0), _ESTIMATOR)
    assert len(result["legs"]) == 2  # 앵커→p1, p1→p2
    for leg in result["legs"]:
        assert set(leg) == {"from", "to", "mode", "est_min", "real_min", "err_pct"}
        assert isinstance(leg["est_min"], int)
        assert leg["real_min"] == 15.0


def test_rehearsal_records_injected_weather():
    """TRIP-409 — 주입 예보가 problem을 거쳐 결과에 기록된다 (실 호출 0, fake만)."""
    class _FakeWeather:
        def daily_forecast(self, coord, days):
            return {d: 80 for d in days}

    entries = _entries(_TWO_REGIONS)
    smoke_date = dt.date(2026, 8, 14)
    selection = select_rehearsal_pois(entries, smoke_date.isoformat())
    result = run_rehearsal(
        selection, llm=UnwiredLlm(), model_id="dev-unwired", smoke_date=smoke_date,
        weather=_FakeWeather(),
    )
    trip_dates = [(smoke_date + dt.timedelta(days=1 + i)).isoformat()
                  for i in range(3)]  # 기본 3일 여행 (TRIP-476)
    assert result["weather"] == {d: 80 for d in trip_dates}  # 여행일 예보만


def test_rehearsal_accepts_event_store(tmp_path):
    """TRIP-421 — 행사 저장소 주입 관통 (실 호출 0, fake만). 결과 스키마 무변."""
    from trippilot.background.event_store import JsonEventStore
    from trippilot.domain.event import EventInfo, EventType

    entries = _entries(_TWO_REGIONS)
    smoke_date = dt.date(2026, 8, 14)
    selection = select_rehearsal_pois(entries, smoke_date.isoformat())
    store = JsonEventStore(tmp_path / "events.json")
    store.upsert("부산", (EventInfo(
        event_id="e1", name="테스트축제", event_type=EventType.FESTIVAL,
        start=smoke_date + dt.timedelta(days=1), end=smoke_date + dt.timedelta(days=1),
        coord=selection.anchor.coord, address=None),), dt.datetime.now(dt.timezone.utc))

    result = run_rehearsal(
        selection, llm=UnwiredLlm(), model_id="dev-unwired", smoke_date=smoke_date,
        events=store,
    )
    assert len(result["slots"]) >= 1  # 행사 주입이 리허설을 깨지 않는다


# ── 지역 강제 (SMOKE_REGION) ───────────────────────────────────────────
# 날짜 시드는 어느 지역이 걸릴지 고를 수 없다 — 특정 지역의 수집 품질을 보거나
# 그 지역 실패를 재현하려면 강제가 필요하다.

def test_region_강제하면_그_시군구만_시도한다():
    entries = tuple((p, "해운대구" if i < 8 else "기장군")
                    for i, p in enumerate(_leg_selection(16).pois))
    sel = select_rehearsal_pois(entries, "2026-08-21", min_pois=3, max_pois=5,
                                region="기장군")
    assert sel.region == "기장군"


def test_없는_region_은_조용히_랜덤으로_넘어가지_않는다():
    """오타가 랜덤 선택으로 흘러가면 '왜 다른 지역이 나오지'로 시간을 버린다."""
    entries = tuple((p, "해운대구") for p in _leg_selection(8).pois)
    with pytest.raises(SelectionError, match="수집분에 없다"):
        select_rehearsal_pois(entries, "2026-08-21", region="없는구")
