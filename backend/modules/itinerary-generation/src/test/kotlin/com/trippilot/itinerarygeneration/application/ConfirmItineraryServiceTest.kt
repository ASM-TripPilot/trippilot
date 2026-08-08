package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.event.DomainEvent
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.itinerarygeneration.api.event.ItineraryConfirmed
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.ItineraryStatus
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.VisitSlot
import com.trippilot.placedata.api.PoiSnapshotFacade
import com.trippilot.placedata.api.PoiSnapshotRef
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
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
    override fun replaceIfCurrent(tripId: UUID, expectedItineraryId: UUID, itinerary: Itinerary): Boolean {
        replaceForTrip(tripId, itinerary)
        return true
    }
    override fun findStalePartial(updatedBefore: java.time.Instant): List<Itinerary> = emptyList()

}

private class ConfirmCapturingPublisher : DomainEventPublisher {
    val published = mutableListOf<DomainEvent>()
    override fun publish(event: DomainEvent) { published += event }
}

/** freezable=null 이면 전부 동결 가능; 집합이면 그 POI 만 동결 가능(외는 null=비-ACTIVE). */
private class FakeSnapshots(private val freezable: Set<UUID>? = null) : PoiSnapshotFacade {
    val frozen = mutableListOf<UUID>()
    override fun freeze(poiId: UUID): PoiSnapshotRef? {
        if (freezable != null && poiId !in freezable) return null
        frozen += poiId
        return PoiSnapshotRef(UUID.randomUUID(), poiId, "장소", 33.0, 126.0, "자연")
    }
}

/** 확정 — 상태 전이 + poi_snapshot 동결(INV-U1-03), 재확정 409, 미소유·일정없음 404, 동결불가 400, 이벤트 발행. */
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

    fun plannedWith(poi: UUID) = Itinerary.create(
        tripId, SolveMode.DETERMINISTIC, false,
        listOf(ItineraryDay.of(start, 0, listOf(VisitSlot.of(poi, null, 0, LocalTime.parse("10:00"), LocalTime.parse("11:00"))))),
        clock.instant(),
    )

    fun service(repo: ConfirmFakeItineraries, snaps: FakeSnapshots = FakeSnapshots(), owned: Boolean = true, pub: ConfirmCapturingPublisher = ConfirmCapturingPublisher()) =
        ConfirmItineraryService(trips(owned), repo, snaps, pub, clock)

    "확정하면 CONFIRMED + ItineraryConfirmed 이벤트 발행" {
        val repo = ConfirmFakeItineraries().apply { replaceForTrip(tripId, planned()) }
        val pub = ConfirmCapturingPublisher()
        val result = service(repo, pub = pub).confirm(acc, tripId)
        result.status shouldBe ItineraryStatus.CONFIRMED
        val event = pub.published.filterIsInstance<ItineraryConfirmed>().single()
        event.aggregateId shouldBe result.itineraryId.toString()
        event.tripId shouldBe tripId.toString()
    }

    "확정 시 전 슬롯 POI 동결 — poiSnapshotId 세팅(INV-U1-03)" {
        val poi = UUID.randomUUID()
        val repo = ConfirmFakeItineraries().apply { replaceForTrip(tripId, plannedWith(poi)) }
        val snaps = FakeSnapshots()
        val result = service(repo, snaps).confirm(acc, tripId)
        result.days.single().slots.single().poiSnapshotId.shouldNotBeNull()
        snaps.frozen shouldContain poi
    }

    "여러 슬롯(distinct POI) 전부 동결" {
        val poiA = UUID.randomUUID()
        val poiB = UUID.randomUUID()
        val withTwo = Itinerary.create(
            tripId, SolveMode.DETERMINISTIC, false,
            listOf(
                ItineraryDay.of(
                    start, 0,
                    listOf(
                        VisitSlot.of(poiA, null, 0, LocalTime.parse("10:00"), LocalTime.parse("11:00")),
                        VisitSlot.of(poiB, null, 1, LocalTime.parse("12:00"), LocalTime.parse("13:00")),
                    ),
                ),
            ),
            clock.instant(),
        )
        val repo = ConfirmFakeItineraries().apply { replaceForTrip(tripId, withTwo) }
        val snaps = FakeSnapshots()
        val result = service(repo, snaps).confirm(acc, tripId)
        result.days.single().slots.all { it.poiSnapshotId != null } shouldBe true
        snaps.frozen.toSet() shouldBe setOf(poiA, poiB)
    }

    "동결 불가 POI 있으면 확정 불가 409(상태 충돌)" {
        val poi = UUID.randomUUID()
        val repo = ConfirmFakeItineraries().apply { replaceForTrip(tripId, plannedWith(poi)) }
        shouldThrow<ConflictDetected> { service(repo, FakeSnapshots(freezable = emptySet())).confirm(acc, tripId) }
    }

    "이미 확정이면 409" {
        val repo = ConfirmFakeItineraries().apply { replaceForTrip(tripId, planned()) }
        val svc = service(repo)
        svc.confirm(acc, tripId)
        shouldThrow<ConflictDetected> { svc.confirm(acc, tripId) }
    }

    "생성된 일정 없으면 404" {
        shouldThrow<ResourceNotFound> { service(ConfirmFakeItineraries()).confirm(acc, tripId) }
    }

    "미소유 여행이면 404" {
        val repo = ConfirmFakeItineraries().apply { replaceForTrip(tripId, planned()) }
        shouldThrow<ResourceNotFound> { service(repo, owned = false).confirm(acc, tripId) }
    }
})
