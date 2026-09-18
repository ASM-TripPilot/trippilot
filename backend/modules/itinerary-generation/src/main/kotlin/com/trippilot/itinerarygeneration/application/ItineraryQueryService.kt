package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.trip.api.TripFacade
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

/**
 * 일정 조회(C8 · US-SCHED-06). 소유 여행의 현행 일정(여행당 1개, replaceForTrip 불변식)을 반환.
 * 여행이 없거나 삭제·타 계정이면 404(존재 은닉), 여행은 있으나 생성 이력이 없어도 404.
 */
@Service
class ItineraryQueryService(
    private val trips: TripFacade,
    private val itineraries: ItineraryRepository,
) {
    @Transactional(readOnly = true)
    fun get(accountId: UUID, tripId: UUID): Itinerary {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        return itineraries.findByTrip(tripId).firstOrNull() ?: throw ResourceNotFound("생성된 일정이 없습니다.")
    }
}
