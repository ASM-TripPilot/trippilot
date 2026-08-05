package com.trippilot.trip.application

import com.trippilot.trip.api.FixedVisit
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.TripPeriod
import com.trippilot.trip.domain.MustVisitRepository
import com.trippilot.trip.domain.TripRepository
import org.springframework.stereotype.Service
import java.util.UUID

/**
 * [TripFacade] 구현 — TripRepository·MustVisitRepository 를 감싸 소유·삭제 스코프를 적용해 api-safe 데이터만 노출.
 * 타 계정·삭제 여행은 null(존재 은닉, TripService.ownedOrNotFound 와 동일 규칙).
 */
@Service
class TripPeriodFacade(
    private val repo: TripRepository,
    private val mustVisits: MustVisitRepository,
) : TripFacade {
    override fun findPeriod(accountId: UUID, tripId: UUID): TripPeriod? {
        val trip = repo.findById(tripId)?.takeIf { it.deletedAt == null && it.accountId == accountId } ?: return null
        return TripPeriod(trip.startDate, trip.endDate)
    }

    override fun findGenerationContext(accountId: UUID, tripId: UUID): TripGenerationContext? {
        val trip = repo.findById(tripId)?.takeIf { it.deletedAt == null && it.accountId == accountId } ?: return null
        val fixed = mustVisits.findByTrip(tripId).map { FixedVisit(it.sourcePoiId, it.fixedDate, it.fixedStart, it.dwellMin) }
        return TripGenerationContext(
            startDate = trip.startDate,
            endDate = trip.endDate,
            destinations = trip.destinations.sortedBy { it.seq }.map { it.region },
            companionType = trip.companionType?.name,
            budgetTotal = trip.budgetTotal,
            fixedVisits = fixed,
        )
    }
}
