"""smoke_itinerary 순수 로직 검증 — 실 호출 0건 (fake만, D37) (TRIP-372).

스크립트 본체(scripts/smoke_itinerary.py)는 pytest 대상이 아니지만, 선택·샘플
순수 로직과 기록 스키마는 여기서 fake 데이터로 검증한다:
  ① 날짜 시드 결정론 — 같은 (날짜, 데이터)는 항상 같은 선택, 날짜가 바뀌면 변주
  ② 반경 샘플 규칙 — 앵커 포함 6~8개, 전부 앵커 8km 이내
  ③ 부족 시 재시도 — 흩어진 시군구는 건너뛰고 밀집 시군구로, 전부 실패면 명시 에러
  ④ 기록 JSON 스키마 — 계약 키 전량 + 슬롯 이름 매핑
  ⑤ 생성 관통 1건 — LLM 미주입(UnwiredLlm 경로: 규칙 점수 폴백)으로 200 + INV-1
"""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

import pytest

from trippilot.api.wiring import UnwiredLlm
from trippilot.solver_engine.travel import haversine_km
from trippilot.domain.common import GeoPoint
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource

# scripts/ 는 패키지가 아니다 — 스크립트와 같은 방식(동일 디렉토리 경로)으로 import
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from smoke_itinerary import (  # noqa: E402
    RehearsalError,
    SelectionError,
    load_proposals,
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
        "solve_mode", "is_fallback", "llm_used", "latency_ms",
    }
    assert result["date"] == "2026-08-14"
    assert result["region"] == selection.region
    assert set(result["anchor"]) == {"poi_id", "name", "lat", "lng"}
    assert result["anchor"]["poi_id"] == str(selection.anchor.poi_id)
    assert result["poi_names"] == [p.name for p in selection.pois]
    assert result["llm_used"] is False  # UnwiredLlm — 성공 호출 0건 (정직한 강등)
    assert isinstance(result["latency_ms"], int)
    names = {p.name for p in selection.pois}
    assert len(result["slots"]) >= 1
    for slot in result["slots"]:
        assert set(slot) == {"start", "end", "name"}
        assert slot["name"] in names  # 슬롯 poi ⊆ 선택 집합 (INV-1 사영)


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
