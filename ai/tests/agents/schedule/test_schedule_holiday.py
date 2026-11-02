"""ScheduleAgent — 공휴일 휴무 (상황 감지 H1 · BR-SA-17). 요청에 실린 달력이 조립·사전 판정·차선책에 같이 간다.

규칙이 둘이면 조립이 둔 핀을 검증이 거부한다 — 에이전트의 사전 판정(⓪′ 핀 제외·한 곳 추가·차선책)도 조립과
같은 `open_windows_on` 을 본다.

증명하는 것:
  ① 요청 `holidays` 가 ItineraryProblem 으로 간다(None 은 None — 모드 off 무영향).
  ② 그 날 공휴일 휴무인 곳은 일정에 없다 — off 면 놓인다.
  ③ ⓪′ 공휴일 휴무 날에 핀된 고정 블록은 빼고 보고한다(`fixed_block_closed`) — 409 로 하루를 잃지 않는다.
  ④ 한 곳 추가 — 공휴일 휴무인 카페(동점 1위)를 고르지 않고 연 카페를 고른다.
  ⑤ 슬롯 차선책 — 그 날 공휴일 휴무인 곳은 내지 않는다.
"""

from __future__ import annotations

import json
from dataclasses import replace
from datetime import datetime, timedelta

from trippilot.agents.schedule.agent import ScheduleAgent, ScheduleTask, pick_slot_alternatives
from trippilot.agents.schedule.budget import OrchestratorConfig, allocate
from trippilot.agents.schedule.outcome import candidates_report
from trippilot.domain.common import PoiId
from trippilot.domain.itinerary import FixedBlock, TimeWindow
from trippilot.domain.llm import CandidatePool
from trippilot.domain.observability import FallbackEvent
from trippilot.domain.poi import PoiCategory
from trippilot.llm_gateway.gates.scoring import ClosedSetGate
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.workers.preference import PreferenceScoringWorker

from tests.agents.schedule.test_schedule_agent import _scored, _solution
from tests.fakes.fake_clock import FakeClock
from tests.fakes.fake_llm import FakeLlm
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.orchestrator.schedule.test_schedule_coordinator import (
    _C1CFG,
    _DAY1,
    _KST,
    _NOW,
    _PERSONA,
    _TRACE_ID,
    _AssemblyProvider,
    _Renderer,
    _Sink,
    _poi,
    _request,
)

_CAL = {_DAY1: frozenset({"PUBLIC"})}  # 2026-08-05 를 공휴일로 둔 달력


def _closed(i: int, off: float, cat: PoiCategory = PoiCategory.SIGHT):
    return replace(_poi(i, off, cat), holiday_rules=frozenset({"PUBLIC"}))


def _pool(*pois) -> CandidatePool:
    return CandidatePool(poi_ids=frozenset(p.poi_id for p in pois), pois=tuple(pois), generated_at=_NOW)


def _run(pool: CandidatePool, request):
    trace, sink = InMemoryTrace(), _Sink()
    scores = json.dumps({"scores": [{"poiId": str(p.poi_id), "score": 0.9, "reason": "r"} for p in pool.pois]})
    agent = ScheduleAgent(
        PreferenceScoringWorker(GatewayFacade(FakeLlm(scores), _Renderer(), ClosedSetGate(), _C1CFG, trace)),
        _AssemblyProvider(trace, sink, primary=False),  # 규칙 조립 — 결정론
        FakeClock(), trace,
    )
    outcome = agent.run(ScheduleTask(
        request=request, pool=pool, persona=_PERSONA, daily_rain=None, event_bonus=None,
        candidates_summary=candidates_report(pool, days=len(request.days), persona=_PERSONA),
        budget=allocate(20_000, OrchestratorConfig()), started_ms=0, trace_id=_TRACE_ID, now=_NOW,
    ))
    placed = {s.poi_id for d in (outcome.solution.days if outcome.solution else ()) for s in d.slots}
    return outcome, placed, sink, trace


def test_요청의_달력이_조립_문제로_간다() -> None:
    pool = _pool(_poi(1, 0.0), _poi(2, 0.005))
    _, _, sink, _ = _run(pool, replace(_request(), holidays=_CAL))
    assert sink.problems[-1].holidays == _CAL
    _, _, sink, _ = _run(pool, _request())
    assert sink.problems[-1].holidays is None


def test_공휴일_휴무인_곳은_놓지_않고_off_면_놓는다() -> None:
    pool = _pool(_closed(1, 0.0), _poi(2, 0.005), _poi(3, 0.010))
    _, placed, _, _ = _run(pool, replace(_request(), holidays=_CAL))
    assert PoiId("p1") not in placed and placed
    _, placed, _, _ = _run(pool, _request())
    assert PoiId("p1") in placed


def test_공휴일_휴무_날의_핀은_빼고_보고한다() -> None:
    start = datetime.combine(_DAY1, datetime.min.time(), tzinfo=_KST) + timedelta(hours=10)
    pin = FixedBlock(poi_id=PoiId("p1"), window=TimeWindow(start, start + timedelta(hours=1)), reason="user")
    pool = _pool(_closed(1, 0.0), _poi(2, 0.005), _poi(3, 0.010))
    outcome, placed, _, _ = _run(pool, replace(_request(fixed_blocks=(pin,)), holidays=_CAL))
    assert PoiId("p1") not in placed and placed  # 나머지 하루는 그대로 나간다
    assert any(d.reason.startswith("fixed_block_closed:1") for d in outcome.degradations)
    outcome, placed, _, _ = _run(pool, replace(_request(fixed_blocks=(pin,)), holidays=None))
    assert PoiId("p1") in placed  # off — 종전대로 핀이 선다


def test_한_곳_추가는_공휴일_휴무인_카페를_고르지_않는다() -> None:
    pool = _pool(_closed(1, 0.001, PoiCategory.CAFE), _poi(2, 0.002, PoiCategory.CAFE), _poi(3, 0.005))
    request = replace(_request(), add_one_categories=frozenset({PoiCategory.CAFE}))

    def picked(trace) -> str:
        [reason] = [e.reason for e in trace.of_type(FallbackEvent) if e.reason.startswith("add_one_required")]
        return reason

    _, placed, _, trace = _run(pool, replace(request, holidays=_CAL))
    assert picked(trace) == "add_one_required:1/1 p2"  # 동점 1위 p1 은 그날 공휴일 휴무
    assert PoiId("p2") in placed
    _, _, _, trace = _run(pool, request)
    assert picked(trace) == "add_one_required:1/1 p1"  # off — 종전 선택


def test_차선책은_그날_공휴일_휴무인_곳을_내지_않는다() -> None:
    here = _poi(1, 0.0, PoiCategory.CAFE)
    closed = _closed(2, 0.001, PoiCategory.CAFE)
    spare = _poi(3, 0.002, PoiCategory.CAFE)
    pool = _pool(here, closed, spare)
    scores = _scored({"p1": 0.9, "p2": 0.99, "p3": 0.5})
    key = f"{_DAY1.isoformat()}#p1"
    on = pick_slot_alternatives(_solution(_DAY1, (here.poi_id,)), scores, pool, holidays=_CAL)
    assert [a.poi_id for a in on[key]] == [PoiId("p3")]
    off = pick_slot_alternatives(_solution(_DAY1, (here.poi_id,)), scores, pool)
    assert [a.poi_id for a in off[key]] == [PoiId("p2"), PoiId("p3")]
