"""섀도 프로브 — 기존 3단 `IntentRouter` 를 **응답 경로 밖에서** 돌려 서비스 판정과 비교만 한다
(assistant-orchestrator FD BLM §9 · DE §2.7·§5 · BR-AO-08).

서비스 판정은 LLM 직접 분류(`DIALOGUE_INTENT`)로 바뀌었다(DEC-AO-2). 뱅크 3단 경로의 가치(LLM 0회·<50ms)를
버리기 전에 **일치율·경로 비중·지연·호출 수**를 실사용 발화로 재서 되돌릴 근거를 남기는 것이 이 모듈의 일이다.
라벨이 없으므로 정확도가 아니라 일치율이다.

세 부품:
- `ShadowCountingLlm` — LlmPort 래퍼, **인스턴스 카운터 + Lock**. `CountingLlm` 의 contextvar 는 스레드로
  전파되지 않아 섀도 호출이 안 세어지거나(다른 스레드) 서비스 `llm_calls`(BE 사용량 상한의 원천)에 섞인다
  (같은 스레드). 섀도 호출은 상한에서 제외하되 비용은 보여야 한다(사용자 결정 ④, BR-AO-07).
- `TaggedTrace` — TracePort 래퍼, 이벤트의 `component` 만 `c1.gateway.shadow` 로 바꿔 위임. `LlmCallRecord.component`
  가 `c1.gateway` 고정이라 트레이스 필터로는 섀도를 못 가른다(DEC-AO-4 ④). 타입 개정 없이 `dataclasses.replace`.
- `ShadowIntentProbe` — 분류 직후 `submit()` 으로 넘기면 **즉시 돌아오고**, 풀 스레드가
  `router.route(utterance, TraceId(f"{trace_id}:shadow"), now)` 를 재어 `intent_shadow {json}` 1줄을 남긴다.
  trace 접미 `:shadow` 는 `llm_cost` 가 trace_id 누계라 같은 id 면 요청 총액이 부풀기 때문이다(DEC-AO-4 ③).

**로그에 발화 원문·slots·account_ref 를 싣지 않는다**(SEC-U8-06, AO-P9) — `ShadowRecord`·`ShadowSide` 에 그 칸이
없고(생성 불가), 호출자가 주는 `meta` 도 그 키를 거절한다. 남는 것은 정규화 뒤 길이와 sha256 앞 12자.

섀도 실패는 응답에 영향 0(BR-AO-08 ⑥): `submit` 은 던지지 않고, 스레드 안의 예외는 `intent_shadow_error` 로만 남는다.
샘플 밖·포화는 `intent_shadow_skipped` 로 분모를 남긴다 — 세는 쪽이 분모를 알아야 한다(DE §2.7).
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import logging
import random
import threading
import time
from collections.abc import Callable, Mapping
from concurrent.futures import Executor, ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime

from trippilot.domain.common import TraceId
from trippilot.domain.intent import IntentMatch
from trippilot.orchestrator.intent_eval import is_refusal
from trippilot.orchestrator.intent_router import IntentRouter, normalize
from trippilot.ports.llm_port import LlmPort, LlmRequest, LlmResponse
from trippilot.ports.trace_port import TracePort

SHADOW_COMPONENT = "c1.gateway.shadow"
# 로그 1줄에 실리면 안 되는 키 — 타입에 칸이 없는 것과 같은 규칙을 `meta` 에도 건다(SEC-U8-06).
_FORBIDDEN_META_KEYS = frozenset({"utterance", "slots", "account_ref"})
# 기본 풀 — 프로세스에 하나(BLM §9.1 "풀 2"). 스레드는 첫 submit 때 생기므로 import 비용은 없다.
_SHARED_POOL = ThreadPoolExecutor(2, thread_name_prefix="intent-shadow")


class ShadowCountingLlm:
    """LlmPort 래퍼 — 이 인스턴스를 지난 호출을 전부 센다(실패한 호출도: 비용은 났다).

    프로브는 호출 전후의 `count` **차이**로 한 건의 호출 수를 읽고 `reset()` 은 부르지 않는다 — 공유
    인스턴스에 요청마다 0 을 쓰면 끼어든 요청의 계수를 지운다(anti-patterns §공유 어댑터 카운터).
    `reset()` 은 소유자(배선·측정 하네스)가 구간 누계를 끊을 때 쓴다.
    """

    def __init__(self, inner: LlmPort) -> None:
        self._inner = inner
        self._lock = threading.Lock()
        self._count = 0

    @property
    def count(self) -> int:
        with self._lock:
            return self._count

    def reset(self) -> None:
        with self._lock:
            self._count = 0

    def invoke(self, request: LlmRequest) -> LlmResponse:
        with self._lock:
            self._count += 1
        return self._inner.invoke(request)


class TaggedTrace:
    """TracePort 래퍼 — `LlmCallRecord`·`FallbackEvent`·`GateDropEvent` 의 `component` 를 바꿔 위임한다.

    `component` 칸이 있는 이벤트면 어느 타입이든 바꾼다(이 트레이스를 지나는 것은 전부 섀도의 것이다).
    칸이 없으면 그대로 넘긴다. emit 은 어떤 경우에도 던지지 않는다(TracePort 계약).
    """

    def __init__(self, inner: TracePort, component: str = SHADOW_COMPONENT) -> None:
        self._inner = inner
        self._component = component

    def emit(self, event) -> None:
        try:
            event = dataclasses.replace(event, component=self._component)
        except Exception:
            pass  # dataclass 가 아니거나 component 칸이 없다 — 원본 그대로 위임
        try:
            self._inner.emit(event)
        except Exception:
            pass  # 계측 실패 ≠ 비즈니스 실패


@dataclass(frozen=True, slots=True)
class ShadowSide:
    """한쪽(서비스 또는 섀도)의 판정 요약 — `slots` 칸이 없다(SEC-U8-06)."""

    intent: str  # Intent.value
    route: str  # MatchRoute.value — 서비스는 "LLM_DIRECT" 고정
    confidence: float
    reason: str | None  # 섀도만 의미 있다(escalated_from·bank_miss…). 서비스 측은 None (DE §2.7)
    llm_calls: int
    latency_ms: int
    refused: bool  # intent_eval.is_refusal — 거절 표지 없는 FALLBACK 은 인프라 실패로 읽는다

    @classmethod
    def from_match(cls, match: IntentMatch, *, llm_calls: int, latency_ms: int,
                   keep_reason: bool = True) -> "ShadowSide":
        return cls(
            intent=match.intent.value,
            route=match.match_route.value,
            confidence=match.confidence,
            reason=match.reason if keep_reason else None,
            llm_calls=llm_calls,
            latency_ms=latency_ms,
            refused=is_refusal(match),
        )

    def to_dict(self) -> dict:
        return {
            "intent": self.intent,
            "route": self.route,
            "confidence": self.confidence,
            "reason": self.reason,
            "llm_calls": self.llm_calls,
            "latency_ms": self.latency_ms,
            "refused": self.refused,
        }

    @classmethod
    def from_dict(cls, d: Mapping) -> "ShadowSide":
        return cls(
            intent=d["intent"], route=d["route"], confidence=d["confidence"], reason=d.get("reason"),
            llm_calls=d["llm_calls"], latency_ms=d["latency_ms"], refused=d["refused"],
        )


@dataclass(frozen=True, slots=True)
class ShadowRecord:
    """`intent_shadow` 로그 1줄 (DE §5 필드표). 원문·slots·account_ref 칸이 없다 — 구조로 금지를 보장한다."""

    trace_id: str  # 원 요청 trace_id — 섀도 LLM 호출은 f"{trace_id}:shadow" 로 나갔다
    turn_index: int
    service: ShadowSide
    shadow: ShadowSide
    utterance_chars: int  # normalize 뒤 길이
    utterance_sha12: str  # sha256(normalize(utterance))[:12]
    meta: Mapping[str, object]  # 측정 조건(bank_sha·임계 4종·프롬프트 2종) — 호출자가 채운다

    def __post_init__(self) -> None:
        leaked = _FORBIDDEN_META_KEYS & set(self.meta)
        if leaked:
            raise ValueError(f"meta 에 로그 금지 키: {sorted(leaked)} (SEC-U8-06)")

    @property
    def agree(self) -> bool:
        """서비스·섀도 의도 일치 — 파생값이라 필드로 두지 않는다(어긋날 수 없다)."""
        return self.service.intent == self.shadow.intent

    def to_dict(self) -> dict:
        return {
            "event": "intent_shadow",
            "trace_id": self.trace_id,
            "turn_index": self.turn_index,
            "service": self.service.to_dict(),
            "shadow": self.shadow.to_dict(),
            "agree": self.agree,
            "utterance_chars": self.utterance_chars,
            "utterance_sha12": self.utterance_sha12,
            "meta": dict(self.meta),
        }

    @classmethod
    def from_dict(cls, d: Mapping) -> "ShadowRecord":
        return cls(
            trace_id=d["trace_id"],
            turn_index=d["turn_index"],
            service=ShadowSide.from_dict(d["service"]),
            shadow=ShadowSide.from_dict(d["shadow"]),
            utterance_chars=d["utterance_chars"],
            utterance_sha12=d["utterance_sha12"],
            meta=dict(d.get("meta") or {}),
        )

    def to_json(self) -> str:
        """한 줄 — 키 순서는 `to_dict` 가 고정한다. `sed 's/.*intent_shadow //' | jq` 가 그대로 먹는 모양."""
        return json.dumps(self.to_dict(), ensure_ascii=False, separators=(",", ":"))


class ShadowIntentProbe:
    """분류 직후 `submit()` — 샘플링·in-flight 상한을 지나면 풀 스레드가 섀도 라우팅을 재고 로그 1줄을 남긴다."""

    def __init__(
        self,
        router: IntentRouter,
        *,
        rate: float,
        pool: Executor | None = None,
        max_inflight: int = 4,
        rng: random.Random | None = None,
        clock: Callable[[], float] = time.monotonic,
        logger: logging.Logger | None = None,
        counting: ShadowCountingLlm | None = None,
    ) -> None:
        if not 0.0 <= rate <= 1.0:
            raise ValueError(f"rate ∈ [0, 1]: {rate}")
        if max_inflight < 1:
            raise ValueError(f"max_inflight ≥ 1: {max_inflight}")
        self._router = router
        self._rate = rate
        self._pool = pool if pool is not None else _SHARED_POOL
        self._inflight = threading.BoundedSemaphore(max_inflight)
        self._rng = rng if rng is not None else random.SystemRandom()  # 주입이면 결정론(AO-P16)
        self._clock = clock
        self._log = logger if logger is not None else logging.getLogger("trippilot.intent.shadow")
        # None 이면 라우터가 LLM 을 부르지 않는 조립(뱅크만)이라는 뜻 — 섀도 llm_calls 는 0 으로 남는다
        self._counting = counting

    def submit(
        self,
        utterance: str,
        trace_id: TraceId,
        now: datetime,
        *,
        service: IntentMatch,
        service_ms: int,
        service_llm_calls: int,
        turn_index: int,
        meta: Mapping[str, object],
    ) -> bool:
        """스레드에 넘겼으면 True. 샘플 밖·포화·풀 거부는 False + 로그 1줄 — 어떤 경우에도 던지지 않는다."""
        if not (self._rng.random() < self._rate):
            self._skip(trace_id, "sampled_out")
            return False
        if not self._inflight.acquire(blocking=False):
            self._skip(trace_id, "saturated")
            return False
        try:
            self._pool.submit(
                self._run, utterance, trace_id, now, service, service_ms, service_llm_calls,
                turn_index, dict(meta),
            )
        except Exception as e:  # 풀이 닫혔다(shutdown) 등 — 자리를 돌려주고 응답 경로는 계속 간다
            self._inflight.release()
            self._error(trace_id, e)
            return False
        return True

    # ── 스레드 본체 ────────────────────────────────────────────────────

    def _run(
        self,
        utterance: str,
        trace_id: TraceId,
        now: datetime,
        service: IntentMatch,
        service_ms: int,
        service_llm_calls: int,
        turn_index: int,
        meta: dict,
    ) -> None:
        try:
            before = self._counting.count if self._counting is not None else 0
            started = self._clock()
            match = self._router.route(utterance, TraceId(f"{trace_id}:shadow"), now)
            latency_ms = int((self._clock() - started) * 1000)
            # ponytail: 공유 카운터의 차이라 풀 2 에서 섀도 둘이 겹치면 상대 호출이 섞여 **상한값**이 된다.
            # 정확한 건별 귀속이 필요하면 `llm_cost`/`trace_event` 의 trace 접미 `:shadow` 로 집계한다.
            calls = (self._counting.count - before) if self._counting is not None else 0
            text = normalize(utterance)
            record = ShadowRecord(
                trace_id=str(trace_id),
                turn_index=turn_index,
                service=ShadowSide.from_match(
                    service, llm_calls=service_llm_calls, latency_ms=service_ms, keep_reason=False),
                shadow=ShadowSide.from_match(match, llm_calls=calls, latency_ms=latency_ms),
                utterance_chars=len(text),
                utterance_sha12=hashlib.sha256(text.encode("utf-8")).hexdigest()[:12],
                meta=meta,
            )
            self._log.info("intent_shadow %s", record.to_json())
        except Exception as e:  # 섀도 실패는 응답에 영향 0 — 침묵하지는 않는다(INV-4)
            self._error(trace_id, e)
        finally:
            self._inflight.release()

    def _skip(self, trace_id: TraceId, why: str) -> None:
        self._log.info("intent_shadow_skipped %s", json.dumps(
            {"event": "intent_shadow_skipped", "trace_id": str(trace_id), "why": why}))

    def _error(self, trace_id: TraceId, e: Exception) -> None:
        self._log.warning("intent_shadow_error %s", json.dumps(
            {"event": "intent_shadow_error", "trace_id": str(trace_id), "error": f"{type(e).__name__}: {e}"},
            ensure_ascii=False))
