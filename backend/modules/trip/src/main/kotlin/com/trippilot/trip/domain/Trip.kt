package com.trippilot.trip.domain

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import java.time.Instant
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import java.util.UUID

/** 여행 상태(INV-U1-13 단방향 PLANNED→CONFIRMED→ACTIVE→ENDED). 전이 엔드포인트는 일정확정(S3)·종료(S4). */
enum class TripStatus {
    PLANNED, CONFIRMED, ACTIVE, ENDED;

    /** 단방향: 뒤로 갈 수 없다(같은 상태로도 불가). 앞으로만. */
    fun canTransitionTo(target: TripStatus): Boolean = target.ordinal > this.ordinal
}

/** 동반 유형(g01). 온보딩 '커플' → '연인' 매핑은 클라이언트/프리필 담당. */
enum class CompanionType { 혼자, 친구, 연인, 가족 }

/** 다도시 목적지(G-U1-08). seq=표시순서, nights=박수. */
data class TripDestination(val seq: Int, val region: String, val nights: Int)

/**
 * 여행(C6). 앱 소유. 생성 시 취향 동결(preferenceSnapshot).
 * 불변식: INV-U1-11(end≥start) · INV-U1-14(Σnights≤기간) · INV-U1-13(상태 단방향).
 *
 * **국내강제(INV-U1-12)는 여기서 하지 않는다** — 지역명 문자열이 아니라 좌표로 판정해야 하고(BR-U1-35),
 * 그러려면 외부 조회가 필요하다. 도메인은 순수해야 하므로 판정은 `TripService` 가 place-data 퍼사드로 수행한다.
 * 편집·삭제는 ENDED/삭제 후 불가.
 */
class Trip private constructor(
    val tripId: UUID,
    val accountId: UUID,
    val title: String,
    val startDate: LocalDate,
    val endDate: LocalDate,
    val party: Int,
    val companionType: CompanionType?,
    val budgetTotal: Long?,
    val preferenceSnapshot: Map<String, Any?>,
    val destinations: List<TripDestination>,
    val status: TripStatus,
    val deletedAt: Instant?,
    val createdAt: Instant,
    val updatedAt: Instant,
    /**
     * 여행이 끝났다고 **기록된** 시각(TRIP-554).
     *
     * [statusAt] 이 날짜에서 파생하는 것과 별개다 — 파생 상태로는 이벤트를 만들 수 없다. 사건에는
     * 순간이 필요하고, 순간은 기록돼야 한다. 이 값이 채워졌다는 것은 `trip.TripEnded` 가 **한 번
     * 발행됐다**는 뜻이다(그 조건부 쓰기가 멱등의 전부다). 기본값이 있어 기존 호출자를 깨지 않는다.
     */
    val endedAt: Instant? = null,
) {
    /**
     * 편집 가능한가 — **날짜로 판정한다**(TRIP-U1 후속).
     *
     * 예전에는 저장된 [status] 가 `ENDED` 인지 봤다. 그런데 그 값은 **절대 `ENDED` 가 되지 않는다** —
     * 상태를 밀어 올리는 코드도 배치도 없다([statusAt] 주석 참조). 그래서 아래 가드가 한 번도 발동한 적이
     * 없고, 3년 전 끝난 여행의 날짜도 바꿀 수 있었다. 조용히 뚫려 있던 자리다.
     *
     * **여행 중(ACTIVE)은 막지 않는다.** 현장에서 일정이 바뀌는 것이 정상이고, 그건 재계획(C10)의 전제다.
     * 끝난 여행만 막는다.
     */
    fun editableAt(today: LocalDate): Boolean =
        deletedAt == null && statusAt(today) != TripStatus.ENDED

    /**
     * 여행이 **지금 어느 단계인가** — 저장된 [status] 가 아니라 날짜에서 파생한다.
     *
     * 저장된 값은 `PLANNED` 에서 움직이지 않는다: [TripStatus.canTransitionTo] 를 부르는 프로덕션 코드가
     * 없고 상태를 밀어 올리는 배치도 없다. 그래서 **지난 여행도 계속 "예정"으로 나갔다** — 홈 화면이
     * 끝난 여행을 목록에서 못 거르고(`homePhase.ts` 는 `ENDED` 를 걸러 낸다), 여행 중에도 "여행 중" 배지를
     * 못 달았다(`ACTIVE` 를 기대한다). 프론트 계약은 이미 옳았고 서버가 값을 안 준 것이다.
     *
     * `CONFIRMED` 는 날짜로 만들 수 없는 **사용자 행동**이라 여행 전 구간에서만 저장값을 그대로 쓴다.
     */
    fun statusAt(today: LocalDate): TripStatus = when {
        today > endDate -> TripStatus.ENDED
        today >= startDate -> TripStatus.ACTIVE
        else -> status
    }

    fun edit(
        title: String?,
        startDate: LocalDate,
        endDate: LocalDate,
        party: Int,
        companionType: CompanionType?,
        budgetTotal: Long?,
        destinations: List<TripDestination>,
        now: Instant,
    ): Trip {
        // 여행지 기준(KST)으로 오늘을 정한다 — 서버가 UTC 면 자정 무렵 하루가 어긋난다.
        if (!editableAt(now.atZone(TRAVEL_ZONE).toLocalDate())) {
            throw ConflictDetected(message = "종료·삭제된 여행은 편집할 수 없습니다.")
        }
        validate(startDate, endDate, party, destinations)
        return Trip(
            tripId, accountId, resolveTitle(title, destinations), startDate, endDate, party,
            companionType, budgetTotal, preferenceSnapshot, destinations, status, deletedAt, createdAt, now,
        )
    }

    fun softDelete(now: Instant): Trip {
        if (deletedAt != null) throw ConflictDetected(message = "이미 삭제된 여행입니다.")
        return Trip(
            tripId, accountId, title, startDate, endDate, party, companionType, budgetTotal,
            preferenceSnapshot, destinations, status, now, createdAt, now,
        )
    }

    companion object {
        /** 여행지 기준 시간대. 서버 시간대(UTC)로 오늘을 정하면 자정 무렵 하루가 어긋난다. */
        private val TRAVEL_ZONE: java.time.ZoneId = java.time.ZoneId.of("Asia/Seoul")


        fun create(
            accountId: UUID,
            title: String?,
            startDate: LocalDate,
            endDate: LocalDate,
            party: Int,
            companionType: CompanionType?,
            budgetTotal: Long?,
            preferenceSnapshot: Map<String, Any?>,
            destinations: List<TripDestination>,
            now: Instant,
        ): Trip {
            validate(startDate, endDate, party, destinations)
            return Trip(
                UUID.randomUUID(), accountId, resolveTitle(title, destinations), startDate, endDate, party,
                companionType, budgetTotal, preferenceSnapshot, destinations, TripStatus.PLANNED, null, now, now,
            )
        }

        @Suppress("LongParameterList")
        fun reconstitute(
            tripId: UUID, accountId: UUID, title: String, startDate: LocalDate, endDate: LocalDate,
            party: Int, companionType: CompanionType?, budgetTotal: Long?, preferenceSnapshot: Map<String, Any?>,
            destinations: List<TripDestination>, status: TripStatus, deletedAt: Instant?, createdAt: Instant, updatedAt: Instant,
            endedAt: Instant? = null,
        ): Trip = Trip(
            tripId, accountId, title, startDate, endDate, party, companionType, budgetTotal,
            preferenceSnapshot, destinations, status, deletedAt, createdAt, updatedAt, endedAt,
        )

        private fun resolveTitle(title: String?, destinations: List<TripDestination>): String =
            title?.takeIf { it.isNotBlank() } ?: "${destinations.firstOrNull()?.region ?: "새"} 여행"

        private fun validate(startDate: LocalDate, endDate: LocalDate, party: Int, destinations: List<TripDestination>) {
            val errors = mutableListOf<FieldError>()
            if (endDate.isBefore(startDate)) errors += FieldError("endDate", "종료일은 시작일 이후여야 합니다.") // INV-U1-11
            if (party < 1) errors += FieldError("party", "인원은 1명 이상이어야 합니다.")
            if (destinations.isEmpty()) errors += FieldError("destinations", "목적지는 최소 1개입니다.")
            if (destinations.any { it.nights < 0 }) errors += FieldError("destinations", "박수는 0 이상입니다.")
            val tripNights = ChronoUnit.DAYS.between(startDate, endDate)
            if (destinations.sumOf { it.nights }.toLong() > tripNights) {
                errors += FieldError("destinations", "도시별 박수 합이 여행 기간을 넘을 수 없습니다.") // INV-U1-14
            }
            if (errors.isNotEmpty()) throw ValidationFailed(errors)
        }
    }
}
