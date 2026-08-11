package com.trippilot.recalculation.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.recalculation.domain.CheckSource
import com.trippilot.recalculation.domain.VisitCheck
import com.trippilot.recalculation.domain.VisitCheckRepository
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
 * 방문 실적 서비스(US-ONTRIP-01 · US-REC-01).
 *
 * 검증 축: 중복 체크인 차단(지오펜스가 같은 wake 에서 두 번 깨워도) · 소유 스코프 ·
 * 재계획 잠금 대상은 **완료분만**(INV-U4-04) · 하루 묶기는 여행지 기준 날짜.
 */
class VisitCheckServiceTest : StringSpec({

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

    fun service(visits: Visits, clock: Clock = clockAt("2026-08-11T03:00:00Z")) =
        VisitCheckService(trips, visits, clock)

    "도착 체크가 남는다" {
        val visits = Visits()
        val v = service(visits).arrive(acc, tripId, slot, poi, CheckSource.AUTO_GEOFENCE)
        v.slotKey shouldBe slot
        v.source shouldBe CheckSource.AUTO_GEOFENCE
        visits.stored.size shouldBe 1
    }

    "같은 슬롯을 두 번 체크할 수 없다 — 지오펜스가 한 번 이동에 두 리전을 깨워도 하나만 확정된다" {
        val visits = Visits()
        val svc = service(visits)
        svc.arrive(acc, tripId, slot, poi, CheckSource.AUTO_GEOFENCE)
        shouldThrow<ConflictDetected> { svc.arrive(acc, tripId, slot, poi, CheckSource.AUTO_GEOFENCE) }
        visits.stored.size shouldBe 1
    }

    "즉석 방문은 여러 건 가능하다 — 계획에 없던 곳은 슬롯이 없다" {
        val visits = Visits()
        val svc = service(visits)
        svc.arrive(acc, tripId, null, UUID.randomUUID(), CheckSource.MANUAL)
        svc.arrive(acc, tripId, null, UUID.randomUUID(), CheckSource.MANUAL)
        visits.stored.size shouldBe 2
    }

    "재계획 잠금은 완료분만 — 도착만 했거나 건너뛴 것은 잠그지 않는다(INV-U4-04)" {
        val visits = Visits()
        val svc = service(visits)
        val arrivedOnly = svc.arrive(acc, tripId, slot, poi, CheckSource.MANUAL)
        val otherSlot = "$day#${UUID.randomUUID()}"
        val done = svc.arrive(acc, tripId, otherSlot, UUID.randomUUID(), CheckSource.MANUAL)
        svc.complete(acc, tripId, done.visitCheckId)
        val skippedSlot = "$day#${UUID.randomUUID()}"
        val skipped = svc.arrive(acc, tripId, skippedSlot, UUID.randomUUID(), CheckSource.MANUAL)
        svc.skip(acc, tripId, skipped.visitCheckId)

        svc.lockedSlotKeys(tripId) shouldContainExactly listOf(otherSlot)
        arrivedOnly.isCompleted shouldBe false
    }

    "마지막 완료 방문지는 완료 시각이 가장 늦은 것 — 기준점 사다리 3단 입력" {
        val visits = Visits()
        val svc = service(visits, clockAt("2026-08-11T03:00:00Z"))
        val first = svc.arrive(acc, tripId, "$day#${UUID.randomUUID()}", UUID.randomUUID(), CheckSource.MANUAL)
        svc.complete(acc, tripId, first.visitCheckId)

        val laterPoi = UUID.randomUUID()
        val second = VisitCheckService(trips, visits, clockAt("2026-08-11T05:00:00Z"))
            .arrive(acc, tripId, "$day#$laterPoi", laterPoi, CheckSource.MANUAL)
        VisitCheckService(trips, visits, clockAt("2026-08-11T06:00:00Z"))
            .complete(acc, tripId, second.visitCheckId)

        svc.lastCompletedPoi(tripId) shouldBe laterPoi
    }

    "하루 묶기는 여행지(KST) 날짜 — UTC 로 보면 자정 무렵이 어긋난다" {
        val visits = Visits()
        // KST 08-11 01:00 = UTC 08-10 16:00
        VisitCheckService(trips, visits, clockAt("2026-08-10T16:00:00Z"))
            .arrive(acc, tripId, slot, poi, CheckSource.MANUAL)

        service(visits).listByDay(acc, tripId, day).size shouldBe 1
        service(visits).listByDay(acc, tripId, LocalDate.parse("2026-08-10")).size shouldBe 0
    }

    "타 계정이면 404 · 다른 여행의 실적도 404" {
        val visits = Visits()
        val svc = service(visits)
        val v = svc.arrive(acc, tripId, slot, poi, CheckSource.MANUAL)

        shouldThrow<ResourceNotFound> { svc.arrive(UUID.randomUUID(), tripId, null, poi, CheckSource.MANUAL) }
        shouldThrow<ResourceNotFound> { svc.complete(acc, UUID.randomUUID(), v.visitCheckId) }
        shouldThrow<ResourceNotFound> { svc.listByDay(UUID.randomUUID(), tripId, day) }
    }
})
