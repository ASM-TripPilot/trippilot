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
0‴ 이번 말과 관련된 기억 꺼내기(임베딩 → 이 세션, 그다음 같은 계정 기억 줄 검색)를 분류와 나란히 — 분류엔 이 대화를 잇는 줄, 답변·잡담엔 꺼낸 줄 (BR-AO-09)
6  세션 기억: 3턴마다 답한 뒤 **뒤에서** `DIALOGUE_MEMORY` → 줄 임베딩 → `advance`(턴 시한·`llm_calls` 밖); 실패는 이전 기억 그대로 (BR-AO-09)
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
import threading
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import Executor, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass, replace
from datetime import date, datetime, tzinfo

from trippilot.agents.schedule.agent import Clock
from trippilot.agents.unknown_handling.agent import KnowledgeTask
from trippilot.domain.common import TraceId
from trippilot.domain.context import PermissionDeniedError
from trippilot.domain.intent import DIALOGUE_INTENTS, ROUTABLE_INTENTS, Intent, IntentDraft, IntentMatch, MatchRoute
from trippilot.domain.observability import FallbackEvent
from trippilot.domain.region_centers import region_mentions
from trippilot.llm_gateway.gates.base import has_injection_like
from trippilot.llm_gateway.gates.dialogue_answer import _MAX_FOOTNOTE, clock_spans, clock_times
from trippilot.llm_gateway.gates.dialogue_plan import DialoguePlanDraft
from trippilot.llm_gateway.gates.intent import NULL_INTENT
from trippilot.llm_gateway.workers.dialogue_answer import DialogueAnswerWorker, unrepeated
from trippilot.llm_gateway.workers.dialogue_intent import PROMPT_TURNS, DialogueIntentWorker, last_turns
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
from trippilot.orchestrator.edit_day_areas import DayAreaTurn, check_day_areas
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
    DialogueMemory,
    MemoryStorePort,
    context_lines,
    due,
    expires_at_for,
    gist_lines,
    is_turn_fragment,
    kept_lines,
    legacy_lines,
    material,
)
from trippilot.orchestrator.dialogue_plan import has_facts, merge_facts, step_results, step_tasks
from trippilot.orchestrator.intent_router import normalize
from trippilot.orchestrator.shadow_probe import ShadowIntentProbe
from trippilot.ports.embedding_port import EmbeddingPort
from trippilot.ports.memory_store_port import SUMMARY_MAX_LINES, MemoryHit, split_kind
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
# 2‴ 계획 LLM(BR-AO-28): min(cap, 잔여×share). 잔여 < 4.6s 면 부르지 않는다 — 계획이 몫(0.45R)을 다 쓰고 팬아웃이 남은 것의
# 0.40 을 다 써도 답변 앞 잔여 ≥1.5s(답변 시도선)이려면 R ≥ 4,542ms(정수 내림 산술: 4,542 → 계획 2,043 → 2,499 → 팬아웃 999
# → 1,500). 4,500 이면 1,485 라 늘 템플릿이다(정정본 C1). 상한 3.5s(초판 3.0s) — 2026-10-20 luna·effort none 실측에서 3.0s 는
# 같은 시각 짝에서 시한 잘림이 4/78 → 2/78 이었다(같은 날 런 합 3.0s 10/154 · 3.5s 15/864 — 시각·판본이 섞인 합, 러너의 SDK
# 단위 시한 기준). 운영 실효 시한은 min(3.5s, 0.45R) 라 분류 1.6s 턴은 ≈3.33s 다. 하한 산술은 몫(0.45R)만 쓰므로 상한과 무관하다.
_PLAN_CAP_MS, _PLAN_SHARE, _PLAN_MIN_REMAINING_MS = 3_500, 0.45, 4_600
_HEALTHY_STATUSES = frozenset({"OK", "LOW"})  # 작업 값의 status 중 강등이 아닌 것 (ProviderStatus OK·LOW)
_REASON_CODE = re.compile(r"[a-z_]{1,40}(?::[A-Za-z_]{1,60})?")  # 이벤트 사유는 코드만 — 예외 메시지(키 든 URL)는 싣지 않는다
_OTHER_SESSIONS_LIMIT = 2  # "지난 여행 기억" — 같은 계정의 다른 세션 ≤2 (임베딩이 없거나 꺼내기가 실패했을 때의 종전 줄)
# 0‴ 기억 꺼내기(BR-AO-09 개정 2026-10-23) — 이번 말을 임베딩해 이 세션·같은 계정 기억 줄 중 가까운 사실 줄 ≤6(점수 ≥0.45).
# 하한은 KURE-v1 실측(기억 줄 12 × 질문 12, 2026-10-23): 관련 줄 최저 0.51·중앙 0.62, 무관 줄 중앙 0.44·p90 0.52, "고마워"의 최고 0.41.
# 무관 줄이 몇 줄 섞이는 쪽을 고른다 — 관련 사실(먹지 못하는 음식)을 놓치는 쪽이 더 나쁘다(횟집 질문에 알레르기 줄 0.51).
_RECALL_TOP_K, _RECALL_MIN_SCORE = 6, 0.45
_RECALL_WAIT_MS = 300  # 답변 단계에 꺼내기가 아직이면 이만큼만 기다리고 이 세션 줄로 간다 — 보통은 분류(≥1s) 동안 끝나 있다
_MEMORY_TIMEOUT_S = 8.0  # 뒤에서 도는 요약 LLM 시한 — 턴 시한 밖이다(응답은 이미 나갔다)

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
# 감사·맞장구도 같은 말이 이어지지 않게(`unrepeated` 표에 더한다 — #1510 이 LLM 으로 돌리지 않고 남긴 자리, 2026-10-22)
_CLOSER_VARIANTS = {
    THANKS_TEXT: ("별말씀을요! 여행하다 궁금한 게 생기면 또 불러 주세요.", "도움이 됐다니 다행이에요. 또 필요하면 말씀해 주세요."),
    ACK_TEXT: ("네, 알겠어요. 필요할 때 편하게 불러 주세요.", "좋아요! 궁금한 게 생기면 언제든지요."),
}
# 인사·잡담 답 — 여행이 있으면 지금 여행으로, 없으면 여행 만들기로 잇는다(버튼은 `_home_action` 과 같은 갈래). DIALOGUE_SMALLTALK 이
# 배정돼 있으면 LLM 이 즉석에서 짓고(`_smalltalk`), 미배정·실패·목록 밖 장소면 이 고정 문장이다(INV-4 마지막 계단, BR-AO-26 개정 10-22).
GREETING_TEXT = {
    True: "네, 안녕하세요~ 여행 준비는 잘 되고 있나요? 다음 장소나 날씨, 근처에 가 볼 만한 곳이 궁금하면 편하게 물어봐 주세요.",
    False: "네, 안녕하세요~ 어디로 떠날 생각이세요? 여행을 만들면 일정이랑 날씨, 가 볼 만한 곳을 같이 챙겨 드릴게요.",
}
# 2‴ 계획기가 잡담(gap CHAT)으로 닫은 말 — 도구로 답할 건 없지만 범위 밖 카드 대신 말을 받아 준다.
# 2‴ gap KNOWLEDGE 의 지식 답 각주(BR-AO-32) — 결정론. LLM 일반 지식이라 맞는지 확인한 사람이 없다(사용자 결정 2026-10-23).
KNOWLEDGE_FOOTNOTE = "일반적인 여행 정보라 시기나 상황에 따라 다를 수 있어요."
CHAT_TEXT = {
    True: "저랑은 여행 이야기가 제일 잘 통해요. 다음 장소나 날씨, 근처에 가 볼 만한 곳이 궁금하면 편하게 물어봐 주세요.",
    False: "저랑은 여행 이야기가 제일 잘 통해요. 어디로 떠날지 정해지면 여행을 만들어 보세요. 일정이랑 날씨를 같이 챙겨 드릴게요.",
}
OTHER_SESSIONS_HEADER = "지난 여행 기억:"  # `$memory` 에서 현재 세션 줄과 다른 세션 줄을 가르는 머리 (DE §6 `$memory`)

# 게이트웨이 `default_fallback_modes` 와 같은 라벨 — LLM 을 **부르지 않고** 폴백한 턴(잔여 부족·워커 예외)에도 같은 짝을 남긴다
_INTENT_MODES = ("llm_dialogue_intent", "out_of_scope")
_ANSWER_MODES = ("llm_dialogue_answer", "template_text")
_MEMORY_MODES = ("llm_dialogue_memory", "kept_previous")
_PLAN_MODES = ("llm_dialogue_plan", "out_of_scope")
_SMALLTALK_MODES = ("llm_dialogue_smalltalk", "fixed_text")
_KNOWLEDGE_MODES = ("llm_dialogue_knowledge", "out_of_scope")
# 지식 답의 말하지 않은 장소 이름은 장소 DB 에 등록돼 있으면 통과(사용자 결정 2026-10-30 "등록된 장소면 허용") — 이름 찾기(LLM 없는
# 매개변수 SQL, 문장 시한 1.5s)를 한 답에 셋까지만. 넷 이상이면 지어냈을 공산이 커 찾지 않고 막는다. 한 번 찾기 전마다 잔여가
# 문장 시한 + 여유만큼 있어야 한다(없으면 종전처럼 막는다 — 응답이 deadline 을 넘지 않게)
_REGISTERED_LOOKUP_MAX = 3
_REGISTERED_MIN_REMAINING_MS = 1_700
# 2‴ 계획이 도구 없이 닫은 말 중 지식 즉답(BR-AO-32)이 받는 gap — 정보성이면 일반 지식으로 답하고, 대신 해 달라는 일(예약·결제·표 끊기·
# 호출·번역)과 실시간 값은 지식 LLM 이 {"text": null} 로 닫아 종전 범위 밖 카드다. 장소·실시간에 묶인 gap(AMENITY·EVENTS·PLACE_DETAIL·
# REGION_WEATHER)과 ACCOUNT 는 넣지 않는다 — 일반 지식으로는 틀린 답이 된다. CHAT 은 잡담 경로다. 사용자 지시(2026-10-23, 다른 세션 경유)
# "관광 관련한 거에서는 out of scope 를 최대한 안 나게" — 관광 90문장 실측 범위 밖 15 중 KNOWLEDGE 7·LODGING 6·BOOKING 2, 이 브랜치 19문장
# 실측에서 "지하철 탈 때 팁"(TRANSPORT)·"아이랑 여행할 때 조심할 점"(OTHER)
_KNOWLEDGE_GAPS = frozenset({"KNOWLEDGE", "LODGING", "BOOKING", "TRANSPORT", "OTHER"})
# 인프라 실패 접두(게이트웨이 `_invoke` 의 사유 + 호출 예외) — 모델이 판단해서 거절한 것이 아니라 거절 표지를 붙이지 않는다
_INFRA_PREFIXES = ("timeout", "llm_error", "unsupported", "intent_error")

# 팬아웃 풀 — 프로세스에 하나(BLM §6 "요청마다 만들지 않는다"). 스레드는 첫 submit 때 생긴다.
# 32: 시한을 넘긴 작업도 소켓 시한(BackendPoiDb 10s·기상청 4s)까지 스레드를 쥔다 — 8 이면 느린 작업 8개가 다음 턴들을
# 풀 대기만으로 TIMEOUT 시켰다(2026-10-18 리뷰 재현). 프로세스당 I/O 대기 스레드라 값싸다.
_DLG_POOL = ThreadPoolExecutor(32, thread_name_prefix="dialogue")
# 뒤에서 도는 기억 요약 — 팬아웃 풀과 따로 둔다(요약 LLM 이 느려도 턴 팬아웃 스레드를 쥐지 않게, 섀도 풀 선례). 세션당 하나만 돈다.
_MEMORY_POOL = ThreadPoolExecutor(2, thread_name_prefix="dialogue-memory")


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


def _takes_day_areas(turn: DayAreaTurn, match: IntentMatch | None) -> bool:
    """확인한 날마다 동네로 넘겨도 되나 — 분류가 편집이면 맡는다. 다시 짜기(REPLAN)는 상황·날씨를 보는 제 길이 있어 고치지 않는다
    (팀 결정 'replan 은 날씨를 본다'). 그 밖의 분류는 모든 동네가 표 이름일 때만 고친다 — 꼬리로만 동네라고 한 말은 분류 판단을 이길
    근거가 약하다(2026-10-23 리뷰: '내일 완전히 다시 짜줘'·'오늘 추천 좀 해줘'를 가로챘다)."""
    if match is not None and match.intent is Intent.EDIT_SCHEDULE:
        return True
    if match is not None and match.intent is Intent.REPLAN:
        return False
    return turn.table_only


def _day_area_outcome(turn: DayAreaTurn, match: IntentMatch | None, cleared: DialogueContext) -> TurnOutcome:
    """확인한 날마다 동네 → FRAME(확인된 인자) 또는 되묻기(보기 = 완결된 명령문, 보류 없음). 분류가 무엇이었는지는 사유에 남긴다."""
    agreed = match is not None and match.intent is Intent.EDIT_SCHEDULE
    reason = f"day_area_{turn.code}" + ("" if agreed else f":classified={match.intent.value if match else 'none'}")
    confidence = match.confidence if agreed and match is not None else 0.9
    if turn.arguments is not None:
        return TurnOutcome("FRAME", (Frame(Intent.EDIT_SCHEDULE, turn.arguments, (), confidence, MatchRoute.LLM_DIRECT.value),),
                           None, None, cleared, 0, reason)
    frame = Frame(Intent.EDIT_SCHEDULE, {}, ("day_areas",), confidence, MatchRoute.LLM_DIRECT.value)
    return TurnOutcome("ARGUMENT_CLARIFY", (frame,), Clarify(0, "day_areas", turn.question or "", turn.options or None),
                       None, cleared, 0, reason)


def _not_repeating(outcome: TurnOutcome, inp: TurnInput) -> TurnOutcome:
    """답 문장이 직전 도우미 말과 똑같은 결정론 문장이면 같은 뜻의 다른 말로(2026-10-22 사용자 "계속 같은 말만"). 버튼·카드·칩은
    그대로 — 문장만. 첫 턴·다른 말이면 그대로라 기존 결정론은 변하지 않는다."""
    answer = outcome.answer
    if answer is None:
        return outcome
    said = [t.text for t in inp.recent_turns if t.role == "ASSISTANT"]
    text = unrepeated(answer.text, said)
    if text == answer.text and answer.text in _CLOSER_VARIANTS and answer.text in said:
        text = next((alt for alt in _CLOSER_VARIANTS[answer.text] if alt not in said), answer.text)
    return outcome if text == answer.text else replace(outcome, answer=replace(answer, text=text))


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


# "이 근처"·"여기 주변"·"숙소 근처" 같은 지시어는 지역 이름이 아니다 — 분류가 region 칸에 담아도(2026-10-21 실측 "근처·주변" 다섯 말
# 40회 중 0.2.3 9회·0.2.4 5회) 핸들러에는 없는 것으로 넘긴다. 탐색은 일정 근처로 가고, 여행도 없으면 지역을 되묻는다 — 지역 표에서
# 못 찾아 "그 지역은 아직 찾아 줄 수 없어요"로 끝나지 않게. 날씨도 같은 칸을 읽는다(일정 장소로 간다)
_DEICTIC_REGION = re.compile(r"(?:(?:이|그|저|여기|거기|숙소|호텔|지금)\s*)?(?:근처|주변|부근|인근|가까이|여기|거기)(?:\s*(?:근처|주변|부근))?")


def _without_deictic_region(args: Mapping[str, str]) -> dict[str, str]:
    region = (args.get("region") or "").strip()
    return {k: v for k, v in args.items() if k != "region"} if region and _DEICTIC_REGION.fullmatch(region) else dict(args)


def _grounded_args(slots: Mapping[str, str], said: str) -> dict[str, str]:
    """계획 인자의 region 은 사용자가 말한 지역만(BR-AO-28) — 모델이 [여행 상황]의 여행지를 옮겨 적으면 탐색 기준이 '다음 일정 근처'에서
    '지역 중심'으로 바뀐다(제주는 끝에서 끝이 70km 다). 프롬프트 0.1.1 뒤에도 "저녁 먹을 데랑 그 다음 일정" 이 2/2 로 region "제주" 를
    냈다(2026-10-20 실측). `said` 는 발화 + 최근 대화를 `_squash` 한 것 — 지시어로 앞 턴의 지역을 이은 것은 남는다."""
    region = slots.get("region")
    if region and _squash(region) not in said:
        return {k: v for k, v in slots.items() if k != "region"}
    return dict(slots)


# 지역을 내치거나 바깥을 가리키는 말 — 지역 이름이 있어도 '가볼 지역 고르기'다("제주 말고", "서울 근교")
_REGION_ELSEWHERE = re.compile(r"말고|빼고|제외|외에|근교|벗어")
# 언제·몇 월·좋은 계절을 묻는 말 — '어디로'가 아니라 '언제'다. 분류가 "부산 여행은 언제 가는 게 좋아?"를 3/3 지역 고르기로 보냈다
# (2026-10-23 실측, #1579 의 회귀 — 그 전엔 계획 단계 gap KNOWLEDGE). "언제든 갈 만한 데"는 시기를 묻는 말이 아니다
_ASKS_WHEN = re.compile(r"언제(?!든|라도|나)|몇\s*월|어느\s*(?:계절|달|시기|때)|(?:좋은|적당한|알맞은)\s*(?:계절|시기|때|달)")


# 계절·달의 날씨를 묻는 말 — 예보가 아니라 기후 경향이다("대구는 여름에 많이 더워?"·"제주도는 몇 월에 가야 덜 붐벼?"). 분류가 날씨 의도로
# 골랐고(신뢰도 0.32) 날씨 도구는 여행 날 예보만 알아 여행이 없으면 "먼저 여행을 만들어"로 끝났다(2026-10-23 실측) — 가까운 날을 말하지
# 않았으면 계획 단계에 맡긴다(시기·기후는 gap KNOWLEDGE → 일반 지식 즉답, BR-AO-32). 여행이 있는 턴은 종전대로(그 날 예보가 답일 수 있다)
_SEASONAL = re.compile(r"봄|여름|가을|겨울|장마|성수기|비수기|\d{1,2}\s*월|몇\s*월|계절|시기")
_NEAR_DAY = re.compile(r"오늘|내일|모레|이번\s*주|다음\s*주|주말|지금|당일|\d{1,2}\s*일")


def _seasonal_weather(heard: str) -> bool:
    return bool(_SEASONAL.search(heard)) and not _NEAR_DAY.search(heard)
# 가볼 지역을 묻는 말의 표지. 계절을 말하면서 이 표지가 없으면 지역 고르기가 아니라 그 철에 가도 되는지다 — 분류가 "장마철에 여행
# 가도 괜찮아?"를 지역 고르기로 보내 취향을 되물었다(2026-10-23 실측). "여름에 가기 좋은 여행지"는 고르기 그대로
_ASKS_WHERE = re.compile(r"어디|지역|여행지|도시|곳|동네|(?:만한|좋은|갈|볼|놀|쉴)\s*데")  # "갈 만한 데" — "~인데"의 데는 아니다
# 행사 낱말 — 축제·공연·전시가 언제인지는 장소 찾기가 행사 저장소로 답한다(#1486). 시기 질문 가드에서 뺀다
_EVENT_WORDS = re.compile(r"축제|공연|전시|행사|불꽃|콘서트|페스티벌|박람회|마켓|군항제|팝업")


def _not_region_choice(heard: str) -> bool:
    """가볼 지역 고르기(RECOMMEND_REGION)가 답이 아닌 말 — 시기를 묻거나, 철을 말하며 어디를 묻지 않거나, 이미 표 지역을
    말했다("말고·근교"는 고르기 그대로)."""
    return (bool(_ASKS_WHEN.search(heard)) or (bool(_SEASONAL.search(heard)) and not _ASKS_WHERE.search(heard))
            or (not _REGION_ELSEWHERE.search(heard) and bool(region_mentions(heard))))


def _when_not_where(heard: str) -> bool:
    """가기 좋은 시기를 묻는 말 — 장소 목록은 '언제'의 답이 아니다("해운대는 언제 가면 좋아?"가 장소 찾기로 갔다, 2026-10-23 실측).
    행사가 언제인지는 장소 찾기가 답한다."""
    return bool(_ASKS_WHEN.search(heard)) and not _EVENT_WORDS.search(heard)


def _region_named(call: IntentDraft, heard: str) -> IntentDraft | None:
    """계획이 가볼 지역 고르기(RECOMMEND_REGION)를 골랐어도 이번 말에 표 지역이 있으면 그 지역 안의 장소 탐색이다. 프롬프트 0.1.6 에
    규칙을 적었는데도 지역 이름 + 반나절 보낼 데 꼴이 3/3 으로 지역 추천으로 갔다(2026-10-22 실측) — 말한 지역을 추천 후보로 되돌려주면
    질문에 답하지 않은 것이다. 시기·철을 묻는 말이면 None — 지역 목록도 장소 목록도 답이 아니라 이 호출을 버린다."""
    if call.intent is not Intent.RECOMMEND_REGION or not _not_region_choice(heard):
        return call
    named = [] if _REGION_ELSEWHERE.search(heard) else region_mentions(heard)
    if _ASKS_WHEN.search(heard) or not named:
        return None
    theme = call.slots.get("theme")
    return replace(call, intent=Intent.EXPLORE_PLACES, slots={"region": named[0][1], **({"theme": theme} if theme else {})})


def _routed(call: IntentDraft, heard: str, *, seasonal_weather_is_knowledge: bool = False) -> IntentDraft | None:
    """계획 호출의 결정론 라우팅 — 지역 고르기는 `_region_named`, 시기 질문의 장소 찾기·골라 주기는 버린다. 철·달의 날씨(`_seasonal_weather`)
    도구는 여행이 없고 지식 즉답이 조립됐을 때만 버린다 — 분류 경로 되돌림 뒤 계획이 다시 날씨를 골라 "먼저 여행을 만들어"로 끝났다
    (2026-10-23 "대구는 여름에 많이 더워?"). 남는 게 없으면 지식 즉답(BR-AO-32). 분류 경로도 같은 술어로 계획 단계에 넘긴다(`_core`)."""
    if call.intent in (Intent.EXPLORE_PLACES, Intent.RECOMMEND_PLACES) and _when_not_where(heard):
        return None
    if call.intent is Intent.GET_WEATHER and seasonal_weather_is_knowledge and _seasonal_weather(heard):
        return None
    return _region_named(call, heard)


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
    """꺼내기 없는 `$memory` — 현재 세션 줄 전부 + 헤더 + 다른 세션(≤2) 줄 전부 (DE §6 `$memory`). 임베딩이 배선되지 않았거나
    꺼내기가 실패했을 때 쓴다(2026-10-23 전의 모양 그대로). 줄의 `inline()` 은 워커가 한다.
    지시 주입 꼴 줄은 싣지 않는다 — 기억 게이트가 이제 막지만 그 전에 저장된 줄(TTL 90일)이 남아 있을 수 있다."""
    def keep(line: str) -> bool:  # 옛 압축의 원문 조각도 뺀다 — 꺼내기 경로(`_recalled_lines`)와 같은 규칙
        return not is_turn_fragment(line) and not has_injection_like(line)

    lines = [line for line in current.summary if keep(line)] if current is not None else []
    other_lines = [line for m in others for line in m.summary if keep(line)]
    if other_lines:
        lines += [OTHER_SESSIONS_HEADER, *other_lines]
    return tuple(lines)


def _recalled_lines(
    current: DialogueMemory | None, others: Sequence[DialogueMemory], mine: Sequence[MemoryHit], theirs: Sequence[MemoryHit],
) -> tuple[str, ...]:
    """꺼낸 기억 → `$memory`: 이 세션 "요약" 줄(늘) + 점수 하한을 넘은 사실 줄 ≤`_RECALL_TOP_K` — **이 대화 줄이 먼저 칸을 채우고**
    남은 칸만 지난 여행 줄(헤더 아래)로 채운다(계정 전체를 한 번에 세우면 지난 여행 무관 줄이 이 대화의 관련 줄을 밀어냈다,
    2026-10-23 리뷰 재현). 0.2.0 이전 표지 없는 줄은 벡터가 없어 꺼내기에 안 걸리므로 다시 요약될 때까지 종전처럼 싣는다(이 대화 줄
    전부·지난 여행 최신 2의 줄 — 칸 수와 따로). 같은 줄은 한 번만, 지시 주입 꼴은 싣지 않는다(`_memory_lines` 와 같은 거름)."""
    picked: list[str] = []
    seen = set(gist_lines(current))

    def take(hits: Sequence[MemoryHit]) -> list[str]:
        got: list[str] = []
        for hit in hits:
            if len(picked) + len(got) >= _RECALL_TOP_K:
                break
            if hit.score < _RECALL_MIN_SCORE or hit.line in seen or has_injection_like(hit.line):
                continue
            seen.add(hit.line)
            got.append(hit.line)
        return got

    picked += (mine_lines := take(mine))
    their_lines = take(theirs)
    old_mine = [line for line in legacy_lines(current) if line not in seen]
    old_theirs = [line for m in others for line in legacy_lines(m) if line not in seen]
    theirs_all = [*their_lines, *old_theirs]
    return (*gist_lines(current), *mine_lines, *old_mine, *((OTHER_SESSIONS_HEADER, *theirs_all) if theirs_all else ()))


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
_PLACE_SUFFIX = r"(?:시장|공원|타워|해수욕장|박물관|미술관|전망대|폭포|오름|성당|궁|해변|마을|카페|호텔|랜드|파크|브루어리)"
_PLACE_LIKE = re.compile(r"[가-힣]{1,20}?" + _PLACE_SUFFIX)
_PLACE_SUFFIX_END = re.compile(_PLACE_SUFFIX + r"$")
# 지식 답(BR-AO-32)만 — 수식어 + 장소 접미 꼴의 일반명사는 장소 이름이 아니다("전통시장은 현금을"·"국립공원은 주말에"·"한옥마을은 주민이
# 사는 곳"). 프롬프트가 허용한 "그 지역이 무엇으로 알려졌는지·예절과 팁"의 말인데 막아 정상 답이 범위 밖 카드가 됐다(2026-10-23 리뷰 재현).
# ponytail: 수식어 목록은 닫히지 않는다 — 새 일반명사가 막히면 여기에 더한다(목록 밖 일반명사는 종전처럼 범위 밖 + 이벤트)
_GENERIC_PLACE = re.compile(
    r"(?:전통|재래|야|수산|어|농수산물|새벽|국립|도립|군립|시립|구립|도시|근린|생태|수목|체육|호수|강변|해상|해안|놀이|테마|워터|키즈|"
    r"한옥|벽화|민속|어촌|산골|시골|농촌|몽돌|모래|자갈|오션뷰|루프탑|감성|대형|동네|브런치|디저트|베이커리|애견|북|수제|특급|부티크|"
    r"비즈니스|전망|고|왕|역사|자연사|과학|미술)" + _PLACE_SUFFIX)


def _prompt_names(prompt: Mapping) -> list[str]:
    """`to_prompt_dict` 모양 사실의 장소·대상·앵커 이름 — 계획 병합본은 also 부분까지(정정본 C4). 측정 러너도 이것으로 아는 이름을 만든다."""
    names = [p["name"] for p in prompt.get("places", ()) if isinstance(p, Mapping) and isinstance(p.get("name"), str)]
    names += [v for v in (prompt.get("target"), prompt.get("anchor")) if isinstance(v, str)]
    # 행사(장소 탐색의 행사 주제) — 행사 이름·장소 주소도 사실 칸에 글자 그대로 있는 이름이다("여의도한강공원")
    names += [v for e in prompt.get("events", ()) if isinstance(e, Mapping) for v in (e.get("name"), e.get("place"))
              if isinstance(v, str)]
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


def _knowledge_unknown_places(text: str, slot_names: Sequence[str], said: Sequence[str]) -> list[str]:
    """지식 답(BR-AO-32)에서 아는 이름이 아닌 장소 이름(`_PLACE_LIKE` 꼴, 나온 순서·중복 없이) — 아는 이름은 스냅샷 슬롯 이름(`slot_names`,
    `_foreign_place` 와 같은 대조)과 사용자가 이미 한 말(`said` — 이번 말·창 안 최근 대화·꺼낸 기억 줄, 공백 뗀 글)이다. 한 말은 **부분
    문자열로만** 본다 — 접두 대조면 발화 "부산"이 "부산시민공원"을 통과시켰다. 말한 이름을 정식 명칭으로 늘린 꼴("해운대" →
    "해운대해수욕장")은 아는 이름이고, 일반명사(`_GENERIC_PLACE`)는 장소 이름이 아니다. 앞 턴·기억에서 말한 곳을 "거기"로 이어 물으면 그
    이름은 지어낸 게 아니다(2026-10-23 리뷰 재현). 여기 남은 이름은 호출측이 장소 DB 에 등록돼 있는지 본다(`_registered`)."""
    unknown: list[str] = []
    for word in re.findall(r"[가-힣]+", text):
        m = _PLACE_LIKE.match(word)
        if m is None or _GENERIC_PLACE.fullmatch(m.group(0)):
            continue
        name = m.group(0)
        stem = _PLACE_SUFFIX_END.sub("", name)
        if any(word.startswith(k) or name in k for k in slot_names):
            continue
        if any(name in t or (len(stem) >= 2 and stem in t) for t in said):
            continue
        if name not in unknown:
            unknown.append(name)
    return unknown


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
    `embedding` 은 기억 꺼내기(0‴)와 기억 줄 임베딩(6) — 없으면 종전처럼 기억 줄 전부를 싣는다(기능 부재는 강등이 아니다).
    `memory_pool` 은 뒤에서 도는 요약의 풀 — 테스트는 같은 스레드에서 바로 도는 실행기를 넣는다.
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
        embedding: EmbeddingPort | None = None,
        memory_pool: Executor | None = None,
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
        # wiring 은 임베딩이 없으면 늘 터지는 `UnwiredEmbedding`(model_id "unwired")을 넣는다 — 그대로 쓰면 기억이 있는 턴·요약마다 폴백
        # 이벤트가 났다(2026-10-23 리뷰 재현). 없음으로 읽어 종전 줄로 간다 — 기능 부재는 강등이 아니다
        self._embedding = embedding if embedding is not None and embedding.model_id != "unwired" else None
        self._memory_pool = memory_pool if memory_pool is not None else _MEMORY_POOL
        self._summarizing: set[str] = set()  # 이 프로세스에서 뒤의 요약이 돌고 있는 session_id — 같은 세션은 하나만
        self._summarizing_lock = threading.Lock()

    # ── 턴 ───────────────────────────────────────────────────────────────

    def turn(self, inp: TurnInput) -> TurnOutcome:
        """한 턴. 어떤 실패도 예외가 아니라 `TurnOutcome` 이다 — `PermissionDeniedError` 만 관통(fail-closed, TRIP-333)."""
        # 지난 턴 중 지시 주입 꼴은 어느 프롬프트(분류·답변·기억 요약)에도 다시 싣지 않는다 — 그 턴은 이미 범위 밖으로 끝났다
        inp = replace(inp, recent_turns=tuple(t for t in inp.recent_turns if not has_injection_like(t.text)))
        with llm_call_counter() as counter:
            current, others, read = self._load_memory(inp)
            writable = read and self._open_row(inp, current)
            # 프롬프트·핸들러는 창만 본다 — 요약 재료(`_remember`)는 BE 가 보낸 전부에서 고른다
            windowed = replace(inp, recent_turns=self._window(inp, current, read))
            try:
                outcome = self._core(windowed, current, others, counter)
            except PermissionDeniedError:
                raise
            except Exception as e:  # noqa: BLE001 — DL-5: 버그도 경계 밖으로 내지 않는다(BR §5 미결 #14 A안)
                outcome = self._crashed(inp, e)
            outcome = _not_repeating(outcome, windowed)
            if writable:  # 기억을 못 읽은 턴은 요약을 내지 않는다 — 없는 줄 알고 빈 기억에서 다시 쓰면 이전 줄을 잃는다(다음 차례에)
                said = (outcome.answer.text if outcome.answer is not None
                        else outcome.clarify.question if outcome.clarify is not None else None)
                self._remember(inp, current, said)  # outcome 과 무관(BLM §3 註)
            return replace(outcome, llm_calls=counter[0])

    def _window(self, inp: TurnInput, current: DialogueMemory | None, read: bool) -> tuple[RecentTurn, ...]:
        """프롬프트에 싣는 최근 대화 — 최근 3턴(`PROMPT_TURNS`) + 기억이 아직 덮지 못한 턴 전부(요약이 늦거나 실패해도 그 사이 턴이
        어느 프롬프트에서도 빠지지 않게, 2026-10-23 리뷰 재현). 기억 단계가 없거나 못 읽었으면 BE 가 보낸 전부(종전 그대로)."""
        if self._store is None or not inp.session_id or not read:
            return inp.recent_turns
        summarized = current.summarized_turn_index if current is not None else 0
        return last_turns(inp.recent_turns, max(PROMPT_TURNS, inp.context.turn_index - 1 - summarized))

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
        # 0‴ — 이번 말과 관련된 기억 꺼내기도 분류와 나란히 시작한다. 분류에는 이 대화를 잇는 줄만 싣고(꺼내기를 기다리지 않는다),
        # 답변·잡담에 꺼낸 줄을 싣는다 — 과거 대화는 프롬프트 창(최근 3턴)에서 빠지고 필요할 때 기억에서 꺼낸다(BR-AO-09 개정 2026-10-23)
        memory = self._recall(inp, current, others)
        trip_view = _trip_view(inp.snapshot)
        today = inp.now.astimezone(self._tz).date()
        trip_summary = _trip_summary(inp.snapshot, today)
        memory_lines = context_lines(current)  # 분류엔 이 대화를 잇는 줄(요약·결정·미해결)만 — 사실 줄은 꺼내기가 끝난 뒤 답변에
        # 1 — 보류 되묻기의 답 (LLM 0). 답이 아니면 보류를 버리고 새 요청으로 (BR-DLG-24)
        interp = None
        # 날마다 동네(spec 004) — 편집 에이전트와 같은 해석기로 말을 확인한다(LLM 0). 날·동네를 다 말한 완결된 말이면 보류의 답이 아니다
        area_turn = check_day_areas(inp.utterance, inp.snapshot, today)
        if inp.context.pending is not None and area_turn is None:
            interp = answer_pending(inp.utterance, inp.context, trip_view, self._confident_intent)
        if interp is None:
            # 2 — LLM 직접 분류 (+ 2′ 섀도 submit)
            match, reason = self._classify(inp, text, memory_lines, trip_summary, counter)
            if area_turn is not None and _takes_day_areas(area_turn, match):  # 2⁗ — 분류가 칸을 뭉개도(12/12) 확인한 해석으로 넘긴다
                return _day_area_outcome(area_turn, match, cleared)
            if match is not None and (match.intent is Intent.RECOMMEND_REGION and _not_region_choice(text) or match.intent in (
                    Intent.EXPLORE_PLACES, Intent.RECOMMEND_PLACES) and _when_not_where(text)):
                # 시기·철을 묻거나 지역을 이미 말했다 — 지역 고르기는 엉뚱한 지역 목록이나 취향 되묻기를, 장소 찾기는 '언제'에 장소 목록을
                # 낸다. 분류가 null 로 닫은 것처럼 계획 단계에 맡긴다(지역 안 장소면 탐색, 시기·여행 일반 지식이면 지식 즉답)
                match, reason = None, f"{NULL_INTENT}; routed_to_plan"
            elif (match is not None and match.intent is Intent.GET_WEATHER and inp.snapshot.trip is None
                  and self._knows_general() and _seasonal_weather(text)):
                # 계절·달의 날씨 = 기후 경향 — 여행 없는 턴의 예보 도구는 답이 없다(BR-AO-32). 지식 즉답이 조립됐을 때만 — 아니면 종전
                # 날씨 답("먼저 여행을 만들어")이 범위 밖 카드보다 낫다(미배정이면 종전과 같다, 2026-10-23 리뷰 재현)
                match, reason = None, f"{NULL_INTENT}; seasonal_weather_rerouted"
            if match is None:
                reason = reason or "intent_fallback"
                closer = closer_answer(text, inp.snapshot.trip is not None) if _judged_nothing(reason) else None
                if closer is not None:  # 2″ — 할 일이 없는 말에 범위 밖 카드를 내지 않는다(BR-AO-26)
                    if closer.text == GREETING_TEXT[inp.snapshot.trip is not None]:  # 인사만 LLM 으로 — 감사·맞장구는 고정 한 줄로 충분하다
                        closer = self._smalltalk(inp, closer, memory, trip_summary)
                    return TurnOutcome("ANSWER", (), None, closer, cleared, 0, reason)
                if self._planner is not None and _plannable(reason):  # 2‴ — 정해진 의도 밖이라도 조회로 도울 수 있으면 돕는다(BR-AO-28)
                    return self._plan_turn(inp, text, memory, trip_summary, cleared, reason)
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
            snapshot=inp.snapshot, arguments=_without_deictic_region(frame.arguments), now=inp.now, tz=self._tz,
            trace_id=inp.trace_id,
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
        answer = self._compose(inp, frame.intent, facts, memory(), trip_summary)
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
        self, inp: TurnInput, fixed: DialogueAnswer, memory: Callable[[], Sequence[str]], trip_summary: str,
    ) -> DialogueAnswer:
        """인사·잡담 한마디를 LLM 이 즉석에서 — 사실 없이 말을 받아 주고 여행 쪽 질문으로 끝낸다. 미배정이면 `fixed` 그대로(이벤트 없음 —
        의도된 결정론). 시한 부족·실패·게이트 드롭·목록 밖 장소(INV-1 — 사실이 없으니 스냅샷 장소 말고는 전부 지어낸 것)면 `fixed`
        + FallbackEvent 짝(INV-4). 버튼·칩은 `fixed` 의 것 그대로 — LLM 은 문장만 쓴다. `memory` 는 미배정·시한 부족을 지난 뒤에만
        부른다 — 꺼내기를 기다리는 것(≤0.3s)도 그 시한 이벤트도 기억을 쓰는 자리에서만(2026-10-23 리뷰 재현)."""
        if self._smalltalk_worker is None:
            return fixed
        remaining = self._remaining(inp)
        if remaining < _ANSWER_MIN_REMAINING_MS:
            self._fallback(inp, "llm", *_SMALLTALK_MODES, f"budget_exhausted(remaining_ms={remaining})")
            return fixed
        memory_lines = memory()
        timeout_ms = min(_ANSWER_CAP_MS, self._remaining(inp) - _ANSWER_RESERVE_MS)  # 꺼내기를 기다린 만큼 다시 잰다
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
        memory: Callable[[], tuple[str, ...]],
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
                answer = self._smalltalk(inp, fixed, memory, trip_summary)  # 기억은 쓰는 자리에서만 기다린다 — 계획 LLM 앞이 아니다
                return TurnOutcome("ANSWER", (), None, answer, cleared, 0, f"{reason}; plan:no_tool")
            if not draft.refused and draft.gap in _KNOWLEDGE_GAPS and (
                    knowledge := self._knowledge(inp, memory, trip_summary)) is not None:  # 일반 지식 즉답(BR-AO-32)
                self._log_plan(inp, "NO_TOOL", plan_ms=plan_ms, gap=draft.gap)
                return TurnOutcome("ANSWER", (), None, knowledge, cleared, 0, f"{reason}; plan:knowledge")
            return self._plan_declined(inp, reason, "REFUSED" if draft.refused else "NO_TOOL", plan_ms=plan_ms, gap=draft.gap)
        calls = [c for c in (_routed(call, text, seasonal_weather_is_knowledge=inp.snapshot.trip is None and self._knows_general())
                                     for call in draft.calls) if c is not None]
        if not calls:  # 시기·여행 일반 지식에 장소·지역·날씨 도구만 골랐다 — 조회로 답할 것이 없다(일반 지식)
            if (knowledge := self._knowledge(inp, memory, trip_summary)) is not None:
                self._log_plan(inp, "NO_TOOL", plan_ms=plan_ms, gap="KNOWLEDGE")
                return TurnOutcome("ANSWER", (), None, knowledge, cleared, 0, f"{reason}; plan:knowledge")
            return self._plan_declined(inp, reason, "NO_TOOL", plan_ms=plan_ms, gap="KNOWLEDGE")
        handlers = [HANDLERS[call.intent] for call in calls]
        said = _squash(" ".join([text, *(turn.text for turn in inp.recent_turns)]))
        earlier = tuple((turn.role, turn.text) for turn in inp.recent_turns)
        ctxs = [TurnContext(snapshot=inp.snapshot, arguments=_without_deictic_region(_grounded_args(call.slots, said)),
                            now=inp.now, tz=self._tz,
                            trace_id=inp.trace_id, remaining_ms=lambda: self._remaining(inp), ports=self._ports,
                            earlier=earlier, heard=text, solo=len(calls) == 1)
                for call in calls]
        n = len(ctxs)
        results = self._fanout(inp, step_tasks([h.plan(ctx) for h, ctx in zip(handlers, ctxs, strict=True)]))
        facts = merge_facts([h.assemble(ctx, step_results(results, i, n))
                             for i, (h, ctx) in enumerate(zip(handlers, ctxs, strict=True))])
        answer = self._compose(inp, facts.intent, facts, memory(), trip_summary, closed=True)
        self._log_plan(inp, "TOOLS", calls=draft.calls, arg_keys=[sorted(ctx.arguments) for ctx in ctxs], primary=facts.intent,
                       plan_ms=plan_ms,
                       task_status={name: r.status for name, r in results.items()})
        return TurnOutcome("ANSWER", (), None, answer, cleared, 0,
                           f"{reason}; plan:{'+'.join(call.intent.value for call in draft.calls)}")

    def _registered(self, inp: TurnInput, names: Sequence[str]) -> bool:
        """말하지 않은 장소 이름이 모두 장소 DB 에 등록된 곳인가 — 이름 찾기(`place_sql.find_place`, 공백 뗀 완전 일치). 장소 DB 미배선·
        이름 넷 이상·잔여 부족이면 False(종전처럼 막는다). DB 오류는 `find_place` 가 None 으로 접는다(INV-4 — 막는 쪽)."""
        lookup = self._ports.place_sql
        if lookup is None or len(names) > _REGISTERED_LOOKUP_MAX:
            return False
        trip = inp.snapshot.trip
        area = trip.regions[0] if trip is not None and trip.regions else None  # 같은 이름이 여럿이면 여행 지역으로 좁힌다
        for name in names:
            if self._remaining(inp) < _REGISTERED_MIN_REMAINING_MS:
                return False
            if lookup.find_place(name, area, inp.trace_id) is None:
                return False
        return True

    def _knows_general(self) -> bool:
        """지식 즉답이 닿는가 — 계획 단계(gap KNOWLEDGE 를 내는 자리)와 지식 워커가 둘 다 조립됐다."""
        return self._planner is not None and self._ports.unknown is not None and self._ports.unknown.knows_general

    def _knowledge(self, inp: TurnInput, memory: Callable[[], Sequence[str]], trip_summary: str) -> DialogueAnswer | None:
        """2‴ gap KNOWLEDGE — 조회 도구로 답할 게 없는 여행 일반 지식을 UnknownHandlingAgent 가 LLM 일반 지식으로 이번 턴에 답한다
        (BR-AO-32, 사용자 결정 2026-10-23). 각주는 결정론, 버튼은 잡담과 같은 홈 갈래. 미배선이면 None(종전 범위 밖 — 이벤트 없음),
        모른다고 닫았으면 None(판단 — 이벤트 없음). 시한 부족·워커 실패는 게이트웨이·여기서 이벤트, 지어낸 시각·등록되지 않은 장소
        이름(INV-1 — 사실이 없으니 스냅샷 장소 말고는 전부 지어낸 것)·모양 위반도 None + 이벤트(INV-4). `memory` 는 미배선·시한
        부족을 지난 뒤에만 부른다(`_smalltalk` 와 같다)."""
        agent = self._ports.unknown
        if agent is None or not agent.knows_general:
            return None
        remaining = self._remaining(inp)
        if remaining < _ANSWER_MIN_REMAINING_MS:
            self._fallback(inp, "llm", *_KNOWLEDGE_MODES, f"budget_exhausted(remaining_ms={remaining})")
            return None
        memory_lines = tuple(memory())
        task = KnowledgeTask(inp.utterance, inp.recent_turns, memory_lines, trip_summary, inp.trace_id, inp.now,
                             timeout_sec=min(_ANSWER_CAP_MS, self._remaining(inp) - _ANSWER_RESERVE_MS) / 1000)
        outcome = agent.run(task)
        if outcome.error is not None:  # 게이트웨이에 닿기 전 워커 예외 — 게이트웨이가 보고하지 못했다
            self._fallback(inp, "llm", *_KNOWLEDGE_MODES, f"knowledge_error: {outcome.error}")
            return None
        text = outcome.answer
        if text is None:  # 모른다고 닫음·게이트 드롭·시한 — 실패면 게이트웨이가 FallbackEvent 를 냈다
            return None
        # 아는 이름 = 스냅샷 장소 + 사용자가 이미 한 말(이번 말·창 안 최근 대화·꺼낸 기억 — "전주 한옥마을 갈 때 옷차림"·"거기 언제 가면
        # 좋아?" 처럼 되받는 것은 지어낸 게 아니다)
        slot_names = tuple(k for k in (_squash(s.name) for _, s in inp.snapshot.slots() if s.name) if k)
        said = tuple(k for k in (_squash(t) for t in (inp.utterance, *(turn.text for turn in inp.recent_turns), *memory_lines)) if k)
        times, unverifiable = clock_times(text)
        if times or unverifiable:  # 사실이 없는 자리 — 시각은 전부 지어낸 것(INV-2)
            self._fallback(inp, "llm", *_KNOWLEDGE_MODES, "time_not_in_facts")
            return None
        unknown = _knowledge_unknown_places(text, slot_names, said)
        if unknown and not self._registered(inp, unknown):
            self._fallback(inp, "llm", *_KNOWLEDGE_MODES, "place_not_in_facts")
            return None
        try:
            return DialogueAnswer(AnswerKind.TEXT, text, None, (_home_action(inp.snapshot.trip is not None),), None,
                                  KNOWLEDGE_FOOTNOTE)
        except ValueError as e:  # 게이트와 같은 검사 — 어긋나면 종전 범위 밖
            self._fallback(inp, "llm", *_KNOWLEDGE_MODES, f"answer_shape: {e}")
            return None

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

    # ── 0‴·6 메모리 ──────────────────────────────────────────────────────

    def _load_memory(self, inp: TurnInput) -> tuple[DialogueMemory | None, tuple[DialogueMemory, ...], bool]:
        """턴 시작에 현재 세션 기억 + 같은 계정의 다른 세션 ≤2(꺼내기가 없을 때의 줄). 읽기 실패는 "기억 없이 진행"(BR-AO-09) —
        WARN 1줄. 셋째 값은 현재 세션을 읽었는가 — 못 읽은 턴은 요약을 내지 않는다(`turn`)."""
        if self._store is None or not inp.session_id:
            return None, (), True
        current: DialogueMemory | None = None
        others: tuple[DialogueMemory, ...] = ()
        read = True
        try:
            current = self._store.get(inp.session_id)
        except Exception as e:  # noqa: BLE001
            read = False
            log.warning("도우미 기억 읽기 실패(%s) — 기억 없이 진행 (trace_id=%s)", type(e).__name__, inp.trace_id)
        if inp.account_ref:
            try:
                others = tuple(self._store.recent_for_account(
                    inp.account_ref, exclude_session=inp.session_id, limit=_OTHER_SESSIONS_LIMIT))
            except Exception as e:  # noqa: BLE001
                log.warning("지난 여행 기억 읽기 실패(%s) — 현재 세션 기억만 (trace_id=%s)", type(e).__name__, inp.trace_id)
        return current, others, read

    def _open_row(self, inp: TurnInput, current: DialogueMemory | None) -> bool:
        """요약 차례인데 행이 없으면 **턴 시작에** 빈 행부터 만든다 — 뒤의 저장(`advance`)은 있는 행만 고치므로 턴 도중·뒤의 요약 중에 온
        이력 지우기를 되살리지 않는다(BR-AO-10). 답한 뒤에 만들면 분류 LLM 을 기다리는 사이 온 지우기가 0행으로 끝나고 그 뒤 빈 행이
        대화를 되살렸다(2026-10-23 리뷰 재현). 못 만들면 이 턴은 요약하지 않는다(False) — 다음 턴이 다시 차례다."""
        if self._store is None or not inp.session_id or current is not None or not due(inp.context.turn_index, 0):
            return True
        trip_id = inp.snapshot.trip.trip_id if inp.snapshot.trip is not None else None
        try:
            self._store.put(DialogueMemory(inp.session_id, inp.account_ref, trip_id, (), 0, inp.now, expires_at_for(inp.now)))
        except Exception as e:  # noqa: BLE001 — 기억은 응답과 무관하다: 턴을 막지 않는다
            self._fallback(inp, "memory", _MEMORY_MODES[0], "skipped", f"memory_error: {type(e).__name__}")
            return False
        return True

    def _recall(
        self, inp: TurnInput, current: DialogueMemory | None, others: tuple[DialogueMemory, ...],
    ) -> Callable[[], tuple[str, ...]]:
        """0‴ — 답변·잡담의 `$memory` 를 돌려줄 함수. 임베딩이 있으면 이번 말과 가까운 기억 줄을 풀에서 미리 찾는다(분류와 나란히):
        이 세션 "요약" 줄 + 사실 줄 ≤6(`_recalled_lines`). 임베딩이 없으면 종전 줄(현재 세션 전부 + 지난 여행 최신 2) — 기능 부재는
        강등이 아니다. 찾기 실패는 종전 줄 + 이벤트, 답변 때까지 안 끝났으면 이 세션 줄 + 이벤트(INV-4)."""
        fallback = _memory_lines(current, others)
        if self._embedding is None or self._store is None or not inp.session_id or (current is None and not others):
            return lambda: fallback  # 꺼낼 기억이 없다 — 임베딩을 부르지 않는다
        future = self._submit(lambda: self._search_memory(inp, current, others, fallback))
        got: list[tuple[str, ...]] = []

        def lines() -> tuple[str, ...]:
            if not got:
                try:
                    got.append(future.result(timeout=_RECALL_WAIT_MS / 1000))
                except Exception:  # noqa: BLE001 — 시한뿐이다(찾기 안의 예외는 `_search_memory` 가 이미 삼켰다)
                    self._fallback(inp, "memory", "vector_recall", "current_session", f"recall_timeout({_RECALL_WAIT_MS}ms)")
                    got.append(_memory_lines(current, ()))
            return got[0]

        return lines

    def _search_memory(
        self, inp: TurnInput, current: DialogueMemory | None, others: tuple[DialogueMemory, ...], fallback: tuple[str, ...],
    ) -> tuple[str, ...]:
        """(풀에서) 이번 말 임베딩 → 이 세션 줄 검색, 그다음 같은 계정 줄 검색 → `$memory` 줄. 임베딩·DB 장애는 종전 줄 + 이벤트."""
        extra = len(gist_lines(current))  # 이 세션 "요약" 줄도 걸릴 수 있어(늘 싣는 줄이라 건너뛴다) 그만큼 더 받는다
        try:
            vector = self._embedding.embed(inp.utterance)
            model = self._embedding.model_id
            mine = self._store.search(vector, session_id=inp.session_id, account_ref=None, model=model,
                                      top_k=_RECALL_TOP_K + extra)
            theirs = () if not inp.account_ref else tuple(
                h for h in self._store.search(vector, session_id=inp.session_id, account_ref=inp.account_ref, model=model,
                                              top_k=_RECALL_TOP_K + extra + SUMMARY_MAX_LINES)  # 이 세션 줄을 빼고도 칸이 남게
                if h.session_id != inp.session_id)
        except Exception as e:  # noqa: BLE001 — 기억은 참고 자료다: 못 찾으면 종전 줄로 답한다
            self._fallback(inp, "memory", "vector_recall", "recent_sessions", f"recall_error: {type(e).__name__}")
            return fallback
        lines = _recalled_lines(current, others, mine, theirs)
        best = max((h.score for h in (*mine, *theirs)), default=None)
        # 하한 튜닝 재료 — 건수·최고 점수만(줄 내용·account_ref 없음)
        log.info("dialogue_memory_recall %s", json.dumps({
            "event": "dialogue_memory_recall", "trace_id": inp.trace_id, "hits": len(mine) + len(theirs),
            "kept": sum(line != OTHER_SESSIONS_HEADER for line in lines) - extra,
            "top": round(best, 3) if best is not None else None}))
        return lines

    def _remember(self, inp: TurnInput, current: DialogueMemory | None, answer_text: str | None = None) -> None:
        """6 — 요약 차례(3턴)면 답한 **뒤에** 뒤에서 요약한다: 턴 시한·`llm_calls` 밖(BR-AO-07·09 개정 2026-10-23). 행이 없던 세션의
        빈 행은 턴 시작에 이미 만들었다(`_open_row`) — 뒤의 저장(`advance`)은 있는 행만 고친다(BR-AO-10). 이 프로세스에서 같은 세션 요약이 아직 돌면 내지 않는다 — 다음 턴이 다시 차례다(재료는 BE 최근 창 20건 안에 남아 있다).
        `answer_text` 는 이 턴 도우미 말(답 문장 또는 되묻기 질문) — 없으면(FRAME·범위 밖: 문장은 BE 가 짓는다) 이 턴은 빼고 앞 턴까지만
        요약해 다음 차례가 BE 창의 그 턴 메시지로 담는다(되묻기·제안 문장이 요약에 끝내 안 들어가던 길, 2026-10-23 리뷰 재현)."""
        if self._store is None or not inp.session_id:
            return
        summarized = current.summarized_turn_index if current is not None else 0
        if not due(inp.context.turn_index, summarized):
            return
        with self._summarizing_lock:
            if inp.session_id in self._summarizing:
                return
            self._summarizing.add(inp.session_id)
        try:
            trip_id = inp.snapshot.trip.trip_id if inp.snapshot.trip is not None else None
            # 재료 = 아직 요약하지 않은 지난 턴 + 이번 턴(발화·도우미 말) — 이번 턴을 빼고 이 턴 번호를 적으면 이번 턴이 장기 기억에서
            # 영영 빠진다(2026-10-18 리뷰 재현). 0′ 에서 거절한 발화도 요약 차례면 여기로 온다 — 지난 턴과 같은 거름
            upto, this_turn = inp.context.turn_index, ()
            if answer_text is None:
                upto -= 1
            else:
                this_turn = tuple(RecentTurn(role, text[:RECENT_TURN_CHARS])
                                  for role, text in (("USER", inp.utterance.strip()), ("ASSISTANT", answer_text.strip()))
                                  if text and not has_injection_like(text))
            turns = material(inp.recent_turns, inp.context.turn_index, summarized) + this_turn
            trip_summary = _trip_summary(inp.snapshot, inp.now.astimezone(self._tz).date())
            # 빈 문맥에서 돌린다 — 턴 `llm_calls` 카운터(contextvar)가 뒤의 요약을 세지 않게(같은 스레드에서 바로 도는 실행기도 같다)
            self._memory_pool.submit(contextvars.Context().run, self._summarize_later, inp, current, trip_id, turns, trip_summary,
                                     upto)
        except Exception as e:  # noqa: BLE001 — 기억은 응답과 무관하다: 어떤 실패도 턴을 막지 않는다
            self._done_summarizing(inp.session_id)
            self._fallback(inp, "memory", _MEMORY_MODES[0], "skipped", f"memory_error: {type(e).__name__}")

    def _summarize_later(
        self, inp: TurnInput, current: DialogueMemory | None, trip_id: str | None, turns: tuple[RecentTurn, ...],
        trip_summary: str, upto: int,
    ) -> None:
        """(뒤에서) 요약 LLM → 줄 임베딩 → `advance`. 실패는 이전 기억 그대로 + 이벤트, 다음 턴에 다시 — 대화 원문 조각으로
        저장하지 않는다(FD 미결 #10 B안, 2026-10-23). 위로 던질 곳이 없어 모든 예외를 이벤트로 끝낸다."""
        try:
            # 예전에 저장된 지시문 꼴 줄은 요약에 넘기지 않는다 — 이번 갱신으로 저장본에서도 빠진다(`_memory_lines` 와 같은 거름)
            previous = tuple(line for line in current.summary if not has_injection_like(line)) if current is not None else ()
            if not turns:  # 재료 없이 LLM 을 부르지 않는다 — 의도된 결정론, 폴백 아님 (BR-AO-25)
                lines = kept_lines(previous)
            else:
                result = self._memory.summarize(previous, turns, trip_summary, inp.trace_id, inp.now,
                                                timeout_sec=_MEMORY_TIMEOUT_S)
                if result.is_fallback:  # 파싱 실패·전부 드롭·시한 — FallbackEvent(llm_dialogue_memory→kept_previous)는 게이트웨이가 냈다
                    return
                lines = tuple(result.value) if result.value else self._kept(inp, previous)
            record = DialogueMemory(inp.session_id, inp.account_ref, trip_id, lines, upto, inp.now,
                                    expires_at_for(inp.now))  # 게이트가 못 본 모양 위반(줄 안 줄바꿈 등)은 ValueError → 아래 이벤트
            vectors = self._line_vectors(inp, lines)
            saved = self._store.advance(record, vectors, model=self._embedding.model_id if vectors is not None else None)
            log.info("dialogue_memory_saved %s", json.dumps({
                "event": "dialogue_memory_saved", "trace_id": inp.trace_id, "lines": len(lines),
                "vectors": len(vectors) if vectors is not None else None, "saved": saved}))  # saved=false — 그사이 지워졌다·더 새 요약이 있다
        except Exception as e:  # noqa: BLE001
            self._fallback(inp, "memory", *_MEMORY_MODES, f"memory_error: {type(e).__name__}")
        finally:
            self._done_summarizing(inp.session_id)

    def _line_vectors(self, inp: TurnInput, lines: tuple[str, ...]) -> dict[str, tuple[float, ...]] | None:
        """줄 → 임베딩(종류 표지를 뗀 본문). 임베딩이 없으면 None(벡터는 손대지 않는다). 실패도 None + 이벤트 — 요약은 그대로
        저장하고, 그 줄은 다음 요약 때 다시 임베딩한다(그동안 꺼내기에 안 걸린다)."""
        if self._embedding is None:
            return None
        try:
            return dict(zip(lines, self._embedding.embed_batch([split_kind(line)[1] for line in lines]), strict=True))
        except Exception as e:  # noqa: BLE001
            self._fallback(inp, "memory", "line_vectors", "summary_only", f"embedding_error: {type(e).__name__}")
            return None

    def _kept(self, inp: TurnInput, previous: tuple[str, ...]) -> tuple[str, ...]:
        """요약 LLM 이 비운 배열 = 새로 기억할 것 없음 → 이전 줄은 두되 옛 압축의 원문 조각·술어 위반 줄은 지운다(BR-AO-09). 폴백이 아니라
        이벤트가 없다 — 모델이 늘 비우는 고장이 보이도록 건수만 한 줄 남긴다(내용·account_ref 없음)."""
        kept = kept_lines(previous)
        log.info("dialogue_memory_empty %s", json.dumps({
            "event": "dialogue_memory_empty", "trace_id": inp.trace_id, "kept_lines": len(kept),
            "dropped_lines": len(previous) - len(kept)}))
        return kept

    def _done_summarizing(self, session_id: str) -> None:
        with self._summarizing_lock:
            self._summarizing.discard(session_id)

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
