"""공휴일 휴무 배선 — 진입점이 달력을 요청당 1회 조회해 생성·재계획·검증·수리·편집에 같이 내린다 (상황 감지 H1).

실 조립(`build_orchestrator`·`build_dev_app`) + fake 달력, 실 API 0.

증명하는 것:
  ① generate — 그 날 공휴일 휴무인 곳은 일정에 없다(모드 off 면 놓인다). 여러 날·여러 앵커 구간이어도 달력은 1회.
     달력을 못 읽으면 종전대로 빈 달력으로 짠다.
  ② validate — 같은 휴일 규칙으로 HC1 "공휴일 휴무" — 조립이 둔 해와 검증이 같은 매핑을 본다. off 면 위반 없음.
     미판정 보고(HOURS_UNKNOWN)도 같은 달력으로 가른다 — on 이면 판정한 것, off 면 영업정보가 없어 못 본 것.
     달력을 못 읽으면(실패·키 미등록) 태그형 휴일 규칙이 있는 곳은 영업 창이 있어도 못 본 것이다(G-SA-22) — 수리도 같다.
     그 미판정은 `detail` 표지(`holiday_calendar_unread`)로 원문 없음(빈 문자열)과 갈린다.
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


class _FailingCalendar(_SpyCalendar):
    """조회 실패(불통·키 오류·형식 깨짐) — 어댑터는 None 을 돌려준다."""

    def __init__(self) -> None:
        super().__init__(())

    def holidays_between(self, start: date, end: date):
        super().holidays_between(start, end)
        return None


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


def test_generate_는_달력을_못_읽어도_빈_달력으로_짠다() -> None:
    """미판정 보고는 검증 몫이다 — 생성은 종전대로 날짜 명시형 규칙만 보고 짠다(태그형 규칙이 있는 곳도 놓인다)."""
    failing = _FailingCalendar()
    with TestClient(create_app(_orchestrator(HolidaySource(enabled=True, calendar=failing)))) as client:
        body = client.post("/ai/v1/itinerary/generate", json=_request((_D1,), [])).json()
    assert "museum" in _placed(body["days"])
    assert failing.calls == [(_D1, _D1)]


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
    assert body["unverified_slots"] == []  # 휴일 규칙이 그 날을 닫았다 — 영업정보가 없어도 HC1 을 판정한 것이다
    assert spy.calls == [(_D1, _D1)]
    with TestClient(create_app(_orchestrator(None))) as client:
        body = client.post("/ai/v1/itinerary/validate",
                           json={"itinerary": _payload(_D1, "museum"), "request_meta": _META}).json()
    assert body["violations"] == []
    # 모드 off — 휴일 규칙을 보지 않으니 영업정보 없는 곳의 HC1 은 못 봤다(위반 0 을 통과로 읽지 않게, 상황 감지 INV-SA-2)
    assert body["unverified_slots"] == [{"poi_id": "museum", "reason_code": "HOURS_UNKNOWN", "detail": ""}]


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


# 주간 영업 창이 있는 두 곳 — 하나만 공휴일 휴무 규칙이 있다. 둘 다 창 안에 놓는다.
_OPEN = tuple(OpenHour(d, 540, 1080) for d in range(7))
_TAGGED = _poi("tagged", _ANCHOR.lat + 0.002, _ANCHOR.lng, rules={"PUBLIC"}, hours=_OPEN)
_PLAIN = _poi("plain", _ANCHOR.lat + 0.004, _ANCHOR.lng, hours=_OPEN)
_BOTH = {"days": [{"date": _D2.isoformat(), "slots": [
    {"poi_id": "tagged", "start_at": "10:00:00", "end_at": "11:00:00", "is_fixed": False},
    {"poi_id": "plain", "start_at": "12:00:00", "end_at": "13:00:00", "is_fixed": False}]}],
    "is_fallback": False, "solve_mode": "OR_TOOLS"}
_TAGGED_UNKNOWN = [{"poi_id": "tagged", "reason_code": "HOURS_UNKNOWN", "detail": "holiday_calendar_unread"}]


def _check_both(holidays: HolidaySource | None, path: str = "validate") -> dict:
    body = {"itinerary": _BOTH, "request_meta": _META} | ({"violations": []} if path == "repair" else {})
    with TestClient(create_app(_orchestrator(holidays, pois=(_TAGGED, _PLAIN)))) as client:
        return client.post(f"/ai/v1/itinerary/{path}", json=body).json()


def test_validate_는_달력을_못_읽으면_태그형_규칙이_있는_곳을_미판정으로_싣는다() -> None:
    """G-SA-22 — 달력을 못 읽으면 빈 달력으로 판정해 태그형 휴일 규칙(공휴일 휴무)을 보지 못하는데, 주간 영업 창이
    있으면 HC1 이 통과시켜 흔적이 없었다 — 장소 감지가 진짜 공휴일 휴무를 '확인'으로 접을 수 있었다(INV-SA-2).
    규칙이 없는 곳은 그대로 판정이다. `detail` 표지로 원문 없음(빈 문자열 — 종전)과 운영에서 가른다."""
    failing = _FailingCalendar()
    for holidays in (HolidaySource(enabled=True, calendar=failing),  # 조회 실패
                     HolidaySource(enabled=True, calendar=None)):    # 키 미등록 — 달력이 없다
        assert _check_both(holidays) == {"violations": [], "unverified_slots": _TAGGED_UNKNOWN}
    assert failing.calls == [(_D2, _D2)]
    # 영업정보가 없는 곳은 태그형 규칙이 있어도 원문 없음이다 — 표지 없이 종전대로
    with TestClient(create_app(_orchestrator(HolidaySource(enabled=True, calendar=_FailingCalendar())))) as client:
        body = client.post("/ai/v1/itinerary/validate",
                           json={"itinerary": _payload(_D1, "museum"), "request_meta": _META}).json()
    assert body["unverified_slots"] == [{"poi_id": "museum", "reason_code": "HOURS_UNKNOWN", "detail": ""}]


def test_validate_는_달력을_읽었거나_모드_off_면_종전대로다() -> None:
    no_holiday = _check_both(HolidaySource(enabled=True, calendar=_SpyCalendar(())))  # 그 날 공휴일이 없다고 안다
    assert no_holiday == {"violations": [], "unverified_slots": []}
    holiday = _check_both(HolidaySource(enabled=True, calendar=_SpyCalendar((_D2,))))  # 공휴일 — 휴무가 증명됐다
    assert [(v["slot_ref"], v["reason_code"]) for v in holiday["violations"]] == [("tagged", "HOLIDAY")]
    assert holiday["unverified_slots"] == []
    assert _check_both(None) == {"violations": [], "unverified_slots": []}  # 모드 off — 공휴일을 보지 않는다


def test_repair_도_달력을_못_읽으면_태그형_규칙이_있는_곳을_미판정으로_싣는다() -> None:
    body = _check_both(HolidaySource(enabled=True, calendar=_FailingCalendar()), "repair")
    assert body["unverified_slots"] == _TAGGED_UNKNOWN
    assert _check_both(HolidaySource(enabled=True, calendar=_SpyCalendar(())), "repair")["unverified_slots"] == []


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



def test_시각_잠금도_공휴일_휴무인_곳은_잠그지_않는다() -> None:
    """"6시에 밥" 같은 시각 잠금(#1396)도 저녁 잠금과 같은 HC1 판정 — 공휴일 휴무면 고르지 않고 밝힌다."""
    from types import SimpleNamespace

    from trippilot.agents.planb.request_verification import VerifiedRequest
    from trippilot.api.wiring import _timed_blocks

    at = datetime(_REPLAN_DAY.year, _REPLAN_DAY.month, _REPLAN_DAY.day, 18, 0, tzinfo=_KST)
    request = SimpleNamespace(excluded_poi_ids=(), current_slots=())
    nl = VerifiedRequest(category_at=((PoiCategory.FOOD, at),))
    pool = SimpleNamespace(pois=(_RESTAURANT,))
    on_notes: list[str] = []
    on = _timed_blocks(request, nl, pool, (), DEMO_ANCHOR, None, _KST, on_notes,
                       {_REPLAN_DAY: frozenset({"PUBLIC"})})
    assert on == () and "nl_at_none: FOOD 18:00" in on_notes, on_notes
    off = _timed_blocks(request, nl, pool, (), DEMO_ANCHOR, None, _KST, [])
    assert [str(b.poi_id) for b in off] == ["dinner"]

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
