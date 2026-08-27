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
from typing import Literal

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
    """IO-1 — 지연 예산 전파. 값은 백엔드 소유(종전 day1 5s / 전체 20s).

    `deadline_ms` 미지정 = **시간제약 없음** (2026-08-21 FE 연동 팀 결정, TRIP-473)
    — 예산 계단(INV-4)은 그대로 두고 시간 때문에 강등되지 않게만 한다. 제약을
    재도입하려면 백엔드가 값을 다시 싣기만 하면 된다(AI 재작업 없음).
    """

    request_id: str = Field(min_length=1)
    requested_at: dt.datetime
    deadline_ms: int | None = Field(default=None, gt=0)


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
    """날짜·시각이 확정된 필수방문지(HC3). ANYTIME(시각 미지정) 필수방문의
    물질화는 백엔드 소유(MustVisitMaterializer, 경계 계약 M1) — AI는 확정된 블록만 받는다."""

    poi_id: str = Field(min_length=1)
    date: dt.date
    start: dt.time
    # dwell_min 만 선택 유지 — 백엔드 MustVisitMaterializer 가 null 을 그대로 싣는다
    # (MustVisitMaterializer.kt:70 → GenerateItineraryService.kt:226). 미지정은 wiring 이 60분 적용.
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
    # 설명 생략 (TRIP-479) — 설명은 POST /ai/v1/itinerary/explanations로 별도 조회
    include_explanations: bool = True

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


class UnplacedMustVisitSchema(BoundaryModel):
    """미배치 필수방문 보고 1건 (TRIP-350 — PR #104에서 확정한 회신 계약).

    배경(TRIP-328): 백엔드가 기간 밖 must_visit을 fixed_blocks에 실어 보내면
    HC3가 범위 밖 날짜를 스킵해 **침묵 드롭**됐다 — 이 필드가 "왜 안 들어갔는지"를
    돌려준다. `reason_code`는 **닫힌 집합**(백엔드가 분기·화면 문구에 사용):

    - `OUT_OF_RANGE`: 고정 블록 날짜가 여행 기간(trip_context) 밖
    - `WINDOW_CONFLICT`: 기간 안 미배치 + 다른 고정 블록과 시간 겹침이 증명됨
    - `NO_FEASIBLE_SLOT`: 그 외 미배치 (기간 안·겹침 없음인데 해에 없음)
    """

    poi_id: str = Field(min_length=1)
    reason_code: Literal["OUT_OF_RANGE", "NO_FEASIBLE_SLOT", "WINDOW_CONFLICT"]


class ItineraryPayload(BoundaryModel):
    """일정 산출물 — generate 응답이자 validate/repair 요청 본문(같은 형태를 왕복한다).

    `solve_mode`는 AI 4값(OR_TOOLS|LLM|RULE_FALLBACK|MINIMAL)을 그대로 보낸다.
    백엔드 3값(FULL_AI|DETERMINISTIC|MINIMAL)으로의 축약은 어댑터가 소유한다(ScheduleAgentWire).
    `explanations` 키 규약 = `"{date}#{poi_id}"` (BR-U2-04), 문구는 시각·소요시간을 언급하지 않는다.
    `unplaced_must_visits`는 additive(기본 빈 리스트 = 전부 배치됨) — generate 응답의
    부분 성공(200) 보고 채널이다. 해소 불가 모순의 409 경로는 그대로다(약화 금지).
    validate/repair 요청으로 왕복될 때는 판정 컨텍스트가 없으므로 소비하지 않는다.
    """

    days: list[DayScheduleSchema] = Field(default_factory=list)
    day1_ready_at: dt.datetime | None = None
    explanations: dict[str, str] = Field(default_factory=dict)
    solve_mode: str
    is_fallback: bool = False
    freshness: FreshnessMetaSchema | None = None
    candidates_summary: CandidatesSummarySchema | None = None
    unplaced_must_visits: list[UnplacedMustVisitSchema] = Field(default_factory=list)


# ───────────────────────── 검증 / 수리 ─────────────────────────


class ViolationSchema(BoundaryModel):
    """하드 제약 위반 1건 — AI 도메인 표현(`code`/`slot_ref`) + 위치 인덱스 **수퍼셋**.

    백엔드 도메인은 `(type, dayIndex, slotIndex)`로 지시한다. AI 도메인 타입에는 위치
    인덱스가 없지만, **직렬화 시점에 일정(days)을 스캔해 계산**해서 함께 실어 보낸다
    (routes.locate_slot) — 백엔드 어댑터는 code→type 매핑만 하면 된다.
    `slot_ref`가 일정 어디에도 없으면(예: HC3 미배치 위반 — 슬롯이 없어서 위반인 것)
    인덱스는 null이다. 지어내지 않는다.
    """

    code: str
    slot_ref: str | None = None
    detail: str = ""
    day_index: int | None = None
    slot_index: int | None = None


class UnverifiedSlotSchema(BoundaryModel):
    """HC 판정에서 **제외된** 슬롯 1건 (TRIP-537) — 위반이 아니라 "판정 못 함"이다.

    HC1(영업시간)·HC2(이동)는 POI 정본을 못 찾으면 그 슬롯을 건너뛴다("정보 없음은
    막지 않는다", c2 규칙 — 그대로 유지). 그런데 스킵이 응답에 아무 흔적을 남기지
    않아 `violations: []` 가 "전부 통과"로 읽혔다(INV-4 침묵 실패의 완곡한 형태).
    이 목록이 "무엇을 못 봤는지"를 드러낸다 — **violations와 섞지 않는다**.

    `reason_code`는 **닫힌 집합**(백엔드가 분기·화면 문구에 사용):
    - `NOT_REGISTERED`: POI 정본(place-data)이 그 id를 안 돌려줬다 — 미등록·비ACTIVE
    - `UNMAPPABLE`: 돌려줬으나 판정에 쓸 수 없다 — `detail`이 원인 필드명
      (좌표 null·모르는 category/data_quality 등, 즉 경계 enum 드리프트가 여기로 온다)
    """

    poi_id: str = Field(min_length=1)
    reason_code: Literal["NOT_REGISTERED", "UNMAPPABLE"]
    detail: str = ""


class ValidateItineraryRequest(BoundaryModel):
    """`POST /ai/v1/itinerary/validate` — 백엔드 포트 `validate(solution)` 대응 + IO-1."""

    itinerary: ItineraryPayload
    request_meta: RequestMetaSchema


class ValidateItineraryResponse(BoundaryModel):
    """빈 목록 = 위반 없음. 상태코드는 200(위반은 정상 응답, IO-7).

    `unverified_slots`(TRIP-537)는 additive — 기본 빈 리스트 = **모든 슬롯이 HC1·HC2
    판정을 받았다**. 비어 있지 않으면 "위반 0"의 의미가 다르다: 그 슬롯들은 통과한
    것이 아니라 검사되지 않았다. 위반 목록과 섞지 않는 이유가 그것이다.
    """

    violations: list[ViolationSchema] = Field(default_factory=list)
    unverified_slots: list[UnverifiedSlotSchema] = Field(default_factory=list)


class RepairItineraryRequest(BoundaryModel):
    """`POST /ai/v1/itinerary/repair` — 백엔드 포트 `repair(solution, violations)` 대응 + IO-1."""

    itinerary: ItineraryPayload
    violations: list[ViolationSchema] = Field(default_factory=list)
    request_meta: RequestMetaSchema


class RepairItineraryResponse(BoundaryModel):
    """`repaired=null` = 수리 불가(정상 응답, IO-7) — 오류가 아니다.

    `unverified_slots`는 validate와 같은 의미다(TRIP-537): 수리 결과도 그 슬롯들에
    대해서는 HC1·HC2를 못 본 채 나온 것이라, 검증 경로에만 싣고 여기서 빼면 같은
    침묵이 수리 경로로 되돌아온다(Plan-B는 validate 없이 repair만 부르기도 한다).
    """

    repaired: ItineraryPayload | None = None
    changes: list[str] = Field(default_factory=list)
    unverified_slots: list[UnverifiedSlotSchema] = Field(default_factory=list)


# ───────────────────────── 오류 ─────────────────────────


class ErrorBody(BoundaryModel):
    """오류 바디(경계 계약 PR #104). AI가 200을 내면 백엔드는 폴백하지 않는다 —
    폴백(INV-4) 발동 신호는 **이 바디를 동반한 4xx/5xx뿐**이다."""

    error_code: str
    message: str
    retryable: bool = False


# ── Plan-B 대안 제안 경계 (TRIP-428, 에픽 TRIP-424) ──────────────────


class CoordSchema(BoundaryModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class TriggerSchema(BoundaryModel):
    """백엔드 planb-detection(C9) 트리거의 와이어 형태 — domain TriggerParams 대응."""

    kind: str = Field(min_length=1)  # WEATHER|CLOSURE|DELAY|MANUAL
    schedule_id: str = Field(min_length=1)
    affected_date: dt.date
    payload: dict = Field(default_factory=dict)


class SavedPlaceSchema(BoundaryModel):
    """사용자가 저장한 장소 1건 — 백엔드 `saved_place`(account_id, poi_id) 의 경계 표현.

    이름을 함께 받는 것은 LLM 컨텍스트에 "저장한 장소 — 성산일출봉" 처럼 실을 수 있어야
    해서다. 저장 시각·메모는 받지 않는다 — 랭킹에도 프롬프트에도 쓰지 않는다(목적 최소화,
    SECURITY-11/G181).
    """

    poi_id: str = Field(min_length=1)
    name: str = ""


class AlternativesRequest(BoundaryModel):
    """대안 제안 요청 — 후보 풀은 AI가 앵커 반경으로 직접 만든다(INV-1, M7 소유).

    시각·순서를 받지도 내보내지도 않는다 — 선택된 대안의 확정 배치는 기존
    repair 관문 몫이다(INV-2). budget/transport 토큰은 generate 와이어와 동일
    어휘("중간"·"대중교통" 등 — wiring의 번역표가 흡수).
    """

    trigger: TriggerSchema
    reason: str = "none"  # weather|closed|delay|canceled|fatigue|none
    anchor: CoordSchema
    dates: list[dt.date] = Field(min_length=1)  # 재계획 대상 날짜(풀 반경·영업일 필터)
    budget_level: str | None = None
    transport_mode: str | None = None
    excluded_poi_ids: list[str] = Field(default_factory=list)
    # 대체 대상 슬롯의 원래 추천 이유 (TRIP-516) — 백엔드 visit_slot.placement_reason.
    # 선택 필드(하위호환): {poi_id: 문장}. LLM이 원래 취지를 잇는 대안을 고르게 한다.
    affected_reasons: dict[str, str] = Field(default_factory=dict)
    # 사용자가 저장(찜)한 장소 (TRIP-512) — 백엔드 saved_place 에서 온다.
    # 선택 필드(하위호환). **후보 자격을 만들지 않는다**(INV-1은 closed_set_filter 소유) —
    # 풀 안에서의 우선순위와 LLM 컨텍스트에만 쓰인다. 벡터 KB-2 대신 봉투로 받는 이유는
    # ① 백엔드 saved_place 에 메모·리뷰 컬럼이 없어 임베딩할 자유 텍스트가 없고
    # ② 규칙 랭킹이 실제로 쓰는 것은 poi_id 집합뿐이며
    # ③ 봉투는 AI 에 적재되지 않아 계정 파기 캐스케이드 부채를 만들지 않는다.
    saved_places: list[SavedPlaceSchema] = Field(default_factory=list)
    request_meta: RequestMetaSchema


class AlternativeSchema(BoundaryModel):
    label: str
    poi_ids: list[str]
    rationale: str


class AlternativesResponse(BoundaryModel):
    """시각·순서·소요시간 없음(INV-2·3) — 제안과 강등 상태·드롭 사유만 나간다."""

    alternatives: list[AlternativeSchema]
    is_fallback: bool
    fallback_level: int  # 0=LLM 정상 · 1=규칙 랭킹 · 2=후보 0
    notes: list[str]
    retrieved: dict[str, int]
    dropped_out_of_pool: list[str]  # closed-set 밖이라 버려진 참조 (INV-1 가시화)
    empty_reason: str | None = None
    pool_size: int = Field(ge=0)


# ── 설명 분리 경계 (TRIP-479) ────────────────────────────────────────


class ExplanationsRequest(BoundaryModel):
    """배치 일정의 슬롯별 설명 조회 — generate(include_explanations=false)와 짝.

    페르소나는 generate와 같은 trip_id 파생 참조로 해석한다(D31 자기참조,
    TRIP-333 fail-closed 유지). 시각·순서는 받기만 하고 바꾸지 않는다(INV-2).
    """

    trip_id: str = Field(min_length=1)
    itinerary: ItineraryPayload
    request_meta: RequestMetaSchema


class ExplanationsResponse(BoundaryModel):
    """slot_key(BR-U2-04: "날짜#poi_id") → 설명 1문장. 실패는 빈 맵 + 사유(침묵 금지)."""

    explanations: dict[str, str]
    is_fallback: bool
    reason: str | None = None


# ── 편집 경계 (TRIP-431 — 자연어·구조화 겸용, 단일 처리 로직 수렴) ────


class EditCommandSchema(BoundaryModel):
    """편집 명령 와이어 형태 — domain EditCommand 대응. 시각 필드 없음(INV-2·3)."""

    op: str = Field(min_length=1)  # EditOp closed-set — 밖 값은 422/거부
    params: dict = Field(default_factory=dict)
    affected_slots: list[str] = Field(default_factory=list)


class EditItineraryRequest(BoundaryModel):
    """일정 편집 요청 — `command`(구조화)와 `utterance`(자연어) 중 **정확히 하나**.

    두 진입은 같은 처리 로직으로 수렴한다(팀 결정 2026-08-22): 자연어는
    EDIT_TRANSLATION 워커가 EditCommand로 번역하고, 이후 경로는 동일하다.
    anchor·기간은 후보 풀 재조립용(INV-1 — 추가·교체 대상 검증). 파괴적 편집은
    1차 응답 CONFIRM_REQUIRED → 사용자 확인 후 `confirm=true` 재호출로 반영한다.
    """

    trip_id: str = Field(min_length=1)
    itinerary: ItineraryPayload
    target_date: dt.date
    anchor: CoordSchema
    budget_level: str | None = None
    transport_mode: str | None = None
    command: EditCommandSchema | None = None
    utterance: str | None = Field(default=None, min_length=1)
    confirm: bool = False
    request_meta: RequestMetaSchema

    @model_validator(mode="after")
    def _exactly_one_entry(self) -> "EditItineraryRequest":
        if (self.command is None) == (self.utterance is None):
            raise ValueError("command와 utterance 중 정확히 하나만 보내야 한다")
        return self


class EditItineraryResponse(BoundaryModel):
    """편집 결과 — 시각·순서는 APPLIED일 때만, 그것도 솔버 검증값만(INV-2).

    REJECTED는 위반 목록 또는 사유를 반드시 싣는다(침묵 거부 금지, INV-4).
    """

    status: str  # APPLIED | CONFIRM_REQUIRED | REJECTED | TRANSLATION_FAILED
    command: EditCommandSchema | None = None
    apply_mode: str | None = None  # AUTO_APPLY | CONFIRM_REQUIRED
    itinerary: ItineraryPayload | None = None
    violations: list[ViolationSchema] = Field(default_factory=list)
    reason: str | None = None


# ───────────────── Reflect 경계 (TRIP-429 — U6 FD v1.0, 계약 §5) ─────────────────
# 요청은 도메인 ReflectionRequest와 동형(백엔드가 방문·이벤트·페르소나를 조립,
# AI stateless). 응답은 ReflectionTemplate.to_dict()와 동형 — **시각·순서·duration
# 필드 자체가 없다** (INV-2 비적용 구조화 + INV-3).


class VisitRefSchema(BoundaryModel):
    date: dt.date
    poi_id: str = Field(min_length=1)


class VisitRecordSchema(BoundaryModel):
    """방문 기록 1건 — 시각·체류분 필드 없음 (INV-3 원천 차단). 순서는 백엔드 실측값."""

    ref: VisitRefSchema
    poi_name: str
    category: str
    order_in_day: int = Field(ge=1)
    photo_count: int = Field(ge=0)


class TripEventRecordSchema(BoundaryModel):
    kind: str  # SourceEventKind 값 (PLAN_B | SKIPPED) — 도메인 승격 시 검증
    date: dt.date
    detail: str


class ReflectionGenerateRequest(BoundaryModel):
    """회고 템플릿 생성 요청 — visits ≥ 1 (0건은 트리거 단에서 미발생, 이중 방어는 도메인)."""

    request_meta: RequestMetaSchema
    kind: str  # ReflectionKind 값 — 도메인 승격 시 검증
    region: str
    start_date: dt.date
    end_date: dt.date
    visits: list[VisitRecordSchema] = Field(min_length=1)
    events: list[TripEventRecordSchema] = Field(default_factory=list)
    persona_summary: str = ""
    weather_summary: str = ""


class PhotoSlotSchema(BoundaryModel):
    visit_ref: VisitRefSchema


class SceneSchema(BoundaryModel):
    layout: str  # SceneLayout 값
    caption: str
    photo_slot: PhotoSlotSchema | None = None
    source_event: str | None = None


class CoverSchema(BoundaryModel):
    title: str
    subtitle: str
    photo_slot: PhotoSlotSchema | None = None


class ReflectionGenerateResponse(BoundaryModel):
    """ReflectionTemplate.to_dict()와 동형 — is_fallback은 강등 정직 보고 (INV-4)."""

    template_id: str
    kind: str
    format: str
    generated_at: dt.datetime
    is_fallback: bool
    cover: CoverSchema
    scenes: list[SceneSchema]
    hashtags: list[str] = Field(default_factory=list)


class ReflectionNudgeRequest(BoundaryModel):
    """회고 유도 문구 요청 — duration_days는 입력 메타(문구 소재)지 표시값이 아니다."""

    request_meta: RequestMetaSchema
    destination: str
    # 와이어 필드명에 duration 토큰 금지(INV-3 계약 가드) — 도메인 입력의
    # duration_days(문구 소재 메타)로 승격 시 이름만 바꾼다
    trip_days: int = Field(ge=1)
    persona_summary: str = ""
    highlight_places: list[str] = Field(default_factory=list, max_length=2)


class ReflectionNudgeResponse(BoundaryModel):
    message: str
    is_fallback: bool
