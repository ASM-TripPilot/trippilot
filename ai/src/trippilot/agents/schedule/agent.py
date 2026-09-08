"""ScheduleAgent — 게이트웨이 점수 → 문제 조립 → 어셈블리 solve → 설명 (services.md §1, TRIP-237·238).

오케스트레이터가 재료(풀·페르소나·날씨·행사 보너스·시한)를 `ScheduleTask` 에 담아
넘기면 이 에이전트가 일정을 만든다. 부품(게이트웨이 워커 · 어셈블리 체인)은 각각
완성돼 있고, 여기서는 **조립**만 한다. 어셈블리 엔진(`assembly_engine/`)은 독립 층 —
`solve()` 를 부를 뿐 안으로 들어가지 않는다.

```
ScheduleTask → ② 게이트웨이 선호 점수 (전 일자 1회)  실패·스킵 → 규칙 점수 (BR-U4-09의 "호출측"이 여기다)
             → ③ ItineraryProblem 조립               (후보는 풀에서 나온 것만)
             → ④ 어셈블리 solve                       (체인 폴백은 어셈블리 소유 — 여기서 이중 폴백 금지)
             → ⑤ (선택) 설명 부착                      실패 → 설명 없이 진행
```

**INV-1**: `candidates`는 `pool.pois`에서만 만들어진다 — 규칙 점수 경로는 풀을 순회해 생성하고,
LLM 경로는 게이트 통과분을 **한 번 더** `pool.contains`로 교차한다. 풀 밖 POI가 후보로 들어오는
경로가 조립 어디에도 없다(고정 블록은 사용자 지정 must-visit이라 선택 대상이 아니며 HC3 소관).

**INV-2**: 시각·순서는 손대지 않는다 — `solve()`가 돌려준 해를 그대로 싣는다.

**INV-4**: `run()`은 예외를 밖으로 던지지 않는다. 어떤 실패도 결과(`DEGRADED`) 또는
**명시적 실패**(`FAILED` + error)로 수렴하고, 밟은 계단은 `degradations`에 남는다(침묵 금지).

**중복 관측 금지**: 하류(게이트웨이·어셈블리 퍼사드)가 스스로 결정한 강등은 하류가 이미
`FallbackEvent`를 발행했다 — 에이전트는 결과에만 싣는다. 폴백률 지표가 한 번의 강등을
두 번 세지 않게 하기 위함이다. **에이전트가 스스로 내린 결정**(시한 때문에 LLM 을 건너뛰기,
워커 예외, 게이트 우회 탐지)만 이 컴포넌트 이름으로 발행한다.

시한: 단계 시한은 `task.budget` 과 `task.started_ms`(오케스트레이터의 단조시계 원점)로
계산한다 — 오케스트레이터와 **한 시계 원점**을 쓰므로 상한·잔여 배분(TRIP-376)이
추출 전과 같은 값으로 관통한다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Mapping, Protocol

from trippilot.agents.schedule.budget import DeadlineBudget, OrchestratorConfig
from trippilot.agents.schedule.outcome import (
    CandidatesReport,
    Degradation,
    GenerationOutcome,
    GenerationStatus,
    ScoringMode,
    failed_outcome,
)
from trippilot.assembly_engine.facade import AssemblyConflictError
from trippilot.assembly_engine.scorer import build_rule_score
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
from trippilot.domain.observability import FallbackEvent
from trippilot.domain.persona import PersonaSummary
from trippilot.domain.poi import Poi
from trippilot.llm_gateway.workers.explanation import ExplanationWorker
from trippilot.llm_gateway.workers.preference import PreferenceScoringWorker
from trippilot.ports.trace_port import TracePort

_COMPONENT = "agents.schedule"


# ── 협력자 계약 (주입) ──────────────────────────────────────────────


class Clock(Protocol):
    """경과 시간 측정 — wall-clock 직접 호출 금지 (DL-3, 어셈블리 퍼사드와 같은 콘센트)."""

    def monotonic_ms(self) -> int: ...


class AssemblyFacade(Protocol):
    """어셈블리 공개 경계 중 이 조립이 쓰는 한 갈래 (TRIP-292의 solve)."""

    def solve(
        self,
        problem: ItineraryProblem,
        deadline_ms: int,
        trace_id: TraceId | None = None,
    ) -> ItinerarySolution: ...


class AssemblyProvider(Protocol):
    """후보 풀이 요청마다 다르므로 `poi_index`도 요청 스코프 — 퍼사드를 풀에 맞춰 조립한다.

    고정 블록 POI가 풀 밖(반경·예산 필터에서 탈락)일 수 있다. 그 경우 인덱스에 없어
    HC1·HC2가 미적용되는데, 이는 "정보 없음은 막지 않는다"는 어셈블리 규칙과 같은 처리다.
    인덱스를 보강하고 싶으면 이 provider 구현에서 하면 된다(조립은 관여하지 않는다).
    """

    def for_pool(self, poi_index: Mapping[PoiId, Poi]) -> AssemblyFacade: ...


# ── 입출력 타입 (도메인 타입 조합 — HTTP 스키마는 경계 어댑터 소관) ──


@dataclass(frozen=True, slots=True)
class GenerateItineraryRequest:
    """일정 생성 요청 (agent-io-contracts §1.2 ScheduleAgentInput의 도메인 형태).

    day1 2단계 생성(TRIP-293): `days`는 전체 여행의 **부분집합**일 수 있고
    `excluded_poi_ids`에 이미 배정된 POI가 실려온다. 도메인이 이미 지원하므로
    조립은 그대로 통과시킨다 — 별도 분기 없음.

    `principal`·`persona_ref` 는 오케스트레이터의 소유 검증(TRIP-333)과 정보 수집이
    소비한다 — 에이전트는 읽지 않는다(페르소나는 이미 실체로 태스크에 실려 온다).
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
    # 설명 생략 요청 (TRIP-479) — 백엔드가 설명을 별도 경계로 병렬 조회할 때 false.
    include_explanations: bool = True
    radius_override_km: float | None = None

    def __post_init__(self) -> None:
        if not self.days:
            raise ValueError("days는 최소 1일")


@dataclass(frozen=True, slots=True)
class ScheduleTask:
    """오케스트레이터 → ScheduleAgent 로 넘어가는 재료 봉투 (v2 §3 "정보는 봉투로만").

    수집(InfoCollector)과 패킷 소화(날씨·행사 → 보정값)는 오케스트레이터가 끝냈다 —
    에이전트는 Provider·InfoCollector 를 모른다(L-4·L-6).
    - `pool`: 후보 풀 실체 (closed-set 의 유일한 출처, INV-1). PlanB 선례와 같이 참조가
      아니라 실체로 받는다.
    - `daily_rain` / `event_bonus`: None = 무보정 (Provider 미등록·정보 없음·수집 실패
      모두 같은 값 — 실패 여부는 `prior_degradations` 가 말한다).
    - `budget` + `started_ms`: 시한 배분과 그 시계 원점. 잔여 = total − (clock − started).
    - `prior_degradations`: 수집·소화 단계에서 오케스트레이터가 이미 밟은 계단 —
      결과 status 계산에 합산된다(침묵 금지, INV-4).
    """

    request: GenerateItineraryRequest
    pool: CandidatePool
    persona: PersonaSummary | None
    daily_rain: dict[date, int] | None
    event_bonus: dict[PoiId, float] | None
    candidates_summary: CandidatesReport
    budget: DeadlineBudget
    started_ms: int
    trace_id: TraceId
    now: datetime
    prior_degradations: tuple[Degradation, ...] = ()


class ScheduleAgent:
    def __init__(
        self,
        scoring_worker: PreferenceScoringWorker,
        assembly_provider: AssemblyProvider,
        clock: Clock,
        trace: TracePort,
        *,
        explanation_worker: ExplanationWorker | None = None,
        config: OrchestratorConfig | None = None,
    ) -> None:
        self._scoring = scoring_worker
        self._assembly_provider = assembly_provider
        self._clock = clock
        self._trace = trace
        self._explainer = explanation_worker  # 미주입이면 설명 단계를 통째로 건너뛴다
        self._cfg = config or OrchestratorConfig()  # c1_min_ms·explanation_min_ms 만 읽는다

    # ── 공개 API ────────────────────────────────────────────────────

    def run(self, task: ScheduleTask) -> GenerationOutcome:
        """재료 → 일정. 예외를 던지지 않는다 (INV-4 · DL-5 — 결과 또는 명시적 실패)."""
        try:
            return self._generate(task)
        except PermissionDeniedError as e:
            # 권한 위반은 폴백 대상이 아니다 — 규칙 점수로 조용히 내려가면 남의 페르소나
            # 없이 "성공한 척"하게 된다. 부분 성공 0. 현재는 도달 경로가 없다(오케스트레이터
            # ⓪이 먼저 막고, 워커는 페르소나를 값으로 받아 재조회하지 않는다) — 미래의
            # 재조회 경로가 생겨도 403 계약이 유지되도록 남긴다.
            return self._failed(task, f"permission_denied: {e}")
        except Exception as e:
            return self._failed(
                task, f"schedule_agent_error: {type(e).__name__}: {e}"
            )

    # ── 조립 (services.md §1.1 정상 경로 순서 ②~⑤) ──────────────────

    def _generate(self, task: ScheduleTask) -> GenerationOutcome:
        request, pool, persona, budget = task.request, task.pool, task.persona, task.budget
        t0, trace_id, now = task.started_ms, task.trace_id, task.now
        steps: list[Degradation] = list(task.prior_degradations)

        # ② 게이트웨이 선호 점수 (전 일자 공용 1회) — 실패·스킵이면 규칙 점수 (INV-4)
        elapsed = self._clock.monotonic_ms() - t0
        candidates, mode = self._score(
            request, pool, persona, budget, budget.total_ms - elapsed, steps,
            trace_id, now,
        )

        # ③ ItineraryProblem 조립 — 후보는 풀에서 나온 것만 (INV-1).
        #    날씨(TRIP-383)·행사 보너스(TRIP-421)는 오케스트레이터가 패킷을 소화해
        #    넘긴 값 — 어셈블리 소프트 항으로만 들어간다 (None = 무보정).
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
            daily_rain_prob=task.daily_rain,
            event_bonus=task.event_bonus,
        )

        # ④ 어셈블리 solve — 잔여 **전부**를 받는다 (고정 슬라이스 아님, TRIP-376).
        #    앞 단계가 일찍 끝나면 그만큼 더 받고(2차에서 점수 4s면 어셈블리 ~15s),
        #    상한 밖 소모(풀 초과 등)가 있어도 바닥 아래로는 내려가지 않는다.
        #    OR-Tools는 anytime — 잔여 시간이 곧 최적성이고 해 자체는 나온다.
        #    체인 폴백(OR-Tools→LLM→규칙→최소)은 어셈블리가 이미 갖고 있다. 여기서
        #    재시도·재조립을 얹으면 이중 폴백이 되어 시한만 두 배로 쓴다 — 하지 않는다.
        c2_ms = max(
            budget.c2_reserved_ms, budget.total_ms - (self._clock.monotonic_ms() - t0)
        )
        assembly = self._assembly_provider.for_pool({p.poi_id: p for p in pool.pois})
        try:
            solution = assembly.solve(problem, c2_ms, trace_id)
        except AssemblyConflictError as e:
            # 모순 입력(겹치는 고정 블록 등) — 시한 문제가 아니라 d08 흐름. 명시적 실패.
            self._observe(trace_id, now, "assembly", "assembly", "(none)",
                          f"assembly_conflict: {e}")
            return self._failed(task, f"assembly_conflict: {e}",
                                emit=False, scoring_mode=mode,
                                candidate_count=len(candidates))
        # 어셈블리 검증 완료 시각 — 주입된 now + 단조시계 경과 (wall-clock 직접 호출 금지).
        solved_at = now + timedelta(milliseconds=self._clock.monotonic_ms() - t0)
        if solution.is_fallback:
            # 어셈블리 퍼사드가 강등 사유를 이미 FallbackEvent로 남겼다 — 결과에만 싣는다.
            steps.append(Degradation(
                stage="assembly", reason=f"assembly_degraded:{solution.solve_mode.value}"
            ))

        # ⑤ (선택) 설명 부착 — 실패해도 일정은 그대로 나간다
        explanations = self._explain(
            request, pool, persona, solution, budget, t0, steps, trace_id, now
        )

        return GenerationOutcome(
            status=(GenerationStatus.DEGRADED if steps else GenerationStatus.SUCCESS),
            solution=solution,
            scoring_mode=mode,
            explanations=explanations,
            degradations=tuple(steps),
            candidate_count=len(candidates),
            budget=budget,
            candidates_summary=task.candidates_summary,
            solved_at=solved_at,
        )

    # ── ② 선호 점수 + 규칙 점수 폴백 ────────────────────────────────

    def _score(
        self,
        request: GenerateItineraryRequest,
        pool: CandidatePool,
        persona: PersonaSummary | None,
        budget: DeadlineBudget,
        remaining_ms: int,
        steps: list[Degradation],
        trace_id: TraceId,
        now: datetime,
    ) -> tuple[tuple[ScoredPoi, ...], ScoringMode]:
        """BR-U4-09가 말하는 "규칙 점수 실행은 호출측 몫"의 그 호출측.

        게이트웨이는 신호(`TypedResult.is_fallback`)만 내고 실행하지 않는다 — 실행은 여기서
        `assembly_engine.scorer.build_rule_score`로 한다 (게이트웨이는 어셈블리를 import할 수
        없다: 경계 규칙).
        """
        if not pool.pois:
            # 후보 0건 — LLM을 부를 이유가 없다. 최소 일정으로 수렴하는 정상 경로.
            self._degrade(steps, trace_id, now, "llm", "llm_score", "rule_score",
                          "empty_pool")
            return (), ScoringMode.RULE

        if budget.c1_ms < self._cfg.c1_min_ms or remaining_ms <= 0:
            # DL-2: 진입 전 잔여 확인 — 부를 시간이 없으면 부르지 않는다(침묵 스킵 금지).
            # 이 경로는 페르소나를 읽지 않지만, 소유 검증은 이미 오케스트레이터 ⓪에서
            # 끝났다(TRIP-333 fail-closed) — 남의 persona_ref는 여기 도달하지 못한다.
            self._degrade(steps, trace_id, now, "llm", "llm_score", "rule_score",
                          f"deadline:c1_budget={budget.c1_ms}ms")
            return self._rule_scores(request, pool), ScoringMode.RULE

        if persona is None:
            # 페르소나 비가용(COLD_START 등) — 취향 없이 LLM 점수는 의미가 없다.
            # 규칙 점수로 강등 (INV-4 침묵 금지 — 사유는 PERSONA 패킷이 이미 안다).
            self._degrade(steps, trace_id, now, "llm", "llm_score", "rule_score",
                          "persona_unavailable")
            return self._rule_scores(request, pool), ScoringMode.RULE

        try:
            # 단계 상한이 게이트웨이 호출 타임아웃까지 **관통**한다 (TRIP-376) —
            # 상한만 늘리고 호출 시한이 고정 2.5s로 남으면 실호출(바닥 ~3s,
            # TRIP-373 실측)이 먼저 잘려 상향이 무의미하다. 어셈블리 llm_assembler와
            # 같은 min(상한, 잔여) 패턴.
            result = self._scoring.score(
                pool, persona, trace_id, now,
                timeout_sec=min(budget.c1_ms, remaining_ms) / 1000.0,
            )
        except Exception as e:
            # 워커가 게이트웨이 밖에서 터진 경우(설정 버그 등) — 게이트웨이는
            # 이벤트를 낼 기회가 없었으므로 여기서 낸다. 권한 위반은 오케스트레이터
            # ⓪과 수집 단계(PersonaProvider)에서 이미 예외로 승격됐다 — 여기 도달 불가.
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
            # 규칙 점수 실행은 호출측 소유(BR-U4-09)고, 보충은 에이전트
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
        persona: PersonaSummary | None,
        solution: ItinerarySolution,
        budget: DeadlineBudget,
        t0: int,
        steps: list[Degradation],
        trace_id: TraceId,
        now: datetime,
    ) -> tuple[PoiExplanation, ...]:
        if not request.include_explanations:
            return ()  # 요청된 생략 (TRIP-479) — 강등이 아니다 (별도 경계로 조회)
        if self._explainer is None:
            return ()  # 미배선 = 기능 부재이지 실패가 아니다 (강등으로 세지 않는다)
        if persona is None:
            # 페르소나 비가용 — 취향 근거 없는 설명은 지어내기다. 스킵 + 강등 기록.
            self._degrade(steps, trace_id, now, "explanation", "llm_explain",
                          "(none)", "persona_unavailable")
            return ()

        seen: set[PoiId] = set()
        ordered: list[PoiId] = []
        for day in solution.days:
            for slot in day.slots:  # 어셈블리가 정한 순서 그대로 (INV-2)
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
                pool, tuple(ordered), persona, trace_id, now,
                # 잔여 예산이 호출 타임아웃까지 관통 (TRIP-381, 점수 단계와 같은
                # 패턴) — 미관통이면 게이트웨이 기본 2.5s가 잔여(예: 300ms든
                # 9s든)를 무시하고, SDK 내부 재시도까지 겹치면 2.5s 설정이 실제
                # ~10s를 소모했다(계측 실측 — 20s 계약 초과의 후반부 정체).
                timeout_sec=remaining / 1000.0,
            )
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
        task: ScheduleTask,
        error: str,
        *,
        emit: bool = True,
        scoring_mode: ScoringMode = ScoringMode.RULE,
        candidate_count: int = 0,
    ) -> GenerationOutcome:
        if emit:  # 예외 경로도 반드시 흔적을 남긴다 (침묵 실패 금지)
            self._observe(task.trace_id, task.now, "agent", "generate", "(none)", error)
        return failed_outcome(
            task.budget, error,
            scoring_mode=scoring_mode,
            candidate_count=candidate_count,
            candidates_summary=task.candidates_summary,  # 풀은 이미 안다
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
        """에이전트가 **스스로 내린** 강등 — 결과에 싣고 이벤트도 발행한다."""
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
