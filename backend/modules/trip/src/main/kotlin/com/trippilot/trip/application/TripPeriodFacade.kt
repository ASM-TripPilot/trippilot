package com.trippilot.trip.application

import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripPeriod
import com.trippilot.trip.domain.TripRepository
import org.springframework.stereotype.Service
import java.util.UUID

/**
 * [TripFacade] 구현 — TripRepository 를 감싸 소유·삭제 스코프를 적용해 api-safe 구간만 노출.
 * 타 계정·삭제 여행은 null(존재 은닉, TripService.ownedOrNotFound 와 동일 규칙).
 */
@Service
class TripPeriodFacade(
    private val repo: TripRepository,
) : TripFacade {
    override fun findPeriod(accountId: UUID, tripId: UUID): TripPeriod? {
        val trip = repo.findById(tripId)?.takeIf { it.deletedAt == null && it.accountId == accountId } ?: return null
        return TripPeriod(trip.startDate, trip.endDate)
    }
}
