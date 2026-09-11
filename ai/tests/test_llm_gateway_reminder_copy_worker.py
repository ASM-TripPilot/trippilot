"""REMINDER_COPY 워커 — 항목별 호출·마감 배분·부분 성공 (INV-4).

증명하는 것:
  ① 항목마다 1회씩 부르고, 게이트 통과분만 결과에 담는다 (부분 성공 = 정상)
  ② 폴백·드롭 항목은 결과에서 빠지고 드롭 건수로 보고된다 — 침묵 금지
  ③ 예산이 있으면 게이트웨이 호출에 **관통**한다 (기본 타임아웃에 얹히지 않는다)
  ④ 예산이 바닥나면 남은 항목을 부르지 않고 드롭으로 보고한다
  ⑤ 다른 날 장소가 그 항목의 forbidden 으로 들어간다
"""

from __future__ import annotations

from datetime import datetime, timezone

from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature, TypedResult
from trippilot.llm_gateway.gates.reminder_copy import ReminderCopyContext, ReminderCopyDraft
from trippilot.llm_gateway.workers.reminder_copy import (
    ReminderCopyInput,
    ReminderCopyItem,
    ReminderCopyWorker,
)

NOW = datetime(2026, 9, 12, 9, 0, tzinfo=timezone.utc)
TRACE = TraceId("t-1")

ITEMS = (
    ReminderCopyItem(
        schedule_key="k1", kind="TRIP_DAY", date_label="2026-09-13",
        slot_names=("성산일출봉", "우도"),
    ),
    ReminderCopyItem(
        schedule_key="k2", kind="TRIP_DAY", date_label="2026-09-14",
        slot_names=("한라산",),
    ),
)


class FakeGateway:
    """호출을 기록하고 지정한 결과를 순서대로 돌려주는 대역."""

    def __init__(self, results: list[TypedResult]) -> None:
        self.results = list(results)
        self.calls: list[dict] = []

    def call(self, feature, prompt_vars, pool, trace_id, now, *, timeout_sec=None, **kw):
        self.calls.append(
            {"feature": feature, "vars": dict(prompt_vars), "pool": pool, "timeout_sec": timeout_sec}
        )
        return self.results.pop(0)


def _ok(title: str, body: str) -> TypedResult:
    return TypedResult(value=ReminderCopyDraft(title, body), is_fallback=False, error=None, call_record=None)


def _fallback() -> TypedResult:
    return TypedResult(value=None, is_fallback=True, error="gate_dropped_all", call_record=None)


def test_calls_once_per_item_and_collects_successes() -> None:
    gw = FakeGateway([_ok("제목1", "본문1"), _ok("제목2", "본문2")])
    copies, dropped = ReminderCopyWorker(gw).generate(
        ReminderCopyInput(trip_title="제주 3일", items=ITEMS), TRACE, NOW, budget_sec=None
    )
    assert len(gw.calls) == 2
    assert [c.schedule_key for c in copies] == ["k1", "k2"]
    assert dropped == 0
    assert all(c["feature"] is LlmFeature.REMINDER_COPY for c in gw.calls)


def test_partial_failure_is_reported_not_silent() -> None:
    gw = FakeGateway([_ok("제목1", "본문1"), _fallback()])
    copies, dropped = ReminderCopyWorker(gw).generate(
        ReminderCopyInput(trip_title="제주 3일", items=ITEMS), TRACE, NOW, budget_sec=None
    )
    assert [c.schedule_key for c in copies] == ["k1"]
    assert dropped == 1


def test_budget_is_passed_through_to_gateway() -> None:
    gw = FakeGateway([_ok("제목1", "본문1"), _ok("제목2", "본문2")])
    ReminderCopyWorker(gw).generate(
        ReminderCopyInput(trip_title="제주 3일", items=ITEMS), TRACE, NOW, budget_sec=8.0
    )
    assert all(c["timeout_sec"] is not None and c["timeout_sec"] > 0 for c in gw.calls)


def test_exhausted_budget_skips_remaining_items() -> None:
    gw = FakeGateway([_ok("제목1", "본문1")])
    copies, dropped = ReminderCopyWorker(gw).generate(
        ReminderCopyInput(trip_title="제주 3일", items=ITEMS), TRACE, NOW, budget_sec=0.4
    )
    # 예산이 최소 호출 시간보다 작으면 한 건도 부르지 않고 전부 드롭으로 보고한다
    assert copies == () and dropped == 2 and gw.calls == []


def test_other_day_places_become_forbidden() -> None:
    gw = FakeGateway([_ok("제목1", "본문1"), _ok("제목2", "본문2")])
    ReminderCopyWorker(gw).generate(
        ReminderCopyInput(trip_title="제주 3일", items=ITEMS), TRACE, NOW, budget_sec=None
    )
    ctx = gw.calls[0]["pool"]
    assert isinstance(ctx, ReminderCopyContext)
    assert ctx.allowed == ("성산일출봉", "우도")
    assert "한라산" in ctx.forbidden
