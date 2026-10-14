package com.trippilot.archive.application

import com.trippilot.archive.domain.IntervalEndReason
import com.trippilot.archive.domain.IntervalKind
import com.trippilot.auth.api.LocationCollectionSource
import com.trippilot.auth.api.LocationConsentFacade
import com.trippilot.auth.api.LocationIntervalPhase
import com.trippilot.auth.api.LocationLegalLogFacade
import com.trippilot.auth.api.LocationPurgeScope
import com.trippilot.auth.api.LocationUsePurpose
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.trip.api.OwnedTripPeriod
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripOwnerFacade
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.UUID

/**
 * 자동화 구간(U10 FD §4·§10·§12.4 · BR-U10-45·47·48).
 *
 * 지키려는 것: **법정 로그는 상태가 실제로 바뀐 쪽만 남긴다**(재전송·겹친 닫기가 로그를 부풀리지 않는다) ·
 * 동의 없이 구간을 열지 않는다 · 킬 스위치는 START 만 막는다 · END 가 안 온 구간은 여행 종료 + 1일에 닫힌다.
 */
class LocationAutomationServiceTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val start = LocalDate.parse("2026-08-10")
    val end = LocalDate.parse("2026-08-12")
    val t0 = Instant.parse("2026-08-11T01:00:00Z")

    class MovingClock(var now: Instant) : Clock() {
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId?) = this
        override fun instant() = now
    }

    data class Logged(val kind: String, val intervalId: UUID, val phase: LocationIntervalPhase, val endReason: String?, val count: Int?)

    class Logs : LocationLegalLogFacade {
        val rows = mutableListOf<Logged>()
        override fun recordCollection(accountId: UUID, source: LocationCollectionSource, subjectId: UUID) = Unit
        override fun recordPurge(accountId: UUID, scope: LocationPurgeScope, purgedCount: Int) = Unit
        override fun recordUseInterval(
            accountId: UUID, purpose: LocationUsePurpose, intervalId: UUID, tripId: UUID,
            phase: LocationIntervalPhase, at: Instant, endReason: String?, regionCount: Int?,
        ) { rows += Logged("USE", intervalId, phase, endReason, regionCount) }
        override fun recordCollectionInterval(
            accountId: UUID, source: LocationCollectionSource, intervalId: UUID, tripId: UUID,
            phase: LocationIntervalPhase, at: Instant, endReason: String?, pointCount: Int?,
        ) { rows += Logged("COLLECTION", intervalId, phase, endReason, pointCount) }
    }

    class Consents(var legal: Boolean = true, var gps: Boolean = true) : LocationConsentFacade {
        override fun hasGpsRecordingOptIn(accountId: UUID) = gps
        override fun hasLocationLegalConsent(accountId: UUID) = legal
    }

    class World(
        val clock: MovingClock = MovingClock(t0.plusSeconds(7200)), // 보고는 대개 지난 일이다(오프라인 큐)
        val intervals: FakeIntervals = FakeIntervals(),
        val logs: Logs = Logs(),
        val consents: Consents = Consents(),
        var enabled: Boolean = true,
    )

    fun World.service() = LocationAutomationService(
        object : TripFacade {
            override fun findPeriod(accountId: UUID, tripId: UUID) = if (accountId == acc) TripPeriod(start, end) else null
            override fun findGenerationContext(accountId: UUID, tripId: UUID) = null
        },
        object : TripOwnerFacade {
            override fun findOwnedPeriod(tripId: UUID) = OwnedTripPeriod(acc, start, end)
        },
        intervals, consents, logs, LocationAutomationProperties(enabled = enabled), clock,
    )

    fun startOf(id: UUID, kind: IntervalKind = IntervalKind.GEOFENCE_ARMED, at: Instant = t0) =
        IntervalReport(id, kind, LocationIntervalPhase.START, at)

    fun endOf(id: UUID, kind: IntervalKind = IntervalKind.GEOFENCE_ARMED, at: Instant = t0.plusSeconds(3600), count: Int? = 4) =
        IntervalReport(
            id, kind, LocationIntervalPhase.END, at, IntervalEndReason.CLIENT_STOP,
            pointCount = count.takeIf { kind == IntervalKind.ROUTE_RECORDING }, regionCount = count.takeIf { kind == IntervalKind.GEOFENCE_ARMED },
        )

    "무장 구간을 열고 닫으면 USE 가 시작·끝 한 번씩 남고, 재전송은 아무것도 더하지 않는다" {
        val w = World()
        val svc = w.service()
        val id = UUID.randomUUID()

        svc.report(acc, tripId, startOf(id))
        svc.report(acc, tripId, startOf(id)) // 오프라인 큐의 재전송
        svc.report(acc, tripId, endOf(id))
        svc.report(acc, tripId, endOf(id))

        w.logs.rows shouldBe listOf(
            Logged("USE", id, LocationIntervalPhase.START, null, null),
            Logged("USE", id, LocationIntervalPhase.END, "CLIENT_STOP", 4),
        )
        w.intervals.rows[id]!!.let { (it.endedAt to it.regionCount) shouldBe (t0.plusSeconds(3600) to 4) }
    }

    "경로 기록 구간은 COLLECTION 으로 남고 끝에 표본 수를 싣는다" {
        val w = World()
        val id = UUID.randomUUID()
        w.service().report(acc, tripId, startOf(id, IntervalKind.ROUTE_RECORDING))
        w.service().report(acc, tripId, endOf(id, IntervalKind.ROUTE_RECORDING, count = 812))

        w.logs.rows.map { Triple(it.kind, it.phase, it.count) } shouldBe listOf(
            Triple("COLLECTION", LocationIntervalPhase.START, null),
            Triple("COLLECTION", LocationIntervalPhase.END, 812),
        )
    }

    /** 동의 없이 열면 법정 로그에 동의 없는 이용·수집이 남는다(BR-U10-45 · D4). */
    "무장은 위치 이용 동의, 경로 기록은 GPS 기록 동의까지 있어야 연다" {
        val noLegal = World(consents = Consents(legal = false))
        shouldThrow<ConflictDetected> { noLegal.service().report(acc, tripId, startOf(UUID.randomUUID())) }
        shouldThrow<ConflictDetected> { noLegal.service().report(acc, tripId, startOf(UUID.randomUUID(), IntervalKind.ROUTE_RECORDING)) }

        val noGps = World(consents = Consents(gps = false))
        noGps.service().report(acc, tripId, startOf(UUID.randomUUID())) // 무장은 L2 만으로 연다
        shouldThrow<ConflictDetected> { noGps.service().report(acc, tripId, startOf(UUID.randomUUID(), IntervalKind.ROUTE_RECORDING)) }

        (noLegal.logs.rows + noGps.logs.rows).size shouldBe 1
    }

    "킬 스위치가 꺼지면 START 만 막고, 이미 열린 구간의 END 는 받는다" {
        val w = World()
        val id = UUID.randomUUID()
        w.service().report(acc, tripId, startOf(id))
        w.enabled = false

        shouldThrow<ConflictDetected> { w.service().report(acc, tripId, startOf(UUID.randomUUID())) }
        w.service().report(acc, tripId, endOf(id))
        w.service().report(acc, tripId, startOf(id)) // 이미 반영된 START 의 재전송은 꺼져 있어도 성공한다

        w.intervals.rows[id]!!.isOpen shouldBe false
    }

    "보고가 잘못되면 거절하고 아무것도 남기지 않는다" {
        val w = World()
        val svc = w.service()
        val id = UUID.randomUUID()

        shouldThrow<ConflictDetected> { svc.report(acc, tripId, endOf(id)) } // 시작 없는 끝
        shouldThrow<ResourceNotFound> { svc.report(UUID.randomUUID(), tripId, startOf(id)) } // 남의 여행
        shouldThrow<ValidationFailed> { svc.report(acc, tripId, startOf(id, at = w.clock.now.plusSeconds(301))) } // 서버 시각 + 5분 너머
        svc.report(acc, tripId, startOf(id, at = w.clock.now.plusSeconds(300))) // 경계는 받는다
        shouldThrow<ValidationFailed> { svc.report(acc, tripId, endOf(id).copy(endReason = null)) }
        shouldThrow<ValidationFailed> { svc.report(acc, tripId, endOf(id).copy(endReason = IntervalEndReason.SERVER_TIMEOUT)) }
        shouldThrow<ConflictDetected> { svc.report(acc, tripId, endOf(id, IntervalKind.ROUTE_RECORDING)) } // 종류가 다른 같은 id
        shouldThrow<ConflictDetected> { svc.report(acc, UUID.randomUUID(), startOf(id)) } // 다른 여행의 같은 id

        w.logs.rows.size shouldBe 1 // 경계에서 받은 START 하나
        w.intervals.rows[id]!!.isOpen shouldBe true
    }

    /** 기기 시계가 어긋나 END 가 START 보다 앞서도 구간이 음수가 되지 않는다(DB CHECK 도 같은 규칙). */
    "시작보다 앞선 끝은 시작 시각으로 닫는다" {
        val w = World()
        val id = UUID.randomUUID()
        w.service().report(acc, tripId, startOf(id))
        w.service().report(acc, tripId, endOf(id, at = t0.minusSeconds(60)))

        w.intervals.rows[id]!!.endedAt shouldBe t0
    }

    "동의를 철회하면 열린 구간을 닫는다 — L3 는 경로 기록만, L2 는 전부, 이미 닫힌 것은 건드리지 않는다" {
        val w = World()
        val svc = w.service()
        val armed = UUID.randomUUID()
        val route = UUID.randomUUID()
        val done = UUID.randomUUID()
        svc.report(acc, tripId, startOf(armed))
        svc.report(acc, tripId, startOf(route, IntervalKind.ROUTE_RECORDING))
        svc.report(acc, tripId, startOf(done))
        svc.report(acc, tripId, endOf(done))
        w.logs.rows.clear()

        svc.closeOnConsentRevoked(acc, routeOnly = true) shouldBe 1
        w.intervals.rows[route]!!.endReason shouldBe IntervalEndReason.CONSENT_REVOKED
        w.intervals.rows[armed]!!.isOpen shouldBe true

        svc.closeOnConsentRevoked(acc, routeOnly = false) shouldBe 1
        svc.closeOnConsentRevoked(acc, routeOnly = false) shouldBe 0 // 재배달
        w.logs.rows.map { it.intervalId to it.endReason } shouldBe listOf(route to "CONSENT_REVOKED", armed to "CONSENT_REVOKED")
    }

    /** 앱이 강제 종료되면 END 가 영영 안 온다(G-U10-11). 여행 종료 + 1일 — 그 하루는 기기가 마지막 업로드를 하는 몫이다. */
    "END 가 안 온 구간은 여행 종료 + 1일이 지나야 서버가 닫는다" {
        val w = World()
        val svc = w.service()
        val id = UUID.randomUUID()
        svc.report(acc, tripId, startOf(id))

        w.clock.now = Instant.parse("2026-08-13T14:59:59Z") // 8/13 23:59:59 KST — 종료(8/12) + 1일의 끝
        svc.sweep() shouldBe 0
        w.clock.now = Instant.parse("2026-08-13T15:00:00Z") // 8/14 00:00 KST
        svc.sweep() shouldBe 1
        svc.sweep() shouldBe 0

        w.intervals.rows[id]!!.endReason shouldBe IntervalEndReason.SERVER_TIMEOUT
        w.logs.rows.last().let { (it.phase to it.endReason) shouldBe (LocationIntervalPhase.END to "SERVER_TIMEOUT") }
    }

    "무장 여부는 그 시각을 덮는 무장 구간이 있는가다 — 열린 구간은 시작 이후 전부, 경로 기록은 무장이 아니다" {
        val w = World()
        val svc = w.service()
        val visits = VisitCheckService(
            object : TripFacade {
                override fun findPeriod(accountId: UUID, tripId: UUID) = TripPeriod(start, end)
                override fun findGenerationContext(accountId: UUID, tripId: UUID) = null
            },
            object : com.trippilot.archive.domain.VisitCheckRepository {
                override fun save(check: com.trippilot.archive.domain.VisitCheck) = check
                override fun findById(visitCheckId: UUID) = null
                override fun findByTrip(tripId: UUID) = emptyList<com.trippilot.archive.domain.VisitCheck>()
                override fun findBySlot(tripId: UUID, slotKey: String) = null
            },
            CapturingEvents(), w.clock, w.intervals,
        )
        val closed = UUID.randomUUID()
        svc.report(acc, tripId, startOf(UUID.randomUUID(), IntervalKind.ROUTE_RECORDING, at = t0.minusSeconds(7200)))
        visits.isAutomationArmed(tripId, t0.minusSeconds(3600)) shouldBe false

        svc.report(acc, tripId, startOf(closed))
        svc.report(acc, tripId, endOf(closed, at = t0.plusSeconds(600)))
        visits.isAutomationArmed(tripId, t0.minusSeconds(1)) shouldBe false
        visits.isAutomationArmed(tripId, t0) shouldBe true
        visits.isAutomationArmed(tripId, t0.plusSeconds(600)) shouldBe true
        visits.isAutomationArmed(tripId, t0.plusSeconds(601)) shouldBe false

        svc.report(acc, tripId, startOf(UUID.randomUUID(), at = t0.plusSeconds(1200)))
        visits.isAutomationArmed(tripId, t0.plusSeconds(86_400)) shouldBe true
    }
})
