package com.trippilot.archive.application

import com.trippilot.archive.api.event.VisitChecked
import com.trippilot.archive.domain.CheckSource
import com.trippilot.archive.domain.VisitCheck
import com.trippilot.archive.domain.VisitCheckRepository
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ValidationFailed
import com.trippilot.core.event.DomainEvent
import com.trippilot.core.event.DomainEventPublisher
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

/** 발행된 이벤트를 그대로 모은다 — 무엇이 언제 나갔는지가 이 티켓의 검증 대상이다. */
internal class CapturingEvents : DomainEventPublisher {
    val published = mutableListOf<DomainEvent>()
    override fun publish(event: DomainEvent) { published += event }
}

/**
 * `archive.VisitChecked` 발행(BR-U5-09 · G-U5-13 · U10 FD §12.6).
 *
 * 검증 축: **도착과 완료에서** 나간다(건너뜀은 아니다 — U10 이전엔 완료에서만) · 페이로드가 경계 키·계정·출처를 싣는다 ·
 * 즉석 방문은 `slotKey = null` · 중복 체크가 409 로 막혀 이벤트도 하나뿐이다.
 */
class VisitCheckedEventTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val poi = UUID.randomUUID()
    val day = LocalDate.parse("2026-08-11")
    val slot = "$day#$poi"

    fun clockAt(i: String): Clock = Clock.fixed(Instant.parse(i), ZoneOffset.UTC)

    class Visits : VisitCheckRepository {
        val stored = mutableListOf<VisitCheck>()
        override fun save(check: VisitCheck) = check.also {
            stored.removeAll { s -> s.visitCheckId == check.visitCheckId }
            stored += it
        }
        override fun findById(visitCheckId: UUID) = stored.firstOrNull { it.visitCheckId == visitCheckId }
        override fun findByTrip(tripId: UUID) = stored.filter { it.tripId == tripId }
        override fun findBySlot(tripId: UUID, slotKey: String) =
            stored.firstOrNull { it.tripId == tripId && it.slotKey == slotKey }
    }

    val trips = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) =
            if (accountId == acc) TripPeriod(LocalDate.parse("2026-08-10"), LocalDate.parse("2026-08-12")) else null
        override fun findGenerationContext(accountId: UUID, tripId: UUID) = null
    }

    fun fixture(now: String = "2026-08-11T03:00:00Z"): Triple<VisitCheckService, Visits, CapturingEvents> {
        val visits = Visits()
        val events = CapturingEvents()
        return Triple(VisitCheckService(trips, visits, events, clockAt(now)), visits, events)
    }

    /** 체류 초과(DELAY)는 도착부터 재야 한다 — 완료만 알리면 "아직 안 떠난 사람"을 볼 수 없다(G-U10-2). */
    "도착하면 완료 시각이 빈 VisitChecked 가, 완료하면 출처까지 실은 것이 하나 더 나간다" {
        val (svc, _, events) = fixture()
        val v = svc.arrive(acc, tripId, slot, poi, CheckSource.AUTO_GEOFENCE)

        (events.published.single() as VisitChecked).let {
            it.completedAt shouldBe null
            it.completionSource shouldBe null
            it.arrivalSource shouldBe "AUTO_GEOFENCE"
            // 구독자에게는 사용자 요청 맥락이 없다 — 판정 대상 계정을 이벤트가 싣는다(G-U10-3)
            it.accountId shouldBe acc.toString()
        }

        svc.complete(acc, tripId, v.visitCheckId)

        events.published.size shouldBe 2
        val e = events.published.last() as VisitChecked
        e.completionSource shouldBe "MANUAL" // 완료 버튼은 사람이 누른 것이다 — 도착이 자동이어도
        e.arrivalSource shouldBe "AUTO_GEOFENCE"
        e.accountId shouldBe acc.toString()
        e.eventType shouldBe "archive.VisitChecked" // 이름 규약 {module}.{EventName}
        e.aggregateType shouldBe "VisitCheck"
        e.aggregateId shouldBe v.visitCheckId.toString()
        e.tripId shouldBe tripId.toString()
        // 물리 키가 아니라 경계 키다 — 재계획으로 슬롯 행이 갈려도 참조가 끊기지 않아야 한다.
        e.slotKey shouldBe slot
        e.poiId shouldBe poi.toString()
        e.arrivedAt shouldBe "2026-08-11T03:00:00Z"
        e.completedAt shouldBe "2026-08-11T03:00:00Z"
    }

    "건너뛰면 발행하지 않는다 — 안 간 곳은 알릴 사건이 없다" {
        val (svc, _, events) = fixture()
        val v = svc.arrive(acc, tripId, slot, poi, CheckSource.MANUAL)
        events.published.clear() // 도착분은 위 테스트가 본다

        svc.skip(acc, tripId, v.visitCheckId)
        svc.skipPlanned(acc, tripId, "$day#${UUID.randomUUID()}", UUID.randomUUID())

        events.published shouldBe emptyList()
    }

    /** 자동 도착은 지오펜스가 걸린 계획 슬롯에서만 생긴다(INV-U10-5). 슬롯 없는 자동 도착을 받으면 즉석 방문이 사용자 손 없이 생긴다. */
    "슬롯 키 없는 자동 도착은 400 이고 아무것도 남기지 않는다" {
        val (svc, visits, events) = fixture()

        shouldThrow<ValidationFailed> { svc.arrive(acc, tripId, null, poi, CheckSource.AUTO_GEOFENCE) }

        visits.stored shouldBe emptyList()
        events.published shouldBe emptyList()
        svc.arrive(acc, tripId, null, poi, CheckSource.MANUAL).isSpontaneous shouldBe true // 수동 즉석 방문은 그대로다
    }

    "즉석 방문은 slotKey 가 null 로 나간다(INV-U5-02)" {
        val (svc, _, events) = fixture()
        val spontaneous = svc.arrive(acc, tripId, null, poi, CheckSource.MANUAL)

        svc.complete(acc, tripId, spontaneous.visitCheckId)

        events.published.map { (it as VisitChecked).slotKey } shouldBe listOf(null, null)
    }

    // 멱등의 근거는 이벤트 쪽 중복 제거가 아니라 **애초에 두 번째 체크가 막힌다**는 것이다.
    "같은 슬롯을 두 번 체크하면 409 라 이벤트도 하나뿐이다" {
        val (svc, _, events) = fixture()
        val v = svc.arrive(acc, tripId, slot, poi, CheckSource.AUTO_GEOFENCE)
        svc.complete(acc, tripId, v.visitCheckId)

        shouldThrow<ConflictDetected> { svc.arrive(acc, tripId, slot, poi, CheckSource.AUTO_GEOFENCE) }

        events.published.size shouldBe 2 // 도착 하나 · 완료 하나
    }

    "이미 완료된 것을 또 완료하면 409 — 두 번째 이벤트는 없다" {
        val (svc, _, events) = fixture()
        val v = svc.arrive(acc, tripId, slot, poi, CheckSource.MANUAL)
        svc.complete(acc, tripId, v.visitCheckId)

        shouldThrow<ConflictDetected> { svc.complete(acc, tripId, v.visitCheckId) }

        events.published.size shouldBe 2
    }
})
