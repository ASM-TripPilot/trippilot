package com.trippilot.savedaccommodation.application

import com.trippilot.core.event.DomainEvent
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.savedaccommodation.domain.TripBaseDay
import com.trippilot.savedaccommodation.domain.TripBaseDayRepository
import java.time.LocalDate
import java.util.UUID

/** 인메모리 날짜별 확정 거점. 하루 1행(PK)을 키로 흉내낸다 — 다시 고르면 덮어쓴다. */
internal class FakeTripBaseDays : TripBaseDayRepository {
    val rows = linkedMapOf<Pair<UUID, LocalDate>, TripBaseDay>()

    override fun findByTrip(tripId: UUID): List<TripBaseDay> = rows.values.filter { it.tripId == tripId }

    override fun save(day: TripBaseDay): TripBaseDay {
        rows[day.tripId to day.dayDate] = day
        return day
    }
}

internal class CapturingEvents : DomainEventPublisher {
    val published = mutableListOf<DomainEvent>()
    override fun publish(event: DomainEvent) { published += event }
}
