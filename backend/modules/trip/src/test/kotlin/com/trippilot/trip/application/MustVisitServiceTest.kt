package com.trippilot.trip.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.placedata.api.PoiSnapshotFacade
import com.trippilot.placedata.api.PoiSnapshotRef
import com.trippilot.trip.domain.MustVisit
import com.trippilot.trip.domain.MustVisitRepository
import com.trippilot.trip.domain.MustVisitType
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

private class FakeMustVisits : MustVisitRepository {
    val stored = mutableListOf<MustVisit>()
    override fun save(mustVisit: MustVisit) = mustVisit.also { stored.add(it) }
    override fun findByTrip(tripId: UUID) = stored.filter { it.tripId == tripId }
    override fun findById(mustVisitId: UUID) = stored.firstOrNull { it.mustVisitId == mustVisitId }
    override fun existsByTripAndSourcePoi(tripId: UUID, sourcePoiId: UUID) = stored.any { it.tripId == tripId && it.sourcePoiId == sourcePoiId }
    override fun delete(mustVisit: MustVisit) { stored.removeIf { it.mustVisitId == mustVisit.mustVisitId } }
}

private class FakeTrips : TripRepository {
    val store = mutableMapOf<UUID, Trip>()
    override fun save(trip: Trip) = trip.also { store[it.tripId] = it }
    override fun findById(tripId: UUID) = store[tripId]
    override fun findByAccount(accountId: UUID) = store.values.filter { it.accountId == accountId }
}

/** activePoiId만 동결 가능(그 외 null=비-ACTIVE/없음). */
private class FakeSnapshots(private val activePoiId: UUID) : PoiSnapshotFacade {
    override fun freeze(poiId: UUID): PoiSnapshotRef? =
        if (poiId == activePoiId) PoiSnapshotRef(UUID.randomUUID(), poiId, "성산일출봉", 33.45, 126.94, "자연") else null
}

class MustVisitServiceTest : StringSpec({

    val clock = Clock.fixed(Instant.parse("2026-07-31T00:00:00Z"), ZoneOffset.UTC)
    val acc = UUID.randomUUID()
    val other = UUID.randomUUID()
    val poiId = UUID.randomUUID()

    fun fixture(): Triple<MustVisitService, FakeMustVisits, UUID> {
        val trips = FakeTrips()
        val trip = Trip.create(acc, null, LocalDate.parse("2026-08-01"), LocalDate.parse("2026-08-02"), 2, null, null, emptyMap(), listOf(TripDestination(0, "제주", 1)), clock.instant())
        trips.save(trip)
        val mvs = FakeMustVisits()
        return Triple(MustVisitService(mvs, trips, FakeSnapshots(poiId), clock), mvs, trip.tripId)
    }

    fun cmd(type: MustVisitType = MustVisitType.ANYTIME) = AddMustVisitCommand(poiId, type, null, null, 60)

    "추가 후 목록 — 스냅숏 참조" {
        val (svc, _, tripId) = fixture()
        val mv = svc.add(acc, tripId, cmd())
        mv.sourcePoiId shouldBe poiId
        svc.list(acc, tripId).single().mustVisitId shouldBe mv.mustVisitId
    }

    "타 계정 여행이면 404" {
        val (svc, _, tripId) = fixture()
        shouldThrow<ResourceNotFound> { svc.add(other, tripId, cmd()) }
    }

    "없거나 비-ACTIVE POI는 404(freeze null)" {
        val (svc, _, tripId) = fixture()
        shouldThrow<ResourceNotFound> { svc.add(acc, tripId, AddMustVisitCommand(UUID.randomUUID(), MustVisitType.ANYTIME, null, null, null)) }
    }

    "같은 POI 중복 추가는 409(INV-U1-18)" {
        val (svc, _, tripId) = fixture()
        svc.add(acc, tripId, cmd())
        shouldThrow<ConflictDetected> { svc.add(acc, tripId, cmd()) }
    }

    "삭제 후 목록 제외" {
        val (svc, _, tripId) = fixture()
        val mv = svc.add(acc, tripId, cmd())
        svc.remove(acc, tripId, mv.mustVisitId)
        svc.list(acc, tripId).size shouldBe 0
    }
})
