"""DIALOGUE_PLAN 출구 게이트 (assistant-orchestrator FD BR-AO-28 · DE §2.11 — 범위 밖 질문의 도구 계획 2‴).

산출물은 **닫힌 도구 이름과 문자열 인자**뿐이다 — 계획 LLM 은 장소를 만들 수 없고(INV-1), 고른 도구(정보 핸들러)가
등록 POI·스냅샷에서 사실을 모은다. 게이트가 그 닫힘을 강제한다:

  ① 모양: `{"calls": [...], "refused": bool|null, "gap": str|null}` — refused 가 bool·null 이 아니면("yes"·1 을 추측하지
     않는다), 거절이 아닌데 calls 가 없거나 목록이 아니면 parse_error(전량 폴백)
  ② refused=true → calls 를 **보기 전에** 성공(거절하는 모델은 calls 를 빼먹거나 아무렇게나 적는다 — 그래도 판단한 거절이다.
     오케스트레이터가 종전 범위 밖으로 낸다)
  ③ calls=[] → **성공·0건**(도구로 답할 부분이 없다는 판단, 추출 계열의 0건 성공 선례 TRIP-260 #5). gap 은 PLAN_GAPS 안이면
     그대로, 밖이면 OTHER. 폴백 지표(`llm_fallback_watch` — FallbackEvent ÷ 성공)를 판단 결과로 오염시키지 않는다
  ④ 호출 단위 격리:
     - 항목이 객체가 아님 / 도구가 Intent 밖 / 노출한 도구(`allowed`) 밖 → 그 호출을 버린다
     - args 를 미리 거른다: 값이 null 이거나 공백뿐인 칸은 **없는 칸**(모델이 빈 선택 인자를 그렇게 적는다 — 드롭으로 세지 않는다),
       계획 인자 키(`plan_argument_names` — 인자표 asked 에서 숨긴 인자를 뺀 것) 밖의 칸은 값이 중첩이어도 그 칸만 버린다
     - 남은 칸은 분류 게이트와 같은 `IntentGate._parse_slots`(한 표): 객체 아님·중첩·목록 값 → 호출을 버리고, enum 밖 값 → 그 칸만
     - 값 검사(그 칸만): 문자열 아님 / `inline` 뒤 `_violates`(빈 값·40자 초과·시간 표현·영문 소요·연락처·주입 꼴) /
       `clock_times`(HH:MM·대조 불가 한글 시각) — 인자의 시각이 문장의 허용 시각이 되지 않게(INV-2)
     - 인자가 있었는데 전부 버려진 호출은 버린다 — 남은 것은 다른 질문이다("15:00 이후 야경" → "근처 아무 곳")
     - 필수 인자가 비면 버린다 — 계획 경로는 되묻지 않는다
     - (도구, 인자) 가 완전히 같은 중복은 뒤를 버린다. 일정 슬롯 시각을 내는 도구(SHOW_SCHEDULE·GET_NEXT_SLOT)는 합쳐서 하나만 —
       둘이면 병합 순서가 스냅샷 순서와 달라져 답변의 순서 검사(INV-2)가 뒤집힌다(일정표가 다음 일정을 이미 담는다)
     - 살아남은 것 중 앞의 MAX_PLAN_CALLS 개만 둔다
  ⑤ 하나라도 버리면 GateDropEvent(dropped_ids=() — 풀 id 가 아니다): total = 입력 호출 수 + 살아남은 호출의 입력 키 수,
     dropped = 버린 호출 수 + 살아남은 호출에서 버린 칸 수(그래서 늘 dropped ≤ total). 늘면 프롬프트와 표가 갈라졌다는 신호다
  ⑥ 입력 호출이 있었는데 전부 버려지면 `gate_dropped_all` 로 폴백한다(값은 비운다 — 값과 오류를 함께 실으면 GateOutcome 이
     던진다). 게이트는 어떤 입력에도 던지지 않는다 — apply 는 게이트웨이의 try 밖이라, 던지면 호출 기록·폴백 이벤트 없이 끝난다
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime

from trippilot.domain.common import TraceId
from trippilot.domain.dialogue import missing_arguments
from trippilot.domain.intent import Intent, IntentDraft
from trippilot.domain.llm import CandidatePool, LlmFeature
from trippilot.domain.observability import GateDropEvent
from trippilot.domain.plan_tools import MAX_ARG_CHARS, MAX_PLAN_CALLS, PLAN_GAPS, PLAN_TOOLS, plan_argument_names
from trippilot.llm_gateway.gates.base import GateOutcome, empty_result_error, strip_code_fence
from trippilot.llm_gateway.gates.dialogue_answer import _violates, clock_times
from trippilot.llm_gateway.gates.intent import IntentGate
from trippilot.llm_gateway.prompts import inline


@dataclass(frozen=True, slots=True)
class DialoguePlanDraft:
    """게이트 통과값 — 고른 도구 호출(`IntentDraft` 재사용: intent·문자열 slots·confidence None) · 거절 · 도구 없음의 분류."""

    calls: tuple[IntentDraft, ...] = ()  # 0..2 — 비면 거절이거나 도구 없음
    refused: bool = False
    gap: str | None = None  # calls 가 비고 거절도 아닐 때만 — 관측 전용

    def __post_init__(self) -> None:
        if len(self.calls) > MAX_PLAN_CALLS:
            raise ValueError(f"도구 호출은 ≤{MAX_PLAN_CALLS}: {len(self.calls)}")
        if self.refused and self.calls:
            raise ValueError("거절이면 호출이 없다")
        if self.gap is not None and self.gap not in PLAN_GAPS:
            raise ValueError(f"gap 은 PLAN_GAPS 안: {self.gap!r}")
        if self.calls and self.gap is not None:
            raise ValueError("호출이 있으면 gap 이 없다")
        if not all(isinstance(v, str) for c in self.calls for v in c.slots.values()):
            raise ValueError("도구 인자 값은 전부 문자열")


# 일정 슬롯 시각(start_at) 짝을 내는 도구 — 계획당 합쳐서 하나
_SLOT_TIMED = frozenset({Intent.SHOW_SCHEDULE, Intent.GET_NEXT_SLOT})


class DialoguePlanGate:
    """`allowed` = 이 배선에서 노출한 도구(포트가 빠진 도구는 모델에게도 게이트에도 없다)."""

    def __init__(self, allowed: frozenset[Intent]) -> None:
        if not allowed or not set(allowed) <= set(PLAN_TOOLS):
            raise ValueError(f"allowed 는 PLAN_TOOLS 의 비어 있지 않은 부분집합: {sorted(i.value for i in allowed)}")
        self._allowed = frozenset(allowed)

    def apply(
        self,
        raw_text: str,
        pool: CandidatePool | None,
        *,
        feature: LlmFeature,
        trace_id: TraceId,
        now: datetime,
    ) -> GateOutcome:
        try:
            calls, refused, gap = _parse(raw_text)
        except ValueError as e:
            return GateOutcome(value=None, drop_event=None, error=f"parse_error: {e}")
        if refused:  # ② 판단한 거절 — calls 는 보지 않는다
            return GateOutcome(value=DialoguePlanDraft(refused=True), drop_event=None, error=None)
        if not calls:  # ③ 도구 없음 — 성공·0건
            closed_gap = None if gap is None else (gap if gap in PLAN_GAPS else "OTHER")
            return GateOutcome(value=DialoguePlanDraft(gap=closed_gap), drop_event=None, error=None)
        kept: list[IntentDraft] = []
        seen: set[tuple] = set()
        total, dropped = len(calls), 0
        for item in calls:
            call, keys_in, keys_dropped = self._call(item)
            key = (call.intent, tuple(sorted(call.slots.items()))) if call is not None else None
            if (call is None or key in seen or len(kept) >= MAX_PLAN_CALLS
                    or (call.intent in _SLOT_TIMED and any(k.intent in _SLOT_TIMED for k in kept))):
                dropped += 1
                continue
            seen.add(key)
            kept.append(call)
            total += keys_in
            dropped += keys_dropped
        drop_event = GateDropEvent(
            trace_id=trace_id, occurred_at=now, component="c1.gate", feature=feature.value,
            dropped_ids=(),  # 도구·인자 드롭은 풀 id 가 아니다 — 환각률 지표 순수성(nudge·intent 선례)
            total_count=total, dropped_count=dropped,
        ) if dropped else None
        if not kept:  # ⑥ 입력 호출이 있었는데 전부 버려졌다
            return GateOutcome(value=None, drop_event=drop_event, error=empty_result_error((), drop_event))
        return GateOutcome(value=DialoguePlanDraft(tuple(kept)), drop_event=drop_event, error=None)

    def _call(self, item: object) -> tuple[IntentDraft | None, int, int]:
        """④ 호출 하나 → (살아남은 호출 또는 None, 입력 키 수, 버린 칸 수)."""
        if not isinstance(item, dict):
            return None, 0, 0
        try:
            intent = Intent(item.get("tool"))
        except (ValueError, TypeError):
            return None, 0, 0
        if intent not in self._allowed:
            return None, 0, 0
        raw_args = item.get("args")
        given: dict = {}
        if isinstance(raw_args, dict):  # null·공백뿐인 칸은 없는 칸 — 빈 선택 인자를 그렇게 적는 출력이 흔하다
            given = {k: v for k, v in raw_args.items()
                     if v is not None and not (isinstance(v, str) and not v.strip())}
        elif raw_args is not None:
            return None, 0, 0  # args 가 객체가 아니다 — 모양이 깨졌다
        allowed = plan_argument_names(intent)
        known = {k: v for k, v in given.items() if k in allowed}  # 표 밖·숨긴 키는 값이 무엇이든 그 칸만 버린다
        try:
            slots, _, _ = IntentGate._parse_slots(known, intent)  # 분류와 같은 표·같은 검사(중첩·목록 값 → 호출째)
        except ValueError:
            return None, 0, 0
        args: dict[str, str] = {}
        for name, value in slots.items():
            if not isinstance(value, str):
                continue
            value = inline(value)
            if _violates(value, MAX_ARG_CHARS) or any(clock_times(value)):
                continue
            args[name] = value
        keys_in = len(given)
        if keys_in and not args:  # 인자가 있었는데 전부 버려졌다(표 밖 키 포함) — 다른 질문이 된다
            return None, 0, 0
        if missing_arguments(intent, frozenset(args)):  # 계획 경로는 되묻지 않는다
            return None, 0, 0
        return IntentDraft(intent=intent, slots=args), keys_in, keys_in - len(args)


def _parse(raw_text: str) -> tuple[list, bool, object]:
    """① 모양 — (calls, refused, gap). 위반은 ValueError."""
    try:
        data = json.loads(strip_code_fence(raw_text))
    except json.JSONDecodeError as e:
        raise ValueError(f"JSON 아님: {e.msg}") from e
    if not isinstance(data, dict):
        raise ValueError("최상위가 객체가 아님")
    refused = data.get("refused")
    if refused is not None and not isinstance(refused, bool):
        raise ValueError(f"refused 가 bool·null 이 아님: {refused!r}")
    if refused:  # 거절은 calls 모양보다 먼저 — 거절하는 출력은 calls 를 빼먹기도 한다
        return [], True, None
    calls = data.get("calls")
    if not isinstance(calls, list):
        raise ValueError('최상위가 {"calls": [...]} 형태가 아님')
    return calls, False, data.get("gap")
