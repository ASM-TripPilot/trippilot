"""[LLMOps] TracePort — 관측 이벤트 발행 콘센트 (business-logic-model.md §2.7).

emit은 절대 예외를 밖으로 던지지 않는다 — 계측 실패가 비즈니스 로직을 막으면 안 됨.
실 구현(U5): 구조화 로그 → CloudWatch/OTel. 테스트: InMemoryTrace.
"""

from __future__ import annotations

from typing import Protocol

from trippilot.domain.observability import TraceEvent


class TracePort(Protocol):
    def emit(self, event: TraceEvent) -> None: ...
