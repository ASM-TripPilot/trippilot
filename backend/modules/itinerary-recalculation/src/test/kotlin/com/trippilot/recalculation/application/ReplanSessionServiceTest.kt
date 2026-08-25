package com.trippilot.recalculation.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.itinerarygeneration.api.ItineraryRef
import com.trippilot.placedata.api.FrozenPoiView
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.placedata.api.PoiSurfaceView
import com.trippilot.recalculation.domain.OriginKind
import com.trippilot.recalculation.domain.ReplanOrigin
import com.trippilot.recalculation.domain.ReplanScope
import com.trippilot.recalculation.domain.ReplanSession
import com.trippilot.recalculation.domain.ReplanSessionRepository
import com.trippilot.recalculation.domain.ReplanStatus
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

/**
 * 재계획 진입(C10 · LC-U4-4). 정본 불변식이 검증 축이다.
 * - **INV-U4-05** 확정 전 원 일정 무변경 — 취소는 세션만 닫는다
 * - **INV-U4-06** 열린 세션 1개 — 새 진입은 **기존을 닫고 시작**한다(거부가 아니다)
 */
class ReplanSessionServiceTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val itineraryId = UUID.randomUUID()
    val tripStart = LocalDate.parse("2026-08-10")
    val tripEnd = LocalDate.parse("2026-08-12")

    fun clockAt(instant: String): Clock = Clock.fixed(Instant.parse(instant), ZoneOffset.UTC)

    class Sessions : ReplanSessionRepository {
        val stored = mutableListOf<ReplanSession>()
        override fun save(session: ReplanSession) = session.also {
            stored.removeAll { s -> s.sessionId == session.sessionId }
            stored += it
        }
        override fun findById(sessionId: UUID) = stored.firstOrNull { it.sessionId == sessionId }
        // 단일 스레드 테스트라 잠금은 의미가 없다 — 경합 자체는 실 DB IT 가 검증한다.
        override fun findByIdForUpdate(sessionId: UUID) = findById(sessionId)
        override fun findOpenByTrip(tripId: UUID) = stored.firstOrNull { it.tripId == tripId && it.isOpen }
    }

    val trips = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) =
            if (accountId == acc) TripPeriod(tripStart, tripEnd) else null
        override fun findGenerationContext(accountId: UUID, tripId: UUID) = null
    }

    /** 일정이 있는 여행(기본) / 없는 여행을 나눠 본다. */
    fun itineraries(present: Boolean = true) = object : ItineraryFacade {
        override fun findCurrent(accountId: UUID, tripId: UUID) =
            if (present && accountId == acc) {
                ItineraryRef(itineraryId, "PLANNED", "COMPLETE", listOf(tripStart), listOf("$tripStart#${UUID.randomUUID()}"))
            } else {
                null
            }
    }

    /** 사다리는 여기서 검증하지 않는다(OriginResolverTest) — 숙소 없는 여행을 기본으로 둔다. */
    val origins = OriginResolver(
        object : com.trippilot.savedaccommodation.api.BaseAnchorFacade {
            override fun findStayNightAnchors(tripId: UUID, startDate: LocalDate, endDate: LocalDate) = emptyList<com.trippilot.savedaccommodation.api.DayAnchorView>()
        },
    )

    /** POI 표면은 사다리 3단 전용이라 여기서는 비운다(그 단은 OriginResolverTest 가 본다). */
    val emptySurfaces = object : PoiSurfaceFacade {
        override fun findSurfaces(poiIds: Collection<UUID>) = emptyMap<UUID, PoiSurfaceView>()
        override fun findFrozenSurfaces(poiSnapshotIds: Collection<UUID>) = emptyMap<UUID, FrozenPoiView>()
    }

    fun service(sessions: Sessions, clock: Clock, hasItinerary: Boolean = true) =
        ReplanSessionService(
            trips, itineraries(hasItinerary), sessions, origins,
            FakeArchive(), emptySurfaces,
            ReplanSolver(sessions, FakeArchive(), FakeReplans(), NOOP_TX, clock),
            FakeReplans(), CapturingReplanEvents(), clock,
        )

    val gpsOrigin = ReplanOrigin(OriginKind.GPS, 33.45, 126.56)
    fun request(reasons: List<String> = listOf("비가 와요")) = StartReplan(
        scope = ReplanScope.PARTIAL_SLOTS,
        origin = gpsOrigin,
        reasons = reasons,
        directives = listOf("실내로 바꿔줘"),
        freeText = null,
        excludedPoiIds = emptyList(),
        triggerId = null,
    )

    "여행 기간 안이면 세션이 열리고 곧바로 산출로 넘어간다 — 입력이 그대로 실린다" {
        val sessions = Sessions()
        val s = service(sessions, clockAt("2026-08-11T00:00:00Z")).start(acc, tripId, request())

        // 시트 제출과 동시에 산출이 시작된다 — COLLECTING 에 멈추면 화면이 영원히 로딩이다.
        s.status shouldBe ReplanStatus.SOLVING
        s.itineraryId shouldBe itineraryId
        s.scope shouldBe ReplanScope.PARTIAL_SLOTS
        s.reasons shouldContainExactly listOf("비가 와요")
        s.directives shouldContainExactly listOf("실내로 바꿔줘")
        s.closedAt shouldBe null
        s.draft shouldBe null // 확정은커녕 산출도 아직이다(INV-U4-05)
    }

    "새 진입은 기존 열린 세션을 닫고 시작한다 — 막지 않는다(INV-U4-06)" {
        // 사용자가 앱을 닫았다 다시 들어오는 것이 정상 흐름이라, 거부하면 영영 못 들어간다.
        val sessions = Sessions()
        val svc = service(sessions, clockAt("2026-08-11T00:00:00Z"))
        val first = svc.start(acc, tripId, request(listOf("첫 시도")))
        val second = svc.start(acc, tripId, request(listOf("두 번째 시도")))

        sessions.findById(first.sessionId)!!.status shouldBe ReplanStatus.CANCELED
        sessions.findById(first.sessionId)!!.closedAt shouldBe Instant.parse("2026-08-11T00:00:00Z")
        second.status shouldBe ReplanStatus.SOLVING
        sessions.stored.count { it.isOpen } shouldBe 1 // 언제나 하나
        sessions.stored.size shouldBe 2                // 이전 시도는 이력으로 남는다
    }

    "여행 기간 밖이면 409" {
        shouldThrow<ConflictDetected> {
            service(Sessions(), clockAt("2026-08-09T00:00:00Z")).start(acc, tripId, request())
        }
        shouldThrow<ConflictDetected> {
            service(Sessions(), clockAt("2026-08-13T00:00:00Z")).start(acc, tripId, request())
        }
    }

    "구간 판정은 KST 기준 — UTC 로 보면 하루가 어긋난다" {
        // 08-09T16:00Z = KST 08-10 01:00 → 여행 첫날
        service(Sessions(), clockAt("2026-08-09T16:00:00Z")).start(acc, tripId, request())
            .status shouldBe ReplanStatus.SOLVING
    }

    "다시 짤 일정이 없으면 404 — 그건 재계획이 아니라 생성이다" {
        shouldThrow<ResourceNotFound> {
            service(Sessions(), clockAt("2026-08-11T00:00:00Z"), hasItinerary = false).start(acc, tripId, request())
        }
    }

    "미소유 여행이면 404" {
        shouldThrow<ResourceNotFound> {
            service(Sessions(), clockAt("2026-08-11T00:00:00Z")).start(UUID.randomUUID(), tripId, request())
        }
    }

    "취소는 세션만 닫는다 — 원 일정을 건드리지 않는다(INV-U4-05)" {
        val sessions = Sessions()
        val svc = service(sessions, clockAt("2026-08-11T00:00:00Z"))
        val s = svc.start(acc, tripId, request())

        val canceled = svc.cancel(acc, tripId, s.sessionId)
        canceled.status shouldBe ReplanStatus.CANCELED
        canceled.closedAt shouldBe Instant.parse("2026-08-11T00:00:00Z")
        canceled.itineraryId shouldBe itineraryId // 어느 일정이었는지는 남는다
        shouldThrow<ConflictDetected> { svc.cancel(acc, tripId, s.sessionId) } // 두 번 닫지 않는다
    }

    "다른 여행의 세션은 조회·취소할 수 없다(404)" {
        val sessions = Sessions()
        val otherTrip = UUID.randomUUID()
        val foreign = sessions.save(
            ReplanSession.start(
                otherTrip, itineraryId, null, ReplanScope.FULL_DAY,
                Instant.parse("2026-08-11T00:00:00Z"), gpsOrigin,
                emptyList(), emptyList(), null, emptyList(), Instant.parse("2026-08-11T00:00:00Z"),
            ),
        )
        val svc = service(sessions, clockAt("2026-08-11T00:00:00Z"))

        shouldThrow<ResourceNotFound> { svc.get(acc, tripId, foreign.sessionId) }
        shouldThrow<ResourceNotFound> { svc.cancel(acc, tripId, foreign.sessionId) }
    }
})
