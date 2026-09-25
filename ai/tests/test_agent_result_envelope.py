"""네 에이전트의 산출 → `AgentResult` 수렴 (DL-1·DL-5, 미결 #8 의 출력 절반).

## 왜 출력만인가

`handle(AgentTask) -> AgentResult` 의 **입력** 절반은 계약이 없다 —
`GenerateItineraryRequest` 의 `anchor`·`day_window`·`principal`·`persona_ref`·
`seed` 는 슬롯에 대응이 없고, 담을 칸(`inline_context`·`context_refs`)에 의도별로
무엇이 들어가는지가 미정이다. 출력은 그 계약과 무관해서 먼저 수렴시킨다.

여기서 잠그는 것은 **판단이 들어간 자리**다. 기계적 사영은 타입이 지킨다.
"""

from __future__ import annotations

import pytest

from trippilot.domain.delegation import AgentResult, AgentStatus, TaskError, TaskMetrics

_TASK, _TRACE = "task-1", "trace-1"
_METRICS = TaskMetrics(elapsed_ms=12, llm_calls=1, tokens_in=10, tokens_out=5,
                       tools_used=("assembly",))


# ── 도메인 헬퍼 — 불변식 조합을 네 곳이 각자 외우지 않게 한다 ────────────────

def test_success_forbids_a_fallback_step() -> None:
    r = AgentResult.succeeded(task_id=_TASK, trace_id=_TRACE, payload={"a": 1},
                              metrics=_METRICS)
    assert r.status is AgentStatus.SUCCESS and r.fallback_level == 0
    assert r.error is None


def test_degraded_rejects_level_zero() -> None:
    """0 이면 SUCCESS 와 구분이 사라진다 — 조용히 통과시키면 계단이 없어진다."""
    with pytest.raises(ValueError):
        AgentResult.degraded(task_id=_TASK, trace_id=_TRACE, payload={"a": 1},
                             fallback_level=0, metrics=_METRICS)


def test_failed_carries_no_payload() -> None:
    """빈 dict 를 넣으면 호출측이 '결과가 있는데 비었다'로 읽어 정상 경로를 탄다."""
    r = AgentResult.failed(task_id=_TASK, trace_id=_TRACE, metrics=_METRICS,
                           error=TaskError("E", "x", False))
    assert r.status is AgentStatus.FAILED and r.payload is None


def test_timeout_is_a_distinct_status() -> None:
    r = AgentResult.failed(task_id=_TASK, trace_id=_TRACE, metrics=_METRICS,
                           error=TaskError("E", "x", True), timeout=True)
    assert r.status is AgentStatus.TIMEOUT


# ── PlanB — 대안 0개는 실패다 ────────────────────────────────────────────────

def _planb(alternatives=(), *, fallback_level=0, empty_reason=None):
    from trippilot.agents.planb.rag import PlanBRagResult

    return PlanBRagResult(
        alternatives=tuple(alternatives), is_fallback=fallback_level > 0,
        fallback_level=fallback_level, notes=(), retrieved={},
        dropped_out_of_pool=(), empty_reason=empty_reason)


def test_planb_empty_alternatives_is_failure_not_empty_success() -> None:
    """빈 목록을 SUCCESS 로 내면 호출측이 '대안이 없다'를 정상으로 읽는다."""
    from trippilot.agents.planb.envelope import to_agent_result

    r = to_agent_result(_planb(empty_reason="후보 0"), task_id=_TASK,
                        trace_id=_TRACE, metrics=_METRICS)
    assert r.status is AgentStatus.FAILED
    assert r.error is not None and "후보 0" in r.error.message


def test_planb_keeps_its_own_fallback_level() -> None:
    """PlanB 는 계단을 이미 센다(0=LLM·1=규칙·2=후보 0) — 다시 세면 두 숫자가 갈린다."""
    from trippilot.agents.planb.rag import Alternative
    from trippilot.agents.planb.envelope import to_agent_result

    alt = Alternative(label="A", poi_ids=("p1",), rationale="r")
    r = to_agent_result(_planb([alt], fallback_level=2), task_id=_TASK,
                        trace_id=_TRACE, metrics=_METRICS)
    assert r.status is AgentStatus.FALLBACK and r.fallback_level == 2


# ── Edit — 되묻기는 성공도 실패도 아니다 ────────────────────────────────────

def test_edit_confirm_required_is_need_more_info() -> None:
    """FAILED 로 내면 폴백을 태우고, SUCCESS 로 내면 적용된 줄 안다."""
    from trippilot.agents.edit.agent import EditOutcome
    from trippilot.agents.edit.commands import EditStatus
    from trippilot.domain.common import PoiId
    from trippilot.domain.edit import ApplyMode, EditCommand, EditOp
    from trippilot.agents.edit.envelope import to_agent_result

    command = EditCommand(op=EditOp.MOVE_SLOT, params={"poi_id": "p1"},
                          affected_slots=(PoiId("p1"),))
    outcome = EditOutcome(
        status=EditStatus.CONFIRM_REQUIRED,
        command=command,
        apply_mode=ApplyMode.CONFIRM_REQUIRED,
        reason="겹침",
    )
    r = to_agent_result(outcome, task_id=_TASK, trace_id=_TRACE, metrics=_METRICS)
    assert r.status is AgentStatus.NEED_MORE_INFO
    assert r.error is None
    # 도메인이 강제하는 칸 — 되물을 것이 무엇인지 호출측이 고를 수 있어야 한다.
    assert r.payload["missing"] == ["confirm"] and r.payload["reason"]


def test_edit_confirm_payload_carries_what_is_being_confirmed() -> None:
    """`EditOutcome` 이 CONFIRM_REQUIRED 에 command 를 필수로 거는 이유가 이것이다.

    빠뜨리면 봉투가 "확인 필요"라고만 말하고 **무엇을** 확인하는지는 말하지
    않는다 — 호출측이 확인 화면을 못 그린다. 와이어 계약
    (`EditItineraryResponse`)은 이미 command 를 싣고 있어, 빠지면 봉투가 경계보다
    정보를 덜 나르는 상태가 된다.
    """
    from trippilot.agents.edit.agent import EditOutcome
    from trippilot.agents.edit.commands import EditStatus
    from trippilot.agents.edit.envelope import to_agent_result
    from trippilot.domain.common import PoiId
    from trippilot.domain.edit import ApplyMode, EditCommand, EditOp

    command = EditCommand(op=EditOp.MOVE_SLOT, params={"poi_id": "p9"},
                          affected_slots=(PoiId("p9"),))
    r = to_agent_result(
        EditOutcome(status=EditStatus.CONFIRM_REQUIRED, command=command,
                    apply_mode=ApplyMode.CONFIRM_REQUIRED, reason="겹침"),
        task_id=_TASK, trace_id=_TRACE, metrics=_METRICS)

    assert r.payload["command"] == command.to_dict()


# ── Reflect — 실패 상태가 없다 ──────────────────────────────────────────────

def test_reflect_fallback_template_is_degraded_not_success() -> None:
    """규칙 템플릿이 최후 보루라 산출은 항상 나온다 — 갈리는 건 계단 하나다."""
    from trippilot.agents.reflect.envelope import to_agent_result

    class _Template:
        is_fallback = True

        def to_dict(self):
            return {"template_id": "t"}

    r = to_agent_result(_Template(), task_id=_TASK, trace_id=_TRACE, metrics=_METRICS)
    assert r.status is AgentStatus.FALLBACK and r.fallback_level == 1


# ── Schedule — DEGRADED 인데 계단이 비면 ────────────────────────────────────

def test_schedule_degraded_without_steps_still_counts_as_one() -> None:
    """산출이 스스로 모순인 상태다 — 0 으로 내려 SUCCESS 와 뭉개지 않는다."""
    from trippilot.agents.schedule.envelope import to_agent_result
    from trippilot.agents.schedule.outcome import GenerationStatus

    class _Outcome:
        status = GenerationStatus.DEGRADED
        solution = None
        scoring_mode = type("M", (), {"value": "RULE"})()
        explanations = ()
        degradations = ()
        candidate_count = 3
        slot_alternatives = {}
        error = None

    r = to_agent_result(_Outcome(), task_id=_TASK, trace_id=_TRACE, metrics=_METRICS)
    assert r.status is AgentStatus.FALLBACK and r.fallback_level == 1


def test_schedule_failed_is_not_retryable() -> None:
    """후보가 없거나 하드 제약이 모순이다 — 다시 불러도 같다."""
    from trippilot.agents.schedule.envelope import to_agent_result
    from trippilot.agents.schedule.outcome import GenerationStatus

    class _Outcome:
        status = GenerationStatus.FAILED
        error = "후보 0건"

    r = to_agent_result(_Outcome(), task_id=_TASK, trace_id=_TRACE, metrics=_METRICS)
    assert r.status is AgentStatus.FAILED
    assert r.error is not None and r.error.retryable is False


# ── 공통 — 지어내지 않는다 ──────────────────────────────────────────────────

def test_freshness_defaults_to_none_not_a_fabricated_stamp() -> None:
    """도메인 `Poi` 에 수집 시각 메타가 없어 집계가 불가능하다.

    여기서 채우면 **없는 지표가 있는 것처럼** 보인다(최신성 F1 의 원천으로 쓰인다).
    Provider 가 준 게 있으면 통과, 없으면 None 이다.
    """
    r = AgentResult.succeeded(task_id=_TASK, trace_id=_TRACE, payload={},
                              metrics=_METRICS)
    assert r.freshness is None


def test_metrics_is_required_so_zero_never_means_unmeasured() -> None:
    """0 을 기본값으로 두면 '호출 0회'와 '안 셌다'가 구분되지 않는다."""
    import inspect

    from trippilot.agents.schedule.envelope import to_agent_result

    sig = inspect.signature(to_agent_result)
    assert sig.parameters["metrics"].default is inspect.Parameter.empty


@pytest.mark.parametrize("module", [
    "trippilot.agents.schedule.envelope",
    "trippilot.agents.planb.envelope",
    "trippilot.agents.edit.envelope",
    "trippilot.agents.reflect.envelope",
])
def test_every_agent_package_has_a_converter(module: str) -> None:
    """네 곳이 같은 이름·같은 자리인가 — 하나 빠지면 그 에이전트만 봉투 밖이다."""
    import importlib

    assert callable(getattr(importlib.import_module(module), "to_agent_result"))
