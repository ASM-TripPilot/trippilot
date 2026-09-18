"""에이전트 실행 타입 (domain-entities.md §7, agent-redesign.md 반영).

step 내 agents는 병렬, step 간은 순차.
trace_id로 전 에이전트 관측 이벤트를 연결.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from trippilot.domain.common import TraceId


class AgentKind(Enum):
    SCHEDULE = "SCHEDULE"
    PLANB = "PLANB"
    REFLECT = "REFLECT"
    EDIT = "EDIT"
    ORCHESTRATOR_FAST = "ORCHESTRATOR_FAST"


@dataclass(frozen=True, slots=True)
class AgentCall:
    agent: AgentKind
    task: str
    params: dict

    def to_dict(self) -> dict:
        return {"agent": self.agent.value, "task": self.task, "params": self.params}

    @classmethod
    def from_dict(cls, d: dict) -> "AgentCall":
        return cls(agent=AgentKind(d["agent"]), task=d["task"], params=d["params"])


@dataclass(frozen=True, slots=True)
class ExecutionStep:
    agents: tuple[AgentCall, ...]  # 이 step 안에서 병렬 실행
    timeout_sec: float

    def to_dict(self) -> dict:
        return {
            "agents": [a.to_dict() for a in self.agents],
            "timeout_sec": self.timeout_sec,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ExecutionStep":
        return cls(
            agents=tuple(AgentCall.from_dict(a) for a in d["agents"]),
            timeout_sec=d["timeout_sec"],
        )


@dataclass(frozen=True, slots=True)
class ExecutionPlan:
    steps: tuple[ExecutionStep, ...]  # step 간 순차
    trace_id: TraceId

    def to_dict(self) -> dict:
        return {
            "steps": [s.to_dict() for s in self.steps],
            "trace_id": str(self.trace_id),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ExecutionPlan":
        return cls(
            steps=tuple(ExecutionStep.from_dict(s) for s in d["steps"]),
            trace_id=TraceId(d["trace_id"]),
        )
