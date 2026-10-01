"""조립 뒤 화면 거리 — 남은 시한 안에서만 실경로, 못 끝난 구간만 직선 추정 (TRIP-1179).

가짜 느린 TravelPort 만 쓴다 — 외부 호출 0 (CI 게이트, D37). 늦은 구간은 실 sleep 대신
이벤트로 막는다(플레이크 방지). 막힌 스레드는 각 테스트가 끝날 때 풀어 준다.

증명하는 것:
  ① 예산 안에 끝난 구간은 실경로 값, 못 끝난 구간만 TravelEstimator 추정값
  ② 예산 0 → 포트 호출 0·전량 추정
  ③ 병렬이 순차보다 빠르다 (16구간 × 100ms, n=8 → 순차의 절반 미만)
  ④ 시한 미전송(600,000)에서도 1.5s 상한
  ⑤ 벤더 실패(예외·체인 폴백 is_estimated)는 vendor, 시한 초과는 budget 으로 따로 센다
  ⑥ 1차 패스(LegRecorder)는 외부 호출 0·중복 제거, 2차 패스가 실 `_distance_ranges` 로 렌더
  ⑦ (속성) 임의 지연·예산에서 measured+vendor+budget == total, 추정값 == TravelEstimator,
     렌더 문자열에 소요시간 토큰 0 (INV-3)
"""

from __future__ import annotations

import threading
import time
from datetime import date, datetime, timedelta, timezone

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from trippilot.api.route_budget import (
    POST_ASSEMBLY_CAP_MS,
    LegRecorder,
    measure_within,
    post_assembly_budget_ms,
)
from trippilot.api.wiring import MonotonicClock, _distance_ranges, _render_distance
from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.travel import TravelEstimator
from trippilot.domain.common import GeoPoint, PoiId, ScheduleId, TransportMode
from trippilot.domain.itinerary import DaySolution, ItinerarySolution, SolveMode, VisitSlot
from trippilot.domain.travel import TravelEstimate
from trippilot.ports.travel_time_port import TravelTimeError

EST = TravelEstimator(AssemblyConfig())
CLOCK = MonotonicClock()
P = TransportMode.PUBLIC
_DURATION_TOKENS = ("분", "시간", "min", "hour")


def pt(i: int) -> GeoPoint:  # 서울 근방 서로 다른 좌표
    return GeoPoint(37.55 + i * 0.003, 126.97 + i * 0.002)


def legs(n: int) -> list[tuple[GeoPoint, GeoPoint, TransportMode]]:
    return [(pt(i), pt(i + 1), P) for i in range(n)]


class FakeRoute:
    """TravelPort 모양 가짜 — 구간별로 막힘·지연·벤더 폴백·예외를 고른다."""

    def __init__(self, slow=frozenset(), delay_s=0.0, fail=frozenset(), raise_=frozenset()):
        self.slow, self.delay_s, self.fail, self.raise_ = slow, delay_s, fail, raise_
        self.release = threading.Event()
        self.calls = 0
        self._lock = threading.Lock()

    def estimate(self, a, b, mode):
        with self._lock:
            self.calls += 1
        leg = (a, b, mode)
        if leg in self.slow:
            self.release.wait(5)
        if self.delay_s:
            time.sleep(self.delay_s)
        if leg in self.raise_:
            raise TravelTimeError("HTTP 403")
        if leg in self.fail:
            return EST.estimate(a, b, mode)   # 체인 어댑터의 벤더 실패 폴백과 같은 모양
        return TravelEstimate((1.0, 1.0), 0, is_estimated=False, source="fake_route")


# ── ① ② 예산 ─────────────────────────────────────────────────────────


def test_only_over_budget_legs_are_estimated() -> None:
    ls = legs(6)
    port = FakeRoute(slow=frozenset(ls[3:5]))
    try:
        table, rep = measure_within(ls, port, EST, budget_ms=300, clock=CLOCK)
    finally:
        port.release.set()
    assert (rep.measured, rep.budget_estimated, rep.vendor_estimated) == (4, 2, 0)
    for leg in ls[3:5]:
        assert table.estimate(*leg) == EST.estimate(*leg)   # 추정은 결정론 값
        assert table.estimate(*leg).is_estimated            # → "… 추정" 라벨
    assert table.estimate(*ls[0]).distance_km_range == (1.0, 1.0)
    assert not table.estimate(*ls[0]).is_estimated


def test_zero_budget_means_zero_calls_all_estimated() -> None:
    ls = legs(5)
    port = FakeRoute()
    table, rep = measure_within(ls, port, EST, budget_ms=0, clock=CLOCK)
    assert port.calls == 0
    assert (rep.total, rep.budget_estimated) == (5, 5)
    assert all(table.estimate(*leg) == EST.estimate(*leg) for leg in ls)


def test_budget_respects_remaining_and_margin() -> None:
    assert post_assembly_budget_ms(15_000, 14_900) == 0     # 시한 소진 → 호출 0
    assert post_assembly_budget_ms(15_000, 14_000) == 700   # 1000 − 여유 300
    assert post_assembly_budget_ms(15_000, 20_000) == 0     # 이미 넘김 → 음수 아님


# ── ③ 병렬 ───────────────────────────────────────────────────────────


def test_parallel_beats_sequential() -> None:
    ls = legs(16)
    port = FakeRoute(delay_s=0.1)
    t = time.perf_counter()
    _, rep = measure_within(ls, port, EST, budget_ms=1_500, clock=CLOCK, workers=8)
    wall = time.perf_counter() - t
    assert rep.measured == 16
    assert wall < 16 * 0.1 / 2          # 순차 1.6s 의 절반 미만 (이론 0.2s)


# ── ④ 시한 미전송 상한 ────────────────────────────────────────────────


def test_unsent_deadline_is_still_capped() -> None:
    budget = post_assembly_budget_ms(600_000, 3_100)
    assert budget == POST_ASSEMBLY_CAP_MS == 1_500
    ls = legs(4)
    port = FakeRoute(slow=frozenset(ls))
    t = time.perf_counter()
    try:
        _, rep = measure_within(ls, port, EST, budget_ms=budget, clock=CLOCK)
    finally:
        port.release.set()
    assert time.perf_counter() - t < POST_ASSEMBLY_CAP_MS / 1000 + 0.3
    assert rep.budget_estimated == 4


# ── ⑤ 벤더 실패와 시한 초과를 따로 센다 ────────────────────────────────


def test_vendor_failure_counted_separately_from_budget() -> None:
    ls = legs(4)
    port = FakeRoute(fail=frozenset(ls[:1]), raise_=frozenset(ls[1:2]), slow=frozenset(ls[3:]))
    try:
        table, rep = measure_within(ls, port, EST, budget_ms=300, clock=CLOCK)
    finally:
        port.release.set()
    # 체인 폴백(is_estimated)·포트 예외 = vendor, 막힌 구간 = budget
    assert (rep.measured, rep.vendor_estimated, rep.budget_estimated) == (1, 2, 1)
    assert table.estimate(*ls[1]) == EST.estimate(*ls[1])   # 예외 구간도 추정으로 채운다


# ── ⑥ 두 패스 ────────────────────────────────────────────────────────


def test_recorder_dedupes_and_calls_nothing_external() -> None:
    rec = LegRecorder(EST)
    a, b = pt(0), pt(1)
    assert rec.estimate(a, b, P) == EST.estimate(a, b, P)
    rec.estimate(a, b, P)
    rec.estimate(b, a, P)
    assert list(rec.legs) == [(a, b, P), (b, a, P)]


def _solution_abc() -> ItinerarySolution:
    kst = timezone(timedelta(hours=9))

    def slot(pid: str, hh: int) -> VisitSlot:
        s = datetime(2026, 10, 10, hh, 0, tzinfo=kst)
        return VisitSlot(poi_id=PoiId(pid), start_at=s, end_at=s + timedelta(hours=1),
                         stay_min=60, score=0.0, is_llm_score=False)

    return ItinerarySolution(
        schedule_id=ScheduleId("s"),
        days=(DaySolution(date=date(2026, 10, 10),
                          slots=(slot("a", 10), slot("b", 12), slot("c", 14)),
                          fixed_blocks=()),),
        is_fallback=False, solve_mode=SolveMode.OR_TOOLS, assembly_run=None)


def test_two_pass_render_measures_some_and_estimates_rest() -> None:
    """실 `_distance_ranges` 를 그대로 두 번 부른다 — 순회 복제 없음. 한 구간만 늦다."""
    sol = _solution_abc()
    coords = {PoiId("a"): pt(1), PoiId("b"): pt(2), PoiId("c"): pt(3)}
    anchors = {date(2026, 10, 10): pt(0)}
    rec = LegRecorder(EST)
    _distance_ranges(sol, anchors, coords, rec, P)                  # 1차: 받아 적기
    assert len(rec.legs) == 3
    port = FakeRoute(slow=frozenset({(pt(2), pt(3), P)}))
    try:
        table, rep = measure_within(rec.legs, port, EST, budget_ms=300, clock=CLOCK)
    finally:
        port.release.set()
    out = _distance_ranges(sol, anchors, coords, table, P)          # 2차: 렌더
    assert out["2026-10-10#a"] == "약 1.0km · 대중교통"            # 실측 — '추정' 없음
    assert out["2026-10-10#c"].endswith("대중교통 추정")            # 시한 초과 구간만 추정
    assert rep.budget_estimated == 1
    for v in out.values():
        assert not any(tok in v for tok in _DURATION_TOKENS)        # INV-3


# ── ⑦ 속성 ───────────────────────────────────────────────────────────

_BEHAVIOURS = st.sampled_from(("fast", "slow", "vendor", "raise"))


@settings(max_examples=40, deadline=None,
          suppress_health_check=[HealthCheck.too_slow])
@given(behaviours=st.lists(_BEHAVIOURS, min_size=0, max_size=10),
       budget_ms=st.one_of(st.just(0), st.integers(min_value=1, max_value=60)))
def test_property_counts_partition_and_estimates_are_deterministic(
    behaviours: list[str], budget_ms: int,
) -> None:
    ls = legs(len(behaviours))
    by = {b: frozenset(leg for leg, x in zip(ls, behaviours) if x == b)
          for b in ("slow", "vendor", "raise")}
    port = FakeRoute(slow=by["slow"], fail=by["vendor"], raise_=by["raise"])
    try:
        table, rep = measure_within(ls, port, EST, budget_ms=budget_ms, clock=CLOCK)
    finally:
        port.release.set()

    assert rep.measured + rep.vendor_estimated + rep.budget_estimated == rep.total == len(ls)
    assert rep.estimated == rep.vendor_estimated + rep.budget_estimated
    if budget_ms == 0:
        assert port.calls == 0 and rep.budget_estimated == len(ls)
    for leg in by["slow"]:                     # 막힌 구간은 절대 실측으로 안 나간다
        assert table.estimate(*leg) == EST.estimate(*leg)
    for leg in ls:
        got = table.estimate(*leg)
        if got.is_estimated:                   # 추정은 언제나 TravelEstimator 값 그대로
            assert got == EST.estimate(*leg)
        rendered = _render_distance(got, P)
        assert not any(tok in rendered for tok in _DURATION_TOKENS)   # INV-3
