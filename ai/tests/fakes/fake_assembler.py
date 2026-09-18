"""테스트용 fake 어셈블리 — AssemblyPort 체인(None→다음 전략) 시연용.

실 하이브리드 체인(OR-Tools→LLM(Anthropic)→규칙 폴백)은 U2 소유.
여기서는 U1의 AssemblyPort 계약이 조립 가능한지만 증명한다.
"""

from __future__ import annotations

from trippilot.domain.itinerary import ItineraryProblem, ItinerarySolution


class FixedAssembler:
    """항상 정해진 해를 반환 (성공 전략 흉내)."""

    def __init__(self, solution: ItinerarySolution) -> None:
        self._solution = solution

    def solve(self, problem: ItineraryProblem) -> ItinerarySolution | None:
        return self._solution


class NoSolutionAssembler:
    """항상 None 반환 (해 없음 → 체인의 다음 전략으로)."""

    def solve(self, problem: ItineraryProblem) -> ItinerarySolution | None:
        return None
