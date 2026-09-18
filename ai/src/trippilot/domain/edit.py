"""편집 도메인 타입 (U1 FD domain-entities §5, business-rules.md §6).

파괴적 편집 확인 필수: destructive op 또는 affected>1이면 CONFIRM_REQUIRED.
resolve_apply_mode는 domain 내 순수 함수 (테스트 가능·결정론).

`EditTranslation`은 EDIT_TRANSLATION 게이트 통과 후에만 만들어지는 **승격 타입** —
규격 소유는 u4 FD domain-entities §4 (검증 전 데이터는 도메인 타입이 되지 못한다).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from trippilot.domain.common import PoiId
from trippilot.domain.execution import AgentKind


class EditOp(Enum):
    ADD_SLOT = "ADD_SLOT"
    REMOVE_SLOT = "REMOVE_SLOT"
    MOVE_SLOT = "MOVE_SLOT"
    REPLACE_SLOT = "REPLACE_SLOT"
    REORDER_DAY = "REORDER_DAY"
    CLEAR_DAY = "CLEAR_DAY"
    REPLAN = "REPLAN"


# 파괴적 편집 = 확인 필수 대상 (business-rules.md §6)
DESTRUCTIVE_OPS = frozenset(
    {EditOp.REMOVE_SLOT, EditOp.CLEAR_DAY, EditOp.REORDER_DAY, EditOp.REPLAN}
)


class ApplyMode(Enum):
    AUTO_APPLY = "AUTO_APPLY"
    CONFIRM_REQUIRED = "CONFIRM_REQUIRED"


@dataclass(frozen=True, slots=True)
class EditCommand:
    op: EditOp
    params: dict
    affected_slots: tuple[PoiId, ...]

    def to_dict(self) -> dict:
        return {
            "op": self.op.value,
            "params": self.params,
            "affected_slots": [str(x) for x in self.affected_slots],
        }

    @classmethod
    def from_dict(cls, d: dict) -> "EditCommand":
        return cls(
            op=EditOp(d["op"]),
            params=d["params"],
            affected_slots=tuple(PoiId(x) for x in d["affected_slots"]),
        )


def resolve_apply_mode(cmd: EditCommand) -> ApplyMode:
    """파괴적이거나 대규모(affected>1)면 확인 필수 (business-rules.md §6)."""
    if cmd.op in DESTRUCTIVE_OPS or len(cmd.affected_slots) > 1:
        return ApplyMode.CONFIRM_REQUIRED
    return ApplyMode.AUTO_APPLY


@dataclass(frozen=True, slots=True)
class EditTranslation:
    """번역 결과 = 명령 초안 + **코드가 확정한** 반영 모드 (u4 FD domain-entities §4).

    LLM이 제안한 applyMode는 여기 도달하지 못한다 (게이트가 버리고 재계산).
    어셈블리 검증·실제 반영은 EditAgent(U5) 몫 — 이 타입은 초안까지다 (INV-2).
    """

    command: EditCommand
    apply_mode: ApplyMode

    def to_dict(self) -> dict:
        return {"command": self.command.to_dict(), "applyMode": self.apply_mode.value}

    @classmethod
    def from_dict(cls, d: dict) -> "EditTranslation":
        return cls(
            command=EditCommand.from_dict(d["command"]),
            apply_mode=ApplyMode(d["applyMode"]),
        )


@dataclass(frozen=True, slots=True)
class Dispatch:
    intent: str
    slots: dict
    agent: AgentKind
    apply_mode: ApplyMode

    @classmethod
    def default_fallback(cls) -> "Dispatch":
        """라우터 실패 시 — 안전 기본값(확인 필수, 즉시 처리 경로)."""
        return cls(
            intent="fallback",
            slots={},
            agent=AgentKind.ORCHESTRATOR_FAST,
            apply_mode=ApplyMode.CONFIRM_REQUIRED,
        )

    def to_dict(self) -> dict:
        return {
            "intent": self.intent,
            "slots": self.slots,
            "agent": self.agent.value,
            "apply_mode": self.apply_mode.value,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Dispatch":
        return cls(
            intent=d["intent"],
            slots=d["slots"],
            agent=AgentKind(d["agent"]),
            apply_mode=ApplyMode(d["apply_mode"]),
        )
