"""도우미 오케스트레이터 — `POST /ai/v1/dialogue/interpret` 한 턴의 본체
(assistant-orchestrator FD BLM §3·§4·§6·§7·§8 · DE §2.1~§2.3·§2.8 · BR-AO-01~09·22·23·25).

종전 `DialogueInterpreter` 는 해석(의도 프레임)만 냈고 문장은 백엔드 템플릿이 만들었다. 여기서는 턴을 AI 안에서
끝낸다(사용자 결정 2026-10-17): LLM 직접 분류 → 의도별 핸들러 팬아웃 → LLM 답변 문장 → 세션 기억. 결과가
`ANSWER` 인 턴은 백엔드가 검증·저장만 한다. `EDIT_SCHEDULE` 은 1단계에서 종전처럼 `FRAME` 으로 넘긴다(BR-AO-17).

## 한 턴 (BLM §3 — 0~7)

0  리터럴 "내가 할 수 있는 것 보기" → 결정론 능력 안내 ANSWER (LLM 0, BR-AO-18)
1  보류 되묻기가 있으면 그 답으로 먼저 읽는다 (`dialogue_interpreter.answer_pending` 재사용, LLM 0)
2  `DIALOGUE_INTENT` 1회 → `IntentGate` closed-set → `IntentMatch(LLM_DIRECT)`; 실패는 전부 OUT_OF_SCOPE + 사유 (BR-AO-02)
2′ 분류 결과를 알게 된 직후 `ShadowIntentProbe.submit` — 기다리지 않는다, 응답 영향 0 (BR-AO-08)
3  필수 인자가 비면 ARGUMENT_CLARIFY (`from_match` 재사용 — 고정 문안·보기, 요청당 1회)
4  `HANDLERS[intent].plan(ctx)` → 공유 풀 팬아웃(submit 전 마감 고정 → wait → cancel → 상태값) → `assemble` → `Facts` (BR-AO-12)
5  `DIALOGUE_ANSWER` ≤1회 → `DialogueAnswerGate`; 실패·잔여 <1.5s 면 `Facts.template_text` (BR-AO-04·06)
6  세션 기억: due ∧ 잔여 ≥2.5s → `DIALOGUE_MEMORY`; 아니면 `compress_fallback`; 잔여 ≤0 이면 미룬다 (BR-AO-09)
7  `TurnOutcome` — `llm_calls` 는 서비스 경로 호출만(섀도 제외, BR-AO-07)

## 지키는 것

- **예외는 경계 밖으로 나가지 않는다**(DL-5, BR-AO-22) — 외부 호출은 전부 상태값으로 수렴하고, 자체 버그는
  `OUT_OF_SCOPE(reason="orchestrator_error: …")` 로 수렴한다(BR §5 미결 #14 A안). `PermissionDeniedError` 만
  관통한다(fail-closed, TRIP-333 — `InfoCollector` 와 같은 예외 1건).
- **시계는 주입**(`Clock.monotonic_ms`) — 잔여 = `deadline_ms − (now_ms − started_ms)`, 모든 하위 호출에 `timeout_sec` 로
  내리고 잔여 ≤0 이면 부르지 않는다(DL-4, BR-AO-01).
- **발화 원문·account_ref 를 로그에 싣지 않는다**(SEC-U8-06) — 로그는 trace_id·예외 타입까지.
- 보이는 시각·순서·거리·장소는 `Facts` 에서만(INV-2·3), 후보는 풀 안에서만(INV-1), 폴백은 전부 결정론 + 보고(INV-4).
  **의도된 결정론은 폴백이 아니다**(BLM §7) — 0단계·needTrip·`Facts.status=UNAVAILABLE` 직행에는 `FallbackEvent` 가 없다
  (팬아웃 실패는 작업별 `FallbackEvent(stage="fanout")` 로 이미 보고됐다). LLM 을 시도했거나 시도해야 했던 턴의 템플릿,
  게이트웨이를 부르지 못한 분류 폴백(잔여 0·워커 예외)에는 짝이 있다 — 관측은 트레이스 이벤트 한 길이다.
- **시한·상한은 모듈 상수**(BLM §4 배분표 — `_INTENT_CAP_MS`…) — env 로도 생성자로도 노출하지 않는다(BR-AO-13, 바뀌지 않는 값의
  설정화 금지). 시한 시나리오는 주입 시계(`FakeClock.advance`)로 만든다.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import Executor, ThreadPoolExecutor, wait
from dataclasses import dataclass, replace
from datetime import date, datetime, tzinfo

from trippilot.agents.schedule.agent import Clock
from trippilot.domain.common import TraceId
from trippilot.domain.context import PermissionDeniedError
from trippilot.domain.intent import ROUTABLE_INTENTS, Intent, IntentDraft, IntentMatch, MatchRoute
from trippilot.domain.observability import FallbackEvent
from trippilot.llm_gateway.gates.dialogue_answer import _MAX_FOOTNOTE
from trippilot.llm_gateway.workers.dialogue_answer import DialogueAnswerWorker
from trippilot.llm_gateway.workers.dialogue_intent import DialogueIntentWorker
from trippilot.llm_gateway.workers.dialogue_memory import DialogueMemoryWorker
from trippilot.orchestrator.dialogue_handlers import (
    HANDLERS,
    AnswerKind,
    FactStatus,
    Facts,
    HandlerPorts,
    HandlerTask,
    NextAction,
    QuickReplyDraft,
    TaskResult,
    TurnContext,
    TurnSnapshot,
    edit_arguments,
    validate_answer_shape,
    validate_answer_text,
)
from trippilot.orchestrator.dialogue_interpreter import (
    Clarify,
    DialogueContext,
    Frame,
    TripView,
    answer_pending,
    from_match,
    llm_call_counter,
)
from trippilot.orchestrator.dialogue_memory import (
    SUMMARY_EVERY_TURNS,
    DialogueMemory,
    MemoryStorePort,
    compress_fallback,
    due,
    expires_at_for,
)
from trippilot.orchestrator.intent_router import normalize
from trippilot.orchestrator.shadow_probe import ShadowIntentProbe
from trippilot.ports.trace_port import TracePort

__all__ = [
    "CAPABILITIES_LITERAL",
    "CAPABILITIES_TEXT",
    "DEFAULT_DEADLINE_MS",
    "MAX_RECENT_TURNS",
    "OUTCOMES",
    "RECENT_TURN_CHARS",
    "UTTERANCE_MAX_CHARS",
    "Clarify",
    "DialogueAnswer",
    "DialogueOrchestrator",
    "Frame",
    "RecentTurn",
    "TurnInput",
    "TurnOutcome",
    "capabilities_answer",
]

log = logging.getLogger(__name__)

_COMPONENT = "orchestrator.dialogue"
OUTCOMES: frozenset[str] = frozenset({"ANSWER", "FRAME", "ARGUMENT_CLARIFY", "OUT_OF_SCOPE"})
MAX_RECENT_TURNS = 20  # 경계 스키마 `recent_turns` 상한과 같은 값 (BR-AO-11)
RECENT_TURN_CHARS = 300  # 백엔드가 절단해 보낸다 — AI 는 다시 자르지 않고 받기만 한다
UTTERANCE_MAX_CHARS = 500  # 경계·라우터(`IntentRouterConfig.max_utterance_chars`)와 같은 값
_ROLES = frozenset({"USER", "ASSISTANT"})

# ── 시한·상한 (DE §2.8 · BLM §4 배분표) — 모듈 상수. 운영 조립도 테스트도 다른 값을 넣은 적이 없어 설정 묶음을 두지 않는다.
DEFAULT_DEADLINE_MS = 9_000  # 백엔드가 deadline 을 안 보냈을 때(BR §5 미결 #5) — 경계 사영(`api/dialogue.py`)이 쓴다
_INTENT_CAP_MS, _INTENT_SHARE = 2_500, 0.35  # 분류 LLM: min(cap, 잔여×share)
_FANOUT_CAP_MS, _FANOUT_SHARE = 3_000, 0.40  # 팬아웃 예산
_ANSWER_CAP_MS = 2_500
_ANSWER_RESERVE_MS = 400  # 게이트·사영·직렬화 몫
_ANSWER_MIN_REMAINING_MS = 1_500  # 미만이면 답변 LLM 을 부르지 않고 템플릿 (> _ANSWER_RESERVE_MS — 아니면 시한이 0 이하)
_MEMORY_MIN_REMAINING_MS = 2_500  # 미만이면 결정론 압축
_MEMORY_CAP_MS = 2_000
_OTHER_SESSIONS_LIMIT = 2  # "지난 여행 기억" — 같은 계정의 다른 세션 ≤2

# 0단계 — FE 상시 칩이 서버 발급 SHOW_CAPABILITIES 가 없을 때 이 문자열을 TEXT 턴으로 보낸다(BR-AO-18).
# 문장은 BE `AssistantTemplates.capabilities(hasTrip)` 그대로(DEC-U8-6: 화면 문장은 한 벌).
CAPABILITIES_LITERAL = "내가 할 수 있는 것 보기"
CAPABILITIES_LINE = "일정 검토, 다음 장소·날씨·거리 확인, 일정 변경 제안, 다시 짜기 안내를 도와드려요."
CAPABILITIES_TEXT = f"이런 걸 도와드릴 수 있어요. {CAPABILITIES_LINE}"
OTHER_SESSIONS_HEADER = "지난 여행 기억:"  # `$memory` 에서 현재 세션 줄과 다른 세션 줄을 가르는 머리 (DE §6 `$memory`)

# 게이트웨이 `default_fallback_modes` 와 같은 라벨 — LLM 을 **부르지 않고** 폴백한 턴(잔여 부족·워커 예외)에도 같은 짝을 남긴다
_INTENT_MODES = ("llm_dialogue_intent", "out_of_scope")
_ANSWER_MODES = ("llm_dialogue_answer", "template_text")
_MEMORY_MODES = ("llm_dialogue_memory", "deterministic_compress")
# 인프라 실패 접두(게이트웨이 `_invoke` 의 사유 + 호출 예외) — 모델이 판단해서 거절한 것이 아니라 거절 표지를 붙이지 않는다
_INFRA_PREFIXES = ("timeout", "llm_error", "unsupported", "intent_error")

# 팬아웃 풀 — 프로세스에 하나(BLM §6 "요청마다 만들지 않는다"). 스레드는 첫 submit 때 생긴다.
_DLG_POOL = ThreadPoolExecutor(8, thread_name_prefix="dialogue")


# ── 입력 (DE §2.1) ───────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class RecentTurn:
    """단기 기억 한 줄 — 백엔드가 최근 10턴(≤20건)을 싣는다. 원문은 저장하지 않는다(SEC-U8-06)."""

    role: str  # USER | ASSISTANT
    text: str  # 1..300 — 백엔드가 절단해 보낸다

    def __post_init__(self) -> None:
        if self.role not in _ROLES:
            raise ValueError(f"RecentTurn.role 은 {sorted(_ROLES)} 중 하나: {self.role!r}")
        if not 1 <= len(self.text) <= RECENT_TURN_CHARS:
            raise ValueError(f"RecentTurn.text 는 1..{RECENT_TURN_CHARS}자: {len(self.text)}자")


@dataclass(frozen=True, slots=True)
class TurnInput:
    """한 턴의 입력 — 경계 사영(`api/dialogue.py`)이 와이어 요청을 이 타입으로 바꾼다. 오케스트레이터는 스키마를 모른다."""

    utterance: str  # 1..500 (경계가 이미 검증)
    context: DialogueContext  # pending·turn_index·clarify_count — 백엔드가 저장·반송하는 직렬형
    snapshot: TurnSnapshot
    session_id: str | None  # 메모리 키 — 없으면 메모리 단계 전체 생략
    account_ref: str | None  # 불투명 — 로그·프롬프트 금지, 저장 칸과 "지난 여행 기억" 조회 키로만
    recent_turns: tuple[RecentTurn, ...]  # ≤ 20
    trace_id: TraceId
    now: datetime  # tz-aware
    deadline_ms: int  # > 0 — 백엔드 None 이면 사영이 `DEFAULT_DEADLINE_MS`
    started_ms: int  # 단조시계 원점 — 경계 진입 시 1회 (모든 잔여 계산의 기준)

    def __post_init__(self) -> None:
        if not 1 <= len(self.utterance) <= UTTERANCE_MAX_CHARS:
            raise ValueError(f"utterance 는 1..{UTTERANCE_MAX_CHARS}자: {len(self.utterance)}자")
        if self.deadline_ms <= 0:
            raise ValueError(f"deadline_ms > 0: {self.deadline_ms}")
        if len(self.recent_turns) > MAX_RECENT_TURNS:
            raise ValueError(f"recent_turns ≤ {MAX_RECENT_TURNS}: {len(self.recent_turns)}")
        if self.now.tzinfo is None:
            raise ValueError("TurnInput.now 는 tz-aware 만")


# ── 출력 (DE §2.2·§2.3) ──────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class DialogueAnswer:
    """사용자에게 보일 답변. 시각·거리·장소명은 전부 `Facts` 에서 복사된 값 — LLM 이 만드는 것은 `text`·`footnote` 뿐이다.

    post-init 은 답변 게이트와 **같은 검사**(`validate_answer_text`·`validate_answer_shape`)다 — 어긋나면 게이트 통과값이
    생성 불가가 된다(BR-AO-04). `Facts` 만으로 항상 만들어지는 것(`from_facts(text=None)`)이 INV-4 의 구조적 보장이다.
    """

    kind: AnswerKind
    text: str  # 1..400 · 줄 ≤6 · 시간 표현·연락처 없음
    payload: dict | None  # INFO/CANDIDATES 모양은 `validate_answer_shape` — LLM 이 건드리지 않는다
    next_actions: tuple[NextAction, ...]  # ≥ 1
    quick_replies: tuple[QuickReplyDraft, ...] | None  # None=시작 칩 복귀 · ()=상시 칩만 (FE sheetModel 의미)
    footnote: str | None  # ≤ 120

    def __post_init__(self) -> None:
        validate_answer_shape(self.kind, self.payload, self.next_actions, self.quick_replies)
        validate_answer_text(self.text)
        if self.footnote is not None:
            validate_answer_text(self.footnote, max_chars=_MAX_FOOTNOTE)

    @classmethod
    def from_facts(cls, facts: Facts, *, text: str | None = None, footnote: str | None = None) -> "DialogueAnswer":
        """`text=None` 이면 `Facts.template_text` — kind·payload·next_actions·quick_replies 는 어느 경우에도 Facts 값.
        문장의 출처(LLM·템플릿·의도된 결정론)는 타입에 두지 않는다 — 폴백은 `FallbackEvent` 가, 성공은 `LlmCallRecord` 가 말한다."""
        return cls(
            kind=facts.kind,
            text=text if text is not None else facts.template_text,
            payload=facts.payload,
            next_actions=facts.next_actions,
            quick_replies=facts.quick_replies,
            footnote=footnote if footnote is not None else facts.footnote,
        )

    def to_dict(self) -> dict:
        """와이어 모양(`DialogueAnswerSchema`)."""
        return {
            "kind": self.kind.value,
            "text": self.text,
            "payload": self.payload,
            "next_actions": [a.to_dict() for a in self.next_actions],
            "quick_replies": (
                [q.to_dict() for q in self.quick_replies] if self.quick_replies is not None else None
            ),
            "footnote": self.footnote,
        }


@dataclass(frozen=True, slots=True)
class TurnOutcome:
    """한 턴의 출력. post-init 불변식은 DE §2.2 표 — 위반하는 인스턴스는 생성 불가(AO-P10).

    `ANSWER` 의 프레임은 분류 프레임 1개(백엔드 관측 칸 `intent`·`match_route` 의 원천)지만, 0단계 능력 안내는
    분류를 거치지 않아 프레임이 없다 — 그래서 `ANSWER ⇒ frames ≤1` 로 둔다(BR §5 미결 #19 A안).
    """

    outcome: str  # OUTCOMES
    frames: tuple[Frame, ...]  # 길이 0 또는 1 (DEC-U8-11 단일 의도)
    clarify: Clarify | None
    answer: DialogueAnswer | None
    context: DialogueContext  # 갱신본 — turn_index 는 그대로(백엔드가 올린다, INV-U8-07)
    llm_calls: int  # ≥ 0 — 서비스 경로 호출만(섀도 제외, BR-AO-07), 실패 호출 포함
    reason: str | None = None  # 폴백·강등 사유 — 와이어 미노출; 같은 사유가 `FallbackEvent.reason` 으로 트레이스에 남는다

    def __post_init__(self) -> None:
        if self.outcome not in OUTCOMES:
            raise ValueError(f"outcome 은 {sorted(OUTCOMES)} 중 하나: {self.outcome!r}")
        if self.llm_calls < 0:
            raise ValueError(f"llm_calls ≥ 0: {self.llm_calls}")
        if len(self.frames) > 1:
            raise ValueError("프레임은 ≤1 — 다중 의도는 받지 않는다 (DEC-U8-11·BR-AO-03)")
        if self.outcome == "ANSWER":
            if self.answer is None or self.clarify is not None:
                raise ValueError("ANSWER 는 answer 필수 · clarify 없음")
        elif self.outcome == "FRAME":
            if self.answer is not None or self.clarify is not None or len(self.frames) != 1:
                raise ValueError("FRAME 은 프레임 1개 · answer·clarify 없음")
            if self.frames[0].missing:
                raise ValueError("FRAME 의 프레임은 실행 가능해야 한다(missing 비어 있음)")
        elif self.outcome == "ARGUMENT_CLARIFY":
            if self.clarify is None or self.answer is not None or len(self.frames) != 1:
                raise ValueError("ARGUMENT_CLARIFY 는 clarify·프레임 1개 필수 · answer 없음")
            if self.clarify.argument not in self.frames[0].missing:
                raise ValueError("clarify.argument 는 프레임의 missing 안이어야 한다")
        else:  # OUT_OF_SCOPE — 문장 없음(BE SCOPE 카드), 사유 필수(INV-4)
            if self.frames or self.answer is not None or self.clarify is not None or not self.reason:
                raise ValueError("OUT_OF_SCOPE 는 프레임·answer·clarify 없음 · reason 필수")


# ── 순수 조립 ────────────────────────────────────────────────────────────────


def capabilities_answer(has_trip: bool) -> DialogueAnswer:
    """0단계 — BE `AssistantTemplates.capabilities(hasTrip)` 이식. `quick_replies=None` 은 "시작 칩 복귀"
    (예시 빠른 답 StartQuickReplies 는 서버 발급이라 백엔드가 다시 보인다)."""
    action = NextAction("OPEN_ITINERARY", "일정 보기") if has_trip else NextAction("CREATE_TRIP", "여행 만들기")
    return DialogueAnswer(AnswerKind.TEXT, CAPABILITIES_TEXT, None, (action,), None, None)


def _trip_view(snapshot: TurnSnapshot) -> TripView:
    """되묻기 보기의 재료 — 일수와 스냅샷 순서대로의 슬롯 이름(`api/dialogue._trip_view` 와 같은 규칙)."""
    trip = snapshot.trip
    days = (trip.end_date - trip.start_date).days + 1 if trip is not None else 0
    names = tuple(s.name for d in sorted(snapshot.days, key=lambda d: d.date) for s in d.slots if s.name)
    return TripView(day_count=max(days, 0), slot_names=names)


def _trip_summary(snapshot: TurnSnapshot, today: date) -> str:
    """`$trip` 한 줄(DE §6) — 좌표·가격 없음. 여행이 없으면 빈 문자열(워커가 "(여행 없음)" 으로 적는다)."""
    trip = snapshot.trip
    if trip is None:
        return ""
    slots = sum(len(d.slots) for d in snapshot.days)
    return (
        f"여행 {' '.join(trip.regions) or '-'} {trip.start_date.isoformat()}~{trip.end_date.isoformat()} ({trip.phase})"
        f" · 오늘 {today.isoformat()} · 일정 {len(snapshot.days)}일 {slots}곳 · 화면 {snapshot.surface}"
    )


def _memory_lines(current: DialogueMemory | None, others: Sequence[DialogueMemory]) -> tuple[str, ...]:
    """`$memory` 재료 — 현재 세션 줄들 + 헤더 + 다른 세션(≤2) 줄들 (DE §6 `$memory`). 줄의 `inline()` 은 워커가 한다."""
    lines = list(current.summary) if current is not None else []
    other_lines = [line for m in others for line in m.summary]
    if other_lines:
        lines += [OTHER_SESSIONS_HEADER, *other_lines]
    return tuple(lines)


def _refusal_reason(error: str) -> str:
    """분류 폴백 사유 — `intent_eval.is_refusal` 이 "판단해서 거절"과 인프라 실패를 가를 수 있게.

    게이트가 모델 산출을 받아들이지 못한 것(null·closed-set 밖 라벨·깨진 JSON·슬롯 모양·출력 상한 절단)은 전부 "닫힌
    집합으로 분류하지 못했다"(`not_classifiable`) 다(AO-P6). 시한·벤더 예외·비지원은 모델의 판단이 아니라 표지를 붙이지
    않는다 — 장애를 거절로 세면 OUT_OF_SCOPE 정확도가 부풀려진다. 접두 `intent_fallback:` 은 `IntentRouter._classify` 와 같다.
    """
    reason = f"intent_fallback: {error}"
    if error.startswith(_INFRA_PREFIXES) or "not_classifiable" in error:
        return reason
    return f"intent_fallback: not_classifiable: {error}"


def _fallback_match(reason: str) -> IntentMatch:
    """섀도 기록의 서비스 측 — 분류 실패도 `refused` 로 비교 대상이다(FALLBACK 매치는 사유 필수)."""
    return IntentMatch(Intent.OUT_OF_SCOPE, {}, 0.0, MatchRoute.FALLBACK, reason=reason)


# ── 오케스트레이터 ───────────────────────────────────────────────────────────


class DialogueOrchestrator:
    """생성자 DI 만 — 워커 3종(각자 게이트웨이를 안고 있다)·메모리 스토어·핸들러 포트·시계·트레이스·시간대·섀도(선택).

    `confident_intent` 는 보류 되묻기 답을 "다른 요청인가"로 가르는 LLM 0회 판정(`IntentRouter.confident_intent`) —
    없으면 짧은 답은 답으로 읽는다(라우터가 임베딩 장애 때 하는 것과 같은 태도).
    `shadow_meta` 는 `intent_shadow` 로그의 측정 조건(bank_sha·임계·프롬프트 판본) — 배선이 채운다.
    """

    def __init__(
        self,
        *,
        intent_worker: DialogueIntentWorker,
        answer_worker: DialogueAnswerWorker,
        memory_worker: DialogueMemoryWorker,
        memory_store: MemoryStorePort | None,
        ports: HandlerPorts,
        clock: Clock,
        trace: TracePort,
        tz: tzinfo,
        shadow: ShadowIntentProbe | None = None,
        shadow_meta: Mapping[str, object] | None = None,
        confident_intent: Callable[[str], Intent | None] | None = None,
        pool: Executor | None = None,
    ) -> None:
        self._intent = intent_worker
        self._answer = answer_worker
        self._memory = memory_worker
        self._store = memory_store
        self._ports = ports
        self._clock = clock
        self._trace = trace
        self._tz = tz
        self._shadow = shadow
        self._shadow_meta: Mapping[str, object] = dict(shadow_meta or {})
        self._confident_intent = confident_intent if confident_intent is not None else (lambda _text: None)
        self._pool = pool if pool is not None else _DLG_POOL

    # ── 턴 ───────────────────────────────────────────────────────────────

    def turn(self, inp: TurnInput) -> TurnOutcome:
        """한 턴. 어떤 실패도 예외가 아니라 `TurnOutcome` 이다 — `PermissionDeniedError` 만 관통(fail-closed, TRIP-333)."""
        with llm_call_counter() as counter:
            current, others = self._load_memory(inp)
            try:
                outcome = self._core(inp, current, others, counter)
            except PermissionDeniedError:
                raise
            except Exception as e:  # noqa: BLE001 — DL-5: 버그도 경계 밖으로 내지 않는다(BR §5 미결 #14 A안)
                outcome = self._crashed(inp, e)
            self._remember(inp, current)  # outcome 과 무관하게 돈다(BLM §3 註) — 안에서 전부 수렴
            return replace(outcome, llm_calls=counter[0])

    def _core(
        self,
        inp: TurnInput,
        current: DialogueMemory | None,
        others: tuple[DialogueMemory, ...],
        counter: list[int],
    ) -> TurnOutcome:
        cleared = DialogueContext(turn_index=inp.context.turn_index)  # 보류는 이 턴으로 끝났다 — 턴 번호는 백엔드 몫
        text = normalize(inp.utterance)
        # 0 — 리터럴 능력 안내 (BR-AO-18): 분류 LLM 에 보내지 않는다
        if text == CAPABILITIES_LITERAL:
            return TurnOutcome("ANSWER", (), None, capabilities_answer(inp.snapshot.trip is not None), cleared, 0)
        if not text:
            return self._out_of_scope(inp, "empty_utterance")
        trip_view = _trip_view(inp.snapshot)
        today = inp.now.astimezone(self._tz).date()
        trip_summary = _trip_summary(inp.snapshot, today)
        memory_lines = _memory_lines(current, others)
        # 1 — 보류 되묻기의 답 (LLM 0). 답이 아니면 보류를 버리고 새 요청으로 (BR-DLG-24)
        interp = None
        if inp.context.pending is not None:
            interp = answer_pending(inp.utterance, inp.context, trip_view, self._confident_intent)
        if interp is None:
            # 2 — LLM 직접 분류 (+ 2′ 섀도 submit)
            match, reason = self._classify(inp, text, memory_lines, trip_summary, counter)
            if match is None:
                return self._out_of_scope(inp, reason or "intent_fallback")
            # 3 — 필수 인자 되묻기 (요청당 1회, 기존 로직)
            interp = from_match(match, inp.context, trip_view)
        if interp.outcome == "ARGUMENT_CLARIFY":
            return TurnOutcome("ARGUMENT_CLARIFY", interp.frames, interp.clarify, None, interp.context, 0, interp.reason)
        if interp.outcome == "OUT_OF_SCOPE":  # from_match 는 FALLBACK 매치에서만 — 여기로는 오지 않는다(방어)
            return self._out_of_scope(inp, interp.reason or "intent_not_routable")
        (frame,) = interp.frames
        handler = HANDLERS[frame.intent]
        ctx = TurnContext(
            snapshot=inp.snapshot, arguments=frame.arguments, now=inp.now, tz=self._tz, trace_id=inp.trace_id,
            remaining_ms=lambda: self._remaining(inp), ports=self._ports,
        )
        if handler.handoff_frame:  # EDIT_SCHEDULE — 1단계 FRAME (BR-AO-17): 인자만 정리하고 BE 제안 경로로
            tidy = replace(frame, arguments=edit_arguments(ctx))
            return TurnOutcome("FRAME", (tidy,), None, None, cleared, 0, interp.reason)
        # 4 — 팬아웃 → Facts (순수 조립)
        results = self._fanout(inp, handler.plan(ctx))
        facts = handler.assemble(ctx, results)
        # 5 — 답변 문장
        answer = self._compose(inp, frame.intent, facts, memory_lines, trip_summary)
        return TurnOutcome("ANSWER", (frame,), None, answer, cleared, 0, interp.reason)

    # ── 2 분류 · 2′ 섀도 ─────────────────────────────────────────────────

    def _classify(
        self, inp: TurnInput, text: str, memory_lines: Sequence[str], trip_summary: str, counter: list[int],
    ) -> tuple[IntentMatch | None, str | None]:
        """`DIALOGUE_INTENT` 1회 → (매치, None) 또는 (None, 사유). 결과를 알게 된 직후 섀도에 넘긴다.

        게이트웨이가 돌려준 폴백(`is_fallback`)은 게이트웨이가 `FallbackEvent` 를 냈다. 게이트웨이를 **부르지 못한** 두 경로
        (잔여 0·워커 예외)는 아무도 내지 않으므로 여기서 같은 짝(`_INTENT_MODES`)을 낸다 — 아니면 OUT_OF_SCOPE 가 트레이스
        0줄로 나간다(INV-4, BLM §7 분류 행).
        """
        remaining = self._remaining(inp)
        timeout_ms = min(_INTENT_CAP_MS, int(remaining * _INTENT_SHARE))
        calls_before, started = counter[0], self._clock.monotonic_ms()
        match: IntentMatch | None = None
        reason: str | None = None
        if remaining <= 0 or timeout_ms <= 0:  # BR-AO-01 — 잔여 없이 부르지 않는다
            reason = f"timeout: budget exhausted before classification (remaining_ms={remaining})"
            self._fallback(inp, "llm", *_INTENT_MODES, reason)
        else:
            try:
                result = self._intent.classify(
                    text, inp.recent_turns, memory_lines, trip_summary, inp.trace_id, inp.now,
                    timeout_sec=timeout_ms / 1000,
                )
            except Exception as e:  # noqa: BLE001 — 게이트웨이는 던지지 않지만, 던져도 상태값이다
                result = None
                reason = f"intent_error: {type(e).__name__}: {e}"
                self._fallback(inp, "llm", *_INTENT_MODES, reason)
            if result is not None:
                draft = result.value
                if result.is_fallback or not isinstance(draft, IntentDraft):
                    reason = _refusal_reason(result.error or "intent_bad_shape")
                elif draft.intent not in ROUTABLE_INTENTS:  # OUT_OF_SCOPE 라벨 = 위임 불가 (IntentRouter 와 같은 분담)
                    reason = f"intent_not_routable({draft.intent.value})"
                else:
                    confidence = draft.confidence if draft.confidence is not None else 0.5
                    match = IntentMatch(
                        intent=draft.intent, slots=dict(draft.slots), confidence=max(0.0, min(1.0, confidence)),
                        match_route=MatchRoute.LLM_DIRECT,
                    )
        self._submit_shadow(
            inp, match if match is not None else _fallback_match(reason or "intent_fallback"),
            service_ms=self._clock.monotonic_ms() - started, service_llm_calls=counter[0] - calls_before,
        )
        return match, reason

    def _submit_shadow(self, inp: TurnInput, service: IntentMatch, *, service_ms: int, service_llm_calls: int) -> None:
        if self._shadow is None:
            return
        try:  # submit 은 던지지 않는 계약이지만 응답 경로는 어떤 경우에도 계속 간다(BR-AO-08 ⑥)
            self._shadow.submit(
                inp.utterance, inp.trace_id, inp.now, service=service, service_ms=service_ms,
                service_llm_calls=service_llm_calls, turn_index=inp.context.turn_index, meta=self._shadow_meta,
            )
        except Exception as e:  # noqa: BLE001
            log.warning("intent_shadow submit 실패(%s) — 응답 영향 없음 (trace_id=%s)", type(e).__name__, inp.trace_id)

    # ── 4 팬아웃 ─────────────────────────────────────────────────────────

    def _fanout(self, inp: TurnInput, tasks: Sequence[HandlerTask]) -> dict[str, TaskResult]:
        """공유 풀 팬아웃 (BLM §6, `route_budget.measure_within` 선례) — 마감은 submit **전에** 고정, 미완은 cancel 뒤 TIMEOUT.

        예외는 상태값(UNAVAILABLE)으로, `PermissionDeniedError` 만 관통한다. 결과는 작업 `name` 키 — 도착 순서 무관.
        OK 가 아닌 작업마다 `FallbackEvent(stage="fanout", from=작업명, to=상태)` 1건 — 조립기는 상태값으로 템플릿을 고르고
        답변 단계는 그 템플릿 직행에 이벤트를 더 내지 않으므로(BR-AO-25), Provider 장애가 운영자에게 보이는 자리는 여기뿐이다.
        """
        if not tasks:
            return {}
        budget_ms = min(_FANOUT_CAP_MS, int(self._remaining(inp) * _FANOUT_SHARE))
        if budget_ms <= 0:  # 잔여 없이 제출하지 않는다 — SKIPPED 상태값으로 조립기가 템플릿을 고른다
            for t in tasks:
                self._fallback(inp, "fanout", t.name, "SKIPPED", f"budget_exhausted(remaining_ms={self._remaining(inp)})")
            return {t.name: TaskResult.failed(t.name, "SKIPPED") for t in tasks}
        end_ms = self._clock.monotonic_ms() + budget_ms
        futures = {}
        results: dict[str, TaskResult] = {}
        for task in tasks:
            try:
                futures[task.name] = self._pool.submit(task.fn)
            except Exception as e:  # noqa: BLE001 — 풀이 닫혔다 등: 그 작업만 SKIPPED
                results[task.name] = self._failed_task(inp, task.name, "SKIPPED", f"submit: {type(e).__name__}")
        if futures:
            done, pending = wait(futures.values(), timeout=max(0, end_ms - self._clock.monotonic_ms()) / 1000)
            for f in pending:
                f.cancel()  # 줄 선 것은 취소, 이미 도는 것은 결과를 버린다 — 기다리지 않는다
            for name, f in futures.items():
                if f not in done:
                    results[name] = self._failed_task(inp, name, "TIMEOUT", f"fanout_deadline(budget_ms={budget_ms})")
                    continue
                try:
                    value = f.result()
                except PermissionDeniedError:
                    raise  # fail-closed (TRIP-333) — 상태값으로 눌러 답하지 않는다
                except Exception as e:  # noqa: BLE001 — Provider·PlanB 예외는 상태값 (IO-7); 사유는 예외 타입까지(SEC-U8-06)
                    results[name] = self._failed_task(inp, name, "UNAVAILABLE", f"task_error: {type(e).__name__}")
                    continue
                if isinstance(value, Mapping):
                    results[name] = TaskResult.ok(name, value)
                else:
                    results[name] = self._failed_task(inp, name, "UNAVAILABLE", "bad_shape")
        return results

    def _failed_task(self, inp: TurnInput, name: str, status: str, reason: str) -> TaskResult:
        self._fallback(inp, "fanout", name, status, reason)
        return TaskResult.failed(name, status)

    # ── 5 답변 ───────────────────────────────────────────────────────────

    def _compose(
        self,
        inp: TurnInput,
        intent: Intent,
        facts: Facts,
        memory_lines: Sequence[str],
        trip_summary: str,
    ) -> DialogueAnswer:
        """LLM 문장 ≤1회. 의도된 결정론(needTrip·UNAVAILABLE)은 LLM 미시도·FallbackEvent 없음(BR-AO-23·25 — 팬아웃 실패는
        `_fanout` 이 작업별로 이미 냈다); 시도했거나 해야 했던 턴의 템플릿에는 FallbackEvent 짝(게이트웨이가 냈거나 여기서 낸다)."""
        if facts.needs_trip or facts.status is FactStatus.UNAVAILABLE:
            return DialogueAnswer.from_facts(facts)
        remaining = self._remaining(inp)
        if remaining < _ANSWER_MIN_REMAINING_MS:
            self._fallback(inp, "llm", *_ANSWER_MODES, f"budget_exhausted(remaining_ms={remaining})")
            return DialogueAnswer.from_facts(facts)
        timeout_ms = min(_ANSWER_CAP_MS, remaining - _ANSWER_RESERVE_MS)
        try:
            result = self._answer.compose(
                intent, facts.to_prompt_dict(), inp.utterance, inp.recent_turns, memory_lines, trip_summary,
                inp.trace_id, inp.now, timeout_sec=timeout_ms / 1000,
            )
        except Exception as e:  # noqa: BLE001
            self._fallback(inp, "llm", *_ANSWER_MODES, f"answer_error: {type(e).__name__}: {e}")
            return DialogueAnswer.from_facts(facts)
        draft = result.value
        if result.is_fallback or draft is None:  # FallbackEvent 는 게이트웨이가 냈다
            return DialogueAnswer.from_facts(facts)
        try:
            return DialogueAnswer.from_facts(facts, text=draft.text, footnote=draft.footnote)
        except ValueError as e:  # 게이트와 같은 검사라 여기 오면 게이트가 어긋난 것 — 그래도 템플릿
            self._fallback(inp, "llm", *_ANSWER_MODES, f"answer_shape: {e}")
            return DialogueAnswer.from_facts(facts)

    # ── 6 메모리 ─────────────────────────────────────────────────────────

    def _load_memory(self, inp: TurnInput) -> tuple[DialogueMemory | None, tuple[DialogueMemory, ...]]:
        """턴 시작에 현재 세션 기억 + 같은 계정의 다른 세션 ≤2. 읽기 실패는 "기억 없이 진행"(BR-AO-09) — WARN 1줄."""
        if self._store is None or not inp.session_id:
            return None, ()
        current: DialogueMemory | None = None
        others: tuple[DialogueMemory, ...] = ()
        try:
            current = self._store.get(inp.session_id)
        except Exception as e:  # noqa: BLE001
            log.warning("도우미 기억 읽기 실패(%s) — 기억 없이 진행 (trace_id=%s)", type(e).__name__, inp.trace_id)
        if inp.account_ref:
            try:
                others = tuple(self._store.recent_for_account(
                    inp.account_ref, exclude_session=inp.session_id, limit=_OTHER_SESSIONS_LIMIT))
            except Exception as e:  # noqa: BLE001
                log.warning("지난 여행 기억 읽기 실패(%s) — 현재 세션 기억만 (trace_id=%s)", type(e).__name__, inp.trace_id)
        return current, others

    def _remember(self, inp: TurnInput, current: DialogueMemory | None) -> None:
        if self._store is None or not inp.session_id:
            return
        summarized = current.summarized_turn_index if current is not None else 0
        if not due(inp.context.turn_index, summarized, every=SUMMARY_EVERY_TURNS):
            return
        try:
            self._summarize_and_put(inp, current)
        except Exception as e:  # noqa: BLE001 — 기억은 응답 품질과 무관하다: 어떤 실패도 턴을 막지 않는다
            self._fallback(inp, "memory", _MEMORY_MODES[0], "skipped", f"memory_error: {type(e).__name__}: {e}")

    def _summarize_and_put(self, inp: TurnInput, current: DialogueMemory | None) -> None:
        """BLM §8 — 잔여 ≥2.5s 면 LLM 요약, 미만이면 결정론 압축, ≤0 이면 압축·put 없이 미룬다(due 유지). 실패는 전부 압축."""
        remaining = self._remaining(inp)
        previous = current.summary if current is not None else ()
        if remaining <= 0:
            self._fallback(inp, "memory", _MEMORY_MODES[0], "deferred", f"budget_exhausted(remaining_ms={remaining})")
            return
        turns = inp.recent_turns
        today = inp.now.astimezone(self._tz).date()
        if not turns:  # 재료 없이 LLM 을 부르지 않는다 — 의도된 결정론, 폴백 아님 (BR-AO-25)
            lines = compress_fallback((), previous)
        elif remaining >= _MEMORY_MIN_REMAINING_MS:
            lines = self._summarize(inp, previous, turns, _trip_summary(inp.snapshot, today), remaining)
        else:
            lines = compress_fallback(turns, previous)
            self._fallback(inp, "memory", *_MEMORY_MODES, f"budget_short(remaining_ms={remaining})")
        trip_id = inp.snapshot.trip.trip_id if inp.snapshot.trip is not None else None
        try:
            record = DialogueMemory(
                inp.session_id, inp.account_ref, trip_id, lines, inp.context.turn_index, inp.now, expires_at_for(inp.now))
        except ValueError as e:  # LLM 줄이 상한을 어겼다(줄 안 줄바꿈 등 — 게이트가 못 본 것) — 결정론 압축으로
            self._fallback(inp, "memory", *_MEMORY_MODES, f"memory_shape: {e}")
            record = DialogueMemory(
                inp.session_id, inp.account_ref, trip_id, compress_fallback(turns, previous), inp.context.turn_index,
                inp.now, expires_at_for(inp.now))
        try:
            self._store.put(record)
        except Exception as e:  # noqa: BLE001 — 이번 턴 포기, summarized_turn_index 불변 → 다음 턴 due 유지
            self._fallback(inp, "memory", _MEMORY_MODES[0], "skipped", f"store_put_failed: {type(e).__name__}")

    def _summarize(
        self,
        inp: TurnInput,
        previous: tuple[str, ...],
        turns: tuple[RecentTurn, ...],
        trip_summary: str,
        remaining: int,
    ) -> tuple[str, ...]:
        timeout_ms = min(_MEMORY_CAP_MS, remaining)
        try:
            result = self._memory.summarize(
                previous, turns, trip_summary, inp.trace_id, inp.now, timeout_sec=timeout_ms / 1000,
            )
        except Exception as e:  # noqa: BLE001
            self._fallback(inp, "memory", *_MEMORY_MODES, f"memory_error: {type(e).__name__}: {e}")
            return compress_fallback(turns, previous)
        if result.is_fallback or not result.value:  # FallbackEvent 는 게이트웨이가 냈다 (빈 결과 = 실패)
            return compress_fallback(turns, previous)
        return tuple(result.value)

    # ── 공통 ─────────────────────────────────────────────────────────────

    def _remaining(self, inp: TurnInput) -> int:
        return inp.deadline_ms - (self._clock.monotonic_ms() - inp.started_ms)

    def _out_of_scope(self, inp: TurnInput, reason: str) -> TurnOutcome:
        return TurnOutcome("OUT_OF_SCOPE", (), None, None, DialogueContext(turn_index=inp.context.turn_index), 0, reason)

    def _crashed(self, inp: TurnInput, e: Exception) -> TurnOutcome:
        """오케스트레이터 자체 예외(버그) — OUT_OF_SCOPE 로 수렴하고 보고한다(미결 #14 A안). 로그에 발화는 없다."""
        log.error("dialogue turn 실패 — OUT_OF_SCOPE 로 수렴 (trace_id=%s, %s)", inp.trace_id, type(e).__name__,
                  exc_info=True)
        reason = f"orchestrator_error: {type(e).__name__}: {e}"
        self._fallback(inp, "orchestrator", "dialogue_orchestrator", "out_of_scope", reason)
        return self._out_of_scope(inp, reason)

    def _fallback(self, inp: TurnInput, stage: str, from_mode: str, to_mode: str, reason: str) -> None:
        """INV-4 — 폴백은 보고와 짝이다. 계측 실패는 비즈니스 실패가 아니다(TracePort 계약)."""
        try:
            self._trace.emit(FallbackEvent(
                trace_id=inp.trace_id, occurred_at=inp.now, component=_COMPONENT, stage=stage,
                from_mode=from_mode, to_mode=to_mode, reason=reason,
            ))
        except Exception:  # noqa: BLE001
            pass
