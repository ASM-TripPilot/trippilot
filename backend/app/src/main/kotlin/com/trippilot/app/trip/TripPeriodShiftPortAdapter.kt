package com.trippilot.app.trip

import com.trippilot.itinerarygeneration.api.ItineraryPeriodShiftFacade
import com.trippilot.savedaccommodation.api.TripBaseShiftFacade
import com.trippilot.trip.domain.TripPeriodShiftPort
import com.trippilot.trip.domain.TripPlanState
import org.springframework.stereotype.Component
import java.time.LocalDate
import java.util.UUID

/** 기간 이동을 일정·거점에 잇는다 — 둘 다 여행을 의존해 여기서만 조립할 수 있다([TripAggregatePortAdapter] 와 같은 이유). */
@Component
class TripPeriodShiftPortAdapter(
    private val itineraries: ItineraryPeriodShiftFacade,
    private val bases: TripBaseShiftFacade,
) : TripPeriodShiftPort {

    override fun lockPlan(accountId: UUID, tripId: UUID): TripPlanState =
        itineraries.lockForPeriodChange(accountId, tripId).let { TripPlanState(it.hasItinerary, it.generating, it.hasVisits) }

    override fun shiftDates(tripId: UUID, days: Long) {
        itineraries.shiftDates(tripId, days)
        bases.shiftDates(tripId, days)
    }

    override fun discardPlan(tripId: UUID, startDate: LocalDate, endDate: LocalDate) {
        itineraries.discard(tripId)
        bases.fitToPeriod(tripId, startDate, endDate)
    }
}
