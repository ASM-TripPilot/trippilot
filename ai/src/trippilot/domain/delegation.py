"""위임 봉투 타입 (agent-foundation FD domain-entities §2, S1.5).

DL-1~5의 타입 강제 지점:
- DL-1: 모든 위임 = AgentTask, 모든 회신 = AgentResult (BR-AF-01)
- DL-2: 대형 데이터는 context_refs·InfoBundle.pool_ref 참조만 (BR-AF-13)
- DL-3: utterance는 뉘앙스 참고 전용 — 타입 강제 불가, BR-AF-02 + 테스트 규칙으로 커버
- DL-4: 자식 봉투는 spawn만이 생성 경로 — deadline 차감, 잔여 ≤ 0이면
  DeadlineExhaustedError (자식이 부모보다 오래 사는 봉투는 생성 자체가 불가능)
- DL-5(INV-4): Agent 경계에서 예외 금지 — 성공/폴백/실패 전부 AgentResult
  상태값으로 수렴, 불변식은 post-init이 강제 (BR-AF-04)
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from trippilot.domain.freshness import FreshnessMeta, InfoBundle


class TaskPriority(Enum):
    INTERACTIVE = "INTERACTIVE"
    BACKGROUND = "BACKGROUND"


class TaskIssuer(Enum):
    ORCHESTRATOR = "ORCHESTRATOR"
    SCHEDULE_AGENT = "SCHEDULE_AGENT"
    PLANB_AGENT = "PLANB_AGENT"
    REFLECT_AGENT = "REFLECT_AGENT"
    EDIT_AGENT = "EDIT_AGENT"
    BACKGROUND_TRIGGER = "BACKGROUND_TRIGGER"  # 자율 트리거형 — 라우팅 밖 (BR-AF-11)


class AgentStatus(Enum):
    SUCCESS = "SUCCESS"
    FALLBACK = "FALLBACK"
    PARTIAL = "PARTIAL"
    FAILED = "FAILED"
    TIMEOUT = "TIMEOUT"
    NEED_MORE_INFO = "NEED_MORE_INFO"


_ERROR_REQUIRED = frozenset({AgentStatus.FAILED, AgentStatus.TIMEOUT})


class DeadlineExhaustedError(Exception):
    """spawn 시 잔여 deadline ≤ 0 — 자식 봉투 발행 자체 불가 (DL-4, BR-AF-03)."""


@dataclass(frozen=True, slots=True)
class ContextRef:
    """데이터가 아니라 참조 (DL-2, D31). kind 목록 정본 = delegation-design §2."""

    kind: str  # trip | itinerary | … | poi
    ref_id: str

    def to_dict(self) -> dict:
        return {"kind": self.kind, "ref_id": self.ref_id}

    @classmethod
    def from_dict(cls, d: dict) -> "ContextRef":
        return cls(kind=d["kind"], ref_id=d["ref_id"])


@dataclass(frozen=True, slots=True)
class Requester:
    user_id: str
    locale: str

    def to_dict(self) -> dict:
        return {"user_id": self.user_id, "locale": self.locale}

    @classmethod
    def from_dict(cls, d: dict) -> "Requester":
        return cls(user_id=d["user_id"], locale=d["locale"])


@dataclass(frozen=True, slots=True)
class TaskConstraints:
    max_llm_calls: int
    allow_web_sourcing: bool
    apply_mode_ceiling: str | None

    def to_dict(self) -> dict:
        return {
            "max_llm_calls": self.max_llm_calls,
            "allow_web_sourcing": self.allow_web_sourcing,
            "apply_mode_ceiling": self.apply_mode_ceiling,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "TaskConstraints":
        return cls(
            max_llm_calls=d["max_llm_calls"],
            allow_web_sourcing=d["allow_web_sourcing"],
            apply_mode_ceiling=d["apply_mode_ceiling"],
        )


@dataclass(frozen=True, slots=True)
class TaskError:
    code: str
    message: str
    retryable: bool

    def to_dict(self) -> dict:
        return {"code": self.code, "message": self.message, "retryable": self.retryable}

    @classmethod
    def from_dict(cls, d: dict) -> "TaskError":
        return cls(code=d["code"], message=d["message"], retryable=d["retryable"])


@dataclass(frozen=True, slots=True)
class TaskMetrics:
    elapsed_ms: int
    llm_calls: int
    tokens_in: int
    tokens_out: int
    tools_used: tuple[str, ...]

    def to_dict(self) -> dict:
        return {
            "elapsed_ms": self.elapsed_ms,
            "llm_calls": self.llm_calls,
            "tokens_in": self.tokens_in,
            "tokens_out": self.tokens_out,
            "tools_used": list(self.tools_used),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "TaskMetrics":
        return cls(
            elapsed_ms=d["elapsed_ms"],
            llm_calls=d["llm_calls"],
            tokens_in=d["tokens_in"],
            tokens_out=d["tokens_out"],
            tools_used=tuple(d["tools_used"]),
        )


@dataclass(frozen=True, slots=True)
class AgentTask:
    """위임 봉투 (DL-1). dict 필드는 JSON 원시 타입만 (BR-AF-12)."""

    task_id: str
    trace_id: str
    parent_task_id: str | None
    issued_by: TaskIssuer
    intent: str  # 라우팅 테이블 closed-set 라벨 (라벨 정본 = delegation-design §5)
    slots: dict
    utterance: str | None  # 뉘앙스 참고 전용 — 재해석 금지 (DL-3, BR-AF-02)
    context_refs: tuple[ContextRef, ...]  # 데이터가 아니라 참조 (DL-2, D31)
    requester: Requester
    inline_context: dict  # 휘발 데이터만 (현재 위치·클라 시각)
    info: InfoBundle | None  # Orchestrator 수집분 동봉 (v2 보강)
    deadline_ms: int  # > 0 강제
    priority: TaskPriority
    constraints: TaskConstraints
    idempotency_key: str

    def __post_init__(self) -> None:
        if not self.task_id:
            raise ValueError("task_id 비어있음 금지")
        if not self.trace_id:
            raise ValueError("trace_id 비어있음 금지")
        if self.deadline_ms <= 0:
            raise ValueError(f"deadline_ms > 0 강제: {self.deadline_ms}")

    def spawn(
        self,
        elapsed_ms: int,
        *,
        task_id: str,
        issued_by: TaskIssuer,
        intent: str,
        slots: dict,
        utterance: str | None = None,
        context_refs: tuple[ContextRef, ...] = (),
        inline_context: dict | None = None,
        info: InfoBundle | None = None,
        idempotency_key: str | None = None,
    ) -> "AgentTask":
        """자식 봉투의 유일한 생성 경로 (DL-4, BR-AF-03).

        trace_id 상속(불변) · parent_task_id=self.task_id ·
        deadline_ms = 부모 − 경과분 (잔여 ≤ 0이면 DeadlineExhaustedError).
        requester·priority·constraints는 부모 상속 — 재위임이 권한·상한을
        늘리는 경로를 봉쇄한다.
        """
        if elapsed_ms < 0:
            raise ValueError(f"elapsed_ms 음수: {elapsed_ms}")
        remaining = self.deadline_ms - elapsed_ms
        if remaining <= 0:
            raise DeadlineExhaustedError(
                f"잔여 deadline 소진: {self.deadline_ms} - {elapsed_ms} = {remaining}"
            )
        return AgentTask(
            task_id=task_id,
            trace_id=self.trace_id,
            parent_task_id=self.task_id,
            issued_by=issued_by,
            intent=intent,
            slots=slots,
            utterance=utterance,
            context_refs=context_refs,
            requester=self.requester,
            inline_context=inline_context if inline_context is not None else {},
            info=info,
            deadline_ms=remaining,
            priority=self.priority,
            constraints=self.constraints,
            idempotency_key=idempotency_key if idempotency_key is not None else task_id,
        )

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "trace_id": self.trace_id,
            "parent_task_id": self.parent_task_id,
            "issued_by": self.issued_by.value,
            "intent": self.intent,
            "slots": self.slots,
            "utterance": self.utterance,
            "context_refs": [c.to_dict() for c in self.context_refs],
            "requester": self.requester.to_dict(),
            "inline_context": self.inline_context,
            "info": self.info.to_dict() if self.info else None,
            "deadline_ms": self.deadline_ms,
            "priority": self.priority.value,
            "constraints": self.constraints.to_dict(),
            "idempotency_key": self.idempotency_key,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "AgentTask":
        return cls(
            task_id=d["task_id"],
            trace_id=d["trace_id"],
            parent_task_id=d["parent_task_id"],
            issued_by=TaskIssuer(d["issued_by"]),
            intent=d["intent"],
            slots=d["slots"],
            utterance=d["utterance"],
            context_refs=tuple(ContextRef.from_dict(c) for c in d["context_refs"]),
            requester=Requester.from_dict(d["requester"]),
            inline_context=d["inline_context"],
            info=InfoBundle.from_dict(d["info"]) if d["info"] is not None else None,
            deadline_ms=d["deadline_ms"],
            priority=TaskPriority(d["priority"]),
            constraints=TaskConstraints.from_dict(d["constraints"]),
            idempotency_key=d["idempotency_key"],
        )


@dataclass(frozen=True, slots=True)
class AgentResult:
    """회신 봉투 (DL-5 — 예외가 아니라 상태값). 불변식 표 = domain-entities §2."""

    task_id: str
    trace_id: str
    status: AgentStatus
    payload: dict | None
    fallback_level: int  # 0=정상, 1..n=폴백 계단
    freshness: FreshnessMeta | None
    error: TaskError | None
    metrics: TaskMetrics

    def __post_init__(self) -> None:
        if not self.task_id:
            raise ValueError("task_id 비어있음 금지")
        if not self.trace_id:
            raise ValueError("trace_id 비어있음 금지")
        if self.fallback_level < 0:
            raise ValueError(f"fallback_level 음수: {self.fallback_level}")
        if self.status in _ERROR_REQUIRED:
            if self.error is None:
                raise ValueError(f"status={self.status.value}는 error 필수")
        elif self.error is not None:
            raise ValueError(f"status={self.status.value}는 error = None")
        if self.status is AgentStatus.SUCCESS:
            if self.payload is None:
                raise ValueError("SUCCESS는 payload 필수")
            if self.fallback_level != 0:
                raise ValueError(
                    f"SUCCESS는 fallback_level = 0: {self.fallback_level}"
                )
        if self.status is AgentStatus.FALLBACK and self.fallback_level < 1:
            raise ValueError("FALLBACK은 fallback_level ≥ 1")
        if self.status is AgentStatus.NEED_MORE_INFO:
            if self.payload is None:
                raise ValueError("NEED_MORE_INFO는 payload 필수")
            missing = self.payload.get("missing")
            if not isinstance(missing, list) or not missing:
                raise ValueError(
                    "NEED_MORE_INFO payload.missing은 비어있지 않은 목록 필수"
                )
            if "reason" not in self.payload:
                raise ValueError("NEED_MORE_INFO payload.reason 필수")

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "trace_id": self.trace_id,
            "status": self.status.value,
            "payload": self.payload,
            "fallback_level": self.fallback_level,
            "freshness": self.freshness.to_dict() if self.freshness else None,
            "error": self.error.to_dict() if self.error else None,
            "metrics": self.metrics.to_dict(),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "AgentResult":
        return cls(
            task_id=d["task_id"],
            trace_id=d["trace_id"],
            status=AgentStatus(d["status"]),
            payload=d["payload"],
            fallback_level=d["fallback_level"],
            freshness=(
                FreshnessMeta.from_dict(d["freshness"])
                if d["freshness"] is not None
                else None
            ),
            error=TaskError.from_dict(d["error"]) if d["error"] is not None else None,
            metrics=TaskMetrics.from_dict(d["metrics"]),
        )
