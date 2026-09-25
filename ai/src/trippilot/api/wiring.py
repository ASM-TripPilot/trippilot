"""오케스트레이터 실배선 — 조립 전용 모듈 (U5-05, TRIP-241).

역할은 둘뿐이다:
1. 실 구성요소(M7 CandidatePoolBuilder · C1 게이트웨이+워커 · C2 HybridAssemblyFacade)로
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
- validate/repair: 실 오케스트레이터에 없다 → C2 공개 경계(`HybridAssemblyFacade`)로
  직접 배선한다. 와이어 일정(ItineraryPayload)을 도메인 해로 복원해 검증·수리한다.
- `RepairResult.changes`는 `RepairChange` 구조체 → 표시 문자열로 렌더한다(시각만,
  소요시간 미언급 — INV-3).

generate 봉투 부가 필드 산출 규칙(TRIP-341 — 코드가 실제로 아는 사실만 채운다):
- `candidates_summary`: 오케스트레이터가 M7 풀 실측으로 만든 `CandidatesReport`를
  그대로 사영한다(BR-U2-05 — 판정은 AI 소유).
- `day1_ready_at`: 오케스트레이터 `solved_at`(주입 now + 단조시계 경과)을, **이 응답이
  여행 1일차(trip_context.start_date)를 포함할 때만** 싣는다 — 2차 생성(나머지 일자)
  응답에 1일차 준비 시각을 지어 싣지 않는다.
- `distance_ranges`: 직전 지점(첫 슬롯=그 날의 앵커, 이후=앞 슬롯 POI 좌표)과의 거리
  표시 문자열(BR-U2-08, "약 1.2km · 도보 추정"). 거리만 — 소요시간류 절대 미포함(INV-3).
  좌표를 모르는 구간(미등록 POI·앵커 없는 날)은 산출하지 않는다.
- `unplaced_must_visits`(TRIP-350): 요청 fixed_blocks **대 응답 해 대조**로만 판정한다
  (어셈블리 내부 무수정 — judge_unplaced_must_visits 참조). 침묵 드롭(TRIP-328) 해소:
  기간 밖 블록은 HC3가 스킵해 200에서 조용히 사라졌었다 — 이제 사유와 함께 회신된다.
  409(해소 불가 모순) 경로는 그대로다 — 이 필드는 200 부분 성공의 보고 채널일 뿐이다.

어댑터로 메우지 **않은** 간극(지어내지 않는다 — null/빈 값이 정직한 값):
- `freshness`: 도메인 `Poi`에 수집 시각 메타가 없다 → 집계 불가, null 유지
  (풀 생성 시각을 수집 시각인 척 싣지 않는다).
- repair 봉투의 `distance_ranges`·`candidates_summary`·`day1_ready_at`: repair 와이어에는
  원 요청 컨텍스트(앵커·이동수단·풀)가 없다 → 기존대로 빈 값/null.
- 와이어 `preference_profile`은 현 경로에서 미소비: 프롬프트 입력은 요청자 권한 하에
  **재조회한 값만** 쓴다(D31) — 페르소나는 주입된 `ContextStore`가 공급한다. 와이어에
  사용자 식별자가 없어 principal은 trip_id 파생 임시값이다(실 어댑터 시 백엔드 합의 필요).
- validate/repair 와이어에는 원 문제 컨텍스트(이동수단·day window)가 없다 → 기본값
  (PUBLIC · 당일 00:00~23:59)으로 판정한다. HC4는 원 창을 모르므로 보수적이다.
"""

from __future__ import annotations

import json
import logging
import pathlib
import os
import time
import zlib
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Mapping, Sequence

from fastapi import FastAPI

from trippilot.api import schemas
from trippilot.api.app import create_app
from trippilot.api.cost import CostLedger
from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.context import ContextResolver, ContextStore
from trippilot.llm_gateway.gates.explanation import ExplanationGate
from trippilot.llm_gateway.gates.reminder_copy import ReminderCopyGate
from trippilot.llm_gateway.gates.scoring import ClosedSetGate
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.llm_gateway.workers.alternative_explanation import (
    AlternativeExplanationWorker,
)
from trippilot.llm_gateway.workers.alternative_selection import AlternativeSelectionWorker
from trippilot.llm_gateway.workers.explanation import ExplanationWorker
from trippilot.llm_gateway.workers.reminder_copy import (
    ReminderCopyInput,
    ReminderCopyItem,
    ReminderCopyWorker,
)
from trippilot.agents.reflect.agent import ReflectAgent, ReflectTask
from trippilot.llm_gateway.gates.reflection_nudge import ReflectionNudgeGate
from trippilot.llm_gateway.gates.reflection_template import ReflectionTemplateGate
from trippilot.llm_gateway.workers.reflection_nudge import (
    FALLBACK_NUDGE_MESSAGE, ReflectionNudgeInput, ReflectionNudgeWorker,
)
from trippilot.llm_gateway.workers.reflection_template import ReflectionTemplateWorker
from trippilot.llm_gateway.gates.share_card_copy import ShareCardCopyGate
from trippilot.llm_gateway.workers.share_card_copy import (
    ShareCardCopyWorker, fallback_share_card_copy,
)
from trippilot.ports.poi_db_port import PoiLookup, PoiMiss, lookup_from
from trippilot.domain.observability import FallbackEvent, LlmCallRecord
from trippilot.domain.reflection import (
    ReflectionKind, ReflectionRequest, SourceEventKind, TripEventRecord,
    VisitRecord, VisitRef,
)
from trippilot.llm_gateway.workers.preference import PreferenceScoringWorker
from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.facade import HybridAssemblyFacade, AssemblyConflictError
from trippilot.assembly_engine.fallback_assembler import RuleFallbackAssembler
from trippilot.assembly_engine.ortools_assembler import OrToolsAssembler
from trippilot.assembly_engine.repair import RepairChange
from trippilot.assembly_engine.travel import TravelEstimator, haversine_km
from trippilot.domain.common import (
    BUDGET_TOKENS,
    PACE_TOKENS,
    BudgetLevel,
    GeoPoint,
    Pace,
    PoiId,
    ScheduleId,
    TraceId,
    TransportMode,
    Rejection,
    RejectionKind,
)
from trippilot.domain.context import PermissionDeniedError, Principal, ResourceRef
from trippilot.domain.freshness import FreshnessMeta
from trippilot.domain.intent import Intent
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
from trippilot.domain.llm import CandidatePool, ModelTier, PoiExplanation
from trippilot.domain.persona import CompanionType, PersonaSummary, TasteTag
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.domain.travel import TravelEstimate
from trippilot.agents.edit.agent import EditAgent, EditOutcome, EditTask
from trippilot.agents.edit.commands import EditStatus
from trippilot.agents.planb.rag import PlanBAgent, PlanBRagRequest, SavedPlace
from trippilot.agents.schedule.agent import ScheduleAgent
from trippilot.agents.planb.directives import (
    DirectiveSpec,
    load_directive_file,
    match_free_text,
    resolve_chips,
)
from trippilot.domain.edit import EditCommand, EditOp
from trippilot.llm_gateway.gates.edit_translation import EditTranslationGate
from trippilot.llm_gateway.workers.edit_translation import EditTranslationWorker
from trippilot.domain.poi_curation import CandidatePoolRequest
from trippilot.domain.trigger import TriggerKind, TriggerParams
from trippilot.llm_gateway.gates.alternative_selection import AlternativeSelectionGate
from trippilot.llm_gateway.workers.preference_cache import CachingScoringWorker
from trippilot.poi_curation.config import M7Config
from trippilot.poi_curation.place_fees import load_fee_table
from trippilot.poi_curation.pool_builder import CandidatePoolBuilder
from trippilot.orchestrator import schedule_coordinator as core
from trippilot.ports.llm_port import LlmPort
from trippilot.ports.llm_port import LlmRequest, LlmResponse
from trippilot.ports.embedding_port import EmbeddingPort
from trippilot.ports.vector_store_port import VectorStorePort
from trippilot.ports.trace_port import TracePort
from trippilot.domain.freshness import InfoPacket, ProviderKind, ProviderStatus
from trippilot.orchestrator.info_collector import InfoCollector
from trippilot.ports.weather_port import WeatherPort
from trippilot.ports.event_port import EventPort
from trippilot.providers.event import EventProvider
from trippilot.providers.persona import PersonaProvider
from trippilot.providers.place import PlaceProvider
from trippilot.providers.weather import WeatherProvider

_logger = logging.getLogger("trippilot.wiring")

# 백엔드 와이어의 날짜·시각은 tz 미표기 로컬(KST) — 도메인은 tz-aware만 받으므로
# 조립 경계에서 KST를 부여한다(백엔드 Jackson LocalDate/LocalTime 직렬화 대응).
KST = timezone(timedelta(hours=9))

_PROMPTS_ROOT = Path(__file__).resolve().parents[3] / "prompts"

# 예산 어휘표는 domain/common 로 옮겼다 — 페르소나 어댑터(BackendPersonaStore)도
# 같은 표를 쓴다. 두 벌이면 한쪽만 고쳐 어긋난다.
_BUDGET_TOKENS = BUDGET_TOKENS

_PACE_TOKENS = PACE_TOKENS
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

    `LlmCallRecord` 에는 비용 줄(`llm_cost`)을 덧붙인다 — 도메인은 토큰만 싣고
    단가는 소비 측이 설정에서 읽는다(`api/cost.py`). 단가 미설정이면 ledger 가
    None 이라 종전과 완전히 같다(비용 0 을 지어내지 않는다).
    """

    def __init__(self, ledger: CostLedger | None = None) -> None:
        # 설정이 깨졌으면 여기서 예외 → 기동 실패 (설정 오류 은폐 금지, main._env 동형)
        self._ledger = ledger if ledger is not None else CostLedger.from_env()

    def emit(self, event: object) -> None:
        try:
            _logger.info("trace_event %s", event)
            if self._ledger is not None and isinstance(event, LlmCallRecord):
                _logger.info(
                    "llm_cost %s",
                    json.dumps(self._ledger.add(event), ensure_ascii=False),
                )
        except Exception:
            pass


# ── 와이어 → 도메인 번역 (generate) ──────────────────────────────────


def _deadline_budget(meta: schemas.RequestMetaSchema) -> int:
    """미지정 deadline = 시간제약 없음(TRIP-473) — 계단에는 무제한 상수를 대입한다."""
    return meta.deadline_ms if meta.deadline_ms is not None else UNBOUNDED_DEADLINE_MS


def _tz_aware(value: datetime, tz: timezone) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=tz)


def _domain_reflection_request(
    request: schemas.ReflectionGenerateRequest,
) -> ReflectionRequest:
    """회고 요청 와이어 → 도메인. `/generate`와 `/share-card`가 **같은 재료**를 받는다
    (요청 스키마 재사용) — 변환을 두 벌 두면 한쪽만 고쳐져 조용히 갈라진다.

    enum·날짜 승격은 여기서 한 번만: 값이 enum 밖이면 ValueError가 올라가고
    `_guarded`가 경계 오류로 번역한다 (조용한 흡수 금지).
    """
    return ReflectionRequest(
        kind=ReflectionKind(request.kind),
        region=request.region,
        start_date=request.start_date,
        end_date=request.end_date,
        visits=tuple(
            VisitRecord(
                ref=VisitRef(date=v.ref.date, poi_id=PoiId(v.ref.poi_id)),
                poi_name=v.poi_name,
                category=v.category,
                order_in_day=v.order_in_day,
                photo_count=v.photo_count,
            )
            for v in request.visits
        ),
        events=tuple(
            TripEventRecord(kind=SourceEventKind(e.kind), date=e.date, detail=e.detail)
            for e in request.events
        ),
        persona_summary=request.persona_summary,
        weather_summary=request.weather_summary,
    )


def _budget_from(request: schemas.GenerateItineraryRequest) -> BudgetLevel:
    for text in (request.trip_context.budget_level,
                 request.preference_profile.budget_tier):
        if text:
            level = _BUDGET_TOKENS.get(text.strip().upper())
            if level is not None:
                return level
    return BudgetLevel.MID  # 소프트 제약 — 미인식은 중간 예산 (배제 아님)


def _pace_from(request: schemas.GenerateItineraryRequest) -> Pace | None:
    """와이어 `preference_profile.pace` → 도메인 Pace. 미지정·미인식은 **None**.

    예산(`_budget_from`)이 미인식을 MID 로 떨어뜨리는 것과 다르다 — 그쪽은
    `BudgetLevel` 에 '미설정'이 없어 어쩔 수 없는 예외고, 속도는 None 이 표현
    가능하다. 여기서 BALANCED 로 채우면 **고르지 않은 사용자와 균형을 고른
    사용자가 구분되지 않는다**(백엔드도 null 을 그대로 낸다).
    """
    text = request.preference_profile.pace
    if not text:
        return None
    return _PACE_TOKENS.get(text.strip().upper())


def _transport_from(request: schemas.GenerateItineraryRequest) -> TransportMode:
    for text in request.preference_profile.transport_modes:
        mode = _TRANSPORT_TOKENS.get(text.strip().upper())
        if mode is not None:
            return mode
    return TransportMode.PUBLIC


def _token_or(tokens: Mapping, text: str | None, default):
    """단일 토큰 → enum. 미인식·미지정은 기본값 (소프트 제약 — 배제 아님)."""
    if text:
        value = tokens.get(text.strip().upper())
        if value is not None:
            return value
    return default


def _seed_from(trip_id: str) -> int:
    """같은 여행 → 같은 시드 (재생성 멱등, U5-P2). 프로세스·플랫폼 무관 결정론."""
    return zlib.crc32(trip_id.encode("utf-8"))


def _fixed_block(block: schemas.FixedBlockSchema, tz: timezone) -> FixedBlock:
    if block.date is None or block.start is None:
        # ANYTIME 물질화는 백엔드 소유(경계 계약 M1) — 스키마(FixedBlockSchema
        # date/start 필수)가 1차 차단하고, 여기는 우회 조립 대비 백스톱이다.
        # 조용히 떨어뜨리면 사용자 지정이 침묵 소실된다(INV-4) → 명시 실패(422).
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


def _domain_rejections(
    rows: Sequence[schemas.RejectionSchema],
) -> tuple[Rejection, ...]:
    """경계 거절 이력 → 도메인 (TRIP-964). 순서 보존, 값 변환만 한다.

    `kind` 는 스키마가 Literal 로 닫아 두었으므로 여기서 다시 검사하지 않는다 —
    미지 값은 422 로 먼저 걸린다(경계에서 거르고 도메인은 신뢰하는 관례).
    """
    return tuple(
        Rejection(poi_id=PoiId(r.poi_id), kind=RejectionKind(r.kind), count=r.count)
        for r in rows
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
        pace=_pace_from(request),
        persona_ref=ResourceRef(kind="persona", ref_id=request.trip_id, owner_id=owner),
        principal=Principal(user_id=owner),
        seed=_seed_from(request.trip_id),
        fixed_blocks=tuple(_fixed_block(b, tz) for b in request.fixed_blocks),
        excluded_poi_ids=frozenset(PoiId(x) for x in request.excluded_poi_ids),
        rejections=_domain_rejections(request.rejections),
        include_explanations=request.include_explanations,
    )


# ── 미배치 필수방문 판정 (TRIP-350 — 요청 대비 응답 대조) ────────────

REASON_OUT_OF_RANGE = "OUT_OF_RANGE"
REASON_WINDOW_CONFLICT = "WINDOW_CONFLICT"
REASON_NO_FEASIBLE_SLOT = "NO_FEASIBLE_SLOT"


@dataclass(frozen=True, slots=True)
class UnplacedMustVisit:
    """미배치 필수방문 보고 1건. reason_code는 닫힌 집합(스키마 Literal이 강제)."""

    poi_id: str
    reason_code: str


def judge_unplaced_must_visits(
    request: schemas.GenerateItineraryRequest,
    solution: ItinerarySolution,
    tz: timezone,
) -> tuple[UnplacedMustVisit, ...]:
    """generate 응답의 `unplaced_must_visits` 판정 — 증명 가능한 것만 보고한다.

    판정은 **요청(fixed_blocks) 대비 응답(해)** 대조뿐이다(어셈블리 내부 무수정):
    - 배치됨: 해당 일자에 poi·시각 정확 일치 슬롯 존재(HC3와 동일 기준) → 보고 제외
    - `OUT_OF_RANGE`: 블록 날짜가 여행 기간(trip_context.start~end) 밖 —
      요청 시점에 확정 판정 가능(어느 호출도 배치할 수 없다)
    - 유예(보고 제외): 기간 **안**인데 이 요청의 time_windows 일자 밖 — day1 2단계
      생성(TRIP-293)의 2차로 미뤄진 블록이다. 이 응답의 미배치가 아니므로 오보하지
      않는다(요청 밖 사정은 모른다).
    - `WINDOW_CONFLICT`: 판정 대상 일자인데 미배치 + 요청의 **다른 고정 블록과 창
      겹침이 증명될 때만**
    - `NO_FEASIBLE_SLOT`: 그 외 미배치(기간 안·겹침 없음인데 해에 없음)

    ANYTIME 블록(date/start 없음)은 이 함수에 도달하지 않는다 — 스키마
    (FixedBlockSchema date/start 필수, M1)가 1차 차단하고, `_fixed_block`
    백스톱이 요청 조립 단계에서 422로 명시 실패시킨다(INV-4).
    """
    if not request.fixed_blocks:
        return ()
    blocks = [_fixed_block(b, tz) for b in request.fixed_blocks]
    slots_by_day = {day.date: day.slots for day in solution.days}
    requested_days = {w.date for w in request.time_windows}
    trip_start = request.trip_context.start_date
    trip_end = request.trip_context.end_date

    def satisfied(fb: FixedBlock) -> bool:
        return any(
            s.poi_id == fb.poi_id
            and s.start_at == fb.window.start
            and s.end_at == fb.window.end
            for s in slots_by_day.get(fb.window.start.date(), ())
        )

    def overlaps_other(fb: FixedBlock) -> bool:
        return any(
            other is not fb
            and fb.window.start < other.window.end
            and other.window.start < fb.window.end
            for other in blocks
        )

    reported: list[UnplacedMustVisit] = []
    seen: set[tuple[str, str]] = set()
    for fb in blocks:
        if satisfied(fb):
            continue
        block_date = fb.window.start.date()
        if not (trip_start <= block_date <= trip_end):
            reason = REASON_OUT_OF_RANGE
        elif block_date not in requested_days:
            continue  # 유예 — 다른 호출(2차) 소관, 미배치로 오보하지 않는다
        elif overlaps_other(fb):
            reason = REASON_WINDOW_CONFLICT
        else:
            reason = REASON_NO_FEASIBLE_SLOT
        key = (str(fb.poi_id), reason)
        if key not in seen:  # 동일 (poi, 사유) 중복 보고 방지 — 요청 순서 보존
            seen.add(key)
            reported.append(UnplacedMustVisit(poi_id=str(fb.poi_id), reason_code=reason))
    return tuple(reported)


# ── Protocol 봉투 (api/protocols.py 구조 충족) ───────────────────────


@dataclass(frozen=True, slots=True)
class WiredOutcome:
    """`ItineraryOutcome` Protocol 충족 봉투 — 키 규약은 `"{date}#{poi_id}"`(BR-U2-04)."""

    solution: ItinerarySolution
    explanations: Mapping[str, str]
    distance_ranges: Mapping[str, str]
    freshness: FreshnessMeta | None
    candidates_summary: core.CandidatesReport | None
    day1_ready_at: datetime | None
    unplaced_must_visits: tuple[UnplacedMustVisit, ...] = ()
    # 슬롯별 차선책 (TRIP-871) — generate 경로만 실값. 기본 빈 = 차선책 없음.
    slot_alternatives: Mapping[str, tuple["WiredSlotAlternative", ...]] = field(
        default_factory=dict
    )


@dataclass(frozen=True, slots=True)
class WiredSlotAlternative:
    """`SlotAlternativeLike` 충족 — 에이전트의 `SlotAlternative` 에 표시용 거리 문자열을
    붙인 것 (TRIP-871). `distance_range` 는 슬롯 POI 기준, 좌표 미상이면 None."""

    poi_id: str
    rationale: str
    distance_range: str | None


@dataclass(frozen=True, slots=True)
class WiredRepairOutcome:
    """`RepairOutcome` Protocol 충족 봉투. `repaired=None` = 수리 불가(정상, IO-7)."""

    repaired: WiredOutcome | None
    changes: tuple[str, ...]
    unverified: tuple["WiredUnverifiedSlot", ...] = ()


@dataclass(frozen=True, slots=True)
class WiredUnverifiedSlot:
    """`UnverifiedSlotLike` 충족 — HC 판정에서 빠진 슬롯 1건 (TRIP-537)."""

    poi_id: str
    reason_code: str
    detail: str = ""


@dataclass(frozen=True, slots=True)
class WiredValidateOutcome:
    """`ValidationOutcome` 충족 — 위반과 미검증을 나눠 담는다 (TRIP-537)."""

    violations: tuple[Violation, ...]
    unverified: tuple[WiredUnverifiedSlot, ...] = ()


# PoiMiss 사유 → 경계 reason_code (닫힌 집합, UnverifiedSlotSchema Literal과 일치).
_MISS_REASON_CODES = {"not_found": "NOT_REGISTERED", "mapping_failed": "UNMAPPABLE"}


def _unverified(misses: Sequence[PoiMiss]) -> tuple[WiredUnverifiedSlot, ...]:
    """어댑터 누락 → 경계 보고. 사유를 모르면 지어내지 않고 UNMAPPABLE로 둔다."""
    return tuple(
        WiredUnverifiedSlot(
            poi_id=str(m.poi_id),
            reason_code=_MISS_REASON_CODES.get(m.reason, "UNMAPPABLE"),
            detail=m.detail,
        )
        for m in misses
    )


def _payload_alternative_pairs(
    payload: schemas.ItineraryPayload,
) -> tuple[tuple[str, str, str], ...]:
    """payload 의 슬롯별 차선책 → (날짜 ISO, 슬롯 poi_id, 선택지 poi_id). 일정 순서대로."""
    return tuple(
        (day.date.isoformat(), slot.poi_id, alt.poi_id)
        for day in payload.days for slot in day.slots for alt in slot.alternatives
    )


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


def _envelope(
    solution: ItinerarySolution,
    explanations: tuple[PoiExplanation, ...] = (),
    *,
    distance_ranges: Mapping[str, str] | None = None,
    candidates_summary: core.CandidatesReport | None = None,
    day1_ready_at: datetime | None = None,
    unplaced_must_visits: tuple[UnplacedMustVisit, ...] = (),
    slot_alternatives: Mapping[str, tuple[WiredSlotAlternative, ...]] | None = None,
) -> WiredOutcome:
    """봉투 조립. 기본값(빈/None)은 산출 컨텍스트가 없는 경로(repair)의 정직한 값이다.

    `freshness`는 항상 None: 도메인 `Poi`에 수집 시각 메타가 없어 집계 불가 —
    풀 생성 시각을 수집 시각인 척 지어내지 않는다.
    `unplaced_must_visits` 기본 빈 튜플: repair 와이어에는 원 요청 fixed_blocks가
    없어 판정 불가 — 지어내지 않는다(generate 경로만 실값 주입).
    `slot_alternatives` 기본 빈: repair·edit 와이어에는 후보 점수가 없어 선정 불가 —
    generate 경로만 실값(TRIP-871).
    """
    return WiredOutcome(
        solution=solution,
        explanations=_keyed_explanations(solution, explanations),
        distance_ranges=distance_ranges if distance_ranges is not None else {},
        freshness=None,
        candidates_summary=candidates_summary,
        day1_ready_at=day1_ready_at,
        unplaced_must_visits=unplaced_must_visits,
        slot_alternatives=slot_alternatives if slot_alternatives is not None else {},
    )


# ── 거리 표시 문자열 (BR-U2-08 · INV-3: 거리만, 소요시간류 절대 금지) ──


_TRANSPORT_LABELS: Mapping[TransportMode, str] = {
    TransportMode.WALK: "도보",
    TransportMode.PUBLIC: "대중교통",
    TransportMode.CAR: "자가용",
}


def _render_distance(estimate: TravelEstimate, mode: TransportMode) -> str:
    """`TravelEstimate` → 표시 문자열 (계약 예시 "약 1.2km · 도보 추정").

    거리는 범위 상한(도로 추정 = 직선 × 우회계수)을 쓴다 — 하한(직선)은 체감보다
    짧게 읽힌다. `internal_minutes`는 어떤 경로로도 렌더하지 않는다(INV-3).
    """
    _, road_km = estimate.distance_km_range
    suffix = " 추정" if estimate.is_estimated else ""
    return f"약 {road_km:.1f}km · {_TRANSPORT_LABELS[mode]}{suffix}"


def _distance_ranges(
    solution: ItinerarySolution,
    anchors: Mapping[date, GeoPoint],
    coords: Mapping[PoiId, GeoPoint],
    estimator: TravelEstimator,
    mode: TransportMode,
) -> dict[str, str]:
    """연속 지점 간 거리 문자열 — 키 규약 `"{date}#{poi_id}"`(BR-U2-04).

    직전 지점 = 첫 슬롯은 그 날의 앵커(숙소), 이후는 앞 슬롯 POI 좌표.
    좌표를 모르는 지점(미등록 POI·앵커 없는 날)이 끼면 그 구간은 산출하지 않는다
    (슬롯 distance_range는 null — 지어내지 않는다).
    """
    rendered: dict[str, str] = {}
    for day in solution.days:
        prev = anchors.get(day.date)
        for slot in day.slots:
            coord = coords.get(slot.poi_id)
            if prev is not None and coord is not None:
                estimate = estimator.estimate(prev, coord, mode)
                key = f"{day.date.isoformat()}#{slot.poi_id}"
                rendered[key] = _render_distance(estimate, mode)
            prev = coord  # 좌표 미상이면 다음 구간도 산출 불가로 전파
    return rendered


def _failure_exception(error: str) -> Exception:
    """FAILED(GenerationOutcome) → 경계 예외. errors.map_exception이 상태코드로 번역.

    오케스트레이터는 예외를 삼켜 문자열로 수렴시키므로(INV-4), 어댑터가 접두사로
    원 유형을 복원한다 — assembly_conflict→409(d08), permission_denied→403, 나머지 500.
    """
    if error.startswith("assembly_conflict"):
        return AssemblyConflictError(error)
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
        assembly_run=None,
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
        # 와이어에 원 요청의 pace 가 없다 — 명시적으로 None(무보정)을 적는다.
        # 이 함수는 필드를 **열거해 재구성**하므로, 안 적으면 다음에 필드가 늘 때
        # validate·repair 에서만 조용히 사라진다(TRIP-292 excluded_poi_ids 전례).
        # 체류 배율이 빠져도 HC 판정은 배치된 시각 그대로를 보므로 판정은 옳다.
        pace=None,
    )


# ── C2 체인 조립 (요청 스코프) ───────────────────────────────────────


class ChainAssemblyProvider:
    """AssemblyProvider — 풀이 요청마다 다르므로 퍼사드를 요청 스코프로 조립한다.

    체인 = OR-Tools(1차) → 규칙 폴백(최후 보루, required_ms=0 — INV-4 구조 보장).
    LLM 2차 단계(LlmAssembler)는 미배선: 어셈블리 프롬프트 정본·모델 설정이 아직 없다 —
    실 LLM 어댑터와 함께 붙인다(빠진 단계는 체인 강등이 아니라 기능 부재).
    """

    def __init__(self, estimator: TravelEstimator, clock: core.Clock,
                 trace: TracePort, config: AssemblyConfig) -> None:
        self._est = estimator
        self._clock = clock
        self._trace = trace
        self._cfg = config

    def for_pool(self, poi_index: Mapping[PoiId, Poi]) -> HybridAssemblyFacade:
        stages = (
            OrToolsAssembler(poi_index, self._est, self._cfg),
            RuleFallbackAssembler(poi_index, self._est, self._cfg),
        )
        return HybridAssemblyFacade(stages, poi_index, self._est, self._clock, self._trace)


# ── 경계 어댑터 (api/protocols.ItineraryOrchestrator 충족) ───────────


def _categories_of(names: "tuple[str, ...]") -> set[PoiCategory]:
    """지시 사전의 카테고리 문자열 → 도메인 열거. **모르는 이름은 조용히 버린다**.

    사전(`data/replan_directives.yaml`)은 데이터라 코드보다 먼저 바뀔 수 있다 —
    새 카테고리 이름이 오면 그 지시의 그 축만 무효가 되고 나머지는 산다. 예외를
    올리면 사전 한 줄 오타가 재계획 전체를 죽인다.
    """
    out: set[PoiCategory] = set()
    for name in names:
        try:
            out.add(PoiCategory[name])
        except KeyError:
            continue
    return out


# 재계획 사유(AI 어휘) → 트리거 종류. 백엔드가 `trigger` 를 안 보내는 동안 이 표가
# 대신 유도한다 — `/alternatives` 가 `kind="MANUAL"` 을 **지어내는** 것과 다르다:
# 여기 입력(`reasons`)은 FE 칩에서 온 실값이다. 표에 없는 사유는 MANUAL 이고,
# 그건 "사용자가 직접 바꿔 달라고 했다"라서 지어낸 값이 아니라 맞는 값이다.
_REASON_TO_TRIGGER: Mapping[str, TriggerKind] = {
    "weather": TriggerKind.WEATHER,
    "closed": TriggerKind.CLOSURE,
    "fully_booked": TriggerKind.CLOSURE,  # 둘 다 "그 장소에 못 들어간다"
    "delay": TriggerKind.DELAY,
    "canceled": TriggerKind.DELAY,
    # fatigue·none → MANUAL (사용자 사정)
}

# 요청 예산 중 PlanB(RAG + LLM 선택)에 줄 몫. 나머지가 페르소나 점수 + 어셈블리 몫이다.
#
# 0.5 인 이유: 25초 예산에서 12.5초다. PlanB 안에서 다시 `llm_budget_share=0.5` ·
# `llm_retry_share=0.35` 로 갈리므로 1차 6.2초 · 재시도 4.4초 — 실측 중앙값
# (gpt-5.6-sol 5.0초)에 1차가 들어가고 꼬리는 재시도가 받는다. 남는 12.5초에서
# 어셈블리 바닥 5초를 떼면 점수 상한이 7.5초로, 실호출 바닥 ~3초에 여유가 있다.
# PlanB 가 예산을 다 태우면 `c1_min_ms` 진입 임계가 점수를 규칙으로 내린다 —
# 일정은 나오고 강등만 기록된다 (INV-4).
_REPLAN_PLANB_BUDGET_SHARE = 0.5


def _replan_rag_request(
    request: schemas.ReplanRequest,
    pool: CandidatePool,
    persona: PersonaSummary | None,
    daily_rain: Mapping[date, int],
    trace_id: TraceId,
    now: datetime,
    *,
    notes: list[str],
    deadline_ms: int,
) -> PlanBRagRequest:
    """`ReplanRequest` → `PlanBRagRequest`. **재료가 전부 실값이다** — 이 경로가
    `/alternatives` 와 갈리는 지점이다.

    `/alternatives` 는 트리거를 지어내고(`ScheduleAgentWire.kt` 의 `kind="MANUAL"`)
    예산·이동수단·저장 장소가 비어 온다. 여기는 사유·기존 일정·슬롯별 추천 이유·
    저장 장소·취향 확정값이 다 온다 — PlanBAgent 가 원래 받도록 설계된 재료다.
    """
    reasons = [r for r in request.reasons if r]
    if len(reasons) > 1:
        # PlanB 는 사유를 하나만 받는다. 버리는 것을 **밝힌다** — 조용히 첫 번째만
        # 쓰면 FE 가 칩 두 개를 눌렀는데 하나만 먹은 것을 알 방법이 없다.
        notes.append(f"planb_reason_truncated: {reasons[0]} 사용 / {len(reasons)}건 수신")
    reason = reasons[0] if reasons else "none"

    if request.trigger is not None:
        trigger = TriggerParams(
            kind=TriggerKind(request.trigger.kind),
            schedule_id=ScheduleId(request.trigger.schedule_id),
            affected_date=request.trigger.affected_date,
            payload=request.trigger.payload,
        )
    else:
        trigger = TriggerParams(
            kind=_REASON_TO_TRIGGER.get(reason, TriggerKind.MANUAL),
            schedule_id=ScheduleId(request.trip_id),
            affected_date=request.target_date,
            payload={},
        )

    return PlanBRagRequest(
        trigger=trigger,
        reason=reason,
        # 원 일정이 이미 합류한 풀이다 (`_with_current_slots`) — 원 슬롯도 후보로
        # 경쟁해야 "원래 자리보다 나은 것만 바꾼다"가 성립한다.
        pool=pool,
        trace_id=trace_id,
        now=now,
        excluded_poi_ids=frozenset(PoiId(p) for p in request.excluded_poi_ids),
        # `ReplanSlotSchema.placement_reason` 이 이 필드를 위해 있다 — 계약 독스트링이
        # "visit_slot.placement_reason" 이라고 적어 둔 그 값이고, PlanB 가 "원래 취지를
        # 잇는 대안"을 고르는 컨텍스트다. 종전 배선에서는 아무도 읽지 않았다.
        affected_reasons={
            s.poi_id: s.placement_reason
            for s in request.current_slots
            if s.placement_reason
        },
        saved_places=tuple(
            SavedPlace(poi_id=sp.poi_id, name=sp.name) for sp in request.saved_places
        ),
        deadline_ms=int(deadline_ms * _REPLAN_PLANB_BUDGET_SHARE),
        rain_prob_by_date=daily_rain,
        persona=persona,
    )


def _replan_fixed_blocks(
    request: schemas.ReplanRequest, tz: timezone
) -> tuple[FixedBlock, ...]:
    """`locked_blocks` + `current_slots[is_fixed]` → HC3 고정 블록.

    둘을 합치는 이유: 백엔드는 예약 있는 곳을 `locked_blocks` 로도 보내고 원 일정
    슬롯의 `is_fixed` 로도 표시한다. 한쪽만 읽으면 **고정한 곳이 움직인다**.
    같은 POI 가 양쪽에 있으면 한 번만 넣는다(HC3 는 POI당 한 창을 기대한다).
    """
    date = request.target_date
    blocks: list[FixedBlock] = []
    seen: set[str] = set()
    for block in request.locked_blocks:
        if block.poi_id in seen:
            continue
        seen.add(block.poi_id)
        blocks.append(FixedBlock(
            poi_id=PoiId(block.poi_id),
            window=TimeWindow(
                start=datetime.combine(date, block.start_at, tzinfo=tz),
                end=datetime.combine(date, block.end_at, tzinfo=tz),
            ),
            reason="locked_block",
        ))
    for slot in request.current_slots:
        if not slot.is_fixed or slot.poi_id in seen:
            continue
        seen.add(slot.poi_id)
        blocks.append(FixedBlock(
            poi_id=PoiId(slot.poi_id),
            window=TimeWindow(
                start=datetime.combine(date, slot.start_at, tzinfo=tz),
                end=datetime.combine(date, slot.end_at, tzinfo=tz),
            ),
            reason="current_slot_fixed",
        ))
    return tuple(blocks)


def _persona_of(request: schemas.ReplanRequest) -> PersonaSummary | None:
    """인라인 `preference_profile` → 페르소나. **없는 축을 채우지 않는다**.

    `generate` 재사용이 기각된 이유 ⑵ 가 이것이다 — 백엔드 legacy 경로가
    `NEUTRAL_PREFERENCES` 로 덮어써서 사용자가 방금 고른 취향이 사라졌다.

    **모르는 값은 버린다.** 7축 프로필은 백엔드가 자유 문자열로 주고 도메인 열거는
    7종(`TasteTag`)·6종(`CompanionType`)이라 안 맞는 것이 정상이다 — 예외를 올리면
    프로필 한 항목이 재계획 전체를 죽인다. `companion` 은 미설정을 SOLO 로 단정하지
    않는다(`PersonaSummary` docstring — 선택하지 않은 사람을 혼자 여행자로 만들지 말 것).
    """
    profile = request.preference_profile
    tags = tuple(dict.fromkeys(
        TasteTag[name] for name in profile.styles + profile.activities + profile.food_tastes
        if name in TasteTag.__members__
    ))
    companion = next(
        (CompanionType[c] for c in profile.companion_types if c in CompanionType.__members__),
        None,
    )
    if not tags and companion is None and profile.budget_tier is None:
        return None  # 전 축 미설정 — 없는 것과 같다 (패킷 페르소나가 있으면 그쪽을 쓴다)
    return PersonaSummary(
        taste_tags=tags,
        companion=companion,
        budget=_token_or(_BUDGET_TOKENS, profile.budget_tier, BudgetLevel.MID),
    )


class WiredItineraryOrchestrator:
    """실 오케스트레이터·C2 퍼사드를 API Protocol 모양으로 감싸는 경계 어댑터."""

    def __init__(
        self,
        orchestrator: core.ScheduleCoordinator,
        assembly_provider: ChainAssemblyProvider,
        poi_db: object,
        estimator: TravelEstimator,
        tz: timezone = KST,
        *,
        info: InfoCollector,
        pool_builder: CandidatePoolBuilder,
        rag: PlanBAgent,
        explainer: ExplanationWorker,
        alternative_explainer: AlternativeExplanationWorker | None = None,
        clock: core.Clock | None = None,
        context_resolver: ContextResolver,
        edit_agent: EditAgent,
        reflect_agent: ReflectAgent,
        nudge_worker: "ReflectionNudgeWorker",
        reminder_copy_worker: ReminderCopyWorker,
        share_card_worker: "ShareCardCopyWorker",
        trace: TracePort,
        schedule_agent: "ScheduleAgent",
        directives: tuple[DirectiveSpec, ...] = (),
        embedding: EmbeddingPort | None = None,
        vector_store: VectorStorePort | None = None,
    ) -> None:
        self._orchestrator = orchestrator
        self._assembly_provider = assembly_provider
        self._poi_db = poi_db
        self._estimator = estimator
        self._tz = tz
        self._info = info
        self._pool_builder = pool_builder
        self._rag = rag
        self._explainer = explainer
        self._alt_explainer = alternative_explainer  # 미주입 = 차선책 문장 없음(템플릿 유지)
        # 경계 안에서 순차 LLM 호출이 둘이 된 유일한 경로(/explanations)의 잔여 예산 계산용 (TRIP-887)
        self._clock = clock if clock is not None else MonotonicClock()
        self._resolver = context_resolver
        self._edit_agent = edit_agent
        self._reflect_agent = reflect_agent
        self._nudge_worker = nudge_worker
        self._reminder_copy_worker = reminder_copy_worker
        self._share_card_worker = share_card_worker
        self._trace = trace
        # 재계획(/replan) — 점수·solve 를 **복제하지 않고** 이 에이전트를 재사용한다.
        # 커밋 524bf03f 가 이 경계를 미룬 이유가 정확히 "배선 층에서 점수 단계 복제"였다.
        # `build_orchestrator` 가 만든 그 인스턴스를 그대로 받는다 — 새로 만들면
        # ②′ 지도 실재 검증(TRIP-904)·차선책 문장(TRIP-887) 배선이 빠진다.
        self._schedule_agent = schedule_agent
        # KB-4 지시 사전. 비어 있으면 칩·자유입력이 해석되지 않고 그 사실이 노트로 나간다.
        self._directives = directives
        self._embedding = embedding
        self._vector_store = vector_store

    # Protocol: generate(request) — deadline·trace·now는 request_meta(IO-1)에서.
    def generate(self, request: schemas.GenerateItineraryRequest) -> WiredOutcome:
        meta = request.request_meta
        outcome = self._orchestrator.generate(
            _domain_generate_request(request, self._tz),
            _deadline_budget(meta),
            TraceId(meta.request_id),
            _tz_aware(meta.requested_at, self._tz),
        )
        if outcome.status is core.GenerationStatus.FAILED:
            raise _failure_exception(outcome.error or "unknown_failure")
        assert outcome.solution is not None  # GenerationOutcome 불변식(FAILED⇔None)
        solution = outcome.solution
        coords = self._coords_for(solution, outcome.slot_alternatives)
        return _envelope(
            solution,
            outcome.explanations,
            distance_ranges=self._distances_for(request, solution, coords),
            slot_alternatives=self._alternatives_for(
                request, solution, outcome.slot_alternatives, coords
            ),
            candidates_summary=outcome.candidates_summary,
            day1_ready_at=self._day1_ready_at(request, outcome),
            unplaced_must_visits=judge_unplaced_must_visits(
                request, solution, self._tz
            ),
        )

    def _coords_for(
        self,
        solution: ItinerarySolution,
        picks: Mapping[str, tuple[core.SlotAlternative, ...]],
    ) -> dict[PoiId, GeoPoint]:
        """배치 POI + 차선책 POI 좌표를 poi_db 에서 **한 번에** 재조회한다(표시 전용 read)."""
        ids = frozenset(s.poi_id for day in solution.days for s in day.slots) | frozenset(
            a.poi_id for alts in picks.values() for a in alts
        )
        if not ids:
            return {}
        return {p.poi_id: p.coord for p in self._poi_db.find_by_ids(ids)}

    def _distances_for(
        self,
        request: schemas.GenerateItineraryRequest,
        solution: ItinerarySolution,
        coords: Mapping[PoiId, GeoPoint],
    ) -> dict[str, str]:
        """배치 POI 좌표(`_coords_for` 재조회분)로 구간 거리를 렌더한다."""
        anchors = {a.date: GeoPoint(a.lat, a.lng) for a in request.anchors}
        return _distance_ranges(
            solution, anchors, coords, self._estimator, _transport_from(request)
        )

    def _alternatives_for(
        self,
        request: schemas.GenerateItineraryRequest,
        solution: ItinerarySolution,
        picks: Mapping[str, tuple[core.SlotAlternative, ...]],
        coords: Mapping[PoiId, GeoPoint],
    ) -> dict[str, tuple[WiredSlotAlternative, ...]]:
        """차선책에 **그 슬롯 POI 기준** 거리 문자열을 붙인다 — 좌표 미상이면 null(TRIP-871).

        기준점이 직전 지점이 아니라 슬롯 POI 인 이유: 차선책은 "이 자리를 무엇으로 바꿀까"의
        답이라, 바꾸려는 장소에서 얼마나 떨어졌는지가 사용자 질문이다(온디맨드 경로의
        백엔드 거리 계산도 교체 대상 좌표가 중심 — ai-backend-alternatives-연동-설계 §3).
        거리만 — 소요시간류 토큰 0(INV-3, `_render_distance` 가 보장).
        """
        if not picks:
            return {}
        mode = _transport_from(request)
        out: dict[str, tuple[WiredSlotAlternative, ...]] = {}
        for day in solution.days:
            for slot in day.slots:
                key = f"{day.date.isoformat()}#{slot.poi_id}"
                alts = picks.get(key)
                if not alts:
                    continue
                here = coords.get(slot.poi_id)
                out[key] = tuple(
                    WiredSlotAlternative(
                        poi_id=str(a.poi_id),
                        rationale=a.rationale,
                        distance_range=(
                            _render_distance(
                                self._estimator.estimate(here, coords[a.poi_id], mode), mode
                            )
                            if here is not None and a.poi_id in coords else None
                        ),
                    )
                    for a in alts
                )
        return out

    @staticmethod
    def _day1_ready_at(
        request: schemas.GenerateItineraryRequest,
        outcome: core.GenerationOutcome,
    ) -> datetime | None:
        """이 응답이 여행 1일차를 포함할 때만 solved_at을 싣는다.

        2차 생성(TRIP-293 — 나머지 일자만 요청)의 응답에 1일차 준비 시각을
        실으면 지어낸 값이 된다 — 그 경우 null이 정직한 값.
        """
        if outcome.solved_at is None:
            return None
        day1 = request.trip_context.start_date
        if any(w.date == day1 for w in request.time_windows):
            return outcome.solved_at
        return None

    def validate(
        self, request: schemas.ValidateItineraryRequest
    ) -> WiredValidateOutcome:
        solution, problem, poi_index, unverified = self._reconstruct(
            request.itinerary, request.request_meta
        )
        facade = self._assembly_provider.for_pool(poi_index)
        return WiredValidateOutcome(
            violations=tuple(facade.validate(
                solution, problem, _deadline_budget(request.request_meta),
                TraceId(request.request_meta.request_id),
            )),
            unverified=unverified,
        )

    def repair(self, request: schemas.RepairItineraryRequest) -> WiredRepairOutcome:
        solution, problem, poi_index, unverified = self._reconstruct(
            request.itinerary, request.request_meta
        )
        facade = self._assembly_provider.for_pool(poi_index)
        result = facade.repair(
            solution, problem, _deadline_budget(request.request_meta),
            TraceId(request.request_meta.request_id),
        )
        return WiredRepairOutcome(
            repaired=_envelope(result.repaired) if result.repaired is not None else None,
            changes=tuple(_render_change(c) for c in result.changes),
            unverified=unverified,
        )

    def _reconstruct(
        self, payload: schemas.ItineraryPayload, meta: schemas.RequestMetaSchema
    ) -> tuple[
        ItinerarySolution, ItineraryProblem, dict[PoiId, Poi],
        tuple[WiredUnverifiedSlot, ...],
    ]:
        solution = _solution_from_payload(payload, ScheduleId(meta.request_id), self._tz)
        problem = _problem_for(solution, self._tz)
        ids = frozenset(s.poi_id for day in solution.days for s in day.slots)
        # 미등록 POI는 인덱스에 없다 → HC1·HC2 미적용("정보 없음은 막지 않는다", c2 규칙).
        # 규칙은 그대로 두되 **무엇이 빠졌는지는 값으로 들고 나간다**(TRIP-537, INV-4) —
        # 막지 않는 것과 알리지 않는 것은 다르다.
        lookup = self._poi_db.lookup_by_ids(ids)
        poi_index = {p.poi_id: p for p in lookup.pois}
        return solution, problem, poi_index, _unverified(lookup.misses)

    def alternatives(
        self, request: schemas.AlternativesRequest
    ) -> schemas.AlternativesResponse:
        """Plan-B 대안 제안 (TRIP-428) — 정보 수집(REPLAN 요구표) → RAG 파이프라인 → 사영.

        **수집은 `InfoCollector` 경유다** (2026-09-16). 종전에는 풀 빌더를 직접 불러
        후보 풀만 만들었고, 그래서 `INFO_REQUIREMENTS["REPLAN"]` 이 정의돼 있는데도
        날씨를 한 번도 보지 않았다 — 비 때문에 다시 짜는 경로가 강수확률을 모른 채
        백엔드가 준 `reason="weather"` 라벨만 믿고 돌았다(팀 결정 2026-09-15:
        "replan 은 무조건 날씨를 본다").

        표 4종 중 지금 채워지는 것은 **PLACE·WEATHER 둘**이다. PERSONA(`principal`·
        `persona_ref`)와 TRANSIT(`origin`·`destination`)은 **와이어에 필드가 없어서**
        백엔드가 보내주기 전에는 수집할 수 없다 — 경계 계약 개방이 선행이다.
        미등록·미충족 Provider 는 패킷 자체가 안 만들어지므로(기능 부재) 여기서
        분기할 필요가 없다.

        의도 파악은 하지 않는다 — 엔드포인트가 intent 를 고정하므로 에이전트 직행이
        맞고(팀 원칙), 바뀐 것은 "재료를 제대로 챙겨 보낸다"뿐이다.

        파이프라인은 예외를 던지지 않는다 — 실패는 전부 fallback_level·notes·
        empty_reason 상태값으로 나간다(INV-4).
        """
        now = _tz_aware(request.request_meta.requested_at, self._tz)
        dates = tuple(request.dates)
        transport = _token_or(
            _TRANSPORT_TOKENS, request.transport_mode, TransportMode.PUBLIC)
        anchor = GeoPoint(request.anchor.lat, request.anchor.lng)
        params: dict = {
            "pool_request": CandidatePoolRequest(
                anchor=anchor,
                dates=dates,
                budget=_token_or(
                    _BUDGET_TOKENS, request.budget_level, BudgetLevel.MID),
                transport=transport,
            ),
            "anchor": anchor,
            "days": dates,
            "now": now,
        }
        # 선택 필드가 오면 그만큼 요구표가 더 채워진다 — 안 오면 Provider 가
        # 패킷을 못 만들고(params 부족 → UNAVAILABLE) 무보정으로 간다.
        # 페르소나 재조회 키는 generate 와 **같은 파생 규칙**을 쓴다(wiring 상단 註).
        if request.trip_id:
            params["principal"] = Principal(user_id=request.trip_id)
            params["persona_ref"] = ResourceRef(
                kind="persona", ref_id=request.trip_id, owner_id=request.trip_id)
        packets = self._info.collect(Intent.REPLAN, params)
        pool = self._pool_from(packets, now)
        result = self._rag.run(
            PlanBRagRequest(
                trigger=TriggerParams(
                    kind=TriggerKind(request.trigger.kind),
                    schedule_id=ScheduleId(request.trigger.schedule_id),
                    affected_date=request.trigger.affected_date,
                    payload=request.trigger.payload,
                ),
                reason=request.reason,
                pool=pool,
                trace_id=TraceId(request.request_meta.request_id),
                now=now,
                # 미지정이면 '시간제약 없음'(TRIP-473) — 다른 경로와 같은 규칙을 쓴다.
                # 원값을 그대로 넘기면 None 이 되어 LLM 마감이 게이트웨이 기본으로
                # 되돌아간다(= 예산 관통이 무력화). 그 구멍을 여기서 닫는다.
                deadline_ms=_deadline_budget(request.request_meta),
                excluded_poi_ids=frozenset(
                    PoiId(p) for p in request.excluded_poi_ids),
                affected_reasons=dict(request.affected_reasons),
                # 실측 강수확률 (팀 결정 2026-09-15). `reason` 라벨을 **대체하지
                # 않는다** — 라벨은 백엔드가 내린 트리거이고 이미 사용자 화면에 뜬
                # 문구다("비 예보로 일정 변경 제안"). 우리가 재서 낮게 나왔다고
                # 야외를 안 내리면 화면과 모순된다. 실값은 정도를 더하는 데만 쓴다.
                rain_prob_by_date=self._rain_from(packets, dates, now),
                persona=self._persona_from(packets),
                saved_places=tuple(
                    SavedPlace(poi_id=sp.poi_id, name=sp.name) for sp in request.saved_places
                ),
            )
        )
        return schemas.AlternativesResponse(
            alternatives=[
                schemas.AlternativeSchema(
                    label=a.label,
                    poi_ids=[str(p) for p in a.poi_ids],
                    rationale=a.rationale,
                )
                for a in result.alternatives
            ],
            is_fallback=result.is_fallback,
            fallback_level=result.fallback_level,
            notes=list(result.notes),
            retrieved=dict(result.retrieved),
            dropped_out_of_pool=list(result.dropped_out_of_pool),
            empty_reason=result.empty_reason,
            pool_size=len(pool.poi_ids),
        )

    # ── 재계획 (/replan) — 계약만 있던 자리를 배선한다 ─────────────────
    def replan(self, request: schemas.ReplanRequest) -> schemas.ReplanResponse:
        """하루 재계획 (i04 → i06). 예외를 안 던진다 — 실패도 200 + 사유 (INV-4).

        **점수·solve 를 복제하지 않는다.** 커밋 524bf03f 가 이 경계를 미룬 이유가
        정확히 "배선 층에서 점수 단계를 복제하면 REPLAN 요구표 작업이 곧 지운다"
        였고, 그 요구표가 채워진 뒤(`INFO_REQUIREMENTS[Intent.REPLAN]`)라 이제
        `ScheduleAgent` 를 그대로 재사용하면 복제가 없다.

        `generate` 재사용(백엔드가 GENERATE_PATH 로 보내기)이 기각된 세 이유
        **셋 다** 이 경로가 되찾는다 — ⑵ 인라인 `preference_profile` 이 NEUTRAL 로
        덮이지 않고 ⑶ 사유·지시·자유입력·원 일정이 실릴 자리가 있고, ⑴ **RAG 도
        탄다**.

        ⑴ 은 종전에 남겨 둔 구멍이었다(2026-09-24 PR #714: "RAG 미탑승은 남는다").
        그게 틀린 절충이었다는 증거가 계약 자체에 있었다 — `ReplanRequest` 독스트링이
        "`generate` 와 다른 것: **RAG(KB-3)를 탄다**"라고 적고 `ReplanResponse` 에
        `retrieved`(KB 히트 수) 필드가 있는데, ScheduleAgent 만 붙여 놨으니 그 필드가
        **항상 빈 dict** 였다. 정본(`planb-rag-design.md`)의 배정도 반대였다:
        PlanBAgent = "여행 중 변수 발생 시 기존 일정 + 페르소나 기반 대안", ScheduleAgent
        = "백지·여행 전". 여행 중 변수 대응 경로가 바로 여기다.

        **두 판단을 합성한다** (하나를 버리지 않는다):
        - PlanBAgent(RAG) — "이 상황에 뭐가 맞나". KB-3 상황·KB-5 장소 지식 검색 →
          LLM 이 고른 **순서**. 시각·순서는 내지 않는다 (INV-2 — 애초에 필드가 없다).
        - ScheduleAgent — "이 사람이 뭘 좋아하나"(페르소나 점수) + 어셈블리 배치.
          PlanB 순서는 `planb_rank` 로 실어 **점수 가산**으로만 들어간다.

        예산이 모자라면 기존 진입 임계(`c1_min_ms`)가 점수 단계를 규칙으로 내린다 —
        여기서 따로 분기하지 않는다. PlanB 가 LLM 을 못 썼으면(`is_fallback`) 랭킹을
        **넘기지 않는다**: 그때 `ranked_poi_ids` 는 규칙 랭킹이고, 그건 `build_rule_score`
        가 이미 보는 신호(우천·거리·저장 장소)를 두 번 세는 것이라 얻는 것이 없다.
        """
        meta = request.request_meta
        now = _tz_aware(meta.requested_at, self._tz)
        trace_id = TraceId(meta.request_id)
        notes: list[str] = []
        # PlanB·점수·어셈블리가 **한 시계 원점을 공유한다** — PlanB 가 쓴 시간이
        # ScheduleAgent 의 잔여에서 저절로 빠져야 두 LLM 호출이 예산을 겹쳐 쓰지 않는다.
        t0 = self._clock.monotonic_ms()

        resolved, unknown, prefer, avoid = self._replan_directives(request, notes)

        transport = _token_or(
            _TRANSPORT_TOKENS, request.transport_mode, TransportMode.PUBLIC)
        anchor = GeoPoint(request.anchor.lat, request.anchor.lng)
        dates = (request.target_date,)
        budget_level = _token_or(
            _BUDGET_TOKENS, request.preference_profile.budget_tier, BudgetLevel.MID)
        params: dict = {
            "pool_request": CandidatePoolRequest(
                anchor=anchor, dates=dates, budget=budget_level, transport=transport),
            "anchor": anchor,
            "days": dates,
            "now": now,
        }
        if request.trip_id:
            params["principal"] = Principal(user_id=request.trip_id)
            params["persona_ref"] = ResourceRef(
                kind="persona", ref_id=request.trip_id, owner_id=request.trip_id)
        packets = self._info.collect(Intent.REPLAN, params)
        pool = self._pool_from(packets, now)
        pool = self._with_current_slots(pool, request, now, notes)
        if not pool.pois:
            return self._replan_empty("NO_CANDIDATE", notes, resolved, unknown)

        persona = self._persona_from(packets) or _persona_of(request)
        daily_rain = self._rain_from(packets, dates, now)

        # ── PlanBAgent (RAG) — 상황 지식으로 순서를 낸다 ─────────────
        planb = self._rag.run(_replan_rag_request(
            request, pool, persona, daily_rain, trace_id, now,
            notes=notes, deadline_ms=_deadline_budget(meta),
        ))
        notes += [f"planb: {n}" for n in planb.notes]
        # 랭킹은 **LLM 경로일 때만** 넘긴다 (독스트링 마지막 단락).
        planb_rank = () if planb.is_fallback else planb.ranked_poi_ids
        if planb.is_fallback:
            notes.append(f"planb_rank_skipped: fallback_level={planb.fallback_level}")

        window = request.time_window
        domain_request = core.GenerateItineraryRequest(
            schedule_id=ScheduleId(request.trip_id),
            anchor=anchor,
            days=dates,
            day_window=TimeWindow(
                start=datetime.combine(window.date, window.start, tzinfo=self._tz),
                end=datetime.combine(window.date, window.end, tzinfo=self._tz),
            ),
            budget=budget_level,
            transport=transport,
            persona_ref=ResourceRef(
                kind="persona", ref_id=request.trip_id, owner_id=request.trip_id),
            principal=Principal(user_id=request.trip_id),
            seed=abs(hash(meta.request_id)) % 10_000,
            fixed_blocks=_replan_fixed_blocks(request, self._tz),
            excluded_poi_ids=frozenset(PoiId(p) for p in request.excluded_poi_ids),
            rejections=_domain_rejections(request.rejections),
            include_explanations=False,  # 재계획 화면(i06)은 설명을 안 쓴다
            prefer_categories=prefer,
            avoid_categories=avoid,
        )
        outcome = self._schedule_agent.run(core.ScheduleTask(
            request=domain_request,
            pool=pool,
            persona=persona,
            daily_rain=daily_rain,
            event_bonus=None,
            candidates_summary=core.candidates_report(pool),
            budget=core.allocate(_deadline_budget(meta), core.OrchestratorConfig()),
            # PlanB 가 쓴 시간이 잔여에서 빠지도록 **PlanB 이전** 원점을 넘긴다.
            # 여기서 시계를 다시 읽으면 PlanB 가 공짜가 되고, 두 LLM 호출 합이
            # 예산을 넘겨 백스톱(504)에 걸린다.
            started_ms=t0,
            trace_id=trace_id,
            now=now,
            planb_rank=planb_rank,
        ))
        return self._replan_projection(
            request, outcome, notes, resolved, unknown, retrieved=planb.retrieved
        )

    def _replan_directives(
        self, request: schemas.ReplanRequest, notes: list[str]
    ) -> tuple[list[str], list[str], frozenset[PoiCategory], frozenset[PoiCategory]]:
        """칩 + 자유입력 → (해석분, 미지분, 선호 카테고리, 회피 카테고리).

        **`prefer`/`avoid` 를 실제로 쓰는 첫 자리다** — 2026-09-24 실측으로 사전 20종의
        `enforced_by`·`prefer_categories`·`avoid_categories` 를 읽는 코드가 `src/`
        전체에 0건이었다(사전이 인식만 하고 효과가 없었다).

        미배선(`unwired`) 지시는 **해석분에 넣되 노트로 무효를 밝힌다** — 해석 못 한
        것(`unknown`)과 해석했지만 안 듣는 것은 다른 사실이고, 섞으면 FE 가 "사전을
        늘려야 하나"와 "솔버를 열어야 하나"를 못 가른다.
        """
        if not self._directives:
            if request.directives or request.free_text:
                notes.append("directive_dictionary_absent")
            return [], list(request.directives), frozenset(), frozenset()

        known, unknown = resolve_chips(request.directives, self._directives)
        specs = list(known)
        if request.free_text and self._embedding is not None and self._vector_store is not None:
            try:
                matched = match_free_text(
                    request.free_text, self._directives,
                    self._embedding, self._vector_store)
            except Exception as e:  # 검색 장애 — 칩만으로 진행한다
                notes.append(f"free_text_match_degraded: {type(e).__name__}")
                matched = ()
            seen = {s.key for s in specs}
            specs += [s for s in matched if s.key not in seen]
        elif request.free_text:
            notes.append("free_text_match_unavailable")  # 벡터 미주입

        prefer: set[PoiCategory] = set()
        avoid: set[PoiCategory] = set()
        ineffective: list[str] = []
        for spec in specs:
            if spec.unwired:
                ineffective.append(spec.key)
                continue
            prefer |= _categories_of(spec.prefer_categories)
            avoid |= _categories_of(spec.avoid_categories)
        if ineffective:
            notes.append(f"directives_unwired: {','.join(sorted(ineffective))}")
        both = prefer & avoid
        if both:  # 반대인 칩을 같이 눌렀다 — 상쇄되고 그 사실을 남긴다
            notes.append(
                f"directives_conflict: {','.join(sorted(c.value for c in both))}")
        return [s.key for s in specs], list(unknown), frozenset(prefer), frozenset(avoid)

    def _with_current_slots(
        self,
        pool: CandidatePool,
        request: schemas.ReplanRequest,
        now: datetime,
        notes: list[str],
    ) -> CandidatePool:
        """원 일정 POI 를 풀에 합집합으로 넣는다.

        설계 §4 — 원 일정 POI 가 **같은 점수 호출**에 들어가야 대안과 같은 척도로
        비교된다. 안 넣으면 "바꿀 이유 없는 곳까지 바뀐다"가 된다(legacy 경로의
        증상이 정확히 그것이다).

        제외 목록에 있는 것은 넣지 않는다 — 사용자가 이미 거절한 곳이다.
        """
        refs = [
            PoiId(s.poi_id) for s in request.current_slots
            if s.poi_id not in set(request.excluded_poi_ids)
        ]
        missing = [r for r in refs if r not in pool.poi_ids]
        if not missing:
            return pool
        try:
            found = tuple(self._poi_db.find_by_ids(frozenset(missing)))
        except Exception as e:  # POI 조회 실패 — 원 일정 없이도 재계획은 된다
            notes.append(f"current_slots_lookup_degraded: {type(e).__name__}")
            return pool
        if len(found) < len(missing):
            notes.append(f"current_slots_unregistered: {len(missing) - len(found)}")
        if not found:
            return pool
        pois = pool.pois + found
        return CandidatePool(
            poi_ids=frozenset(p.poi_id for p in pois), pois=pois,
            generated_at=pool.generated_at, anchor=pool.anchor,
            radius_km=pool.radius_km,
        )

    def _replan_empty(
        self, code: str, notes: list[str], resolved: list[str], unknown: list[str],
        retrieved: Mapping[str, int] | None = None,
    ) -> schemas.ReplanResponse:
        """못 만든 것을 **빈 일정으로 위장하지 않는다** (IO-7 — itinerary=null + 사유).

        `retrieved` 는 실패해도 싣는다 — 검색은 됐는데 배치가 안 된 것과 검색부터
        안 된 것은 다른 사실이고, 그 구분이 있어야 어디를 고칠지 안다.
        """
        return schemas.ReplanResponse(
            itinerary=None, total_distance_km=None, is_fallback=True, fallback_level=2,
            notes=notes, resolved_directives=resolved, unknown_directives=unknown,
            empty_reason=schemas.ReplanEmptyReasonSchema(code=code),
            retrieved=dict(retrieved or {}),
        )

    def _replan_projection(
        self,
        request: schemas.ReplanRequest,
        outcome: core.GenerationOutcome,
        notes: list[str],
        resolved: list[str],
        unknown: list[str],
        *,
        retrieved: Mapping[str, int] | None = None,
    ) -> schemas.ReplanResponse:
        """`GenerationOutcome` → `ReplanResponse`. **예외로 올리지 않는다** (IO-7).

        `generate` 는 FAILED 를 HTTP 오류로 올리지만(`_failure_exception`) 재계획은
        200 + `empty_reason` 이다 — 백엔드가 폴백 여부를 상태값으로 읽는 계약이고,
        같은 실패를 한쪽은 예외 한쪽은 상태로 내면 소비 코드가 갈린다.
        """
        from trippilot.api.routes import to_payload  # 순환 import 회피 (경계→배선 단방향)

        notes += [d.reason for d in outcome.degradations]
        if outcome.status is core.GenerationStatus.FAILED:
            notes.append(outcome.error or "unknown_failure")
            return self._replan_empty(
                "NO_FEASIBLE_SLOT", notes, resolved, unknown, retrieved)
        solution = outcome.solution
        if solution is None or not any(day.slots for day in solution.days):
            return self._replan_empty(
                "NO_FEASIBLE_SLOT", notes, resolved, unknown, retrieved)

        coords = self._coords_for(solution, outcome.slot_alternatives)
        anchors = {request.target_date: GeoPoint(request.anchor.lat, request.anchor.lng)}
        transport = _token_or(
            _TRANSPORT_TOKENS, request.transport_mode, TransportMode.PUBLIC)
        envelope = _envelope(
            solution,
            distance_ranges=_distance_ranges(
                solution, anchors, coords, self._estimator, transport),
            candidates_summary=outcome.candidates_summary,
        )
        return schemas.ReplanResponse(
            itinerary=to_payload(envelope),
            total_distance_km=self._total_distance_km(
                solution, anchors, coords, transport),
            # 점수가 규칙으로 내려갔으면 폴백이다 — 일정은 나왔으니 level 2 가 아니다.
            is_fallback=outcome.scoring_mode is not core.ScoringMode.LLM,
            fallback_level=0 if outcome.scoring_mode is core.ScoringMode.LLM else 1,
            notes=notes,
            resolved_directives=resolved,
            unknown_directives=unknown,
            # 계약이 "KB 히트 수"라고 적어 둔 그 필드 — 배선 전에는 항상 빈 dict 였다.
            retrieved=dict(retrieved or {}),
        )

    def _total_distance_km(
        self,
        solution: ItinerarySolution,
        anchors: Mapping[date, GeoPoint],
        coords: Mapping[PoiId, GeoPoint],
        transport: TransportMode,
    ) -> float | None:
        """구간 거리 합. **생산자가 없어 여기서 만든다** (2026-09-24 실측: `src/` 에
        `total_distance_km` 생산 코드 0건 — 스키마 필드와 어댑터 내부값만 있었다).

        `TravelEstimate.distance_km_range` 의 **상한**을 더한다 — 하한을 쓰면 실제보다
        짧게 보여 "생각보다 멀다"가 되고, 범위를 그대로 노출하면 `i08` 의 "이동 −6.9km"
        비교가 불가능하다(백엔드 `ReplanDiffService` 가 스칼라를 기대한다).

        **시간은 절대 싣지 않는다** (INV-3) — `TravelEstimate` 에 소요시간이 같이
        있으므로 여기서 거리만 꺼내는 것이 그 불변식의 실행 지점이다.
        """
        total = 0.0
        seen_any = False
        for day in solution.days:
            previous = anchors.get(day.date)
            for slot in day.slots:
                here = coords.get(slot.poi_id)
                if previous is None or here is None:
                    previous = here or previous
                    continue
                try:
                    estimate = self._estimator.estimate(previous, here, transport)
                except Exception:  # 추정 실패 — 그 구간만 빠진다
                    previous = here
                    continue
                total += estimate.distance_km_range[1]
                seen_any = True
                previous = here
        return round(total, 1) if seen_any else None

    def _pool_from(
        self, packets: dict[ProviderKind, InfoPacket], now: datetime
    ) -> CandidatePool:
        """PLACE 패킷 → 풀 실체. 확보 불가면 빈 풀 — 파이프라인이 `no_candidates`
        상태값으로 수렴시킨다(INV-4, 예외 금지)."""
        packet = packets.get(ProviderKind.PLACE)
        ref = packet.data.get("pool_ref") if packet is not None else None
        pool = self._info.resolve_pool(ref) if isinstance(ref, str) else None
        return pool if pool is not None else CandidatePool(
            poi_ids=frozenset(), pois=(), generated_at=now)

    def _rain_from(
        self,
        packets: dict[ProviderKind, InfoPacket],
        dates: tuple[date, ...],
        now: datetime,
    ) -> dict:
        """WEATHER 패킷 → {날짜: 강수확률%}. 요청 날짜로 한정한다.

        **일 단위 대표값이다** — 어댑터가 시간별 슬롯을 받아 일 최댓값으로 접는다
        (`WeatherPort.daily_forecast`). 재계획은 여행 중 특정 시점에 일어나므로
        오후에 "오늘 80%"를 받으면 **아침에 이미 그친 비**일 수 있다. 시간 단위
        포트는 후속 — 그전까지 소비측은 이 값을 과신하지 않는다.

        미등록·조회 실패는 빈 dict (무보정) — 날씨 실패가 대안 실패가 되면 안 된다.
        """
        packet = packets.get(ProviderKind.WEATHER)
        if packet is None or packet.status is not ProviderStatus.OK:
            return {}
        wanted = set(dates)
        hourly = packet.data.get("hourly") or {}
        if hourly:
            # **남은 시간대만** 본다 — 재계획은 여행 중 특정 시점에 일어나므로
            # 이미 지나간 슬롯의 비는 판단에 넣지 않는다. 일 최댓값을 쓰면 오후
            # 3시에 "오늘 80%" 가 아침에 그친 비를 가리킬 수 있다.
            remaining: dict[date, int] = {}
            for iso, pop in hourly.items():
                slot = datetime.fromisoformat(iso)
                if slot < now or slot.date() not in wanted:
                    continue
                remaining[slot.date()] = max(remaining.get(slot.date(), 0), pop)
            if remaining:
                return remaining
            # 남은 슬롯이 없다(그날 예보가 끝났다) — 일 단위로 되돌아가지 않는다.
            # "남은 시간에 비 정보 없음"과 "하루 최댓값"은 다른 사실이다.
            return {}
        return {
            parsed: p for d, p in packet.data.get("daily", {}).items()
            if (parsed := date.fromisoformat(d)) in wanted
        }

    def _persona_from(
        self, packets: dict[ProviderKind, InfoPacket]
    ) -> PersonaSummary | None:
        """PERSONA 패킷 → 취향 프로필. 비가용이면 None (무보정 — KB 검색분만 쓴다).

        KB-2 벡터 검색과 **다른 출처**다: KB-2 는 저장 장소·메모 임베딩이고, 이쪽은
        `ContextResolver` 재조회가 돌려주는 확정 프로필(취향·동행·예산)이다.
        요청자 권한 하 재조회라(BR-U4-07) 권한 위반은 Provider 가 예외로 승격한다.
        """
        packet = packets.get(ProviderKind.PERSONA)
        if packet is None or packet.status is not ProviderStatus.OK:
            return None
        try:
            return PersonaSummary.from_dict(packet.data["persona"])
        except Exception:  # 패킷 형식 오류 — 비가용과 동일 취급
            return None

    def explanations(
        self, request: schemas.ExplanationsRequest
    ) -> schemas.ExplanationsResponse:
        """슬롯별 설명 조회 (TRIP-479) — 재구성 → 풀 조립 → ExplanationWorker.

        설명은 부가 정보라 실패도 200 + 빈 맵 + 사유다(침묵 금지). 페르소나는
        generate와 같은 trip_id 파생 참조(D31)로 해석 — 소유 검증 규칙 재사용.
        """
        meta = request.request_meta
        now = _tz_aware(meta.requested_at, self._tz)
        trace_id = TraceId(meta.request_id)
        solution = _solution_from_payload(
            request.itinerary, ScheduleId(request.trip_id), self._tz)
        ids = frozenset(s.poi_id for day in solution.days for s in day.slots)
        # 차선책(TRIP-887) — payload 의 슬롯별 alternatives 를 (날짜, 슬롯 POI, 선택지 POI)로.
        # 좌표·풀 조립은 배치 POI 와 한 번의 재조회로 합친다.
        alt_pairs = _payload_alternative_pairs(request.itinerary)
        alt_ids = frozenset(PoiId(a) for _, _, a in alt_pairs)
        # 배치 슬롯 설명이 조기 반환하면 차선책은 시도조차 못 한다 — "차선책 요청이 없었다"와
        # 구별되게 사유를 싣는다(침묵 금지). 차선책이 없었으면 None.
        alt_skipped = "slot_explanations_unavailable" if alt_pairs else None
        pois = (
            tuple(self._poi_db.find_by_ids(ids | alt_ids)) if ids or alt_ids else ()
        )
        if not any(p.poi_id in ids for p in pois):
            # 미등록 POI뿐(고정 블록 유래 등) — 근거 없이 지어내지 않는다
            return schemas.ExplanationsResponse(
                explanations={}, is_fallback=True, reason="no_registered_pois",
                alternatives_reason=alt_skipped)
        pool = CandidatePool(
            poi_ids=frozenset(p.poi_id for p in pois), pois=pois, generated_at=now)
        owner = f"trip:{request.trip_id}"
        persona = self._resolver.resolve(
            Principal(user_id=owner),
            ResourceRef(kind="persona", ref_id=request.trip_id, owner_id=owner),
        )
        seen: set[PoiId] = set()
        ordered = tuple(
            slot.poi_id
            for day in solution.days for slot in day.slots
            if pool.contains(slot.poi_id)
            and not (slot.poi_id in seen or seen.add(slot.poi_id))
        )
        budget_ms = _deadline_budget(meta)
        t0 = self._clock.monotonic_ms()
        try:
            result = self._explainer.explain(
                pool, ordered, persona, trace_id, now,
                timeout_sec=budget_ms / 1000.0,
            )
        except Exception as e:  # 설정 버그 등 — 설명 없음으로 정직 보고
            return schemas.ExplanationsResponse(
                explanations={}, is_fallback=True,
                reason=f"explain_error: {type(e).__name__}: {e}",
                alternatives_reason=alt_skipped)
        if result.is_fallback or not result.value:
            return schemas.ExplanationsResponse(
                explanations={}, is_fallback=True,
                reason=f"explanation_fallback: {result.error}",
                alternatives_reason=alt_skipped)
        keyed = _keyed_explanations(
            solution, tuple(x for x in result.value if pool.contains(x.poi_id)))
        # 차선책 문장은 두 번째 호출 — 첫 호출이 실패하면 시도하지 않고(위 사유), 성공했으면
        # **잔여 예산**만 준다(DL-2 — 두 호출의 합이 deadline 을 넘지 않게, 에이전트 ⑥′ 와 동형).
        alt_keyed, alt_reason = self._alternative_explanations(
            pool, alt_pairs, persona, trace_id, now,
            remaining_ms=budget_ms - (self._clock.monotonic_ms() - t0))
        return schemas.ExplanationsResponse(
            explanations=dict(keyed), is_fallback=False, reason=None,
            alternative_explanations=alt_keyed, alternatives_reason=alt_reason)

    def _alternative_explanations(
        self,
        pool: CandidatePool,
        pairs: tuple[tuple[str, str, str], ...],
        persona: PersonaSummary,
        trace_id: TraceId,
        now: datetime,
        *,
        remaining_ms: int,
    ) -> tuple[dict[str, str], str | None]:
        """차선책 "대신 골라도 좋은 이유" (TRIP-887) — 키 `"{date}#{alt_poi_id}"`, 실패는 빈 맵 + 사유.

        선택지가 풀(정본) 밖이면 설명하지 않는다(INV-1 — 지어내지 않는다). 확정 슬롯 POI 는
        컨텍스트일 뿐이라 미등록이어도 쌍을 버리지 않는다. 잔여가 하한(에이전트 ⑤·⑥′ 와
        같은 `explanation_min_ms`) 미만이면 부르지 않는다(DL-2).
        """
        if not pairs:
            return {}, None
        if self._alt_explainer is None:
            return {}, "alternative_explainer_absent"  # 기능 부재 — 백엔드는 템플릿을 쓴다
        usable = tuple(
            (PoiId(s), PoiId(a)) for _, s, a in pairs if pool.contains(PoiId(a))
        )
        if not usable:
            return {}, "no_registered_alternatives"
        if remaining_ms < core.OrchestratorConfig().explanation_min_ms:
            return {}, f"deadline:remaining={remaining_ms}ms"
        try:
            result = self._alt_explainer.explain(
                pool, usable, persona, trace_id, now, timeout_sec=remaining_ms / 1000.0)
        except Exception as e:  # 설정 버그 등 — 문장 없음으로 정직 보고
            return {}, f"explain_error: {type(e).__name__}: {e}"
        if result.is_fallback or not result.value:
            return {}, f"alternative_explanation_fallback: {result.error}"
        texts = {x.poi_id: x.text for x in result.value if pool.contains(x.poi_id)}
        keyed = {
            f"{d}#{a}": texts[PoiId(a)] for d, _, a in pairs if PoiId(a) in texts
        }
        return keyed, (None if keyed else "alternative_explanation_empty")

    def edit(
        self, request: schemas.EditItineraryRequest
    ) -> schemas.EditItineraryResponse:
        """일정 편집 (TRIP-431) — EditAgent 위임 (agents/edit/agent.py).

        경계가 하는 일은 와이어 몫뿐이다: 일정 재구성 · 후보 풀 조립 · 스키마 파싱 ·
        결과 사영. 해석(번역)·검증·확인 게이트·재타이밍·어셈블리 검증은 에이전트 소유.
        """
        meta = request.request_meta
        now = _tz_aware(meta.requested_at, self._tz)
        # 편집은 확인 게이트·재타이밍이 따로 있어 미검증 목록을 소비하지 않는다
        solution, _, poi_index, _ = self._reconstruct(request.itinerary, meta)
        transport = _token_or(
            _TRANSPORT_TOKENS, request.transport_mode, TransportMode.PUBLIC)
        # 수집은 요구표 경유 (2026-09-16) — EDIT 행은 Place 하나뿐이지만, 풀 빌더
        # 직행 대신 PlaceProvider 를 거치면서 FreshnessMeta·ProviderStatus 가 붙는다.
        # 조회 실패가 예외로 튀지 않고 상태값으로 수렴한다(INV-4).
        packets = self._info.collect(
            Intent.EDIT_SCHEDULE,
            {
                "pool_request": CandidatePoolRequest(
                    anchor=GeoPoint(request.anchor.lat, request.anchor.lng),
                    dates=tuple(
                        sorted({d.date for d in request.itinerary.days})
                    ) or (request.target_date,),
                    budget=_token_or(
                        _BUDGET_TOKENS, request.budget_level, BudgetLevel.MID),
                    transport=transport,
                ),
                "now": now,
            },
        )
        pool = self._pool_from(packets, now)

        # 구조화 진입의 와이어 파싱은 경계 몫 — op 문자열이 EditOp 밖이면 여기서 거른다
        # (편집 규칙 위반이 아니라 형식 오류다). 자연어는 에이전트가 번역한다.
        command = None
        if request.utterance is None:
            try:
                command = EditCommand(
                    op=EditOp(request.command.op),
                    params=dict(request.command.params),
                    affected_slots=tuple(
                        PoiId(x) for x in request.command.affected_slots),
                )
            except ValueError:
                return schemas.EditItineraryResponse(
                    status=EditStatus.REJECTED.value,
                    reason=f"op가 EditOp 밖: {request.command.op!r}",
                )

        outcome = self._edit_agent.run(EditTask(
            solution=solution,
            target_date=request.target_date,
            pool=pool,
            poi_index=poi_index,
            transport=transport,
            trace_id=TraceId(meta.request_id),
            now=now,
            deadline_ms=_deadline_budget(meta),
            utterance=request.utterance,
            command=command,
            confirm=request.confirm,
        ))
        return self._edit_response(outcome)

    def _edit_response(
        self, outcome: EditOutcome
    ) -> schemas.EditItineraryResponse:
        """EditOutcome → 와이어. 상태값 사영뿐 — 판단은 이미 에이전트가 끝냈다."""
        command_schema = None
        if outcome.command is not None:
            command_schema = schemas.EditCommandSchema(
                op=outcome.command.op.value, params=dict(outcome.command.params),
                affected_slots=[str(x) for x in outcome.command.affected_slots],
            )
        apply_mode = (
            outcome.apply_mode.value if outcome.apply_mode is not None else None)
        if outcome.status is EditStatus.APPLIED:
            assert outcome.solution is not None  # 불변식이 보장 (APPLIED ⇔ solution)
            # 사영은 routes 소유(to_payload) — 지역 import (routes→wiring 역참조 없음, 비순환)
            from trippilot.api.routes import to_payload

            return schemas.EditItineraryResponse(
                status=outcome.status.value, command=command_schema,
                apply_mode=apply_mode,
                itinerary=to_payload(_envelope(outcome.solution)),
            )
        return schemas.EditItineraryResponse(
            status=outcome.status.value, command=command_schema,
            apply_mode=apply_mode,
            violations=[
                schemas.ViolationSchema(
                    code=v.code,
                    slot_ref=str(v.slot_ref) if v.slot_ref is not None else None,
                    detail=v.detail, day_index=None, slot_index=None,
                )
                for v in outcome.violations
            ],
            reason=outcome.reason,
        )

    def reflection_generate(
        self, request: schemas.ReflectionGenerateRequest
    ) -> schemas.ReflectionGenerateResponse:
        """회고 연출 템플릿 생성 — ReflectAgent 위임 (agents/reflect/agent.py).

        전 시도 파싱 실패면 고정 폴백 템플릿 200(is_fallback=true, INV-4).
        응답 키 = ReflectionTemplate.to_dict() (계약 §3 — 시각·duration 필드 부재).
        """
        meta = request.request_meta
        now = _tz_aware(meta.requested_at, self._tz)
        domain_request = _domain_reflection_request(request)
        template = self._reflect_agent.run(ReflectTask(
            request=domain_request,
            trace_id=TraceId(meta.request_id),
            now=now,
            timeout_sec=_deadline_budget(meta) / 1000.0,
        ))
        return schemas.ReflectionGenerateResponse(**template.to_dict())

    def reflection_nudge(
        self, request: schemas.ReflectionNudgeRequest
    ) -> schemas.ReflectionNudgeResponse:
        """회고 유도 문구 1건 — LLM 실패·드롭 시 결정론 기본 문구(INV-4, 침묵 금지)."""
        meta = request.request_meta
        result = self._nudge_worker.nudge(
            ReflectionNudgeInput(
                destination=request.destination,
                duration_days=request.trip_days,
                persona_summary=request.persona_summary,
                highlight_places=tuple(request.highlight_places),
            ),
            TraceId(meta.request_id),
            _tz_aware(meta.requested_at, self._tz),
        )
        if result.is_fallback or not result.value:
            if not result.is_fallback:
                # 방어 분기 — 현 게이트 계약상 도달 불가(빈 문자열은 게이트가 드롭).
                # 게이트 완화 시 계측 없는 침묵 폴백이 되지 않게 여기서 발행 (INV-4)
                self._trace.emit(FallbackEvent(
                    trace_id=TraceId(meta.request_id),
                    occurred_at=_tz_aware(meta.requested_at, self._tz),
                    component="api.wiring",
                    stage="agent",
                    from_mode="llm_nudge",
                    to_mode="fixed_message",
                    reason="nudge_empty_value_without_fallback_flag",
                ))
            return schemas.ReflectionNudgeResponse(
                message=FALLBACK_NUDGE_MESSAGE, is_fallback=True)
        return schemas.ReflectionNudgeResponse(
            message=str(result.value), is_fallback=False)

    def reminder_copy(
        self, request: schemas.ReminderCopyRequest
    ) -> schemas.ReminderCopyResponse:
        """리마인드 알림 문구 배치 — 실패분은 빼고 degraded 로 알린다 (INV-4).

        폴백 문구를 여기서 만들지 않는다: 빠진 자리는 백엔드가 기존 하드코딩 상수로
        채우므로, 이 경계의 폴백 모드는 "backend_constant" 다.
        """
        meta = request.request_meta
        budget_sec = None if meta.deadline_ms is None else meta.deadline_ms / 1000
        copies, dropped = self._reminder_copy_worker.generate(
            ReminderCopyInput(
                trip_title=request.trip_title,
                items=tuple(
                    ReminderCopyItem(
                        schedule_key=item.schedule_key,
                        kind=item.kind,
                        date_label=item.date.isoformat(),
                        slot_names=tuple(s.name for s in item.slots),
                        slot_categories=tuple(s.category for s in item.slots),
                    )
                    for item in request.items
                ),
            ),
            TraceId(meta.request_id),
            _tz_aware(meta.requested_at, self._tz),
            budget_sec=budget_sec,
        )
        if dropped:
            self._trace.emit(FallbackEvent(
                trace_id=TraceId(meta.request_id),
                occurred_at=_tz_aware(meta.requested_at, self._tz),
                component="api.wiring",
                stage="agent",
                from_mode="llm_reminder_copy",
                to_mode="backend_constant",
                reason=f"reminder_copy_dropped: {dropped}/{len(request.items)}",
            ))
        return schemas.ReminderCopyResponse(
            copies=[
                schemas.ReminderCopySchema(
                    schedule_key=c.schedule_key, title=c.title, body=c.body
                )
                for c in copies
            ],
            degraded=bool(dropped),
            fallback_mode="backend_constant" if dropped else None,
        )

    def reflection_share_card(
        self, request: schemas.ReflectionGenerateRequest
    ) -> schemas.ShareCardCopyResponse:
        """j06 공유 카드 문구 — 워커 직행 (U6 Reflect FD §2.1, TRIP-429 후속).

        에이전트를 경유하지 않는다: 후보 선택·다단 구성·예산 계단·하드 교체가 하나도
        없는 단발 변환이라 껍데기 위임 메서드는 대칭 말고 얻는 게 없다. 실패·게이트
        전량 탈락이면 결정론 정적 조립으로 수렴한다 (INV-4, 침묵 금지).
        """
        meta = request.request_meta
        now = _tz_aware(meta.requested_at, self._tz)
        domain_request = _domain_reflection_request(request)
        result = self._share_card_worker.generate(
            domain_request,
            TraceId(meta.request_id),
            now,
            # 같은 요청 스키마의 같은 필드를 한 경계는 쓰고 한 경계는 버리면
            # 예산이 실리는 순간 여기만 기본 타임아웃으로 돈다 (`reflection_generate` 대칭)
            timeout_sec=_deadline_budget(meta) / 1000.0,
        )
        if result.is_fallback or not result.value:
            if not result.is_fallback:
                # 방어 분기 — 현 게이트 계약상 도달 불가(빈 캡션은 게이트가 error로 낸다).
                # 게이트 완화 시 계측 없는 침묵 폴백이 되지 않게 여기서 발행한다.
                # 직행 패턴의 발행 주체는 경계다 — component="api.wiring" (FD §2.1 관측 규칙).
                self._trace.emit(FallbackEvent(
                    trace_id=TraceId(meta.request_id),
                    occurred_at=now,
                    component="api.wiring",
                    stage="agent",
                    from_mode="llm_share_card",
                    to_mode="static_copy",
                    reason="share_card_empty_value_without_fallback_flag",
                ))
            return schemas.ShareCardCopyResponse(
                **fallback_share_card_copy(domain_request).to_dict())
        return schemas.ShareCardCopyResponse(**result.value.to_dict())


# ── 조립 함수 (composition root) ─────────────────────────────────────


def build_orchestrator(
    *,
    llm: LlmPort,
    poi_db: object,
    context_store: ContextStore,
    c1_config: C1Config,
    m7_config: M7Config | None = None,
    assembly_config: AssemblyConfig | None = None,
    orchestrator_config: core.OrchestratorConfig | None = None,
    clock: core.Clock | None = None,
    trace: TracePort | None = None,
    prompts_root: Path | None = None,
    weather: WeatherPort | None = None,
    travel_port: object | None = None,  # 실경로 어댑터 (TRIP-432) — None이면 하버사인
    existence: object | None = None,    # 지도 실재 검증 (TRIP-683) — None이면 강등 없음
    events: "EventPort | None" = None,  # 행사 저장소 (TRIP-421) — None이면 무보정
    vector_store: object | None = None,
    embedding: object | None = None,
    tz: timezone = KST,
    directives: tuple[DirectiveSpec, ...] = (),
) -> WiredItineraryOrchestrator:
    """실 구성요소 조립 → `create_app(orchestrator=...)`에 꽂을 어댑터.

    외부 의존(llm·poi_db·context_store)은 전부 인자 — 실 어댑터 등장 시 그 인자만
    바뀐다. c1_config는 model_id 하드코딩 금지(BR-U4-08) 때문에 기본값이 없다.
    `weather`(TRIP-383)는 선택 — 기본 None이면 날씨 보정 없이 기존과 동일하게
    생성한다(기존 호출 전부 무영향). 포트는 여기서 WeatherProvider→InfoCollector로
    감싸 주입한다(TRIP-406) — 오케스트레이터는 포트를 모른다.
    """
    clock = clock if clock is not None else MonotonicClock()
    trace = trace if trace is not None else LoggingTrace()
    acfg = assembly_config if assembly_config is not None else AssemblyConfig()
    renderer = PromptRegistry(prompts_root if prompts_root is not None else _PROMPTS_ROOT)
    resolver = ContextResolver(context_store)
    estimator = TravelEstimator(acfg)
    # travel_port 주입 시 ChainedTravelAdapter 등 실경로 어댑터 사용 (TRIP-432)
    travel = travel_port if travel_port is not None else estimator
    provider = ChainAssemblyProvider(estimator, clock, trace, acfg)
    # 수집 계층 (TRIP-406·407) — 풀·페르소나 상시, 날씨는 포트 주입 시에만 등록.
    # 페르소나 재조회도 같은 resolver — 보안 규칙의 권위 1곳 (TRIP-333·BR-U4-07).
    pool_builder = CandidatePoolBuilder(
        poi_db, m7_config if m7_config is not None else M7Config())
    providers: dict[ProviderKind, object] = {
        ProviderKind.PLACE: PlaceProvider(pool_builder),
        ProviderKind.PERSONA: PersonaProvider(resolver),
    }
    # Plan-B RAG (TRIP-428) — 벡터·임베딩 미주입이면 Unwired 스텁: 파이프라인이
    # 검색 실패를 notes로 남기고 빈 컨텍스트 + 규칙 랭킹으로 강등한다(INV-4).
    rag = PlanBAgent(
        embedding if embedding is not None else UnwiredEmbedding(),
        vector_store if vector_store is not None else UnwiredVectorStore(),
        alternative_worker=AlternativeSelectionWorker(GatewayFacade(
            llm, renderer, AlternativeSelectionGate(), c1_config, trace)),
    )
    if weather is not None:
        providers[ProviderKind.WEATHER] = WeatherProvider(weather)
    # Transit Provider — travel_port 주입 여부 무관하게 항상 등록 (TRIP-432,
    # 미주입이면 하버사인 estimator가 포트 역할)
    from trippilot.providers.transit import TransitProvider
    providers[ProviderKind.TRANSIT] = TransitProvider(port=travel)
    if events is not None:  # 행사 저장소 주입 시에만 등록 (TRIP-421)
        providers[ProviderKind.EVENT] = EventProvider(events)
    explainer = ExplanationWorker(
        GatewayFacade(llm, renderer, ExplanationGate(), c1_config, trace)
    )
    # 차선책 문장(TRIP-887) — 프롬프트는 다르고 출구 게이트는 설명과 같다.
    alt_explainer = AlternativeExplanationWorker(
        GatewayFacade(llm, renderer, ExplanationGate(), c1_config, trace)
    )
    # EditAgent — 번역 워커를 감싼다. 어셈블리 검증까지 에이전트가 소유(INV-2).
    edit_agent = EditAgent(
        EditTranslationWorker(
            GatewayFacade(llm, renderer, EditTranslationGate(), c1_config, trace)
        ),
        provider,
        estimator,
        lambda solution: _problem_for(solution, tz),
        tz=tz,
    )
    # Reflect 경계 (TRIP-429) — 워커별 게이트 페어링은 위 explainer·edit와 동형
    # ReflectAgent — 템플릿 워커를 감싼다. Phase 2(vision) 하이라이트 워커는 후속 배선.
    reflect_agent = ReflectAgent(
        ReflectionTemplateWorker(
            GatewayFacade(llm, renderer, ReflectionTemplateGate(), c1_config, trace)
        ),
        trace,
    )
    nudge_worker = ReflectionNudgeWorker(
        GatewayFacade(llm, renderer, ReflectionNudgeGate(), c1_config, trace)
    )
    reminder_copy_worker = ReminderCopyWorker(
        GatewayFacade(llm, renderer, ReminderCopyGate(), c1_config, trace)
    )
    # 공유 카드 문구도 같은 직행 배선 (TRIP-429 후속 — 에이전트 없음)
    share_card_worker = ShareCardCopyWorker(
        GatewayFacade(llm, renderer, ShareCardCopyGate(), c1_config, trace)
    )
    # ScheduleAgent — 게이트웨이 점수 → 어셈블리 solve → 설명 (agents/schedule/agent.py).
    # PlanB·Reflect 와 같은 조립 단위: 워커는 게이트웨이 계층 소속이고 에이전트가 부른다.
    schedule_agent = ScheduleAgent(
        # 점수 캐시 (TRIP-477) — 2단계 생성(1차 day1→2차 잔여)의 중복 LLM 점수 제거.
        # 폴백은 캐시하지 않으므로 UnwiredLlm·강등 경로 동작은 기존과 동일.
        CachingScoringWorker(
            PreferenceScoringWorker(
                GatewayFacade(llm, renderer, ClosedSetGate(), c1_config, trace)
            )
        ),
        provider,
        clock,
        trace,
        explanation_worker=explainer,
        alternative_explanation_worker=alt_explainer,
        # 지도 실재 검증(TRIP-898) — 점수 뒤·어셈블리 앞에서 점수를 깎는다(TRIP-904).
        # 미주입이면 강등 없이 기존과 동일(근거 없으면 판정 안 함).
        existence=existence,
        config=orchestrator_config,
        # 입장료 파생 지식 (2026-09-24 결정 — AI 소유). 파일이 없으면 빈 표이고
        # 그때 점수는 종전과 **완전히 같다**(전 POI '모름' → 중립). 즉 데이터가
        # 배포되기 전에도 이 배선이 동작을 안 바꾼다.
        fees=load_fee_table(),
    )
    # 수집기는 하나를 공유한다 — 코디네이터(generate)와 경계(replan·edit)가 같은
    # 요구표·같은 Provider 를 쓴다. 경로마다 따로 만들면 표가 갈라진다.
    info = InfoCollector(providers)
    orchestrator = core.ScheduleCoordinator(
        info,
        schedule_agent,
        clock,
        trace,
        # 소유 검증(fail-closed, TRIP-333)도 같은 resolver — 보안 규칙의 권위 1곳.
        context_resolver=resolver,
        config=orchestrator_config,
    )
    return WiredItineraryOrchestrator(
        orchestrator, provider, poi_db, travel, tz=tz,
        info=info,
        pool_builder=pool_builder, rag=rag,
        explainer=explainer, alternative_explainer=alt_explainer, clock=clock,
        context_resolver=resolver,
        edit_agent=edit_agent,
        reflect_agent=reflect_agent,
        nudge_worker=nudge_worker,
        reminder_copy_worker=reminder_copy_worker,

        share_card_worker=share_card_worker,
        trace=trace,
        # 재계획 — 위에서 만든 그 에이전트를 그대로 넘긴다(새로 만들면 ②′ 실재 검증·
        # 차선책 문장 배선이 빠진다). 지시 사전은 파일에서 읽고, 없으면 빈 튜플이라
        # 칩·자유입력이 해석되지 않고 그 사실이 응답 노트로 나간다.
        schedule_agent=schedule_agent,
        # 사전은 **주입받는다** — yaml 파서 의존이 `llm_gateway/prompts.py` 전용이라는
        # 아키텍처 규칙(`test_yaml_only_imported_in_llm_gateway_prompts`) 때문이다.
        # `load_directive_file(path, parse)` 가 파서를 인자로 받게 설계된 이유가 이것이고
        # 읽는 쪽은 `src/` 밖이다(main.py·테스트). 비어 있으면 칩·자유입력이 해석되지
        # 않고 그 사실이 응답 노트(`directive_dictionary_absent`)로 나간다.
        directives=directives,
        embedding=embedding,
        vector_store=vector_store,
    )


# ── 로컬·스모크 조립 (in-memory fake — 실 DB·실 LLM 호출 0, D37) ─────


# 제주 — 데모 시드의 기준점(흑돼지거리·한라산의 중간점: 둘 다 PUBLIC 반경 10km 안).
# 성산일출봉·월정리는 반경 밖 — 후보풀 반경 필터가 실제로 일하는 배치다.
DEMO_ANCHOR = GeoPoint(33.4362, 126.5255)

# deadline_ms 미지정(=시간제약 없음, TRIP-473) 시 예산 계단에 대입하는 값.
# 미들웨어 백스톱 기본(timeout_default_deadline_ms)과 같은 값 — 백스톱(+margin)이
# 항상 이 예산보다 뒤에 발동해 정상 폴백과 겹치지 않는 순서가 유지된다.
UNBOUNDED_DEADLINE_MS = 600_000


class UnwiredLlm:
    """실 LLM 미배선 명시 실패 — 게이트웨이가 규칙 점수 폴백 신호로 수렴시킨다(INV-4).

    가짜 성공 응답을 지어내지 않는다(D37: CI·로컬 실 호출 0 — 실 어댑터는 c1/adapters).
    """

    def invoke(self, request: LlmRequest) -> LlmResponse:
        raise RuntimeError("실 LLM 미배선 — 규칙 점수 폴백 (D37)")


class UnwiredEmbedding:
    """실 임베딩 미배선 명시 실패 — RAG 파이프라인이 빈 검색 컨텍스트로 강등한다(INV-4).

    가짜 벡터를 지어내지 않는다(해시 fake는 의미 유사도가 없어 검색을 오염시킨다).
    """

    dim = 1024  # AI-D06
    # 어차피 embed 가 즉시 터지므로 collection 이름은 안 쓰이지만, Protocol 을
    # 만족시켜야 타입이 맞는다. "미배선"임이 이름에도 드러나게 둔다.
    model_id = "unwired"

    def embed(self, text: str) -> tuple[float, ...]:
        raise RuntimeError("실 임베딩 미배선 — KB 검색 생략(빈 컨텍스트 강등)")

    def embed_batch(self, texts) -> tuple[tuple[float, ...], ...]:
        raise RuntimeError("실 임베딩 미배선 — KB 검색 생략(빈 컨텍스트 강등)")


class UnwiredVectorStore:
    """실 벡터 스토어 미배선 명시 실패 — UnwiredEmbedding과 같은 계약."""

    def upsert(self, collection, item_id, vector, payload) -> None:
        raise RuntimeError("실 벡터 스토어 미배선")

    def search(self, collection, vector, top_k, *, item_ids=None):
        # item_ids 를 받기만 하고 쓰지 않는다 — 어차피 올린다. 안 받으면 TypeError 가
        # 먼저 터져 "미배선"이라는 진짜 원인을 가린다.
        raise RuntimeError("실 벡터 스토어 미배선 — KB 검색 생략(빈 컨텍스트 강등)")

    def delete(self, collection, item_id) -> None:
        raise RuntimeError("실 벡터 스토어 미배선")


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

    def lookup_by_ids(self, ids: frozenset[PoiId]) -> PoiLookup:
        return lookup_from(self.find_by_ids(ids), ids)  # 인메모리 — 매핑 실패 없음


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
            # KB-5 조인 키 — **데모용 값이다**(백엔드 시드에 없다). 실 경로에서는
            # `BackendPoiDb` 가 `PoiReadResponse.sourceRef` 를 옮긴다.
            # 이걸 안 채우면 `place_knowledge._pool_refs` 가 빈 집합을 내서
            # **개발·스모크 앱에서 KB-5 가 켜지지 않는다** — 그러면 장소 지식이
            # 조용히 사라져도 어느 스모크도 안 걸린다(2026-09-19 실측: 실제로
            # 경계 테스트가 한 건도 없었다).
            source_ref=f"demo-{poi_id[-1]}",
        )
        for poi_id, name, category, lat, lng in _BACKEND_SEED_ROWS
    )


def build_dev_app(
    *,
    llm: LlmPort | None = None,
    model_id: str | None = None,
    weather: WeatherPort | None = None,
    poi_db: object | None = None,
    travel_port: object | None = None,
    existence: object | None = None,   # PlaceExistencePort (TRIP-683)
    feature_models: dict | None = None,  # 기능별 모델 오버라이드 (TRIP-513)
    retry_models: dict | None = None,  # 타임아웃 재시도 모델 (TRIP-522 2단 폴백)
    events: EventPort | None = None,
    vector_store: object | None = None,
    embedding: object | None = None,
    trace: TracePort | None = None,
    context_store: object | None = None,
    directives: tuple[DirectiveSpec, ...] = (),
) -> FastAPI:
    """스모크·로컬 개발용 앱 — 기본은 in-memory fake 조립(실 LLM·실 DB 0, D37).

    기본(`llm` 미주입)은 UnwiredLlm — 점수는 항상 규칙 폴백(정직한 강등), 일정은
    OR-Tools가 낸다. `llm` 주입 시 그 어댑터로 실 LLM만 배선한다(TRIP-344 최소 이행분
    — POI·페르소나는 여전히 데모 시드; env 해석·클라이언트 조립은 main.py 소유,
    벤더 SDK는 c1/adapters 한정이라 이 모듈은 LlmPort만 받는다).
    `model_id`는 주입 LLM의 모델 식별자(LIGHT·HEAVY 양 티어 공용, BR-U4-08 주입 원칙).
    `weather`는 선택 주입(TRIP-383) — env 해석·어댑터 조립은 main.py 소유, 기본 None
    이면 날씨 보정 없이 기존과 동일.
    `poi_db`는 선택 주입(TRIP-408, BackendPoiDb 실연동) — 기본 None 이면 기존
    StaticPoiDb(제주 시드 4곳) 그대로(하위호환: 백엔드 없는 로컬 스모크).
    `travel_port`는 선택 주입(TRIP-432, ChainedTravelAdapter) — 기본 None 이면
    기존 TravelEstimator(하버사인) 그대로.
    `context_store`는 선택 주입(TRIP-434, BackendPersonaStore 실연동) — 기본 None
    이면 StaticPersonaStore(고정 요약) 그대로. 실 어댑터를 넣으면 페르소나가
    매 요청 백엔드 재조회로 온다(BR-U4-07).
    `trace`는 선택 주입(관측 스파이용, 예: InMemoryTrace) — 기본 None 이면
    build_orchestrator 기본값(LoggingTrace) 그대로.
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
        existence=existence,
        llm=llm if llm is not None else UnwiredLlm(),
        poi_db=poi_db if poi_db is not None else StaticPoiDb(demo_poi_seed()),
        context_store=context_store if context_store is not None else StaticPersonaStore(
            PersonaSummary(taste_tags=(), companion=CompanionType.SOLO,
                           budget=BudgetLevel.MID)
        ),
        c1_config=C1Config(model_ids=model_ids,
                           feature_models=feature_models or {},
                           retry_models=retry_models or {}),
        weather=weather,
        travel_port=travel_port,  # 실경로 어댑터 (TRIP-432)
        events=events,  # 행사 저장소 (TRIP-421) — None이면 무보정
        vector_store=vector_store,
        embedding=embedding,
        trace=trace,
        directives=directives,
    )
    return create_app(orchestrator)
