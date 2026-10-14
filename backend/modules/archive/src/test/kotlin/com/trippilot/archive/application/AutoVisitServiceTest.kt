package com.trippilot.archive.application

import com.trippilot.archive.api.event.VisitAutoReverted
import com.trippilot.archive.api.event.VisitChecked
import com.trippilot.archive.domain.CheckSource
import com.trippilot.archive.domain.CompletionSource
import com.trippilot.archive.domain.VisitCheck
import com.trippilot.archive.domain.VisitCheckRepository
import com.trippilot.archive.domain.VisitMemo
import com.trippilot.archive.domain.VisitMemoRepository
import com.trippilot.archive.domain.VisitPhotoMeta
import com.trippilot.archive.domain.VisitPhotoMetaRepository
import com.trippilot.auth.api.LocationConsentFacade
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.itinerarygeneration.api.PlannedSlotView
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.element
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.checkAll
import io.mockk.every
import io.mockk.mockk
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.TransactionStatus
import org.springframework.transaction.support.SimpleTransactionStatus
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

/**
 * 자동 방문 결과 배치·되돌리기(U10 FD §5.2·§12.1·§12.2 · BR-U10-20·21·31·32 · INV-U10-5·6·10 · PBT-U10-3).
 *
 * 지키려는 것: **서버 우선**(이미 있는 기록은 자동 결과가 바꾸지 않는다 — 수동 도착 + 미완료의 자동 완료만 예외) · **멱등**(같은 배치를
 * 몇 번·어떤 순서로 보내도 최종 상태가 같다) · 항목마다 결과(배치를 깨지 않는다) · 되돌린 자리는 그날 자동 쓰기를 막는다.
 */
class AutoVisitServiceTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val day = LocalDate.parse("2026-08-11")
    val now = Instant.parse("2026-08-11T12:00:00Z")
    val pois = List(3) { UUID.randomUUID() }
    val slots = pois.map { "$day#$it" }
    val t = { h: Int -> Instant.parse("2026-08-11T0$h:00:00Z") } // 그날 KST 오전

    class Visits : VisitCheckRepository {
        val stored = linkedMapOf<UUID, VisitCheck>()
        override fun save(check: VisitCheck) = check.also { stored[it.visitCheckId] = it }
        override fun findById(visitCheckId: UUID) = stored[visitCheckId]
        override fun findByTrip(tripId: UUID) = stored.values.filter { it.tripId == tripId && it.isRecorded }
        override fun findBySlot(tripId: UUID, slotKey: String) = stored.values.firstOrNull { it.tripId == tripId && it.slotKey == slotKey }
    }

    val noTx = object : PlatformTransactionManager {
        override fun getTransaction(definition: TransactionDefinition?): TransactionStatus = SimpleTransactionStatus()
        override fun commit(status: TransactionStatus) = Unit
        override fun rollback(status: TransactionStatus) = Unit
    }

    class World(
        val visits: Visits = Visits(),
        val events: CapturingEvents = CapturingEvents(),
        var legal: Boolean = true,
        var enabled: Boolean = true,
        val photos: MutableMap<UUID, Int> = mutableMapOf(),
        val memos: MutableSet<UUID> = mutableSetOf(),
    )

    fun World.service(clock: Clock = Clock.fixed(now, ZoneOffset.UTC)) = AutoVisitService(
        object : TripFacade {
            override fun findPeriod(accountId: UUID, tripId: UUID) = if (accountId == acc) TripPeriod(day.minusDays(1), day.plusDays(1)) else null
            override fun findGenerationContext(accountId: UUID, tripId: UUID) = null
        },
        mockk<ItineraryPlanFacade>().also { plans ->
            every { plans.findPlanSlots(any(), any()) } returns pois.mapIndexed { i, poi ->
                mockk<PlannedSlotView>().also { every { it.slotKey } returns slots[i]; every { it.poiId } returns poi }
            }
        },
        visits,
        mockk<VisitPhotoMetaRepository>().also { r -> every { r.findByVisit(any()) } answers { List(photos[firstArg()] ?: 0) { mockk<VisitPhotoMeta>() } } },
        mockk<VisitMemoRepository>().also { r -> every { r.find(any()) } answers { if (firstArg<UUID>() in memos) mockk<VisitMemo>() else null } },
        object : LocationConsentFacade {
            override fun hasGpsRecordingOptIn(accountId: UUID) = true
            override fun hasLocationLegalConsent(accountId: UUID) = legal
        },
        events, LocationAutomationProperties(enabled = enabled), clock, noTx,
    )

    fun arrive(i: Int, at: Instant = t(1)) = AutoVisitEvent(UUID.randomUUID(), AutoVisitKind.ARRIVE, slots[i], pois[i], at)
    fun complete(i: Int, at: Instant = t(2), by: CompletionSource? = CompletionSource.AUTO_GEOFENCE_EXIT) =
        AutoVisitEvent(UUID.randomUUID(), AutoVisitKind.COMPLETE, slots[i], pois[i], at, by)

    fun outcomes(w: World, vararg events: AutoVisitEvent) = w.service().apply(acc, tripId, events.toList()).results.map { it.outcome }

    "자동 도착·완료는 기기가 판정한 시각으로 남고 출처가 자동이다 — 도착·완료마다 사건 하나" {
        val w = World()
        outcomes(w, arrive(0), complete(0)) shouldBe listOf(AutoVisitOutcome.APPLIED, AutoVisitOutcome.APPLIED)

        w.visits.stored.values.single().let {
            (it.arrivedAt to it.completedAt) shouldBe (t(1) to t(2)) // G-U10-1 — 서버 시각(12:00)이 아니다
            (it.source to it.completionSource) shouldBe (CheckSource.AUTO_GEOFENCE to CompletionSource.AUTO_GEOFENCE_EXIT)
        }
        w.events.published.map { (it as VisitChecked).completionSource } shouldBe listOf(null, "AUTO_GEOFENCE_EXIT")
    }

    /** §5.2 — 서버 우선. 유일한 예외는 수동 도착 + 미완료에 자동 완료(진행 중 슬롯 리전이 이탈을 잡은 것). */
    "이미 있는 기록은 바꾸지 않는다 — 수동 도착에 자동 완료를 더하는 것만 예외다" {
        val w = World()
        val manual = w.visits.save(VisitCheck.arrive(tripId, slots[0], pois[0], CheckSource.MANUAL, t(1)))
        outcomes(w, arrive(0, t(3))) shouldBe listOf(AutoVisitOutcome.ALREADY_RECORDED)
        w.visits.stored[manual.visitCheckId]!!.arrivedAt shouldBe t(1)

        outcomes(w, complete(0, t(4))) shouldBe listOf(AutoVisitOutcome.APPLIED)
        w.visits.stored[manual.visitCheckId]!!.let { (it.source to it.completionSource) shouldBe (CheckSource.MANUAL to CompletionSource.AUTO_GEOFENCE_EXIT) }

        // 이미 완료(어느 출처든) · 건너뜀은 손대지 않는다
        outcomes(w, complete(0, t(5))) shouldBe listOf(AutoVisitOutcome.ALREADY_RECORDED)
        w.visits.save(VisitCheck.arrive(tripId, slots[1], pois[1], CheckSource.MANUAL, t(1)).skip(t(1)))
        outcomes(w, arrive(1), complete(1)) shouldBe listOf(AutoVisitOutcome.CONFLICT, AutoVisitOutcome.CONFLICT)
    }

    "잘못된 항목은 그 항목만 거절하고 나머지는 반영한다(BR-U10-20·21)" {
        val w = World()
        val results = outcomes(
            w,
            complete(0), // 도착보다 먼저 온 완료
            AutoVisitEvent(UUID.randomUUID(), AutoVisitKind.ARRIVE, slots[0], UUID.randomUUID(), t(1)), // 일정과 다른 장소
            arrive(0, Instant.parse("2026-08-10T12:00:00Z")), // 슬롯 날짜(8/11)와 다른 날(8/10 21시 KST) — 여행 기간 안, 과거
            arrive(0, now.plusSeconds(301)), // 서버 시각 + 5분 너머
            arrive(1),
            complete(1, t(0)), // 도착(01시)보다 앞선 완료
            complete(1, by = null), // 자동 완료인데 자동 출처가 없다
            complete(1, by = CompletionSource.MANUAL),
            complete(1),
        )
        results shouldBe listOf(
            AutoVisitOutcome.CONFLICT, AutoVisitOutcome.CONFLICT, AutoVisitOutcome.OUT_OF_WINDOW, AutoVisitOutcome.OUT_OF_WINDOW,
            AutoVisitOutcome.APPLIED, AutoVisitOutcome.OUT_OF_WINDOW, AutoVisitOutcome.CONFLICT, AutoVisitOutcome.CONFLICT, AutoVisitOutcome.APPLIED,
        )
        w.visits.stored.size shouldBe 1
    }

    "위치 이용 동의가 없으면 전 항목을 거절하고, 킬 스위치가 꺼져도 온 항목은 처리하며 꺼졌다고 알린다" {
        val noConsent = World(legal = false)
        outcomes(noConsent, arrive(0), arrive(1)) shouldBe List(2) { AutoVisitOutcome.REJECTED_CONSENT }
        noConsent.visits.stored.size shouldBe 0

        val off = World(enabled = false)
        off.service().apply(acc, tripId, listOf(arrive(0))).let { (it.automationEnabled to it.results.single().outcome) shouldBe (false to AutoVisitOutcome.APPLIED) }
        World().service().apply(acc, tripId, emptyList()).automationEnabled shouldBe true // 빈 배치 = 킬 스위치 탐침
    }

    "남의 여행은 404, 50건을 넘으면 400" {
        shouldThrow<ResourceNotFound> { World().service().apply(UUID.randomUUID(), tripId, listOf(arrive(0))) }
        shouldThrow<ValidationFailed> { World().service().apply(acc, tripId, List(AutoVisitService.MAX_BATCH + 1) { arrive(0) }) }
    }

    /** PBT-U10-3 — 같은 배치를 임의 횟수·임의 순서로 재전송해도 최종 상태가 같고, 먼저 있던 수동 기록은 어떤 배치로도 바뀌지 않는다. */
    "같은 배치를 몇 번·어떤 순서로 보내도 최종 상태가 같고, 수동 기록은 바뀌지 않는다" {
        val pool = listOf(arrive(0), complete(0), arrive(1), complete(1, by = CompletionSource.AUTO_NEXT_ARRIVAL), arrive(2), complete(2))
        checkAll(Arb.list(Arb.element(pool), 1..6), Arb.int(1..4), Arb.element(true, false)) { batch, times, manualFirst ->
            fun run(order: (List<AutoVisitEvent>) -> List<AutoVisitEvent>): Map<String?, Triple<Instant?, Instant?, Any?>> {
                val w = World()
                if (manualFirst) w.visits.save(VisitCheck.arrive(tripId, slots[2], pois[2], CheckSource.MANUAL, t(3)).complete(t(4)))
                w.service().apply(acc, tripId, batch)
                repeat(times) { w.service().apply(acc, tripId, order(batch)) }
                if (manualFirst) w.visits.findBySlot(tripId, slots[2])!!.let {
                    (it.source to it.completionSource to it.arrivedAt) shouldBe (CheckSource.MANUAL to CompletionSource.MANUAL to t(3))
                }
                return w.visits.stored.values.associate { it.slotKey to Triple(it.arrivedAt, it.completedAt, it.completionSource) }
            }
            // 재전송이 한 번이라도 있으면, 배치 안 순서 때문에 처음엔 거절된 완료(도착보다 먼저 옴)까지 들어가 같은 곳에 수렴한다
            val inOrder = run { it }
            run { it.shuffled() } shouldBe inOrder
            run { it.reversed() } shouldBe inOrder
        }
    }

    "자동 완료를 되돌리면 완료만 비우고, 완료 없는 자동 도착을 되돌리면 그날 그 슬롯의 자동 쓰기를 막는다" {
        val w = World()
        outcomes(w, arrive(0), complete(0))
        val id = w.visits.stored.keys.single()

        w.service().revert(acc, tripId, id).let { (it.arrivedAt to it.completedAt to it.completionSource) shouldBe (t(1) to null to null) }
        w.service().revert(acc, tripId, id).let { (it.arrivedAt to it.autoSuppressedAt) shouldBe (null to now) }
        w.events.published.filterIsInstance<VisitAutoReverted>().map { it.part } shouldBe listOf("COMPLETION", "ARRIVAL")

        outcomes(w, arrive(0, t(5)), complete(0, t(6))) shouldBe List(2) { AutoVisitOutcome.SUPPRESSED } // INV-U10-10
        w.visits.findByTrip(tripId) shouldBe emptyList() // 억제 표식뿐인 행은 방문이 아니다(G-U10-12)
    }

    "수동 기록은 되돌리지 않고, 사진·메모가 붙은 자동 도착도 되돌리지 않는다 — 기록을 조용히 잃지 않는다" {
        val w = World()
        val manual = w.visits.save(VisitCheck.arrive(tripId, slots[0], pois[0], CheckSource.MANUAL, t(1)).complete(t(2)))
        shouldThrow<ConflictDetected> { w.service().revert(acc, tripId, manual.visitCheckId) }.errorCode shouldBe ErrorCode.VISIT_NOT_AUTO

        outcomes(w, arrive(1))
        val auto = w.visits.findBySlot(tripId, slots[1])!!.visitCheckId
        w.photos[auto] = 1
        shouldThrow<ConflictDetected> { w.service().revert(acc, tripId, auto) }.errorCode shouldBe ErrorCode.VISIT_HAS_MEDIA
        w.photos.clear(); w.memos += auto
        shouldThrow<ConflictDetected> { w.service().revert(acc, tripId, auto) }.errorCode shouldBe ErrorCode.VISIT_HAS_MEDIA
        w.visits.stored[auto]!!.arrivedAt shouldBe t(1)
        shouldThrow<ResourceNotFound> { w.service().revert(UUID.randomUUID(), tripId, auto) }
    }

    /** BR-U10-32 — 되돌린 자리에 사람이 도착·건너뛰기를 남기면 같은 행을 쓴다. 자동은 그날 계속 막힌다. */
    "되돌린 자리는 수동 도착·건너뛰기가 같은 행으로 재사용하고 자동은 계속 막힌다" {
        val w = World()
        outcomes(w, arrive(0), arrive(1))
        val (first, second) = slots.take(2).map { w.visits.findBySlot(tripId, it)!!.visitCheckId }
        w.service().revert(acc, tripId, first)
        w.service().revert(acc, tripId, second)
        val visits = VisitCheckService(
            object : TripFacade {
                override fun findPeriod(accountId: UUID, tripId: UUID) = TripPeriod(day.minusDays(1), day.plusDays(1))
                override fun findGenerationContext(accountId: UUID, tripId: UUID) = null
            },
            w.visits, w.events, Clock.fixed(now, ZoneOffset.UTC), FakeIntervals(),
        )

        visits.arrive(acc, tripId, slots[0], pois[0], CheckSource.MANUAL).visitCheckId shouldBe first
        visits.skipPlanned(acc, tripId, slots[1], pois[1]).visitCheckId shouldBe second
        shouldThrow<ConflictDetected> { visits.arrive(acc, tripId, slots[0], pois[0], CheckSource.AUTO_GEOFENCE) }
        outcomes(w, complete(0, t(7))) shouldBe listOf(AutoVisitOutcome.SUPPRESSED)
        w.visits.stored.size shouldBe 2
        w.visits.stored[first]!!.let { (it.source to it.autoSuppressedAt) shouldBe (CheckSource.MANUAL to now) }
    }
})
