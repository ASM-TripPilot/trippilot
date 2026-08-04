"""TRIP-259 — QualityScore PBT (정본 components.md §3.7, FR-SOLVER-02).

증명하는 것:
  ① QualityScore 범위 검증: [0,1] 밖 성분은 생성 자체가 불가
  ② 직렬화 왕복: QualityScore 단독 + ItinerarySolution 부착/미부착(하위호환)
  ③ 결정론: 같은 입력 2회 → 같은 QualityScore
  ④ 단조성: 위반 많을수록 constraint_satisfaction 비증가 (+실 HC3 위반 통합 케이스)
  ⑤ INV-3: 공개 직렬화에 duration/minutes 키 없음
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.c2.config import SolverConfig
from trippilot.c2.fallback_solver import RuleFallbackSolver
from trippilot.c2.quality import compute_quality, constraint_satisfaction
from trippilot.c2.travel import TravelEstimator
from trippilot.domain.itinerary import (
    FixedBlock,
    ItinerarySolution,
    QualityScore,
    TimeWindow,
)

from tests.generators.itinerary import itinerary_solutions
from tests.generators.solver import solver_setups

_KST = timezone(timedelta(hours=9))
_CFG = SolverConfig()
_EST = TravelEstimator(_CFG)

_UNIT = st.floats(0, 1, allow_nan=False, allow_infinity=False)
_OUT_OF_RANGE = st.one_of(
    st.floats(min_value=1.0, exclude_min=True, allow_nan=False, allow_infinity=False),
    st.floats(max_value=0.0, exclude_max=True, allow_nan=False, allow_infinity=False),
)
_FIELDS = ("preference_fit", "constraint_satisfaction", "route_efficiency", "composite")


def _quality(**overrides) -> QualityScore:
    base = dict.fromkeys(_FIELDS, 0.5)
    base.update(overrides)
    return QualityScore(**base)


# ① 범위 검증 — [0,1] 밖은 어느 성분이든 ValueError
@settings(max_examples=40)
@given(field=st.sampled_from(_FIELDS), bad=_OUT_OF_RANGE)
def test_quality_score_rejects_out_of_range(field: str, bad: float) -> None:
    with pytest.raises(ValueError):
        _quality(**{field: bad})


# ② 직렬화 왕복 — QualityScore 단독
@settings(max_examples=60)
@given(p=_UNIT, c=_UNIT, r=_UNIT, comp=_UNIT)
def test_quality_score_roundtrip(p: float, c: float, r: float, comp: float) -> None:
    qs = QualityScore(
        preference_fit=p, constraint_satisfaction=c,
        route_efficiency=r, composite=comp,
    )
    assert QualityScore.from_dict(qs.to_dict()) == qs


# ② 직렬화 왕복 — solution에 score 부착/미부착 모두
@settings(max_examples=40)
@given(sol=itinerary_solutions(), comp=_UNIT)
def test_solution_roundtrip_with_and_without_score(
    sol: ItinerarySolution, comp: float
) -> None:
    # 미부착 (generator 기본값 None)
    assert sol.score is None
    assert ItinerarySolution.from_dict(sol.to_dict()) == sol
    # 부착
    scored = replace(sol, score=_quality(composite=comp))
    assert ItinerarySolution.from_dict(scored.to_dict()) == scored


# ② 하위호환 — score 키가 없는 기존 직렬화본도 읽힌다
@settings(max_examples=20)
@given(sol=itinerary_solutions())
def test_solution_from_dict_without_score_key(sol: ItinerarySolution) -> None:
    d = sol.to_dict()
    del d["score"]  # 기존(TRIP-259 이전) 직렬화본 모사
    assert ItinerarySolution.from_dict(d) == sol


# ③ 결정론 — 같은 입력 2회, 같은 출력
@settings(max_examples=40)
@given(setup=solver_setups())
def test_compute_quality_deterministic(setup) -> None:
    problem, index = setup
    solution = RuleFallbackSolver(index, _EST, _CFG).solve(problem)
    assert (compute_quality(solution, problem, index, _EST)
            == compute_quality(solution, problem, index, _EST))


# ③′ 성분 전부 [0,1] (QualityScore __post_init__가 재검증하지만 명시 확인)
@settings(max_examples=40)
@given(setup=solver_setups())
def test_compute_quality_components_in_range(setup) -> None:
    problem, index = setup
    solution = RuleFallbackSolver(index, _EST, _CFG).solve(problem)
    qs = compute_quality(solution, problem, index, _EST)
    for f in _FIELDS:
        assert 0.0 <= getattr(qs, f) <= 1.0
    # 폴백 해는 HC 위반 0 (U5-P1) → 제약 만족 만점
    assert qs.constraint_satisfaction == 1.0


# ④ 단조성 — 위반 수 증가 → constraint_satisfaction 비증가
@settings(max_examples=60)
@given(n=st.integers(min_value=0, max_value=50),
       k=st.integers(min_value=1, max_value=50))
def test_constraint_satisfaction_monotone(n: int, k: int) -> None:
    assert constraint_satisfaction(n + k) <= constraint_satisfaction(n)
    assert constraint_satisfaction(0) == 1.0
    assert constraint_satisfaction(1) < 1.0


# ④′ 통합 — 실제 HC3 위반이 있는 문제에서 점수가 실제로 내려간다
@settings(max_examples=20)
@given(setup=solver_setups())
def test_real_violation_lowers_constraint_satisfaction(setup) -> None:
    problem, index = setup
    solution = RuleFallbackSolver(index, _EST, _CFG).solve(problem)
    clean = compute_quality(solution, problem, index, _EST)
    # 새벽 5시 고정 블록 — day window(09~21시) 해에는 절대 없음 → HC3 위반 1건
    d0 = problem.days[0]
    fb_start = datetime(d0.year, d0.month, d0.day, 5, 0, tzinfo=_KST)
    bad_fb = FixedBlock(
        poi_id=next(iter(index)),
        window=TimeWindow(start=fb_start, end=fb_start + timedelta(minutes=30)),
        reason="violation-probe",
    )
    violated_problem = replace(problem, fixed_blocks=problem.fixed_blocks + (bad_fb,))
    violated = compute_quality(solution, violated_problem, index, _EST)
    assert violated.constraint_satisfaction < clean.constraint_satisfaction


# ⑤ INV-3 — 공개 직렬화에 시간 키 금지
def test_quality_score_serialization_has_no_duration_keys() -> None:
    keys = _quality().to_dict().keys()
    assert not any("duration" in k or "minute" in k for k in keys)
    assert set(keys) == set(_FIELDS)
