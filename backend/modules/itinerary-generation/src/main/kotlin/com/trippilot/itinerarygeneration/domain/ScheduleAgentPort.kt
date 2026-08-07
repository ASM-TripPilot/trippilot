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
}

/** 생성 방식(d11 추천 강도 분기). */
enum class GenerationMode { FULLY_AI, CO_PLAN }

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
    val explanations: Map<String, String>, // slotRef → 추천 이유(시각·소요시간 언급 금지)
    val solveMode: SolveMode,              // FULL_AI | DETERMINISTIC | MINIMAL (도메인 재사용)
    val isFallback: Boolean,               // 침묵 실패 금지(INV-4, IO-2)
    val freshness: FreshnessMeta,
)

data class DaySchedule(val date: LocalDate, val slots: List<VisitSlotDisplay>)

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
data class Violation(val type: String, val dayIndex: Int, val slotIndex: Int, val detail: String?)

/** 최소 조정 수리 결과 — 시각·순서만(POI 불변). */
data class RepairResult(val repaired: ScheduleAgentOutput, val changes: List<String>)
