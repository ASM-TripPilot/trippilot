package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
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

/** 확정 상태 전이 — PLANNED→CONFIRMED, 재확정 409, 미소유·일정없음 404. */
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

    "확정하면 CONFIRMED" {
        val repo = ConfirmFakeItineraries().apply { replaceForTrip(tripId, planned()) }
        ConfirmItineraryService(trips(true), repo, clock).confirm(acc, tripId).status shouldBe ItineraryStatus.CONFIRMED
    }

    "이미 확정이면 409" {
        val repo = ConfirmFakeItineraries().apply { replaceForTrip(tripId, planned()) }
        val svc = ConfirmItineraryService(trips(true), repo, clock)
        svc.confirm(acc, tripId)
        shouldThrow<ConflictDetected> { svc.confirm(acc, tripId) }
    }

    "생성된 일정 없으면 404" {
        shouldThrow<ResourceNotFound> {
            ConfirmItineraryService(trips(true), ConfirmFakeItineraries(), clock).confirm(acc, tripId)
        }
    }

    "미소유 여행이면 404" {
        val repo = ConfirmFakeItineraries().apply { replaceForTrip(tripId, planned()) }
        shouldThrow<ResourceNotFound> { ConfirmItineraryService(trips(false), repo, clock).confirm(acc, tripId) }
    }
})
