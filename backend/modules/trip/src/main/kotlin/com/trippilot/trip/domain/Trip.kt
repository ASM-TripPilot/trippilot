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
 * 불변식: INV-U1-11(end≥start) · INV-U1-12(국내강제) · INV-U1-14(Σnights≤기간) · INV-U1-13(상태 단방향).
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
) {
    val editable: Boolean get() = deletedAt == null && status != TripStatus.ENDED

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
        if (!editable) throw ConflictDetected(message = "종료·삭제된 여행은 편집할 수 없습니다.")
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
        // 국내강제(INV-U1-12) 스텁 — 실제는 지오코딩 후 대한민국 영역 검증(place-data·Sprint 3).
        val KNOWN_KOREAN_REGIONS = setOf(
            "서울", "부산", "인천", "대구", "대전", "광주", "울산", "세종",
            "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
            "경주", "강릉", "여수", "속초", "전주", "춘천", "통영", "포항", "안동", "목포", "군산", "가평",
        )

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
        ): Trip = Trip(
            tripId, accountId, title, startDate, endDate, party, companionType, budgetTotal,
            preferenceSnapshot, destinations, status, deletedAt, createdAt, updatedAt,
        )

        private fun resolveTitle(title: String?, destinations: List<TripDestination>): String =
            title?.takeIf { it.isNotBlank() } ?: "${destinations.firstOrNull()?.region ?: "새"} 여행"

        private fun validate(startDate: LocalDate, endDate: LocalDate, party: Int, destinations: List<TripDestination>) {
            val errors = mutableListOf<FieldError>()
            if (endDate.isBefore(startDate)) errors += FieldError("endDate", "종료일은 시작일 이후여야 합니다.") // INV-U1-11
            if (party < 1) errors += FieldError("party", "인원은 1명 이상이어야 합니다.")
            if (destinations.isEmpty()) errors += FieldError("destinations", "목적지는 최소 1개입니다.")
            destinations.firstOrNull { it.region !in KNOWN_KOREAN_REGIONS }
                ?.let { errors += FieldError("destinations", "지금은 국내 여행만 지원해요: ${it.region}") } // INV-U1-12
            if (destinations.any { it.nights < 0 }) errors += FieldError("destinations", "박수는 0 이상입니다.")
            val tripNights = ChronoUnit.DAYS.between(startDate, endDate)
            if (destinations.sumOf { it.nights }.toLong() > tripNights) {
                errors += FieldError("destinations", "도시별 박수 합이 여행 기간을 넘을 수 없습니다.") // INV-U1-14
            }
            if (errors.isNotEmpty()) throw ValidationFailed(errors)
        }
    }
}
