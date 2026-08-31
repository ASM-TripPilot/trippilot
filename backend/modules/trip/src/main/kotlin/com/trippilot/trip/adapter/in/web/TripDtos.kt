package com.trippilot.trip.adapter.`in`.web

import com.trippilot.trip.application.CreateTripCommand
import com.trippilot.trip.application.EditTripCommand
import com.trippilot.trip.domain.CompanionType
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripCounts
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripStatus
import jakarta.validation.constraints.NotNull
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

data class DestinationDto(val seq: Int, val region: String, val nights: Int) {
    fun toDomain() = TripDestination(seq, region, nights)
    companion object {
        fun from(d: TripDestination) = DestinationDto(d.seq, d.region, d.nights)
    }
}

/** 여행 생성. 국내강제·날짜·Σnights 검증은 도메인. 취향 스냅숏은 클라이언트 제공(생성 시 동결). */
data class CreateTripRequest(
    val title: String? = null,
    @field:NotNull val startDate: LocalDate?,
    @field:NotNull val endDate: LocalDate?,
    val party: Int = 1,
    val companionType: CompanionType? = null,
    val budgetTotal: Long? = null,
    val preferenceSnapshot: Map<String, Any?> = emptyMap(),
    val destinations: List<DestinationDto> = emptyList(),
) {
    fun toCommand() = CreateTripCommand(
        title, startDate!!, endDate!!, party, companionType, budgetTotal,
        preferenceSnapshot, destinations.map { it.toDomain() },
    )
}

/** 여행 편집 — 가변 필드 대체. 취향 스냅숏은 불변. */
data class EditTripRequest(
    val title: String? = null,
    @field:NotNull val startDate: LocalDate?,
    @field:NotNull val endDate: LocalDate?,
    val party: Int = 1,
    val companionType: CompanionType? = null,
    val budgetTotal: Long? = null,
    val destinations: List<DestinationDto> = emptyList(),
) {
    fun toCommand() = EditTripCommand(
        title, startDate!!, endDate!!, party, companionType, budgetTotal, destinations.map { it.toDomain() },
    )
}

data class TripResponse(
    val tripId: UUID,
    val title: String,
    val startDate: LocalDate,
    val endDate: LocalDate,
    val party: Int,
    val companionType: CompanionType?,
    val budgetTotal: Long?,
    val preferenceSnapshot: Map<String, Any?>,
    val destinations: List<DestinationDto>,
    val status: TripStatus,
    val createdAt: Instant,
    val updatedAt: Instant,
    /** 등록 숙소 **수**(BR-U6-22). 0 이면 화면이 `숙소 미등록` 칩을 그린다. */
    val baseCount: Int,
    /** 일정이 있는 **일수**. 0 = 아직 생성되지 않음. 개수이지 시간이 아니다(INV-3). */
    val itineraryDayCount: Int,
) {
    companion object {
        /**
         * [counts] 에 **기본값을 두지 않는다.** 기본값을 두면 새 표면이 그것을 물려받아 실제로는
         * 숙소·일정이 있는 여행에 0 을 실어 보낸다 — 화면은 그 응답으로 캐시를 갱신하고 카드가
         * `숙소 미등록` 이 된다. 부르는 쪽이 매번 무엇인지 말하게 한다.
         */
        fun from(t: Trip, today: LocalDate, counts: TripCounts) = TripResponse(
            tripId = t.tripId, title = t.title, startDate = t.startDate, endDate = t.endDate,
            party = t.party, companionType = t.companionType, budgetTotal = t.budgetTotal,
            preferenceSnapshot = t.preferenceSnapshot, destinations = t.destinations.map { DestinationDto.from(it) },
            status = t.statusAt(today), createdAt = t.createdAt, updatedAt = t.updatedAt,
            baseCount = counts.baseCount, itineraryDayCount = counts.itineraryDayCount,
        )
    }
}
