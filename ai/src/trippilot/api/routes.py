"""경계 라우트 — `POST /ai/v1/itinerary/{generate,validate,repair,alternatives,explanations,edit,replan}`
+ `POST /ai/v1/reflection/{generate,nudge,share-card}`
+ `POST /ai/v1/notification/copies`.

도입 티켓: alternatives=TRIP-428 · explanations=TRIP-479 · edit=TRIP-431 · reflection=TRIP-429 ·
notification=TRIP-836 · replan=재계획 연동 설계(A-4).
**경로 수는 세지 않는다** — 정본은 `docs/openapi.json` 이다(손 카운트는 드리프트한다).
경로 정본: services.md §0 / agent-io-contracts.md §0.1 (구 표기 `/ai/generate`·`/ai/schedule` 폐기).

이 파일이 하는 일은 셋뿐이다:
1. 검증된 요청을 오케스트레이터에 그대로 넘긴다(판단 위임 — 여기서 후보·시각을 만들지 않는다)
2. 도메인 결과를 표시 스키마로 **사영**한다 — 시각은 어셈블리 검증값(VisitSlot)에서만 온다(INV-2),
   소요시간은 어느 경로로도 나가지 않는다(INV-3)
3. 예외를 경계 오류 바디로 번역한다(errors.map_exception)
"""

from __future__ import annotations

from datetime import date as date_type
from typing import Callable, Sequence, TypeVar

from fastapi import APIRouter, Depends, Request

from trippilot.api.errors import map_exception, orchestrator_not_wired
from trippilot.api.protocols import (
    CandidatesSummaryLike,
    ItineraryOrchestrator,
    ItineraryOutcome,
    UnverifiedSlotLike,
)
from trippilot.api.schemas import (
    AlternativesRequest,
    AlternativesResponse,
    EditItineraryRequest,
    EditItineraryResponse,
    ExplanationsRequest,
    ExplanationsResponse,
    CandidatesSummarySchema,
    DayScheduleSchema,
    FreshnessMetaSchema,
    GenerateItineraryRequest,
    ItineraryPayload,
    ReflectionGenerateRequest,
    ReflectionGenerateResponse,
    ReflectionNudgeRequest,
    ReflectionNudgeResponse,
    ReminderCopyRequest,
    ReminderCopyResponse,
    ReplanRequest,
    ReplanResponse,
    RepairItineraryRequest,
    RepairItineraryResponse,
    ShareCardCopyResponse,
    SlotAlternativeSchema,
    UnplacedMustVisitSchema,
    UnverifiedSlotSchema,
    ValidateItineraryRequest,
    ValidateItineraryResponse,
    ViolationSchema,
    VisitSlotDisplaySchema,
)
from trippilot.domain.common import PoiId
from trippilot.domain.freshness import FreshnessMeta
from trippilot.domain.itinerary import Violation

router = APIRouter(prefix="/ai/v1/itinerary", tags=["itinerary"])

_T = TypeVar("_T")


def get_orchestrator(request: Request) -> ItineraryOrchestrator:
    """주입된 오케스트레이터. 미주입이면 503 — 빈 일정으로 위장하지 않는다(INV-4)."""
    orchestrator = getattr(request.app.state, "orchestrator", None)
    if orchestrator is None:
        raise orchestrator_not_wired()
    return orchestrator


def _guarded(call: Callable[[], _T]) -> _T:
    """오케스트레이터 호출 + 사영을 감싸 예외를 경계 오류로 번역한다."""
    try:
        return call()
    except Exception as exc:  # noqa: BLE001 — 여기가 번역 지점(미분류는 500으로 드러난다)
        raise map_exception(exc) from exc


# ───────────────────────── 도메인 → 표시 스키마 사영 ─────────────────────────


def slot_key(day: date_type, poi_id: PoiId | str) -> str:
    """설명·거리 문자열의 키 규약 (BR-U2-04)."""
    return f"{day.isoformat()}#{poi_id}"


def _freshness(meta: FreshnessMeta | None) -> FreshnessMetaSchema | None:
    if meta is None:
        return None
    return FreshnessMetaSchema(
        source=meta.source,
        fetched_at=meta.fetched_at,
        cache_hit=meta.cache_hit,
        ttl_sec=meta.ttl_sec,
        stale=meta.stale,
    )


def _candidates_summary(
    summary: CandidatesSummaryLike | None,
) -> CandidatesSummarySchema | None:
    if summary is None:
        return None
    return CandidatesSummarySchema(
        level=summary.level,
        pool_size=summary.pool_size,  # 모르면 None 유지 — 0은 "후보 0건" 판정이 된다
        shortfall_categories=list(summary.shortfall_categories),
    )


def to_payload(outcome: ItineraryOutcome) -> ItineraryPayload:
    """`ItineraryOutcome` → 와이어 산출물.

    - 시각: `VisitSlot.start_at/end_at`(어셈블리 검증값)의 시각 성분만 사영(INV-2)
    - `ends_next_day`: 종료가 그 날짜를 넘겼는가 — 어셈블리 값에서 파생(HC4 표현)
    - `is_fixed`: 그 날의 고정 블록(HC3)에 POI가 있는가 — 지어내지 않고 해에서 읽는다
    - `stay_min`·`score`는 **사영하지 않는다**(INV-3 / IO-3)
    - `alternatives`: 슬롯별 차선책(TRIP-871) — 봉투가 슬롯 키로 준 것만(없으면 빈 목록)
    """
    solution = outcome.solution
    days: list[DayScheduleSchema] = []
    for day in solution.days:
        fixed_pois = {block.poi_id for block in day.fixed_blocks}
        slots = [
            VisitSlotDisplaySchema(
                poi_id=str(slot.poi_id),
                start_at=slot.start_at.time(),
                end_at=slot.end_at.time(),
                ends_next_day=slot.end_at.date() > day.date,
                distance_range=outcome.distance_ranges.get(
                    slot_key(day.date, slot.poi_id)
                ),
                is_fixed=slot.poi_id in fixed_pois,
                alternatives=[
                    SlotAlternativeSchema(
                        poi_id=alt.poi_id,
                        rationale=alt.rationale,
                        distance_range=alt.distance_range,
                    )
                    for alt in outcome.slot_alternatives.get(
                        slot_key(day.date, slot.poi_id), ()
                    )
                ],
            )
            for slot in day.slots
        ]
        days.append(DayScheduleSchema(date=day.date, slots=slots))

    return ItineraryPayload(
        days=days,
        day1_ready_at=outcome.day1_ready_at,
        explanations=dict(outcome.explanations),
        solve_mode=solution.solve_mode.value,
        is_fallback=solution.is_fallback,
        freshness=_freshness(outcome.freshness),
        candidates_summary=_candidates_summary(outcome.candidates_summary),
        # TRIP-350: 판정은 봉투(wiring) 소유 — 여기서는 사영만(빈 목록 = 전부 배치)
        unplaced_must_visits=[
            UnplacedMustVisitSchema(
                poi_id=str(item.poi_id), reason_code=item.reason_code
            )
            for item in outcome.unplaced_must_visits
        ],
    )


def locate_slot(
    days: Sequence[DayScheduleSchema], slot_ref: PoiId | str | None
) -> tuple[int | None, int | None]:
    """일정에서 `slot.poi_id == slot_ref`인 **첫 위치**의 (day_index, slot_index).

    못 찾으면 (None, None) — 예: HC3 미배치 위반은 슬롯이 없어서 위반인 것이므로
    null이 정직한 값이다(지어내지 않는다). 도메인 타입은 건드리지 않고
    직렬화 계층에서만 계산한다(백엔드 `(type, dayIndex, slotIndex)` 표현과의 수퍼셋 대응).
    """
    if slot_ref is None:
        return (None, None)
    ref = str(slot_ref)
    for day_index, day in enumerate(days):
        for slot_index, slot in enumerate(day.slots):
            if str(slot.poi_id) == ref:
                return (day_index, slot_index)
    return (None, None)


def to_violation(
    violation: Violation, days: Sequence[DayScheduleSchema] = ()
) -> ViolationSchema:
    day_index, slot_index = locate_slot(days, violation.slot_ref)
    return ViolationSchema(
        code=violation.code,
        slot_ref=str(violation.slot_ref) if violation.slot_ref is not None else None,
        detail=violation.detail,
        day_index=day_index,
        slot_index=slot_index,
    )


def to_unverified(item: UnverifiedSlotLike) -> UnverifiedSlotSchema:
    """미검증 슬롯 사영 (TRIP-537) — 위반이 아니라 "판정 못 함"이라 별도 목록이다."""
    return UnverifiedSlotSchema(
        poi_id=str(item.poi_id),
        reason_code=item.reason_code,
        detail=item.detail,
    )


# ───────────────────────── 라우트 ─────────────────────────


@router.post("/generate", response_model=ItineraryPayload)
def generate(
    body: GenerateItineraryRequest,
    orchestrator: ItineraryOrchestrator = Depends(get_orchestrator),
) -> ItineraryPayload:
    """일정 생성(굵은 경계). 시한 초과는 오류가 아니라 MINIMAL 폴백 200이다(TRIP-291)."""
    return _guarded(lambda: to_payload(orchestrator.generate(body)))


@router.post("/validate", response_model=ValidateItineraryResponse)
def validate(
    body: ValidateItineraryRequest,
    orchestrator: ItineraryOrchestrator = Depends(get_orchestrator),
) -> ValidateItineraryResponse:
    """편집 재검증(HC1~4). 위반은 정상 응답 200 — 변경 차단 판단은 백엔드 몫이다.

    `unverified_slots`는 위반이 **아니다** — POI 정본을 못 찾아 HC1·HC2를 아예 못
    본 슬롯이다(TRIP-537). 위반 0 + 이 목록 비어 있음 = 진짜 통과.
    """

    def run() -> ValidateItineraryResponse:
        outcome = orchestrator.validate(body)
        return ValidateItineraryResponse(
            # 위치 인덱스는 요청으로 받은 itinerary를 스캔해 계산한다(수퍼셋 발신)
            violations=[
                to_violation(v, body.itinerary.days) for v in outcome.violations
            ],
            unverified_slots=[to_unverified(u) for u in outcome.unverified],
        )

    return _guarded(run)


@router.post("/repair", response_model=RepairItineraryResponse)
def repair(
    body: RepairItineraryRequest,
    orchestrator: ItineraryOrchestrator = Depends(get_orchestrator),
) -> RepairItineraryResponse:
    """Plan-B 최소 조정(시각·순서만, POI 불변). 수리 불가면 `repaired=null` + 200(IO-7)."""

    def run() -> RepairItineraryResponse:
        outcome = orchestrator.repair(body)
        return RepairItineraryResponse(
            repaired=to_payload(outcome.repaired) if outcome.repaired else None,
            changes=list(outcome.changes),
            unverified_slots=[to_unverified(u) for u in outcome.unverified],
        )

    return _guarded(run)


@router.post("/alternatives", response_model=AlternativesResponse)
def alternatives(
    request: AlternativesRequest,
    orchestrator: ItineraryOrchestrator = Depends(get_orchestrator),
) -> AlternativesResponse:
    """Plan-B 대안 제안 (TRIP-428) — KB 검색 + closed-set 교차 + LLM 선택(폴백: 규칙 랭킹).

    응답에 시각·순서·소요시간 없음(INV-2·3) — 선택된 대안의 배치 확정은 repair 몫.
    구형 조립(alternatives 미구현 오케스트레이터)은 503으로 명시 실패한다(INV-4).
    """
    handler = getattr(orchestrator, "alternatives", None)
    if handler is None:
        raise orchestrator_not_wired()
    return _guarded(lambda: handler(request))


@router.post("/replan", response_model=ReplanResponse)
def replan(
    request: ReplanRequest,
    orchestrator: ItineraryOrchestrator = Depends(get_orchestrator),
) -> ReplanResponse:
    """하루 재계획 (i04 → i06) — `generate` 재사용을 그만둔 자리.

    정본: `backend/docs/design/ai-backend-replan-연동-설계.md`. `generate` 와 다른 것은
    셋이다 — RAG(KB-3)를 탄다 · 재계획 의도(사유·지시·자유입력)를 받는다 · 원 일정을
    컨텍스트이자 후보로 받는다. 산출은 `ItineraryPayload` 라 백엔드 소비 코드가 그대로 돈다.

    **조립이 아직 이 경계를 구현하지 않으면 503 으로 명시 실패한다**(INV-4 — 침묵 금지).
    하루 전체를 다시 짜려면 선호 점수 단계가 필요한데 그것은 ScheduleAgent 소유이고,
    오케스트레이터가 `REPLAN` 정보 요구표로 그 경로를 여는 작업이 따로 진행 중이다.
    빈 일정을 `empty_reason` 으로 위장해 200 을 내보내지 않는다 — "후보가 없다"와
    "아직 배선이 없다"는 다른 사실이고, 섞으면 백엔드가 폴백 여부를 잘못 판정한다.
    """
    handler = getattr(orchestrator, "replan", None)
    if handler is None:
        raise orchestrator_not_wired()
    return _guarded(lambda: handler(request))


@router.post("/explanations", response_model=ExplanationsResponse)
def explanations(
    request: ExplanationsRequest,
    orchestrator: ItineraryOrchestrator = Depends(get_orchestrator),
) -> ExplanationsResponse:
    """슬롯별 설명 조회 (TRIP-479) — generate(include_explanations=false)와 짝.

    설명은 부가 정보다: LLM 실패도 200 + 빈 맵 + 사유로 나간다(침묵 금지, INV-4).
    구형 조립(미구현 오케스트레이터)은 503 명시 실패.
    """
    handler = getattr(orchestrator, "explanations", None)
    if handler is None:
        raise orchestrator_not_wired()
    return _guarded(lambda: handler(request))


@router.post("/edit", response_model=EditItineraryResponse)
def edit(
    request: EditItineraryRequest,
    orchestrator: ItineraryOrchestrator = Depends(get_orchestrator),
) -> EditItineraryResponse:
    """일정 편집 (TRIP-431) — 자연어·구조화 겸용, 단일 처리 로직 수렴.

    번역(자연어)·검증(closed-set)·확인 게이트·재타이밍·어셈블리 검증을 거쳐
    통과분만 반영한다(INV-1·2·4). 구형 조립은 503 명시 실패.
    """
    handler = getattr(orchestrator, "edit", None)
    if handler is None:
        raise orchestrator_not_wired()
    return _guarded(lambda: handler(request))


# ───────────────── Reflect 경계 (TRIP-429 — /ai/v1/reflection) ─────────────────
reflection_router = APIRouter(prefix="/ai/v1/reflection", tags=["reflection"])


@reflection_router.post("/generate", response_model=ReflectionGenerateResponse)
def reflection_generate(
    request: ReflectionGenerateRequest,
    orchestrator: ItineraryOrchestrator = Depends(get_orchestrator),
) -> ReflectionGenerateResponse:
    """회고 연출 템플릿 생성 (TRIP-429 — U6 FD Phase 1, 계약 §5).

    N회 생성(≤3) → 결정론 랭킹 → 하드 위반 결정론 교체. 전 시도 파싱 실패면
    고정 폴백 템플릿 200 (is_fallback=true — INV-4, 침묵 금지). 응답에
    시각·순서·duration 필드 자체가 없다(INV-3). 구형 조립은 503 명시 실패.
    """
    handler = getattr(orchestrator, "reflection_generate", None)
    if handler is None:
        raise orchestrator_not_wired()
    return _guarded(lambda: handler(request))


@reflection_router.post("/nudge", response_model=ReflectionNudgeResponse)
def reflection_nudge(
    request: ReflectionNudgeRequest,
    orchestrator: ItineraryOrchestrator = Depends(get_orchestrator),
) -> ReflectionNudgeResponse:
    """회고 유도 푸시 문구 1건 (TRIP-429 — 기존 REFLECTION_NUDGE 세트 노출).

    LLM 실패·게이트 드롭 시 결정론 기본 문구 200 (is_fallback=true — INV-4).
    구형 조립은 503 명시 실패.
    """
    handler = getattr(orchestrator, "reflection_nudge", None)
    if handler is None:
        raise orchestrator_not_wired()
    return _guarded(lambda: handler(request))


@reflection_router.post("/share-card", response_model=ShareCardCopyResponse)
def reflection_share_card(
    request: ReflectionGenerateRequest,
    orchestrator: ItineraryOrchestrator = Depends(get_orchestrator),
) -> ShareCardCopyResponse:
    """j06 공유 카드 문구 — 캡션 1문단 + 해시태그 (TRIP-429 후속).

    요청 스키마는 `/generate`와 동일(회고와 같은 재료). 경계가 워커를 직접 부른다
    (U6 Reflect FD §2.1 워커 직행 — 판단 없는 단발 변환이라 에이전트를 두지 않는다).
    LLM 실패·게이트 전량 탈락 시 결정론 정적 조립 200 (is_fallback=true — INV-4).
    카드 이미지(통계·동선·워터마크)는 이 경계 밖이다. 구형 조립은 503 명시 실패.
    """
    handler = getattr(orchestrator, "reflection_share_card", None)
    if handler is None:
        raise orchestrator_not_wired()
    return _guarded(lambda: handler(request))


# ───────────── Plan-B 경계 별칭 (/ai/v1/planb — TRIP-960 1단계) ─────────────
#
# **같은 핸들러 함수를 두 경로에 단다.** 사본을 만들지 않는 것이 요점이다 — 한쪽만
# 고쳐져 갈라지는 것이 이 별칭이 막으려는 바로 그 사고다.
#
# 왜 경로를 가르나: AI 경계 7종이 전부 `/ai/v1/itinerary/` 한 이름 아래 있어서
# **여행 전 생성**과 **여행 중 변수 대응**이 경로로 구별되지 않았고, 그 혼동이 실제
# 배선 오류로 이어졌다(PlanBAgent 가 변수 대응 경로에 없고 백지 생성 에이전트가
# 거기 있었다 — #744 가 고쳤다). 경로 이름이 "어느 단계·어느 에이전트"인지 말해주면
# 같은 뒤바뀜이 리뷰에서 보인다.
#
# **구 경로를 지금 지우지 않는다.** 백엔드 `HttpScheduleAgentAdapter.CALLED_PATHS` 가
# 아직 구 경로를 들고 있어, 여기서 먼저 지우면 전부 404 다. 순서는 TRIP-960 에 있다:
# ① AI 가 새 경로 + 별칭을 연다(이 커밋) → ② BE 가 상수를 바꾼다 → ③ 실왕복 확인 →
# ④ AI 가 구 경로를 지운다. ④ 의 조건은 `CALLED_PATHS` 에 구 경로가 0건인 것이다.
planb_router = APIRouter(prefix="/ai/v1/planb", tags=["planb"])

# `add_api_route` 로 **함수 객체를 그대로** 단다(데코레이터 중복 선언이 아니다).
# 이름을 달리 주는 이유: FastAPI 가 operationId 를 라우트 이름에서 만들어서, 같은
# 이름이면 openapi 에 중복 operationId 가 생기고 클라이언트 생성기가 한쪽을 덮는다.
planb_router.add_api_route(
    "/replan", replan, methods=["POST"],
    response_model=ReplanResponse, name="planb_replan",
)
planb_router.add_api_route(
    "/alternatives", alternatives, methods=["POST"],
    response_model=AlternativesResponse, name="planb_alternatives",
)


# ───────────── 리마인드 알림 문구 경계 (TRIP-836 — /ai/v1/notification) ─────────────
notification_router = APIRouter(prefix="/ai/v1/notification", tags=["notification"])


@notification_router.post("/copies", response_model=ReminderCopyResponse)
def notification_copies(
    request: ReminderCopyRequest,
    orchestrator: ItineraryOrchestrator = Depends(get_orchestrator),
) -> ReminderCopyResponse:
    """리마인드 알림 문구 배치 생성 (설계: specs/2026-09-08-reminder-copy-local-llm-design.md).

    생성 실패·게이트 드롭 항목은 copies 에서 빠지고 degraded=true 로 알린다 —
    그 자리는 백엔드가 기존 하드코딩 상수로 채운다(INV-4, 침묵 금지).
    구형 조립은 503 명시 실패.

    **예산 안내(`request_meta.deadline_ms`)**: 항목별로 순차 호출하므로 비용이
    `len(items)` 에 비례한다 — **이 경계에서는 `deadline_ms` 를 생략**해서 다른
    인터랙티브 경계의 5~20s 예산을 재사용하지 말 것(항목 수가 조금만 늘어도 매
    항목이 타임아웃한다). 생략하면 게이트웨이 기본 타임아웃(~10s)이 항목마다
    안전망으로 남는다 — 다만 그 상한도 항목당이라, 서빙이 콜드스타트 있는 서버리스
    타깃이면 콜드스타트 직후 첫 배치가 드롭되는 것은 정상 동작이다.
    """
    handler = getattr(orchestrator, "reminder_copy", None)
    if handler is None:
        raise orchestrator_not_wired()
    return _guarded(lambda: handler(request))
