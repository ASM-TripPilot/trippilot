"""2‴ 도구 계획 — 노출 도구 · 작업 이름 접두 · Facts 병합 (assistant-orchestrator FD BR-AO-28 · DE §2.11 · AO-P20).

순수 함수뿐이다(I/O 없음). 오케스트레이터(`dialogue_orchestrator._plan_turn`)가 계획 LLM 이 고른 도구 호출(≤2)을 기존 핸들러의
`plan` 으로 작업 목록을 받아 **팬아웃 한 번**에 던지고, 핸들러마다 `assemble` 한 Facts 를 여기서 하나로 합쳐 기존 답변 단계에 넘긴다.

병합 규칙(정정본 C3):
- 카드·버튼·템플릿·상태·의도는 **대표** 하나의 것이다 — 화면 카드는 하나다. 대표는 쓸 수 있는 것(OK·PARTIAL) → 쓸 수 없으면
  EMPTY 가 UNAVAILABLE 보다 먼저(순서만 바꿔도 직행 템플릿↔LLM 이 뒤집히던 쌍 70건) → 후보 카드 > 정보 카드 > 문장 → OK 가
  PARTIAL 보다 먼저 → 계획 순서
- 나머지 부분의 사실은 `detail.also`(각 부분의 `to_prompt_dict`)로만 답변 LLM 에 간다 — 사실 없는 부분(넘기기 안내·앵커 없는
  탐색)은 넣지 않는다(넣으면 detail 이 차서 BR-AO-25 직행이 LLM 으로 바뀐다)
- `places` 는 **대표 것만** — 합치면 같은 장소가 프롬프트에 두 번 실리고 "일정에 이미 있는 곳"을 찾은 곳으로 소개한다(실측 60건).
  also 안의 장소 이름은 오케스트레이터의 아는 이름 목록(`_known_names`)이 따로 읽는다
- 여행이 없어 needTrip 인 부분은 다른 부분이 있으면 뺀다
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import fields, replace

from trippilot.domain.intent import Intent
from trippilot.domain.plan_tools import PLAN_TOOLS, PlanTool
from trippilot.orchestrator.dialogue_handlers import (
    HANDLERS,
    AnswerKind,
    Facts,
    FactStatus,
    HandlerPorts,
    HandlerTask,
    TaskResult,
    needs_trip,
)

__all__ = ["merge_facts", "plan_tools", "step_results", "step_tasks", "validate_tools_against_handlers"]

_KIND_RANK: Mapping[AnswerKind, int] = {AnswerKind.CANDIDATES: 0, AnswerKind.INFO: 1, AnswerKind.TEXT: 2}
_USABLE = frozenset({FactStatus.OK, FactStatus.PARTIAL})
_TRIP_TAG = " (여행 필요)"  # 프롬프트 규칙 줄이 이 꼬리를 읽는다 — 여행 없는 대화면 고르지 않는다

if set(_KIND_RANK) != set(AnswerKind):  # 답변 종류가 늘면 대표 순위부터 정해야 기동한다
    raise ValueError(f"_KIND_RANK 는 AnswerKind 전수여야 한다: {sorted(k.value for k in set(AnswerKind) - set(_KIND_RANK))}")


def validate_tools_against_handlers(tools: Mapping[Intent, PlanTool]) -> None:
    """도구 표 ↔ 실행자 기동 검사 — 도구마다 핸들러가 있고, FRAME 으로 넘기는 핸들러(편집)가 아니고, 쓰는 포트가 실재한다."""
    ports = {f.name for f in fields(HandlerPorts)}
    for intent, tool in tools.items():
        if intent not in HANDLERS:
            raise ValueError(f"도구 {intent.value} 의 핸들러가 없다")
        if HANDLERS[intent].handoff_frame:
            raise ValueError(f"FRAME 으로 넘기는 핸들러는 도구가 될 수 없다: {intent.value}")
        unknown = set(tool.needs) - ports
        if unknown:
            raise ValueError(f"도구 {intent.value} 가 없는 포트를 쓴다: {sorted(unknown)}")


validate_tools_against_handlers(PLAN_TOOLS)


def plan_tools(ports: HandlerPorts) -> dict[Intent, str]:
    """노출할 도구 → 모델에게 보일 설명. 쓰는 포트가 하나라도 미배선이면 뺀다(늘 UNAVAILABLE 로 끝날 계획을 원천에서 막는다)."""
    return {
        intent: tool.summary + (_TRIP_TAG if needs_trip(intent) else "")
        for intent, tool in PLAN_TOOLS.items()
        if all(getattr(ports, name) is not None for name in tool.needs)
    }


def step_tasks(plans: Sequence[tuple[HandlerTask, ...]]) -> tuple[HandlerTask, ...]:
    """호출별 작업 목록 → 팬아웃 한 번의 작업. 호출이 하나면 이름 그대로(팬아웃 FallbackEvent 의 from_mode 가 분류 경로와 같다),
    둘이면 `{i}.` 접두로 가른다(같은 핸들러를 두 번 부르면 작업 이름이 겹친다)."""
    if len(plans) == 1:
        return plans[0]
    return tuple(HandlerTask(f"{i}.{task.name}", task.fn) for i, tasks in enumerate(plans) for task in tasks)


def step_results(results: Mapping[str, TaskResult], i: int, n: int) -> Mapping[str, TaskResult]:
    """팬아웃 결과 → i 번째 호출의 결과(접두를 뗀 이름). `assemble` 은 작업 이름으로만 읽는다."""
    if n == 1:
        return results
    prefix = f"{i}."
    return {name[len(prefix):]: result for name, result in results.items() if name.startswith(prefix)}


def _has_facts(f: Facts) -> bool:
    return bool(f.rows or f.places or f.notes or f.detail)


def merge_facts(parts: Sequence[Facts]) -> Facts:
    """핸들러별 Facts → 하나(모듈 머리 규칙). 하나면 그대로. 결과는 post-init 을 다시 통과한다 — `also` 는 예약 키가 아니다."""
    if len(parts) == 1:
        return parts[0]
    usable = [p for p in parts if not p.needs_trip] or [parts[0]]
    primary = min(
        enumerate(usable),
        key=lambda ip: (ip[1].status not in _USABLE, ip[1].status is FactStatus.UNAVAILABLE, _KIND_RANK[ip[1].kind],
                        ip[1].status is FactStatus.PARTIAL, ip[0]),
    )[1]
    rest = [p for p in usable if p is not primary and _has_facts(p)]
    if not rest:
        return primary
    return replace(primary, detail={**primary.detail, "also": [p.to_prompt_dict() for p in rest]})
