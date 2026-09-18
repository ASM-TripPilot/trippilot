"""EditAgent 계약 — 객체화로 새로 생긴 경계만 (agents/edit/agent.py).

편집 규칙·재타이밍·어셈블리 검증의 실제 동작은 `test_api_edit.py`(21건)가 HTTP 경계로
전부 덮는다. 여기서는 **함수 모음이던 것이 에이전트가 되며 생긴 계약**만 증명한다:
  ① `run()`은 예외를 밖으로 던지지 않는다 — 번역 워커가 터져도 TRANSLATION_FAILED
     상태값으로 수렴 (DL-5·INV-4)
  ② `EditOutcome` 불변식 — 상태·해·사유·위반이 서로 거짓말할 수 없다
  ③ `EditTask` 진입 배타 — 자연어와 구조화 중 정확히 하나 (와이어 계약과 동형)
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from trippilot.agents.edit.agent import EditAgent, EditOutcome, EditTask
from trippilot.agents.edit.commands import EditStatus
from trippilot.domain.common import PoiId, ScheduleId, TraceId, TransportMode
from trippilot.domain.edit import ApplyMode, EditCommand, EditOp
from trippilot.domain.itinerary import (
    DaySolution,
    ItinerarySolution,
    SolveMode,
    Violation,
    VisitSlot,
)
from trippilot.domain.llm import CandidatePool

_KST = timezone(timedelta(hours=9))
_NOW = datetime(2026, 8, 5, 8, 0, tzinfo=_KST)
_DAY = date(2026, 8, 5)
_TID = TraceId("t-edit")
_CMD = EditCommand(op=EditOp.REMOVE_SLOT, params={}, affected_slots=(PoiId("p1"),))


class _ExplodingTranslator:
    """설정 버그 등으로 워커가 경계 밖에서 터지는 상황."""

    def translate(self, *a, **k):
        raise RuntimeError("gateway misconfigured")


def _solution() -> ItinerarySolution:
    slot = VisitSlot(
        poi_id=PoiId("p1"),
        start_at=datetime(2026, 8, 5, 10, 0, tzinfo=_KST),
        end_at=datetime(2026, 8, 5, 11, 0, tzinfo=_KST),
        stay_min=60,
        score=0.0,
        is_llm_score=False,
    )
    return ItinerarySolution(
        schedule_id=ScheduleId("s-1"),
        days=(DaySolution(date=_DAY, slots=(slot,), fixed_blocks=()),),
        is_fallback=False,
        solve_mode=SolveMode.OR_TOOLS,
        assembly_run=None,
    )


def _task(**over) -> EditTask:
    base = dict(
        solution=_solution(),
        target_date=_DAY,
        pool=CandidatePool(poi_ids=frozenset(), pois=(), generated_at=_NOW),
        poi_index={},
        transport=TransportMode.PUBLIC,
        trace_id=_TID,
        now=_NOW,
        deadline_ms=20_000,
        utterance="3일차 점심 빼줘",
    )
    base.update(over)
    return EditTask(**base)


# ── ① 무예외 수렴 ───────────────────────────────────────────────────


def test_run_never_raises_when_translation_worker_explodes() -> None:
    agent = EditAgent(_ExplodingTranslator(), None, None, lambda s: None, tz=_KST)

    outcome = agent.run(_task())

    assert outcome.status is EditStatus.TRANSLATION_FAILED
    assert "RuntimeError" in (outcome.reason or "")
    assert outcome.solution is None      # 해석 실패에 일정을 지어내지 않는다
    assert outcome.command is None


# ── ② EditOutcome 불변식 ────────────────────────────────────────────


def test_applied_requires_solution() -> None:
    with pytest.raises(ValueError, match="APPLIED"):
        EditOutcome(status=EditStatus.APPLIED, command=_CMD,
                    apply_mode=ApplyMode.AUTO_APPLY)


def test_non_applied_must_not_carry_solution() -> None:
    with pytest.raises(ValueError, match="APPLIED"):
        EditOutcome(status=EditStatus.REJECTED, reason="사유", solution=_solution())


@pytest.mark.parametrize("status", [EditStatus.REJECTED, EditStatus.TRANSLATION_FAILED])
def test_failure_states_require_reason(status: EditStatus) -> None:
    """침묵 거부 금지 (INV-4) — 사유 없는 거절은 타입으로 만들 수 없다."""
    with pytest.raises(ValueError, match="사유 필수"):
        EditOutcome(status=status)


def test_confirm_required_must_carry_command_and_mode() -> None:
    """사용자가 무엇을 확인하는지 모르는 CONFIRM_REQUIRED 는 만들 수 없다."""
    with pytest.raises(ValueError, match="CONFIRM_REQUIRED"):
        EditOutcome(status=EditStatus.CONFIRM_REQUIRED)


def test_violations_only_on_rejected() -> None:
    with pytest.raises(ValueError, match="violations"):
        EditOutcome(status=EditStatus.APPLIED, solution=_solution(),
                    violations=(Violation(code="HC2", slot_ref=None, detail="d"),))


# ── ③ EditTask 진입 배타 ────────────────────────────────────────────


def test_task_requires_exactly_one_entry() -> None:
    with pytest.raises(ValueError, match="정확히 하나"):
        _task(utterance=None, command=None)
    with pytest.raises(ValueError, match="정확히 하나"):
        _task(utterance="빼줘", command=_CMD)
