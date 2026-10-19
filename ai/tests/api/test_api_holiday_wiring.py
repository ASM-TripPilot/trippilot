"""공휴일 휴무 배선 — 진입점이 달력을 요청당 1회 조회해 생성·재계획·검증·수리·편집에 같이 내린다 (상황 감지 H1).

실 조립(`build_orchestrator`·`build_dev_app`) + fake 달력, 실 API 0.

증명하는 것:
  ① generate — 그 날 공휴일 휴무인 곳은 일정에 없다(모드 off 면 놓인다). 여러 날·여러 앵커 구간이어도 달력은 1회.
  ② validate — 같은 휴일 규칙으로 HC1 "공휴일 휴무" — 조립이 둔 해와 검증이 같은 매핑을 본다. off 면 위반 없음.
  ③ repair — 휴일 휴무 슬롯은 수리하지 못한다(검증과 같은 판정).
  ④ replan — 휴무 후보는 안 놓이고, "저녁은 그대로"는 그 날 공휴일 휴무인 식당을 잠그지 않는다. 달력 1회.
  ⑤ 편집 검증의 문제 재구성도 같은 달력을 싣는다.
  ⑥ 모드 off(기본) — 달력을 한 번도 부르지 않는다.
"""

from __future__ import annotations

import pathlib
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone

import yaml
from fastapi.testclient import TestClient

from trippilot.agents.planb.directives import load_directive_file
from trippilot.api.app import create_app
from trippilot.api.wiring import DEMO_ANCHOR, StaticPoiDb, build_dev_app, build_orchestrator
from trippilot.domain.common import GeoPoint, PoiId, ScheduleId
from trippilot.domain.itinerary import DaySolution, ItinerarySolution, SolveMode, VisitSlot
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource
from trippilot.ports.holiday_calendar_port import HolidaySource

from tests.agents.schedule.test_schedule_fixed_poi_index import _ANCHOR, _request
from tests.api.test_e2e_boundary import _C1CFG, _PersonaStore
from tests.fakes.fake_clock import FakeClock
from tests.fakes.fake_llm import FailingLlm
from tests.fakes.in_memory_poi import InMemoryPoi
from tests.fakes.in_memory_trace import InMemoryTrace

_KST = timezone(timedelta(hours=9))
_D1 = date(2026, 10, 25)   # 일요일 — 이 파일의 '공휴일'
_D2 = date(2026, 10, 26)
_DIRECTIVES = load_directive_file(
    pathlib.Path(__file__).resolve().parents[2] / "data" / "replan_directives.yaml", yaml.safe_load)


class _SpyCalendar:
    def __init__(self, days: tuple[date, ...]) -> None:
        self.days = days
        self.calls: list[tuple[date, date]] = []

    def holidays_between(self, start: date, end: date):
        self.calls.append((start, end))
        return {d: frozenset({"PUBLIC"}) for d in self.days if start <= d <= end}


def _poi(pid: str, lat: float, lng: float, *, rules=frozenset(), cat=PoiCategory.SIGHT,
         hours: tuple[OpenHour, ...] = ()) -> Poi:
    return Poi(poi_id=PoiId(pid), name=pid, category=cat, coord=GeoPoint(lat, lng), open_hours=hours,
               avg_cost=None, rating=4.0, quality=DataQuality.FULL, source=PoiSource.SEED,
               confidence=None, holiday_rules=frozenset(rules))


_MUSEUM = _poi("museum", _ANCHOR.lat + 0.002, _ANCHOR.lng, rules={"PUBLIC"}, cat=PoiCategory.CULTURE)
_NEAR = (_MUSEUM, _poi("s1", _ANCHOR.lat + 0.004, _ANCHOR.lng + 0.002),
         _poi("s2", _ANCHOR.lat + 0.006, _ANCHOR.lng - 0.002))


def _orchestrator(holidays: HolidaySource | None, pois=_NEAR):
    return build_orchestrator(llm=FailingLlm(), poi_db=InMemoryPoi(pois), context_store=_PersonaStore(),
                              c1_config=_C1CFG, clock=FakeClock(), trace=InMemoryTrace(), holidays=holidays)


def _placed(days: list[dict]) -> set[str]:
    return {s["poi_id"] for d in days for s in d["slots"]}


# ── ① generate ───────────────────────────────────────────────────────


def test_generate_는_공휴일_휴무인_곳을_놓지_않고_달력은_1회다() -> None:
    spy = _SpyCalendar((_D1,))
    with TestClient(create_app(_orchestrator(HolidaySource(enabled=True, calendar=spy)))) as client:
        body = client.post("/ai/v1/itinerary/generate", json=_request((_D1, _D2), [])).json()
    d1 = next(d for d in body["days"] if d["date"] == _D1.isoformat())
    assert "museum" not in _placed([d1]) and _placed([d1])
    assert spy.calls == [(_D1, _D2)]  # 요청당 1회 — 여행 전 기간을 한 번에


def test_generate_모드_off_면_놓이고_달력을_부르지_않는다() -> None:
    spy = _SpyCalendar((_D1,))
    with TestClient(create_app(_orchestrator(HolidaySource(enabled=False, calendar=spy)))) as client:
        body = client.post("/ai/v1/itinerary/generate", json=_request((_D1,), [])).json()
    assert "museum" in _placed(body["days"])
    assert spy.calls == []


def test_generate_여러_앵커_구간이어도_달력은_1회다() -> None:
    spy = _SpyCalendar((_D1,))
    request = _request((_D1, _D2), [])
    request["anchors"] = [{"date": _D1.isoformat(), "lat": _ANCHOR.lat, "lng": _ANCHOR.lng},
                          {"date": _D2.isoformat(), "lat": _ANCHOR.lat + 0.01, "lng": _ANCHOR.lng}]
    with TestClient(create_app(_orchestrator(HolidaySource(enabled=True, calendar=spy)))) as client:
        assert client.post("/ai/v1/itinerary/generate", json=request).status_code == 200
    assert len(spy.calls) == 1


class _SlowCalendar(_SpyCalendar):
    """조회에 시간이 드는 달력 — 주입한 FakeClock 을 민다(실 대기 0)."""

    def __init__(self, days: tuple[date, ...], clock: FakeClock, cost_ms: int) -> None:
        super().__init__(days)
        self.clock, self.cost_ms = clock, cost_ms

    def holidays_between(self, start: date, end: date):
        self.clock.advance(self.cost_ms)
        return super().holidays_between(start, end)


class _DeadlineSpy:
    """조립 오케스트레이터가 받은 시한을 적고 그대로 넘긴다."""

    def __init__(self, inner) -> None:
        self.inner, self.deadlines = inner, []

    def generate(self, request, deadline_ms, trace_id, now):
        self.deadlines.append(deadline_ms)
        return self.inner.generate(request, deadline_ms, trace_id, now)

    def __getattr__(self, name):
        return getattr(self.inner, name)


def _timed_generate(request: dict, cost_ms: int) -> list[int]:
    clock = FakeClock()
    orch = build_orchestrator(llm=FailingLlm(), poi_db=InMemoryPoi(_NEAR), context_store=_PersonaStore(),
                              c1_config=_C1CFG, clock=clock, trace=InMemoryTrace(),
                              holidays=HolidaySource(enabled=True, calendar=_SlowCalendar((_D1,), clock, cost_ms)))
    spy = _DeadlineSpy(orch._orchestrator)
    orch._orchestrator = spy
    with TestClient(create_app(orch)) as client:
        assert client.post("/ai/v1/itinerary/generate", json=request).status_code == 200
    return spy.deadlines


def test_generate_는_달력_조회_시간도_시한에서_뺀다() -> None:
    """재계획은 시계 원점을 조회 앞에 둔다 — 생성만 뒤에 두면 특일 API 가 느릴 때(소켓 2s) 그 시간이 예산 밖에서
    더 걸려 BE read 여유(2s)를 넘긴다(리뷰 재현). 시한 20s · 조회 2s → 조립이 받는 시한 18s."""
    assert _timed_generate(_request((_D1, _D2), []), 2_000) == [18_000]


def test_generate_여러_구간의_몫도_조회_시간을_뺀_잔여로_나눈다() -> None:
    request = _request((_D1, _D2), [])
    request["anchors"] = [{"date": _D1.isoformat(), "lat": _ANCHOR.lat, "lng": _ANCHOR.lng},
                          {"date": _D2.isoformat(), "lat": _ANCHOR.lat + 0.01, "lng": _ANCHOR.lng}]
    assert _timed_generate(request, 2_000) == [9_000, 18_000]  # (20s − 2s) 의 절반, 그 뒤 남은 전부


# ── ②·③ validate · repair ───────────────────────────────────────────


def _payload(day: date, pid: str, start: str = "10:00", end: str = "11:00") -> dict:
    return {"days": [{"date": day.isoformat(), "slots": [
        {"poi_id": pid, "start_at": f"{start}:00", "end_at": f"{end}:00", "is_fixed": False}]}],
        "is_fallback": False, "solve_mode": "OR_TOOLS"}


_META = {"request_id": "h1", "requested_at": "2026-10-24T08:00:00+09:00", "deadline_ms": 5000}


def test_validate_는_같은_휴일_규칙으로_HC1() -> None:
    spy = _SpyCalendar((_D1,))
    with TestClient(create_app(_orchestrator(HolidaySource(enabled=True, calendar=spy)))) as client:
        body = client.post("/ai/v1/itinerary/validate",
                           json={"itinerary": _payload(_D1, "museum"), "request_meta": _META}).json()
    [v] = body["violations"]
    assert (v["code"], v["slot_ref"], v["detail"], v["reason_code"]) == ("HC1", "museum", "공휴일 휴무", "HOLIDAY")
    assert spy.calls == [(_D1, _D1)]
    with TestClient(create_app(_orchestrator(None))) as client:
        body = client.post("/ai/v1/itinerary/validate",
                           json={"itinerary": _payload(_D1, "museum"), "request_meta": _META}).json()
    assert body["violations"] == []


def test_repair_는_공휴일_휴무_슬롯을_수리하지_못한다() -> None:
    on = HolidaySource(enabled=True, calendar=_SpyCalendar((_D1,)))
    with TestClient(create_app(_orchestrator(on))) as client:
        body = client.post("/ai/v1/itinerary/repair", json={
            "itinerary": _payload(_D1, "museum"), "violations": [], "request_meta": _META}).json()
    assert body["repaired"] is None
    with TestClient(create_app(_orchestrator(None))) as client:
        body = client.post("/ai/v1/itinerary/repair", json={
            "itinerary": _payload(_D1, "museum"), "violations": [], "request_meta": _META}).json()
    assert body["repaired"] is not None


# ── ④ replan ─────────────────────────────────────────────────────────

_REPLAN_DAY = date(2026, 9, 21)
_RESTAURANT = _poi("dinner", DEMO_ANCHOR.lat + 0.003, DEMO_ANCHOR.lng, rules={"PUBLIC"}, cat=PoiCategory.FOOD)
_CLOSED_SIGHT = _poi("closed-sight", DEMO_ANCHOR.lat - 0.003, DEMO_ANCHOR.lng, rules={"09-21"})


def _replan(holidays: HolidaySource | None, **over):
    from tests.api.test_api_replan_wired import _body

    seed = StaticPoiDb((_RESTAURANT, _CLOSED_SIGHT,
                        _poi("open-a", DEMO_ANCHOR.lat + 0.001, DEMO_ANCHOR.lng + 0.002),
                        _poi("open-b", DEMO_ANCHOR.lat - 0.001, DEMO_ANCHOR.lng - 0.002),
                        _poi("cafe", DEMO_ANCHOR.lat + 0.002, DEMO_ANCHOR.lng - 0.001, cat=PoiCategory.CAFE)))
    app = build_dev_app(directives=_DIRECTIVES, poi_db=seed, holidays=holidays)
    with TestClient(app, raise_server_exceptions=False) as client:
        return client.post("/ai/v1/planb/replan", json=_body(**over))


def test_replan_은_공휴일_휴무_후보를_놓지_않고_달력은_1회다() -> None:
    spy = _SpyCalendar((_REPLAN_DAY,))
    response = _replan(HolidaySource(enabled=True, calendar=spy))
    assert response.status_code == 200, response.text
    body = response.json()
    placed = _placed(body["itinerary"]["days"])
    assert placed and not placed & {"dinner", "closed-sight"}, body["notes"]
    assert spy.calls == [(_REPLAN_DAY, _REPLAN_DAY)]


def test_replan_날짜_명시형은_달력이_없어도_닫는다() -> None:
    """키 미등록(달력 없음) — 빈 매핑이라 '9월 21일 휴무' 같은 날짜 명시형만 산다."""
    body = _replan(HolidaySource(enabled=True, calendar=None)).json()
    assert "closed-sight" not in _placed(body["itinerary"]["days"]), body["notes"]


def test_저녁은_그대로는_공휴일_휴무인_식당을_잠그지_않는다() -> None:
    slots = [{"poi_id": "dinner", "start_at": "18:00", "end_at": "19:00"}]
    on = _replan(HolidaySource(enabled=True, calendar=_SpyCalendar((_REPLAN_DAY,))),
                 current_slots=slots, directives=["KEEP_DINNER"]).json()
    assert "keep_dinner_skipped: dinner" in on["notes"], on["notes"]
    off = _replan(None, current_slots=slots, directives=["KEEP_DINNER"]).json()
    assert any(n.startswith("keep_dinner: ") and "dinner" in n for n in off["notes"]), off["notes"]


# ── ⑤ 편집 검증 ──────────────────────────────────────────────────────


def test_편집_검증의_문제_재구성도_같은_달력을_싣는다() -> None:
    spy = _SpyCalendar((_D1,))
    orch = _orchestrator(HolidaySource(enabled=True, calendar=spy))
    start = datetime(2026, 10, 25, 10, 0, tzinfo=_KST)
    sol = ItinerarySolution(
        schedule_id=ScheduleId("e"), days=(DaySolution(_D1, (VisitSlot(
            PoiId("museum"), start, start + timedelta(hours=1), 60, 0.0, False),), ()),),
        is_fallback=False, solve_mode=SolveMode.OR_TOOLS, assembly_run=None)
    assert orch._edit_agent._problem_for(sol).holidays == {_D1: frozenset({"PUBLIC"})}
    assert _orchestrator(None)._edit_agent._problem_for(sol).holidays is None


def test_편집_요청도_달력은_1회다() -> None:
    """경계의 일정 재구성(`_reconstruct`)이 버리는 문제에도 달력을 물어 편집 한 번에 2회였다 — 특일 API 가
    불통이면 소켓 대기도 두 번이다. 에이전트 검증이 쓰는 1회만 남는다."""
    from tests.api.test_api_edit import _HALLASAN, _PORK, _body

    spy = _SpyCalendar(())
    with TestClient(build_dev_app(holidays=HolidaySource(enabled=True, calendar=spy))) as client:
        response = client.post("/ai/v1/itinerary/edit", json=_body(command={
            "op": "MOVE_SLOT", "params": {"beforePoiId": _PORK}, "affected_slots": [_HALLASAN]}))
    assert response.json()["status"] == "APPLIED", response.text
    assert len(spy.calls) == 1
