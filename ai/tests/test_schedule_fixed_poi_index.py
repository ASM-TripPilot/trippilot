"""고정 블록 POI 가 후보 풀 밖이어도 이동이 검증된다 (TRIP-1177).

필수방문·잠금 블록 POI 가 풀(반경 10km, 다일 7km + 필터) 밖이면 `poi_index` 에 없었다.
그러면 OR 은 즉시 해 없음, 폴백 그리디는 그 블록 다음 이동을 0분으로 놓고, 체인 검증
(`check_hc2`)은 모르는 POI 를 건너뛰어 위반 0 — **검증 안 된 시각이 화면에 나갔다**
(INV-2, 로컬 R6: 롯데월드타워 09:00–10:00 → 13.2km 떨어진 곳 10:00).

증명하는 것 (실 조립 `build_orchestrator` + fake 어댑터, 실 API 0):
  ① 풀 밖 고정 블록(09:00 · 11:00 · 2일)도 OR 이 풀고, 응답을 validate 에 되먹이면
     위반 0 — validate 는 POI 를 DB 에서 찾으므로 여기서는 참값 검증이다
  ② 미등록 id 는 문제에서 빠지고 unplaced(NO_FEASIBLE_SLOT)로 보고된다 — 0분 배치 아님
  ③ 조회 실패(포트 예외·시한 소진)는 강등으로 남는다 (침묵 금지)
  ④ replan 잠금 블록이 풀 밖이어도 이동이 검증된다
  ⑤ 체인 내부 검증은 좌표 미상 인접 쌍을 위반으로 본다 — 공용 validate 는 그대로
  ⑥ 폴백 그리디는 좌표 미상 슬롯 뒤에 0분 이동으로 붙이지 않는다
"""

from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from trippilot.api.app import create_app
from trippilot.api.wiring import build_orchestrator
from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.facade import AssemblyConflictError, HybridAssemblyFacade
from trippilot.assembly_engine.fallback_assembler import RuleFallbackAssembler
from trippilot.assembly_engine.travel import TravelEstimator
from trippilot.domain.common import GeoPoint, PoiId, ScheduleId, TransportMode
from trippilot.domain.itinerary import (
    DaySolution,
    FixedBlock,
    ItinerarySolution,
    SolveMode,
    TimeWindow,
    VisitSlot,
)
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource

from tests.fakes.fake_clock import FakeClock
from tests.fakes.fake_llm import FailingLlm
from tests.fakes.in_memory_poi import InMemoryPoi
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.test_e2e_boundary import _C1CFG, _PersonaStore

_KST = timezone(timedelta(hours=9))
_D1 = date(2026, 10, 25)
_D2 = date(2026, 10, 26)
_ANCHOR = GeoPoint(37.5665, 126.9780)  # 서울 시청 부근
_EST = TravelEstimator(AssemblyConfig())


def _poi(pid: str, lat: float, lng: float,
         category: PoiCategory = PoiCategory.SIGHT) -> Poi:
    return Poi(
        poi_id=PoiId(pid), name=pid, category=category,
        coord=GeoPoint(lat, lng),
        open_hours=(),  # 정보 없음 → HC1 미적용 (이 파일은 HC2 만 본다)
        avg_cost=None, rating=4.0, quality=DataQuality.FULL,
        source=PoiSource.SEED, confidence=None,
    )


# 풀 안: 앵커 3km 이내 6곳. 풀 밖: 롯데월드타워 좌표(앵커에서 약 12.6km > 반경 10km).
_NEAR = tuple(
    _poi(f"n{i}", _ANCHOR.lat + 0.004 * i, _ANCHOR.lng + 0.003 * (i % 3),
         PoiCategory.FOOD if i % 3 == 0 else PoiCategory.SIGHT)
    for i in range(1, 7)
)
_FAR = _poi("far-lotte", 37.5126, 127.1025)
_ALL = _NEAR + (_FAR,)
_COORD = {str(p.poi_id): p.coord for p in _ALL}
_GHOST = "ghost-unregistered"


class _RaisingLookup(InMemoryPoi):
    """풀 조회는 되고 id 조회만 죽는 DB — 고정 블록 조회 실패 경로."""

    def lookup_by_ids(self, ids):  # noqa: ANN001
        raise TimeoutError("poi lookup timed out")


def _client(poi_db: InMemoryPoi | None = None) -> TestClient:
    orchestrator = build_orchestrator(
        llm=FailingLlm(),  # 규칙 점수 — 이 파일은 점수가 아니라 이동 검증을 본다
        poi_db=poi_db if poi_db is not None else InMemoryPoi(_ALL),
        context_store=_PersonaStore(),
        c1_config=_C1CFG,
        clock=FakeClock(),
        trace=InMemoryTrace(),
    )
    return TestClient(create_app(orchestrator), raise_server_exceptions=False)


def _request(days: tuple[date, ...], blocks: list[dict]) -> dict:
    return {
        "trip_id": "trip-1177",
        "generation_mode": "FULLY_AI",
        "trip_context": {
            "destinations": ["서울"],
            "start_date": min(days).isoformat(),
            "end_date": max(days).isoformat(),
            "companion_type": "혼자",
            "budget_level": "중간",
        },
        "anchors": [{"date": d.isoformat(), "lat": _ANCHOR.lat, "lng": _ANCHOR.lng}
                    for d in days],
        "time_windows": [{"date": d.isoformat(), "start": "09:00", "end": "21:00"}
                         for d in days],
        "fixed_blocks": blocks,
        "preference_profile": {
            "styles": ["자연"], "activities": [], "food_tastes": [],
            "transport_modes": ["대중교통"], "pace": "균형있게",
            "companion_types": ["혼자"], "pet_friendly": False, "budget_tier": "중간",
        },
        "recommendation_strength": None,
        "request_meta": {"request_id": "req-1177",
                         "requested_at": "2026-10-25T08:00:00+09:00",
                         "deadline_ms": 20_000},
        "excluded_poi_ids": [],
    }


def _block(pid: str, d: date, start: str) -> dict:
    return {"poi_id": pid, "date": d.isoformat(), "start": start, "dwell_min": 60}


def _minutes(hhmmss: str) -> int:
    h, m, _ = hhmmss.split(":")
    return int(h) * 60 + int(m)


def _travel_gaps_ok(days: list[dict]) -> list[str]:
    """인접 슬롯마다 간격 ≥ 이동(버퍼 포함) — 전체 POI 좌표로 잰 참값."""
    bad = []
    for day in days:
        slots = day["slots"]
        for prev, nxt in zip(slots, slots[1:]):
            need = _EST.estimate(_COORD[prev["poi_id"]], _COORD[nxt["poi_id"]],
                                 TransportMode.PUBLIC).internal_minutes
            gap = _minutes(nxt["start_at"]) - _minutes(prev["end_at"])
            if gap < need:
                bad.append(f"{prev['poi_id']}→{nxt['poi_id']} 필요 {need} 간격 {gap}")
    return bad


def _generate(client: TestClient, days, blocks) -> dict:
    response = client.post("/ai/v1/itinerary/generate", json=_request(days, blocks))
    assert response.status_code == 200, response.text
    return response.json()


# ── ① 풀 밖 고정 블록 — OR 이 풀고 참값 위반 0 ──────────────────────────


@pytest.mark.parametrize(("days", "start"), [
    ((_D1,), "09:00"),       # S1 — R6형 (ANYTIME 을 BE 가 09:00 으로 핀)
    ((_D1,), "11:00"),       # S2 — 시각 지정
    ((_D1, _D2), "09:00"),   # S7 — 2일(반경 ×0.7)
])
def test_풀_밖_고정_블록도_OR_이_풀고_이동이_검증된다(days, start) -> None:
    assert _FAR.poi_id not in {p.poi_id for p in InMemoryPoi(_ALL).find_by_radius(
        _ANCHOR, 10.0)}  # 전제: 정말 풀 밖이다

    with _client() as client:
        body = _generate(client, days, [_block("far-lotte", _D1, start)])
        assert body["solve_mode"] == "OR_TOOLS", body["degradations"]
        assert body["unplaced_must_visits"] == []
        fixed = [s for s in body["days"][0]["slots"] if s["poi_id"] == "far-lotte"]
        assert fixed and fixed[0]["start_at"] == f"{start}:00" and fixed[0]["is_fixed"]
        # 고정 블록 옆에 실제로 무언가가 놓였다 — 빈 날이면 이동 검증이 무의미하다
        assert len(body["days"][0]["slots"]) >= 2
        assert _travel_gaps_ok(body["days"]) == []
        # validate 는 DB 에서 POI 를 찾는다 — 되먹여 위반 0 이면 화면 시각이 참이다
        revalidated = client.post("/ai/v1/itinerary/validate", json={
            "itinerary": body, "request_meta": _request(days, [])["request_meta"]})
        assert revalidated.json() == {"violations": [], "unverified_slots": []}


# ── ② 미등록 id — 빼고 보고한다 ─────────────────────────────────────────


def test_미등록_고정_블록은_빠지고_미배치로_보고된다() -> None:
    with _client() as client:
        body = _generate(client, (_D1,), [_block(_GHOST, _D1, "09:00")])

    placed = [s["poi_id"] for d in body["days"] for s in d["slots"]]
    assert _GHOST not in placed  # 좌표 모르는 곳을 0분 이동으로 끼우지 않는다
    assert placed  # 나머지 일정은 나간다
    assert body["unplaced_must_visits"] == [
        {"poi_id": _GHOST, "reason_code": "NO_FEASIBLE_SLOT"}]
    assert "fixed_poi:fixed_poi_unresolved" in body["degradations"]
    assert body["solve_mode"] == "OR_TOOLS"


# ── ③ 조회 실패 — 강등으로 남는다 ───────────────────────────────────────


def test_고정_블록_조회가_죽으면_강등을_남기고_블록을_보고한다() -> None:
    with _client(_RaisingLookup(_ALL)) as client:
        body = _generate(client, (_D1,), [_block("far-lotte", _D1, "09:00")])

    assert "fixed_poi:fixed_poi_lookup_error" in body["degradations"]
    assert body["unplaced_must_visits"] == [
        {"poi_id": "far-lotte", "reason_code": "NO_FEASIBLE_SLOT"}]
    assert _travel_gaps_ok(body["days"]) == []


def _run_agent(clock: FakeClock, poi_db: InMemoryPoi):
    """실 ScheduleAgent + 기록 퍼사드 — C2 에 넘어간 문제를 본다. (outcome, sink, pool)."""
    from trippilot.agents.schedule.agent import ScheduleAgent, ScheduleTask
    from trippilot.agents.schedule.budget import OrchestratorConfig, allocate
    from trippilot.agents.schedule.outcome import candidates_report
    from trippilot.llm_gateway.gates.scoring import ClosedSetGate
    from trippilot.llm_gateway.gateway import GatewayFacade
    from trippilot.llm_gateway.workers.preference import PreferenceScoringWorker
    from tests.test_schedule_agent import _pool
    from tests.test_schedule_coordinator import (
        _DAY1, _KST as KST, _NOW, _TRACE_ID, _AssemblyProvider, _Renderer, _Sink,
        _request as req,
    )

    trace, sink = InMemoryTrace(), _Sink()
    agent = ScheduleAgent(
        PreferenceScoringWorker(GatewayFacade(
            FailingLlm(), _Renderer(), ClosedSetGate(), _C1CFG, trace)),
        _AssemblyProvider(trace, sink, primary=True),
        clock,
        trace,
        poi_db=poi_db,
    )
    start = datetime(_DAY1.year, _DAY1.month, _DAY1.day, 9, 0, tzinfo=KST)
    request = req(fixed_blocks=(FixedBlock(
        PoiId("far-lotte"), TimeWindow(start, start + timedelta(hours=1)), "must_visit"),))
    pool = _pool()
    outcome = agent.run(ScheduleTask(
        request=request, pool=pool, persona=None, daily_rain=None, event_bonus=None,
        candidates_summary=candidates_report(pool, days=1, persona=None),
        budget=allocate(20_000, OrchestratorConfig()), started_ms=0,
        trace_id=_TRACE_ID, now=_NOW,
    ))
    return outcome, sink, pool


class _SpyPoi(InMemoryPoi):
    """id 조회를 기록하고, 원하면 조회 동안 시계를 태운다."""

    def __init__(self, pois, clock: FakeClock | None = None, burn_ms: int = 0) -> None:
        super().__init__(pois)
        self.calls: list = []
        self._clock, self._burn = clock, burn_ms

    def lookup_by_ids(self, ids):  # noqa: ANN001
        self.calls.append(ids)
        if self._clock is not None:
            self._clock.advance(self._burn)
        return super().lookup_by_ids(ids)


def test_시한이_없으면_조회하지_않고_강등을_남긴다() -> None:
    spy = _SpyPoi(_ALL)
    # 20s 중 19s 경과 — 남은 1s 는 어셈블리 바닥 몫
    outcome, sink, _ = _run_agent(FakeClock(start_ms=19_000), spy)

    assert spy.calls == []  # 어셈블리 바닥을 침범해 묻지 않는다
    assert any(d.stage == "fixed_poi" and d.reason.startswith("deadline")
               for d in outcome.degradations)
    assert outcome.solution is not None
    assert sink.problems[0].fixed_blocks == ()  # 모르는 블록을 0분 이동으로 끼우지 않는다


def test_조회한_고정_POI_는_인덱스에만_들고_후보가_되지_않는다() -> None:
    """INV-1 — 합류는 `poi_index` 뿐이다. 풀·후보에 넣으면 점수 대상이 되어 일정 순서가
    바뀐다(리뷰 변이: 후보에 합류시켜도 기존 테스트가 전부 통과했다)."""
    spy = _SpyPoi(_ALL)
    outcome, sink, pool = _run_agent(FakeClock(), spy)

    assert spy.calls  # 실제로 조회했다
    problem = sink.problems[0]
    assert [b.poi_id for b in problem.fixed_blocks] == [PoiId("far-lotte")]
    candidate_ids = {c.poi_id for c in problem.candidates}
    assert PoiId("far-lotte") not in candidate_ids
    assert candidate_ids <= pool.poi_ids  # 후보는 풀에서 나온 것만
    assert outcome.solution is not None
    assert any(s.poi_id == PoiId("far-lotte")
               for d in outcome.solution.days for s in d.slots)


def test_조회가_남은_시한을_넘기면_결과는_쓰되_초과를_남긴다() -> None:
    """포트는 시한을 받지 않는다 — 넘긴 사실을 관측으로 남긴다(침묵 금지, INV-4).
    찾은 값은 정본에서 온 참값이라 버리지 않는다(버리면 필수방문이 빠진다)."""
    clock = FakeClock()
    spy = _SpyPoi(_ALL, clock=clock, burn_ms=19_900)
    outcome, sink, _ = _run_agent(clock, spy)

    assert any(d.stage == "fixed_poi" and d.reason.startswith("overrun")
               for d in outcome.degradations), outcome.degradations
    assert [b.poi_id for b in sink.problems[0].fixed_blocks] == [PoiId("far-lotte")]


# ── ④ replan 잠금 블록이 풀 밖 ──────────────────────────────────────────


def test_replan_풀_밖_잠금_블록도_이동이_검증된다() -> None:
    from tests.test_api_replan_wired import _DIRECTIVES, _post
    from trippilot.api.wiring import build_dev_app, demo_poi_seed

    seed = {str(p.poi_id): p for p in demo_poi_seed()}
    far = next(p for p in seed.values() if p.name == "성산일출봉")  # 데모 반경 밖

    response = _post(build_dev_app(directives=_DIRECTIVES), locked_blocks=[{
        "poi_id": str(far.poi_id), "date": "2026-09-21", "start": "12:00",
        "dwell_min": 60}])

    assert response.status_code == 200, response.text
    body = response.json()
    slots = body["itinerary"]["days"][0]["slots"]
    locked = [s for s in slots if s["poi_id"] == str(far.poi_id)]
    assert locked and locked[0]["start_at"] == "12:00:00", body["notes"]
    # 잠금 블록만 덩그러니가 아니라 OR 이 둘레를 채웠다 — 빈 날이면 이동 검증이 무의미하다
    assert len(slots) >= 2, body["notes"]
    assert not any(n.startswith("assembly_degraded") for n in body["notes"]), body["notes"]
    for prev, nxt in zip(slots, slots[1:]):
        need = _EST.estimate(seed[prev["poi_id"]].coord, seed[nxt["poi_id"]].coord,
                             TransportMode.PUBLIC).internal_minutes
        gap = _minutes(nxt["start_at"]) - _minutes(prev["end_at"])
        assert gap >= need, (prev["poi_id"], nxt["poi_id"], need, gap)


class _RaisingStatic:
    """데모 시드 DB 인데 id 조회만 죽는다 — replan 잠금 블록 조회 실패 경로."""

    def __new__(cls, seed):  # noqa: ANN001, ANN204
        from trippilot.api.wiring import StaticPoiDb

        class _Db(StaticPoiDb):
            def lookup_by_ids(self, ids):  # noqa: ANN001
                raise TimeoutError("poi lookup timed out")
        return _Db(seed)


@pytest.mark.parametrize("case", ["unregistered", "lookup_error"])
def test_replan_잠금_블록을_못_찾으면_잠금_빠진_일정을_내지_않는다(case) -> None:
    """잠금은 '못 건드리는 것' — 조회 miss 로 블록을 뺀 일정이 empty_reason 없이 나가면
    BE 는 잠금이 사라진 하루를 깨끗한 결과로 읽는다. IO-7 대로 itinerary=null + 사유
    (`_replan_fixed_blocks` 가 시각 없는 고정을 422 로 막는 것과 같은 이유, INV-4)."""
    from tests.test_api_replan_wired import _DIRECTIVES, _post
    from trippilot.api.wiring import build_dev_app, demo_poi_seed

    seed = demo_poi_seed()
    far = next(p for p in seed if p.name == "성산일출봉")
    if case == "unregistered":
        app, pid = build_dev_app(directives=_DIRECTIVES), "ghost-lock"
    else:
        app, pid = build_dev_app(directives=_DIRECTIVES,
                                 poi_db=_RaisingStatic(seed)), str(far.poi_id)

    response = _post(app, locked_blocks=[{
        "poi_id": pid, "date": "2026-09-21", "start": "12:00", "dwell_min": 60}])

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["itinerary"] is None, body["notes"]
    assert body["empty_reason"]["code"] == "NO_FEASIBLE_SLOT"
    assert body["is_fallback"] is True
    assert any(n.startswith("locked_block_unplaced:") and pid in n
               for n in body["notes"]), body["notes"]


# ── ④′ 풀 밖 고정 POI 에도 HC1 이 걸린다 — 풀 안과 같은 규칙 ─────────────


@pytest.mark.parametrize("pid", ["far-lotte", "n1"])
def test_영업시간_밖에_핀된_고정_블록은_풀_안팎_모두_409(pid) -> None:
    """합류로 인덱스에 들어오면 HC1 도 본다. 풀 안 고정 블록(S6 남산케이블카)은 이미
    409 였다 — 풀 밖만 영업시간을 지우면 반경에 따라 규칙이 갈린다. 핀 시각을 개장
    이후로 미는 것은 BE 핀 수정 몫이다(mv_probe 'S')."""
    from trippilot.domain.poi import OpenHour

    hours = tuple(OpenHour(d, 10 * 60, 22 * 60) for d in range(7))
    pois = tuple(replace(p, open_hours=hours) if str(p.poi_id) == pid else p
                 for p in _ALL)
    with _client(InMemoryPoi(pois)) as client:
        response = client.post("/ai/v1/itinerary/generate",
                               json=_request((_D1,), [_block(pid, _D1, "09:00")]))

    assert response.status_code == 409, response.text
    assert response.json()["error_code"] == "ASSEMBLY_CONFLICT"


# ── ⑤ 체인 내부 검증 — 좌표 미상 인접 쌍은 위반 ───────────────────────


def _leaky_solution() -> ItinerarySolution:
    """좌표 미상 고정 블록 바로 뒤에 0분 이동으로 붙은 해 — 종전 누수 모양."""
    s = datetime(_D1.year, _D1.month, _D1.day, 9, 0, tzinfo=_KST)
    slots = (
        VisitSlot(PoiId(_GHOST), s, s + timedelta(hours=1), 60, 0.0, False),
        VisitSlot(_NEAR[0].poi_id, s + timedelta(hours=1), s + timedelta(hours=2),
                  60, 0.5, False),
    )
    return ItinerarySolution(
        schedule_id=ScheduleId("s"), days=(DaySolution(_D1, slots, ()),),
        is_fallback=False, solve_mode=SolveMode.OR_TOOLS, assembly_run=None,
    )


class _LeakyStage:
    name = "leaky"
    required_ms = 0

    def solve(self, problem, remaining_ms):  # noqa: ANN001
        return _leaky_solution()


def _problem():
    from trippilot.domain.itinerary import ItineraryProblem
    from trippilot.domain.common import BudgetLevel

    s = datetime(_D1.year, _D1.month, _D1.day, 9, 0, tzinfo=_KST)
    return ItineraryProblem(
        schedule_id=ScheduleId("s"), days=(_D1,), candidates=(),
        fixed_blocks=(FixedBlock(PoiId(_GHOST), TimeWindow(s, s + timedelta(hours=1)),
                                 "must_visit"),),
        budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=TimeWindow(s, s.replace(hour=21)), seed=7, anchor=_ANCHOR,
    )


def _facade(stages) -> HybridAssemblyFacade:
    index = {p.poi_id: p for p in _NEAR}
    return HybridAssemblyFacade(stages, index, _EST, FakeClock(), InMemoryTrace())


def test_체인은_좌표_미상_인접_쌍을_위반으로_본다() -> None:
    with pytest.raises(AssemblyConflictError):
        _facade([_LeakyStage()]).solve(_problem(), 10_000)


def test_공용_validate_는_정보_없음을_막지_않는다() -> None:
    """validate·repair·edit 의 규칙(이미 저장된 일정 재검증)은 그대로다."""
    assert _facade([]).validate(_leaky_solution(), _problem(), 10_000) == []


# ── ⑥ 폴백 그리디 — 좌표 미상 뒤에 0분 이동으로 붙이지 않는다 ─────────────


def test_그리디는_좌표_미상_슬롯_뒤에_붙이지_않는다() -> None:
    from trippilot.domain.llm import ScoredPoi

    problem = replace(_problem(), candidates=tuple(
        ScoredPoi(p.poi_id, 0.5, False) for p in _NEAR))
    index = {p.poi_id: p for p in _NEAR}
    solution = RuleFallbackAssembler(index, _EST, AssemblyConfig()).solve(problem)

    slots = solution.days[0].slots
    assert slots[0].poi_id == PoiId(_GHOST)
    assert len(slots) == 1  # 이동을 모르는 뒤에는 아무것도 놓지 않는다
    # 그 결과는 체인 검증을 통과한다 — 409 가 아니라 고정 블록만 남은 강등 해
    assert _facade([RuleFallbackAssembler(index, _EST, AssemblyConfig())]).solve(
        problem, 10_000).days[0].slots == slots
