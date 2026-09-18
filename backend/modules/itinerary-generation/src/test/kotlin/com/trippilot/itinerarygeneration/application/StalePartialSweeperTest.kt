package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.GenerationSession
import com.trippilot.itinerarygeneration.domain.GenerationState
import com.trippilot.itinerarygeneration.domain.GenerationStatus
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
        SolveMode.FULL_AI, GenerationMode.FULLY_AI, false, GenerationState.PARTIAL,
        listOf(ItineraryDay.of(start, 0, emptyList())), at, at, null, emptyList(),
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

    /**
     * 기준은 **기다려 주기로 한 시간에서 파생**된다(`ScheduleDeadlineProperties.staleAfter`).
     * 상수로 고정하면 시간제약을 푼 모드(TRIP-474)에서 **살아 있는 2차를 잘라낸다** —
     * 그 뒤 도착한 결과는 조건부 쓰기에 걸려 조용히 버려지고, 수 분어치 LLM 작업이 사라진다.
     */
    "기준을 넘게 멈춰 있던 PARTIAL 은 FAILED 로 내려 확정·편집 잠금을 푼다" {
        val stale = partialUpdatedAt(now.minus(defaultDeadlines.staleAfter).minusSeconds(1))
        val repo = Repo(listOf(stale))
        val sessionRepo = FakeGenerationSessions()
        val session = sessionRepo.save(GenerationSession.start(UUID.randomUUID(), stale.tripId, GenerationMode.FULLY_AI, now))
        StalePartialSweeper(repo, genSessions(repo = sessionRepo, clock = clock), clock, defaultDeadlines).sweep()

        val swept = repo.byTrip.getValue(stale.tripId)
        swept.generationState shouldBe GenerationState.FAILED
        swept.days.map { it.date } shouldBe listOf(start) // 1차분(day1)은 그대로 유효
        // 세션도 같이 닫는다 — 한쪽만 정리하면 일정은 FAILED 인데 화면은 계속 "생성 중"이다.
        sessionRepo.rows.getValue(session.sessionId).status shouldBe GenerationStatus.FAILED
    }

    /**
     * **플래그를 켜면 종전 5분 그대로다**(TRIP-475 9월 재도입 리허설). 파생식이 그 모드에서
     * 기준을 조이지 않는다는 것을 지금 고정한다.
     */
    "시한을 거는 모드에서는 기준이 종전 5분이다" {
        val enforced = ScheduleDeadlineProperties(enforced = true)
        val stale = partialUpdatedAt(now.minusSeconds(301))
        val repo = Repo(listOf(stale))
        val sessionRepo = FakeGenerationSessions()
        sessionRepo.save(GenerationSession.start(UUID.randomUUID(), stale.tripId, GenerationMode.FULLY_AI, now))

        StalePartialSweeper(repo, genSessions(repo = sessionRepo, clock = clock, deadlines = enforced), clock, enforced).sweep()

        repo.byTrip.getValue(stale.tripId).generationState shouldBe GenerationState.FAILED
    }

    /** 기준 직전은 아직 도는 중으로 본다 — 경계를 못으로 박아 값이 조용히 바뀌지 않게 한다. */
    "진행 중인 PARTIAL(기준 이내)은 건드리지 않는다" {
        val running = partialUpdatedAt(now.minus(defaultDeadlines.staleAfter).plusSeconds(1))
        val repo = Repo(listOf(running))
        val sessionRepo = FakeGenerationSessions()
        val session = sessionRepo.save(GenerationSession.start(UUID.randomUUID(), running.tripId, GenerationMode.FULLY_AI, now))
        StalePartialSweeper(repo, genSessions(repo = sessionRepo, clock = clock), clock, defaultDeadlines).sweep()

        repo.byTrip.getValue(running.tripId).generationState shouldBe GenerationState.PARTIAL
        sessionRepo.rows.getValue(session.sessionId).status shouldBe GenerationStatus.RUNNING
    }
})
