package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.GenerationState
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.SolveMode
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

/**
 * 중단된 2차 생성 정리(TRIP-267). 프로세스가 끊기면 일정이 PARTIAL 로 남아 확정·편집이 영구 409 가 된다 —
 * 오래된 PARTIAL 만 FAILED 로 내려 잠금을 풀되, **진행 중인** 생성은 건드리지 않아야 한다.
 */
class StalePartialSweeperTest : StringSpec({

    val now = Instant.parse("2026-08-06T00:00:00Z")
    val clock = Clock.fixed(now, ZoneOffset.UTC)
    val start = LocalDate.parse("2026-08-01")

    fun partialUpdatedAt(at: Instant): Itinerary = Itinerary.reconstitute(
        UUID.randomUUID(), UUID.randomUUID(), com.trippilot.itinerarygeneration.domain.ItineraryStatus.PLANNED,
        SolveMode.FULL_AI, false, GenerationState.PARTIAL,
        listOf(ItineraryDay.of(start, 0, emptyList())), at, at, null,
    )

    class Repo(seed: List<Itinerary>) : ItineraryRepository {
        val byTrip = seed.associateBy { it.tripId }.toMutableMap()
        override fun save(itinerary: Itinerary) = itinerary.also { byTrip[it.tripId] = it }
        override fun findById(itineraryId: UUID) = byTrip.values.firstOrNull { it.itineraryId == itineraryId }
        override fun findByTrip(tripId: UUID) = listOfNotNull(byTrip[tripId])
        override fun replaceForTrip(tripId: UUID, itinerary: Itinerary) = itinerary.also { byTrip[tripId] = it }
        override fun replaceIfCurrent(tripId: UUID, expectedItineraryId: UUID, itinerary: Itinerary): Boolean {
            val cur = byTrip[tripId] ?: return false
            if (cur.itineraryId != expectedItineraryId || cur.generationState != GenerationState.PARTIAL) return false
            byTrip[tripId] = itinerary
            return true
        }
        override fun findStalePartial(updatedBefore: Instant) =
            byTrip.values.filter { it.generationState == GenerationState.PARTIAL && it.updatedAt < updatedBefore }
    }

    "5분 넘게 멈춰 있던 PARTIAL 은 FAILED 로 내려 확정·편집 잠금을 푼다" {
        val stale = partialUpdatedAt(now.minusSeconds(600))
        val repo = Repo(listOf(stale))
        StalePartialSweeper(repo, clock).sweep()

        val swept = repo.byTrip.getValue(stale.tripId)
        swept.generationState shouldBe GenerationState.FAILED
        swept.days.map { it.date } shouldBe listOf(start) // 1차분(day1)은 그대로 유효
    }

    "진행 중인 PARTIAL(2차 시한 이내)은 건드리지 않는다" {
        val running = partialUpdatedAt(now.minusSeconds(10))
        val repo = Repo(listOf(running))
        StalePartialSweeper(repo, clock).sweep()

        repo.byTrip.getValue(running.tripId).generationState shouldBe GenerationState.PARTIAL
    }
})
