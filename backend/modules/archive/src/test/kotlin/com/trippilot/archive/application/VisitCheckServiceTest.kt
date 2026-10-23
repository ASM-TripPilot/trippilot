package com.trippilot.archive.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.archive.domain.CheckSource
import com.trippilot.archive.domain.VisitCheck
import com.trippilot.archive.domain.VisitCheckRepository
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.collections.shouldContainExactlyInAnyOrder
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
        VisitCheckService(trips, visits, CapturingEvents(), clock, FakeIntervals())

    "도착 전 건너뛰기 — 실적 없는 계획 슬롯이 SKIPPED 로 남는다(TRIP-1029)" {
        val visits = Visits()
        val v = service(visits).skipPlanned(acc, tripId, slot, poi)

        v.arrivedAt shouldBe null // 가지 않았다 — 거짓 도착을 만들지 않는다
        v.skippedAt shouldBe Instant.parse("2026-08-11T03:00:00Z")
        v.source shouldBe CheckSource.MANUAL // 건너뛰기는 항상 사용자 행위다
        visits.stored.size shouldBe 1
    }

    "같은 건너뛰기 재전송은 ALREADY, 다른 실적 위 건너뛰기는 CONFLICT — 클라이언트가 갈 길이 다르다(BR-U5-20)" {
        val visits = Visits()
        val svc = service(visits)
        svc.skipPlanned(acc, tripId, slot, poi)

        val replay = shouldThrow<ConflictDetected> { svc.skipPlanned(acc, tripId, slot, poi) }
        replay.errorCode shouldBe com.trippilot.core.error.ErrorCode.VISIT_ALREADY_RECORDED // 수렴하면 된다

        val arrivedSlot = "$day#${UUID.randomUUID()}"
        svc.arrive(acc, tripId, arrivedSlot, poi, CheckSource.MANUAL)
        val onArrived = shouldThrow<ConflictDetected> { svc.skipPlanned(acc, tripId, arrivedSlot, poi) }
        onArrived.errorCode shouldBe com.trippilot.core.error.ErrorCode.VISIT_CONFLICT // 도착분은 기존 skip 경로로
    }

    "타 계정의 도착 전 건너뛰기는 404 — 존재를 숨긴다" {
        shouldThrow<ResourceNotFound> { service(Visits()).skipPlanned(UUID.randomUUID(), tripId, slot, poi) }
    }

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

        svc.getCompletedSlots(tripId) shouldContainExactly listOf(otherSlot)
        arrivedOnly.isCompleted shouldBe false
    }

    // TRIP-1412 — 재계획 되돌리기가 떼면 안 되는 슬롯. 도착만 한 기록도 고아가 된다.
    "다녀온 슬롯은 도착·완료 — 건너뛴 것과 즉석 방문은 빠진다" {
        val visits = Visits()
        val svc = service(visits)
        svc.arrive(acc, tripId, slot, poi, CheckSource.MANUAL)
        val doneSlot = "$day#${UUID.randomUUID()}"
        val done = svc.arrive(acc, tripId, doneSlot, UUID.randomUUID(), CheckSource.MANUAL)
        svc.complete(acc, tripId, done.visitCheckId)
        val skippedSlot = "$day#${UUID.randomUUID()}"
        val skipped = svc.arrive(acc, tripId, skippedSlot, UUID.randomUUID(), CheckSource.MANUAL)
        svc.skip(acc, tripId, skipped.visitCheckId)
        svc.arrive(acc, tripId, null, UUID.randomUUID(), CheckSource.MANUAL)

        svc.getVisitedSlots(tripId) shouldContainExactlyInAnyOrder listOf(slot, doneSlot)
    }

    "마지막 완료 방문지는 완료 시각이 가장 늦은 것 — 기준점 사다리 3단 입력" {
        val visits = Visits()
        val svc = service(visits, clockAt("2026-08-11T03:00:00Z"))
        val first = svc.arrive(acc, tripId, "$day#${UUID.randomUUID()}", UUID.randomUUID(), CheckSource.MANUAL)
        svc.complete(acc, tripId, first.visitCheckId)

        val laterPoi = UUID.randomUUID()
        val second = VisitCheckService(trips, visits, CapturingEvents(), clockAt("2026-08-11T05:00:00Z"), FakeIntervals())
            .arrive(acc, tripId, "$day#$laterPoi", laterPoi, CheckSource.MANUAL)
        VisitCheckService(trips, visits, CapturingEvents(), clockAt("2026-08-11T06:00:00Z"), FakeIntervals())
            .complete(acc, tripId, second.visitCheckId)

        svc.findLastCompletedPoi(tripId) shouldBe laterPoi
    }

    "하루 묶기는 여행지(KST) 날짜 — UTC 로 보면 자정 무렵이 어긋난다" {
        val visits = Visits()
        // KST 08-11 01:00 = UTC 08-10 16:00
        VisitCheckService(trips, visits, CapturingEvents(), clockAt("2026-08-10T16:00:00Z"), FakeIntervals())
            .arrive(acc, tripId, slot, poi, CheckSource.MANUAL)

        service(visits).listByDay(acc, tripId, day).size shouldBe 1
        service(visits).listByDay(acc, tripId, LocalDate.parse("2026-08-10")).size shouldBe 0
    }

    // TRIP-1315 — 화면이 카드에 "몇 번째 방문"을 붙인다. 기록(`/records`)은 지나온 순서로 주는데 이 목록은
    // 저장소 순서(최신 먼저)를 그대로 내보내서, 같은 방문이 허브와 기록에서 다른 번호를 받게 돼 있었다.
    "그 날의 방문은 지나온 순서로 나온다 — 도착 안 한 건너뛰기는 건너뛴 시각으로 사이에 끼어든다" {
        val visits = Visits()
        val (first, skipped, last) = List(3) { UUID.randomUUID() }
        fun at(i: String) = VisitCheckService(trips, visits, CapturingEvents(), clockAt(i), FakeIntervals())
        // 일부러 지나온 순서와 다르게 넣는다 — 저장 순서를 그대로 내보내면 깨진다.
        at("2026-08-11T05:00:00Z").arrive(acc, tripId, "$day#$last", last, CheckSource.MANUAL)
        at("2026-08-11T01:00:00Z").arrive(acc, tripId, null, first, CheckSource.MANUAL) // 즉석 방문
        at("2026-08-11T03:00:00Z").skipPlanned(acc, tripId, "$day#$skipped", skipped)

        service(visits).listByDay(acc, tripId, day).map { it.poiId } shouldContainExactly listOf(first, skipped, last)
    }

    "같은 시각의 방문은 넣은 순서와 무관하게 같은 순서로 나온다 — 번호가 요청마다 뒤집히지 않는다" {
        val at = Instant.parse("2026-08-11T03:00:00Z")
        val pair = List(2) { VisitCheck.arrive(tripId, null, UUID.randomUUID(), CheckSource.MANUAL, at) }
        fun order(input: List<VisitCheck>) =
            service(Visits().also { v -> input.forEach(v::save) }).listByDay(acc, tripId, day).map { it.visitCheckId }

        order(pair) shouldContainExactly order(pair.reversed())
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
