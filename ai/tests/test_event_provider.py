"""TRIP-421 — EventProvider·event_affinity·행사 보너스 소프트 항 (실 호출 0, fake만).

증명하는 것:
  [Provider]
  ① 날짜 겹침·최대 반경(40km) 1차 필터, 행사 0건도 OK (없음 ≠ 실패)
  ② 절단(truncated) → LOW, 조회 실패 → UNAVAILABLE + 사유 (IO-7)
  [affinity 순수 함수]
  ③ 실효 반경 공식 — 이동수단 기본 × 취향 계수, clamp [3,40]
  ④ 적합 조견표 — 교집합 있으면 1.0, OTHER·무취향은 0 (보너스 없음)
  ⑤ 보너스 맵 — 선형 감쇠, 다중 행사는 max 채택, 좌표 없는 행사 건너뜀, 양수만
  [솔버]
  ⑥ 근소 갭에서 보너스 POI가 선택된다 (OR-Tools·폴백 동일 규칙), 큰 갭은 서열 유지
  ⑦ 무보정 회귀: event_bonus=None ↔ 빈 맵 동일 해 + 직렬화 왕복·하위호환
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from trippilot.solver_engine.config import SolverConfig
from trippilot.solver_engine.fallback_solver import RuleFallbackSolver
from trippilot.solver_engine.ortools_solver import OrToolsSolver
from trippilot.solver_engine.travel import TravelEstimator
from trippilot.domain.common import (
    BudgetLevel,
    GeoPoint,
    PoiId,
    ScheduleId,
    TransportMode,
)
from trippilot.domain.event import EventInfo, EventType
from trippilot.domain.freshness import ProviderStatus
from trippilot.domain.itinerary import ItineraryProblem, TimeWindow
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.persona import TasteTag
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.orchestrator.event_affinity import (
    ATTACH_RADIUS_KM,
    event_affinity,
    event_bonus_map,
    event_radius_km,
)
from trippilot.providers.event import EventProvider

_KST = timezone(timedelta(hours=9))
_DAY = date(2026, 8, 22)
_NOW = datetime(2026, 8, 20, 9, 0, tzinfo=_KST)
_ANCHOR = GeoPoint(35.1532, 129.1186)  # 광안리 근방 (값 자체는 임의)


def _event(eid: str, *, etype=EventType.FESTIVAL, start=_DAY, end=_DAY,
           coord=_ANCHOR) -> EventInfo:
    return EventInfo(event_id=eid, name=f"행사-{eid}", event_type=etype,
                     start=start, end=end, coord=coord, address=None)


class _FakeStore:
    def __init__(self, events=(), truncated=False, error=None) -> None:
        self._events, self._truncated, self._error = tuple(events), truncated, error

    def search_events(self, start, end):
        if self._error is not None:
            raise self._error
        return self._events, self._truncated


_PARAMS = {"anchor": _ANCHOR, "days": (_DAY,), "now": _NOW}


# ── ① 1차 필터 ───────────────────────────────────────────────────────


def test_provider_filters_by_overlap_and_max_radius() -> None:
    far = GeoPoint(_ANCHOR.lat + 1.0, _ANCHOR.lng)  # ≈111km — 40km 밖
    events = (
        _event("in"),                                            # 겹침·반경 안
        _event("past", start=_DAY - timedelta(days=9),
               end=_DAY - timedelta(days=2)),                    # 기간 안 겹침
        _event("far", coord=far),                                # 반경 밖
        _event("no-coord", coord=None),                          # 좌표 없음 — 유지
    )
    packet = EventProvider(_FakeStore(events)).fetch(_PARAMS)

    assert packet.status is ProviderStatus.OK
    assert [e["event_id"] for e in packet.data["events"]] == ["in", "no-coord"]
    assert packet.freshness is not None and packet.freshness.source == "EVENT_STORE"


def test_provider_zero_events_is_ok() -> None:
    packet = EventProvider(_FakeStore(())).fetch(_PARAMS)
    assert packet.status is ProviderStatus.OK  # 없음은 정상 — 실패 상태값 아님
    assert packet.data["events"] == []


# ── ② 절단·실패 상태값 ───────────────────────────────────────────────


def test_provider_truncated_is_low() -> None:
    packet = EventProvider(_FakeStore((_event("e"),), truncated=True)).fetch(_PARAMS)
    assert packet.status is ProviderStatus.LOW  # 침묵 절단 금지


def test_provider_failure_is_unavailable_with_reason() -> None:
    packet = EventProvider(_FakeStore(error=TimeoutError("store down"))).fetch(_PARAMS)
    assert packet.status is ProviderStatus.UNAVAILABLE
    assert "TimeoutError" in packet.data["reason"]
    assert packet.freshness is None


# ── ③ 실효 반경 공식 ─────────────────────────────────────────────────


def test_radius_formula_transport_base_times_taste_factor() -> None:
    assert event_radius_km(TransportMode.PUBLIC, ()) == 15.0
    assert event_radius_km(TransportMode.PUBLIC, (TasteTag.ACTIVITY,)) == 22.5
    assert event_radius_km(TransportMode.PUBLIC, (TasteTag.REST,)) == 10.5
    # ACTIVITY가 REST보다 우선 (활동계가 있으면 멀리 간다)
    assert event_radius_km(
        TransportMode.PUBLIC, (TasteTag.REST, TasteTag.ACTIVITY)) == 22.5
    assert event_radius_km(TransportMode.WALK, (TasteTag.REST,)) == 3.5
    assert event_radius_km(TransportMode.CAR, (TasteTag.ACTIVITY,)) == 40.0  # 상한


# ── ④ 적합 조견표 ────────────────────────────────────────────────────


def test_affinity_lookup_table() -> None:
    assert event_affinity(EventType.FESTIVAL, (TasteTag.ACTIVITY,)) == 1.0
    assert event_affinity(EventType.EXHIBITION, (TasteTag.CULTURE,)) == 1.0
    assert event_affinity(EventType.FESTIVAL, (TasteTag.REST,)) == 0.0
    assert event_affinity(EventType.OTHER, (TasteTag.ACTIVITY,)) == 0.0  # 유형 불명
    assert event_affinity(EventType.FESTIVAL, ()) == 0.0  # 무취향 — 근거 없는 보너스 금지


# ── ⑤ 보너스 맵 ──────────────────────────────────────────────────────


def _poi(pid: str, coord: GeoPoint) -> Poi:
    return Poi(PoiId(pid), pid, PoiCategory.SIGHT, coord, (), None, None,
               DataQuality.FULL, PoiSource.SEED, None)


def test_bonus_map_linear_decay_and_max_merge() -> None:
    near = _poi("near", GeoPoint(_ANCHOR.lat + 0.0018, _ANCHOR.lng))  # ≈0.2km
    edge = _poi("edge", GeoPoint(_ANCHOR.lat + 0.0081, _ANCHOR.lng))  # ≈0.9km
    out = _poi("out", GeoPoint(_ANCHOR.lat + 0.02, _ANCHOR.lng))      # ≈2.2km — 부착 밖
    bonus = event_bonus_map(
        (_event("e1"), _event("e2")),  # 같은 좌표 행사 2건 — max 채택 (합산 인플레 금지)
        (near, edge, out),
        anchor=_ANCHOR, transport=TransportMode.PUBLIC,
        taste_tags=(TasteTag.ACTIVITY,),
    )
    assert set(bonus) == {PoiId("near"), PoiId("edge")}
    assert bonus[PoiId("near")] == pytest.approx(1 - 0.2 / ATTACH_RADIUS_KM, abs=0.05)
    assert bonus[PoiId("near")] > bonus[PoiId("edge")] > 0.0  # 가까울수록 크다
    assert all(0.0 <= b <= 1.0 for b in bonus.values())  # 양수만 — 감점 없음


def test_bonus_map_skips_unfit_far_and_coordless_events() -> None:
    poi = _poi("p", _ANCHOR)
    kwargs = dict(anchor=_ANCHOR, transport=TransportMode.WALK,
                  taste_tags=(TasteTag.REST,))  # 실효 반경 3.5km
    far_event = _event("far", coord=GeoPoint(_ANCHOR.lat + 0.05, _ANCHOR.lng))  # ≈5.5km
    assert event_bonus_map((far_event,), (poi,), **kwargs) == {}  # 실효 반경 밖
    assert event_bonus_map((_event("e"),), (poi,), **kwargs) == {}  # REST↔축제 부적합
    assert event_bonus_map((_event("nc", coord=None),), (poi,),
                           anchor=_ANCHOR, transport=TransportMode.PUBLIC,
                           taste_tags=(TasteTag.ACTIVITY,)) == {}  # 좌표 없음


# ── ⑥·⑦ 솔버 — 근소 갭 재배치·무보정 회귀 ───────────────────────────

_CFG = SolverConfig(or_tools_limit_ms=2000, or_tools_min_ms=50)
_EST = TravelEstimator(_CFG)


def _problem(event_bonus=None, *, gap: float = 0.05):
    # 창 09~11시(체류 90분) — 둘 중 하나만 배치 가능한 강제 선택 구도
    pois = [_poi("a", GeoPoint(37.751, 128.876)),
            _poi("b", GeoPoint(37.7515, 128.876))]
    index = {p.poi_id: p for p in pois}
    cands = (ScoredPoi(PoiId("a"), 0.80, False),
             ScoredPoi(PoiId("b"), 0.80 - gap, False))
    problem = ItineraryProblem(
        schedule_id=ScheduleId("s-421"), days=(_DAY,), candidates=cands,
        fixed_blocks=(), budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=TimeWindow(datetime(2026, 8, 22, 9, 0, tzinfo=_KST),
                              datetime(2026, 8, 22, 11, 0, tzinfo=_KST)),
        seed=7, event_bonus=event_bonus)
    return problem, index


def _picked(solution) -> set[str]:
    return {str(s.poi_id) for d in solution.days for s in d.slots}


@pytest.mark.parametrize("solver_cls", [OrToolsSolver, RuleFallbackSolver])
def test_bonus_flips_near_tie_but_not_big_gap(solver_cls) -> None:
    bonus = {PoiId("b"): 1.0}  # 열세 후보에 행사 보너스 (스케일 0.15 > 갭 0.05)
    problem, index = _problem(bonus)
    solver = solver_cls(index, _EST, _CFG)
    assert _picked(solver.solve(problem, 2000)) == {"b"}

    # 갭이 한 단(0.3) 이상이면 서열 유지 — 보너스가 취향을 압도하지 않는다
    problem_big, index = _problem(bonus, gap=0.4)
    assert _picked(solver_cls(index, _EST, _CFG).solve(problem_big, 2000)) == {"a"}


@pytest.mark.parametrize("solver_cls", [OrToolsSolver, RuleFallbackSolver])
def test_none_and_empty_bonus_are_identical(solver_cls) -> None:
    p_none, index = _problem(None)
    p_empty, _ = _problem({})
    solver = solver_cls(index, _EST, _CFG)
    assert solver.solve(p_none, 2000) == solver.solve(p_empty, 2000)


def test_problem_serialization_roundtrip_and_backward_compat() -> None:
    problem, _ = _problem({PoiId("b"): 0.5})
    restored = ItineraryProblem.from_dict(problem.to_dict())
    assert restored.event_bonus == {PoiId("b"): 0.5}

    legacy = problem.to_dict()
    del legacy["event_bonus"]  # 키 없는 기존 직렬화본 — 하위호환
    assert ItineraryProblem.from_dict(legacy).event_bonus is None

    with pytest.raises(ValueError):  # 범위 밖 — 감점(음수) 경로 차단
        _problem({PoiId("b"): -0.1})


# ── 오케스트레이터 주입 — 보너스가 problem에 실린다 (TRIP-421) ────────


def test_orchestrator_lands_event_bonus_on_problem() -> None:
    from trippilot.domain.common import TraceId
    from tests.test_itinerary_orchestrator import (
        _ANCHOR as ORCH_ANCHOR, _NOW as ORCH_NOW, _TRACE_ID, _build, _request,
    )

    store = _FakeStore((
        EventInfo(event_id="e1", name="불꽃축제", event_type=EventType.FESTIVAL,
                  start=ORCH_NOW.date(), end=ORCH_NOW.date() + timedelta(days=3),
                  coord=ORCH_ANCHOR, address=None),
    ))
    orchestrator, trace, sink = _build(events=store)

    outcome = orchestrator.generate(_request(), 20_000, _TRACE_ID, ORCH_NOW)

    bonus = sink.problems[0].event_bonus
    # 기본 페르소나 취향은 NATURE뿐 — 축제 조견표(ACTIVITY·CULTURE)와 부적합 →
    # 보너스 없음(None)이 정직한 값이고, 강등도 아니다
    assert bonus is None
    assert not any(getattr(e, "stage", "") == "event"
                   for e in outcome.degradations)


def test_orchestrator_event_store_failure_degrades_not_fails() -> None:
    from tests.test_itinerary_orchestrator import (
        _NOW as ORCH_NOW, _TRACE_ID, _build, _request,
    )

    orchestrator, trace, sink = _build(events=_FakeStore(error=OSError("down")))
    outcome = orchestrator.generate(_request(), 20_000, _TRACE_ID, ORCH_NOW)

    assert outcome.solution is not None  # 행사 실패 ≠ 생성 실패 (INV-4)
    assert sink.problems[0].event_bonus is None
    assert any(d.stage == "event" and "event_error" in d.reason
               for d in outcome.degradations)
