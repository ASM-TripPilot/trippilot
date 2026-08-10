package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.itinerarygeneration.api.ItineraryRef
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.trip.api.TripFacade
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

/**
 * [ItineraryFacade] 구현 — 소유 스코프를 적용해 api-safe 요약만 노출한다.
 * 타 계정·없는 여행은 null(존재 은닉, 다른 서비스들과 같은 규칙).
 */
@Service
class ItineraryReadFacade(
    private val trips: TripFacade,
    private val itineraries: ItineraryRepository,
) : ItineraryFacade {

    @Transactional(readOnly = true)
    override fun findCurrent(accountId: UUID, tripId: UUID): ItineraryRef? {
        trips.findPeriod(accountId, tripId) ?: return null
        val itinerary = itineraries.findByTrip(tripId).firstOrNull() ?: return null
        return ItineraryRef(
            itineraryId = itinerary.itineraryId,
            status = itinerary.status.name,
            generationState = itinerary.generationState.name,
            dates = itinerary.days.map { it.date },
            // 물리 키가 아니라 경계 키로 넘긴다 — 재계획으로 슬롯 행이 갈려도 참조가 끊기지 않는다(BR-U2-04).
            slotKeys = itinerary.days.flatMap { d -> d.slots.map { SlotKey.of(d.date, it.sourcePoiId) } },
        )
    }
}
