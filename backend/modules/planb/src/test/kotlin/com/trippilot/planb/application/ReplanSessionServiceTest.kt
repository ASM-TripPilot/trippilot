package com.trippilot.planb.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.planb.domain.ReplanMode
import com.trippilot.planb.domain.ReplanReason
import com.trippilot.planb.domain.ReplanSession
import com.trippilot.planb.domain.ReplanSessionRepository
import com.trippilot.planb.domain.ReplanStatus
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

/**
 * 재계획 진입(US-PLANB-01·12).
 * 검증 축: 여행 구간 안에서만 · 숙소 유무 무관 · 진행 중 세션 하나 · 소유 스코프(404 은닉).
 */
class ReplanSessionServiceTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val tripStart = LocalDate.parse("2026-08-10")
    val tripEnd = LocalDate.parse("2026-08-12")

    /** 여행 둘째 날 09:00 KST = 08-11T00:00Z. 구간 판정이 KST 기준인지 함께 본다. */
    fun clockAt(instant: String): Clock = Clock.fixed(Instant.parse(instant), ZoneOffset.UTC)

    class Sessions : ReplanSessionRepository {
        val stored = mutableListOf<ReplanSession>()
        override fun save(session: ReplanSession) = session.also {
            stored.removeAll { s -> s.replanSessionId == session.replanSessionId }
            stored += it
        }
        override fun findById(replanSessionId: UUID) = stored.firstOrNull { it.replanSessionId == replanSessionId }
        override fun findActiveByTrip(tripId: UUID) =
            stored.firstOrNull { it.tripId == tripId && !it.isTerminal }
    }

    val trips = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) =
            if (accountId == acc) TripPeriod(tripStart, tripEnd) else null
        override fun findGenerationContext(accountId: UUID, tripId: UUID) = null
    }

    fun service(sessions: Sessions, clock: Clock) = ReplanSessionService(trips, sessions, clock)

    "여행 구간 안이면 세션이 열린다 — 숙소 등록 여부와 무관하다" {
        // TripFacade.findPeriod 는 여행 날짜만 본다(숙소 미등록이어도 구간은 존재한다).
        val sessions = Sessions()
        val s = service(sessions, clockAt("2026-08-11T00:00:00Z"))
            .start(acc, tripId, ReplanReason.WEATHER, ReplanMode.AI)

        s.status shouldBe ReplanStatus.LOADING
        s.reason shouldBe ReplanReason.WEATHER
        s.emptyReason shouldBe null // 아직 산출 전 — 사유가 있으면 화면이 빈 결과로 오해한다
        sessions.stored.size shouldBe 1
    }

    "여행 시작 전이면 409 — 재계획이 아니라 생성이다" {
        val svc = service(Sessions(), clockAt("2026-08-09T00:00:00Z"))
        shouldThrow<ConflictDetected> { svc.start(acc, tripId, ReplanReason.NONE, ReplanMode.AI) }
    }

    "여행 종료 후면 409 — 되돌릴 대상이 없다" {
        val svc = service(Sessions(), clockAt("2026-08-13T00:00:00Z"))
        shouldThrow<ConflictDetected> { svc.start(acc, tripId, ReplanReason.NONE, ReplanMode.AI) }
    }

    "구간 판정은 KST 기준이다 — UTC 로 보면 하루가 어긋난다" {
        // 08-09T16:00Z = KST 08-10 01:00 → 여행 첫날. UTC 날짜(08-09)로 보면 시작 전이라 거부된다.
        val svc = service(Sessions(), clockAt("2026-08-09T16:00:00Z"))
        svc.start(acc, tripId, ReplanReason.NONE, ReplanMode.MANUAL).status shouldBe ReplanStatus.LOADING
    }

    "진행 중 세션이 있으면 409 + 그 세션 id 를 돌려준다" {
        val sessions = Sessions()
        val svc = service(sessions, clockAt("2026-08-11T00:00:00Z"))
        val first = svc.start(acc, tripId, ReplanReason.WEATHER, ReplanMode.AI)

        val e = shouldThrow<ConflictDetected> { svc.start(acc, tripId, ReplanReason.FATIGUE, ReplanMode.MANUAL) }
        e.current shouldBe first.replanSessionId // 클라이언트가 이어가거나 취소 후 다시 열 수 있게
        sessions.stored.size shouldBe 1          // 조용히 두 개가 열리지 않는다
    }

    "끝난 세션은 진입을 막지 않는다 — 취소 후 다시 열 수 있다" {
        val sessions = Sessions()
        val svc = service(sessions, clockAt("2026-08-11T00:00:00Z"))
        val first = svc.start(acc, tripId, ReplanReason.WEATHER, ReplanMode.AI)
        svc.cancel(acc, tripId, first.replanSessionId)

        val second = svc.start(acc, tripId, ReplanReason.FATIGUE, ReplanMode.MANUAL)
        second.replanSessionId shouldBe second.replanSessionId
        sessions.stored.size shouldBe 2 // 취소분은 이력으로 남는다
    }

    "미소유 여행이면 404" {
        val svc = service(Sessions(), clockAt("2026-08-11T00:00:00Z"))
        shouldThrow<ResourceNotFound> { svc.start(UUID.randomUUID(), tripId, ReplanReason.NONE, ReplanMode.AI) }
    }

    "다른 여행의 세션은 조회·취소할 수 없다(404)" {
        // 실재하지만 다른 여행 소속 — 세션 id 만으로 남의 여행을 들여다보지 못하게 한다.
        val sessions = Sessions()
        val otherTrip = UUID.randomUUID()
        val foreign = sessions.save(
            ReplanSession.start(otherTrip, ReplanReason.WEATHER, ReplanMode.AI, Instant.parse("2026-08-11T00:00:00Z")),
        )
        val svc = service(sessions, clockAt("2026-08-11T00:00:00Z"))

        shouldThrow<ResourceNotFound> { svc.get(acc, tripId, foreign.replanSessionId) }
        shouldThrow<ResourceNotFound> { svc.cancel(acc, tripId, foreign.replanSessionId) }
    }

    "이미 끝난 세션은 다시 취소할 수 없다(409)" {
        val sessions = Sessions()
        val svc = service(sessions, clockAt("2026-08-11T00:00:00Z"))
        val s = svc.start(acc, tripId, ReplanReason.NONE, ReplanMode.AI)
        svc.cancel(acc, tripId, s.replanSessionId)

        shouldThrow<ConflictDetected> { svc.cancel(acc, tripId, s.replanSessionId) }
    }
})
