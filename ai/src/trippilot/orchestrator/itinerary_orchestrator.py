"""ItineraryOrchestrator — score→solve 조립 + 폴백 계단 (services.md §1, TRIP-237·238).

부품(M7 후보풀 · C1 선호점수 · C2 솔버 체인)은 각각 완성돼 있고, 이 모듈은 **조립**만 한다.

```
요청 → ⓪ 소유 검증 (fail-closed)   남의 persona_ref → 항상 403 (TRIP-333, 시한 무관)
     → ① M7 후보풀 build          (closed-set의 유일한 출처, INV-1)
     → ② C1 선호 점수 (전 일자 1회) 실패·스킵 → 규칙 점수 (BR-U4-09의 "호출측"이 여기다)
     → ②′ 날씨 예보 조회 (선택)     실패·미주입 → 무보정 (TRIP-383, 보정은 C2 소프트 항)
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
from datetime import date, datetime, timedelta
from enum import Enum
from typing import Mapping, Protocol

from trippilot.llm_gateway.workers.explanation import ExplanationWorker
from trippilot.llm_gateway.workers.preference import PreferenceScoringWorker
from trippilot.solver_engine.facade import SolverConflictError
from trippilot.solver_engine.scorer import build_rule_score
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
from trippilot.domain.poi_curation import CandidatePoolRequest
from trippilot.domain.observability import FallbackEvent
from trippilot.domain.poi import Poi, PoiCategory
from trippilot.poi_curation.pool_builder import CandidatePoolBuilder
from trippilot.ports.trace_port import TracePort
from trippilot.domain.freshness import ProviderKind, ProviderStatus
from trippilot.orchestrator.info_collector import InfoCollector

_COMPONENT = "orchestrator.itinerary"


# ── 협력자 계약 (주입) ──────────────────────────────────────────────


class Clock(Protocol):
    """경과 시간 측정 — wall-clock 직접 호출 금지 (DL-3, c2 퍼사드와 같은 콘센트)."""

    def monotonic_ms(self) -> int: ...


class OwnershipVerifier(Protocol):
    """ContextResolver의 소유 검증 갈래 (TRIP-333 fail-closed).

    보안 규칙의 권위는 C1 `llm_gateway.context.ContextResolver`에 있다 — 오케스트레이터는
    검사를 복제하지 않고 그 검증 전용 공개 메서드만 호출한다. 저장소 조회·LLM 호출 없음.
    """

    def verify_ownership(
        self, principal: Principal, refs: tuple[ResourceRef, ...]
    ) -> None: ...


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

    배분 방식은 **단계별 상한 + 솔버는 잔여 전부** (TRIP-376, 고정 분할 폐기):
    상류(M7·C1)는 상한까지만 쓰고, 솔버는 solve 시점 잔여를 전부 받는다.
    day1 5초·전체 20초 양쪽에서 성립해야 하므로 **고정 ms가 아니라 비율+상한**이다.
    """

    c2_min_share: float = 0.5     # 전체 예산 중 솔버 바닥이 가져가는 몫 (소예산용)
    c2_floor_ms: int = 1_000      # 솔버 바닥 절대 하한 (전체가 더 작으면 전체까지만)
    # 솔버 바닥 상한 — 솔버는 어차피 solve 시점 잔여를 **전부** 받으므로(④) 바닥을
    # 키울 이유가 없고, 바닥이 크면 C1 상한이 그만큼 줄어든다. OR-Tools 실측
    # 3.0~3.1s(193건, TRIP-373) + 여유 = 5s (TRIP-376).
    c2_cap_ms: int = 5_000
    m7_share: float = 0.3         # 상류(M7+C1) 몫 중 M7 관측 배분
    m7_max_ms: int = 1_000        # M7은 로컬 조회 — 이 이상 걸리면 관측 대상
    # C1 점수 단계 상한 — PREFERENCE_SCORING 실호출 바닥 ~3s(7건 3.2s)·변동 3~4배
    # (TRIP-373 실측). 종전 2.5s에서는 LLM 점수가 구조적으로 미사용이었다 (TRIP-376).
    c1_max_ms: int = 14_000
    c1_min_ms: int = 800          # 이보다 적게 배분되면 LLM 호출 자체를 스킵 (DL-2)
    explanation_min_ms: int = 1_500  # 설명 부착(선택 단계) 진입 하한

    def __post_init__(self) -> None:
        if not 0.0 < self.c2_min_share < 1.0:
            raise ValueError("c2_min_share ∈ (0, 1)")
        if not 0.0 <= self.m7_share < 1.0:
            raise ValueError("m7_share ∈ [0, 1)")
        if self.c2_cap_ms <= 0:
            raise ValueError("c2_cap_ms 양수 필요 (total>0 ⇒ c2>0 불변식의 전제)")
        for name in ("c2_floor_ms", "m7_max_ms", "c1_max_ms", "c1_min_ms",
                     "explanation_min_ms"):
            if getattr(self, name) < 0:
                raise ValueError(f"{name} 음수 불가")


@dataclass(frozen=True, slots=True)
class DeadlineBudget:
    """단계별 시한 배분 결과 — **상류는 상한, 솔버는 잔여 전부** (TRIP-376).

    `m7_ms`·`c1_ms`는 각 단계의 **상한**(C1은 게이트웨이 호출 타임아웃으로 관통
    강제)이고, `c2_reserved_ms`는 솔버의 **최소 보장 바닥**이다. 솔버의 실제 예산은
    solve 시점 잔여 전부(≥ 바닥) — 앞 단계가 일찍 끝나면 그만큼 솔버가 더 받는다.

    불변식(구조 강제): 상한 합 + 바닥 ≤ total (상한 합이 바닥을 침범할 수 없다 —
    상한을 다 써도 바닥은 남는다), 전체 예산이 양수인 한 **바닥은 0보다 크다**.
    "배분이 나빠서 항상 최소 일정만 나오는" 상태는 이 타입의 인스턴스로 표현 자체가
    불가능하다.
    """

    total_ms: int
    m7_ms: int
    c1_ms: int
    c2_reserved_ms: int

    def __post_init__(self) -> None:
        if min(self.m7_ms, self.c1_ms, self.c2_reserved_ms) < 0:
            raise ValueError("배분은 음수가 될 수 없음")
        if self.m7_ms + self.c1_ms + self.c2_reserved_ms > max(0, self.total_ms):
            raise ValueError("상한 합이 솔버 바닥을 침범함")
        if self.total_ms > 0 and self.c2_reserved_ms <= 0:
            raise ValueError("솔버 바닥이 0 이하 — 배분 규칙 위반")


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


# 경계 카테고리 8종 (domain/poi.py 정본) — STAY는 내부 전용이라 충분성 판정 대상이 아니다.
_BOUNDARY_CATEGORIES: tuple[PoiCategory, ...] = tuple(
    c for c in PoiCategory if c is not PoiCategory.STAY
)


@dataclass(frozen=True, slots=True)
class CandidatesReport:
    """후보 충분성 보고 (BR-U2-05) — 판정은 AI 소유, 백엔드는 그대로 전달한다.

    `level` 어휘는 io-contracts의 sufficiency(OK | LOW | NO_CANDIDATES).
    필드명은 API `CandidatesSummaryLike`(protocols.py) 구조 계약과 일치한다.
    """

    level: str
    pool_size: int | None  # 모르면 None — 0은 "후보 0건"이라는 판정 (여기서는 항상 안다)
    shortfall_categories: tuple[str, ...]


def candidates_report(pool: CandidatePool) -> CandidatesReport:
    """M7 풀 실측 → 충분성 보고. 지어내지 않는다 — 전부 풀에서 센 사실이다.

    - shortfall = 풀에 후보가 **0건**인 경계 카테고리 (카테고리별 최소 개수 임계는 1 —
      임계 발명을 최소화한 1차 규칙. 정교한 판정은 PlaceScoutProvider(S7.1) 승격 시 이관)
    - level: 풀 자체가 비면 NO_CANDIDATES, 빠진 카테고리가 있으면 LOW, 아니면 OK
    """
    present = {p.category for p in pool.pois}
    shortfall = tuple(
        c.value for c in _BOUNDARY_CATEGORIES if c not in present
    )
    if not pool.pois:
        level = "NO_CANDIDATES"
    elif shortfall:
        level = "LOW"
    else:
        level = "OK"
    return CandidatesReport(
        level=level, pool_size=len(pool.pois), shortfall_categories=shortfall
    )


@dataclass(frozen=True, slots=True)
class GenerationOutcome:
    """조립 결과. FAILED ⇔ solution=None ⇔ error 존재 (셋이 서로 거짓말할 수 없다).

    `candidates_summary`·`solved_at`은 **기본값 없음** — 생성 지점이 채움을 잊으면
    TypeError로 드러난다 (anti-patterns "전이 진입점에 기본값 금지").
    - `candidates_summary`: M7 풀 실측 보고. 풀을 만들기 전에 실패하면 None(모름).
    - `solved_at`: 솔버 검증 완료 시각 = 주입된 `now` + 단조시계 경과 (wall-clock
      직접 호출 없음, DL-3). 해가 없으면(FAILED) None.
    """

    status: GenerationStatus
    solution: ItinerarySolution | None
    scoring_mode: ScoringMode
    explanations: tuple[PoiExplanation, ...]
    degradations: tuple[Degradation, ...]
    candidate_count: int
    budget: DeadlineBudget
    candidates_summary: CandidatesReport | None
    solved_at: datetime | None
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
        if self.solution is None and self.solved_at is not None:
            raise ValueError("해가 없는데 solved_at 존재 — 검증 시각을 지어낼 수 없다")

    @property
    def is_fallback(self) -> bool:
        return self.status is not GenerationStatus.SUCCESS


_ZERO_BUDGET = DeadlineBudget(total_ms=0, m7_ms=0, c1_ms=0, c2_reserved_ms=0)


def allocate(total_ms: int, config: OrchestratorConfig) -> DeadlineBudget:
    """전체 예산 → 단계별 상한 배분. 솔버 바닥을 **먼저 떼고** 남은 것이 상류 상한이다.

    바닥을 나중에 계산하면 상류가 다 써버렸을 때 0 이하가 된다 — 순서가 곧 보장이다.
    솔버의 실제 예산은 이 바닥이 아니라 solve 시점 잔여 전부다(_generate ④).
    - 5,000ms(day1): 바닥 2,500 / M7 상한 750 / C1 상한 1,750 (즉답 목적 —
      실호출 바닥 ~3s > 상한이라 규칙 점수 유지가 의도)
    - 20,000ms(전체): 바닥 5,000 / M7 상한 1,000 / C1 상한 14,000 (TRIP-376 —
      점수 실호출 바닥 ~3s·변동 3~4배(TRIP-373 실측)라 종전 2.5s 배분은 미사용)
    """
    total = max(0, total_ms)
    c2_reserved = min(
        total, config.c2_cap_ms,
        max(config.c2_floor_ms, int(total * config.c2_min_share)),
    )
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
        context_resolver: OwnershipVerifier,
        explanation_worker: ExplanationWorker | None = None,
        info: InfoCollector | None = None,
        config: OrchestratorConfig | None = None,
    ) -> None:
        self._pool_builder = pool_builder
        self._scoring = scoring_worker
        self._solvers = solver_provider
        self._clock = clock
        self._trace = trace
        self._resolver = context_resolver  # 소유 검증 갈래만 쓴다 (TRIP-333)
        self._explainer = explanation_worker  # 미주입이면 설명 단계를 통째로 건너뛴다
        # InfoCollector 경유 수집 (TRIP-406) — 미주입이면 날씨 보정 없이 생성.
        self._info = info
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

        # ⓪ 소유 검증 — fail-closed (TRIP-333, 팀 결정 2026-08-11).
        #    권한 검사를 접근 시점(C1의 페르소나 재조회)에만 맡기면 DL-2 시한 스킵으로
        #    C1이 통째로 건너뛰어질 때 남의 persona_ref가 403 없이 규칙 점수 일정으로
        #    "성공"한다. deadline이 어떤 값이어도 남의 persona_ref는 항상 403 —
        #    검사의 권위는 ContextResolver 한 곳이고, 여기서는 소유 검증 갈래만
        #    호출한다(저장소 조회·LLM 호출 없음, 검사 복제 아님). 위반이면
        #    PermissionDeniedError → generate가 FAILED(permission_denied)로 수렴 →
        #    경계에서 403 retryable=false (api/errors.py 기존 매핑 그대로).
        #    참고: 현 와이어에는 사용자 식별자가 없어 principal이 trip_id 파생
        #    자기참조라(api/wiring.py) 경계에서 403이 실제 발현되지는 않는다 —
        #    이 검사는 내부 계약을 미리 옳게 만드는 것으로, 실 식별자 합의 시
        #    그대로 동작한다.
        self._resolver.verify_ownership(request.principal, (request.persona_ref,))

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
        summary = candidates_report(pool)  # 풀 실측 보고 (BR-U2-05 — 경계로 그대로 나간다)
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

        # ②′ 날씨 예보 (TRIP-383) — 결과는 problem에 실려 C2 소프트 항이 쓴다.
        #    조회 실패 = 무보정 + 강등 기록(침묵 금지), 미주입 = 기능 부재(무보정).
        daily_rain = self._daily_rain(request, steps, trace_id, now)

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
            daily_rain_prob=daily_rain,  # None = 무보정 (TRIP-383)
        )

        # ④ C2 solve — 솔버는 잔여 **전부**를 받는다 (고정 슬라이스 아님, TRIP-376).
        #    앞 단계가 일찍 끝나면 그만큼 더 받고(2차에서 점수 4s면 솔버 ~15s),
        #    상한 밖 소모(m7 초과 등)가 있어도 바닥 아래로는 내려가지 않는다.
        #    OR-Tools는 anytime — 잔여 시간이 곧 최적성이고 해 자체는 나온다.
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
                                candidate_count=len(candidates),
                                candidates_summary=summary)
        # 솔버 검증 완료 시각 — 주입된 now + 단조시계 경과 (wall-clock 직접 호출 금지).
        solved_at = now + timedelta(milliseconds=self._clock.monotonic_ms() - t0)
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
            candidates_summary=summary,
            solved_at=solved_at,
        )

    # ── ②′ 날씨 예보 조회 (TRIP-383) ────────────────────────────────

    def _daily_rain(
        self,
        request: GenerateItineraryRequest,
        steps: list[Degradation],
        trace_id: TraceId,
        now: datetime,
    ) -> dict[date, int] | None:
        """여행 날짜들의 강수확률(%) 수집 — 생성은 날씨를 problem으로만 안다.

        TRIP-406부터 수집은 InfoCollector(→WeatherProvider) 경유 — 오케스트레이터는
        포트를 모르고 InfoPacket 상태값만 소비한다 (agent-structure-v2 §3).
        - **미주입(None)·Provider 미등록**: 기능 부재 — 무보정, 강등으로 세지
          않는다(⑤ 설명 워커의 "미배선 = 기능 부재" 선례와 동일).
        - **수집 실패(OK 아닌 상태값)**: 무보정 + Degradation + FallbackEvent
          (침묵 금지, INV-4 — 날씨 실패가 생성 실패가 되면 안 된다).
        - 반환은 요청 날짜로 한정한다(예보 지평 밖·무관 날짜는 problem에 싣지 않음).
          유효 예보가 없으면 None — 솔버 무보정 경로와 동일.
        """
        if self._info is None:
            return None
        packets = self._info.collect(
            "GENERATE_SCHEDULE",
            {"anchor": request.anchor, "days": request.days, "now": now},
        )
        packet = packets.get(ProviderKind.WEATHER)
        if packet is None:  # Provider 미등록 — 기능 부재
            return None
        if packet.status is not ProviderStatus.OK:
            self._degrade(steps, trace_id, now, "weather", "weather_forecast",
                          "no_adjust",
                          f"weather_error: {packet.data.get('reason', packet.status.value)}")
            return None
        wanted = set(request.days)
        # 패킷 data는 JSON-safe(ISO 문자열 키) — problem 주입 전에 date로 복원
        filtered = {
            parsed: p for d, p in packet.data.get("daily", {}).items()
            if (parsed := date.fromisoformat(d)) in wanted
        }
        return filtered or None

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
            # 이 경로는 페르소나를 읽지 않지만, 소유 검증은 이미 _generate ⓪에서
            # 끝났다(TRIP-333 fail-closed) — 남의 persona_ref는 여기 도달하지 못한다.
            self._degrade(steps, trace_id, now, "llm", "llm_score", "rule_score",
                          f"deadline:c1_budget={budget.c1_ms}ms")
            return self._rule_scores(request, pool), ScoringMode.RULE

        try:
            # 단계 상한이 게이트웨이 호출 타임아웃까지 **관통**한다 (TRIP-376) —
            # 상한만 늘리고 호출 시한이 고정 2.5s로 남으면 실호출(바닥 ~3s,
            # TRIP-373 실측)이 먼저 잘려 상향이 무의미하다. c2 llm_solver와 같은
            # min(상한, 잔여) 패턴.
            result = self._scoring.score(
                pool, request.persona_ref, request.principal, trace_id, now,
                timeout_sec=min(budget.c1_ms, remaining_ms) / 1000.0,
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
        if result.error is not None:
            # 부분 청크 실패 (TRIP-378) — 워커가 성공 청크만 병합해 error에 표기했다.
            # 실패 청크의 FallbackEvent는 게이트웨이가 청크별로 이미 발행했으므로
            # 여기서는 결과에만 싣는다 (강등 이중 계수 방지).
            steps.append(Degradation(stage="llm",
                                     reason=f"c1_partial: {result.error}"))
        missing = pool.poi_ids - {sp.poi_id for sp in scored}
        if missing:
            # 점수 없는 후보는 버리지 않고 규칙 점수로 보충한다 (TRIP-378) —
            # 후보 탈락은 INV-1 게이트의 몫이지 점수 누락의 몫이 아니다.
            # 규칙 점수 실행은 호출측 소유(BR-U4-09)고, 보충은 오케스트레이터
            # 스스로의 결정이라 여기서 관측한다 (침묵 금지).
            self._observe(trace_id, now, "llm", "llm_score", "llm_score",
                          f"rule_backfill:{len(missing)}")
            scored = scored + tuple(
                sp for sp in self._rule_scores(request, pool)
                if sp.poi_id in missing
            )
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
            # 잔여 < 임계(explanation_min_ms, config) — 부를 시간이 없으면 부르지
            # 않는다(DL-2). 설명은 부가 정보라 빈 설명으로 일정은 그대로 나가되,
            # 스킵 사실은 강등 + 이벤트로 남긴다 (INV-4 침묵 금지).
            self._degrade(steps, trace_id, now, "explanation", "llm_explain",
                          "(none)", f"deadline:remaining={remaining}ms")
            return ()

        try:
            result = self._explainer.explain(
                pool, tuple(ordered), request.persona_ref, request.principal,
                trace_id, now,
                # 잔여 예산이 호출 타임아웃까지 관통 (TRIP-381, 점수 단계와 같은
                # 패턴) — 미관통이면 게이트웨이 기본 2.5s가 잔여(예: 300ms든
                # 9s든)를 무시하고, SDK 내부 재시도까지 겹치면 2.5s 설정이 실제
                # ~10s를 소모했다(계측 실측 — 20s 계약 초과의 후반부 정체).
                timeout_sec=remaining / 1000.0,
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
        candidates_summary: CandidatesReport | None = None,
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
            candidates_summary=candidates_summary,  # 풀 이전 실패면 None — 모름을 유지
            solved_at=None,  # 해가 없다 — 검증 시각을 지어내지 않는다
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
