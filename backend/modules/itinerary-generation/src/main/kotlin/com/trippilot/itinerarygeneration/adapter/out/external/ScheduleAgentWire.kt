package com.trippilot.itinerarygeneration.adapter.out.external

import com.trippilot.itinerarygeneration.domain.CandidatesSummary
import tools.jackson.databind.JsonNode
import com.trippilot.itinerarygeneration.domain.DaySchedule
import com.trippilot.itinerarygeneration.application.SlotKey
import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.UnplacedMustVisit
import com.trippilot.itinerarygeneration.domain.UnplacedReason
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.SlotCandidate
import com.trippilot.itinerarygeneration.domain.SlotCandidatesEmptyReason
import com.trippilot.itinerarygeneration.domain.SlotCandidatesInput
import com.trippilot.itinerarygeneration.domain.SlotCandidatesOutput
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.Violation
import com.trippilot.itinerarygeneration.domain.VisitSlotDisplay
import com.trippilot.placedata.api.GroundedPlace
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.Locale
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
    /**
     * 넣지 못한 필수 방문지(계약 M2). **기본 빈 목록** — 이 필드가 없는 옛 AI 응답도 같은 뜻이 되게 한다
     * (배포 순서가 어긋나도 역직렬화가 깨지지 않는다).
     */
    val unplacedMustVisits: List<AiUnplacedMustVisit> = emptyList(),
)

/** 미배치 보고 1건. `reason_code` 는 닫힌 집합이지만 **문자열로 받는다** — 아래 매핑 주석 참고. */
internal data class AiUnplacedMustVisit(val poiId: String, val reasonCode: String)

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
    unplacedMustVisits = unplacedMustVisits.mapNotNull { it.toDomain() },
)

/**
 * 미배치 보고 → 도메인. **보고 자체를 잃지 않는 것이 이 매핑의 목적**이라 관대하게 받는다:
 * - 모르는 `reason_code` 는 [UnplacedReason.UNKNOWN] 으로 접는다. 새 사유가 추가됐다고 예외를 던지면
 *   "못 넣었다"는 사실까지 함께 사라진다 — 침묵 드롭을 없애려고 만든 필드가 침묵 드롭을 만드는 셈이다.
 *   (`solve_mode` 는 반대로 예외를 던진다 — 그건 오분류하면 폴백 판정이 통째로 틀어지기 때문이다.)
 * - `poi_id` 가 UUID 가 아니면 **그 한 건만 버린다**. 어느 장소인지 모르면 화면에 띄울 수 없고,
 *   한 건 때문에 나머지 보고까지 잃을 이유는 없다(로그로 드러낸다).
 */
private fun AiUnplacedMustVisit.toDomain(): UnplacedMustVisit? {
    val id = runCatching { UUID.fromString(poiId) }.getOrNull()
    if (id == null) {
        wireLog.warn("미배치 보고의 poi_id 가 UUID 가 아닙니다 — 그 한 건만 버립니다. poiId={}", poiId)
        return null
    }
    val reason = runCatching { UnplacedReason.valueOf(reasonCode.uppercase()) }.getOrElse {
        wireLog.warn("알 수 없는 미배치 사유 — UNKNOWN 으로 접습니다. reasonCode={}", reasonCode)
        UnplacedReason.UNKNOWN
    }
    return UnplacedMustVisit(id, reason)
}

private val wireLog = org.slf4j.LoggerFactory.getLogger("com.trippilot.itinerarygeneration.adapter.out.external.ScheduleAgentWire")

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

/**
 * `POST /ai/v1/itinerary/explanations` — 일정 본문을 그대로 되돌려 보내고 근거만 받는다.
 * **실패도 200 + 빈 맵**이다(근거는 부가 정보라 상대가 5xx 로 올리지 않는다).
 */
internal data class AiExplanationsRequest(
    val tripId: String,
    val itinerary: AiSchedulePayload,
    val requestMeta: AiRequestMeta,
)

internal data class AiExplanationsResponse(
    val explanations: Map<String, String> = emptyMap(),
    val isFallback: Boolean = false,
    val reason: String? = null,
)

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

/** `deadline_ms` 는 선택 필드다 — null 이면 AI 가 시간제약 없이 돈다(TRIP-473 계약). */
internal data class AiRequestMeta(val requestId: String, val requestedAt: Instant, val deadlineMs: Long?)

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

// ───────── 슬롯 후보(alternatives) — TRIP-463 · 연동 설계 §2·§3 ─────────

/**
 * `POST /ai/v1/itinerary/alternatives` 요청. **계약을 한 글자도 안 바꾸고** 우리 입력을 상대 어휘로
 * 옮긴다 — 자리가 없는 값(`radiusM`·`concept`·`neighborSlotKeys`)은 백엔드가 응답 후처리에서
 * 소화하거나 버린다(설계 §2 "자리가 없는 것 3개").
 */
internal data class AiTrigger(
    val kind: String,
    val scheduleId: String,
    val affectedDate: LocalDate,
    val payload: Map<String, String> = emptyMap(),
)

internal data class AiCoord(val lat: Double, val lng: Double)

/**
 * 계약 `SavedPlaceSchema` — `saved_places` 항목은 문자열이 아니라 **객체**다(`poi_id` 필수·`name`).
 * 지금은 항상 빈 목록을 보내지만(§2 — place-data api 파사드 신설은 별건), 타입을 문자열로 뒀다가
 * 나중에 채우는 순간 422 가 나는 함정을 남기지 않는다.
 */
internal data class AiSavedPlace(
    val poiId: String,
    val name: String,
)

internal data class AiAlternativesRequest(
    val trigger: AiTrigger,
    val reason: String,
    val anchor: AiCoord,
    val dates: List<LocalDate>,
    val budgetLevel: String?,
    val transportMode: String?,
    val excludedPoiIds: List<String>,
    val affectedReasons: Map<String, String>,
    val savedPlaces: List<AiSavedPlace>,
    val requestMeta: AiRequestMeta,
)

/**
 * 응답의 대안 1건. **필수 필드에 기본값을 주지 않는다** — 계약 드리프트를 역직렬화 실패로 드러내기
 * 위한 이 파일의 관행이다(`AiSlot.poiId` 등과 같은 이유).
 */
internal data class AiAlternative(
    val label: String,
    val poiIds: List<String>,
    val rationale: String,
)

internal data class AiAlternativesResponse(
    val alternatives: List<AiAlternative> = emptyList(),
    val isFallback: Boolean,
    val fallbackLevel: Int,
    val notes: List<String> = emptyList(),
    /** KB 3종 검색 건수 — 로그 진단값이라 모양을 고정하지 않는다(candidatesSummary 선례). */
    val retrieved: JsonNode? = null,
    val droppedOutOfPool: List<String> = emptyList(),
    val emptyReason: String? = null,
    val poolSize: Int,
)

/** 우리 입력 → 상대 요청(설계 §2 매핑표 그대로). */
internal fun SlotCandidatesInput.toAlternativesRequest(): AiAlternativesRequest {
    val (date, targetPoiId) = requireNotNull(SlotKey.parse(slotKey)) {
        "slotKey 형식 위반: $slotKey — 서비스 검증을 지나온 값이라 여기 오면 버그다"
    }
    return AiAlternativesRequest(
        // kind 는 **지어내는 값**이다(설계 §2) — h12/h18 은 사용자가 직접 "다른 후보"를 누른 흐름이고,
        // 입력에 트리거 정보가 없어 다른 값을 실을 방법 자체가 없다.
        trigger = AiTrigger(kind = "MANUAL", scheduleId = tripId.toString(), affectedDate = date),
        // 어휘 6값 중 하나만 쓴다 — 계약상 enum 이 아니라 오타가 422 로 안 잡히고 KB 질의만 오염된다.
        reason = "none",
        anchor = AiCoord(centerLat, centerLng),
        dates = listOf(date),
        budgetLevel = null,     // 채우려면 profile 의존이 생긴다(R1 확대) — replan 과 같은 판단
        transportMode = null,   // AI 기본 PUBLIC → 풀 반경 10km. §3 반경 컷 상한의 근거
        excludedPoiIds = excludePoiIds.map { it.toString() },
        affectedReasons = placementReason?.let { mapOf(targetPoiId.toString() to it) } ?: emptyMap(),
        savedPlaces = emptyList(), // place-data 에 api 파사드가 없다 — 신설은 별건(설계 §2)
        requestMeta = AiRequestMeta(requestMeta.requestId, requestMeta.requestedAt, requestMeta.deadlineMs),
    )
}

/**
 * 상대 응답 → 완결된 [SlotCandidatesOutput](설계 §3 · D-5가).
 *
 * **AI 응답에 없는 값(거리·반경·시각)은 여기서 백엔드 데이터로 채운다.** 거리는 `ground()` 가 준
 * 좌표와 탐색 중심의 하버사인 — 표시값의 주인이 백엔드 정본(place-data) 좌표여야 두 정본이 안 생긴다.
 */
internal fun AiAlternativesResponse.toDomain(
    input: SlotCandidatesInput,
    grounded: List<GroundedPlace>,
    receivedAt: Instant,
): SlotCandidatesOutput {
    val degraded = fallbackLevel >= 1
    val byId = grounded.associateBy { it.poiId }

    // flatten — 대안 1개 = POI 1개(DEC-U4-1)지만 계약상 배열이라 2개 이상이 와도 전부 편다.
    data class Ranked(val place: GroundedPlace, val rationale: String, val distanceM: Double)
    val ranked = alternatives.flatMap { alt ->
        alt.poiIds.mapNotNull { raw ->
            val id = runCatching { UUID.fromString(raw) }.getOrNull() ?: return@mapNotNull null
            byId[id]?.let { place ->
                Ranked(place, alt.rationale, haversineM(input.centerLat, input.centerLng, place.lat, place.lng))
            }
        }
    }

    // 반경 컷(설계 §2) — AI 풀 상한(PUBLIC 10km)을 넘는 반경을 표시하면 "본 적 없는 범위를 넓혀
    // 봤다"는 거짓말이 된다. 컷 결과 0건이면 상한으로 한 번 넓혀 재컷(h15 를 서버가 대신한다).
    val requestedCut = minOf(input.radiusM ?: DEFAULT_CUT_M, AI_POOL_RADIUS_M)
    var radiusUsed = requestedCut
    var within = ranked.filter { it.distanceM <= requestedCut }
    if (within.isEmpty() && ranked.isNotEmpty() && requestedCut < AI_POOL_RADIUS_M) {
        radiusUsed = AI_POOL_RADIUS_M
        within = ranked.filter { it.distanceM <= AI_POOL_RADIUS_M }
    }

    // 정렬(D-3a): AI 랭킹이 살아 있으면 그 순서가 이 티켓이 사려던 것이고,
    // 강등이면 거리 오름차순 — FE 고지 문구('가까운 순')가 사실이어야 한다.
    val ordered = if (degraded) within.sortedBy { it.distanceM } else within

    val candidates = ordered.map { r ->
        SlotCandidate(
            poiId = r.place.poiId,
            // 거리만 — 소요시간은 어떤 이유로도 내보내지 않는다(INV-3).
            distanceRange = "약 ${"%.1f".format(Locale.ROOT, r.distanceM / 1000)}km",
            // 폴백 rationale 은 기계 문자열("MANUAL/none · rule_ranking")이라 사용자에게 새면 안 된다 —
            // 로컬 경로와 같은 템플릿으로 되돌린다(설계 §3).
            rationale = if (degraded) {
                input.concept?.let { c -> "$c 컨셉에 맞는 ${r.place.category}" } ?: "주변 ${r.place.category}"
            } else {
                r.rationale
            },
        )
    }

    return SlotCandidatesOutput(
        candidates = candidates,
        radiusMUsed = radiusUsed,
        freshness = FreshnessMeta(receivedAt, degraded = degraded),
        emptyReason = when {
            candidates.isNotEmpty() -> null
            // AI 가 후보를 줬는데 반경 컷·ground 탈락으로 비었다 — 주변엔 있으니 넓히기·컨셉 변경이 통한다.
            ranked.isNotEmpty() || alternatives.isNotEmpty() -> SlotCandidatesEmptyReason.NO_NEARBY
            // AI 풀이 비었거나 전부 제외됐다(설계 §3 매핑) — 넓혀도 같은 결과다.
            emptyReason == "no_candidates" || emptyReason == "all_excluded" -> SlotCandidatesEmptyReason.ALL_IN_ITINERARY
            // 모르는 사유는 NO_NEARBY 로 떨어뜨린다 — 원문은 어댑터가 WARN 으로 남긴다(침묵 금지).
            else -> SlotCandidatesEmptyReason.NO_NEARBY
        },
    )
}

/** place-data `domain` 은 R1 위반이라 못 쓰고 `StayOnramp.distanceM` 은 private — 그래서 여기 새로 둔다(설계 §6-2). */
private fun haversineM(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
    val dLat = Math.toRadians(lat2 - lat1)
    val dLng = Math.toRadians(lng2 - lng1)
    val a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a))
}

private const val EARTH_RADIUS_M = 6_371_000.0

/** AI 풀 반경 상한(PUBLIC 10km) — transport_mode 를 안 보내므로 상대는 항상 이 풀에서 골랐다. */
private const val AI_POOL_RADIUS_M = 10_000

/** 로컬 경로의 기본 반경과 같은 값 — 두 경로의 기본 동작이 갈리지 않게. */
private const val DEFAULT_CUT_M = 3_000
