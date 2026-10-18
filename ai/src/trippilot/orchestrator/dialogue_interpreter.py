"""대화 해석기 — `POST /ai/v1/dialogue/interpret` 의 본체 (U8 FD §3, G-U8-4).

**AI 는 해석만 한다**(DEC-U8-1). 발화 하나를 받아 의도 프레임 하나 · 인자 되묻기 · 범위 밖 중
하나로 답하고, 실행(일정 생성·편집·조회)은 백엔드 `assistant` 모듈이 기존 흐름으로 한다.
사용자에게 보이는 문장도 백엔드 템플릿이 만든다(DEC-U8-6) — 여기서 나가는 자유 문구는
인자표의 고정 되묻기 문안(`CLARIFY_QUESTIONS`)뿐이다.

## 상태는 들고 있지 않는다

`DialogueContext`(보류 프레임 · 되묻기 횟수 · 턴 번호)를 매 턴 **받아서 갱신본을 돌려준다**.
백엔드가 세션 행에 그대로 저장·반송한다(DEC-U8-4) — 파드가 몇 개여도 상관없다.

## 한 턴

1. 보류 프레임이 있으면 이번 발화를 **그 질문의 답**으로 먼저 읽는다 — 물은 인자의 추출기만
   돌린다(FD assistant-dialogue §2.1: 전부 돌리면 "3박 4일" 이 엉뚱한 칸에 들어간다).
   답이 아니면(다른 요청이면) 보류를 버리고 새 요청으로 처리한다.
2. 아니면 3단 `IntentRouter` 로 라우팅한다.
3. 필수 인자가 비었으면 **요청당 1회** 되묻는다(DEC-U8-11). 두 번째에도 비면 프레임을 그대로
   내고(`missing` 에 남긴다) 백엔드 처리기가 자기 방식으로 묻거나 안내한다 — 같은 질문을
   되풀이하는 루프를 만들지 않는다.
"""

from __future__ import annotations

import contextlib
import contextvars
import logging
import threading
import time
from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime

from trippilot.domain.common import TraceId
from trippilot.domain.dialogue import (
    CLARIFY_QUESTIONS,
    ArgumentKind,
    ArgumentSpec,
    missing_arguments,
    specs_of,
)
from trippilot.domain.intent import ROUTABLE_INTENTS, Intent, IntentMatch, MatchRoute
from trippilot.orchestrator.arguments import extract_argument
from trippilot.orchestrator.intent_router import IntentRouter, normalize
from trippilot.orchestrator.question_bank import BankEntry, BankVectors, index_bank
from trippilot.ports.embedding_port import EmbeddingPort
from trippilot.ports.llm_port import LlmPort, LlmRequest, LlmResponse
from trippilot.ports.vector_store_port import VectorStorePort

log = logging.getLogger(__name__)

# 되묻기는 요청당 1회(DEC-U8-11).
MAX_CLARIFY_PER_REQUEST = 1
# 되묻기에 대한 답으로 **문장 전체를 그 인자 값으로 받는** 길이 상한. 장소·항목을 묻는 질문의
# 답은 짧다("카페 모카", "다음 일정"). 긴 문장은 답이 아니라 새 요청일 가능성이 높아 라우터로 보낸다.
SHORT_ANSWER_CHARS = 20
# 보기(quick reply)로 내는 항목 상한 — 백엔드 칩 줄이 넘치지 않게.
MAX_OPTIONS = 4
# 규칙 추출기로는 못 뽑는 종류 — 되묻기의 답이면 문장 자체가 값이다.
_REFERENCE_KINDS = frozenset({
    ArgumentKind.PLACE_REF, ArgumentKind.SLOT_REF, ArgumentKind.REGION, ArgumentKind.FREE_TEXT,
})


# ── LLM 호출 수 세기 ────────────────────────────────────────────────────────
#
# 백엔드가 도우미 사용량 상한을 이 수로 센다(COST-U8-02) — 빠지면 상한이 0으로 센다.
# 게이트웨이는 인스턴스를 요청 간에 공유하므로 카운터를 거기 둘 수 없다. 요청마다
# contextvar 에 새 카운터를 걸고, 라우터 전용 LLM 래퍼가 걸린 카운터에만 더한다.
_llm_calls: contextvars.ContextVar[list[int] | None] = contextvars.ContextVar(
    "dialogue_llm_calls", default=None)


class CountingLlm:
    """LlmPort 래퍼 — 해석 요청 안에서 일어난 호출만 센다(실패한 호출도 센다: 비용은 났다)."""

    def __init__(self, inner: LlmPort) -> None:
        self._inner = inner

    def invoke(self, request: LlmRequest) -> LlmResponse:
        counter = _llm_calls.get()
        if counter is not None:
            counter[0] += 1
        return self._inner.invoke(request)


@contextlib.contextmanager
def llm_call_counter() -> Iterator[list[int]]:
    """이 블록 안에서 `CountingLlm` 을 지난 호출을 센다 — `interpret` 와 `DialogueOrchestrator.turn` 이 같은 카운터를 쓴다."""
    counter = [0]
    token = _llm_calls.set(counter)
    try:
        yield counter
    finally:
        _llm_calls.reset(token)


# ── 대화 상태 (백엔드가 저장·반송하는 직렬형) ───────────────────────────────


@dataclass(frozen=True, slots=True)
class PendingFrame:
    """되물은 채 답을 기다리는 프레임 — 무엇을 물었는지(`asked`)를 안다."""

    intent: Intent
    arguments: Mapping[str, str]
    asked: str
    confidence: float

    def to_dict(self) -> dict:
        return {"intent": self.intent.value, "arguments": dict(self.arguments),
                "asked": self.asked, "confidence": self.confidence}

    @classmethod
    def from_dict(cls, d: Mapping) -> "PendingFrame":
        intent = Intent(d["intent"])
        if intent not in ROUTABLE_INTENTS:
            raise ValueError(f"보류 프레임 의도가 위임 대상이 아니다: {intent.value}")
        # 타입은 여기서 막는다 — `.items()` 의 AttributeError 는 `DialogueContext.from_dict` 의
        # 복구 except 를 빠져나가 500 이 된다. `str()` 은 무엇이든 받아 줘서 리스트가 질문 이름이 됐다.
        args = d.get("arguments") or {}
        if not isinstance(args, Mapping):
            raise TypeError(f"보류 프레임 arguments 가 객체가 아니다: {type(args).__name__}")
        asked = d["asked"]
        if not isinstance(asked, str):
            raise TypeError(f"보류 프레임 asked 가 문자열이 아니다: {type(asked).__name__}")
        return cls(intent=intent, arguments={str(k): str(v) for k, v in args.items()},
                   asked=asked, confidence=float(d.get("confidence", 0.5)))


@dataclass(frozen=True, slots=True)
class DialogueContext:
    pending: PendingFrame | None = None
    turn_index: int = 0
    clarify_count: int = 0

    def to_dict(self) -> dict:
        return {"pending": self.pending.to_dict() if self.pending else None,
                "turn_index": self.turn_index, "clarify_count": self.clarify_count}

    @classmethod
    def from_dict(cls, d: Mapping | None) -> "DialogueContext":
        """처음 턴(None·빈 객체)은 빈 상태다. **깨진 상태는 버리고 새로 시작한다** — 저장된
        보류가 읽히지 않는다고 턴 전체를 실패시키면 사용자는 그 세션에서 다시는 말을 못 건다.
        버린 사실은 로그에 남긴다(INV-4)."""
        if not d:
            return cls()
        try:
            turn = int(d.get("turn_index") or 0)
        except (ValueError, TypeError, OverflowError) as e:
            log.warning("dialogue_context turn_index 를 읽지 못해 0 으로 둔다: %s: %s", type(e).__name__, e)
            turn = 0
        try:
            pending = PendingFrame.from_dict(d["pending"]) if d.get("pending") else None
            clarify = int(d.get("clarify_count") or 0)
        except (KeyError, ValueError, TypeError, OverflowError) as e:
            log.warning("dialogue_context 보류 프레임을 읽지 못해 버린다: %s: %s", type(e).__name__, e)
            return cls(turn_index=turn)
        return cls(pending=pending, turn_index=turn, clarify_count=clarify)


# ── 결과 ────────────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class Frame:
    intent: Intent
    arguments: Mapping[str, str]
    missing: tuple[str, ...]
    confidence: float
    match_route: str


@dataclass(frozen=True, slots=True)
class Clarify:
    frame_index: int
    argument: str
    question: str
    options: tuple[str, ...] | None


@dataclass(frozen=True, slots=True)
class Interpretation:
    outcome: str  # FRAME | ARGUMENT_CLARIFY | OUT_OF_SCOPE
    frames: tuple[Frame, ...]
    clarify: Clarify | None
    context: DialogueContext
    llm_calls: int
    reason: str | None = None  # 관측용 — 폴백·승격 사유


@dataclass(frozen=True, slots=True)
class TripView:
    """되묻기 보기를 만들 재료 — 백엔드가 권한을 확인해 보낸 스냅샷에서 뽑은 것만."""

    day_count: int = 0
    slot_names: tuple[str, ...] = ()


# ── 질문뱅크 색인 ───────────────────────────────────────────────────────────


class BankIndex:
    """질문뱅크를 **현재 임베딩 모델로** 메모리 스토어에 색인한다 — 기동 때 백그라운드로 한 번(`warm`).

    실 DB 에 적재하지 않는 이유: 485문장이라 기동 뒤 한 번 임베딩하면 끝나고, 매번 현재 모델로
    새로 만드니 "모델을 바꿨는데 옛 벡터가 남아 엉터리 순위를 낸다"(TRIP-519 가 KB 에서 막은
    문제)가 원천적으로 생길 수 없다. 컬렉션 슬러그·이전 절차가 필요 없다.

    임베딩 서비스가 죽어 있으면 색인을 미루고 **그동안 라우터는 1차를 건너뛰어 3차로 간다**
    (`IntentRouter._route` 의 `bank_unavailable`). `retry_after_s` 뒤 다시 시도한다.
    """

    def __init__(
        self,
        entries: Sequence[BankEntry],
        embedding: EmbeddingPort | None,
        store: VectorStorePort,
        *,
        retry_after_s: float = 60.0,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
        precomputed: BankVectors | None = None,
    ) -> None:
        self._entries = tuple(entries)
        self._sleep = sleep
        self._warm_lock = threading.Lock()
        self._warming = False
        self._embedding = embedding
        self._store = store
        self._retry_after_s = retry_after_s
        self._clock = clock
        self._lock = threading.Lock()
        self._indexed = not self._entries  # 빈 뱅크는 할 일이 없다
        self._next_try = 0.0
        if precomputed is not None and not self._indexed and embedding is not None:
            self._load_precomputed(precomputed, embedding)

    def _load_precomputed(self, pre: BankVectors, embedding: EmbeddingPort) -> None:
        """미리 계산한 벡터가 지금 뱅크·모델의 것이면 임베딩 호출 없이 바로 싣는다(기동 즉시 1차 가능).
        아니면 이유를 남기고 종전처럼 원격 색인(`warm`)에 맡긴다 — 맞지 않는 벡터는 싣지 않는다."""
        reason = pre.unusable_reason(self._entries, embedding.model_id, embedding.dim)
        if reason is not None:
            log.warning("미리 계산한 질문뱅크 벡터를 쓰지 않음(%s) — 원격 색인으로", reason)
            return
        n = index_bank(self._entries, embedding, self._store, vectors=pre.vectors)
        self._indexed = True
        log.info("질문뱅크 색인 완료 — %d문장 (미리 계산한 벡터)", n)

    @property
    def indexed(self) -> bool:
        return self._indexed

    def ensure(self) -> None:
        """색인을 한 번 시도한다. 다른 스레드가 색인 중이면 **기다리지 않고** 돌아간다 — 기다리면 그 요청이
        색인 시간(원격 임베딩 485문장)만큼 서서 백엔드 해석 상한을 넘긴다."""
        if self._indexed or self._embedding is None:
            return
        if not self._lock.acquire(blocking=False):
            return
        try:
            if self._indexed or self._clock() < self._next_try:
                return
            try:
                n = index_bank(self._entries, self._embedding, self._store)
            except Exception as e:  # 해석을 죽이지 않는다 — 1차 없이 돈다
                self._next_try = self._clock() + self._retry_after_s
                log.warning("질문뱅크 색인 실패(%s: %s) — %.0fs 뒤 재시도, 그동안 1차 매칭 없이 해석",
                            type(e).__name__, e, self._retry_after_s)
                return
            self._indexed = True
            log.info("질문뱅크 색인 완료 — %d문장", n)
        finally:
            self._lock.release()

    def warm(self) -> None:
        """색인을 백그라운드로 시작한다 — 기동 때 한 번, 그리고 아직 색인 전이면 해석마다(중복은 `ensure` 가
        거른다). 해석 요청은 색인을 직접 하지 않는다: 첫 요청이 색인 시간을 떠안으면 상한을 넘긴다.

        스레드는 **색인될 때까지** 재시도 간격마다 다시 시도한다 — DEV 에서 AI 가 임베딩 서비스보다 먼저 떠
        기동 시도가 연결 거부로 실패했고, 그 뒤엔 해석 요청이 와야만 재시도됐다."""
        if self._indexed or self._embedding is None:
            return
        with self._warm_lock:  # 재시도 스레드는 하나만 — 해석마다 부르므로 안 막으면 스레드가 쌓인다
            if self._warming:
                return
            self._warming = True
        threading.Thread(target=self._retry_until_indexed, name="bank-index", daemon=True).start()

    def _retry_until_indexed(self) -> None:
        try:
            while not self._indexed:
                self.ensure()
                if not self._indexed:
                    self._sleep(max(self._next_try - self._clock(), 0.0) + 0.01)
        finally:
            with self._warm_lock:
                self._warming = False


# ── 해석기 ──────────────────────────────────────────────────────────────────


class DialogueInterpreter:
    def __init__(self, router: IntentRouter, bank: BankIndex | None = None) -> None:
        self._router = router
        self._bank = bank

    def interpret(
        self,
        utterance: str,
        context: DialogueContext,
        trip: TripView,
        trace_id: TraceId,
        now: datetime,
    ) -> Interpretation:
        with llm_call_counter() as counter:
            if self._bank is not None:
                self._bank.warm()  # 색인 전이면 백그라운드로 — 이번 해석은 1차 없이 간다
            result = None
            if context.pending is not None:
                result = answer_pending(utterance, context, trip, self._router.confident_intent)
            if result is None:
                match = self._router.route(utterance, trace_id, now)
                # 새 요청이다 — 되묻기 횟수는 요청마다 새로 센다.
                result = from_match(match, context, trip)
            return _with_calls(result, counter[0])


# 아래 둘은 해석기와 도우미 오케스트레이터(`dialogue_orchestrator`)가 **같은 로직**을 쓰도록 모듈 함수다
# (assistant-orchestrator FD BLM §3 1·3단 "기존 재사용", BR §5 미결 #17 — 로직 무변경, 공개 승격만).


def answer_pending(
    utterance: str,
    context: DialogueContext,
    trip: TripView,
    confident_intent: Callable[[str], Intent | None],
) -> Interpretation | None:
    """되묻기에 대한 답 — 물은 인자의 추출기만 돌린다. 답이 아니면 None(호출측이 보류를 버리고 새 요청으로).

    `confident_intent` 는 "짧은 답이 다른 요청인가"를 LLM 0회로 가르는 1차 매칭(`IntentRouter.confident_intent`)이다.
    """
    pending = context.pending
    assert pending is not None
    text = normalize(utterance)
    spec = _spec_of(pending.intent, pending.asked)
    value: str | None = None
    if spec is not None:  # 인자표 밖(예: 입력 필드)은 추출기를 돌리지 않는다
        value = extract_argument(text, spec)
        if value is None and _reference_like(spec) and 0 < len(text) <= SHORT_ANSWER_CHARS:
            # 짧은 답이라도 **다른 요청이 확실하면** 답으로 삼키지 않는다 — "날씨 알려줘"를
            # 목적지로 받으면 안 된다. 1차 매칭만 본다(LLM 0회).
            other = confident_intent(text)
            if other is None or other is pending.intent:
                value = text
    if value is None:
        return None
    arguments = {**pending.arguments, pending.asked: value}
    return _finish(
        pending.intent, arguments, pending.confidence, "CLARIFY_ANSWER",
        context, trip, asked_already=context.clarify_count,
    )


def from_match(match: IntentMatch, context: DialogueContext, trip: TripView) -> Interpretation:
    """매칭 결과 → 해석 — 필수 인자가 비면 요청당 1회 되묻는다(DEC-U8-11)."""
    if match.match_route is MatchRoute.FALLBACK or match.intent not in ROUTABLE_INTENTS:
        return Interpretation(
            outcome="OUT_OF_SCOPE",
            frames=(Frame(Intent.OUT_OF_SCOPE, {}, (), 0.0, MatchRoute.FALLBACK.value),),
            clarify=None,
            context=DialogueContext(turn_index=context.turn_index),
            llm_calls=0,
            reason=match.reason,
        )
    return _finish(
        match.intent, _stringify(match.slots), match.confidence, match.match_route.value,
        context, trip, asked_already=0, reason=match.reason,
    )


def _finish(
    intent: Intent,
    arguments: Mapping[str, str],
    confidence: float,
    route: str,
    context: DialogueContext,
    trip: TripView,
    *,
    asked_already: int,
    reason: str | None = None,
) -> Interpretation:
    missing = missing_arguments(intent, frozenset(arguments))
    frame = Frame(intent, dict(arguments), missing, confidence, route)
    if missing and asked_already < MAX_CLARIFY_PER_REQUEST:
        asked = missing[0]
        return Interpretation(
            outcome="ARGUMENT_CLARIFY",
            frames=(frame,),
            clarify=Clarify(
                frame_index=0, argument=asked,
                question=CLARIFY_QUESTIONS[(intent, asked)],
                options=_options(_spec_of(intent, asked), trip),
            ),
            context=DialogueContext(
                pending=PendingFrame(intent, dict(arguments), asked, confidence),
                turn_index=context.turn_index,
                clarify_count=asked_already + 1,
            ),
            llm_calls=0,
            reason=reason,
        )
    return Interpretation(
        outcome="FRAME", frames=(frame,), clarify=None,
        context=DialogueContext(turn_index=context.turn_index),
        llm_calls=0, reason=reason,
    )


def _with_calls(result: Interpretation, calls: int) -> Interpretation:
    return Interpretation(result.outcome, result.frames, result.clarify, result.context,
                          calls, result.reason)


def _spec_of(intent: Intent, name: str) -> ArgumentSpec | None:
    return next((s for s in specs_of(intent) if s.name == name), None)


def _reference_like(spec: ArgumentSpec) -> bool:
    return any(k in _REFERENCE_KINDS for k in spec.kinds)


def _options(spec: ArgumentSpec | None, trip: TripView) -> tuple[str, ...] | None:
    """보기는 여행 스냅샷에서만 만든다 — 없으면 None(자유 입력)."""
    if spec is None:
        return None
    if ArgumentKind.ORDINAL in spec.kinds and trip.day_count > 0:
        # "N일차" 는 순번 추출기가 그대로 읽는 꼴이라 보기를 눌러도 답으로 받힌다.
        return tuple(f"{i}일차" for i in range(1, min(trip.day_count, 7) + 1))
    if _reference_like(spec) and trip.slot_names:
        return tuple(dict.fromkeys(trip.slot_names))[:MAX_OPTIONS]
    return None


def _stringify(slots: Mapping[str, object]) -> dict[str, str]:
    """경계는 `Map<String, String>` 이다 — 복수 인자(튜플)는 쉼표로 접는다."""
    out: dict[str, str] = {}
    for k, v in slots.items():
        if isinstance(v, (tuple, list)):
            out[str(k)] = ", ".join(str(x) for x in v)
        else:
            out[str(k)] = str(v)
    return out


__all__ = [
    "BankIndex", "Clarify", "CountingLlm", "DialogueContext", "DialogueInterpreter", "Frame",
    "Interpretation", "PendingFrame", "TripView", "answer_pending", "from_match", "llm_call_counter",
]
