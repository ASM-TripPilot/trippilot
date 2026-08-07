"""Agent Protocol (business-logic-model §1) — 구현 없음, 계약만.

모든 위임은 AgentTask, 모든 회신은 AgentResult (DL-1, BR-AF-01).
handle은 예외를 밖으로 던지지 않는다 — 성공/폴백/실패 전부
AgentResult 상태값으로 수렴 (DL-5, BR-AF-04, INV-4).
"""

from __future__ import annotations

from typing import Protocol

from trippilot.domain.delegation import AgentResult, AgentTask


class Agent(Protocol):
    def handle(self, task: AgentTask) -> AgentResult: ...
