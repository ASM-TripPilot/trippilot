"""오케스트레이터 실배선 — 조립 전용 모듈 (U5-05, TRIP-241).

역할은 둘뿐이다:
1. 실 구성요소(M7 CandidatePoolBuilder · C1 게이트웨이+워커 · C2 HybridSolverFacade)로
   `ItineraryOrchestrator`(TRIP-237)를 조립한다. **외부 의존(LLM·POI DB·컨텍스트 저장소)은
   전부 인자**다 — 지금은 fake를 꽂고, 실 어댑터가 생기면 그 인자만 바뀐다.
2. API Protocol(`api/protocols.py`)과 실 오케스트레이터의 간극을 어댑터로 메운다.
   오케스트레이터·protocols·routes·schemas는 수정하지 않는다.

Protocol ↔ 실 오케스트레이터 간극과 어댑트 방식:
- 시그니처: Protocol `generate(request)` ↔ 실물 `generate(domain_req, deadline_ms,
  trace_id, now)` → 경계 스키마를 도메인 요청으로 번역하고 deadline·trace·now는
  `request_meta`(IO-1)에서 뽑는다.
- 반환형: `GenerationOutcome` ↔ `ItineraryOutcome` 봉투 → `WiredOutcome`으로 감싼다.
  FAILED는 봉투가 아니라 **예외**로 승격한다(errors.map_exception이 409/403/500으로
  번역 — 200으로 위장하면 백엔드가 폴백하지 않는다, PR #104).
- validate/repair: 실 오케스트레이터에 없다 → C2 공개 경계(`HybridSolverFacade`)로
  직접 배선한다. 와이어 일정(ItineraryPayload)을 도메인 해로 복원해 검증·수리한다.
- `RepairResult.changes`는 `RepairChange` 구조체 → 표시 문자열로 렌더한다(시각만,
  소요시간 미언급 — INV-3).

어댑터로 메우지 **않은** 간극(지어내지 않는다 — null/빈 값이 정직한 값):
- `distance_ranges`·`freshness`·`candidates_summary`·`day1_ready_at`: 실 오케스트레이터가
  산출하지 않는다 → 와이어에 null/빈 매핑으로 나간다(스키마 허용).
- 와이어 `preference_profile`은 현 경로에서 미소비: 프롬프트 입력은 요청자 권한 하에
  **재조회한 값만** 쓴다(D31) — 페르소나는 주입된 `ContextStore`가 공급한다. 와이어에
  사용자 식별자가 없어 principal은 trip_id 파생 임시값이다(실 어댑터 시 백엔드 합의 필요).
- validate/repair 와이어에는 원 문제 컨텍스트(이동수단·day window)가 없다 → 기본값
  (PUBLIC · 당일 00:00~23:59)으로 판정한다. HC4는 원 창을 모르므로 보수적이다.
"""

from __future__ import annotations

import logging
import os
import time
import zlib
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Mapping, Sequence

from fastapi import FastAPI

from trippilot.api import schemas
from trippilot.api.app import create_app
from trippilot.c1.config import C1Config
from trippilot.c1.context import ContextResolver, ContextStore
from trippilot.c1.gates.explanation import ExplanationGate
from trippilot.c1.gates.scoring import ClosedSetGate
from trippilot.c1.gateway import GatewayFacade
from trippilot.c1.prompts import PromptRegistry
from trippilot.c1.workers.explanation import ExplanationWorker
from trippilot.c1.workers.preference import PreferenceScoringWorker
from trippilot.c2.config import SolverConfig
from trippilot.c2.facade import HybridSolverFacade, SolverConflictError
from trippilot.c2.fallback_solver import RuleFallbackSolver
from trippilot.c2.ortools_solver import OrToolsSolver
from trippilot.c2.repair import RepairChange
from trippilot.c2.travel import TravelEstimator, haversine_km
from trippilot.domain.common import (
    BudgetLevel,
    GeoPoint,
    PoiId,
    ScheduleId,
    TraceId,
    TransportMode,
)
from trippilot.domain.context import PermissionDeniedError, Principal, ResourceRef
from trippilot.domain.freshness import FreshnessMeta
from trippilot.domain.itinerary import (
    DaySolution,
    FixedBlock,
    ItineraryProblem,
    ItinerarySolution,
    SolveMode,
    TimeWindow,
    Violation,
    VisitSlot,
)
from trippilot.domain.llm import ModelTier, PoiExplanation
from trippilot.domain.persona import CompanionType, PersonaSummary
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.m7.config import M7Config
from trippilot.m7.pool_builder import CandidatePoolBuilder
from trippilot.orchestrator import itinerary_orchestrator as core
from trippilot.ports.llm_port import LlmPort, LlmRequest, LlmResponse
from trippilot.ports.trace_port import TracePort

_logger = logging.getLogger("trippilot.wiring")

# 백엔드 와이어의 날짜·시각은 tz 미표기 로컬(KST) — 도메인은 tz-aware만 받으므로
# 조립 경계에서 KST를 부여한다(백엔드 Jackson LocalDate/LocalTime 직렬화 대응).
KST = timezone(timedelta(hours=9))

_PROMPTS_ROOT = Path(__file__).resolve().parents[3] / "prompts"

# 경계 어휘 → 도메인 enum 번역표 (결정론 — 소프트 입력이라 미인식은 기본값 폴백).
_BUDGET_TOKENS: Mapping[str, BudgetLevel] = {
    "LOW": BudgetLevel.LOW, "저렴": BudgetLevel.LOW, "낮음": BudgetLevel.LOW,
    "MID": BudgetLevel.MID, "MIDDLE": BudgetLevel.MID,
    "중간": BudgetLevel.MID, "보통": BudgetLevel.MID,
    "HIGH": BudgetLevel.HIGH, "높음": BudgetLevel.HIGH,
    "고급": BudgetLevel.HIGH, "프리미엄": BudgetLevel.HIGH,
}
_TRANSPORT_TOKENS: Mapping[str, TransportMode] = {
    "WALK": TransportMode.WALK, "도보": TransportMode.WALK,
    "PUBLIC": TransportMode.PUBLIC, "대중교통": TransportMode.PUBLIC,
    "CAR": TransportMode.CAR, "자가용": TransportMode.CAR,
    "자동차": TransportMode.CAR, "렌터카": TransportMode.CAR,
}
_DEFAULT_DWELL_MIN = 60  # dwell_min 미지정 고정 블록의 기본 체류(분) — 계약 예시값

# 백엔드 `toWire()`(ScheduleAgentWire.kt)는 저장 일정을 되돌려 보낼 때 자기 도메인
# 어휘(FULL_AI|DETERMINISTIC|MINIMAL)로 회신한다 — 수신부가 비대칭 흡수한다(TRIP-342).
# AI 4값은 그대로 통과, 그 외 미지 값은 SolveMode() ValueError→422 (무한 관대 금지).
_BACKEND_SOLVE_MODES: Mapping[str, SolveMode] = {
    "FULL_AI": SolveMode.OR_TOOLS,
    "DETERMINISTIC": SolveMode.RULE_FALLBACK,
    "MINIMAL": SolveMode.MINIMAL,
}


def _solve_mode_from(token: str) -> SolveMode:
    mapped = _BACKEND_SOLVE_MODES.get(token)
    return mapped if mapped is not None else SolveMode(token)


# ── 실 콘센트 기본 구현 (외부 API 아님 — 조립 루트 소유) ──────────────


class MonotonicClock:
    """실 단조 시계 — wall-clock 직접 호출 금지(DL-3)의 콘센트 구현."""

    def monotonic_ms(self) -> int:
        return time.monotonic_ns() // 1_000_000


class LoggingTrace:
    """TracePort — 구조화 로그 발행(실 OTel/CloudWatch 어댑터 전 단계).

    emit은 절대 예외를 밖으로 던지지 않는다(계측 실패 ≠ 비즈니스 실패).
    """

    def emit(self, event: object) -> None:
        try:
            _logger.info("trace_event %s", event)
        except Exception:
            pass


# ── 와이어 → 도메인 번역 (generate) ──────────────────────────────────


def _tz_aware(value: datetime, tz: timezone) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=tz)


def _budget_from(request: schemas.GenerateItineraryRequest) -> BudgetLevel:
    for text in (request.trip_context.budget_level,
                 request.preference_profile.budget_tier):
        if text:
            level = _BUDGET_TOKENS.get(text.strip().upper())
            if level is not None:
                return level
    return BudgetLevel.MID  # 소프트 제약 — 미인식은 중간 예산 (배제 아님)


def _transport_from(request: schemas.GenerateItineraryRequest) -> TransportMode:
    for text in request.preference_profile.transport_modes:
        mode = _TRANSPORT_TOKENS.get(text.strip().upper())
        if mode is not None:
            return mode
    return TransportMode.PUBLIC


def _seed_from(trip_id: str) -> int:
    """같은 여행 → 같은 시드 (재생성 멱등, U5-P2). 프로세스·플랫폼 무관 결정론."""
    return zlib.crc32(trip_id.encode("utf-8"))


def _fixed_block(block: schemas.FixedBlockSchema, tz: timezone) -> FixedBlock:
    if block.date is None or block.start is None:
        # 도메인 FixedBlock(HC3)은 시각 고정만 표현한다 — ANYTIME 필수방문을 조용히
        # 떨어뜨리면 사용자 지정이 침묵 소실된다(INV-4) → 명시 실패(422)로 드러낸다.
        raise ValueError(
            f"ANYTIME 고정 블록 미지원: {block.poi_id} — "
            "시각 미지정 필수방문은 현 도메인(HC3)으로 표현 불가"
        )
    dwell = block.dwell_min if block.dwell_min is not None else _DEFAULT_DWELL_MIN
    start = datetime.combine(block.date, block.start, tzinfo=tz)
    return FixedBlock(
        poi_id=PoiId(block.poi_id),
        window=TimeWindow(start=start, end=start + timedelta(minutes=dwell)),
        reason="user_fixed",
    )


def _domain_generate_request(
    request: schemas.GenerateItineraryRequest, tz: timezone
) -> core.GenerateItineraryRequest:
    if not request.anchors:
        raise ValueError("anchors 최소 1개 필요 — 후보 풀 기준점(숙소 앵커) 없음")
    anchor_schema = min(request.anchors, key=lambda a: a.date)
    days = tuple(sorted({w.date for w in request.time_windows}))
    # 도메인 day_window는 전 일자 공용 1개(시각 성분만 쓰인다) — 첫 일자의 창을 채택.
    first_window = min(request.time_windows, key=lambda w: w.date)
    day_window = TimeWindow(
        start=datetime.combine(days[0], first_window.start, tzinfo=tz),
        end=datetime.combine(days[0], first_window.end, tzinfo=tz),
    )
    # 와이어에 사용자 식별자가 없다 — trip_id 파생 principal로 소유자 검사(D31)를
    # 자기 참조로 통과시키고, 페르소나 실체는 주입된 ContextStore가 공급한다.
    owner = f"trip:{request.trip_id}"
    return core.GenerateItineraryRequest(
        schedule_id=ScheduleId(request.trip_id),
        anchor=GeoPoint(anchor_schema.lat, anchor_schema.lng),
        days=days,
        day_window=day_window,
        budget=_budget_from(request),
        transport=_transport_from(request),
        persona_ref=ResourceRef(kind="persona", ref_id=request.trip_id, owner_id=owner),
        principal=Principal(user_id=owner),
        seed=_seed_from(request.trip_id),
        fixed_blocks=tuple(_fixed_block(b, tz) for b in request.fixed_blocks),
        excluded_poi_ids=frozenset(PoiId(x) for x in request.excluded_poi_ids),
    )


# ── Protocol 봉투 (api/protocols.py 구조 충족) ───────────────────────


@dataclass(frozen=True, slots=True)
class WiredOutcome:
    """`ItineraryOutcome` Protocol 충족 봉투 — 키 규약은 `"{date}#{poi_id}"`(BR-U2-04)."""

    solution: ItinerarySolution
    explanations: Mapping[str, str]
    distance_ranges: Mapping[str, str]
    freshness: FreshnessMeta | None
    candidates_summary: None
    day1_ready_at: datetime | None


@dataclass(frozen=True, slots=True)
class WiredRepairOutcome:
    """`RepairOutcome` Protocol 충족 봉투. `repaired=None` = 수리 불가(정상, IO-7)."""

    repaired: WiredOutcome | None
    changes: tuple[str, ...]


def _keyed_explanations(
    solution: ItinerarySolution, explanations: tuple[PoiExplanation, ...]
) -> dict[str, str]:
    first_date: dict[PoiId, date] = {}
    for day in solution.days:
        for slot in day.slots:
            first_date.setdefault(slot.poi_id, day.date)
    keyed: dict[str, str] = {}
    for exp in explanations:
        placed_on = first_date.get(exp.poi_id)
        if placed_on is None:
            continue  # 배치되지 않은 POI의 설명은 표시 대상이 아니다
        keyed[f"{placed_on.isoformat()}#{exp.poi_id}"] = exp.text
    return keyed


def _envelope(solution: ItinerarySolution,
              explanations: tuple[PoiExplanation, ...] = ()) -> WiredOutcome:
    return WiredOutcome(
        solution=solution,
        explanations=_keyed_explanations(solution, explanations),
        distance_ranges={},  # 미산출 — 슬롯 distance_range는 null 사영(지어내지 않는다)
        freshness=None,
        candidates_summary=None,
        day1_ready_at=None,
    )


def _failure_exception(error: str) -> Exception:
    """FAILED(GenerationOutcome) → 경계 예외. errors.map_exception이 상태코드로 번역.

    오케스트레이터는 예외를 삼켜 문자열로 수렴시키므로(INV-4), 어댑터가 접두사로
    원 유형을 복원한다 — solver_conflict→409(d08), permission_denied→403, 나머지 500.
    """
    if error.startswith("solver_conflict"):
        return SolverConflictError(error)
    if error.startswith("permission_denied"):
        return PermissionDeniedError(error)
    return RuntimeError(error)


def _render_change(change: RepairChange) -> str:
    """RepairChange 구조체 → 표시 문자열. 시각만 — 소요시간 미언급(INV-3)."""
    return (f"{change.poi_id} {change.field} "
            f"{change.before:%H:%M} → {change.after:%H:%M}")


# ── validate/repair — 와이어 일정 복원 ───────────────────────────────


def _solution_from_payload(
    payload: schemas.ItineraryPayload, schedule_id: ScheduleId, tz: timezone
) -> ItinerarySolution:
    """ItineraryPayload → 도메인 해. 도메인 불변식 위반(역순 슬롯 등)은 ValueError→422."""
    days: list[DaySolution] = []
    for day_schema in payload.days:
        slots: list[VisitSlot] = []
        day_fixed: list[FixedBlock] = []
        for slot_schema in day_schema.slots:
            start = datetime.combine(day_schema.date, slot_schema.start_at, tzinfo=tz)
            end_date = (day_schema.date + timedelta(days=1)
                        if slot_schema.ends_next_day else day_schema.date)
            end = datetime.combine(end_date, slot_schema.end_at, tzinfo=tz)
            stay = int((end - start).total_seconds() // 60)
            slots.append(VisitSlot(
                poi_id=PoiId(slot_schema.poi_id), start_at=start, end_at=end,
                # 내부 필드(score·is_llm_score)는 와이어에 없다(IO-3) — 중립값 복원.
                stay_min=stay, score=0.0, is_llm_score=False,
            ))
            if slot_schema.is_fixed:
                day_fixed.append(FixedBlock(
                    poi_id=PoiId(slot_schema.poi_id),
                    window=TimeWindow(start=start, end=end),
                    reason="wire_fixed",
                ))
        days.append(DaySolution(
            date=day_schema.date, slots=tuple(slots), fixed_blocks=tuple(day_fixed)
        ))
    return ItinerarySolution(
        schedule_id=schedule_id,
        days=tuple(days),
        is_fallback=payload.is_fallback,
        solve_mode=_solve_mode_from(payload.solve_mode),
        solver_run=None,
    )


def _problem_for(solution: ItinerarySolution, tz: timezone) -> ItineraryProblem:
    """검증·수리용 문제 재구성. 와이어에 없는 원 컨텍스트는 **기본값**으로 채운다.

    - transport=PUBLIC · day_window=당일 00:00~23:59: 와이어에 원값이 없다(간극 —
      HC2·HC4 판정이 원 요청과 다를 수 있음). 자정 초과 슬롯은 HC4로 표시될 수 있다
      (HC4 정본도 "시작일 창 귀속"이라 방향은 같다).
    - candidates=(): validate/repair는 POI를 재선택하지 않는다 — HC 판정에 미사용.
    - fixed_blocks: 와이어 `is_fixed` 슬롯을 그대로 승격 — repair가 이를 고정(HC3)한다.
    """
    if not solution.days:
        raise ValueError("itinerary.days 비어있음 — 검증할 일정이 없다")
    first = solution.days[0].date
    return ItineraryProblem(
        schedule_id=solution.schedule_id,
        days=tuple(day.date for day in solution.days),
        candidates=(),
        fixed_blocks=tuple(fb for day in solution.days for fb in day.fixed_blocks),
        budget=BudgetLevel.MID,
        transport=TransportMode.PUBLIC,
        day_window=TimeWindow(
            start=datetime.combine(first, datetime.min.time(), tzinfo=tz),
            end=datetime.combine(first, datetime.min.time(), tzinfo=tz)
            + timedelta(hours=23, minutes=59),
        ),
        seed=0,
        anchor=None,
    )


# ── C2 체인 조립 (요청 스코프) ───────────────────────────────────────


class ChainSolverProvider:
    """SolverProvider — 풀이 요청마다 다르므로 퍼사드를 요청 스코프로 조립한다.

    체인 = OR-Tools(1차) → 규칙 폴백(최후 보루, required_ms=0 — INV-4 구조 보장).
    LLM 2차 단계(LlmSolver)는 미배선: 솔버 프롬프트 정본·모델 설정이 아직 없다 —
    실 LLM 어댑터와 함께 붙인다(빠진 단계는 체인 강등이 아니라 기능 부재).
    """

    def __init__(self, estimator: TravelEstimator, clock: core.Clock,
                 trace: TracePort, config: SolverConfig) -> None:
        self._est = estimator
        self._clock = clock
        self._trace = trace
        self._cfg = config

    def for_pool(self, poi_index: Mapping[PoiId, Poi]) -> HybridSolverFacade:
        stages = (
            OrToolsSolver(poi_index, self._est, self._cfg),
            RuleFallbackSolver(poi_index, self._est, self._cfg),
        )
        return HybridSolverFacade(stages, poi_index, self._est, self._clock, self._trace)


# ── 경계 어댑터 (api/protocols.ItineraryOrchestrator 충족) ───────────


class WiredItineraryOrchestrator:
    """실 오케스트레이터·C2 퍼사드를 API Protocol 모양으로 감싸는 경계 어댑터."""

    def __init__(
        self,
        orchestrator: core.ItineraryOrchestrator,
        solver_provider: ChainSolverProvider,
        poi_db: object,
        tz: timezone = KST,
    ) -> None:
        self._orchestrator = orchestrator
        self._solvers = solver_provider
        self._poi_db = poi_db
        self._tz = tz

    # Protocol: generate(request) — deadline·trace·now는 request_meta(IO-1)에서.
    def generate(self, request: schemas.GenerateItineraryRequest) -> WiredOutcome:
        meta = request.request_meta
        outcome = self._orchestrator.generate(
            _domain_generate_request(request, self._tz),
            meta.deadline_ms,
            TraceId(meta.request_id),
            _tz_aware(meta.requested_at, self._tz),
        )
        if outcome.status is core.GenerationStatus.FAILED:
            raise _failure_exception(outcome.error or "unknown_failure")
        assert outcome.solution is not None  # GenerationOutcome 불변식(FAILED⇔None)
        return _envelope(outcome.solution, outcome.explanations)

    def validate(
        self, request: schemas.ValidateItineraryRequest
    ) -> Sequence[Violation]:
        solution, problem, poi_index = self._reconstruct(
            request.itinerary, request.request_meta
        )
        facade = self._solvers.for_pool(poi_index)
        return facade.validate(
            solution, problem, request.request_meta.deadline_ms,
            TraceId(request.request_meta.request_id),
        )

    def repair(self, request: schemas.RepairItineraryRequest) -> WiredRepairOutcome:
        solution, problem, poi_index = self._reconstruct(
            request.itinerary, request.request_meta
        )
        facade = self._solvers.for_pool(poi_index)
        result = facade.repair(
            solution, problem, request.request_meta.deadline_ms,
            TraceId(request.request_meta.request_id),
        )
        return WiredRepairOutcome(
            repaired=_envelope(result.repaired) if result.repaired is not None else None,
            changes=tuple(_render_change(c) for c in result.changes),
        )

    def _reconstruct(
        self, payload: schemas.ItineraryPayload, meta: schemas.RequestMetaSchema
    ) -> tuple[ItinerarySolution, ItineraryProblem, dict[PoiId, Poi]]:
        solution = _solution_from_payload(payload, ScheduleId(meta.request_id), self._tz)
        problem = _problem_for(solution, self._tz)
        ids = frozenset(s.poi_id for day in solution.days for s in day.slots)
        # 미등록 POI는 인덱스에 없다 → HC1·HC2 미적용("정보 없음은 막지 않는다", c2 규칙)
        poi_index = {p.poi_id: p for p in self._poi_db.find_by_ids(ids)}
        return solution, problem, poi_index


# ── 조립 함수 (composition root) ─────────────────────────────────────


def build_orchestrator(
    *,
    llm: LlmPort,
    poi_db: object,
    context_store: ContextStore,
    c1_config: C1Config,
    m7_config: M7Config | None = None,
    solver_config: SolverConfig | None = None,
    orchestrator_config: core.OrchestratorConfig | None = None,
    clock: core.Clock | None = None,
    trace: TracePort | None = None,
    prompts_root: Path | None = None,
    tz: timezone = KST,
) -> WiredItineraryOrchestrator:
    """실 구성요소 조립 → `create_app(orchestrator=...)`에 꽂을 어댑터.

    외부 의존(llm·poi_db·context_store)은 전부 인자 — 실 어댑터 등장 시 그 인자만
    바뀐다. c1_config는 model_id 하드코딩 금지(BR-U4-08) 때문에 기본값이 없다.
    """
    clock = clock if clock is not None else MonotonicClock()
    trace = trace if trace is not None else LoggingTrace()
    scfg = solver_config if solver_config is not None else SolverConfig()
    renderer = PromptRegistry(prompts_root if prompts_root is not None else _PROMPTS_ROOT)
    resolver = ContextResolver(context_store)
    estimator = TravelEstimator(scfg)
    provider = ChainSolverProvider(estimator, clock, trace, scfg)
    orchestrator = core.ItineraryOrchestrator(
        CandidatePoolBuilder(poi_db, m7_config if m7_config is not None else M7Config()),
        PreferenceScoringWorker(
            GatewayFacade(llm, renderer, ClosedSetGate(), c1_config, trace), resolver
        ),
        provider,
        clock,
        trace,
        explanation_worker=ExplanationWorker(
            GatewayFacade(llm, renderer, ExplanationGate(), c1_config, trace), resolver
        ),
        config=orchestrator_config,
    )
    return WiredItineraryOrchestrator(orchestrator, provider, poi_db, tz=tz)


# ── 로컬·스모크 조립 (in-memory fake — 실 DB·실 LLM 호출 0, D37) ─────


# 제주 — 데모 시드의 기준점(흑돼지거리·한라산의 중간점: 둘 다 PUBLIC 반경 10km 안).
# 성산일출봉·월정리는 반경 밖 — 후보풀 반경 필터가 실제로 일하는 배치다.
DEMO_ANCHOR = GeoPoint(33.4362, 126.5255)


class UnwiredLlm:
    """실 LLM 미배선 명시 실패 — 게이트웨이가 규칙 점수 폴백 신호로 수렴시킨다(INV-4).

    가짜 성공 응답을 지어내지 않는다(D37: CI·로컬 실 호출 0 — 실 어댑터는 c1/adapters).
    """

    def invoke(self, request: LlmRequest) -> LlmResponse:
        raise RuntimeError("실 LLM 미배선 — 규칙 점수 폴백 (D37)")


class StaticPersonaStore:
    """ContextStore — 모든 persona ref에 동일 요약 반환(로컬·테스트 조립용).

    실 어댑터(백엔드 재조회, D31)가 생기면 이 자리를 대체한다.
    """

    def __init__(self, persona: PersonaSummary) -> None:
        self._persona = persona

    def get(self, ref: ResourceRef) -> PersonaSummary:
        return self._persona


class StaticPoiDb:
    """PoiDbPort 중 배선이 쓰는 2메서드의 인메모리 구현(로컬 스모크용, 결정론)."""

    def __init__(self, seed: tuple[Poi, ...]) -> None:
        self._store: dict[PoiId, Poi] = {p.poi_id: p for p in seed}

    def find_by_radius(self, center: GeoPoint, radius_km: float) -> tuple[Poi, ...]:
        return tuple(
            self._store[k] for k in sorted(self._store, key=str)
            if haversine_km(center, self._store[k].coord) <= radius_km
        )

    def find_by_ids(self, ids: frozenset[PoiId]) -> tuple[Poi, ...]:
        return tuple(
            self._store[i] for i in sorted(ids, key=str) if i in self._store
        )


# 백엔드 시드 `backend/.../db/migration/R__seed_stub_pois.sql` 미러 (TRIP-344, 감사 F2).
# poi_id가 백엔드 poi 테이블의 UUID와 다르면 백엔드 `AiSlot.poiId`(UUID) 역직렬화가
# 실패하고 후속 조인·확정이 전부 깨진다 — id·이름·좌표·카테고리를 그대로 옮긴다.
# 카테고리는 boundaryCode 한→영 번역표(domain/poi.py): 자연=NATURE·맛집=FOOD·카페=CAFE.
_BACKEND_SEED_ROWS: tuple[tuple[str, str, PoiCategory, float, float], ...] = (
    ("e0000000-0000-4000-8000-000000000001", "성산일출봉",
     PoiCategory.NATURE, 33.4587, 126.9427),
    ("e0000000-0000-4000-8000-000000000002", "제주 흑돼지거리",
     PoiCategory.FOOD, 33.5108, 126.5219),
    ("e0000000-0000-4000-8000-000000000003", "월정리 카페거리",
     PoiCategory.CAFE, 33.5563, 126.7960),
    ("e0000000-0000-4000-8000-000000000004", "한라산",
     PoiCategory.NATURE, 33.3617, 126.5292),
)


def demo_poi_seed() -> tuple[Poi, ...]:
    """로컬 스모크 시드 4건 — 백엔드 R__seed_stub_pois.sql 과 id·이름·좌표·카테고리 일치.

    백엔드 시드에 없는 필드는 데모용 값이다(지어낸 값): rating=4.0 은 자리표시자,
    open_hours=() 는 정보 없음(HC1 미적용·순위 강등만), avg_cost=None 은 예산 필터 통과.
    """
    return tuple(
        Poi(
            poi_id=PoiId(poi_id),
            name=name,
            category=category,
            coord=GeoPoint(lat, lng),
            open_hours=(),
            avg_cost=None,
            rating=4.0,
            quality=DataQuality.FULL,
            source=PoiSource.SEED,
            confidence=None,
        )
        for poi_id, name, category, lat, lng in _BACKEND_SEED_ROWS
    )


def build_dev_app(
    *, llm: LlmPort | None = None, model_id: str | None = None
) -> FastAPI:
    """스모크·로컬 개발용 앱 — 기본은 in-memory fake 조립(실 LLM·실 DB 0, D37).

    기본(`llm` 미주입)은 UnwiredLlm — 점수는 항상 규칙 폴백(정직한 강등), 일정은
    OR-Tools가 낸다. `llm` 주입 시 그 어댑터로 실 LLM만 배선한다(TRIP-344 최소 이행분
    — POI·페르소나는 여전히 데모 시드; env 해석·클라이언트 조립은 main.py 소유,
    벤더 SDK는 c1/adapters 한정이라 이 모듈은 LlmPort만 받는다).
    `model_id`는 주입 LLM의 모델 식별자(LIGHT·HEAVY 양 티어 공용, BR-U4-08 주입 원칙).
    """
    if model_id is not None:
        model_ids = {ModelTier.LIGHT: model_id, ModelTier.HEAVY: model_id}
    else:
        model_ids = {
            # 실 모델 아님 — UnwiredLlm용 자리표시자. 실 배선 시 설정 주입(BR-U4-08).
            ModelTier.LIGHT: os.environ.get(
                "TRIPPILOT_MODEL_ID_LIGHT", "dev-unwired-light"),
            ModelTier.HEAVY: os.environ.get(
                "TRIPPILOT_MODEL_ID_HEAVY", "dev-unwired-heavy"),
        }
    orchestrator = build_orchestrator(
        llm=llm if llm is not None else UnwiredLlm(),
        poi_db=StaticPoiDb(demo_poi_seed()),
        context_store=StaticPersonaStore(
            PersonaSummary(taste_tags=(), companion=CompanionType.SOLO,
                           budget=BudgetLevel.MID)
        ),
        c1_config=C1Config(model_ids=model_ids),
    )
    return create_app(orchestrator)
