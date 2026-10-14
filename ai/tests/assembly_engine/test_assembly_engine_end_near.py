"""숙소 근처에서 끝내기 `ItineraryProblem.end_near` (BR-U4-47 — 재계획 지시 END_NEAR_STAY).

마지막 방문지 → 숙소 도로 km 를 감점한다(OR: 끝 아크 i→0 리터럴에 계수, 폴백: 매 삽입에 숙소 거리).

증명하는 것:
  ① PBT(OR): 같은 풀·시드에서 끝점을 주면 마지막 방문지 → 숙소 km ≤ 안 준 경우 — A·B 가 OPTIMAL
     일 때 풀마다 성립한다(켠 해의 목적값 ≥ 끈 해를 켠 목적식으로 잰 값, 끈 해는 기본 목적 최대.
     B 는 "A 목적값 이상"을 지키는데 이 항이 그 목적에 들어 있다). 계수 정수 반올림 몫만 여유.
  ② 폴백은 풀마다가 아니라 집계로 — 그리디는 어느 삽입이 마지막인지 모른다.
  ③ 직렬화 왕복 · 키 없는 기존 덤프
  (None 이면 항 없음 — 종전과 같은 해. 확인은 `scripts/measure/measure_assembly_stability.py` 전후 동일.)
"""

from __future__ import annotations

import random
from dataclasses import replace

import pytest
from hypothesis import HealthCheck, assume, given, settings
from hypothesis import strategies as st
from ortools.sat.python import cp_model

from trippilot.assembly_engine.config import END_NEAR_WEIGHT
from trippilot.assembly_engine.constraints import check_all
from trippilot.assembly_engine.fallback_assembler import RuleFallbackAssembler
from trippilot.domain.common import GeoPoint
from trippilot.domain.itinerary import ItineraryProblem

from tests.assembly_engine.test_assembly_engine_travel_weight import _CFG, _EST, _or, _pool

# 상자(35.05~35.20, 129.00~129.18)의 한 모서리 — 앵커(상자 가운데)와 멀어야 끝점이 뭔가를 바꾼다.
_STAY = GeoPoint(35.06, 129.17)


def _end_km(solution, index, problem) -> float:
    """마지막 방문지 → 숙소 도로 km 합(일자별). 감점과 같은 축."""
    return sum(_EST.estimate(index[d.slots[-1].poi_id].coord, _STAY, problem.transport)
               .distance_km_range[1] for d in solution.days if d.slots)


# ① ────────────────────────────────────────────────────────────────────────

@settings(max_examples=25, deadline=None, suppress_health_check=[HealthCheck.filter_too_much])
@given(seed=st.integers(0, 10_000), n=st.integers(4, 6), end_hour=st.integers(13, 16))
def test_OR_끝점을_주면_풀마다_마지막_방문지가_숙소에_더_가깝거나_같다(seed, n, end_hour) -> None:
    problem, index = _pool(random.Random(seed), n, end_hour)
    off, s_off = _or(problem, index)
    on, s_on = _or(replace(problem, end_near=_STAY), index)
    assert off is not None and on is not None
    assume(not {cp_model.FEASIBLE, cp_model.UNKNOWN} & {*s_off, *s_on})  # 증명의 전제
    slack_km = 2 * 0.5 / (END_NEAR_WEIGHT * 1000)  # 끝 아크 계수 반올림 몫 — 켠 해·끈 해 양쪽
    assert _end_km(on, index, problem) <= _end_km(off, index, problem) + slack_km
    assert check_all(on, problem, index, _EST) == []


# ② ────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("engine", ["or", "fb"])
def test_큰_풀에서도_끝점을_주면_집계로_숙소에_가깝게_끝난다(engine) -> None:
    off_km = on_km = 0.0
    for seed in range(10):
        problem, index = _pool(random.Random(seed), 20, 18)
        on_problem = replace(problem, end_near=_STAY)
        if engine == "or":
            off, _ = _or(problem, index)
            on, _ = _or(on_problem, index)
        else:
            fb = RuleFallbackAssembler(index, _EST, _CFG)
            off, on = fb.solve(problem), fb.solve(on_problem)
        assert check_all(on, problem, index, _EST) == []
        off_km += _end_km(off, index, problem)
        on_km += _end_km(on, index, problem)
    assert on_km < off_km * 0.9, (on_km, off_km)


# ③ ────────────────────────────────────────────────────────────────────────

def test_직렬화_왕복과_키_없는_덤프() -> None:
    problem, _ = _pool(random.Random(1), 4, 15)
    on = replace(problem, end_near=_STAY)
    assert ItineraryProblem.from_dict(on.to_dict()) == on
    old = problem.to_dict()
    old.pop("end_near")
    assert ItineraryProblem.from_dict(old).end_near is None
