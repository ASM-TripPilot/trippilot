package com.trippilot.itinerarygeneration.adapter.out.external

import com.trippilot.itinerarygeneration.domain.CandidatesSummary
import tools.jackson.databind.JsonNode
import com.trippilot.itinerarygeneration.domain.DaySchedule
import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.Violation
import com.trippilot.itinerarygeneration.domain.VisitSlotDisplay
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * AI 경계 **와이어 타입** — AI 서비스의 실제 응답 형태를 그대로 받고, 도메인으로는 어댑터가 매핑한다.
 * 도메인 DTO 를 HTTP 에 직접 노출하지 않는 이유: AI 실 구현이 계약 문서와 어긋난 지점이 있어
 * (`solve_mode` 값 집합·`freshness` 필드) 그 차이를 **어댑터가 흡수**해야 도메인·서비스가 흔들리지 않는다.
 * 실측 근거: `ai/src/trippilot/domain/itinerary.py`(SolveMode) · `ai/src/trippilot/domain/freshness.py`.
 *
 * ⚠️ 값 매핑은 **AI팀 확인 대기**(TRIP-282). 확정되면 이 파일만 고치면 된다.
 */
internal data class AiScheduleResponse(
    val days: List<AiDay> = emptyList(),
    val day1ReadyAt: Instant? = null,
    val explanations: Map<String, String> = emptyMap(),
    /**
     * 후보 충분성(`candidates_summary`) — **실제 형태가 미확정**이라(계약 초안의 `SufficiencyReport`)
     * 타입을 고정하지 않고 원시 노드로 받는다. 객체가 아니어도(문자열·배열·null) 역직렬화가 깨지지 않아야 한다 —
     * 이 필드 하나 때문에 정상 200 응답이 통째로 버려지고 MINIMAL 폴백으로 강등되면 안 된다(INV-4 취지 역행).
     * 형태가 확정되면 데이터 클래스로 조인다(TRIP-282 묶음).
     */
    val candidatesSummary: JsonNode? = null,
    val solveMode: String,
    val isFallback: Boolean = false,
    val freshness: AiFreshness? = null,
)

internal data class AiDay(val date: LocalDate, val slots: List<AiSlot> = emptyList())

internal data class AiSlot(
    val poiId: UUID,
    val startAt: LocalTime,
    val endAt: LocalTime,
    val endsNextDay: Boolean = false,
    val distanceRange: String? = null,
    val isFixed: Boolean = false,
)

/**
 * AI `FreshnessMeta` — 패킷 단일 source 의 신선도(외부 API 캐시 관점). 백엔드 도메인의
 * `FreshnessMeta(generatedAt, degraded)` 와 개념이 달라 아래 규칙으로 사영한다.
 */

internal data class AiFreshness(
    val source: String? = null,
    val fetchedAt: Instant? = null,
    val cacheHit: Boolean = false,
    val ttlSec: Int = 0,
    val stale: Boolean = false,
)

/**
 * 와이어 → 도메인 매핑.
 * - `solve_mode`: AI 4값 → 백엔드 3값. `OR_TOOLS`/`LLM`=정상 산출(FULL_AI), `RULE_FALLBACK`=결정론 폴백,
 *   `MINIMAL`=최소. (AI `_FALLBACK_MODES = {RULE_FALLBACK, MINIMAL}` 와 정합.)
 *   미지 값은 **조용히 삼키지 않고** 실패시킨다(INV-4: 침묵 실패 금지) — 계약 드리프트를 즉시 드러내기 위함.
 * - `freshness`: `fetched_at`→generatedAt(없으면 [receivedAt]), `stale`→degraded.
 */
internal fun AiScheduleResponse.toDomain(receivedAt: Instant): ScheduleAgentOutput = ScheduleAgentOutput(
    days = days.map { d ->
        DaySchedule(d.date, d.slots.map { VisitSlotDisplay(it.poiId, it.startAt, it.endAt, it.endsNextDay, it.distanceRange, it.isFixed) })
    },
    day1ReadyAt = day1ReadyAt,
    explanations = explanations,
    candidatesSummary = candidatesSummary.toCandidatesSummary(),
    solveMode = solveMode.toSolveMode(),
    isFallback = isFallback,
    freshness = FreshnessMeta(freshness?.fetchedAt ?: receivedAt, degraded = freshness?.stale ?: false),
)

/** AI solve_mode → 도메인 SolveMode. 미지 값은 예외(폴백 신호) — 조용한 오분류보다 낫다. */
private fun String.toSolveMode(): SolveMode = when (uppercase()) {
    "OR_TOOLS", "LLM", "FULL_AI" -> SolveMode.FULL_AI
    "RULE_FALLBACK", "DETERMINISTIC" -> SolveMode.DETERMINISTIC
    "MINIMAL" -> SolveMode.MINIMAL
    else -> throw IllegalArgumentException("알 수 없는 solve_mode: $this")
}

/**
 * 원시 노드 → 후보 충분성. **없는 값을 지어내지 않는다** — level 이 없으면 요약 자체가 없는 것으로 보고,
 * poolSize 가 없으면 0 이 아니라 null 로 둔다(0 은 "후보 0건"이라는 AI 판정으로 읽힌다).
 */
private fun JsonNode?.toCandidatesSummary(): CandidatesSummary? {
    val node = this?.takeIf { it.isObject } ?: return null
    val level = node.get("level")?.takeIf { it.isTextual }?.asString() ?: return null
    val poolSize = node.get("pool_size")?.takeIf { it.isInt || it.isLong }?.asInt()
    val shortfall = node.get("shortfall_categories")?.takeIf { it.isArray }
        ?.mapNotNull { it.takeIf { n -> n.isTextual }?.asString() }
        .orEmpty()
    return CandidatesSummary(level, poolSize, shortfall)
}

// ───────────────────────── validate · repair (TRIP-309) ─────────────────────────

/**
 * `POST /ai/v1/itinerary/validate` 요청. 상대는 산출물 전체를 다시 받아 검사한다 —
 * 우리가 슬롯만 보내면 상대가 날짜 맥락을 잃어 위치 인덱스를 계산할 수 없다.
 */
internal data class AiValidateRequest(val itinerary: AiSchedulePayload, val requestMeta: AiRequestMeta)

internal data class AiValidateResponse(val violations: List<AiViolation> = emptyList())

/** `POST /ai/v1/itinerary/repair` — 수리 불가는 오류가 아니라 `repaired=null` 이다(IO-7). */
internal data class AiRepairRequest(
    val itinerary: AiSchedulePayload,
    val violations: List<AiViolation> = emptyList(),
    val requestMeta: AiRequestMeta,
)

internal data class AiRepairResponse(
    val repaired: AiScheduleResponse? = null,
    val changes: List<String> = emptyList(),
)

/**
 * 상대 위반 표현. `code`/`slot_ref` 가 상대 도메인 어휘이고 `day_index`/`slot_index` 는 **수퍼셋**으로 얹혀 온다
 * — 상대가 요청 본문을 스캔해 계산하며, 못 찾으면 null 이다.
 */
internal data class AiViolation(
    val code: String,
    val slotRef: String? = null,
    val detail: String = "",
    val dayIndex: Int? = null,
    val slotIndex: Int? = null,
)

/** 우리가 보내는 산출물 본문 — 응답 수신형([AiScheduleResponse])과 필드가 같아 그대로 재사용한다. */
internal typealias AiSchedulePayload = AiScheduleResponse

internal data class AiRequestMeta(val requestId: String, val requestedAt: Instant, val deadlineMs: Long)

internal fun AiViolation.toDomain(): Violation =
    Violation(code, dayIndex, slotIndex, detail.takeIf { it.isNotBlank() }, slotRef)

/** 도메인 산출물 → 상대 본문. 왕복 형태가 같아(생성 응답 = 검증 요청) 그대로 되돌려 보낸다. */
internal fun ScheduleAgentOutput.toWire(): AiSchedulePayload = AiSchedulePayload(
    days = days.map { d ->
        AiDay(d.date, d.slots.map { AiSlot(it.poiId, it.startAt, it.endAt, it.endsNextDay, it.distanceRange, it.isFixed) })
    },
    day1ReadyAt = day1ReadyAt,
    explanations = explanations,
    solveMode = solveMode.name,
    isFallback = isFallback,
    freshness = null, // 되돌려 보낼 때 신선도는 의미가 없다(우리가 만든 값이 아니다)
)
