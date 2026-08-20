package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.domain.GENERATION_STALE_AFTER
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.GenerationStatus
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import java.time.Duration
import io.kotest.matchers.shouldNotBe
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
        val s = svc(repo).start(acc, trip, GenerationMode.FULLY_AI)

        s.status shouldBe GenerationStatus.RUNNING
        s.itineraryId.shouldBeNull() // day1 전에는 일정이 없다
        s.finishedAt.shouldBeNull()
        repo.findRunningByTrip(trip)!!.sessionId shouldBe s.sessionId
    }

    // 재생성은 정상 흐름이다 — 이전 세션이 살아 있다고 막으면 사용자가 다시 만들 수 없다.
    "재생성하면 이전 세션을 닫고 새로 시작한다 — 진행 중은 언제나 하나" {
        val repo = FakeGenerationSessions()
        val service = svc(repo)
        val first = service.start(acc, trip, GenerationMode.FULLY_AI)
        val second = service.start(acc, trip, GenerationMode.CO_PLAN)

        repo.rows[first.sessionId]!!.status shouldBe GenerationStatus.CANCELED
        repo.findRunningByTrip(trip)!!.sessionId shouldBe second.sessionId
    }

    /**
     * 세션 닫기는 **같은 여행**에만 적용된다.
     *
     * 예전에는 "다른 여행"으로 이 성질을 확인했는데, TRIP-403 이후 같은 계정의 다른 여행은 시작 자체가
     * 거절된다. 그래서 닫기 범위는 **다른 계정**으로 확인한다 — 성질은 그대로다.
     */
    "다른 계정의 진행 중 세션은 닫지 않는다" {
        val repo = FakeGenerationSessions()
        val service = svc(repo)
        val onOther = service.start(UUID.randomUUID(), other, GenerationMode.FULLY_AI)
        service.start(acc, trip, GenerationMode.FULLY_AI)

        repo.rows[onOther.sessionId]!!.status shouldBe GenerationStatus.RUNNING
    }

    // 폴백 근거를 day1 시점에 함께 실어야 배너가 첫 노출부터 사실을 말한다(BR-U3-11 · INV-4).
    "day1 이 나오면 일정 id 와 폴백 근거가 함께 실린다" {
        val repo = FakeGenerationSessions()
        val service = svc(repo)
        val s = service.start(acc, trip, GenerationMode.FULLY_AI)
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
        val s = service.start(acc, trip, GenerationMode.FULLY_AI)

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
        val s = service.start(acc, trip, GenerationMode.FULLY_AI)
        service.completed(s.sessionId, isFallback = false, candidatesLevel = null)

        shouldThrow<ConflictDetected> { service.cancel(acc, trip, s.sessionId) }
    }

    // 취소는 "2차 결과를 반영하지 않는다"는 뜻 — 늦게 도착한 완료가 세션을 되살리면 화면이 다시 바뀐다.
    "취소된 세션은 뒤늦은 완료·실패로 되살아나지 않는다" {
        val repo = FakeGenerationSessions()
        val service = svc(repo)
        val s = service.start(acc, trip, GenerationMode.FULLY_AI)
        service.cancel(acc, trip, s.sessionId)

        service.completed(s.sessionId, isFallback = false, candidatesLevel = null).shouldBeNull()
        service.failed(s.sessionId).shouldBeNull()
        repo.rows[s.sessionId]!!.status shouldBe GenerationStatus.CANCELED
    }

    "2차 실패는 세션만 닫는다 — day1 은 일정에 남아 유효하다" {
        val repo = FakeGenerationSessions()
        val service = svc(repo)
        val s = service.start(acc, trip, GenerationMode.FULLY_AI)
        val itinerary = UUID.randomUUID()
        service.day1Ready(s.sessionId, itinerary, isFallback = false, candidatesLevel = null)

        val after = service.failed(s.sessionId)!!

        after.status shouldBe GenerationStatus.FAILED
        after.itineraryId shouldBe itinerary
    }

    "남의 여행 세션은 id 를 알아도 못 본다 — 404" {
        val repo = FakeGenerationSessions()
        val s = svc(repo).start(acc, trip, GenerationMode.FULLY_AI)

        // 소유하지 않은 계정
        shouldThrow<ResourceNotFound> { svc(repo).get(UUID.randomUUID(), trip, s.sessionId) }
    }

    // 경로의 여행과 세션의 여행이 어긋나면 소유 검증을 통과한 뒤에도 막아야 한다 —
    // 내 여행 id 로 남의 세션을 조회하는 경로가 열린다.
    "다른 여행 경로로 조회한 세션은 404" {
        val repo = FakeGenerationSessions()
        val service = svc(repo)
        val s = service.start(acc, trip, GenerationMode.FULLY_AI)

        shouldThrow<ResourceNotFound> { service.get(acc, other, s.sessionId) }
    }

    "없는 세션은 404" {
        shouldThrow<ResourceNotFound> { svc().get(acc, trip, UUID.randomUUID()) }
    }
})

/**
 * 동시 생성 1건 제한(TRIP-403).
 *
 * 생성은 LLM·솔버를 쓰는 무거운 작업이라 동시 실행을 열어두면 비용·지연이 사용자 수가 아니라
 * **연타 횟수**에 비례한다. 다만 막는 방식이 사용자를 가두면 안 된다 — 아래 네 갈래가 그 경계다.
 */
class GenerationSessionConcurrencyTest : StringSpec({

    val at = Instant.parse("2026-08-06T00:00:00Z")
    val clock: Clock = Clock.fixed(at, ZoneOffset.UTC)
    val acc = UUID.randomUUID()
    val other = UUID.randomUUID()
    val tripA = UUID.randomUUID()
    val tripB = UUID.randomUUID()

    fun svc(repo: FakeGenerationSessions, now: Instant = at) =
        GenerationSessionService(stubTrips, repo, Clock.fixed(now, ZoneOffset.UTC))

    "진행 중이 없으면 지금과 똑같이 시작한다" {
        val repo = FakeGenerationSessions()

        val s = svc(repo).start(acc, tripA, GenerationMode.FULLY_AI)

        s.tripId shouldBe tripA
        s.accountId shouldBe acc
    }

    /** 이 티켓의 핵심 금지 규칙 — 그리고 **어느 여행인지** 알려줘야 화면이 안내할 수 있다. */
    "다른 여행이 생성 중이면 거절하고 그 여행을 알려준다" {
        val repo = FakeGenerationSessions()
        svc(repo).start(acc, tripA, GenerationMode.FULLY_AI)

        val e = shouldThrow<ConflictDetected> { svc(repo).start(acc, tripB, GenerationMode.FULLY_AI) }

        e.current shouldBe tripA
        // 전용 코드여야 화면이 닉네임 중복 같은 다른 409 와 구분한다.
        e.errorCode shouldBe ErrorCode.GENERATION_IN_PROGRESS
    }

    /**
     * **탈출구는 항상 열려 있다.** 같은 여행의 재생성은 멈춘 생성(PARTIAL)에서 벗어나는 유일한 길이라
     * 막으면 사용자가 그 여행에 갇힌다(openapi 주석의 명시 사항).
     */
    "같은 여행의 재생성은 막지 않는다" {
        val repo = FakeGenerationSessions()
        val first = svc(repo).start(acc, tripA, GenerationMode.FULLY_AI)

        val again = svc(repo).start(acc, tripA, GenerationMode.FULLY_AI)

        again.sessionId shouldNotBe first.sessionId
        repo.rows[first.sessionId]!!.isRunning shouldBe false // 이전 세션은 닫힌다
    }

    /**
     * **멈춘 세션이 사용자를 가두면 안 된다.** 백그라운드가 죽으면 RUNNING 인 채 영원히 남는데,
     * 그것이 제한을 붙잡으면 다른 여행을 영영 못 만든다.
     */
    "오래 멈춘 세션은 제한하지 않고 닫아 준다" {
        val repo = FakeGenerationSessions()
        val stuck = svc(repo).start(acc, tripA, GenerationMode.FULLY_AI)

        val later = at.plus(Duration.ofMinutes(30))
        val s = svc(repo, later).start(acc, tripB, GenerationMode.FULLY_AI)

        s.tripId shouldBe tripB
        repo.rows[stuck.sessionId]!!.isRunning shouldBe false // 조용히 두지 않고 닫는다(INV-4)
    }

    /**
     * **경계를 못으로 박는다.** 위 테스트는 30분을 써서 기준값을 5분에서 10분으로 바꿔도 통과한다 —
     * 그러면 그 값은 아무도 지키지 않는 값이 된다. 여기서 양쪽을 함께 고정한다.
     *
     * 기준은 [GENERATION_STALE_AFTER] 하나이고, 중단된 PARTIAL 스위퍼도 같은 값을 본다.
     * 갈리면 같은 사고에 day1 전후로 대기 시간이 달라진다.
     */
    "기준 직전은 아직 살아 있는 것으로 보고 막는다" {
        val repo = FakeGenerationSessions()
        svc(repo).start(acc, tripA, GenerationMode.FULLY_AI)

        val justBefore = at.plus(GENERATION_STALE_AFTER).minusSeconds(1)

        shouldThrow<ConflictDetected> { svc(repo, justBefore).start(acc, tripB, GenerationMode.FULLY_AI) }
    }

    "기준을 넘기면 멈춘 것으로 보고 풀어 준다" {
        val repo = FakeGenerationSessions()
        svc(repo).start(acc, tripA, GenerationMode.FULLY_AI)

        val justAfter = at.plus(GENERATION_STALE_AFTER).plusSeconds(1)

        svc(repo, justAfter).start(acc, tripB, GenerationMode.FULLY_AI).tripId shouldBe tripB
    }

    "다른 계정의 생성은 내 제한과 무관하다" {
        val repo = FakeGenerationSessions()
        svc(repo).start(other, tripA, GenerationMode.FULLY_AI)

        svc(repo).start(acc, tripB, GenerationMode.FULLY_AI).tripId shouldBe tripB
    }
})
