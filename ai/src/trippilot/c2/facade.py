"""HybridSolverFacade — 시한 인지 하이브리드 체인 (AI-D07, U2 FD §2.1).

체인은 하나, 경로별로 다른 것은 deadline뿐:
  각 단계는 진입 전 잔여 시간을 확인(DL-2) → 부족하면 스킵+FallbackEvent(DL-5)
  → 유효(HC 통과) 해가 나오면 즉시 반환 → 최후의 RuleFallback(required_ms=0)이
  항상 해를 반환하므로 solve()가 빈손으로 끝나는 경로는 없다(INV-4).

시간 계산은 ClockPort.monotonic_ms()로만 한다 (DL-3, G116 결정론).
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from typing import Mapping, Protocol, Sequence

from trippilot.c2.constraints import check_all
from trippilot.c2.quality import compute_quality
from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.itinerary import (
    FixedBlock,
    ItineraryProblem,
    ItinerarySolution,
    TimeWindow,
    Violation,
    VisitSlot,
)
from trippilot.domain.observability import FallbackEvent, SolverRunRecord
from trippilot.domain.poi import Poi


class ChainStage(Protocol):
    """체인 단계 계약: 이름 + 진입 요구 시간 + solve."""

    name: str
    required_ms: int

    def solve(self, problem: ItineraryProblem,
              remaining_ms: int) -> ItinerarySolution | None: ...


class SolverConflictError(Exception):
    """모든 단계가 유효 해를 못 냈을 때 (예: 모순된 고정 블록).

    d08(필수 방문지 충돌) 흐름으로 위임될 예외 — U5에서 API 에러로 매핑.
    """


class HybridSolverFacade:
    def __init__(self, stages: Sequence[ChainStage],
                 poi_index: Mapping[PoiId, Poi],
                 estimator, clock, trace) -> None:
        self._stages = list(stages)
        self._pois = poi_index
        self._est = estimator
        self._clock = clock
        self._trace = trace

    # ── 검증 단일 진입점 (정본 §1.2 validate) ──
    def validate(self, solution: ItinerarySolution,
                 problem: ItineraryProblem) -> list[Violation]:
        return check_all(solution, problem, self._pois, self._est)

    # ── 시한 인지 체인 ──
    def solve(self, problem: ItineraryProblem, deadline_ms: int,
              trace_id: TraceId | None = None) -> ItinerarySolution:
        t0 = self._clock.monotonic_ms()

        def remaining() -> int:
            return deadline_ms - (self._clock.monotonic_ms() - t0)

        tid = trace_id if trace_id is not None else TraceId("solver")
        for idx, stage in enumerate(self._stages):
            next_name = (self._stages[idx + 1].name
                         if idx + 1 < len(self._stages) else "(end)")
            if remaining() < stage.required_ms:  # DL-2: 진입 전 잔여 확인
                self._emit_fallback(tid, stage.name, next_name, "deadline")
                continue
            result = stage.solve(problem, remaining())
            if result is None:  # 해 없음 → 다음 단계 (기존 체인 의미)
                self._emit_fallback(tid, stage.name, next_name, "no_solution")
                continue
            violations = self.validate(result, problem)
            if violations:  # 유효하지 않은 해는 반환 금지 (INV-2)
                self._emit_fallback(tid, stage.name, next_name,
                                    f"invalid:{len(violations)}")
                continue
            self._trace.emit(SolverRunRecord(
                trace_id=tid,
                occurred_at=datetime.now(timezone.utc),
                component="c2_facade",
                solve_mode=result.solve_mode,
                elapsed_ms=deadline_ms - remaining(),
                violations_found=0,
                repaired=False,
            ))
            # 유일 수렴 반환점 — 모든 경로(OR-Tools·LLM·규칙 폴백)에 품질 점수 부착
            # (§3.7, TRIP-261). regenerate()도 solve() 경유라 함께 커버된다.
            return replace(
                result,
                score=compute_quality(result, problem, self._pois, self._est),
            )
        # RuleFallback이 체인에 있으면 도달 불가. 도달 = 유효 해 자체가 없음(모순 입력)
        raise SolverConflictError("모든 단계 실패 — 고정 블록 모순 등 입력 확인 필요")

    # ── warm-start 재생성 (U5-P2 멱등, 정본 §4.3) ──
    def regenerate(self, problem: ItineraryProblem,
                   locked_slots: Sequence[VisitSlot], deadline_ms: int,
                   trace_id: TraceId | None = None) -> ItinerarySolution:
        """고정 슬롯(locked)의 시각을 불변 보존하고 나머지만 재배치.

        locked를 FixedBlock으로 승격해 HC3의 보호를 받게 한다 —
        validate가 보존을 강제하므로 위반 해는 반환 자체가 불가능(INV-2).
        """
        promoted = tuple(
            FixedBlock(poi_id=s.poi_id,
                       window=TimeWindow(start=s.start_at, end=s.end_at),
                       reason="locked")
            for s in locked_slots
        )
        augmented = ItineraryProblem(
            schedule_id=problem.schedule_id,
            days=problem.days,
            candidates=problem.candidates,
            fixed_blocks=problem.fixed_blocks + promoted,
            budget=problem.budget,
            transport=problem.transport,
            day_window=problem.day_window,
            seed=problem.seed,  # 시드 동일 → 재실행 멱등 (U5-P2)
            anchor=problem.anchor,
        )
        return self.solve(augmented, deadline_ms, trace_id)

    def _emit_fallback(self, tid: TraceId, from_: str, to: str, reason: str) -> None:
        self._trace.emit(FallbackEvent(  # DL-5: 침묵 스킵 금지
            trace_id=tid,
            occurred_at=datetime.now(timezone.utc),
            component="c2_facade",
            stage="solver",
            from_mode=from_,
            to_mode=to,
            reason=reason,
        ))
