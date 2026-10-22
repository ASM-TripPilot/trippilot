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
- **INV-2**: 시각(`start_at`/`end_at`)은 어셈블리 검증값을 사영한 것만 담는다 (routes 변환부 참조).
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


# 자정을 넘는 끝의 상한 — 밤 늦게 만든 오늘을 익일 01:00 까지 연다(2026-10-19 사용자). 넉넉히 04:00.
OVERNIGHT_END_MAX = dt.time(4, 0)


class TimeWindowSchema(BoundaryModel):
    """날짜별 이용 시각(기본 09–21시). 끝이 시작 이하이고 04:00 이하면 **다음 날** 끝(자정을 넘는 창 — 밤 늦게
    만든 오늘, 예 23:00~01:00). 그 밖은 도메인 TimeWindow와 같은 불변식(start < end)."""

    date: dt.date
    start: dt.time
    end: dt.time

    @property
    def overnight(self) -> bool:
        """끝이 다음 날인가 — 시작 이하이면서 새벽(≤ `OVERNIGHT_END_MAX`)일 때만."""
        return self.end <= self.start and self.end <= OVERNIGHT_END_MAX

    @model_validator(mode="after")
    def _check_order(self) -> "TimeWindowSchema":
        if self.start >= self.end and not self.overnight:
            raise ValueError(f"start < end 위반: {self.start} !< {self.end}")
        return self


class FixedBlockSchema(BoundaryModel):
    """필수방문지 1건. `start` 가 있으면 날짜·시각 확정(HC3 핀 — 종전 그대로).

    **`start` 가 null 이면 그 날 꼭 가되 시각은 조립이 정한다(필수 방문, TRIP-1249)** —
    영업시간 안, 식당이면 식사창 안. 종전엔 ANYTIME 을 백엔드(MustVisitMaterializer)가
    창 시작(09:00)에 핀해 보냈는데 늦게 여는 곳이 HC1 에 걸려 하루가 통째로 409 였다.
    `date` 는 여전히 필수 — 날짜까지 미정인 필수방문의 날짜 배정은 백엔드 소유다.
    재계획 `locked_blocks` 는 이 완화를 받지 않는다 — 스키마는 같지만 `start: null` 인 잠금은
    `ReplanRequest` 검증이 422 로 거절한다(잠금은 시각이 정체성)."""

    poi_id: str = Field(min_length=1)
    date: dt.date
    start: dt.time | None = None
    # dwell_min 만 선택 유지 — 백엔드 MustVisitMaterializer 가 null 을 그대로 싣는다
    # (MustVisitMaterializer.kt:70 → GenerateItineraryService.kt:226). 미지정은 핀(start 있음)이면
    # wiring 이 60분, 필수 방문(start null)이면 조립이 카테고리 기본 체류를 적용(0 도 미지정으로 본다).
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


class RejectionSchema(BoundaryModel):
    """거절 이력 한 줄 (TRIP-964) — 백엔드가 여행 단위로 누적해 싣는다.

    **크기는 오지 않는다.** `kind` 만 받고 강등 폭은 AI 설정(`OrchestratorConfig`)이
    갖는다 — 비율 조정에 백엔드 재배포가 필요 없고, 두 서비스가 같은 숫자를 각자
    갖지 않게 한다(팀 결정 2026-09-26).

    `count` 는 **같은 곳을 또 거절했는가**다. 집합만 받으면 "처음"과 "세 번째"가
    구분되지 않아 반복 강등이 불가능하다.
    """

    poi_id: str = Field(min_length=1)
    kind: Literal["SWAPPED_OUT", "REGENERATED"]
    count: int = Field(default=1, ge=1)


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
    # 거절 이력 (TRIP-964) — additive optional. 옛 백엔드는 안 보내고 그때는 빈 목록이다.
    rejections: list[RejectionSchema] = Field(default_factory=list)
    # 설명 생략 (TRIP-479) — 설명은 POST /ai/v1/itinerary/explanations로 별도 조회
    include_explanations: bool = True

    @field_validator("generation_mode", mode="before")
    @classmethod
    def _normalize_mode(cls, v: object) -> object:
        # 계약 문서는 소문자(fully_ai), Kotlin enum은 대문자(FULLY_AI) — 둘 다 받는다.
        return v.upper() if isinstance(v, str) else v


# ───────────────────────── 응답: ScheduleAgentOutput ─────────────────────────


class SlotAlternativeSchema(BoundaryModel):
    """슬롯 차선책 1건 (TRIP-871) — **제안만**: 시각·순서 없음(INV-2 — 교체 확정은
    edit → validate 관문), 거리만(INV-3).

    `rationale` 은 사용자 표시용 템플릿 문장("같은 카페 후보"). `distance_range` 는
    **그 슬롯 POI 에서의** 거리("약 1.2km · 대중교통 추정") — 좌표 미상이면 null.
    """

    poi_id: str = Field(min_length=1)
    rationale: str
    distance_range: str | None = None


class VisitSlotDisplaySchema(BoundaryModel):
    """표시용 방문 슬롯 — 어셈블리 검증 시각·순서만(INV-2), 거리만(INV-3).

    **소요시간 필드를 추가하지 말 것**: 도메인 `VisitSlot.stay_min`·`score`는
    내부값이라 이 사영에서 의도적으로 제외한다(IO-3).
    """

    poi_id: str
    # 시각 nullable (TRIP-827) — **null = 시간 미정(무배치)**. FE 가 "시간대 설정"
    # 칩으로 그리는 그 슬롯이다: 백엔드가 저장은 하는데 이 스키마가 required 라
    # 검증·편집 왕복에서 422 였다. 반쪽(둘 중 하나만 null)은 미정이 아니라 기형이라
    # 경계에서 거절한다. **산출 쪽은 항상 채워진다**(INV-2 — 어셈블리 검증값만
    # 사영되며, 테스트가 산출 null 을 잠근다).
    start_at: dt.time | None = None
    end_at: dt.time | None = None
    ends_next_day: bool = False
    distance_range: str | None = None
    is_fixed: bool = False
    # 슬롯별 차선책 (TRIP-871) — additive, 기본 빈 = 차선책 없음(슬롯당 최대 2건).
    # validate/repair/edit 요청으로 왕복될 때는 소비하지 않는다(unplaced_must_visits 선례).
    alternatives: list[SlotAlternativeSchema] = Field(default_factory=list)


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
    `scoring_mode`·`degradations`는 additive(generate 경로만 실값) — 취향 점수의 출처와
    밟은 강등 계단. `solve_mode`는 어셈블리 단계라 LLM 점수 여부를 말하지 않는다.
    `scoring_mode`: LLM(전 후보 LLM 점수) · MIXED(LLM 점수 + 빠진 후보 규칙 보충) ·
    RULE(규칙 점수만) · null(모름 — repair·replan·왕복 본문). `degradations`: 기계 판독용
    `"{stage}:{사유 접두}"` 코드(예: `llm:c1_fallback`, `weather:weather_error`) —
    자유 문장·시각·시한 값은 싣지 않는다. 빈 목록 = 강등 없음(또는 모름).
    """

    days: list[DayScheduleSchema] = Field(default_factory=list)
    day1_ready_at: dt.datetime | None = None
    explanations: dict[str, str] = Field(default_factory=dict)
    solve_mode: str
    is_fallback: bool = False
    freshness: FreshnessMetaSchema | None = None
    candidates_summary: CandidatesSummarySchema | None = None
    unplaced_must_visits: list[UnplacedMustVisitSchema] = Field(default_factory=list)
    scoring_mode: Literal["LLM", "MIXED", "RULE"] | None = None
    degradations: list[str] = Field(default_factory=list)


# ───────────────────────── 검증 / 수리 ─────────────────────────


class ViolationSchema(BoundaryModel):
    """하드 제약 위반 1건 — AI 도메인 표현(`code`/`slot_ref`) + 위치 인덱스 **수퍼셋**.

    백엔드 도메인은 `(type, dayIndex, slotIndex)`로 지시한다. AI 도메인 타입에는 위치
    인덱스가 없지만, **직렬화 시점에 일정(days)을 스캔해 계산**해서 함께 실어 보낸다
    (routes.locate_slot) — 백엔드 어댑터는 code→type 매핑만 하면 된다.
    `slot_ref`가 일정 어디에도 없으면(예: HC3 미배치 위반 — 슬롯이 없어서 위반인 것)
    인덱스는 null이다. 지어내지 않는다.

    `reason_code`(선택, 상황 감지 H1 · BR-SA-17): HC1 하위 코드 — `CLOSED_DAY`(정기 휴무) ·
    `OUT_OF_HOURS`(그 날 열지만 영업창 밖) · `HOLIDAY`(공휴일·명절·날짜 휴무 — `HOLIDAY_CLOSURE_MODE=on`
    일 때만). 다른 HC 는 null 이다. 백엔드 장소 감지가 알림 변형으로 쓴다 — `detail` 은 파싱하지 않는다.
    """

    code: str
    slot_ref: str | None = None
    detail: str = ""
    day_index: int | None = None
    slot_index: int | None = None
    reason_code: Literal["CLOSED_DAY", "OUT_OF_HOURS", "HOLIDAY"] | None = None


class UnverifiedSlotSchema(BoundaryModel):
    """HC 판정에서 **제외된** 슬롯 1건 (TRIP-537) — 위반이 아니라 "판정 못 함"이다.

    HC1(영업시간)·HC2(이동)는 POI 정본을 못 찾으면 그 슬롯을 건너뛰고, HC1 은 정본이 있어도
    그 날 영업 창을 모르면 건너뛴다("정보 없음은 막지 않는다", c2 규칙 — 그대로 유지). 그런데
    스킵이 응답에 아무 흔적을 남기지 않아 `violations: []` 가 "전부 통과"로 읽혔다(INV-4 침묵
    실패의 완곡한 형태). 이 목록이 "무엇을 못 봤는지"를 드러낸다 — **violations와 섞지 않는다**.

    `reason_code`는 **닫힌 집합**이다(새 값은 백엔드 계약 게이트가 잡는다). 백엔드는 사유로 가르지
    않는다 — 장소 감지의 하루 점검이 어느 사유든 그 슬롯의 영업시간을 '모름'으로 읽는다(상황 감지 INV-SA-2):
    - `NOT_REGISTERED`: POI 정본(place-data)이 그 id를 안 돌려줬다 — 미등록·비ACTIVE
    - `UNMAPPABLE`: 돌려줬으나 판정에 쓸 수 없다 — `detail`이 원인 필드명
      (좌표 null·모르는 category/data_quality 등, 즉 경계 enum 드리프트가 여기로 온다)
    - `HOURS_UNKNOWN`: 정본은 있으나 그 날 영업 창을 모른다(영업 원문 없음·해석 실패 — 둘 다 영업 창 0건), 또는
      특일 달력을 못 읽어 태그형 휴일 규칙을 판정하지 못했다(주간 영업 창은 있음 — `detail` 이 `holiday_calendar_unread`)
      — **HC1 만** 못 봤고 HC2 는 판정됐다. 같은 장소가 여러 날이면 하루라도 못 봤으면 실린다
    """

    poi_id: str = Field(min_length=1)
    reason_code: Literal["NOT_REGISTERED", "UNMAPPABLE", "HOURS_UNKNOWN"]
    detail: str = ""


class ValidateItineraryRequest(BoundaryModel):
    """`POST /ai/v1/itinerary/validate` — 백엔드 포트 `validate(solution)` 대응 + IO-1."""

    itinerary: ItineraryPayload
    request_meta: RequestMetaSchema


class ValidateItineraryResponse(BoundaryModel):
    """빈 목록 = 위반 없음. 상태코드는 200(위반은 정상 응답, IO-7).

    `unverified_slots`(TRIP-537)는 additive — 빈 리스트 = **시각이 있는 모든 슬롯이 HC1·HC2
    판정을 받았다**(시간 미정 슬롯은 시각 주장이 없어 검증 밖이고 여기에도 싣지 않는다). 영업 창을
    모르는 등록 POI 가 `HOURS_UNKNOWN` 으로 실리기 전에는 이 문장이 거짓이었다 — 그 슬롯은 HC1 을
    건너뛰고도 흔적이 없었다(원문이 있어도 해석에 실패한 곳 — 공유본 원문의 8.5%). 비어 있지 않으면
    "위반 0"의 의미가 다르다: 그 슬롯들은 통과한 것이 아니라 검사되지 않았다. 위반 목록과 섞지 않는
    이유가 그것이다. 무엇을 못 봤는지는 `reason_code` 가 말한다(`HOURS_UNKNOWN` 은 HC1 만).
    """

    violations: list[ViolationSchema] = Field(default_factory=list)
    unverified_slots: list[UnverifiedSlotSchema] = Field(default_factory=list)


class RepairItineraryRequest(BoundaryModel):
    """`POST /ai/v1/itinerary/repair` — 백엔드 포트 `repair(solution, violations)` 대응 + IO-1."""

    itinerary: ItineraryPayload
    violations: list[ViolationSchema] = Field(default_factory=list)
    request_meta: RequestMetaSchema
    # 편집 교체 후속(2026-10-05) — additive optional, generate 와 **같은 스키마·의미·어휘**다.
    # 앵커가 있는 날은 첫 구간 거리를 앵커→첫 장소로 채우고, 그 날의 창도 있으면 첫 슬롯 시작을
    # generate 규칙(창 시작 + 앵커 이동) 이상으로 민다. 창은 **출발 시각으로만** 쓴다 — HC4 판정
    # 창은 종전(당일 전체) 그대로라 사용자가 창 밖에 둔 슬롯을 수리 불가로 만들지 않는다.
    # 수단은 generate 의 preference_profile.transport_modes 와 같은 목록·번역표(첫 인식 토큰).
    # 셋 다 없으면 종전 동작(첫 구간 null·PUBLIC).
    anchors: list[DayAnchorSchema] = Field(default_factory=list)
    time_windows: list[TimeWindowSchema] = Field(default_factory=list)
    transport_modes: list[str] = Field(default_factory=list)


class RepairItineraryResponse(BoundaryModel):
    """`repaired=null` = 수리 불가(정상 응답, IO-7) — 오류가 아니다.

    `unverified_slots`는 validate와 같은 의미다(TRIP-537): 수리 결과도 그 슬롯들에
    대해서는 사유가 말하는 HC 를 못 본 채 나온 것이라, 검증 경로에만 싣고 여기서 빼면 같은
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
    reason: str = "none"  # weather|closed|delay|canceled|fully_booked|fatigue|none
    anchor: CoordSchema
    dates: list[dt.date] = Field(min_length=1)  # 재계획 대상 날짜(풀 반경·영업일 필터)
    # 여행 ID — 페르소나 재조회 키 (선택, 하위호환). generate 와 **같은 파생 규칙**을
    # 쓴다(`ResourceRef(kind="persona", ref_id=trip_id)`). 미지정이면 PERSONA 수집을
    # 건너뛴다 — 기능 부재이지 실패가 아니다(INV-4). `trigger.schedule_id` 로 대신할 수
    # 없다: 일정 ID 와 여행 ID 는 다른 키라 파생하면 없는 페르소나를 찾는다.
    trip_id: str | None = Field(default=None, min_length=1)

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
    # 후보 카테고리 제한 (TRIP-1065) — 같이 짜기 컨셉을 백엔드가 경계 코드
    # (FOOD·CAFE·SIGHT·NIGHT_VIEW·NATURE·CULTURE·ACTIVITY·SHOPPING)로 바꿔 보낸다.
    # 풀 단계에서 거르므로 LLM 선택·규칙 폴백 모두 그 안에서만 고른다. 비거나
    # 아는 코드가 하나도 없으면 필터 없음(400 아님 — reason 과 같은 규칙).
    categories: list[str] = Field(default_factory=list)
    # 바꿀 슬롯의 장소 (선택, 하위호환). `categories` 가 비었고 이 장소가 식사(`counts_as_food`)면
    # 풀을 식사 후보로 거른다 — 칼국수 칸의 '다른 후보'에 기찻길이 오던 결함(2026-10-14).
    # 없으면 `affected_reasons` 의 키로 대신한다(그 키도 대상 슬롯이다).
    target_poi_id: str | None = Field(default=None, min_length=1)
    # 그 여행의 취향 (선택, 하위호환) — generate 의 `preference_profile` 과 같은 스키마·어휘.
    # 오면 이 요청의 페르소나(ALTERNATIVE_SELECTION 의 확정 프로필 줄)로 쓰고, 없으면 종전대로
    # `trip_id` 재조회(계정 취향). `companion_type` 은 이 여행의 동행 — 계정의 평소 동행보다 우선.
    preference_profile: PreferenceProfileSchema | None = None
    companion_type: str | None = None
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


# ── 재계획 경계 (A-4) ────────────────────────────────────────────────
# 정본: `backend/docs/design/ai-backend-replan-연동-설계.md` §4·§5.
# `generate` 재사용을 그만두는 이유 세 가지가 그 문서 §1 에 있다 — RAG 를 안 타고,
# 취향을 중립으로 덮고, 재계획 의도를 버린다.


class ReplanSlotSchema(BoundaryModel):
    """원 일정 슬롯 1개 — KB-1 컨텍스트이자 후보 풀 합류 대상.

    `VisitSlotDisplaySchema` 를 재사용하지 않는다: 그것은 **AI 산출물의 사영**이고
    이쪽은 **백엔드가 주는 입력**이다. 모양이 닮아도 방향이 반대라, 한쪽을 고치면
    다른 쪽이 끌려가는 결합을 만들지 않는다. `placement_reason` 은 산출물 쪽엔 없다.
    """

    poi_id: str = Field(min_length=1)
    # 시각 nullable (TRIP-827) — 시간 미정 슬롯도 원 일정의 일부다. 재계획에서
    # 비고정 슬롯의 시각은 아무도 읽지 않으므로(후보 합류는 poi_id, 컨텍스트는
    # placement_reason) null 이 자연스럽다. **is_fixed 인데 시각이 없으면 422** —
    # 시각 없는 고정은 HC3 로 표현 불가다(ANYTIME 백스톱과 같은 규칙).
    start_at: dt.time | None = None
    end_at: dt.time | None = None
    is_fixed: bool = False
    ends_next_day: bool = False
    placement_reason: str | None = None  # visit_slot.placement_reason


class ChangeLogEntrySchema(BoundaryModel):
    """변경 이력 한 건 (TRIP-975) — 백엔드 `change_log_entry`(V2.11, append-only)의 **압축형**.

    백엔드는 전후 **스냅숏 전체**를 갖고 있지만 여기로는 그날의 diff 만 온다. 셋을 일부러 뺐다:
    - 스냅숏 전체 — 원 일정은 `current_slots` 로 이미 온다
    - 시각 — 프롬프트로 새면 근거 문장에 옮겨 적힌다. 시간표현 게이트는 `09:00` 같은 콜론 형식을
      통과시키므로 재료에서 빼는 것이 유일한 방어다(INV-2·INV-3)
    - 행위자(`actor`) — 계정 id 다. 쓸모가 없고 개인 데이터다
    diff 는 **백엔드가 계산한다** — 전후를 둘 다 가진 쪽이 계산하는 것이 맞다.
    """

    source: Literal["PLAN_B", "MANUAL", "COEDIT", "ASSISTANT"]
    reason: str | None = Field(default=None, max_length=500)
    at: dt.datetime  # 정렬 근거일 뿐 — 프롬프트에 싣지 않는다
    removed_poi_ids: list[str] = Field(default_factory=list)
    added_poi_ids: list[str] = Field(default_factory=list)


class ReplanRequest(BoundaryModel):
    """POST /ai/v1/planb/replan — 하루를 다시 짠다 (i04 → i06). (구 itinerary 경로는 TRIP-960 ④ 에서 삭제)

    `generate` 와 **다른 것**: RAG(KB-3)를 탄다 · 재계획 의도를 받는다 ·
    원 일정을 컨텍스트이자 후보로 받는다.
    **같은 것**: 산출이 `ItineraryPayload` 다 — 백엔드 소비 코드가 그대로 돈다.
    """

    trip_id: str = Field(min_length=1)
    trip_context: TripContextSchema
    target_date: dt.date
    time_window: TimeWindowSchema  # 하루 전체. 좁히지 않는다 (정본 §1)
    anchor: CoordSchema
    # 그날 밤 숙소(없으면 전날 숙소) — "숙소 근처에서 끝내기"(END_NEAR_STAY)가 하루를 마칠 곳.
    # `anchor` 와 따로 둔다: 그것은 후보 풀 기준점(GPS·수동·마지막 방문·숙소 중 하나)이라 숙소를
    # 보장하지 않는다. 없으면 그 지시는 무효 노트로 밝힌다.
    stay_anchor: CoordSchema | None = None

    # `scope` 와 `locked_blocks` 는 중복이 아니다 — `locked_blocks` = 못 건드리는 것,
    # `scope` = 안 간 곳 중 어디까지 건드리나. FULL_DAY 여도 방문 완료한 곳은 잠긴다.
    scope: Literal["PARTIAL_SLOTS", "FULL_DAY"]
    from_instant: dt.datetime
    locked_blocks: list[FixedBlockSchema] = Field(default_factory=list)
    # 두 일을 한다: 기존 일정 컨텍스트이자 **후보 풀 합류 대상**. 원 일정 POI 가 새
    # 후보와 같은 PREFERENCE_SCORING 호출에 들어가야 같은 척도로 비교되고, 그래야
    # "원래 자리보다 나은 것만 바꾼다"가 성립한다.
    current_slots: list[ReplanSlotSchema] = Field(default_factory=list)

    reasons: list[str] = Field(default_factory=list)  # AI 어휘 (백엔드가 번역)
    directives: list[str] = Field(default_factory=list)  # FE 키 그대로 — 번역하지 않는다
    # 거절 이력 (TRIP-964) — generate 와 같은 모양. '다시 짜줘'가 실제로 도는 경로가 여기다.
    rejections: list[RejectionSchema] = Field(default_factory=list)
    # 상한 500 은 `replan_session.free_text varchar(500)` 과 같은 값이다.
    # 계약이 DB 보다 좁으면 저장된 값이 경계에서 잘린다.
    free_text: str | None = Field(default=None, max_length=500)
    trigger: TriggerSchema | None = None  # 자리만 — 값은 아직 안 온다 (정본 §2)

    preference_profile: PreferenceProfileSchema
    # **후보 풀 반경을 정하는 값이다** — `radius_km` 가 도보 2km · 대중교통 10km ·
    # 자차 20km 로 갈린다(`poi_curation/config.py`). 없으면 배선이 기본값(대중교통)으로
    # 메우게 되고, 도보 여행자에게 **10km 밖 후보**를 주면서 아무 신호도 남기지 않는다.
    # 어휘는 `alternatives` 와 같다(배선의 번역표가 흡수) — "도보"·"대중교통"·"자차".
    # 예산 등급은 `trip_context.budget_level` 이 이미 갖고 있어 여기 두지 않는다.
    transport_mode: str | None = None
    saved_places: list[SavedPlaceSchema] = Field(default_factory=list)
    excluded_poi_ids: list[str] = Field(default_factory=list)
    # 이 날짜를 건드린 변경 이력, 최신순 (TRIP-975) — 정본 KB-1 표의 "변경 이력", 용도는 **같은 제안
    # 반복 방지**. 기본 빈 목록이라 백엔드가 안 보내도 종전과 같다. 상한 20 은 백스톱이고 주된
    # 제한은 날짜 필터다(실측이 아니라 프롬프트 예산에서 잡은 값).
    change_log: list[ChangeLogEntrySchema] = Field(default_factory=list, max_length=20)
    request_meta: RequestMetaSchema

    @model_validator(mode="after")
    def _locks_have_times(self) -> "ReplanRequest":
        # 잠금은 "못 건드리는 것"이라 시각이 정체성이다 — 시각 없는 잠금은 HC3 로 표현 불가
        # (`current_slots` 의 시각 없는 `is_fixed` 와 같은 규칙, 422). generate 의 시각 없는
        # 필수 방문(조립이 시각을 정함)은 이 경계의 것이 아니다.
        untimed = [b.poi_id for b in self.locked_blocks if b.start is None]
        if untimed:
            raise ValueError(
                f"locked_blocks 에 시각 없는 잠금: {', '.join(untimed)} — 잠금은 start 필수")
        return self


class ReplanEmptyReasonSchema(BoundaryModel):
    """왜 재계획안을 못 만들었나. **문구는 FE 소유** — 여기는 코드와 재료만 준다.

    선례: `UnplacedMustVisitSchema.reason_code`(닫힌 값, 백엔드가 분기·화면 문구에 사용).
    자유 문장으로 두면 i18n·톤 변경이 AI 재배포가 된다.
    """

    code: Literal[
        "NO_CANDIDATE",  # 후보 풀 자체가 비었다
        "ALL_EXCLUDED",  # 후보가 제외 목록에 다 걸렸다
        "NO_FEASIBLE_SLOT",  # 후보는 있으나 HC 를 통과하는 배치가 없다
        "DIRECTIVE_CONFLICT",  # 지시끼리 모순 (예: 실내로 + 야경 코스)
        "UNKNOWN",
    ]
    # 예: {"from": "17:00", "filter": "INDOOR"} → FE 가 "17시 이후 실내 후보가 근처에 없어요"
    params: dict[str, str] = Field(default_factory=dict)


class ReplanResponse(BoundaryModel):
    """재계획안 1안. 못 만들면 `itinerary=null` + `empty_reason` (200, IO-7).

    `diff` 는 여기 없다 — `i08` 의 "바뀐 곳 1 · 이동 −6.9km" 는 `ReplanDiffService` 가
    이미 백엔드에 있고, 원 일정을 가진 쪽이 만드는 것이 맞다.
    """

    itinerary: ItineraryPayload | None = None
    total_distance_km: float | None = Field(default=None, ge=0)

    is_fallback: bool
    fallback_level: int = Field(ge=0, le=2)  # 0=LLM · 1=규칙 · 2=해 없음
    notes: list[str] = Field(default_factory=list)
    retrieved: dict[str, int] = Field(default_factory=dict)  # KB 히트 수
    resolved_directives: list[str] = Field(default_factory=list)
    # 모르는 지시를 **조용히 무시하지 않는다** — 되돌려 보내 FE 가 알릴 수 있게 한다.
    unknown_directives: list[str] = Field(default_factory=list)
    empty_reason: ReplanEmptyReasonSchema | None = None



# ── 설명 분리 경계 (TRIP-479) ────────────────────────────────────────


class ExplanationsRequest(BoundaryModel):
    """배치 일정의 슬롯별 설명 조회 — generate(include_explanations=false)와 짝.

    페르소나는 generate와 같은 trip_id 파생 참조로 해석한다(D31 자기참조,
    TRIP-333 fail-closed 유지). 시각·순서는 받기만 하고 바꾸지 않는다(INV-2).
    """

    trip_id: str = Field(min_length=1)
    itinerary: ItineraryPayload
    # 그 여행의 취향 (선택, 하위호환) — `AlternativesRequest` 와 같은 규칙. 없으면 종전 재조회.
    preference_profile: PreferenceProfileSchema | None = None
    companion_type: str | None = None
    request_meta: RequestMetaSchema


class ExplanationsResponse(BoundaryModel):
    """slot_key(BR-U2-04: "날짜#poi_id") → 추천 이유 해시태그(공백 구분, 최대 5개 — 예 `"#뷰맛집 #혼자여행"`).
    실패는 빈 맵 + 사유(침묵 금지).

    `alternative_explanations`(TRIP-887, additive): 요청 payload 의 슬롯별 차선책
    (`slots[].alternatives[]`)에 대한 "이 자리 대신 골라도 좋은 이유" 1문장 — 키는
    `"{date}#{alt_poi_id}"`(같은 선택지가 여러 슬롯에 있으면 날짜별 키마다 같은 문장).
    배치 슬롯 설명 **다음의 두 번째 호출**(잔여 예산만 씀)이라 이 맵이 비어도 `explanations`
    는 영향이 없다. 비면 `alternatives_reason` 이 사유를 싣는다(배치 설명이 실패해 시도조차
    못 했으면 `slot_explanations_unavailable`) — 백엔드는 AI 템플릿 rationale 을 그대로 쓴다.
    **전제**: 요청 payload 의 `slots[].alternatives[]` 가 채워져 와야 한다 — 백엔드가 저장한
    차선책을 되돌려 보내기 전(현재 `toWire()` 는 빈 배열)에는 항상 빈 맵 + `null` 이다.
    """

    explanations: dict[str, str]
    is_fallback: bool
    reason: str | None = None
    alternative_explanations: dict[str, str] = Field(default_factory=dict)
    alternatives_reason: str | None = None


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
    # 상한 500 — 심층 방어다. 라우터도 같은 값으로 거절하지만(IntentRouterConfig), 경계에서
    # 먼저 막으면 임베딩·LLM 을 쓰기 전에 422 로 끊긴다. 값의 근거는 그쪽 주석 참조.
    utterance: str | None = Field(default=None, min_length=1, max_length=500)
    confirm: bool = False
    request_meta: RequestMetaSchema

    @model_validator(mode="after")
    def _exactly_one_entry(self) -> "EditItineraryRequest":
        if (self.command is None) == (self.utterance is None):
            raise ValueError("command와 utterance 중 정확히 하나만 보내야 한다")
        return self


class EditItineraryResponse(BoundaryModel):
    """편집 결과 — 시각·순서는 APPLIED일 때만, 그것도 어셈블리 검증값만(INV-2).

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


class ShareCardCopyResponse(BoundaryModel):
    """j06 공유 카드 문구 — `ShareCardCopy.to_dict()`와 동형 (TRIP-429 후속).

    요청은 `ReflectionGenerateRequest` 재사용(회고 생성과 같은 재료) — 새 요청 타입을
    두지 않는다. 카드 이미지(통계·동선·워터마크)는 이 응답 밖이다: 서비스가 기계
    조립하는 사실 영역이고, 여기 담는 것은 그 아래 붙는 두 자리뿐이다.
    `is_fallback`은 정적 조립으로의 강등 정직 보고 (INV-4).
    """

    caption: str
    hashtags: list[str] = Field(default_factory=list)
    is_fallback: bool


# ───────────────────── 리마인드 알림 문구 (notification) ─────────────────────


class ReminderSlotSchema(BoundaryModel):
    """그날 일정의 장소 1건 — 문구가 말해도 되는 대상. 좌표·시각은 싣지 않는다.

    `category` 는 **경계 카테고리 코드**다(`FOOD`·`CAFE`·`SIGHT`·`NIGHT_VIEW`·
    `NATURE`·`CULTURE`·`ACTIVITY`·`SHOPPING`·`ART`·`BAR`) — 백엔드가 다른 경계에서 이미
    내보내는 그 값 그대로 보내면 된다. 새 어휘를 만들지 않는다. 모르는 값·빈
    문자열은 카테고리 없이 이름만 쓴 것과 같게 처리되므로 안전하다(문구 품질만
    조금 떨어진다).
    """

    name: str = Field(min_length=1)
    category: str = ""


class ReminderCopyItemSchema(BoundaryModel):
    """예약 1건 = 문구 1건. schedule_key 는 백엔드 예약 행 식별자(불투명 문자열).

    **slots 는 순서가 있다** — 조립(assembly)이 검증한 방문 순서 그대로 담아야 한다
    (INV-2). 프롬프트가 이 순서를 그대로 나열해 문구에 실리므로, 정렬 없이(예: DB
    조회에 ORDER BY 누락) 채우면 조립이 확인한 적 없는 순서 주장이 사용자에게 노출된다.
    """

    schedule_key: str = Field(min_length=1)
    kind: Literal["TRIP_DAY", "TRIP_PRE"]
    date: dt.date
    slots: list[ReminderSlotSchema] = Field(default_factory=list)


class ReminderCopyRequest(BoundaryModel):
    """여행 1건의 예약 여러 행을 한 번에. 예산은 request_meta.deadline_ms 를 쓴다."""

    request_meta: RequestMetaSchema
    trip_title: str = ""
    items: list[ReminderCopyItemSchema] = Field(min_length=1, max_length=30)


class ReminderCopySchema(BoundaryModel):
    schedule_key: str
    title: str
    body: str


class ReminderCopyResponse(BoundaryModel):
    """빠진 항목은 백엔드가 기존 상수로 채운다 — degraded 가 그 사실의 증빙(INV-4)."""

    copies: list[ReminderCopySchema]
    degraded: bool
    fallback_mode: str | None = None


# ───────────────── 대화 해석 경계 (U8 FD §3 — G-U8-4) ─────────────────
# 백엔드 `assistant` 모듈이 매 턴 부른다. **AI 는 해석만 한다**(DEC-U8-1) — 실행·문구는 백엔드.
# 컨텍스트 필드는 백엔드 `ContextSnapshot` 화이트리스트(BR-U8-22)와 1:1 이다 — 칸이 없는 값
# (가격·후보 풀·점수·위치)은 실을 자리 자체가 없다.


class AssistantSurface(str, Enum):
    HOME = "HOME"
    STAY_SEARCH = "STAY_SEARCH"
    ITINERARY = "ITINERARY"
    LIVE = "LIVE"
    STAY_DETAIL = "STAY_DETAIL"


class DialogueSlotSchema(BoundaryModel):
    """저장된(검증된) 계획 시각. 소요시간 필드는 없다(INV-3)."""

    slot_key: str
    name: str | None = None
    start_at: dt.time
    category: str | None = None


class DialogueDaySchema(BoundaryModel):
    date: dt.date
    slots: list[DialogueSlotSchema] = Field(default_factory=list)


class DialogueItinerarySchema(BoundaryModel):
    status: str
    days: list[DialogueDaySchema] = Field(default_factory=list)


class DialogueTripSchema(BoundaryModel):
    trip_id: str
    regions: list[str] = Field(default_factory=list)
    start_date: dt.date
    end_date: dt.date
    phase: str  # PLANNING | IN_TRIP | ENDED


class DialogueContextSnapshot(BoundaryModel):
    surface: AssistantSurface
    trip: DialogueTripSchema | None = None
    base_stays: list[str] = Field(default_factory=list)
    itinerary: DialogueItinerarySchema | None = None


class DialogueTurnSchema(BoundaryModel):
    """최근 턴 1건 — 단기 기억 (assistant-orchestrator FD DE §3.1).

    백엔드가 `text != null` 인 메시지만(가려진 입력 제외) 300자로 잘라 오래된 → 최신 순으로 싣는다.
    대화 기록은 백엔드 소유(DEC-U8-4) — AI 는 이것을 저장하지 않는다.
    """

    role: Literal["USER", "ASSISTANT"]
    text: str = Field(min_length=1, max_length=300)


class DialogueInterpretRequest(BoundaryModel):
    request_meta: RequestMetaSchema
    # 상한 500 — 라우터(`IntentRouterConfig.max_utterance_chars`)·`/edit` 와 같은 값.
    utterance: str = Field(min_length=1, max_length=500)
    # AI 소유 직렬형(`DialogueContext.to_dict`). 백엔드는 해석하지 않고 저장·반송만 한다
    # (INV-U8-07). 첫 턴은 null 이다. 내용이 깨져 있으면 AI 가 버리고 새로 시작한다.
    dialogue_context: dict | None = None
    context: DialogueContextSnapshot
    # ── assistant-orchestrator (FD DE §3.1) — 셋 다 선택: `extra=forbid` 라 AI 가 먼저 배포되고
    # 백엔드가 뒤따라 보낸다(BR-AO-24). 구 백엔드 요청은 그대로 통과한다.
    # 메모리 PK(백엔드 `assistant_session.session_id`). None 이면 메모리 단계 전체 생략.
    session_id: str | None = Field(default=None, min_length=1, max_length=64)
    # AI 경계를 처음 넘는 사용자 식별자 — 불투명 문자열. **로그·프롬프트 금지**, 저장 칸과
    # "지난 여행 기억"(같은 계정의 다른 세션) 조회 키로만 쓴다.
    account_ref: str | None = Field(default=None, min_length=1, max_length=64)
    # 단기 기억. 오래된 → 최신 순. 상한 20 은 오케스트레이터 `max_recent_turns` 와 같은 값.
    recent_turns: list[DialogueTurnSchema] = Field(default_factory=list, max_length=20)


class DialogueFrameSchema(BoundaryModel):
    intent: str
    # 값은 **요청**이지 확정값이 아니다 — 시각이 담겨도 화면에 그대로 내지 않는다(BR-DLG-05).
    arguments: dict[str, str] = Field(default_factory=dict)
    missing: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)
    match_route: str  # CONFIDENT | VOTED | LLM_DIRECT | CLARIFY_ANSWER | FALLBACK


class DialogueClarifySchema(BoundaryModel):
    frame_index: int = Field(ge=0)
    argument: str
    question: str  # 인자표 고정 문안(`CLARIFY_QUESTIONS`) — LLM 이 짓지 않는다(DEC-U8-6)
    options: list[str] | None = None


class DialogueNextActionSchema(BoundaryModel):
    # `type` 은 백엔드 `NextAction.TYPES`(17종) 안의 값 — 밖이면 백엔드가 SHOW_CAPABILITIES 로 대체한다(BR-U8-40)
    type: str
    label: str
    params: dict[str, str] = Field(default_factory=dict)


class DialogueQuickReplySchema(BoundaryModel):
    label: str
    action: str  # 백엔드 `QuickReplyAction` — id 는 백엔드가 발급한다(서버 발급 id 만 유효)
    params: dict[str, str] = Field(default_factory=dict)


class DialogueAnswerSchema(BoundaryModel):
    """오케스트레이터가 AI 안에서 끝낸 답 (outcome `ANSWER`, assistant-orchestrator FD DE §2.3·§3.2).

    문장의 시각·거리는 facts(Provider·스냅샷 검증값)에서만 온다(INV-2) — 소요시간 필드는 없다(INV-3).
    `text` 상한 600 은 게이트 상한(400) + 와이어 여유다.
    """

    kind: Literal["TEXT", "INFO", "CANDIDATES"]
    text: str = Field(min_length=1, max_length=600)
    payload: dict | None = None
    next_actions: list[DialogueNextActionSchema] = Field(min_length=1)
    quick_replies: list[DialogueQuickReplySchema] | None = None
    footnote: str | None = None


class DialogueInterpretResponse(BoundaryModel):
    outcome: str  # FRAME | ARGUMENT_CLARIFY | OUT_OF_SCOPE | ANSWER(assistant-orchestrator — 백엔드 `InterpretOutcome` 동시 추가)
    frames: list[DialogueFrameSchema]
    clarify: DialogueClarifySchema | None = None
    dialogue_context: dict
    llm_calls: int = Field(ge=0)  # 사용량 상한의 원천(COST-U8-02)
    # ANSWER 일 때만 채운다(그때 frames 는 분류 프레임 1개, clarify 는 null). FRAME/CLARIFY/OOS 는 종전 모양 그대로.
    answer: DialogueAnswerSchema | None = None


# ───────── 장기 기억 파기·내보내기 (`/ai/v1/dialogue/memory` — FD DE §3.3·§4.1, BR-AO-10) ─────────
# 쿼리 전용(본문 없음) — `request_meta` 가 없는 첫 경계다. 응답 어디에도 account_ref 를 되돌려 싣지 않는다.


class DialogueMemoryDeleteResponse(BoundaryModel):
    deleted: int = Field(ge=0)  # 멱등 — 지울 것이 없으면 0(오류 아님, DEC-AO-8)


class DialogueMemoryItemSchema(BoundaryModel):
    """세션 1건의 장기 기억 — 내보내기 항목. `summary` 는 파생물(원문 아님, SEC-U8-06)."""

    session_id: str
    trip_id: str | None = None
    summary: list[str]
    summarized_turn_index: int = Field(ge=0)
    updated_at: dt.datetime
    expires_at: dt.datetime  # = updated_at + 90일 (BE DATA-U8-01 과 같은 값)


class DialogueMemoryExportResponse(BoundaryModel):
    memories: list[DialogueMemoryItemSchema]  # updated_at DESC


# ───────── 기회 카드 (`/ai/v1/planb/opportunities` — situation-awareness BR-SA-22 · DEC-SA-6) ─────────
# 트리거가 아니다(DEC-U4-4) — 상태·알림이 없는 조회형이고 LLM 을 부르지 않는다. 카드의 장소는 등록 POI 다(INV-1).
# 시각 필드는 없다 — 행사 원천이 일 단위다(INV-2). 거리는 문자열만(INV-3 — 소요시간 없음).


class OpportunitySlotSchema(BoundaryModel):
    """그 날 **남은** 슬롯 1건 — 좌표는 계획된 장소의 좌표다(사용자 위치 아님)."""

    slot_key: str = Field(min_length=1, max_length=80)
    poi_id: str = Field(min_length=1)
    coord: CoordSchema


class OpportunitiesRequest(BoundaryModel):
    """남은 동선 근처의 행사·요즘 인기. 슬롯 자격(날짜·좌표·끝나지 않음·≤ 8)은 백엔드가 정한다."""

    date: dt.date
    slots: list[OpportunitySlotSchema] = Field(min_length=1, max_length=30)
    planned_poi_ids: list[str] = Field(default_factory=list, max_length=300)  # 일정에 이미 있는 곳 — 카드에서 뺀다
    request_meta: RequestMetaSchema


class OpportunitySchema(BoundaryModel):
    """기회 1건 — 문구는 앱의 고정 템플릿 한 곳이 만든다(서버는 필드만)."""

    key: str  # "event:{event_id}" | "trending:{poi_id}" — 기기 숨김의 키
    kind: Literal["EVENT_VENUE", "EVENT_NEARBY", "TRENDING"]
    event_name: str | None = None  # EVENT_* 만
    # EVENT_* 만 — EventType 값 그대로(OTHER 는 카드가 되지 않는다). 날씨 위험 날 축제만 빼는 재료(G-SA-17)
    event_type: Literal["FESTIVAL", "PERFORMANCE", "EXHIBITION", "POPUP"] | None = None
    start: dt.date | None = None   # EVENT_* 만 — 행사 기간(일 단위)
    end: dt.date | None = None
    poi_id: str                    # [넣어서 다시 짜기] 대상 — 등록 POI
    poi_name: str
    near_slot_key: str             # 가장 가까운 남은 슬롯(요청 키 그대로)
    distance_label: str            # "약 400m" — 그 슬롯에서의 직선거리


class OpportunitiesResponse(BoundaryModel):
    """재료 실패는 오류가 아니라 notes 다 — 행사 실패면 요즘 인기만, 장소 실패면 빈 목록(INV-4)."""

    opportunities: list[OpportunitySchema] = Field(default_factory=list, max_length=3)
    notes: list[str] = Field(default_factory=list)
