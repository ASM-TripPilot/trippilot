"""InMemoryTrace — TracePort의 누적 fake (business-logic-model.md §3).

events 리스트에 발행 이벤트를 쌓는다. 테스트에서
"폴백 시 FallbackEvent가 발행됐는가"를 단언하는 용도 (NFR-7 검증 핵심).
emit은 절대 예외를 밖으로 던지지 않는다 (§2.7).
"""

from __future__ import annotations

from trippilot.domain.observability import TraceEvent


class InMemoryTrace:
    def __init__(self) -> None:
        self.events: list[TraceEvent] = []

    def emit(self, event: TraceEvent) -> None:
        try:
            self.events.append(event)
        except Exception:
            pass  # 계측 실패 ≠ 비즈니스 실패

    def of_type(self, cls: type) -> list[TraceEvent]:
        return [e for e in self.events if isinstance(e, cls)]
