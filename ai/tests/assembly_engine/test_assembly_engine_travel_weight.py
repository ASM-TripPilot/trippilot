"""경로 길이 감점 `ItineraryProblem.travel_weight` (BR-U4-47 — 피로·지연·우천 재계획).

`LESS_MOVE` 는 앵커에서 먼 **후보**를 내릴 뿐이라 흩어진 후보끼리 오가는 **경로**는 못 줄였다
(실스택 부산 재계획: 피로 26.1 → 30.1km). 재정렬(B)은 A 가 고른 집합 안의 순서만 바꾼다 —
집합이 흩어져 있으면 최단 순서도 길다. 그래서 감점은 선택(A)에 들어간다.

증명하는 것:
  ① PBT(OR): 같은 풀·시드에서 감점을 켜면 총 도로 km ≤ 끈 경우 — **A 가 OPTIMAL 일 때 풀마다**
     성립한다(켠 해가 감점 포함 목적값으로 끈 해를 이기고, 끈 해는 점수 최대라서). 결정론 한도에
     끊긴 FEASIBLE 은 증명이 없어 풀마다는 안 선다 — 그 경우는 전제에서 뺀다(안티패턴 197행).
     아크마다 계수를 정수로 반올림해서 아크당 ≤ 0.5 / w m 의 여유를 둔다.
  ② 큰 풀(한도에 끊기는 OR)·폴백(지금 위치에서의 도로 km × w 를 점수에서 뺀 순서 — 같은
     의미의 그리디판)은 풀마다가 아니라 집계로 준다.
  ③ 직렬화 왕복
  ④ 앵커=숙소(생성, `ignore_anchor_distance`) — 숙소 출발·복귀 구간은 감점 밖이라 먼 동네의 좋은 곳을
     고른다(OR·폴백). 꺼져 있으면(재계획 — 앵커=지금 위치) 종전처럼 숙소 옆을 고른다.
  (기본 0 이면 종전과 같은 해 — 같은 코드 경로끼리 비교하는 테스트는 아무것도 못 지켜서 두지
  않았다. 확인은 안정성 하네스 전후 동일 + 리뷰의 HEAD 사본 대조 40풀 해시 일치로 했다.)
"""

from __future__ import annotations

import random
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from hypothesis import HealthCheck, assume, given, settings
from hypothesis import strategies as st
from ortools.sat.python import cp_model

from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.constraints import check_all
from trippilot.assembly_engine.fallback_assembler import RuleFallbackAssembler
from trippilot.assembly_engine.ortools_assembler import OrToolsAssembler
from trippilot.assembly_engine.travel import TravelEstimator
from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId, ScheduleId, TransportMode
from trippilot.domain.itinerary import ItineraryProblem, TimeWindow
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource

_KST = timezone(timedelta(hours=9))
_CFG = AssemblyConfig(or_tools_min_ms=50)
_EST = TravelEstimator(_CFG)
_DAY = date(2026, 10, 14)
_ANCHOR = GeoPoint(35.1578, 129.0597)
_CATS = (PoiCategory.SIGHT, PoiCategory.CAFE, PoiCategory.CULTURE, PoiCategory.SHOPPING,
         PoiCategory.NATURE)


def _pool(rnd: random.Random, n: int, end_hour: int):
    pois = [Poi(poi_id=PoiId(f"p{i}"), name=f"p{i}", category=rnd.choice(_CATS),
                coord=GeoPoint(35.05 + rnd.random() * 0.15, 129.00 + rnd.random() * 0.18),
                open_hours=(), avg_cost=None, rating=None, quality=DataQuality.FULL,
                source=PoiSource.SEED, confidence=None) for i in range(n)]
    problem = ItineraryProblem(
        schedule_id=ScheduleId("route"), days=(_DAY,),
        candidates=tuple(ScoredPoi(p.poi_id, round(rnd.uniform(0.3, 0.9), 3), True) for p in pois),
        fixed_blocks=(), budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=TimeWindow(datetime(2026, 10, 14, 9, tzinfo=_KST),
                              datetime(2026, 10, 14, end_hour, tzinfo=_KST)),
        seed=rnd.randrange(1000), anchor=_ANCHOR)
    return problem, {p.poi_id: p for p in pois}


def _road_km(solution, index, problem) -> float:
    """재정렬(B)·감점과 같은 축 — 앵커 출발·복귀 포함 도로 km."""
    total = 0.0
    for day in solution.days:
        pts = [problem.anchor, *(index[s.poi_id].coord for s in day.slots), problem.anchor]
        if len(pts) > 2:
            total += sum(_EST.estimate(a, b, problem.transport).distance_km_range[1]
                         for a, b in zip(pts, pts[1:]))
    return total


def _or(problem, index):
    """OR 해 + 그 안의 CP-SAT 상태들(경로 완성·A·B)."""
    statuses: list[int] = []
    real = cp_model.CpSolver.Solve

    def spy(self, model, *a, **k):
        status = real(self, model, *a, **k)
        statuses.append(status)
        return status

    with patch.object(cp_model.CpSolver, "Solve", spy):
        out = OrToolsAssembler(index, _EST, _CFG).solve(problem, remaining_ms=10_000)
    return out, statuses


# ① ────────────────────────────────────────────────────────────────────────

@settings(max_examples=25, deadline=None, suppress_health_check=[HealthCheck.filter_too_much])
@given(seed=st.integers(0, 10_000), n=st.integers(4, 6), end_hour=st.integers(13, 16),
       weight=st.sampled_from([0.02, 0.05, 0.1]))
def test_OR_감점을_켜면_풀마다_총_이동이_끈_경우_이하다(seed, n, end_hour, weight) -> None:
    problem, index = _pool(random.Random(seed), n, end_hour)
    off, s_off = _or(problem, index)
    on, s_on = _or(replace(problem, travel_weight=weight), index)
    assert off is not None and on is not None
    # 증명의 전제 — A·B 가 결정론 한도에 끊기지 않았다(FEASIBLE·UNKNOWN 없음)
    assume(not {cp_model.FEASIBLE, cp_model.UNKNOWN} & {*s_off, *s_on})
    arcs = sum(len(d.slots) + 1 for s in (on, off) for d in s.days)
    slack_km = arcs * 0.5 / weight / 1000  # 아크 계수 정수 반올림 몫 — 켠 해·끈 해 양쪽
    assert _road_km(on, index, problem) <= _road_km(off, index, problem) + slack_km
    assert check_all(on, problem, index, _EST) == []


# ② ────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("engine", ["or", "fb"])
def test_큰_풀에서도_감점을_켜면_집계_이동이_준다(engine) -> None:
    """후보 20곳(결정론 한도에 끊기는 크기) — 풀마다가 아니라 합으로. 실측(scratch 스윕, 20km
    상자 8풀): w=0.05 에서 OR 중앙 −21~39%·폴백 −30~43%, 방문 수는 오히려 늘었다(이동이 준 만큼)."""
    off_km = on_km = 0.0
    for seed in range(10):
        problem, index = _pool(random.Random(seed), 20, 18)
        if engine == "or":
            off, _ = _or(problem, index)
            on, _ = _or(replace(problem, travel_weight=0.05), index)
        else:
            fb = RuleFallbackAssembler(index, _EST, _CFG)
            off, on = fb.solve(problem), fb.solve(replace(problem, travel_weight=0.05))
        assert check_all(on, problem, index, _EST) == []
        off_km += _road_km(off, index, problem)
        on_km += _road_km(on, index, problem)
    assert on_km < off_km * 0.9, (on_km, off_km)


# ③ ────────────────────────────────────────────────────────────────────────

def test_직렬화_왕복과_음수_거부() -> None:
    problem, _ = _pool(random.Random(1), 4, 15)
    on = replace(problem, travel_weight=0.05)
    assert ItineraryProblem.from_dict(on.to_dict()) == on
    old = problem.to_dict()
    old.pop("travel_weight")  # 키 없는 기존 덤프도 읽힌다
    assert ItineraryProblem.from_dict(old).travel_weight == 0.0
    with pytest.raises(ValueError):
        replace(problem, travel_weight=-0.1)


# ④ ────────────────────────────────────────────────────────────────────────

def _two_areas():
    """숙소 옆(0.80 × 3) vs 8km 떨어진 동네(0.85 × 3), 하루 3곳 — 동네 안은 100m 간격."""
    def poi(pid, lat, lng):
        return Poi(poi_id=PoiId(pid), name=pid, category=PoiCategory.SIGHT, coord=GeoPoint(lat, lng),
                   open_hours=(), avg_cost=None, rating=None, quality=DataQuality.FULL,
                   source=PoiSource.SEED, confidence=None)
    near = [poi(f"near{k}", _ANCHOR.lat + 0.001 * k, _ANCHOR.lng) for k in range(1, 4)]
    far = [poi(f"far{k}", _ANCHOR.lat + 0.072 + 0.001 * k, _ANCHOR.lng) for k in range(1, 4)]
    problem = ItineraryProblem(
        schedule_id=ScheduleId("base"), days=(_DAY,),
        candidates=tuple(ScoredPoi(p.poi_id, 0.80, True) for p in near)
        + tuple(ScoredPoi(p.poi_id, 0.85, True) for p in far),
        fixed_blocks=(), budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=TimeWindow(datetime(2026, 10, 14, 9, tzinfo=_KST),
                              datetime(2026, 10, 14, 18, tzinfo=_KST)),
        seed=7, anchor=_ANCHOR, travel_weight=0.02, max_visits_per_day=3)
    return problem, {p.poi_id: p for p in near + far}


@pytest.mark.parametrize("engine", ["or", "fallback"])
@pytest.mark.parametrize("lodging_is_base, area", [(True, "far"), (False, "near")])
def test_숙소는_오가는_곳이면_먼_동네의_좋은_곳을_고른다(engine, lodging_is_base, area) -> None:
    """2026-10-19 사용자 — "꼭 숙소 근처만 있지 않아도 돼, 숙소로 다시 돌아오면 되지". 개발 서버 서울 생성이
    숙소 반경 1~2km 에 몰렸다(공유본 실측: 방문지의 숙소 거리 중앙 0.5km). 왕복 약 21km × 0.02 = 0.42 가
    점수 차 0.05 × 3 을 이겨 숙소 옆만 골랐다. 재계획(앵커=지금 위치)은 종전 그대로여야 한다."""
    problem, index = _two_areas()
    problem = replace(problem, ignore_anchor_distance=lodging_is_base)

    if engine == "or":
        solution = OrToolsAssembler(index, _EST, _CFG).solve(problem, remaining_ms=10_000)
    else:
        solution = RuleFallbackAssembler(index, _EST, _CFG).solve(problem)

    picked = {str(s.poi_id) for d in solution.days for s in d.slots}
    assert picked == {f"{area}{k}" for k in range(1, 4)}, picked
    assert check_all(solution, problem, index, _EST) == []


def test_숙소_표식도_직렬화_왕복한다() -> None:
    problem, _ = _two_areas()
    on = replace(problem, ignore_anchor_distance=True)
    assert ItineraryProblem.from_dict(on.to_dict()) == on
    old = problem.to_dict()
    old.pop("ignore_anchor_distance")  # 키 없는 기존 덤프는 재계획과 같은 기본값
    assert ItineraryProblem.from_dict(old).ignore_anchor_distance is False

