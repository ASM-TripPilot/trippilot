"""[LLMOps] 관측 이벤트 타입 (domain-entities.md §8, NFR-7.1).

"침묵 실패 금지(INV-4)"의 계측 버전. 아래 이벤트로 파생 지표를 정의한다
(business-rules.md §3):
  환각률 = ΣGateDropEvent.dropped / total
  폴백률 = FallbackEvent 빈도 / 요청 수
  LLM 비용 = Σ(tokens × 단가)   ← 단가는 소비 측, 도메인엔 안 둠
  솔버 통과율 = SolverRunRecord.violations_found=0 비율

공통 필드: trace_id · occurred_at(tz-aware) · component
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.execution import AgentKind
from trippilot.domain.itinerary import SolveMode
from trippilot.domain.prompt import PromptRef
from trippilot.domain.serialization import from_iso, to_iso


@dataclass(frozen=True, slots=True)
class LlmCallRecord:
    """모든 LLM 호출 완료·실패·타임아웃 시 발행 (의무: U4 GatewayFacade)."""

    trace_id: TraceId
    occurred_at: datetime
    component: str
    feature: str
    model_id: str
    prompt_ref: PromptRef
    input_tokens: int
    output_tokens: int
    latency_ms: int
    success: bool
    agent: AgentKind | None

    def to_dict(self) -> dict:
        return {
            "trace_id": str(self.trace_id),
            "occurred_at": to_iso(self.occurred_at),
            "component": self.component,
            "feature": self.feature,
            "model_id": self.model_id,
            "prompt_ref": self.prompt_ref.to_dict(),
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "latency_ms": self.latency_ms,
            "success": self.success,
            "agent": self.agent.value if self.agent is not None else None,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "LlmCallRecord":
        return cls(
            trace_id=TraceId(d["trace_id"]),
            occurred_at=from_iso(d["occurred_at"]),
            component=d["component"],
            feature=d["feature"],
            model_id=d["model_id"],
            prompt_ref=PromptRef.from_dict(d["prompt_ref"]),
            input_tokens=d["input_tokens"],
            output_tokens=d["output_tokens"],
            latency_ms=d["latency_ms"],
            success=d["success"],
            agent=AgentKind(d["agent"]) if d["agent"] is not None else None,
        )


@dataclass(frozen=True, slots=True)
class FallbackEvent:
    """폴백 전환 시 발행 (INV-4 침묵 실패 금지 증빙)."""

    trace_id: TraceId
    occurred_at: datetime
    component: str
    stage: str  # llm / solver / router / agent
    from_mode: str
    to_mode: str
    reason: str

    def to_dict(self) -> dict:
        return {
            "trace_id": str(self.trace_id),
            "occurred_at": to_iso(self.occurred_at),
            "component": self.component,
            "stage": self.stage,
            "from_mode": self.from_mode,
            "to_mode": self.to_mode,
            "reason": self.reason,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "FallbackEvent":
        return cls(
            trace_id=TraceId(d["trace_id"]),
            occurred_at=from_iso(d["occurred_at"]),
            component=d["component"],
            stage=d["stage"],
            from_mode=d["from_mode"],
            to_mode=d["to_mode"],
            reason=d["reason"],
        )


@dataclass(frozen=True, slots=True)
class GateDropEvent:
    """게이트에서 poi_id 드롭 시 발행 (INV-1 환각률 지표화, 의무: U4 ClosedSetGate)."""

    trace_id: TraceId
    occurred_at: datetime
    component: str
    feature: str
    dropped_ids: tuple[PoiId, ...]
    total_count: int
    dropped_count: int

    def to_dict(self) -> dict:
        return {
            "trace_id": str(self.trace_id),
            "occurred_at": to_iso(self.occurred_at),
            "component": self.component,
            "feature": self.feature,
            "dropped_ids": [str(x) for x in self.dropped_ids],
            "total_count": self.total_count,
            "dropped_count": self.dropped_count,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "GateDropEvent":
        return cls(
            trace_id=TraceId(d["trace_id"]),
            occurred_at=from_iso(d["occurred_at"]),
            component=d["component"],
            feature=d["feature"],
            dropped_ids=tuple(PoiId(x) for x in d["dropped_ids"]),
            total_count=d["total_count"],
            dropped_count=d["dropped_count"],
        )


@dataclass(frozen=True, slots=True)
class ScoreChunkEvent:
    """PREFERENCE_SCORING 병렬 청킹 요약 (TRIP-378, 의무: U4 PreferenceScoringWorker).

    청크 수·성공/실패 수를 침묵 없이 남긴다(INV-4) — 부분 실패(성공 청크만 병합)가
    지표에서 보이게 한다. 청크별 개별 호출은 게이트웨이가 LlmCallRecord·FallbackEvent로
    이미 계측하므로, 이 이벤트는 병합 관점의 요약 1건이다.

    실패 사유 구분 (TRIP-380): `failure_count`는 마감 안에 **완료됐지만** 폴백으로
    끝난 청크, `timed_out_count`는 단계 마감까지 완료되지 못해 결과가 폐기된 청크.
    success + failure + timed_out = chunk_count.
    """

    trace_id: TraceId
    occurred_at: datetime
    component: str
    feature: str
    pool_size: int
    chunk_count: int
    success_count: int
    failure_count: int
    timed_out_count: int

    def to_dict(self) -> dict:
        return {
            "trace_id": str(self.trace_id),
            "occurred_at": to_iso(self.occurred_at),
            "component": self.component,
            "feature": self.feature,
            "pool_size": self.pool_size,
            "chunk_count": self.chunk_count,
            "success_count": self.success_count,
            "failure_count": self.failure_count,
            "timed_out_count": self.timed_out_count,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ScoreChunkEvent":
        return cls(
            trace_id=TraceId(d["trace_id"]),
            occurred_at=from_iso(d["occurred_at"]),
            component=d["component"],
            feature=d["feature"],
            pool_size=d["pool_size"],
            chunk_count=d["chunk_count"],
            success_count=d["success_count"],
            failure_count=d["failure_count"],
            timed_out_count=d["timed_out_count"],
        )


@dataclass(frozen=True, slots=True)
class SolverRunRecord:
    """솔버 실행 완료 시 발행 (의무: U2 SolverFacade). 5초 게이트·통과율 계측."""

    trace_id: TraceId
    occurred_at: datetime
    component: str
    solve_mode: SolveMode
    elapsed_ms: int
    violations_found: int
    repaired: bool

    def to_dict(self) -> dict:
        return {
            "trace_id": str(self.trace_id),
            "occurred_at": to_iso(self.occurred_at),
            "component": self.component,
            "solve_mode": self.solve_mode.value,
            "elapsed_ms": self.elapsed_ms,
            "violations_found": self.violations_found,
            "repaired": self.repaired,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "SolverRunRecord":
        return cls(
            trace_id=TraceId(d["trace_id"]),
            occurred_at=from_iso(d["occurred_at"]),
            component=d["component"],
            solve_mode=SolveMode(d["solve_mode"]),
            elapsed_ms=d["elapsed_ms"],
            violations_found=d["violations_found"],
            repaired=d["repaired"],
        )


# TracePort.emit()의 인자 타입 (domain-entities.md §8)
TraceEvent = (
    LlmCallRecord | FallbackEvent | GateDropEvent | ScoreChunkEvent | SolverRunRecord
)
