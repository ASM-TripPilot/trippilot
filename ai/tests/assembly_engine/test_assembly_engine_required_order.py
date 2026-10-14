"""필수 방문 순서 `ItineraryProblem.required_in_order` (BR-U4-47 — 재계획 "시간만 당기기").

로컬 실스택(2026-10-14): 순서 없이 원 일정 8곳을 필수 방문으로 주자 재정렬(B)이 거리로 순서를 섞어
저녁 식당(19:25)이 09:19 첫 방문이 됐다 — "시간만"이 아니었다. 켜면 놓인 필수 방문의 순서가 준
순서와 같다(하드). 끄면 종전과 같은 경로다(기본 False — 항·제약 없음).
"""

from __future__ import annotations

import random
from dataclasses import replace
from datetime import datetime

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from trippilot.assembly_engine.constraints import check_all
from trippilot.assembly_engine.fallback_assembler import RuleFallbackAssembler
from trippilot.domain.itinerary import FixedBlock, ItineraryProblem, RequiredVisit, TimeWindow
from trippilot.domain.common import GeoPoint
from trippilot.domain.poi import PoiCategory

from tests.assembly_engine.test_assembly_engine_travel_weight import _ANCHOR, _CFG, _DAY, _EST, _KST, _or, _pool


def _ordered(problem, index, seed: int, k: int):
    """풀에서 k 곳을 골라 무작위 순서로 필수 방문 — 거리상 나쁜 순서가 섞이게."""
    ids = list(index)
    random.Random(seed).shuffle(ids)
    visits = tuple(RequiredVisit(poi_id=p, day=_DAY, dwell_min=45, reason="earlier_retime")
                   for p in ids[:k])
    return replace(problem, required_visits=visits, max_visits_per_day=k, required_in_order=True)


def _placed_order(solution, visits) -> list:
    want = {v.poi_id for v in visits}
    return [s.poi_id for d in solution.days for s in sorted(d.slots, key=lambda s: s.start_at)
            if s.poi_id in want]


@settings(max_examples=20, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(seed=st.integers(0, 10_000), k=st.integers(2, 5))
def test_순서를_켜면_놓인_필수_방문이_준_순서대로다(seed, k) -> None:
    problem, index = _pool(random.Random(seed), 6, 18)
    on = _ordered(problem, index, seed, k)
    want = [v.poi_id for v in on.required_visits]
    for solution in (_or(on, index)[0], RuleFallbackAssembler(index, _EST, _CFG).solve(on)):
        assert solution is not None
        got = _placed_order(solution, on.required_visits)
        assert got == [p for p in want if p in got]  # 빠진 것은 있어도 순서는 안 뒤집힌다
        assert check_all(solution, on, index, _EST) == []


def test_순서를_끄면_거리로_섞일_수_있다() -> None:
    """대조 — 켜는 것이 실제로 무언가를 바꾼다(위 단언이 공허하지 않다)."""
    swapped = 0
    for seed in range(15):
        problem, index = _pool(random.Random(seed), 6, 18)
        on = _ordered(problem, index, seed, 5)
        off, _ = _or(replace(on, required_in_order=False), index)
        want = [v.poi_id for v in on.required_visits]
        got = _placed_order(off, on.required_visits)
        swapped += got != [p for p in want if p in got]
    assert swapped > 0


def test_폴백도_순서를_켜야_지킨다() -> None:
    """대조(폴백) — 끄면 식당이 점심창(11시~)을 먼저 찾아, 순서상 뒤인 명소가 그 앞 아침 틈에 들어간다."""
    problem, index = _pool(random.Random(3), 6, 18)
    food, sight = sorted(index)[:2]
    near = GeoPoint(_ANCHOR.lat + 0.002, _ANCHOR.lng)  # 앵커 옆 — 아침 틈에 넉넉히 들어가게
    index = {**index, food: replace(index[food], category=PoiCategory.FOOD, coord=near),
             sight: replace(index[sight], category=PoiCategory.SIGHT, coord=near)}
    visits = tuple(RequiredVisit(poi_id=p, day=_DAY, dwell_min=60, reason="earlier_retime")
                   for p in (food, sight))
    base = replace(problem, required_visits=visits, max_visits_per_day=2)
    fb = RuleFallbackAssembler(index, _EST, _CFG)

    assert _placed_order(fb.solve(base), visits) == [sight, food]
    on = fb.solve(replace(base, required_in_order=True))
    assert _placed_order(on, visits) == [food, sight]
    assert check_all(on, base, index, _EST) == []


def test_직렬화_왕복과_키_없는_덤프() -> None:
    problem, index = _pool(random.Random(1), 4, 15)
    on = _ordered(problem, index, 1, 2)
    assert ItineraryProblem.from_dict(on.to_dict()) == on
    old = on.to_dict()
    old.pop("required_in_order")
    assert ItineraryProblem.from_dict(old).required_in_order is False


# ── 저녁 잠금과 같이 (재계획 "시간만 당기기" + "저녁은 그대로") ─────────────────────
# 잠금 블록이 순서 밖이면 원 일정에서 저녁 **뒤**였던 방문이 저녁 **앞** 빈 시간으로 당겨졌다. 배선은 잠금을
# 원 자리에 필수 방문(자리표)으로 남긴다 — 같은 날 핀과 POI 가 같은 항목이다.


def _with_dinner(seed: int, k: int, marked: bool = True):
    """풀 6곳에서 k 곳 + 잠금 1곳(정오~16시 사이 한 시간 핀). 잠금은 순서의 무작위 자리에 든다."""
    rnd = random.Random(seed)
    problem, index = _pool(rnd, 6, 21)
    ids = list(index)
    rnd.shuffle(ids)
    pin_id, rest = ids[0], ids[1:k + 1]
    hour = rnd.randint(12, 16)
    pin = FixedBlock(poi_id=pin_id, reason="keep_dinner", window=TimeWindow(
        datetime(2026, 10, 14, hour, tzinfo=_KST), datetime(2026, 10, 14, hour + 1, tzinfo=_KST)))
    seq = list(rest)
    seq.insert(rnd.randint(0, k), pin_id)
    visits = tuple(RequiredVisit(poi_id=p, day=_DAY, dwell_min=45, reason="earlier_retime")
                   for p in seq if marked or p != pin_id)
    on = replace(problem, fixed_blocks=(pin,), required_visits=visits,
                 max_visits_per_day=k + 1, required_in_order=True)
    return on, index, seq


@settings(max_examples=25, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(seed=st.integers(0, 10_000), k=st.integers(2, 4))
def test_잠금과_같이면_잠금_포함_원_순서대로다(seed, k) -> None:
    on, index, seq = _with_dinner(seed, k)
    for solution in (_or(on, index)[0], RuleFallbackAssembler(index, _EST, _CFG).solve(on)):
        assert solution is not None
        got = [s.poi_id for d in solution.days for s in sorted(d.slots, key=lambda s: s.start_at)
               if s.poi_id in seq]
        assert got == [p for p in seq if p in got]  # 잠금 앞이던 것은 앞, 뒤이던 것은 뒤
        assert on.fixed_blocks[0].poi_id in got  # 잠금은 그대로 (HC3)
        assert len(got) == len(set(got))  # 자리표가 두 번 놓이지 않는다
        assert check_all(solution, on, index, _EST) == []


def test_잠금이_순서_밖이면_저녁_뒤_방문이_앞으로_당겨진다() -> None:
    """대조 — 자리표 없이(종전 배선) OR·폴백 모두 잠금을 건너뛰는 순서가 나온다(위 단언이 공허하지 않다)."""
    for solve in (lambda p, i: _or(p, i)[0],
                  lambda p, i: RuleFallbackAssembler(i, _EST, _CFG).solve(p)):
        swapped = 0
        for seed in range(30):
            off, index, seq = _with_dinner(seed, 3, marked=False)
            sol = solve(off, index)
            got = [s.poi_id for d in sol.days for s in sorted(d.slots, key=lambda s: s.start_at)
                   if s.poi_id in seq]
            swapped += got != [p for p in seq if p in got]
        assert swapped > 0
