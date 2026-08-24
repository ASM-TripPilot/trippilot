"""경계 라우트 6종 — `POST /ai/v1/itinerary/{generate,validate,repair,alternatives,explanations,edit}`.

도입 티켓: alternatives=TRIP-428 · explanations=TRIP-479 · edit=TRIP-431.
경로 정본: services.md §0 / agent-io-contracts.md §0.1 (구 표기 `/ai/generate`·`/ai/schedule` 폐기).

이 파일이 하는 일은 셋뿐이다:
1. 검증된 요청을 오케스트레이터에 그대로 넘긴다(판단 위임 — 여기서 후보·시각을 만들지 않는다)
2. 도메인 결과를 표시 스키마로 **사영**한다 — 시각은 솔버 검증값(VisitSlot)에서만 온다(INV-2),
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
    RepairItineraryRequest,
    RepairItineraryResponse,
    UnplacedMustVisitSchema,
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

    - 시각: `VisitSlot.start_at/end_at`(솔버 검증값)의 시각 성분만 사영(INV-2)
    - `ends_next_day`: 종료가 그 날짜를 넘겼는가 — 솔버 값에서 파생(HC4 표현)
    - `is_fixed`: 그 날의 고정 블록(HC3)에 POI가 있는가 — 지어내지 않고 해에서 읽는다
    - `stay_min`·`score`는 **사영하지 않는다**(INV-3 / IO-3)
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
    """편집 재검증(HC1~4). 위반은 정상 응답 200 — 변경 차단 판단은 백엔드 몫이다."""
    return _guarded(
        lambda: ValidateItineraryResponse(
            # 위치 인덱스는 요청으로 받은 itinerary를 스캔해 계산한다(수퍼셋 발신)
            violations=[
                to_violation(v, body.itinerary.days) for v in orchestrator.validate(body)
            ]
        )
    )


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

    번역(자연어)·검증(closed-set)·확인 게이트·재타이밍·솔버 검증을 거쳐
    통과분만 반영한다(INV-1·2·4). 구형 조립은 503 명시 실패.
    """
    handler = getattr(orchestrator, "edit", None)
    if handler is None:
        raise orchestrator_not_wired()
    return _guarded(lambda: handler(request))
