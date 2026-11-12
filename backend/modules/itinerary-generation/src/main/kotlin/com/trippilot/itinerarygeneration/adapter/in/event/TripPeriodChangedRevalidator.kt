package com.trippilot.itinerarygeneration.adapter.`in`.event

import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxSubscriber
import com.trippilot.itinerarygeneration.application.ItineraryPeriodShiftService
import org.springframework.stereotype.Component
import java.util.UUID

/** 여행 날짜를 옮기면 일정 위반 표시를 새 요일로 다시 잰다(TRIP-1789) — [ItineraryPeriodShiftService.revalidate]. */
@Component
class TripPeriodChangedRevalidator(private val service: ItineraryPeriodShiftService) : OutboxSubscriber {
    override val eventType: String = "trip.TripPeriodChanged"

    override fun handle(envelope: EventEnvelope) {
        val tripId = runCatching { UUID.fromString(envelope.aggregateId) }.getOrNull()
            ?: error("TripPeriodChanged 의 aggregateId 를 여행으로 읽지 못했습니다. eventId=${envelope.eventId}")
        service.revalidate(tripId)
    }
}
