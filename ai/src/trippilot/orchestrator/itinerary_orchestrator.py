"""ItineraryOrchestrator — score→solve 조립 + 폴백 계단 (services.md §1, TRIP-237·238).

부품(M7 후보풀 · C1 선호점수 · C2 솔버 체인)은 각각 완성돼 있고, 이 모듈은 **조립**만 한다.

```
요청 → ① M7 후보풀 build          (closed-set의 유일한 출처, INV-1)
     → ② C1 선호 점수 (전 일자 1회) 실패·스킵 → 규칙 점수 (BR-U4-09의 "호출측"이 여기다)
     → ③ ItineraryProblem 조립     (후보는 ①의 풀에서 나온 것만)
     → ④ C2 solve                  (체인 폴백은 C2 소유 — 여기서 이중 폴백 금지)
     → ⑤ (선택) C1 설명 부착        실패 → 설명 없이 진행
```

**INV-1**: `candidates`는 `pool.pois`에서만 만들어진다 — 규칙 점수 경로는 풀을 순회해 생성하고,
LLM 경로는 게이트 통과분을 **한 번 더** `pool.contains`로 교차한다. 풀 밖 POI가 후보로 들어오는
경로가 조립 어디에도 없다(고정 블록은 사용자 지정 must-visit이라 선택 대상이 아니며 HC3 소관).

**INV-2**: 시각·순서는 손대지 않는다 — `solve()`가 돌려준 해를 그대로 싣는다.

**INV-4**: `generate()`는 예외를 밖으로 던지지 않는다. 어떤 실패도 결과(`DEGRADED`) 또는
**명시적 실패**(`FAILED` + error)로 수렴하고, 밟은 계단은 `degradations`에 남는다(침묵 금지).

**중복 관측 금지**: 하류(C1 게이트웨이·C2 퍼사드)가 스스로 결정한 강등은 하류가 이미
`FallbackEvent`를 발행했다 — 오케스트레이터는 결과에만 싣는다. 폴백률 지표가 한 번의 강등을
두 번 세지 않게 하기 위함이다. **오케스트레이터가 스스로 내린 결정**(시한 때문에 C1을 건너뛰기,
워커 예외, 게이트 우회 탐지)만 이 컴포넌트 이름으로 발행한다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from enum import Enum
from typing import Mapping, Protocol

from trippilot.c1.workers.explanation import ExplanationWorker
from trippilot.c1.workers.preference import PreferenceScoringWorker
from trippilot.c2.facade import SolverConflictError
from trippilot.c2.scorer import build_rule_score
from trippilot.domain.common import (
    BudgetLevel,
    GeoPoint,
    PoiId,
    ScheduleId,
    TraceId,
    TransportMode,
)
from trippilot.domain.context import PermissionDeniedError, Principal, ResourceRef
from trippilot.domain.itinerary import (
    FixedBlock,
    ItineraryProblem,
    ItinerarySolution,
    TimeWindow,
)
from trippilot.domain.llm import CandidatePool, PoiExplanation, ScoredPoi
from trippilot.domain.m7 import CandidatePoolRequest
from trippilot.domain.observability import FallbackEvent
from trippilot.domain.poi import Poi
from trippilot.m7.pool_builder import CandidatePoolBuilder
from trippilot.ports.trace_port import TracePort

_COMPONENT = "orchestrator.itinerary"


# ── 협력자 계약 (주입) ──────────────────────────────────────────────


class Clock(Protocol):
    """경과 시간 측정 — wall-clock 직접 호출 금지 (DL-3, c2 퍼사드와 같은 콘센트)."""

    def monotonic_ms(self) -> int: ...


class SolverFacade(Protocol):
    """C2 공개 경계 중 이 조립이 쓰는 한 갈래 (TRIP-292의 solve)."""

    def solve(
        self,
        problem: ItineraryProblem,
        deadline_ms: int,
        trace_id: TraceId | None = None,
    ) -> ItinerarySolution: ...


class SolverProvider(Protocol):
    """후보 풀이 요청마다 다르므로 `poi_index`도 요청 스코프 — 퍼사드를 풀에 맞춰 조립한다.

    고정 블록 POI가 풀 밖(반경·예산 필터에서 탈락)일 수 있다. 그 경우 인덱스에 없어
    HC1·HC2가 미적용되는데, 이는 "정보 없음은 막지 않는다"는 c2 규칙과 같은 처리다.
    인덱스를 보강하고 싶으면 이 provider 구현에서 하면 된다(조립은 관여하지 않는다).
    """

    def for_pool(self, poi_index: Mapping[PoiId, Poi]) -> SolverFacade: ...


# ── 입출력 타입 (도메인 타입 조합 — HTTP 스키마는 경계 어댑터 소관) ──


@dataclass(frozen=True, slots=True)
class GenerateItineraryRequest:
    """일정 생성 요청 (agent-io-contracts §1.2 ScheduleAgentInput의 도메인 형태).

    day1 2단계 생성(TRIP-293): `days`는 전체 여행의 **부분집합**일 수 있고
    `excluded_poi_ids`에 이미 배정된 POI가 실려온다. 도메인이 이미 지원하므로
    조립은 그대로 통과시킨다 — 별도 분기 없음.
    """

    schedule_id: ScheduleId
    anchor: GeoPoint
    days: tuple[date, ...]
    day_window: TimeWindow
    budget: BudgetLevel
    transport: TransportMode
    persona_ref: ResourceRef
    principal: Principal
    seed: int
    fixed_blocks: tuple[FixedBlock, ...] = ()
    excluded_poi_ids: frozenset[PoiId] = frozenset()
    radius_override_km: float | None = None

    def __post_init__(self) -> None:
        if not self.days:
            raise ValueError("days는 최소 1일")


@dataclass(frozen=True, slots=True)
class OrchestratorConfig:
    """시한 배분 파라미터 (services.md §5.1 타임아웃 정책의 주입 컨테이너).

    day1 5초·전체 20초 양쪽에서 성립해야 하므로 **고정 ms가 아니라 비율+상한**이다.
    """

    c2_min_share: float = 0.5     # 전체 예산 중 C2가 최소로 가져가는 몫
    c2_floor_ms: int = 1_000      # C2 최소 절대 예산 (전체가 더 작으면 전체까지만)
    m7_share: float = 0.3         # 상류(M7+C1) 몫 중 M7 관측 배분
    m7_max_ms: int = 1_000        # M7은 로컬 조회 — 이 이상 걸리면 관측 대상
    c1_max_ms: int = 2_500        # C1 LLM 호출 시한 정본 (services §5.1)
    c1_min_ms: int = 800          # 이보다 적게 배분되면 LLM 호출 자체를 스킵 (DL-2)
    explanation_min_ms: int = 1_500  # 설명 부착(선택 단계) 진입 하한

    def __post_init__(self) -> None:
        if not 0.0 < self.c2_min_share < 1.0:
            raise ValueError("c2_min_share ∈ (0, 1)")
        if not 0.0 <= self.m7_share < 1.0:
            raise ValueError("m7_share ∈ [0, 1)")
        for name in ("c2_floor_ms", "m7_max_ms", "c1_max_ms", "c1_min_ms",
                     "explanation_min_ms"):
            if getattr(self, name) < 0:
                raise ValueError(f"{name} 음수 불가")


@dataclass(frozen=True, slots=True)
class DeadlineBudget:
    """단계별 시한 배분 결과.

    불변식(구조 강제): 상류(M7+C1) 배분의 합은 C2 몫을 침범할 수 없고, 전체 예산이
    양수인 한 **C2 예산은 0보다 크다**. "배분이 나빠서 항상 최소 일정만 나오는" 상태는
    이 타입의 인스턴스로 표현 자체가 불가능하다.
    """

    total_ms: int
    m7_ms: int
    c1_ms: int
    c2_reserved_ms: int

    def __post_init__(self) -> None:
        if min(self.m7_ms, self.c1_ms, self.c2_reserved_ms) < 0:
            raise ValueError("배분은 음수가 될 수 없음")
        if self.m7_ms + self.c1_ms + self.c2_reserved_ms > max(0, self.total_ms):
            raise ValueError("상류 배분이 C2 몫을 침범함")
        if self.total_ms > 0 and self.c2_reserved_ms <= 0:
            raise ValueError("C2 예산이 0 이하 — 배분 규칙 위반")


class ScoringMode(Enum):
    """선호 점수의 출처 — 사용자 고지("기본 모드로 생성")의 근거."""

    LLM = "LLM"
    RULE = "RULE"


class GenerationStatus(Enum):
    SUCCESS = "SUCCESS"    # 폴백 계단을 한 칸도 밟지 않음
    DEGRADED = "DEGRADED"  # 어딘가 강등됐지만 일정은 나왔다 (사유는 degradations)
    FAILED = "FAILED"      # 일정 없음 — 명시적 실패 (침묵 금지)


@dataclass(frozen=True, slots=True)
class Degradation:
    """밟은 폴백 계단 1칸. 결과에 실려 호출자(백엔드)가 고지 문구를 고른다."""

    stage: str  # pool / llm / solver / explanation
    reason: str


@dataclass(frozen=True, slots=True)
class GenerationOutcome:
    """조립 결과. FAILED ⇔ solution=None ⇔ error 존재 (셋이 서로 거짓말할 수 없다)."""

    status: GenerationStatus
    solution: ItinerarySolution | None
    scoring_mode: ScoringMode
    explanations: tuple[PoiExplanation, ...]
    degradations: tuple[Degradation, ...]
    candidate_count: int
    budget: DeadlineBudget
    error: str | None = None

    def __post_init__(self) -> None:
        failed = self.status is GenerationStatus.FAILED
        if failed != (self.solution is None):
            raise ValueError("FAILED ⇔ solution=None 위반")
        if failed != (self.error is not None):
            raise ValueError("FAILED ⇔ error 필수 위반")
        if self.status is GenerationStatus.SUCCESS and self.degradations:
            raise ValueError("SUCCESS는 폴백 흔적 0 — 있으면 DEGRADED")
        if self.status is GenerationStatus.DEGRADED and not self.degradations:
            raise ValueError("DEGRADED는 사유 필수 (침묵 실패 금지, INV-4)")

    @property
    def is_fallback(self) -> bool:
        return self.status is not GenerationStatus.SUCCESS


_ZERO_BUDGET = DeadlineBudget(total_ms=0, m7_ms=0, c1_ms=0, c2_reserved_ms=0)


def allocate(total_ms: int, config: OrchestratorConfig) -> DeadlineBudget:
    """전체 예산 → 단계별 배분. C2 몫을 **먼저 떼고** 남은 것을 상류가 나눈다.

    C2를 나중에 계산하면 상류가 다 써버렸을 때 0 이하가 된다 — 순서가 곧 보장이다.
    - 5,000ms(day1): C2 2,500 예약 / M7 750 / C1 1,750
    - 20,000ms(전체): C2 10,000 예약 / M7 1,000 / C1 2,500(정본 상한에서 절단)
    """
    total = max(0, total_ms)
    c2_reserved = min(total, max(config.c2_floor_ms, int(total * config.c2_min_share)))
    upstream = max(0, total - c2_reserved)
    m7 = min(config.m7_max_ms, int(upstream * config.m7_share))
    c1 = min(config.c1_max_ms, max(0, upstream - m7))
    return DeadlineBudget(
        total_ms=total, m7_ms=m7, c1_ms=c1, c2_reserved_ms=c2_reserved
    )


class ItineraryOrchestrator:
    def __init__(
        self,
        pool_builder: CandidatePoolBuilder,
        scoring_worker: PreferenceScoringWorker,
        solver_provider: SolverProvider,
        clock: Clock,
        trace: TracePort,
        *,
        explanation_worker: ExplanationWorker | None = None,
        config: OrchestratorConfig | None = None,
    ) -> None:
        self._pool_builder = pool_builder
        self._scoring = scoring_worker
        self._solvers = solver_provider
        self._clock = clock
        self._trace = trace
        self._explainer = explanation_worker  # 미주입이면 설명 단계를 통째로 건너뛴다
        self._cfg = config or OrchestratorConfig()

    # ── 공개 API ────────────────────────────────────────────────────

    def generate(
        self,
        request: GenerateItineraryRequest,
        deadline_ms: int,
        trace_id: TraceId,
        now: datetime,
    ) -> GenerationOutcome:
        """요청 → 일정. 예외를 던지지 않는다 (INV-4 — 결과 또는 명시적 실패)."""
        budget = _ZERO_BUDGET
        try:
            budget = allocate(deadline_ms, self._cfg)
            return self._generate(request, budget, trace_id, now)
        except PermissionDeniedError as e:
            # D31: 권한 위반은 폴백 대상이 아니다 — 규칙 점수로 조용히 내려가면
            # 남의 페르소나 없이 "성공한 척"하게 된다. 부분 성공 0.
            return self._failed(budget, f"permission_denied: {e}", trace_id, now)
        except Exception as e:
            return self._failed(
                budget, f"orchestrator_error: {type(e).__name__}: {e}", trace_id, now
            )

    # ── 조립 (services.md §1.1 정상 경로 순서) ──────────────────────

    def _generate(
        self,
        request: GenerateItineraryRequest,
        budget: DeadlineBudget,
        trace_id: TraceId,
        now: datetime,
    ) -> GenerationOutcome:
        t0 = self._clock.monotonic_ms()
        steps: list[Degradation] = []

        # ① M7 후보 풀 — closed-set의 유일한 출처 (INV-1)
        pool = self._pool_builder.build(
            CandidatePoolRequest(
                anchor=request.anchor,
                dates=request.days,  # 부분집합 그대로 (day1 2단계 — 반경 규칙은 M7 소관)
                budget=request.budget,
                transport=request.transport,
                radius_override_km=request.radius_override_km,
            ),
            now,
        )
        m7_elapsed = self._clock.monotonic_ms() - t0
        if budget.m7_ms and m7_elapsed > budget.m7_ms:
            # 풀 없이는 일정이 없으므로 M7은 스킵 대상이 아니다 — 초과는 관측만 하고,
            # 실제 회수는 아래 C2 예산 계산(= 전체 − 경과)에서 자동으로 일어난다.
            self._observe(trace_id, now, "pool", "m7", "m7",
                          f"m7_overrun:{m7_elapsed}ms")

        # ② C1 선호 점수 (전 일자 공용 1회) — 실패·스킵이면 규칙 점수 (INV-4)
        elapsed = self._clock.monotonic_ms() - t0
        candidates, mode = self._score(
            request, pool, budget, budget.total_ms - elapsed, steps, trace_id, now
        )

        # ③ ItineraryProblem 조립 — 후보는 ①의 풀에서 나온 것만 (INV-1)
        problem = ItineraryProblem(
            schedule_id=request.schedule_id,
            days=request.days,
            candidates=candidates,
            fixed_blocks=request.fixed_blocks,
            budget=request.budget,
            transport=request.transport,
            day_window=request.day_window,
            seed=request.seed,
            anchor=request.anchor,
            excluded_poi_ids=request.excluded_poi_ids,  # 2단계 생성 그대로 통과
        )

        # ④ C2 solve — 잔여 전액을 넘기되 예약분 아래로는 내려가지 않는다.
        #    체인 폴백(OR-Tools→LLM→규칙→최소)은 C2가 이미 갖고 있다. 여기서
        #    재시도·재조립을 얹으면 이중 폴백이 되어 시한만 두 배로 쓴다 — 하지 않는다.
        c2_ms = max(
            budget.c2_reserved_ms, budget.total_ms - (self._clock.monotonic_ms() - t0)
        )
        solver = self._solvers.for_pool({p.poi_id: p for p in pool.pois})
        try:
            solution = solver.solve(problem, c2_ms, trace_id)
        except SolverConflictError as e:
            # 모순 입력(겹치는 고정 블록 등) — 시한 문제가 아니라 d08 흐름. 명시적 실패.
            self._observe(trace_id, now, "solver", "solver", "(none)",
                          f"solver_conflict: {e}")
            return self._failed(budget, f"solver_conflict: {e}", trace_id, now,
                                emit=False, scoring_mode=mode,
                                candidate_count=len(candidates))
        if solution.is_fallback:
            # C2 퍼사드가 강등 사유를 이미 FallbackEvent로 남겼다 — 결과에만 싣는다.
            steps.append(Degradation(
                stage="solver", reason=f"solver_degraded:{solution.solve_mode.value}"
            ))

        # ⑤ (선택) 설명 부착 — 실패해도 일정은 그대로 나간다
        explanations = self._explain(
            request, pool, solution, budget, t0, steps, trace_id, now
        )

        return GenerationOutcome(
            status=(GenerationStatus.DEGRADED if steps else GenerationStatus.SUCCESS),
            solution=solution,
            scoring_mode=mode,
            explanations=explanations,
            degradations=tuple(steps),
            candidate_count=len(candidates),
            budget=budget,
        )

    # ── ② 선호 점수 + 규칙 점수 폴백 ────────────────────────────────

    def _score(
        self,
        request: GenerateItineraryRequest,
        pool: CandidatePool,
        budget: DeadlineBudget,
        remaining_ms: int,
        steps: list[Degradation],
        trace_id: TraceId,
        now: datetime,
    ) -> tuple[tuple[ScoredPoi, ...], ScoringMode]:
        """BR-U4-09가 말하는 "규칙 점수 실행은 호출측 몫"의 그 호출측.

        c1은 신호(`TypedResult.is_fallback`)만 내고 실행하지 않는다 — 실행은 여기서
        `c2.scorer.build_rule_score`로 한다 (c1은 c2를 import할 수 없다: 경계 규칙).
        """
        if not pool.pois:
            # 후보 0건 — LLM을 부를 이유가 없다. 최소 일정으로 수렴하는 정상 경로.
            self._degrade(steps, trace_id, now, "llm", "llm_score", "rule_score",
                          "empty_pool")
            return (), ScoringMode.RULE

        if budget.c1_ms < self._cfg.c1_min_ms or remaining_ms <= 0:
            # DL-2: 진입 전 잔여 확인 — 부를 시간이 없으면 부르지 않는다(침묵 스킵 금지).
            # 이 경로에서는 페르소나를 아예 읽지 않으므로 권한 검사(D31)도 일어나지 않는다
            # — 권한은 접근 시점에 강제되고, 규칙 점수는 페르소나를 쓰지 않는다.
            self._degrade(steps, trace_id, now, "llm", "llm_score", "rule_score",
                          f"deadline:c1_budget={budget.c1_ms}ms")
            return self._rule_scores(request, pool), ScoringMode.RULE

        try:
            result = self._scoring.score(
                pool, request.persona_ref, request.principal, trace_id, now
            )
        except PermissionDeniedError:
            raise  # D31 — 폴백 대상 아님 (generate가 FAILED로 수렴시킨다)
        except Exception as e:
            # 워커가 게이트웨이 밖에서 터진 경우(재조회 실패·설정 버그) — 게이트웨이는
            # 이벤트를 낼 기회가 없었으므로 여기서 낸다.
            self._degrade(steps, trace_id, now, "llm", "llm_score", "rule_score",
                          f"score_error: {type(e).__name__}: {e}")
            return self._rule_scores(request, pool), ScoringMode.RULE

        if result.is_fallback:
            # 게이트웨이가 이미 FallbackEvent(to_mode=rule_score)를 발행했다.
            # 여기서는 실행만 — 같은 강등을 두 번 세지 않는다.
            steps.append(Degradation(stage="llm",
                                     reason=f"c1_fallback: {result.error}"))
            return self._rule_scores(request, pool), ScoringMode.RULE

        raw = tuple(result.value or ())
        scored = tuple(sp for sp in raw if pool.contains(sp.poi_id))
        if len(scored) != len(raw):
            # 게이트가 이미 막지만, 조립에서도 한 번 더 교차한다 (INV-1 우회 경로 0).
            self._observe(trace_id, now, "llm", "llm_score", "llm_score",
                          f"closed_set_recheck_dropped:{len(raw) - len(scored)}")
        if not scored:
            self._degrade(steps, trace_id, now, "llm", "llm_score", "rule_score",
                          "c1_empty_after_closed_set")
            return self._rule_scores(request, pool), ScoringMode.RULE
        return scored, ScoringMode.LLM

    def _rule_scores(
        self, request: GenerateItineraryRequest, pool: CandidatePool
    ) -> tuple[ScoredPoi, ...]:
        """결정론 규칙 점수 (동일 입력 → 동일 출력, FR-1.4).

        **풀을 순회해서** 만든다 — 후보가 풀 밖일 수 없는 이유가 코드 모양 자체다(INV-1).
        """
        return tuple(
            ScoredPoi(
                poi_id=poi.poi_id,
                score=build_rule_score(
                    poi, request.budget, request.anchor, request.seed
                ),
                is_llm_score=False,
            )
            for poi in sorted(pool.pois, key=lambda p: str(p.poi_id))
        )

    # ── ⑤ 설명 부착 (선택 단계) ─────────────────────────────────────

    def _explain(
        self,
        request: GenerateItineraryRequest,
        pool: CandidatePool,
        solution: ItinerarySolution,
        budget: DeadlineBudget,
        t0: int,
        steps: list[Degradation],
        trace_id: TraceId,
        now: datetime,
    ) -> tuple[PoiExplanation, ...]:
        if self._explainer is None:
            return ()  # 미배선 = 기능 부재이지 실패가 아니다 (강등으로 세지 않는다)

        seen: set[PoiId] = set()
        ordered: list[PoiId] = []
        for day in solution.days:
            for slot in day.slots:  # 솔버가 정한 순서 그대로 (INV-2)
                if slot.poi_id in seen or not pool.contains(slot.poi_id):
                    continue  # 풀 밖(고정 블록 유래)은 설명 대상에서 제외
                seen.add(slot.poi_id)
                ordered.append(slot.poi_id)
        if not ordered:
            return ()

        remaining = budget.total_ms - (self._clock.monotonic_ms() - t0)
        if remaining < self._cfg.explanation_min_ms:
            self._degrade(steps, trace_id, now, "explanation", "llm_explain",
                          "(none)", f"deadline:remaining={remaining}ms")
            return ()

        try:
            result = self._explainer.explain(
                pool, tuple(ordered), request.persona_ref, request.principal,
                trace_id, now,
            )
        except PermissionDeniedError:
            raise  # D31 — 권한 위반은 여기서도 폴백 대상이 아니다
        except Exception as e:
            self._degrade(steps, trace_id, now, "explanation", "llm_explain",
                          "(none)", f"explain_error: {type(e).__name__}: {e}")
            return ()

        if result.is_fallback:  # 게이트웨이가 이미 발행 — 결과에만 싣는다
            steps.append(Degradation(stage="explanation",
                                     reason=f"explanation_fallback: {result.error}"))
            return ()
        value = result.value
        if not isinstance(value, tuple) or not all(
            isinstance(x, PoiExplanation) for x in value
        ):
            self._degrade(steps, trace_id, now, "explanation", "llm_explain",
                          "(none)", "explanation_bad_shape")
            return ()
        # 게이트가 이미 막지만 여기서도 교차 (INV-1)
        return tuple(x for x in value if pool.contains(x.poi_id))

    # ── 실패·관측 헬퍼 ──────────────────────────────────────────────

    def _failed(
        self,
        budget: DeadlineBudget,
        error: str,
        trace_id: TraceId,
        now: datetime,
        *,
        emit: bool = True,
        scoring_mode: ScoringMode = ScoringMode.RULE,
        candidate_count: int = 0,
    ) -> GenerationOutcome:
        if emit:  # 예외 경로도 반드시 흔적을 남긴다 (침묵 실패 금지)
            self._observe(trace_id, now, "agent", "generate", "(none)", error)
        return GenerationOutcome(
            status=GenerationStatus.FAILED,
            solution=None,
            scoring_mode=scoring_mode,
            explanations=(),
            degradations=(Degradation(stage="agent", reason=error),),
            candidate_count=candidate_count,
            budget=budget,
            error=error,
        )

    def _degrade(
        self,
        steps: list[Degradation],
        trace_id: TraceId,
        now: datetime,
        stage: str,
        from_mode: str,
        to_mode: str,
        reason: str,
    ) -> None:
        """오케스트레이터가 **스스로 내린** 강등 — 결과에 싣고 이벤트도 발행한다."""
        steps.append(Degradation(stage=stage, reason=reason))
        self._observe(trace_id, now, stage, from_mode, to_mode, reason)

    def _observe(
        self,
        trace_id: TraceId,
        now: datetime,
        stage: str,
        from_mode: str,
        to_mode: str,
        reason: str,
    ) -> None:
        try:
            self._trace.emit(
                FallbackEvent(
                    trace_id=trace_id,
                    occurred_at=now,
                    component=_COMPONENT,
                    stage=stage,
                    from_mode=from_mode,
                    to_mode=to_mode,
                    reason=reason,
                )
            )
        except Exception:
            pass  # 계측 실패가 생성 실패가 되면 안 된다
