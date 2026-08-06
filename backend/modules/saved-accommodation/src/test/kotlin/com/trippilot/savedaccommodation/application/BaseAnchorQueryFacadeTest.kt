package com.trippilot.savedaccommodation.application

import com.trippilot.savedaccommodation.api.DayAnchorView
import com.trippilot.savedaccommodation.domain.BaseAssignment
import com.trippilot.savedaccommodation.domain.BaseAssignmentRepository
import com.trippilot.savedaccommodation.domain.RegisterRoute
import com.trippilot.savedaccommodation.domain.SavedStay
import com.trippilot.savedaccommodation.domain.SavedStayRepository
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.TripPeriod
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

private class AnchorBases : BaseAssignmentRepository {
    val store = mutableMapOf<UUID, BaseAssignment>()
    override fun save(base: BaseAssignment) = base.also { store[it.baseAssignmentId] = it }
    override fun findByTrip(tripId: UUID) = store.values.filter { it.tripId == tripId }
    override fun findById(baseAssignmentId: UUID) = store[baseAssignmentId]
    override fun delete(base: BaseAssignment) { store.remove(base.baseAssignmentId) }
    override fun existsByStayId(savedStayId: UUID) = store.values.any { it.savedStayId == savedStayId }
}

private class AnchorStays : SavedStayRepository {
    val store = mutableMapOf<UUID, SavedStay>()
    override fun save(stay: SavedStay) = stay.also { store[it.savedStayId] = it }
    override fun findById(savedStayId: UUID) = store[savedStayId]
    override fun findByAccount(accountId: UUID) = store.values.filter { it.accountId == accountId }
    override fun delete(stay: SavedStay) { store.remove(stay.savedStayId) }
}

private class AnchorTrips : TripFacade {
    val periods = mutableMapOf<Pair<UUID, UUID>, TripPeriod>()
    override fun findPeriod(accountId: UUID, tripId: UUID) = periods[accountId to tripId]
    override fun findGenerationContext(accountId: UUID, tripId: UUID): TripGenerationContext? = null
}

/**
 * BaseAnchorFacade 계약 — 확정(AUTO) 숙박일만 거점 좌표로. GAP/OVERLAP·미소유는 제외.
 * 판정은 CoverageResolver 재사용(BaseAssignmentService.coverage 와 정합).
 */
class BaseAnchorQueryFacadeTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val start = LocalDate.parse("2026-08-01")
    val end = LocalDate.parse("2026-08-04") // 숙박일 = 08-01·02·03 (체크아웃 08-04)
    val now = Instant.parse("2026-08-01T00:00:00Z")

    fun facade(bases: AnchorBases, stays: AnchorStays): BaseAnchorQueryFacade {
        val trips = AnchorTrips().apply { periods[acc to tripId] = TripPeriod(start, end) }
        return BaseAnchorQueryFacade(bases, stays, trips)
    }

    fun stay(stays: AnchorStays, lat: Double, lng: Double): UUID =
        stays.save(SavedStay.register(acc, "숙소", lat, lng, true, null, null, null, null, RegisterRoute.PIN, null, now)).savedStayId

    "전 숙박일 단일 거점이면 각 밤에 좌표 앵커" {
        val bases = AnchorBases()
        val stays = AnchorStays()
        val s = stay(stays, 37.5, 127.0)
        bases.save(BaseAssignment.assign(tripId, s, start, end, start, end, now))
        facade(bases, stays).findStayNightAnchors(acc, tripId) shouldContainExactly listOf(
            DayAnchorView(LocalDate.parse("2026-08-01"), 37.5, 127.0),
            DayAnchorView(LocalDate.parse("2026-08-02"), 37.5, 127.0),
            DayAnchorView(LocalDate.parse("2026-08-03"), 37.5, 127.0),
        )
    }

    "공백일(GAP)은 앵커에서 제외" {
        val bases = AnchorBases()
        val stays = AnchorStays()
        val s = stay(stays, 37.5, 127.0)
        bases.save(BaseAssignment.assign(tripId, s, start, LocalDate.parse("2026-08-03"), start, end, now)) // 08-03 공백
        facade(bases, stays).findStayNightAnchors(acc, tripId).map { it.date } shouldContainExactly listOf(
            LocalDate.parse("2026-08-01"), LocalDate.parse("2026-08-02"),
        )
    }

    "미소유 여행이면 빈 목록" {
        facade(AnchorBases(), AnchorStays()).findStayNightAnchors(UUID.randomUUID(), tripId) shouldBe emptyList()
    }
})
