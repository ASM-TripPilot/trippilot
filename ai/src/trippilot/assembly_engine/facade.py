"""HybridAssemblyFacade — 시한 인지 하이브리드 체인 (AI-D07, U2 FD §2.1).

체인은 하나, 경로별로 다른 것은 deadline뿐:
  각 단계는 진입 전 잔여 시간을 확인(DL-2) → 부족하면 스킵+FallbackEvent(DL-5)
  → 유효(HC 통과) 해가 나오면 즉시 반환 → 최후의 RuleFallback(required_ms=0)이
  항상 해를 반환하므로 solve()가 빈손으로 끝나는 경로는 없다(INV-4).

시한이 이미 소진(잔여 ≤ 0)돼도 required_ms=0 단계는 반드시 실행한다 —
잔여를 음수 그대로 비교하면 최후 보루까지 스킵돼 INV-4가 깨지기 때문(TRIP-291).
스킵 판정은 max(0, 잔여) 기준이라 required_ms > 0인 상위 단계는 여전히 스킵된다.

시간 계산은 ClockPort.monotonic_ms()로만 한다 (DL-3, G116 결정론).

공개 경계(TRIP-292): solve · regenerate · validate · repair 4종이 U5/백엔드가 쓰는
전부다. 넷 다 deadline_ms를 받고, 시한 관련 판단은 반드시 관측을 남긴다(DL-5, INV-4).
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from typing import Mapping, Protocol, Sequence

from trippilot.assembly_engine.constraints import check_all
from trippilot.assembly_engine.quality import compute_quality
from trippilot.assembly_engine.repair import MinimalChangePolicy, RepairResult
from trippilot.assembly_engine.repair import repair as _repair_engine
from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.itinerary import (
    FixedBlock,
    ItineraryProblem,
    ItinerarySolution,
    TimeWindow,
    Violation,
    VisitSlot,
)
from trippilot.domain.observability import FallbackEvent, AssemblyRunRecord
from trippilot.domain.poi import Poi


class ChainStage(Protocol):
    """체인 단계 계약: 이름 + 진입 요구 시간 + solve."""

    name: str
    required_ms: int

    def solve(self, problem: ItineraryProblem,
              remaining_ms: int) -> ItinerarySolution | None: ...


class AssemblyConflictError(Exception):
    """모든 단계가 유효 해를 못 냈을 때 (예: 모순된 고정 블록).

    d08(필수 방문지 충돌) 흐름으로 위임될 예외 — U5에서 API 에러로 매핑.
    """


class HybridAssemblyFacade:
    def __init__(self, stages: Sequence[ChainStage],
                 poi_index: Mapping[PoiId, Poi],
                 estimator, clock, trace) -> None:
        self._stages = list(stages)
        self._pois = poi_index
        self._est = estimator
        self._clock = clock
        self._trace = trace

    # ── 검증 단일 진입점 (정본 §1.2 validate) ──
    def validate(self, solution: ItinerarySolution, problem: ItineraryProblem,
                 deadline_ms: int,
                 trace_id: TraceId | None = None) -> list[Violation]:
        """HC1~4 검증 결과. 시한은 **관측 대상일 뿐 검증을 생략시키지 않는다**.

        DL-2(진입 전 스킵)를 validate에 적용하면 미검증 해가 공개돼 INV-2가 깨진다.
        따라서 시한이 이미 소진됐어도 검증은 수행하고, 소진·초과 사실만
        FallbackEvent로 남긴다 (DL-5 침묵 금지). 이 메서드는 예외를 던지지 않는다.
        """
        tid = trace_id if trace_id is not None else TraceId("assembly")
        t0 = self._clock.monotonic_ms()
        if deadline_ms <= 0:  # 진입 시점에 이미 소진 — 그래도 검증은 한다 (INV-2 우선)
            self._emit_fallback(tid, "validate", "validate",
                                "deadline_exhausted:validate_forced")
        violations = check_all(solution, problem, self._pois, self._est)
        self._observe_overrun(tid, "validate", self._clock.monotonic_ms() - t0,
                              deadline_ms)
        return violations

    # ── 최소 변경 수리 공개 경계 (정본 §1.2 repair, TRIP-292) ──
    def repair(self, solution: ItinerarySolution, problem: ItineraryProblem,
               deadline_ms: int, trace_id: TraceId | None = None,
               policy: MinimalChangePolicy = MinimalChangePolicy.TIME_SHIFT_ONLY,
               ) -> RepairResult:
        """HC 위반 해를 최소 변경으로 수리한다. 수리 불가면 `repaired=None`.

        poi_index·estimator는 퍼사드가 보유한 것을 주입한다 — 호출자(백엔드·U5)가
        어셈블리 내부 자료를 알 필요가 없게 하는 것이 이 승격의 목적이다.

        시한(DL-2): 잔여가 없으면 **실행 없이** 수리 불가로 반환 + FallbackEvent.
        수리는 최선 노력이라 스킵해도 계약(repaired=None)이 성립한다 — solve()와
        달리 "항상 결과를 낸다"는 보장이 없으므로 스킵이 허용된다.

        반환 전 재검증(FD §2.7): 수리 결과가 HC를 여전히 어기면 공개하지 않고
        repaired=None으로 강등한다 (INV-2 — 미검증 해 반환 경로 없음).
        통과분에는 solve()와 동일하게 QualityScore를 부착한다 (TRIP-261).
        """
        tid = trace_id if trace_id is not None else TraceId("assembly")
        t0 = self._clock.monotonic_ms()
        if deadline_ms <= 0:  # DL-2: 진입 전 잔여 확인 — 침묵 스킵 금지 (DL-5)
            self._emit_fallback(tid, "repair", "(unrepaired)", "deadline")
            return RepairResult(repaired=None, changes=())

        result = _repair_engine(solution, problem, self._pois, self._est, policy)
        if result.repaired is None:
            self._finish_repair(tid, solution, problem, t0, deadline_ms,
                                repaired=False, reason="unrepairable")
            return RepairResult(repaired=None, changes=())

        violations = check_all(result.repaired, problem, self._pois, self._est)
        if violations:  # 수리했지만 여전히 위반 — 반환 금지 (INV-2)
            self._finish_repair(tid, solution, problem, t0, deadline_ms,
                                repaired=False,
                                reason=f"repair_invalid:{len(violations)}")
            return RepairResult(repaired=None, changes=())

        self._finish_repair(tid, result.repaired, problem, t0, deadline_ms,
                            repaired=True, reason=None)
        return replace(result, repaired=replace(
            result.repaired,
            score=compute_quality(result.repaired, problem, self._pois, self._est),
        ))

    # ── 시한 인지 체인 ──
    def solve(self, problem: ItineraryProblem, deadline_ms: int,
              trace_id: TraceId | None = None) -> ItinerarySolution:
        t0 = self._clock.monotonic_ms()

        def remaining() -> int:
            return deadline_ms - (self._clock.monotonic_ms() - t0)

        tid = trace_id if trace_id is not None else TraceId("assembly")
        for idx, stage in enumerate(self._stages):
            next_name = (self._stages[idx + 1].name
                         if idx + 1 < len(self._stages) else "(end)")
            left = remaining()
            # DL-2: 진입 전 잔여 확인. 잔여가 음수여도 required_ms=0(최후 보루)은
            # 스킵되지 않도록 max(0, ·)로 정규화 — 아니면 체인이 빈손으로 끝난다(INV-4).
            if max(0, left) < stage.required_ms:
                self._emit_fallback(tid, stage.name, next_name, "deadline")
                continue
            if left <= 0:  # 시한 소진 상태의 최후 보루 실행 — 침묵 금지 (DL-5)
                self._emit_fallback(tid, stage.name, stage.name,
                                    "deadline_exhausted:last_resort")
            result = stage.solve(problem, max(0, left))
            if result is None:  # 해 없음 → 다음 단계 (기존 체인 의미)
                self._emit_fallback(tid, stage.name, next_name, "no_solution")
                continue
            # 체인 내부 검증은 check_all 직접 호출 — 단계별 시한 회계(DL-2)는 위에서
            # 이미 하므로 public validate()의 시한 관측을 중복 발행하지 않는다.
            violations = check_all(result, problem, self._pois, self._est)
            if violations:  # 유효하지 않은 해는 반환 금지 (INV-2)
                self._emit_fallback(tid, stage.name, next_name,
                                    f"invalid:{len(violations)}")
                continue
            # 유일 수렴 반환점 — 모든 경로(OR-Tools·LLM·규칙 폴백)에 품질 점수 부착
            # (§3.7, TRIP-261). regenerate()도 solve() 경유라 함께 커버된다.
            # 점수를 emit 전에 계산해 레코드에도 동봉한다 (TRIP-524 — 리허설 관측).
            score = compute_quality(result, problem, self._pois, self._est)
            self._trace.emit(AssemblyRunRecord(
                trace_id=tid,
                occurred_at=datetime.now(timezone.utc),
                component="c2_facade",
                solve_mode=result.solve_mode,
                elapsed_ms=deadline_ms - remaining(),
                violations_found=0,
                repaired=False,
                quality_preference_fit=score.preference_fit,
                quality_route_efficiency=score.route_efficiency,
                quality_composite=score.composite,
            ))
            return replace(result, score=score)
        # RuleFallback이 체인에 있으면 시한과 무관하게 도달 불가(TRIP-291).
        # 도달 = 유효 해 자체가 없음(모순 입력) — "시간이 없어서"는 이유가 될 수 없다.
        raise AssemblyConflictError("모든 단계 실패 — 고정 블록 모순 등 입력 확인 필요")

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
        # replace()로 바꾼 이유(TRIP-292): 필드를 일일이 나열해 재구성하던 코드가
        # 나중에 추가된 excluded_poi_ids를 빠뜨려 regenerate 경로에서만 제외가
        # 조용히 사라졌다. replace는 나열하지 않은 필드를 전부 그대로 옮기므로
        # ItineraryProblem에 필드가 추가돼도 같은 종류의 소실이 재발하지 않는다.
        # 시드도 그대로 유지된다 → 재실행 멱등 (U5-P2).
        augmented = replace(problem, fixed_blocks=problem.fixed_blocks + promoted)
        return self.solve(augmented, deadline_ms, trace_id)

    # ── 내부 관측 헬퍼 ──
    def _observe_overrun(self, tid: TraceId, op: str, elapsed_ms: int,
                         deadline_ms: int) -> None:
        """시한 초과를 사후 관측 (DL-1 위반의 증빙 — 침묵 금지)."""
        if deadline_ms > 0 and elapsed_ms > deadline_ms:
            self._emit_fallback(tid, op, "(end)",
                                f"deadline_exceeded:{op}:{elapsed_ms}ms")

    def _finish_repair(self, tid: TraceId, solution: ItinerarySolution,
                       problem: ItineraryProblem, t0: int, deadline_ms: int,
                       repaired: bool, reason: str | None) -> None:
        if reason is not None:  # 수리 실패·강등도 관측 대상 (INV-4)
            self._emit_fallback(tid, "repair", "(unrepaired)", reason)
        elapsed = self._clock.monotonic_ms() - t0
        self._trace.emit(AssemblyRunRecord(
            trace_id=tid,
            occurred_at=datetime.now(timezone.utc),
            component="c2_facade",
            solve_mode=solution.solve_mode,  # 출처 보존 (수리는 출처를 바꾸지 않음)
            elapsed_ms=elapsed,
            violations_found=(
                0 if repaired
                else len(check_all(solution, problem, self._pois, self._est))
            ),
            repaired=repaired,
        ))
        self._observe_overrun(tid, "repair", elapsed, deadline_ms)

    def _emit_fallback(self, tid: TraceId, from_: str, to: str, reason: str) -> None:
        self._trace.emit(FallbackEvent(  # DL-5: 침묵 스킵 금지
            trace_id=tid,
            occurred_at=datetime.now(timezone.utc),
            component="c2_facade",
            stage="assembly",
            from_mode=from_,
            to_mode=to,
            reason=reason,
        ))
