package com.trippilot.itinerarygeneration.domain

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 일정 생성 지능(AI 서비스) 경계 포트 — 포워드 계약(BE-1). 어댑터(BE-2)가 HTTP로 구현하고
 * camelCase↔snake_case 매핑을 소유한다. 이 포트·DTO는 프레임워크-free(R2 순수).
 * - generate: 굵은 경계 — 한 호출로 검증된 일정(솔버 검증 시각·순서, INV-2)
 * - validate: 편집 재검증 — HC1-4 위반 목록(변경 차단 아님)
 * - repair:   Plan-B 재정렬 — 시각·순서만 최소 조정(POI 불변)
 * 정본: backend/docs/design/ai-backend-경계-계약-초안.md · ai agent-io-contracts.md(1.2).
 */
interface ScheduleAgentPort {
    fun generate(input: ScheduleAgentInput): ScheduleAgentOutput
    fun validate(solution: ScheduleAgentOutput): List<Violation>
    fun repair(solution: ScheduleAgentOutput, violations: List<Violation>): RepairResult

    /**
     * 슬롯 후보 제안(DEC-U3-5) — **완전 AI·같이 고르기 공통 경계**다. 경로별로 다른 API 를 두지 않는다(BR-U3-23).
     * 후보는 closed-set(INV-1) — 백엔드가 임의 POI 를 섞지 않는다.
     */
    fun proposeSlotCandidates(input: SlotCandidatesInput): SlotCandidatesOutput

    /**
     * 여행 중 재계획(U4 정본 §3.1 · DEC-U4-5) — **새 솔버 개념을 만들지 않는다**.
     * 잠금 슬롯([ReplanInput.lockedSlotKeys])이 고정 블록으로 승격돼 HC3 보호를 받으므로,
     * 상대는 이미 있는 재생성 경로를 그대로 쓴다.
     *
     * 반환이 곧 **초안**이다 — 원 일정에 반영하지 않는다(INV-U4-05). 해가 없으면 빈 일자를 돌려주고,
     * 호출 실패는 [ScheduleAgentCallFailed] 로 올려 수동 편집 전환을 유도한다(INV-4).
     */
    fun replan(input: ReplanInput): ScheduleAgentOutput
}

/** 재계획 범위(DEC-U4-3) — ai `ReplanScope` 어휘를 그대로 쓴다. */
enum class ReplanScope { PARTIAL_SLOTS, FULL_DAY }

/**
 * 재계획 입력(정본 §3.1).
 *
 * [lockedSlotKeys] 가 이 타입의 핵심이다 — 완료된 방문지·시각 고정 슬롯·숙소 앵커는 **다시 짜도 그대로**여야
 * 한다(INV-U4-04). 잠금을 빠뜨리면 이미 다녀온 곳이 일정에서 사라지거나 시각이 밀린다.
 */
@Suppress("LongParameterList")
data class ReplanInput(
    val tripId: UUID,
    val itineraryId: UUID,
    val scope: ReplanScope,
    /** '지금 이후'의 기준점. PARTIAL_SLOTS 는 이 시각 이전 슬롯을 전부 잠근다. */
    val fromInstant: Instant,
    val targetDate: LocalDate,
    /** null 허용 — 기준점 사다리(BR-U4-19)로 정한 좌표가 없을 수도 있다. */
    val originLat: Double?,
    val originLng: Double?,
    val lockedSlotKeys: List<String>,
    /** `i10` '왜' — 선호 **가중치** 입력이다. 후보 풀은 closed-set 그대로(INV-1). */
    val reasons: List<String>,
    /** `i10` '어떻게' — 같은 취지. */
    val directives: List<String>,
    val freeText: String?,
    val excludedPoiIds: List<UUID>,
    val requestMeta: RequestMeta,
)

/** 생성 방식(d11 추천 강도 분기). */
/**
 * 사용자가 고른 생성 방식(US-SCHED-09).
 *
 * ⚠ [MANUAL] 은 **AI 경계에 보내지 않는다** — 직접 만들기는 AI 를 아예 부르지 않는 흐름이고,
 * 상대 enum 에도 없어서 보내는 순간 422 다. 경계로 나가는 값은 [FULLY_AI]·[CO_PLAN] 뿐이다.
 */
enum class GenerationMode { FULLY_AI, CO_PLAN, MANUAL }

/**
 * ScheduleAgent 호출 실패 — **유효한 200 을 받지 못한 경우만**(경계 계약 PR #104).
 * AI 가 200 을 반환하면 `isFallback=true` 여도 이 예외를 던지지 않는다(그건 AI 가 이미 폴백을 마친 결과물).
 * 이 예외가 곧 백엔드 결정론 폴백(INV-4) 발동 신호 — 응답 스키마 불일치도 침묵시키지 않고 여기로 올린다.
 * [retryable]: 네트워크 단절 등 재시도 가능 여부(현 정책은 재시도 없이 즉시 폴백 — 진단용 정보).
 */
class ScheduleAgentCallFailed(
    val errorCode: String?,
    val retryable: Boolean,
    message: String,
    cause: Throwable? = null,
) : RuntimeException(message, cause)

// ───────── 입력: ScheduleAgentInput ─────────

data class ScheduleAgentInput(
    val tripId: UUID,
    val generationMode: GenerationMode,
    val tripContext: TripContext,
    val anchors: List<DayAnchor>,          // day별 공간 앵커
    val timeWindows: List<TimeWindow>,     // 날짜별 이용 시각(기본 09–21시)
    val fixedBlocks: List<FixedBlock>,     // 시각 고정 필수방문지·숙소(HC3)
    val preferenceProfile: PreferenceProfile,  // preference_snapshot 7축
    val recommendationStrength: String?,
    val requestMeta: RequestMeta,          // 지연 예산 전파(IO-1)
    /**
     * 이미 다른 호출에서 배정된 POI — day1 2단계 생성의 중복 방지(TRIP-293).
     * 1차 `timeWindows=[day1]` 로 생성 → 배정된 poiId 를 2차(나머지 일자) 제외 목록으로 넘긴다.
     * AI 측 대응: `ItineraryProblem.excluded_poi_ids`(후보 풀·프롬프트·게이트에 동일 적용).
     */
    val excludedPoiIds: List<UUID> = emptyList(),
)

data class TripContext(
    val destinations: List<String>,
    val startDate: LocalDate,
    val endDate: LocalDate,
    val companionType: String?,
    val budgetLevel: String?,
)

/** day별 공간 앵커(등록 숙소 해석 결과 = trip_base_day). */
data class DayAnchor(val date: LocalDate, val lat: Double, val lng: Double)

data class TimeWindow(val date: LocalDate, val start: LocalTime, val end: LocalTime)

/** 고정 블록(HC3). ANYTIME이면 date/start/dwellMin 은 null. */
data class FixedBlock(val poiId: UUID, val date: LocalDate?, val start: LocalTime?, val dwellMin: Int?)

/** 취향 7축(preference_snapshot). AI가 선호 점수·소프트 가중치에 사용. */
data class PreferenceProfile(
    val styles: List<String>,
    val activities: List<String>,
    val foodTastes: List<String>,
    val transportModes: List<String>,
    val pace: String?,
    val companionTypes: List<String>,
    val petFriendly: Boolean,
    val budgetTier: String?,
)

/** 지연 예산 전파(IO-1) — day1 5s / 전체 20s. */
data class RequestMeta(val requestId: String, val requestedAt: Instant, val deadlineMs: Long)

// ───────── 출력: ScheduleAgentOutput ─────────

data class ScheduleAgentOutput(
    val days: List<DaySchedule>,
    val day1ReadyAt: Instant?,             // day1 우선 반환 시각(5초 정책)
    /**
     * 슬롯별 추천 이유. 키 규약 = `slotKey = "{date}#{poiId}"`(BR-U2-04).
     * (Violation 은 현재 dayIndex·slotIndex 로 지시한다 — 같은 규약을 쓰지 않는다.)
     * 문구는 시각·소요시간을 언급하지 않는다(BR-U2-09 — INV-2·INV-3 우회 차단). 집행은 AI 프롬프트·후처리 책임.
     */
    val explanations: Map<String, String>,
    val solveMode: SolveMode,              // FULL_AI | DETERMINISTIC | MINIMAL (도메인 재사용)
    val isFallback: Boolean,               // 침묵 실패 금지(INV-4, IO-2)
    val freshness: FreshnessMeta,
    /** 후보 충분성 보고(BR-U2-05). **판정은 AI 소유** — 백엔드는 그대로 전달하고 재계산하지 않는다. */
    val candidatesSummary: CandidatesSummary? = null,
    /**
     * 넣지 못한 필수 방문지 보고(계약 M2 · AI TRIP-350).
     *
     * 왜 필요한가: 기간 밖 must_visit 을 고정 블록으로 실어 보내면 AI 의 HC3 가 그 날짜를 스킵해
     * **침묵 드롭**됐다 — 사용자는 "내가 넣은 곳이 왜 없지"를 알 방법이 없었다.
     * 이 목록이 "왜 안 들어갔는지"를 돌려준다. **기본은 빈 목록**(= 전부 배치됨)이며,
     * 필드가 없는 옛 AI 응답과도 같은 뜻이 되게 한다.
     */
    val unplacedMustVisits: List<UnplacedMustVisit> = emptyList(),
)

/**
 * 넣지 못한 필수 방문지 1건.
 *
 * [reasonCode] 는 **닫힌 집합**이다 — 자유 문자열이면 백엔드가 분기할 수 없고 화면 문구도 정할 수 없다.
 * 사용자 문구는 백엔드가 만든다(AI 는 코드만 준다).
 */
data class UnplacedMustVisit(val poiId: UUID, val reasonCode: UnplacedReason)

/** AI 판정 사유(계약 확정 3값). 모르는 값이 오면 어댑터가 [UNKNOWN] 으로 접는다 — 새 값 때문에 생성 전체가 죽지 않게. */
enum class UnplacedReason {
    /** 고정 날짜가 여행 기간 밖. */
    OUT_OF_RANGE,

    /** 기간 안인데 다른 고정 블록과 시간이 겹친다(겹침이 증명된 경우만). */
    WINDOW_CONFLICT,

    /** 그 외 미배치 — 기간 안·겹침 없음인데 해에 없다. */
    NO_FEASIBLE_SLOT,

    /** 계약에 없는 값. 보고 자체를 잃지 않으려고 두는 자리다(사유는 "확인 불가"로 표시). */
    UNKNOWN,
}

data class DaySchedule(val date: LocalDate, val slots: List<VisitSlotDisplay>)

/**
 * 후보 충분성(BR-U2-05). [level] LOW 면 클라이언트가 "후보가 적어요" 안내를 띄운다.
 * **판정은 AI 소유** — 백엔드는 level 을 그대로 전달하고 재계산하지 않는다.
 */
data class CandidatesSummary(
    val level: String,
    /** AI 가 주지 않으면 null — 0 으로 채우면 "후보 0건"이라는 판정을 백엔드가 지어내는 셈이다. */
    val poolSize: Int?,
    val shortfallCategories: List<String> = emptyList(),
)

/**
 * 표시용 방문 슬롯 — 솔버 검증 시각·순서만(INV-2). **소요시간(duration) 필드 없음(INV-3)** — 거리만([distanceRange]).
 * [endsNextDay]: 자정 넘겨 종료(HC4, 시작일 귀속)의 잠정 표현 — AI와 시각 포맷 확정 대상.
 */
data class VisitSlotDisplay(
    val poiId: UUID,
    val startAt: LocalTime,
    val endAt: LocalTime,
    val endsNextDay: Boolean,
    val distanceRange: String?,            // "약 1.2km · 도보 추정" 등 표시 문자열
    val isFixed: Boolean,
)

/** 사용 데이터 신선도 집계(IO-6). */
data class FreshnessMeta(val generatedAt: Instant, val degraded: Boolean)

// ───────── 검증 / 수리 ─────────

/** 하드 제약 위반(HC1-4). */
/**
 * 하드 제약 위반 1건(HC1-4).
 *
 * [dayIndex]·[slotIndex]는 **nullable** — AI 가 보낸 요청을 스캔해 위치를 계산하는데, 못 찾으면 비워 보낸다.
 * 위치를 모른다고 위반 자체를 버리면 "문제 없음"이라는 거짓 음성이 된다(INV-4) — 슬롯에 못 붙일 뿐 보고는 한다.
 */
data class Violation(
    val type: String,
    val dayIndex: Int?,
    val slotIndex: Int?,
    val detail: String?,
    /**
     * 상대가 붙인 슬롯 지시자. **인덱스보다 이쪽이 1차 키**다 — 인덱스는 상대가 요청 본문을 스캔해 계산한
     * 파생값이라, 검증한 일정과 수리를 요청하는 일정이 조금이라도 다르면 엉뚱한 슬롯을 가리킨다.
     */
    val slotRef: String? = null,
)

/** 최소 조정 수리 결과 — 시각·순서만(POI 불변). */
data class RepairResult(val repaired: ScheduleAgentOutput, val changes: List<String>)

/**
 * 슬롯 후보 요청. [excludePoiIds] 는 **백엔드가 현재 일정에서 유도**한다 — 클라이언트가 보내는 값을 믿으면
 * 이미 일정에 있는 장소가 다시 추천된다(BR-U3-24).
 */
data class SlotCandidatesInput(
    val tripId: UUID,
    /** BR-U2-04 규약 `"{date}#{poiId}"`. */
    val slotKey: String,
    /** 직전·직후 슬롯 — 동선 트레이드오프 계산 입력. */
    val neighborSlotKeys: List<String>,
    /** 후보 탐색 중심(교체 대상 슬롯의 장소 좌표). */
    val centerLat: Double,
    val centerLng: Double,
    /** null = AI 기본 반경. h15 "반경 넓힘"이 이 값을 올린다. */
    val radiusM: Int?,
    /** h13 컨셉(테마) — null 허용. */
    val concept: String?,
    val excludePoiIds: List<UUID>,
    val requestMeta: RequestMeta,
)

/** [candidates] 빈 목록 = 후보 0건(h15 반경 확대 유도). [radiusMUsed] 는 **실제 사용 반경**(AI 가 자동 확대했을 수 있다). */
data class SlotCandidatesOutput(
    val candidates: List<SlotCandidate>,
    val radiusMUsed: Int,
    val freshness: FreshnessMeta,
)

/** [distanceRange] 거리만(INV-3). [rationale] 은 closed-set 근거 — 시각·소요시간 언급 금지(BR-U2-09). */
data class SlotCandidate(val poiId: UUID, val distanceRange: String, val rationale: String)
