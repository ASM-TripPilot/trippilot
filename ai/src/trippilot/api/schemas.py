"""경계 요청·응답 스키마 (snake_case) — 백엔드 Kotlin DTO와 1:1 대응.

**필드 정본**은 백엔드가 실제로 보내고 받는 형태다:
`backend/modules/itinerary-generation/.../domain/ScheduleAgentPort.kt`
(+ 응답 수신 측 와이어 타입 `adapter/out/external/ScheduleAgentWire.kt`).
개념 정본은 `agent-io-contracts.md` §1.2 / §0.1, 공통 규약은 §6(IO-1~IO-7).

규약:
- 네이밍: snake_case (camelCase 변환은 백엔드 어댑터 소유 — §0 경계 표)
- **INV-3**: 표시 슬롯에 소요시간류(`duration`·`*_minutes`·`stay_min`) 필드를 두지 않는다.
  거리 문자열(`distance_range`)만 노출한다. 백엔드 계약 테스트가 `shouldNotContain "minutes"`
  로 이 규약을 검사하므로, 필드를 늘릴 때 이름부터 확인할 것.
- **INV-2**: 시각(`start_at`/`end_at`)은 솔버 검증값을 사영한 것만 담는다 (routes 변환부 참조).
- `extra="forbid"`: 모르는 필드는 **조용히 무시하지 않고 422로 드러낸다**. 계약 드리프트를
  침묵으로 흡수하면(예: `excluded_poi_ids` 오타) 기능이 조용히 무력화된다 — 백엔드가 미지
  `solve_mode`를 실패시키는 것과 같은 방향(INV-4 침묵 실패 금지).
"""

from __future__ import annotations

# `date`·`start`·`end` 는 계약상 **필드명**이라 `from datetime import date` 로 들여오면
# 클래스 네임스페이스에서 타입이 필드에 가려진다 (`date: date | None` → TypeError:
# unsupported operand for |: 'NoneType'). 모듈 별칭으로 참조해 충돌을 원천 차단한다.
import datetime as dt
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class BoundaryModel(BaseModel):
    """경계 공통 설정 — 미지 필드 금지(드리프트를 침묵시키지 않는다)."""

    model_config = ConfigDict(extra="forbid")


# ───────────────────────── 요청: ScheduleAgentInput ─────────────────────────


class GenerationMode(str, Enum):
    """d11 추천 강도 분기. 백엔드는 Kotlin enum 이름(대문자)을 보낸다."""

    FULLY_AI = "FULLY_AI"
    CO_PLAN = "CO_PLAN"


class RequestMetaSchema(BoundaryModel):
    """IO-1 — 지연 예산 전파. day1 5s / 전체 20s."""

    request_id: str = Field(min_length=1)
    requested_at: dt.datetime
    deadline_ms: int = Field(gt=0)


class TripContextSchema(BoundaryModel):
    destinations: list[str] = Field(min_length=1)
    start_date: dt.date
    end_date: dt.date
    companion_type: str | None = None
    budget_level: str | None = None

    @model_validator(mode="after")
    def _check_range(self) -> "TripContextSchema":
        if self.end_date < self.start_date:
            raise ValueError(f"end_date < start_date: {self.end_date} < {self.start_date}")
        return self


class DayAnchorSchema(BoundaryModel):
    """day별 공간 앵커(등록 숙소 해석 결과 = trip_base_day)."""

    date: dt.date
    lat: float = Field(ge=-90.0, le=90.0)
    lng: float = Field(ge=-180.0, le=180.0)


class TimeWindowSchema(BoundaryModel):
    """날짜별 이용 시각(기본 09–21시). 도메인 TimeWindow와 같은 불변식(start < end)."""

    date: dt.date
    start: dt.time
    end: dt.time

    @model_validator(mode="after")
    def _check_order(self) -> "TimeWindowSchema":
        if self.start >= self.end:
            raise ValueError(f"start < end 위반: {self.start} !< {self.end}")
        return self


class FixedBlockSchema(BoundaryModel):
    """시각 고정 필수방문지(HC3). ANYTIME이면 date/start/dwell_min은 null."""

    poi_id: str = Field(min_length=1)
    date: dt.date | None = None
    start: dt.time | None = None
    dwell_min: int | None = Field(default=None, ge=0)


class PreferenceProfileSchema(BoundaryModel):
    """취향 7축(preference_snapshot)."""

    styles: list[str] = Field(default_factory=list)
    activities: list[str] = Field(default_factory=list)
    food_tastes: list[str] = Field(default_factory=list)
    transport_modes: list[str] = Field(default_factory=list)
    pace: str | None = None
    companion_types: list[str] = Field(default_factory=list)
    pet_friendly: bool = False
    budget_tier: str | None = None


class GenerateItineraryRequest(BoundaryModel):
    """`POST /ai/v1/itinerary/generate` 요청 = 백엔드 `ScheduleAgentInput`.

    day1 2단계 생성(TRIP-293): 1차 `time_windows=[day1]`·`deadline_ms=5000`,
    2차 `time_windows=[나머지]`·`excluded_poi_ids=[1차 배정 POI]`.
    """

    trip_id: str = Field(min_length=1)
    generation_mode: GenerationMode
    trip_context: TripContextSchema
    anchors: list[DayAnchorSchema] = Field(default_factory=list)
    time_windows: list[TimeWindowSchema] = Field(min_length=1)
    fixed_blocks: list[FixedBlockSchema] = Field(default_factory=list)
    preference_profile: PreferenceProfileSchema
    recommendation_strength: str | None = None
    request_meta: RequestMetaSchema
    excluded_poi_ids: list[str] = Field(default_factory=list)

    @field_validator("generation_mode", mode="before")
    @classmethod
    def _normalize_mode(cls, v: object) -> object:
        # 계약 문서는 소문자(fully_ai), Kotlin enum은 대문자(FULLY_AI) — 둘 다 받는다.
        return v.upper() if isinstance(v, str) else v


# ───────────────────────── 응답: ScheduleAgentOutput ─────────────────────────


class VisitSlotDisplaySchema(BoundaryModel):
    """표시용 방문 슬롯 — 솔버 검증 시각·순서만(INV-2), 거리만(INV-3).

    **소요시간 필드를 추가하지 말 것**: 도메인 `VisitSlot.stay_min`·`score`는
    내부값이라 이 사영에서 의도적으로 제외한다(IO-3).
    """

    poi_id: str
    start_at: dt.time
    end_at: dt.time
    ends_next_day: bool = False
    distance_range: str | None = None
    is_fixed: bool = False


class DayScheduleSchema(BoundaryModel):
    date: dt.date
    slots: list[VisitSlotDisplaySchema] = Field(default_factory=list)


class FreshnessMetaSchema(BoundaryModel):
    """IO-6 — 사용 데이터 신선도. 백엔드는 `fetched_at`→generatedAt, `stale`→degraded로 사영한다."""

    source: str
    fetched_at: dt.datetime
    cache_hit: bool = False
    ttl_sec: int = 0
    stale: bool = False


class CandidatesSummarySchema(BoundaryModel):
    """후보 충분성(BR-U2-05). 판정은 AI 소유 — 백엔드는 그대로 전달한다.

    `pool_size`는 모르면 null로 둔다(0은 "후보 0건"이라는 판정으로 읽힌다).
    """

    level: str
    pool_size: int | None = None
    shortfall_categories: list[str] = Field(default_factory=list)


class ItineraryPayload(BoundaryModel):
    """일정 산출물 — generate 응답이자 validate/repair 요청 본문(같은 형태를 왕복한다).

    `solve_mode`는 AI 4값(OR_TOOLS|LLM|RULE_FALLBACK|MINIMAL)을 그대로 보낸다.
    백엔드 3값(FULL_AI|DETERMINISTIC|MINIMAL)으로의 축약은 어댑터가 소유한다(ScheduleAgentWire).
    `explanations` 키 규약 = `"{date}#{poi_id}"` (BR-U2-04), 문구는 시각·소요시간을 언급하지 않는다.
    """

    days: list[DayScheduleSchema] = Field(default_factory=list)
    day1_ready_at: dt.datetime | None = None
    explanations: dict[str, str] = Field(default_factory=dict)
    solve_mode: str
    is_fallback: bool = False
    freshness: FreshnessMetaSchema | None = None
    candidates_summary: CandidatesSummarySchema | None = None


# ───────────────────────── 검증 / 수리 ─────────────────────────


class ViolationSchema(BoundaryModel):
    """하드 제약 위반 1건 — **AI 도메인 표현**(`code`/`slot_ref`).

    백엔드 도메인은 `(type, dayIndex, slotIndex)`로 지시한다 — 대응은 TRIP-282 미결이며,
    여기서 위치 인덱스를 지어내지 않는다(없는 정보를 만들지 않는다).
    """

    code: str
    slot_ref: str | None = None
    detail: str = ""


class ValidateItineraryRequest(BoundaryModel):
    """`POST /ai/v1/itinerary/validate` — 백엔드 포트 `validate(solution)` 대응 + IO-1."""

    itinerary: ItineraryPayload
    request_meta: RequestMetaSchema


class ValidateItineraryResponse(BoundaryModel):
    """빈 목록 = 위반 없음. 상태코드는 200(위반은 정상 응답, IO-7)."""

    violations: list[ViolationSchema] = Field(default_factory=list)


class RepairItineraryRequest(BoundaryModel):
    """`POST /ai/v1/itinerary/repair` — 백엔드 포트 `repair(solution, violations)` 대응 + IO-1."""

    itinerary: ItineraryPayload
    violations: list[ViolationSchema] = Field(default_factory=list)
    request_meta: RequestMetaSchema


class RepairItineraryResponse(BoundaryModel):
    """`repaired=null` = 수리 불가(정상 응답, IO-7) — 오류가 아니다."""

    repaired: ItineraryPayload | None = None
    changes: list[str] = Field(default_factory=list)


# ───────────────────────── 오류 ─────────────────────────


class ErrorBody(BoundaryModel):
    """오류 바디(경계 계약 PR #104). AI가 200을 내면 백엔드는 폴백하지 않는다 —
    폴백(INV-4) 발동 신호는 **이 바디를 동반한 4xx/5xx뿐**이다."""

    error_code: str
    message: str
    retryable: bool = False
