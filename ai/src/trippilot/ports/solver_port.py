"""SolverPort — 하이브리드 체인용 콘센트 (business-logic-model.md §2.6).

None = 이 전략으로 해 없음 → 체인의 다음 전략
(OR-Tools → LLM(Anthropic) → 규칙 폴백, 체인 로직은 U2 소유).
"""

from __future__ import annotations

from typing import Protocol

from trippilot.domain.itinerary import ItineraryProblem, ItinerarySolution


class SolverPort(Protocol):
    def solve(self, problem: ItineraryProblem) -> ItinerarySolution | None: ...
