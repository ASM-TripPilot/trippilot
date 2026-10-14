"""필수 방문 우선순위 `RequiredVisit.priority` — 사용자가 이름으로 콕 집은 곳은 다른 필수 방문 여럿보다 무겁다.

DEV 실호출(2026-10-14): "성산일출봉은 꼭 가고 싶어, 6시까지만" — 2시간 넘는 빈칸이 있는데도 미배치.
필수 방문이 전부 같은 1M 가중이라, 먼 한 곳을 넣으려 가까운 두 곳을 빼느니 그 한 곳을 버렸다.
구성 LLM 이 고른 곳은 사용자가 말한 곳이 아니다.

판정 상황: 하루 창이 좁아 **먼 우선 방문 하나** 또는 **가까운 보통 필수 둘** 중 한쪽만 들어간다.
"""

from __future__ import annotations

import random
from dataclasses import replace

from trippilot.assembly_engine.constraints import check_all
from trippilot.assembly_engine.fallback_assembler import RuleFallbackAssembler
from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.itinerary import RequiredVisit

from tests.assembly_engine.test_assembly_engine_travel_weight import _ANCHOR, _CFG, _DAY, _EST, _or, _pool


def _case(priority: bool):
    problem, index = _pool(random.Random(7), 6, 13)  # 09~13시 — 4시간
    far, n1, n2 = PoiId("p0"), PoiId("p1"), PoiId("p2")
    index = {
        **index,
        far: replace(index[far], coord=GeoPoint(_ANCHOR.lat + 0.18, _ANCHOR.lng)),  # ~20km — 혼자는 들어가고 셋은 안 된다(실측)
        n1: replace(index[n1], coord=GeoPoint(_ANCHOR.lat + 0.003, _ANCHOR.lng)),
        n2: replace(index[n2], coord=GeoPoint(_ANCHOR.lat, _ANCHOR.lng + 0.003)),
    }
    visits = (
        RequiredVisit(poi_id=n1, day=_DAY, dwell_min=60, reason="llm_compose"),
        RequiredVisit(poi_id=n2, day=_DAY, dwell_min=60, reason="llm_compose"),
        RequiredVisit(poi_id=far, day=_DAY, dwell_min=60, reason="nl_request", priority=priority),
    )
    return replace(problem, required_visits=visits, max_visits_per_day=3), index, far, (n1, n2)


def _placed(solution) -> set:
    return {s.poi_id for d in solution.days for s in d.slots}


def test_premise_far_fits_alone_but_not_with_both() -> None:
    """전제 — 먼 곳은 혼자는 들어가고, 셋 다는 안 들어간다(그래야 우선순위가 갈린다)."""
    problem, index, far, near = _case(priority=False)
    alone = replace(problem, required_visits=tuple(r for r in problem.required_visits if r.poi_id == far))
    assert far in _placed(_or(alone, index)[0])
    out, _ = _or(problem, index)
    assert not ({far, *near} <= _placed(out))


def test_without_priority_the_far_one_loses() -> None:
    """대조 — 같은 무게면 둘을 지키려 먼 한 곳을 버린다(DEV 에서 본 그대로). 위 단언이 공허하지 않다."""
    problem, index, far, near = _case(priority=False)
    out, _ = _or(problem, index)
    assert far not in _placed(out) and set(near) <= _placed(out)


def test_priority_visit_wins_in_or_tools() -> None:
    problem, index, far, _ = _case(priority=True)
    out, _ = _or(problem, index)
    assert far in _placed(out)
    assert check_all(out, problem, index, _EST) == []


def test_priority_visit_wins_in_the_fallback_too() -> None:
    """OR 이 실패해 폴백으로 내려가도 같은 입력에서 같은 곳이 들어간다(두 경로 같은 의미)."""
    problem, index, far, _ = _case(priority=True)
    out = RuleFallbackAssembler(index, _EST, _CFG).solve(problem)
    assert far in _placed(out)
    assert check_all(out, problem, index, _EST) == []


def test_two_conflicting_priority_visits_drop_one_not_the_day() -> None:
    """우선 방문 둘이 서로 양립 불가여도 해가 나온다 — 하나만 빠진다(소프트 지배, 종전 동작)."""
    problem, index, far, _ = _case(priority=True)
    other = PoiId("p3")
    index = {**index, other: replace(index[other], coord=GeoPoint(_ANCHOR.lat - 0.18, _ANCHOR.lng))}
    problem = replace(problem, required_visits=problem.required_visits + (
        RequiredVisit(poi_id=other, day=_DAY, dwell_min=60, reason="nl_request", priority=True),))
    out, _ = _or(problem, index)
    assert out is not None and out.days
    assert len({far, other} & _placed(out)) == 1


def test_priority_round_trips_and_old_payload_reads() -> None:
    rv = RequiredVisit(poi_id=PoiId("x"), day=_DAY, dwell_min=None, reason="nl_request", priority=True)
    assert RequiredVisit.from_dict(rv.to_dict()) == rv
    legacy = rv.to_dict()
    del legacy["priority"]
    assert RequiredVisit.from_dict(legacy).priority is False


def test_priority_holds_when_the_place_is_not_a_candidate() -> None:
    """반경 밖에서 이름으로 집은 곳은 **후보 목록에 없다** — 조립이 필수 방문 노드를 새로 만든다.
    그 갈래에서도 우선 가중이 실려야 한다(처음엔 후보에 있는 갈래만 덮여 역검증에서 드러났다)."""
    problem, index, far, _ = _case(priority=True)
    problem = replace(problem, candidates=tuple(c for c in problem.candidates if c.poi_id != far))
    out, _ = _or(problem, index)
    assert far in _placed(out)
