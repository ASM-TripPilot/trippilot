"""도우미 오케스트레이터 — `POST /ai/v1/dialogue/interpret` 한 턴의 본체
(assistant-orchestrator FD BLM §3·§4·§6·§7·§8 · DE §2.1~§2.3·§2.8 · BR-AO-01~09·22·23·25).

종전 `DialogueInterpreter` 는 해석(의도 프레임)만 냈고 문장은 백엔드 템플릿이 만들었다. 여기서는 턴을 AI 안에서
끝낸다(사용자 결정 2026-10-17): LLM 직접 분류 → 의도별 핸들러 팬아웃 → LLM 답변 문장 → 세션 기억. 결과가
`ANSWER` 인 턴은 백엔드가 검증·저장만 한다. `EDIT_SCHEDULE` 은 1단계에서 종전처럼 `FRAME` 으로 넘긴다(BR-AO-17).

## 한 턴 (BLM §3 — 0~7)

0  리터럴 "내가 할 수 있는 것 보기" → 결정론 능력 안내 ANSWER (LLM 0, BR-AO-18)
1  보류 되묻기가 있으면 그 답으로 먼저 읽는다 (`dialogue_interpreter.answer_pending` 재사용, LLM 0)
2  `DIALOGUE_INTENT` 1회 → `IntentGate` closed-set → `IntentMatch(LLM_DIRECT)`; 실패는 전부 OUT_OF_SCOPE + 사유 (BR-AO-02)
2″ 분류가 할 일 없음으로 닫았고(null·범위 밖 라벨) 발화가 맞장구·인사 낱말뿐이면 받아 주는 한마디 ANSWER — 범위 밖 카드 대신 (BR-AO-26)
2‴ 그 밖에 분류가 판단해서 닫은 말(null·범위 밖 라벨·목록 밖 라벨)은 계획 워커가 있으면 `DIALOGUE_PLAN` 1회 → 닫힌 조회 도구(정보
   핸들러) ≤2 → 팬아웃 1회 → `merge_facts` → 5단계 답변(목록 밖 장소 검사 강제) → 프레임 없는 ANSWER. 도구 없음·거절·실패·시한
   부족은 종전 OUT_OF_SCOPE (BR-AO-28)
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
  **의도된 결정론은 폴백이 아니다**(BLM §7) — 0단계·needTrip·`Facts.status=UNAVAILABLE`·사실 없는 `Facts` 직행·맞장구 답(2″)에는 답변 단계 `FallbackEvent` 가 없다
  (팬아웃 실패는 작업별 `FallbackEvent(stage="fanout")` 로 이미 보고됐다). LLM 을 시도했거나 시도해야 했던 턴의 템플릿,
  게이트웨이를 부르지 못한 분류 폴백(잔여 0·워커 예외)에는 짝이 있다 — 관측은 트레이스 이벤트 한 길이다.
- **시한·상한은 모듈 상수**(BLM §4 배분표 — `_INTENT_CAP_MS`…) — env 로도 생성자로도 노출하지 않는다(BR-AO-13, 바뀌지 않는 값의
  설정화 금지). 시한 시나리오는 주입 시계(`FakeClock.advance`)로 만든다.
"""

from __future__ import annotations

import contextvars
import json
import logging
import re
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import Executor, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass, replace
from datetime import date, datetime, tzinfo

from trippilot.agents.schedule.agent import Clock
from trippilot.domain.common import TraceId
from trippilot.domain.context import PermissionDeniedError
from trippilot.domain.intent import DIALOGUE_INTENTS, ROUTABLE_INTENTS, Intent, IntentDraft, IntentMatch, MatchRoute
from trippilot.domain.observability import FallbackEvent
from trippilot.llm_gateway.gates.base import has_injection_like
from trippilot.llm_gateway.gates.dialogue_answer import _MAX_FOOTNOTE, clock_spans, clock_times
from trippilot.llm_gateway.gates.dialogue_plan import DialoguePlanDraft
from trippilot.llm_gateway.gates.intent import NULL_INTENT
from trippilot.llm_gateway.workers.dialogue_answer import DialogueAnswerWorker
from trippilot.llm_gateway.workers.dialogue_intent import DialogueIntentWorker
from trippilot.llm_gateway.workers.dialogue_memory import DialogueMemoryWorker
from trippilot.llm_gateway.workers.dialogue_smalltalk import DialogueSmalltalkWorker
from trippilot.llm_gateway.workers.dialogue_plan import DialoguePlanWorker
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
    insert_day,
    validate_answer_shape,
    validate_answer_text,
)
from trippilot.orchestrator.dialogue_interpreter import (
    Clarify,
    DialogueContext,
    Frame,
    PendingFrame,
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
    is_turn_fragment,
)
from trippilot.orchestrator.dialogue_plan import has_facts, merge_facts, step_results, step_tasks
from trippilot.orchestrator.intent_router import normalize
from trippilot.orchestrator.shadow_probe import ShadowIntentProbe
from trippilot.ports.trace_port import TracePort

__all__ = [
    "ACK_TEXT",
    "CAPABILITIES_LITERAL",
    "CHAT_TEXT",
    "GREETING_TEXT",
    "CAPABILITIES_TEXT",
    "DEFAULT_DEADLINE_MS",
    "MAX_RECENT_TURNS",
    "OUTCOMES",
    "RECENT_TURN_CHARS",
    "THANKS_TEXT",
    "UTTERANCE_MAX_CHARS",
    "Clarify",
    "DialogueAnswer",
    "DialogueOrchestrator",
    "Frame",
    "RecentTurn",
    "TurnInput",
    "TurnOutcome",
    "capabilities_answer",
    "closer_answer",
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
# 분류 LLM: min(cap, 잔여×share). 실측(2026-10-18, gpt-5.6-luna·프롬프트 ≈2,000토큰 20턴): 끝난 턴 p50 1.6s·p90 1.9s·최대 2.3s,
# 1턴은 2.5s 상한에서 잘렸다(실제 값 미상) → 범위 밖 카드(BE 거절 스트릭까지 오른다). 4.0s·0.45 로 올려도 최악 합은 9s 안(BLM §4).
_INTENT_CAP_MS, _INTENT_SHARE = 4_000, 0.45
_FANOUT_CAP_MS, _FANOUT_SHARE = 3_000, 0.40  # 팬아웃 예산
_ANSWER_CAP_MS = 3_500  # 같은 실측 p50 1.6s·p90 2.4s, 2.5s 에서 17턴 중 2턴이 템플릿으로 떨어졌다
_ANSWER_RESERVE_MS = 400  # 게이트·사영·직렬화 몫
_ANSWER_MIN_REMAINING_MS = 1_500  # 미만이면 답변 LLM 을 부르지 않고 템플릿 (> _ANSWER_RESERVE_MS — 아니면 시한이 0 이하)
_MEMORY_MIN_REMAINING_MS = 2_500  # 미만이면 결정론 압축
# 2‴ 계획 LLM(BR-AO-28): min(cap, 잔여×share). 잔여 < 4.6s 면 부르지 않는다 — 계획이 몫(0.45R)을 다 쓰고 팬아웃이 남은 것의
# 0.40 을 다 써도 답변 앞 잔여 ≥1.5s(답변 시도선)이려면 R ≥ 4,542ms(정수 내림 산술: 4,542 → 계획 2,043 → 2,499 → 팬아웃 999
# → 1,500). 4,500 이면 1,485 라 늘 템플릿이다(정정본 C1). 상한 3.5s(초판 3.0s) — 2026-10-20 luna·effort none 실측에서 3.0s 는
# 같은 시각 짝에서 시한 잘림이 4/78 → 2/78 이었다(같은 날 런 합 3.0s 10/154 · 3.5s 15/864 — 시각·판본이 섞인 합, 러너의 SDK
# 단위 시한 기준). 운영 실효 시한은 min(3.5s, 0.45R) 라 분류 1.6s 턴은 ≈3.33s 다. 하한 산술은 몫(0.45R)만 쓰므로 상한과 무관하다.
_PLAN_CAP_MS, _PLAN_SHARE, _PLAN_MIN_REMAINING_MS = 3_500, 0.45, 4_600
_TURN_LLM_CAP = 3  # 턴당 서비스 LLM 상한(BR-AO-07·COST-U8-06) — 계획 턴(분류·계획·답변)에서 닿으면 요약을 한 번 미룬다(BR-AO-09)
_MEMORY_CAP_MS = 2_000
_HEALTHY_STATUSES = frozenset({"OK", "LOW"})  # 작업 값의 status 중 강등이 아닌 것 (ProviderStatus OK·LOW)
_REASON_CODE = re.compile(r"[a-z_]{1,40}(?::[A-Za-z_]{1,60})?")  # 이벤트 사유는 코드만 — 예외 메시지(키 든 URL)는 싣지 않는다
_OTHER_SESSIONS_LIMIT = 2  # "지난 여행 기억" — 같은 계정의 다른 세션 ≤2

# 0단계 — FE 상시 칩이 서버 발급 SHOW_CAPABILITIES 가 없을 때 이 문자열을 TEXT 턴으로 보낸다(BR-AO-18).
# 문장은 BE `AssistantTemplates.capabilities(hasTrip)` 그대로(DEC-U8-6: 화면 문장은 한 벌).
CAPABILITIES_LITERAL = "내가 할 수 있는 것 보기"
CAPABILITIES_LINE = "일정 검토, 다음 장소·날씨·거리 확인, 일정 변경 제안, 다시 짜기 안내를 도와드려요."
CAPABILITIES_TEXT = f"이런 걸 도와드릴 수 있어요. {CAPABILITIES_LINE}"
# 0′ 입구 거절 사유 — `intent_eval.is_refusal` 이 "판단해서 거절"로 세는 표지(`not_classifiable`)를 단다(장애로 세지 않게)
INJECTION_REASON = "intent_fallback: not_classifiable: injection_suspected"
# 2″ — 맞장구·인사 (BR-AO-26). 분류가 할 일 없음으로 닫은 말(`{"intent": null}`·범위 밖 라벨) 가운데 낱말이 **전부**
# 아래 목록인 것만. 제안 뒤의 "응"은 분류가 먼저 그 제안의 의도로 읽고(dialogue_intent 0.2.2), 요청이 섞인 말은 목록 밖
# 낱말이 있어 분류 몫이다. 깨진 출력·절단·시한·벤더 실패는 판단이 아니라 종전대로 범위 밖 — 제안 뒤 "응"에 아무 일 없이
# "알겠어요"로 답하면 수락을 삼킨다.
_THANKS = frozenset({"고마워", "고마워요", "고맙습니다", "감사해요", "감사합니다", "땡큐", "thanks"})
_ACKS = frozenset({
    "응", "응응", "네", "네네", "넹", "넵", "예", "좋아", "좋아요", "그래", "그래요", "알겠어", "알겠어요", "알았어", "오케이", "ok",
    "아니", "아니요", "아뇨", "괜찮아", "괜찮아요", "됐어", "됐어요", "다음에",
})
# 낱말 사이·끝의 문장부호와 웃음. normalize(NFKC)가 ㅎ·ㅋ(호환 자모)를 첫소리 자모 ᄒ·ᄏ 로 바꾸므로 둘 다 적는다.
# "?"는 떼지 않는다 — "응?"은 수락이 아니라 되묻는 말이다.
_CLOSER_NOISE = re.compile(r"[\s!~.,ㅎㅋᄒᄏ]+")
# 인사 — "안녕" 한마디에 범위 밖 카드가 나가면 딱딱하다(2026-10-21 사용자). 받아 주고 여행 쪽으로 한마디 잇는다. 요청이 섞인
# "안녕 내일 날씨는" 은 목록 밖 낱말이 있어 분류 몫 그대로다.
_GREETS = frozenset({
    "안녕", "안녕하세요", "안녕하세용", "안녕하십니까", "안뇽", "하이", "하이요", "헬로", "헬로우", "hello", "hi", "hey",
    "반가워", "반가워요", "반갑습니다", "방가", "방가워", "굿모닝", "굿이브닝",
})
THANKS_TEXT = "천만에요! 더 궁금한 게 생기면 언제든 물어봐 주세요."
ACK_TEXT = "알겠어요! 필요한 게 생기면 언제든 말씀해 주세요."
# 인사·잡담 답 — 여행이 있으면 지금 여행으로, 없으면 여행 만들기로 잇는다(버튼은 `_home_action` 과 같은 갈래). DIALOGUE_SMALLTALK 이
# 배정돼 있으면 LLM 이 즉석에서 짓고(`_smalltalk`), 미배정·실패·목록 밖 장소면 이 고정 문장이다(INV-4 마지막 계단, BR-AO-26 개정 10-22).
GREETING_TEXT = {
    True: "네, 안녕하세요~ 여행 준비는 잘 되고 있나요? 다음 장소나 날씨, 근처에 가 볼 만한 곳이 궁금하면 편하게 물어봐 주세요.",
    False: "네, 안녕하세요~ 어디로 떠날 생각이세요? 여행을 만들면 일정이랑 날씨, 가 볼 만한 곳을 같이 챙겨 드릴게요.",
}
# 2‴ 계획기가 잡담(gap CHAT)으로 닫은 말 — 도구로 답할 건 없지만 범위 밖 카드 대신 말을 받아 준다.
CHAT_TEXT = {
    True: "저랑은 여행 이야기가 제일 잘 통해요. 다음 장소나 날씨, 근처에 가 볼 만한 곳이 궁금하면 편하게 물어봐 주세요.",
    False: "저랑은 여행 이야기가 제일 잘 통해요. 어디로 떠날지 정해지면 여행을 만들어 보세요. 일정이랑 날씨를 같이 챙겨 드릴게요.",
}
OTHER_SESSIONS_HEADER = "지난 여행 기억:"  # `$memory` 에서 현재 세션 줄과 다른 세션 줄을 가르는 머리 (DE §6 `$memory`)

# 게이트웨이 `default_fallback_modes` 와 같은 라벨 — LLM 을 **부르지 않고** 폴백한 턴(잔여 부족·워커 예외)에도 같은 짝을 남긴다
_INTENT_MODES = ("llm_dialogue_intent", "out_of_scope")
_ANSWER_MODES = ("llm_dialogue_answer", "template_text")
_MEMORY_MODES = ("llm_dialogue_memory", "deterministic_compress")
_PLAN_MODES = ("llm_dialogue_plan", "out_of_scope")
_SMALLTALK_MODES = ("llm_dialogue_smalltalk", "fixed_text")
# 인프라 실패 접두(게이트웨이 `_invoke` 의 사유 + 호출 예외) — 모델이 판단해서 거절한 것이 아니라 거절 표지를 붙이지 않는다
_INFRA_PREFIXES = ("timeout", "llm_error", "unsupported", "intent_error")

# 팬아웃 풀 — 프로세스에 하나(BLM §6 "요청마다 만들지 않는다"). 스레드는 첫 submit 때 생긴다.
# 32: 시한을 넘긴 작업도 소켓 시한(BackendPoiDb 10s·기상청 4s)까지 스레드를 쥔다 — 8 이면 느린 작업 8개가 다음 턴들을
# 풀 대기만으로 TIMEOUT 시켰다(2026-10-18 리뷰 재현). 프로세스당 I/O 대기 스레드라 값싸다.
_DLG_POOL = ThreadPoolExecutor(32, thread_name_prefix="dialogue")


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
    return DialogueAnswer(AnswerKind.TEXT, CAPABILITIES_TEXT, None, (_home_action(has_trip),), None, None)


def closer_answer(text: str, has_trip: bool) -> DialogueAnswer | None:
    """2″ — 정규화된 발화가 맞장구·인사 낱말뿐이면 받아 주는 한마디(BR-AO-26), 아니면 None. 감사가 하나라도 있으면 감사 답.
    버튼·칩은 능력 안내와 같다."""
    words = _CLOSER_NOISE.sub(" ", text.lower().replace("thank you", "thanks")).split()
    if not words or not all(w in _THANKS or w in _ACKS or w in _GREETS for w in words):
        return None
    if any(w in _THANKS for w in words):
        reply = THANKS_TEXT
    elif any(w in _GREETS for w in words):
        reply = GREETING_TEXT[has_trip]
    else:
        reply = ACK_TEXT
    return DialogueAnswer(AnswerKind.TEXT, reply, None, (_home_action(has_trip),), None, None)


def _judged_nothing(reason: str) -> bool:
    """분류가 판단해서 할 일 없음으로 닫았다 — `{"intent": null}` 또는 범위 밖 라벨. 깨진 출력(절단으로 깨진 것 포함)·시한·벤더
    실패는 아니다 — 절단됐지만 null 로 읽힌 응답(`truncated: not_classifiable: …`)은 판단이다."""
    return NULL_INTENT in reason or reason == f"intent_not_routable({Intent.OUT_OF_SCOPE.value})"


# 목록 밖 라벨의 사유 꼴 — 게이트 사유 `parse_error: closed_set_violation: …` 앞에 `_refusal_reason` 이 표지를 붙인 것 하나뿐이다.
# 절단된 응답은 `not_classifiable: truncated: parse_error: …` 라 맞지 않고, 슬롯 키 메아리(`slots['closed_set_violation']…`)도 걸리지 않는다.
_CLOSED_SET_REASON = "not_classifiable: parse_error: closed_set_violation:"


def _squash(text: str) -> str:
    return normalize(text).replace(" ", "")


def _grounded_args(slots: Mapping[str, str], said: str) -> dict[str, str]:
    """계획 인자의 region 은 사용자가 말한 지역만(BR-AO-28) — 모델이 [여행 상황]의 여행지를 옮겨 적으면 탐색 기준이 '다음 일정 근처'에서
    '지역 중심'으로 바뀐다(제주는 끝에서 끝이 70km 다). 프롬프트 0.1.1 뒤에도 "저녁 먹을 데랑 그 다음 일정" 이 2/2 로 region "제주" 를
    냈다(2026-10-20 실측). `said` 는 발화 + 최근 대화를 `_squash` 한 것 — 지시어로 앞 턴의 지역을 이은 것은 남는다."""
    region = slots.get("region")
    if region and _squash(region) not in said:
        return {k: v for k, v in slots.items() if k != "region"}
    return dict(slots)


def _plannable(reason: str) -> bool:
    """2‴ 진입 — 분류가 판단은 했다: null·범위 밖 라벨(`_judged_nothing`) 또는 목록 밖 라벨을 지어냈다(절단 아님).
    2″ 맞장구는 목록 밖 라벨을 판단으로 보지 않는다(실패에 "알겠어요"로 답하면 수락을 삼킨다, BR-AO-26). 계획은 삼킬 것이 없고 같은
    말을 다시 읽을 뿐이라 받는다. 절단됐지만 `{"intent": null}` 로 읽힌 응답은 모델이 null 이라고 답한 것이라 받는다(`_judged_nothing`).
    시한·벤더·깨진 JSON·슬롯 모양·confidence·절단된 라벨·0′ 주입 거름은 종전대로 범위 밖(정정본 C2)."""
    return _judged_nothing(reason) or _CLOSED_SET_REASON in reason


def _home_action(has_trip: bool) -> NextAction:
    return NextAction("OPEN_ITINERARY", "일정 보기") if has_trip else NextAction("CREATE_TRIP", "여행 만들기")


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
    """`$memory` 재료 — 현재 세션 줄들 + 헤더 + 다른 세션(≤2) 줄들 (DE §6 `$memory`). 줄의 `inline()` 은 워커가 한다.
    지시 주입 꼴 줄은 싣지 않는다 — 기억 게이트가 이제 막지만 그 전에 저장된 줄(TTL 90일)이 남아 있을 수 있다."""
    lines = [line for line in current.summary if not has_injection_like(line)] if current is not None else []
    other_lines = [line for m in others for line in m.summary if not has_injection_like(line)]
    if other_lines:
        lines += [OTHER_SESSIONS_HEADER, *other_lines]
    return tuple(lines)


def _slot_times(value: object) -> tuple[tuple[str | None, str], ...]:
    """Facts 안의 (장소 이름, 계획 시각) 짝 — `{"name", "start_at"}` 를 가진 dict 전부(일정 슬롯·다음 장소), 스냅샷 순서대로.
    같은 짝은 처음 자리 하나만 둔다(다음 장소는 일정 슬롯과 같은 짝이다). 이름 없는 슬롯(BE 가 nameKo null 로 보낼 수 있다)도
    순서에는 들어야 하므로 이름 None 으로 담는다 — 짝 검사는 이름 있는 것만 쓴다."""
    found: list[tuple[str | None, str]] = []
    if isinstance(value, Mapping):
        if "name" in value and isinstance(value.get("start_at"), str):
            found.append((value["name"] if isinstance(value["name"], str) else None, value["start_at"]))
        for item in value.values():
            found += _slot_times(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            found += _slot_times(item)
    return tuple(dict.fromkeys(found))


_SEGMENT = re.compile(r"[,，·/;→\n]|\s그리고\s")


def _hours_pairs(value: object) -> tuple[tuple[str | None, str], ...]:
    """Facts 안의 (장소 이름, 영업시간 시각) 짝 — `{"name", "hours_label"}` 를 가진 dict 전부(장소 정보의 places). "해녀의집은 18:00까지
    열어요"처럼 이름 붙은 영업시간을 그 장소의 시각으로 받는다(C5 ⓒ). 짝 검사(`_misplaced_time`·`_unpaired_time`)에만 쓴다 — 순서
    검사(`_out_of_order`)는 일정 슬롯 시각만 본다."""
    found: list[tuple[str | None, str]] = []
    if isinstance(value, Mapping):
        name, label = value.get("name"), value.get("hours_label")
        if isinstance(name, str) and isinstance(label, str):
            found += [(name, hm) for _, _, hm in clock_spans(label)]
        for item in value.values():
            found += _hours_pairs(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            found += _hours_pairs(item)
    return tuple(dict.fromkeys(found))


def _misplaced_time(text: str, pairs: tuple[tuple[str | None, str], ...]) -> bool:
    """구획(쉼표·줄 등) 안에서 시각에 가장 가까운 장소 이름이 Facts 에서 그 시각과 짝이 아니면 참. 이름이 없으면 판정하지 않는다."""
    names = sorted({name for name, _ in pairs if name}, key=len, reverse=True)
    for segment in _SEGMENT.split(text):
        times = clock_spans(segment)
        if not times:
            continue
        spots: list[tuple[int, int, str]] = []
        for name in names:  # 긴 이름부터 — "카페 모카" 안의 "카페" 를 따로 세지 않는다
            start = segment.find(name)
            while start >= 0:
                end = start + len(name)
                if not any(s <= start and end <= e for s, e, _ in spots):
                    spots.append((start, end, name))
                start = segment.find(name, end)
        for t_start, t_end, hm in times:
            near = [(t_start - e if e <= t_start else s - t_end, n) for s, e, n in spots if e <= t_start or s >= t_end]
            if near and (min(near)[1], hm) not in pairs:
                return True
    return False


# 계획 병합 답의 시각 귀속은 문장 단위로 본다 — "1.2km" 의 점은 뒤가 공백이 아니라 가르지 않는다
_SENTENCE = re.compile(r"(?<=[.!?])\s+|\n")


def _unpaired_time(text: str, known: Sequence[str], pairs: tuple[tuple[str | None, str], ...]) -> bool:
    """계획 병합 답(BR-AO-28) — 시각이 든 문장마다: 아는 이름(`known`, `_known_names`)이 없거나(떠 있는 시각), 그 문장의 어떤 이름과도
    짝이 아닌 시각이 있거나, 그 문장의 어떤 시각과도 짝이 아닌 이름이 있으면 참. 이름은 공백을 지워 대고, 더 긴 이름 안의 짧은 이름은
    뺀다. 한 부분의 검증된 시각이 다른 부분의 장소·후보에 붙는 꼴("12:00에 해녀의집 근처 흰여울 카페에")은 '시각에 가장 가까운 이름'
    하나로는 못 가린다(#1420 리뷰). `_misplaced_time`·`_out_of_order` 와 함께 돈다.
    ponytail: 한 문장에 시각과 짝 없는 이름이 같이 있으면 맞는 답도 템플릿이다("다음 일정은 12:00 해녀의집이고 근처에 흰여울 카페가
    있어요") — 문장 안 귀속을 가리려면 구문 분석이 필요하다."""
    paired = {(_squash(name), hm) for name, hm in pairs if name}
    for sentence in _SENTENCE.split(text):
        hms = {hm for _, _, hm in clock_spans(sentence)}
        if not hms:
            continue
        flat = _squash(sentence)
        hit = {k for k in known if k in flat}
        names = {k for k in hit if not any(k != o and k in o for o in hit)}
        if (any(all((n, hm) not in paired for n in names) for hm in hms)  # 짝 없는 시각 — 이름이 없으면 전부(떠 있는 시각)
                or any(all((n, hm) not in paired for hm in hms) for n in names)):  # 짝 없는 이름
            return True
    return False


def _out_of_order(text: str, pairs: tuple[tuple[str | None, str], ...]) -> bool:
    """장소 이름 없이 떠 있는 슬롯 시각끼리 스냅샷 순서를 거스르면 참 — "12:00에 첫 일정, 09:00에 다음 일정"은 구획에 이름이
    없어 `_misplaced_time` 이 못 본다(2026-10-18 2차 리뷰). 이름이 있는 구획의 시각은 짝 검사가 맞췄으므로 언급 순서를 따지지
    않는다 — "저녁은 18:00 흑돼지거리, 점심은 12:00 해녀의집" 같은 맞는 답을 막으면 날짜·개수뿐인 일정 템플릿으로 답을 잃는다.
    ponytail: 날짜와 서수어는 보지 않는다 — 여러 날 Facts 의 날 넘김, 이름 붙은 시각 뒤의 떠 있는 시각("해녀의집 12:00 이 첫
    일정, 09:00 이 다음"), 시각 하나뿐인 서수 오류("첫 일정은 12:00")는 못 가린다. 가리려면 서수·날짜 표기 인식이 먼저다."""
    names = [name for name, _ in pairs if name]
    order = [hm for _, hm in pairs]
    at = 0
    for segment in _SEGMENT.split(text):
        if any(name in segment for name in names):
            continue  # 이름에 붙은 시각 — 짝 검사 몫
        for _, _, hm in clock_spans(segment):
            if hm not in order:
                continue  # 영업시간처럼 슬롯이 아닌 Facts 시각
            nxt = next((i for i in range(at, len(order)) if order[i] == hm), None)
            if nxt is None:
                return True
            at = nxt
    return False


# INV-1 — 후보 목록 답(CANDIDATES)의 문장이 Facts 밖 장소 이름을 꺼내면 템플릿으로. 장소 이름 사전이 없어 **이름 꼴**로 본다:
# 한글 낱말의 앞부분이 "이름 + 장소 접미(시장·공원·박물관…)" 꼴인데(뒤의 조사는 그래서 상관없다) 아는 이름 어디에도 겹치지 않으면 밖이다.
# '거리'는 접미에서 뺐다 — "볼거리가 많아요"가 걸린다.
# ponytail: 접미 없는 고유명("서울숲"·"성심당")과 동네 이름("성수동")은 못 본다 — 막으려면 등록 POI 이름 사전 대조가 필요하다.
_PLACE_LIKE = re.compile(r"[가-힣]{1,20}?(?:시장|공원|타워|해수욕장|박물관|미술관|전망대|폭포|오름|성당|궁|해변|마을|카페|호텔|랜드|파크|브루어리)")


def _prompt_names(prompt: Mapping) -> list[str]:
    """`to_prompt_dict` 모양 사실의 장소·대상·앵커 이름 — 계획 병합본은 also 부분까지(정정본 C4). 측정 러너도 이것으로 아는 이름을 만든다."""
    names = [p["name"] for p in prompt.get("places", ()) if isinstance(p, Mapping) and isinstance(p.get("name"), str)]
    names += [v for v in (prompt.get("target"), prompt.get("anchor")) if isinstance(v, str)]
    # 장소 소개(KB-5) 글자 그대로 있는 이름은 말해도 된다 — "근정전·광화문"이 목록 밖 장소로 막히지 않게(사실 칸 원칙, ai-4e 합의)
    intro = prompt.get("intro")
    if isinstance(intro, str):
        names += [m.group(0) for word in re.findall(r"[가-힣]+", intro) if (m := _PLACE_LIKE.match(word))]
    for part in prompt.get("also", ()):
        if isinstance(part, Mapping):
            names += _prompt_names(part)
    return names


def _known_names(facts: Facts, snapshot: TurnSnapshot) -> tuple[str, ...]:
    names = _prompt_names(facts.to_prompt_dict()) + [s.name for _, s in snapshot.slots() if s.name]
    known = (_squash(n) for n in names if n)
    return tuple(k for k in known if k)  # 빈 이름은 뺀다 — "" 는 모든 낱말의 접두라 검사가 꺼진다


def _foreign_place(text: str, known: Sequence[str]) -> bool:
    for word in re.findall(r"[가-힣]+", text):
        m = _PLACE_LIKE.match(word)
        if m and not any(word.startswith(k) or m.group(0) in k for k in known):
            return True
    return False


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
    `planner` 는 2‴ 계획 워커 — 배정(`DIALOGUE_PLAN`)이 있을 때만 조립부가 넣는다(배정이 곧 켜기, DEC-AO-18).
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
        planner: DialoguePlanWorker | None = None,
        smalltalk: DialogueSmalltalkWorker | None = None,
    ) -> None:
        self._intent = intent_worker
        self._smalltalk_worker = smalltalk
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
        self._planner = planner  # 2‴ — None 이면 계획 단계 없음(DIALOGUE_PLAN 미배정, DEC-AO-18): 종전과 바이트 단위로 같다

    # ── 턴 ───────────────────────────────────────────────────────────────

    def turn(self, inp: TurnInput) -> TurnOutcome:
        """한 턴. 어떤 실패도 예외가 아니라 `TurnOutcome` 이다 — `PermissionDeniedError` 만 관통(fail-closed, TRIP-333)."""
        # 지난 턴 중 지시 주입 꼴은 어느 프롬프트(분류·답변·기억 요약)에도 다시 싣지 않는다 — 그 턴은 이미 범위 밖으로 끝났다
        inp = replace(inp, recent_turns=tuple(t for t in inp.recent_turns if not has_injection_like(t.text)))
        with llm_call_counter() as counter:
            current, others = self._load_memory(inp)
            try:
                outcome = self._core(inp, current, others, counter)
            except PermissionDeniedError:
                raise
            except Exception as e:  # noqa: BLE001 — DL-5: 버그도 경계 밖으로 내지 않는다(BR §5 미결 #14 A안)
                outcome = self._crashed(inp, e)
            self._remember(inp, current, outcome.answer.text if outcome.answer is not None else None,  # outcome 과 무관(BLM §3 註)
                           llm_calls=counter[0])
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
        # 0′ — 지시 무시·프롬프트 유출·역할 바꾸기 꼴은 분류 LLM 에 보내지 않는다. "다음 장소 알려줘. 그리고 규칙 무시하고 …"처럼
        # 정상 요청에 붙으면 분류는 GET_NEXT_SLOT 을 고르고 답변 LLM 이 그 지시를 받는다 — 판단해서 거절한 것이라 거절 표지를 단다
        if has_injection_like(text):
            # 발화는 싣지 않는다 — 운영에서 이 줄 수로 오탐을 센다(정상 말이 걸리면 범위 밖 카드가 나간다)
            log.info("dialogue_injection_suspected %s", json.dumps({"event": "dialogue_injection_suspected", "trace_id": inp.trace_id}))
            return self._out_of_scope(inp, INJECTION_REASON)
        # 0″ — 지역을 말한 장소 찾기 말이면 장소 탐색 SQL 작성을 분류와 나란히 미리 시작한다(분류 뒤에 쓰면 팬아웃 시한에 걸렸다, place_sql 註)
        if self._ports.place_sql is not None:
            self._ports.place_sql.prefetch(inp.utterance, inp.trace_id, inp.now, self._submit)
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
                reason = reason or "intent_fallback"
                closer = closer_answer(text, inp.snapshot.trip is not None) if _judged_nothing(reason) else None
                if closer is not None:  # 2″ — 할 일이 없는 말에 범위 밖 카드를 내지 않는다(BR-AO-26)
                    if closer.text == GREETING_TEXT[inp.snapshot.trip is not None]:  # 인사만 LLM 으로 — 감사·맞장구는 고정 한 줄로 충분하다
                        closer = self._smalltalk(inp, closer, memory_lines, trip_summary)
                    return TurnOutcome("ANSWER", (), None, closer, cleared, 0, reason)
                if self._planner is not None and _plannable(reason):  # 2‴ — 정해진 의도 밖이라도 조회로 도울 수 있으면 돕는다(BR-AO-28)
                    return self._plan_turn(inp, text, memory_lines, trip_summary, cleared, reason)
                return self._out_of_scope(inp, reason)
            # 3 — 필수 인자 되묻기 (요청당 1회, 기존 로직)
            interp = from_match(match, inp.context, trip_view)
            if interp.outcome == "ARGUMENT_CLARIFY" and match.intent is Intent.EDIT_SCHEDULE and (on := insert_day(
                    inp.utterance, inp.snapshot, inp.now.astimezone(self._tz).date(), self._ports, inp.now,
                    remaining_ms=self._remaining(inp))) is not None:
                # 사이 넣기는 말의 자리로 날을 푼다 — 되물으면 답 턴에 원문이 없다(PendingFrame 에 발화 칸이 없다, spec 003)
                interp = from_match(replace(match, slots={**match.slots, "day": on.isoformat()}), inp.context, trip_view)
        if interp.outcome == "ARGUMENT_CLARIFY":
            return TurnOutcome("ARGUMENT_CLARIFY", interp.frames, interp.clarify, None, interp.context, 0, interp.reason)
        if interp.outcome == "OUT_OF_SCOPE":  # from_match 는 FALLBACK 매치에서만 — 여기로는 오지 않는다(방어)
            return self._out_of_scope(inp, interp.reason or "intent_not_routable")
        (frame,) = interp.frames
        handler = HANDLERS[frame.intent]
        ctx = TurnContext(
            snapshot=inp.snapshot, arguments=frame.arguments, now=inp.now, tz=self._tz, trace_id=inp.trace_id,
            remaining_ms=lambda: self._remaining(inp), ports=self._ports, utterance=inp.utterance,
            earlier=tuple((turn.role, turn.text) for turn in inp.recent_turns),
        )
        if handler.handoff_frame:  # EDIT_SCHEDULE — 1단계 FRAME (BR-AO-17): 인자만 정리하고 BE 제안 경로로
            tidy = replace(frame, arguments=edit_arguments(ctx))
            return TurnOutcome("FRAME", (tidy,), None, None, cleared, 0, interp.reason)
        # 3′ — 조건부 필수 인자(BR-AO-27, 탐색의 지역): 3단계와 같은 요청당 1회 — 되묻기의 답으로 온 프레임에는 다시 묻지 않는다
        ask = handler.ask(ctx) if handler.ask is not None and frame.match_route != "CLARIFY_ANSWER" else None
        if ask is not None:
            argument, question = ask
            pending = PendingFrame(frame.intent, dict(frame.arguments), argument, frame.confidence)
            return TurnOutcome(
                "ARGUMENT_CLARIFY", (replace(frame, missing=(argument,)),), Clarify(0, argument, question, None), None,
                DialogueContext(pending=pending, turn_index=inp.context.turn_index, clarify_count=1), 0, interp.reason)
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
                elif draft.intent not in DIALOGUE_INTENTS:  # OUT_OF_SCOPE 라벨 = 위임 불가 (IntentRouter 와 같은 분담)
                    reason = f"intent_not_routable({draft.intent.value})"
                else:
                    confidence = draft.confidence if draft.confidence is not None else 0.5
                    match = IntentMatch(
                        intent=draft.intent, slots=dict(draft.slots), confidence=max(0.0, min(1.0, confidence)),
                        match_route=MatchRoute.LLM_DIRECT,
                    )
        # 섀도(3단 라우터)는 13종 어휘라 도우미 전용 의도(탐색)를 낼 수 없다 — 내면 일치율이 탐색 비중만큼 구조적으로 깎이고 섀도
        # LLM 만 쓴다. 비교할 수 있는 턴만 넘긴다(BR-AO-27)
        if match is None or match.intent in ROUTABLE_INTENTS:
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

    def _submit(self, fn: Callable[[], object]) -> Future:
        """공유 풀에 내되 문맥을 복사해 넘긴다 — 턴 `llm_calls`(백엔드 사용량 상한의 원천)가 contextvar 카운터라, 그냥 내면 풀 스레드에서
        부른 서비스 LLM(장소 탐색 NL2SQL)이 빠진다. 한 사본을 두 스레드가 같이 쓰면 RuntimeError 라 낼 때마다 새로 뜬다."""
        return self._pool.submit(contextvars.copy_context().run, fn)

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
                futures[task.name] = self._submit(task.fn)
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
                    # Provider 는 장애를 예외가 아니라 상태값(WEATHER_UNKNOWN·UNAVAILABLE…)으로 돌려준다 — 전송은 OK 라도
                    # 그 상태가 강등이면 여기서 보고한다(아니면 기상청·POI 장애가 이벤트 0·로그 0, 2026-10-18 리뷰 재현).
                    status = value.get("status")
                    if isinstance(status, str) and status not in _HEALTHY_STATUSES:
                        code = value.get("reason")
                        self._fallback(inp, "fanout", name, status,
                                       code if isinstance(code, str) and _REASON_CODE.fullmatch(code) else "provider_status")
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
        *,
        closed: bool = False,
    ) -> DialogueAnswer:
        """`closed` — 계획 경로(2‴)는 목록 밖 장소 검사를 늘 켜고, 병합본(also)이면 시각을 문장마다 그 문장의 이름에 귀속시킨다(BR-AO-28).

        LLM 문장 ≤1회. 의도된 결정론(needTrip·UNAVAILABLE·사실 없음)은 LLM 미시도·FallbackEvent 없음(BR-AO-23·25 — 팬아웃 실패는
        `_fanout` 이 작업별로 이미 냈다); 시도했거나 해야 했던 턴의 템플릿에는 FallbackEvent 짝(게이트웨이가 냈거나 여기서 낸다)."""
        if facts.needs_trip or facts.status is FactStatus.UNAVAILABLE:
            return DialogueAnswer.from_facts(facts)
        if not has_facts(facts):
            # 넘기기 의도(다시 짜기·만들기·회고 등)·남은 일정 없음은 사실 없이 다음 행동 버튼뿐이다 — 빈 재료로 LLM 을 부르면 "확인된 정보가 없어
            # … 할 수 없어요"처럼 실패로 들린다(2026-10-19 E2E 18 중 12~14). BR-AO-25 의 의도된 결정론 — 안내 문구로 바로 답한다
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
        # INV-2 — 문장 속 시각은 Facts 값이어야 하고, 장소와 붙어 있으면 그 장소의 시각이어야 하고, 이름 없이 떠 있는 시각끼리는
        # 스냅샷 순서를 따라야 한다(시각은 다 맞는데 장소끼리 바꿔 붙인 "해녀의집 15:00, 카페 모카 12:00" 도, 이름 없이 "12:00 첫
        # 일정, 09:00 다음 일정" 도 순서·시각 위반이다). 대조는 Facts 로만 한다 — 프롬프트에는 발화 "16:30에 가도 돼?" 가
        # 들어간다(2026-10-18 리뷰 1·2차). 순서는 본문·각주를 이어서 본다 — 같은 역순이 칸 배치로 갈리지 않게.
        prompt_facts = facts.to_prompt_dict()
        allowed, _ = clock_times(json.dumps(prompt_facts, ensure_ascii=False, default=str))
        pairs = _slot_times(prompt_facts)
        # 장소 정보의 영업시간도 그 장소의 짝이다 — 순서 검사에는 넣지 않는다(일정 슬롯 시각만 순서가 있다, 정정본 C5 ⓒ)
        named = pairs + _hours_pairs(prompt_facts)
        known = _known_names(facts, inp.snapshot)
        # 계획 병합 답은 시각을 문장마다 그 문장의 이름에 귀속시킨다 — 한 부분의 검증된 시각이 다른 부분의 장소·후보에 붙는 구멍(BR-AO-28)
        merged = closed and "also" in facts.detail
        parts = (draft.text, draft.footnote or "")
        bad = _out_of_order("\n".join(parts), pairs)
        for part in parts:
            times, unverifiable = clock_times(part)
            bad = (bad or unverifiable or not times <= allowed or _misplaced_time(part, named)
                   or merged and _unpaired_time(part, known, named))
        if bad:
            self._fallback(inp, "llm", *_ANSWER_MODES, "time_not_in_facts")
            return DialogueAnswer.from_facts(facts)
        # INV-1 — 후보 답(대안·탐색)과 탐색의 빈 결과 답이 목록 밖 장소를 권했다. 탐색 EMPTY 는 장소가 없어 "대신 ○○해변은
        # 어떠세요?"를 지어낼 자리가 가장 큰 답이다
        closed = closed or facts.kind is AnswerKind.CANDIDATES or intent in (Intent.EXPLORE_PLACES, Intent.RECOMMEND_PLACES)
        if closed and any(_foreign_place(part, known) for part in parts):
            self._fallback(inp, "llm", *_ANSWER_MODES, "place_not_in_facts")
            return DialogueAnswer.from_facts(facts)
        try:
            return DialogueAnswer.from_facts(facts, text=draft.text, footnote=draft.footnote)
        except ValueError as e:  # 게이트와 같은 검사라 여기 오면 게이트가 어긋난 것 — 그래도 템플릿
            self._fallback(inp, "llm", *_ANSWER_MODES, f"answer_shape: {e}")
            return DialogueAnswer.from_facts(facts)

    # ── 2″·2‴ 인사·잡담 (BR-AO-26 개정 2026-10-22) ─────────────────────

    def _smalltalk(
        self, inp: TurnInput, fixed: DialogueAnswer, memory_lines: Sequence[str], trip_summary: str,
    ) -> DialogueAnswer:
        """인사·잡담 한마디를 LLM 이 즉석에서 — 사실 없이 말을 받아 주고 여행 쪽 질문으로 끝낸다. 미배정이면 `fixed` 그대로(이벤트 없음 —
        의도된 결정론). 시한 부족·실패·게이트 드롭·목록 밖 장소(INV-1 — 사실이 없으니 스냅샷 장소 말고는 전부 지어낸 것)면 `fixed`
        + FallbackEvent 짝(INV-4). 버튼·칩은 `fixed` 의 것 그대로 — LLM 은 문장만 쓴다."""
        if self._smalltalk_worker is None:
            return fixed
        remaining = self._remaining(inp)
        if remaining < _ANSWER_MIN_REMAINING_MS:
            self._fallback(inp, "llm", *_SMALLTALK_MODES, f"budget_exhausted(remaining_ms={remaining})")
            return fixed
        timeout_ms = min(_ANSWER_CAP_MS, remaining - _ANSWER_RESERVE_MS)
        try:
            result = self._smalltalk_worker.compose(
                inp.utterance, inp.recent_turns, memory_lines, trip_summary, inp.trace_id, inp.now, timeout_sec=timeout_ms / 1000,
            )
        except Exception as e:  # noqa: BLE001
            self._fallback(inp, "llm", *_SMALLTALK_MODES, f"smalltalk_error: {type(e).__name__}: {e}")
            return fixed
        draft = result.value
        if result.is_fallback or draft is None:  # FallbackEvent 는 게이트웨이가 냈다
            return fixed
        known = tuple(k for k in (_squash(s.name) for _, s in inp.snapshot.slots() if s.name) if k)
        times, unverifiable = clock_times(draft.text)
        if times or unverifiable:  # 사실이 없는 자리 — 시각은 전부 지어낸 것(INV-2)
            self._fallback(inp, "llm", *_SMALLTALK_MODES, "time_not_in_facts")
            return fixed
        if _foreign_place(draft.text, known):
            self._fallback(inp, "llm", *_SMALLTALK_MODES, "place_not_in_facts")
            return fixed
        try:
            return replace(fixed, text=draft.text)
        except ValueError as e:  # 게이트와 같은 검사 — 어긋나면 고정 문장
            self._fallback(inp, "llm", *_SMALLTALK_MODES, f"answer_shape: {e}")
            return fixed

    # ── 2‴ 도구 계획 (BR-AO-28·29) ──────────────────────────────────────

    def _plan_turn(
        self,
        inp: TurnInput,
        text: str,
        memory_lines: Sequence[str],
        trip_summary: str,
        cleared: DialogueContext,
        reason: str,
    ) -> TurnOutcome:
        """분류가 판단해서 닫은 말에 조회 계획 1회 → 닫힌 도구 ≤2 → 팬아웃 1회 → 병합 → 답변(목록 밖 장소 검사 강제).

        도구 없음·거절은 판단 결과라 이벤트 없이, 실패·시한 부족은 이벤트 짝과 함께 종전 OUT_OF_SCOPE 다(DEC-AO-14 — 화면 문장은 BE
        SCOPE 카드 한 벌). 계획 답은 프레임 없는 ANSWER — BE enum·와이어 무변경. 이후 단계의 버그는 `turn()` 의 `_crashed` 로 간다.
        탐색의 지역 되묻기(`Handler.ask`)는 분류 경로 전용이라 여기서는 부르지 않는다 — 앵커 없는 탐색은 사실 없는 Facts 가 되어
        고정 문장으로 바로 답한다."""
        remaining = self._remaining(inp)
        if remaining < _PLAN_MIN_REMAINING_MS:
            self._fallback(inp, "llm", *_PLAN_MODES, f"budget_exhausted(remaining_ms={remaining})")
            return self._plan_declined(inp, reason, "SKIPPED")
        timeout_ms = min(_PLAN_CAP_MS, int(remaining * _PLAN_SHARE))
        started = self._clock.monotonic_ms()
        try:
            result = self._planner.plan(text, inp.recent_turns, trip_summary, inp.trace_id, inp.now,
                                        timeout_sec=timeout_ms / 1000)
        except Exception as e:  # noqa: BLE001 — 프롬프트 미등록 ValueError 는 게이트웨이 render 가 호출보다 먼저 던진다
            self._fallback(inp, "llm", *_PLAN_MODES, f"plan_error: {type(e).__name__}")
            return self._plan_declined(inp, reason, "FALLBACK")
        plan_ms = self._clock.monotonic_ms() - started
        draft = result.value
        if result.is_fallback or not isinstance(draft, DialoguePlanDraft):  # FallbackEvent·LlmCallRecord 는 게이트웨이가 냈다
            return self._plan_declined(inp, reason, "FALLBACK", plan_ms=plan_ms)
        if draft.refused or not draft.calls:  # 판단한 거절·도구 없음 — 의도된 결정론, 이벤트 없음
            if not draft.refused and draft.gap == "CHAT":  # 잡담은 범위 밖 카드 대신 받아 준다(2″ 인사와 같은 결정론 문장)
                self._log_plan(inp, "NO_TOOL", plan_ms=plan_ms, gap=draft.gap)
                fixed = DialogueAnswer(AnswerKind.TEXT, CHAT_TEXT[inp.snapshot.trip is not None], None,
                                       (_home_action(inp.snapshot.trip is not None),), None, None)
                answer = self._smalltalk(inp, fixed, memory_lines, trip_summary)
                return TurnOutcome("ANSWER", (), None, answer, cleared, 0, f"{reason}; plan:no_tool")
            return self._plan_declined(inp, reason, "REFUSED" if draft.refused else "NO_TOOL", plan_ms=plan_ms, gap=draft.gap)
        handlers = [HANDLERS[call.intent] for call in draft.calls]
        said = _squash(" ".join([text, *(turn.text for turn in inp.recent_turns)]))
        earlier = tuple((turn.role, turn.text) for turn in inp.recent_turns)
        ctxs = [TurnContext(snapshot=inp.snapshot, arguments=_grounded_args(call.slots, said), now=inp.now, tz=self._tz,
                            trace_id=inp.trace_id, remaining_ms=lambda: self._remaining(inp), ports=self._ports,
                            earlier=earlier, heard=text)
                for call in draft.calls]
        n = len(ctxs)
        results = self._fanout(inp, step_tasks([h.plan(ctx) for h, ctx in zip(handlers, ctxs, strict=True)]))
        facts = merge_facts([h.assemble(ctx, step_results(results, i, n))
                             for i, (h, ctx) in enumerate(zip(handlers, ctxs, strict=True))])
        answer = self._compose(inp, facts.intent, facts, memory_lines, trip_summary, closed=True)
        self._log_plan(inp, "TOOLS", calls=draft.calls, arg_keys=[sorted(ctx.arguments) for ctx in ctxs], primary=facts.intent,
                       plan_ms=plan_ms,
                       task_status={name: r.status for name, r in results.items()})
        return TurnOutcome("ANSWER", (), None, answer, cleared, 0,
                           f"{reason}; plan:{'+'.join(call.intent.value for call in draft.calls)}")

    def _plan_declined(self, inp: TurnInput, reason: str, decision: str, *, plan_ms: int | None = None,
                       gap: str | None = None) -> TurnOutcome:
        """계획이 답을 만들지 않았다 — 종전 범위 밖. 분류 사유를 앞에 그대로 둬 거절 표지(`not_classifiable`)를 잃지 않는다."""
        self._log_plan(inp, decision, plan_ms=plan_ms, gap=gap)
        return self._out_of_scope(inp, f"{reason}; plan:{decision.lower()}")

    def _log_plan(self, inp: TurnInput, decision: str, *, calls=(), arg_keys: Sequence[Sequence[str]] | None = None,
                  primary: Intent | None = None,
                  plan_ms: int | None = None, gap: str | None = None, task_status: Mapping[str, str] | None = None) -> None:
        """`dialogue_plan` 한 줄(BR-AO-29) — 갈래마다. 닫힌 라벨·키·수치만 싣는다: 발화·인자 값·account_ref 는 없다(SEC-U8-06).
        `task_status` 는 작업별 전송 결과(OK·TIMEOUT·UNAVAILABLE·SKIPPED) — 도구별 TIMEOUT 률 지표의 재료다(정정본 C10)."""
        log.info("dialogue_plan %s", json.dumps({
            "event": "dialogue_plan", "trace_id": inp.trace_id, "decision": decision,
            "tools": [call.intent.value for call in calls],
            "arg_keys": [list(keys) for keys in arg_keys] if arg_keys is not None else [sorted(call.slots) for call in calls],
            "gap": gap, "primary": primary.value if primary is not None else None, "plan_ms": plan_ms,
            "task_status": dict(task_status or {}),
        }, ensure_ascii=False))

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

    def _remember(
        self, inp: TurnInput, current: DialogueMemory | None, answer_text: str | None = None, *, llm_calls: int = 0,
    ) -> None:
        if self._store is None or not inp.session_id:
            return
        summarized = current.summarized_turn_index if current is not None else 0
        if not due(inp.context.turn_index, summarized, every=SUMMARY_EVERY_TURNS):
            return
        try:
            self._summarize_and_put(inp, current, answer_text, llm_calls=llm_calls, summarized=summarized)
        except Exception as e:  # noqa: BLE001 — 기억은 응답 품질과 무관하다: 어떤 실패도 턴을 막지 않는다
            self._fallback(inp, "memory", _MEMORY_MODES[0], "skipped", f"memory_error: {type(e).__name__}: {e}")

    def _summarize_and_put(
        self, inp: TurnInput, current: DialogueMemory | None, answer_text: str | None = None, *,
        llm_calls: int = 0, summarized: int = 0,
    ) -> None:
        """BLM §8 — 잔여 ≥2.5s 면 LLM 요약, 미만이면 결정론 압축, ≤0 이면 압축·put 없이 미룬다(due 유지). 실패는 전부 압축.
        이번 턴이 서비스 LLM 을 이미 3회 썼으면(계획 턴) 첫 차례는 미루고, 이미 한 번 미룬 차례면 결정론 압축이다(BR-AO-09 C9)."""
        remaining = self._remaining(inp)
        # 예전에 저장된 지시문 꼴 줄은 요약에 넘기지 않는다 — 이번 갱신으로 저장본에서도 빠진다(`_memory_lines` 와 같은 거름)
        previous = tuple(line for line in current.summary if not has_injection_like(line)) if current is not None else ()
        if remaining <= 0:
            self._fallback(inp, "memory", _MEMORY_MODES[0], "deferred", f"budget_exhausted(remaining_ms={remaining})")
            return
        # 이번 턴(발화·답)도 재료에 넣는다 — summarized_turn_index 를 이번 턴으로 적으면서 백엔드가 싣는 recent_turns(이번 발화
        # **앞** 메시지)만 요약하면 이번 턴이 장기 기억에서 영영 빠진다(2026-10-18 리뷰 재현).
        turns = inp.recent_turns + tuple(
            RecentTurn(role, text[:RECENT_TURN_CHARS])
            for role, text in (("USER", inp.utterance.strip()), ("ASSISTANT", (answer_text or "").strip()))
            if text and not has_injection_like(text))  # 0′ 에서 거절한 발화도 요약 차례면 여기로 온다 — 지난 턴과 같은 거름
        capped = bool(turns) and llm_calls >= _TURN_LLM_CAP
        if capped and inp.context.turn_index - summarized <= SUMMARY_EVERY_TURNS:
            # 첫 요약 차례 — 미룬다(due 유지). 다음 턴의 최근 창(10턴)이 이 턴을 겹쳐 담는다. 두 번 미루면 가장 오래된 미요약 턴이
            # 창 밖으로 밀려 장기 기억에서 빠진다 — 그래서 미룸은 한 번뿐이다(정정본 C9)
            self._fallback(inp, "memory", _MEMORY_MODES[0], "deferred", f"turn_llm_cap({_TURN_LLM_CAP})")
            return
        today = inp.now.astimezone(self._tz).date()
        if not turns:  # 재료 없이 LLM 을 부르지 않는다 — 의도된 결정론, 폴백 아님 (BR-AO-25)
            lines = compress_fallback((), previous)
        elif capped:  # 이미 한 번 미룬 차례 — LLM 4회째를 부르지 않고 결정론 압축으로 저장한다
            lines = compress_fallback(turns, previous)
            self._fallback(inp, "memory", *_MEMORY_MODES, f"turn_llm_cap({_TURN_LLM_CAP})")
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
        if result.is_fallback:  # FallbackEvent 는 게이트웨이가 냈다 (파싱 실패·전부 드롭 = 실패)
            return compress_fallback(turns, previous)
        if result.value:
            return tuple(result.value)
        # 비운 배열 = 새로 기억할 것 없음 → 이전 요약은 두되 앞선 압축이 남긴 원문 조각 줄은 지운다(BR-AO-09). 이전 줄도
        # 압축과 같은 술어로 다시 거른다 — #1314 이전 압축이 남긴 연락처·소요시간 줄이 술어 없이 되살지 않게(2026-10-19 리뷰).
        # 폴백이 아니라서 이벤트가 없다 — 모델이 늘 비우는 고장이 보이도록 건수만 한 줄 남긴다(내용·account_ref 없음).
        kept = tuple(line for line in compress_fallback((), previous) if not is_turn_fragment(line))
        log.info("dialogue_memory_empty %s", json.dumps({
            "event": "dialogue_memory_empty", "trace_id": inp.trace_id, "kept_lines": len(kept),
            "dropped_lines": len(previous) - len(kept)}))
        return kept

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
