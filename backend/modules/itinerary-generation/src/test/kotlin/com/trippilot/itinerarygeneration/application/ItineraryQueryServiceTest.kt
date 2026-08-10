package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

private class QueryFakeItineraries : ItineraryRepository {
    val store = mutableListOf<Itinerary>()
    override fun save(itinerary: Itinerary) = itinerary.also { store += it }
    override fun findById(itineraryId: UUID) = store.firstOrNull { it.itineraryId == itineraryId }
    override fun findByTrip(tripId: UUID) = store.filter { it.tripId == tripId }
    override fun replaceForTrip(tripId: UUID, itinerary: Itinerary): Itinerary {
        store.removeAll { it.tripId == tripId }
        store += itinerary
        return itinerary
    }
    override fun replaceIfCurrent(tripId: UUID, expectedItineraryId: UUID, itinerary: Itinerary): Boolean {
        replaceForTrip(tripId, itinerary)
        return true
    }
    override fun findStalePartial(updatedBefore: java.time.Instant): List<Itinerary> = emptyList()

}

/** 조회 소유·존재 판정 — 미소유·일정없음은 404(존재 은닉). */
class ItineraryQueryServiceTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val start = LocalDate.parse("2026-08-01")
    val end = LocalDate.parse("2026-08-02")
    val now = Instant.parse("2026-08-06T00:00:00Z")

    fun trips(owned: Boolean) = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) =
            if (owned && accountId == acc) TripPeriod(start, end) else null
        override fun findGenerationContext(accountId: UUID, tripId: UUID): TripGenerationContext? = null
    }

    "소유 여행 + 일정 있으면 반환" {
        val repo = QueryFakeItineraries()
        repo.replaceForTrip(tripId, Itinerary.create(tripId, SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, false, emptyList(), now))
        ItineraryQueryService(trips(true), repo).get(acc, tripId).tripId shouldBe tripId
    }

    "소유 여행이나 일정 미생성이면 404" {
        shouldThrow<ResourceNotFound> {
            ItineraryQueryService(trips(true), QueryFakeItineraries()).get(acc, tripId)
        }
    }

    "미소유 여행이면 404" {
        val repo = QueryFakeItineraries()
        repo.replaceForTrip(tripId, Itinerary.create(tripId, SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, false, emptyList(), now))
        shouldThrow<ResourceNotFound> { ItineraryQueryService(trips(false), repo).get(acc, tripId) }
    }
})
