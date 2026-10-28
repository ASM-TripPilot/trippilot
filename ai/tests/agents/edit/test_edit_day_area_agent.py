"""편집 에이전트 ①b — 확인 게이트·재구성 콘센트·⑤ 재검증·사유 (agents/edit/agent.py, spec 004 FR-004).

콘센트·검증기는 가짜다 — 실제 재구성(동네 풀·ScheduleAgent)은 `tests/api/test_api_edit_day_area.py` 가 본다.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from trippilot.agents.edit.agent import EditAgent, EditTask, RebuiltDays
from trippilot.agents.edit.commands import EditStatus
from trippilot.api.wiring import _problem_for
from trippilot.domain.common import GeoPoint, PoiId, ScheduleId, TraceId, TransportMode
from trippilot.domain.edit import EditCommand, EditOp
from trippilot.domain.itinerary import DaySolution, ItinerarySolution, SolveMode, Violation, VisitSlot
from trippilot.domain.llm import CandidatePool
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource

_KST = timezone(timedelta(hours=9))
_DAY = date(2026, 8, 5)
_NOW = datetime(2026, 8, 3, 9, 0, tzinfo=_KST)  # 여행 전
_NEW = Poi(PoiId("p2"), "종로 명소", PoiCategory.SIGHT, GeoPoint(37.5703, 126.9910), (), None, None, DataQuality.FULL,
           PoiSource.SEED, None)


def _slot(pid: str, h: int) -> VisitSlot:
    return VisitSlot(PoiId(pid), datetime(2026, 8, 5, h, 0, tzinfo=_KST), datetime(2026, 8, 5, h + 1, 0, tzinfo=_KST),
                     60, 0.0, False)


def _solution(*slots: VisitSlot) -> ItinerarySolution:
    return ItinerarySolution(ScheduleId("s-1"), (DaySolution(_DAY, tuple(slots), ()),), False, SolveMode.OR_TOOLS, None)


class _Translator:
    def __init__(self) -> None:
        self.calls = 0

    def translate(self, *a, **k):
        self.calls += 1
        raise RuntimeError("번역기를 부르면 안 되는 말")


class _Facade:
    def __init__(self, violations) -> None:
        self._v = violations
        self.days: list[tuple[date, ...]] = []

    def validate(self, solution, problem, deadline_ms, trace_id=None):
        self.days.append(tuple(d.date for d in solution.days))
        return self._v


class _Provider:
    def __init__(self, violations=()) -> None:
        self.facade = _Facade(violations)

    def for_pool(self, poi_index):
        return self.facade


class _Rebuild:
    def __init__(self, result) -> None:
        self.result, self.calls = result, []

    def __call__(self, pairs):
        self.calls.append(pairs)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def _agent(provider: _Provider, translator: _Translator | None = None, known=("종로", "강남")) -> EditAgent:
    return EditAgent(translator or _Translator(), provider, None, lambda s: _problem_for(s, _KST), tz=_KST, known_areas=known)


def _task(rebuild, *, utterance: str | None = "1일차는 종로 쪽으로 바꿔줘", command: EditCommand | None = None,
          confirm: bool = True, now: datetime = _NOW) -> EditTask:
    return EditTask(solution=_solution(_slot("p1", 10)), target_date=_DAY,
                    pool=CandidatePool(poi_ids=frozenset(), pois=(), generated_at=now), poi_index={},
                    transport=TransportMode.PUBLIC, trace_id=TraceId("t-da"), now=now, deadline_ms=7_000,
                    utterance=None if command else utterance, command=command, confirm=confirm, rebuild_days=rebuild)


def _rebuilt() -> RebuiltDays:
    return RebuiltDays(solution=_solution(_slot("p2", 11)), areas={_DAY: "종로"}, pois={_NEW.poi_id: _NEW})


def test_applied_carries_the_interpretation_and_the_removed_slots() -> None:
    provider = _Provider()
    out = _agent(provider).run(_task(_Rebuild(_rebuilt())))
    assert out.status is EditStatus.APPLIED
    assert out.command == EditCommand(EditOp.SET_DAY_AREAS, {"2026-08-05": "종로"}, (PoiId("p1"),))
    assert provider.facade.days == [(_DAY,)]  # ⑤ 는 바뀐 날만


def test_revalidation_violation_is_rejected_not_applied() -> None:
    """⑤ — 조립이 낸 해라도 편집 검증(요청 수단)이 막으면 반영하지 않는다(INV-2). 2026-10-23 리뷰: 이 가드를 꺼도 초록이었다."""
    provider = _Provider((Violation("HC2", PoiId("p2"), "이동 시간 부족"),))
    out = _agent(provider).run(_task(_Rebuild(_rebuilt())))
    assert out.status is EditStatus.REJECTED and [v.code for v in out.violations] == ["HC2"]
    assert out.command is not None and out.command.op is EditOp.SET_DAY_AREAS


def test_confirm_gate_comes_before_any_rebuild() -> None:
    rebuild = _Rebuild(_rebuilt())
    out = _agent(_Provider()).run(_task(rebuild, confirm=False))
    assert out.status is EditStatus.CONFIRM_REQUIRED and rebuild.calls == []


def test_outlet_reason_or_failure_becomes_a_reason() -> None:
    assert _agent(_Provider()).run(_task(_Rebuild("area_unknown(종로)"))).reason == "day_area: area_unknown(종로)"
    boom = _agent(_Provider()).run(_task(_Rebuild(RuntimeError("x"))))
    assert (boom.status, boom.reason) == (EditStatus.REJECTED, "day_area: rebuild_error: RuntimeError")
    unwired = _agent(_Provider()).run(_task(None))
    assert unwired.reason == "day_area: not_wired"


def test_without_the_area_table_a_bare_name_is_not_read_as_an_area() -> None:
    """표를 못 받은 에이전트는 '종로'(꼬리 없음)를 동네로 읽지 않는다 — 대화와 같은 표를 넘겨야 같은 해석이 된다."""
    translator, rebuild = _Translator(), _Rebuild(_rebuilt())
    out = _agent(_Provider(), translator, known=()).run(_task(rebuild, utterance="1일차는 종로로 바꿔줘"))
    assert rebuild.calls == [] and translator.calls == 1 and out.status is not EditStatus.APPLIED


def test_structured_command_on_a_past_day_is_refused() -> None:
    cmd = EditCommand(EditOp.SET_DAY_AREAS, {"2026-08-05": "종로"}, ())
    out = _agent(_Provider()).run(_task(_Rebuild(_rebuilt()), command=cmd, now=datetime(2026, 8, 6, 9, 0, tzinfo=_KST)))
    assert (out.status, out.reason) == (EditStatus.REJECTED, "day_area: past_day(2026-08-05)")
