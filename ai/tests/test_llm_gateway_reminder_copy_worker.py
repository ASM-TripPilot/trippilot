"""REMINDER_COPY 워커 — 항목별 호출·마감 배분·부분 성공 (INV-4).

증명하는 것:
  ① 항목마다 1회씩 부르고, 게이트 통과분만 결과에 담는다 (부분 성공 = 정상)
  ② 폴백·드롭 항목은 결과에서 빠지고 드롭 건수로 보고된다 — 침묵 금지
  ③ 예산이 있으면 게이트웨이 호출에 **관통**한다 (기본 타임아웃에 얹히지 않는다)
  ④ 예산이 바닥나면 남은 항목을 부르지 않고 드롭으로 보고한다
  ⑤ 다른 날 장소가 그 항목의 forbidden 으로 들어간다
  ⑥ slot_categories 는 프롬프트 vars(slot_list)에는 실리지만 게이트 allowed 대조는
     여전히 순수 장소명뿐이다 — 모델이 순수 장소명만 선언하면 그대로 통과한다
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature, TypedResult
from trippilot.llm_gateway.gates.reminder_copy import (
    ReminderCopyContext,
    ReminderCopyDraft,
    ReminderCopyGate,
)
from trippilot.llm_gateway.workers.reminder_copy import (
    ReminderCopyInput,
    ReminderCopyItem,
    ReminderCopyWorker,
    build_reminder_copy_vars,
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


def test_budget_is_split_equally_across_items() -> None:
    gw = FakeGateway([_ok("제목1", "본문1"), _ok("제목2", "본문2")])
    ReminderCopyWorker(gw).generate(
        ReminderCopyInput(trip_title="제주 3일", items=ITEMS), TRACE, NOW, budget_sec=8.0
    )
    # 8.0초를 2항목으로 균등 분배: [4.0, 4.0]
    assert [c["timeout_sec"] for c in gw.calls] == [4.0, 4.0]


def test_budget_split_equally_across_three_items() -> None:
    items = (
        ReminderCopyItem(
            schedule_key="k1", kind="TRIP_DAY", date_label="2026-09-13",
            slot_names=("성산일출봉",),
        ),
        ReminderCopyItem(
            schedule_key="k2", kind="TRIP_DAY", date_label="2026-09-14",
            slot_names=("한라산",),
        ),
        ReminderCopyItem(
            schedule_key="k3", kind="TRIP_DAY", date_label="2026-09-15",
            slot_names=("중문관광단지",),
        ),
    )
    gw = FakeGateway([_ok("제목1", "본문1"), _ok("제목2", "본문2"), _ok("제목3", "본문3")])
    ReminderCopyWorker(gw).generate(
        ReminderCopyInput(trip_title="제주 3일", items=items), TRACE, NOW, budget_sec=6.0
    )
    # 6.0초를 3항목으로 균등 분배: [2.0, 2.0, 2.0]
    timeouts = [c["timeout_sec"] for c in gw.calls]
    assert timeouts == [2.0, 2.0, 2.0]
    assert sum(timeouts) == 6.0


def test_exhausted_budget_skips_remaining_items() -> None:
    gw = FakeGateway([_ok("제목1", "본문1")])
    copies, dropped = ReminderCopyWorker(gw).generate(
        ReminderCopyInput(trip_title="제주 3일", items=ITEMS), TRACE, NOW, budget_sec=0.4
    )
    # 0.4초를 2항목으로 나누면 0.2초/항목 < 0.5초(MIN_CALL_SEC)
    # 따라서 한 건도 부르지 않고 전부 드롭으로 보고한다
    assert copies == () and dropped == 2
    assert len(gw.calls) == 0  # 게이트웨이를 전혀 부르지 않았다


def test_other_day_places_become_forbidden() -> None:
    gw = FakeGateway([_ok("제목1", "본문1"), _ok("제목2", "본문2")])
    ReminderCopyWorker(gw).generate(
        ReminderCopyInput(trip_title="제주 3일", items=ITEMS), TRACE, NOW, budget_sec=None
    )
    ctx = gw.calls[0]["pool"]
    assert isinstance(ctx, ReminderCopyContext)
    assert ctx.allowed == ("성산일출봉", "우도")
    assert "한라산" in ctx.forbidden


def test_empty_items_returns_empty_without_gateway_call() -> None:
    gw = FakeGateway([])
    copies, dropped = ReminderCopyWorker(gw).generate(
        ReminderCopyInput(trip_title="제주 3일", items=()), TRACE, NOW, budget_sec=8.0
    )
    # 항목이 없으면 게이트웨이를 부르지 않고 바로 ((), 0)을 반환한다
    assert copies == () and dropped == 0
    assert len(gw.calls) == 0


def test_build_reminder_copy_vars_renders_category_pairs() -> None:
    """카테고리가 있으면 "이름 · 카테고리"로, 빈 카테고리는 이름만(대롱 구분자 금지)."""
    item = ReminderCopyItem(
        schedule_key="k1", kind="TRIP_DAY", date_label="2026-09-13",
        slot_names=("성산일출봉", "우도"), slot_categories=("관광지", ""),
    )
    vars_ = build_reminder_copy_vars(item, "제주 3일")
    assert vars_["slot_list"] == "성산일출봉 · 관광지 / 우도"


def test_build_reminder_copy_vars_defaults_categories_when_absent() -> None:
    """slot_categories 미지정(과거 호출)이면 이름만 렌더 — 하위호환."""
    item = ReminderCopyItem(
        schedule_key="k1", kind="TRIP_DAY", date_label="2026-09-13",
        slot_names=("성산일출봉", "우도"),
    )
    vars_ = build_reminder_copy_vars(item, "제주 3일")
    assert vars_["slot_list"] == "성산일출봉 / 우도"


def test_gate_still_passes_bare_place_name_despite_item_categories() -> None:
    """항목에 카테고리가 실려도 게이트로 넘어가는 allowed 집합은 순수 장소명뿐이다 —
    모델이 프롬프트의 "이름 · 카테고리" 표기를 따라하지 않고 이름만 선언하면 통과한다."""
    items = (
        ReminderCopyItem(
            schedule_key="k1", kind="TRIP_DAY", date_label="2026-09-13",
            slot_names=("성산일출봉",), slot_categories=("관광지",),
        ),
    )
    ctx = ReminderCopyWorker._context(items, 0)
    assert ctx.allowed == ("성산일출봉",)  # 카테고리가 섞여 들어가지 않는다

    out = ReminderCopyGate().apply(
        json.dumps(
            {"title": "오늘의 제주", "body": "성산일출봉부터 시작해요", "places": ["성산일출봉"]},
            ensure_ascii=False,
        ),
        ctx, feature=LlmFeature.REMINDER_COPY, trace_id=TRACE, now=NOW,
    )
    assert out.error is None and out.value is not None

    # 대조: 모델이 프롬프트 표기를 그대로 echo(카테고리 포함)하면 allowed 밖이라 드롭된다.
    dropped = ReminderCopyGate().apply(
        json.dumps(
            {"title": "오늘의 제주", "body": "성산일출봉 · 관광지부터 시작해요",
             "places": ["성산일출봉 · 관광지"]},
            ensure_ascii=False,
        ),
        ctx, feature=LlmFeature.REMINDER_COPY, trace_id=TRACE, now=NOW,
    )
    assert dropped.value is None and dropped.drop_event is not None
