package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.GenerationStatus
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

/**
 * 생성 진행 상태(TRIP-312 · BR-U3-04·05 · US-SCHED-09).
 *
 * 화면(h09·h10)이 단계 텍스트·[취소]를 그리는 원천이라, **여기서 틀리면 사용자는 끝난 생성을 계속 기다린다**.
 */
class GenerationSessionServiceTest : StringSpec({

    val acc = UUID.randomUUID()
    val trip = UUID.randomUUID()
    val other = UUID.randomUUID()
    val clock = Clock.fixed(Instant.parse("2026-08-11T09:00:00Z"), ZoneOffset.UTC)

    fun trips(owned: Set<UUID> = setOf(trip, other)) = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) =
            if (accountId == acc && tripId in owned) {
                TripPeriod(LocalDate.parse("2026-08-01"), LocalDate.parse("2026-08-03"))
            } else {
                null
            }

        override fun findGenerationContext(accountId: UUID, tripId: UUID) = null
    }

    fun svc(repo: FakeGenerationSessions = FakeGenerationSessions(), owned: Set<UUID> = setOf(trip, other)) =
        genSessions(trips(owned), repo, clock)

    "생성을 시작하면 RUNNING 세션이 하나 열린다" {
        val repo = FakeGenerationSessions()
        val s = svc(repo).start(trip, GenerationMode.FULLY_AI)

        s.status shouldBe GenerationStatus.RUNNING
        s.itineraryId.shouldBeNull() // day1 전에는 일정이 없다
        s.finishedAt.shouldBeNull()
        repo.findRunningByTrip(trip)!!.sessionId shouldBe s.sessionId
    }

    // 재생성은 정상 흐름이다 — 이전 세션이 살아 있다고 막으면 사용자가 다시 만들 수 없다.
    "재생성하면 이전 세션을 닫고 새로 시작한다 — 진행 중은 언제나 하나" {
        val repo = FakeGenerationSessions()
        val service = svc(repo)
        val first = service.start(trip, GenerationMode.FULLY_AI)
        val second = service.start(trip, GenerationMode.CO_PLAN)

        repo.rows[first.sessionId]!!.status shouldBe GenerationStatus.CANCELED
        repo.findRunningByTrip(trip)!!.sessionId shouldBe second.sessionId
    }

    "다른 여행의 진행 중 세션은 닫지 않는다" {
        val repo = FakeGenerationSessions()
        val service = svc(repo)
        val onOther = service.start(other, GenerationMode.FULLY_AI)
        service.start(trip, GenerationMode.FULLY_AI)

        repo.rows[onOther.sessionId]!!.status shouldBe GenerationStatus.RUNNING
    }

    // 폴백 근거를 day1 시점에 함께 실어야 배너가 첫 노출부터 사실을 말한다(BR-U3-11 · INV-4).
    "day1 이 나오면 일정 id 와 폴백 근거가 함께 실린다" {
        val repo = FakeGenerationSessions()
        val service = svc(repo)
        val s = service.start(trip, GenerationMode.FULLY_AI)
        val itinerary = UUID.randomUUID()

        val after = service.day1Ready(s.sessionId, itinerary, isFallback = true, candidatesLevel = "LOW")!!

        after.status shouldBe GenerationStatus.DAY1_READY
        after.itineraryId shouldBe itinerary
        after.isFallback shouldBe true
        after.candidatesLevel shouldBe "LOW"
        after.day1ReadyAt shouldBe clock.instant()
    }

    "취소하면 CANCELED 로 닫히고 끝난 시각이 남는다" {
        val repo = FakeGenerationSessions()
        val service = svc(repo)
        val s = service.start(trip, GenerationMode.FULLY_AI)

        val after = service.cancel(acc, trip, s.sessionId)

        after.status shouldBe GenerationStatus.CANCELED
        after.finishedAt shouldBe clock.instant()
        service.isCanceled(s.sessionId) shouldBe true
    }

    // 두 번 눌러도 같은 결과여야 화면이 흔들리지 않는데, 여기서는 "이미 끝났다"를 알려 준다 —
    // 완료 직후 취소를 누른 사용자에게 "취소됐다"고 하면 거짓말이 된다(INV-4 침묵 금지와 같은 취지).
    "이미 끝난 세션의 취소는 409" {
        val repo = FakeGenerationSessions()
        val service = svc(repo)
        val s = service.start(trip, GenerationMode.FULLY_AI)
        service.completed(s.sessionId, isFallback = false, candidatesLevel = null)

        shouldThrow<ConflictDetected> { service.cancel(acc, trip, s.sessionId) }
    }

    // 취소는 "2차 결과를 반영하지 않는다"는 뜻 — 늦게 도착한 완료가 세션을 되살리면 화면이 다시 바뀐다.
    "취소된 세션은 뒤늦은 완료·실패로 되살아나지 않는다" {
        val repo = FakeGenerationSessions()
        val service = svc(repo)
        val s = service.start(trip, GenerationMode.FULLY_AI)
        service.cancel(acc, trip, s.sessionId)

        service.completed(s.sessionId, isFallback = false, candidatesLevel = null).shouldBeNull()
        service.failed(s.sessionId).shouldBeNull()
        repo.rows[s.sessionId]!!.status shouldBe GenerationStatus.CANCELED
    }

    "2차 실패는 세션만 닫는다 — day1 은 일정에 남아 유효하다" {
        val repo = FakeGenerationSessions()
        val service = svc(repo)
        val s = service.start(trip, GenerationMode.FULLY_AI)
        val itinerary = UUID.randomUUID()
        service.day1Ready(s.sessionId, itinerary, isFallback = false, candidatesLevel = null)

        val after = service.failed(s.sessionId)!!

        after.status shouldBe GenerationStatus.FAILED
        after.itineraryId shouldBe itinerary
    }

    "남의 여행 세션은 id 를 알아도 못 본다 — 404" {
        val repo = FakeGenerationSessions()
        val s = svc(repo).start(trip, GenerationMode.FULLY_AI)

        // 소유하지 않은 계정
        shouldThrow<ResourceNotFound> { svc(repo).get(UUID.randomUUID(), trip, s.sessionId) }
    }

    // 경로의 여행과 세션의 여행이 어긋나면 소유 검증을 통과한 뒤에도 막아야 한다 —
    // 내 여행 id 로 남의 세션을 조회하는 경로가 열린다.
    "다른 여행 경로로 조회한 세션은 404" {
        val repo = FakeGenerationSessions()
        val service = svc(repo)
        val s = service.start(trip, GenerationMode.FULLY_AI)

        shouldThrow<ResourceNotFound> { service.get(acc, other, s.sessionId) }
    }

    "없는 세션은 404" {
        shouldThrow<ResourceNotFound> { svc().get(acc, trip, UUID.randomUUID()) }
    }
})
