package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.event.DomainEvent
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.itinerarygeneration.api.event.ItineraryConfirmed
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.ItineraryStatus
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

private class ConfirmFakeItineraries : ItineraryRepository {
    val store = mutableListOf<Itinerary>()
    override fun save(itinerary: Itinerary): Itinerary {
        store.removeAll { it.itineraryId == itinerary.itineraryId }
        store += itinerary
        return itinerary
    }
    override fun findById(itineraryId: UUID) = store.firstOrNull { it.itineraryId == itineraryId }
    override fun findByTrip(tripId: UUID) = store.filter { it.tripId == tripId }
    override fun replaceForTrip(tripId: UUID, itinerary: Itinerary): Itinerary {
        store.removeAll { it.tripId == tripId }
        store += itinerary
        return itinerary
    }
}

private class ConfirmCapturingPublisher : DomainEventPublisher {
    val published = mutableListOf<DomainEvent>()
    override fun publish(event: DomainEvent) { published += event }
}

/** 확정 상태 전이 — PLANNED→CONFIRMED, 재확정 409, 미소유·일정없음 404, 확정 이벤트 발행. */
class ConfirmItineraryServiceTest : StringSpec({

    val clock = Clock.fixed(Instant.parse("2026-08-06T00:00:00Z"), ZoneOffset.UTC)
    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val start = LocalDate.parse("2026-08-01")
    val end = LocalDate.parse("2026-08-02")

    fun trips(owned: Boolean) = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) =
            if (owned && accountId == acc) TripPeriod(start, end) else null
        override fun findGenerationContext(accountId: UUID, tripId: UUID): TripGenerationContext? = null
    }

    fun planned() = Itinerary.create(tripId, SolveMode.DETERMINISTIC, false, emptyList(), clock.instant())

    "확정하면 CONFIRMED + ItineraryConfirmed 이벤트 발행" {
        val repo = ConfirmFakeItineraries().apply { replaceForTrip(tripId, planned()) }
        val publisher = ConfirmCapturingPublisher()
        val result = ConfirmItineraryService(trips(true), repo, publisher, clock).confirm(acc, tripId)
        result.status shouldBe ItineraryStatus.CONFIRMED
        val event = publisher.published.filterIsInstance<ItineraryConfirmed>().single()
        event.aggregateId shouldBe result.itineraryId.toString()
        event.tripId shouldBe tripId.toString()
    }

    "이미 확정이면 409" {
        val repo = ConfirmFakeItineraries().apply { replaceForTrip(tripId, planned()) }
        val svc = ConfirmItineraryService(trips(true), repo, ConfirmCapturingPublisher(), clock)
        svc.confirm(acc, tripId)
        shouldThrow<ConflictDetected> { svc.confirm(acc, tripId) }
    }

    "생성된 일정 없으면 404" {
        shouldThrow<ResourceNotFound> {
            ConfirmItineraryService(trips(true), ConfirmFakeItineraries(), ConfirmCapturingPublisher(), clock).confirm(acc, tripId)
        }
    }

    "미소유 여행이면 404" {
        val repo = ConfirmFakeItineraries().apply { replaceForTrip(tripId, planned()) }
        shouldThrow<ResourceNotFound> {
            ConfirmItineraryService(trips(false), repo, ConfirmCapturingPublisher(), clock).confirm(acc, tripId)
        }
    }
})
