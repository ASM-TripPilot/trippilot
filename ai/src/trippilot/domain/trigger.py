"""Plan-B 트리거 도메인 타입 (domain-entities.md §4)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum

from trippilot.domain.common import ScheduleId


class TriggerKind(Enum):
    WEATHER = "WEATHER"
    CLOSURE = "CLOSURE"
    DELAY = "DELAY"
    MANUAL = "MANUAL"


class ReplanScope(Enum):
    FULL_DAY = "FULL_DAY"
    PARTIAL_SLOTS = "PARTIAL_SLOTS"
    NONE = "NONE"


@dataclass(frozen=True, slots=True)
class TriggerParams:
    kind: TriggerKind
    schedule_id: ScheduleId
    affected_date: date
    payload: dict  # 직렬화 가능 원시값만

    def to_dict(self) -> dict:
        return {
            "kind": self.kind.value,
            "schedule_id": str(self.schedule_id),
            "affected_date": self.affected_date.isoformat(),
            "payload": self.payload,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "TriggerParams":
        return cls(
            kind=TriggerKind(d["kind"]),
            schedule_id=ScheduleId(d["schedule_id"]),
            affected_date=date.fromisoformat(d["affected_date"]),
            payload=d["payload"],
        )


@dataclass(frozen=True, slots=True)
class TriggerEvalResult:
    should_replan: bool
    scope: ReplanScope
    reason: str

    def to_dict(self) -> dict:
        return {
            "should_replan": self.should_replan,
            "scope": self.scope.value,
            "reason": self.reason,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "TriggerEvalResult":
        return cls(
            should_replan=d["should_replan"],
            scope=ReplanScope(d["scope"]),
            reason=d["reason"],
        )
