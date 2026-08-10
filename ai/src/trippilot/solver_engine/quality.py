"""QualityScore 계산 — 솔버 산출물 품질 지표 (정본 components.md §3.7, FR-SOLVER-02).

초기 공식 — 가중치·감점 계수·거리 스케일의 캘리브레이션은 후속(운영 결정 O-SOLVER).
전부 순수 함수: I/O 없음, 같은 입력 → 같은 출력 (estimator가 결정론이면 전체 결정론).

INV-3: 점수는 무차원 비율 [0,1]만 담는다 — duration/minutes 필드 없음.
route_efficiency도 TravelEstimate의 거리(distance_km_range)만 쓰고
internal_minutes는 사용하지 않는다 (내부 계산에서조차 시간 미개입).

시그니처 주: constraint_satisfaction이 constraints.check_all을 재사용하므로
check_all과 동일하게 (solution, problem, poi_index, estimator)를 받는다.
"""

from __future__ import annotations

from typing import Mapping

from trippilot.solver_engine.constraints import check_all
from trippilot.domain.common import PoiId
from trippilot.domain.itinerary import (
    ItineraryProblem,
    ItinerarySolution,
    QualityScore,
)
from trippilot.domain.poi import Poi

# ── 초기 상수 (캘리브레이션은 후속 — O-SOLVER) ──────────────────
_W_PREFERENCE = 0.4       # composite 가중치: 선호 적합
_W_CONSTRAINT = 0.4       # composite 가중치: 제약 만족
_W_ROUTE = 0.2            # composite 가중치: 동선 효율
_VIOLATION_PENALTY = 0.25  # HC 위반 1건당 감점 (4건 이상 = 0.0)
_ROUTE_SCALE_KM = 10.0     # 총 이동거리가 이 값일 때 효율 0.5 (반감 스케일)


def _clamp01(v: float) -> float:
    return min(1.0, max(0.0, v))


def preference_fit(solution: ItinerarySolution) -> float:
    """배치된 슬롯 score 평균 (각 슬롯 [0,1]로 클램프 후 산술평균).

    규칙 점수(build_rule_score)는 1을 넘을 수 있어 클램프로 정규화.
    슬롯 0개 = 아무것도 배치 못함 → 0.0.
    """
    scores = [_clamp01(s.score) for day in solution.days for s in day.slots]
    if not scores:
        return 0.0
    return sum(scores) / len(scores)


def constraint_satisfaction(violation_count: int) -> float:
    """HC 위반 0건 = 1.0, 이후 건수 비례 감점 (단조 비증가, 바닥 0.0)."""
    if violation_count < 0:
        raise ValueError(f"violation_count 음수: {violation_count}")
    return max(0.0, 1.0 - violation_count * _VIOLATION_PENALTY)


def route_efficiency(total_road_km: float) -> float:
    """총 이동거리 기반 단조 감소: 1 / (1 + km/scale). 이동 0km = 1.0."""
    if total_road_km < 0:
        raise ValueError(f"total_road_km 음수: {total_road_km}")
    return 1.0 / (1.0 + total_road_km / _ROUTE_SCALE_KM)


def _total_road_km(
    solution: ItinerarySolution,
    problem: ItineraryProblem,
    poi_index: Mapping[PoiId, Poi],
    estimator,
) -> float:
    """일별 연속 슬롯 쌍의 도로거리(distance_km_range 상한) 합.

    poi_index에 없는 POI가 낀 쌍은 건너뜀 — HC2(check_hc2)와 동일 규칙.
    """
    total = 0.0
    for day in solution.days:
        for prev, nxt in zip(day.slots, day.slots[1:]):
            p1, p2 = poi_index.get(prev.poi_id), poi_index.get(nxt.poi_id)
            if p1 is None or p2 is None:
                continue
            est = estimator.estimate(p1.coord, p2.coord, problem.transport)
            total += est.distance_km_range[1]  # 도로거리 상한 — 시간값 미사용 (INV-3)
    return total


def compute_quality(
    solution: ItinerarySolution,
    problem: ItineraryProblem,
    poi_index: Mapping[PoiId, Poi],
    estimator,
) -> QualityScore:
    """솔버 해의 QualityScore 계산 (부착은 호출측 몫 — 이 함수는 순수 계산만).

    composite = 0.4·preference_fit + 0.4·constraint_satisfaction + 0.2·route_efficiency.
    초기 공식 — 캘리브레이션은 후속 (O-SOLVER).
    """
    pref = preference_fit(solution)
    cons = constraint_satisfaction(
        len(check_all(solution, problem, poi_index, estimator))
    )
    route = route_efficiency(_total_road_km(solution, problem, poi_index, estimator))
    composite = _clamp01(
        _W_PREFERENCE * pref + _W_CONSTRAINT * cons + _W_ROUTE * route
    )
    return QualityScore(
        preference_fit=pref,
        constraint_satisfaction=cons,
        route_efficiency=route,
        composite=composite,
    )
