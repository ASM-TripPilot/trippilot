package com.trippilot.notification.adapter.`in`.event

import com.trippilot.core.event.EventEnvelope
import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.notification.application.FakePlans
import com.trippilot.notification.application.FakeSchedules
import com.trippilot.notification.application.FakeTripOwner
import com.trippilot.notification.application.NoDeletionPending
import com.trippilot.notification.application.NotificationScheduleService
import com.trippilot.notification.application.ReminderCopyRetries
import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.NotificationSchedule
import com.trippilot.notification.domain.ReminderCopy
import com.trippilot.notification.domain.ReminderCopyPort
import com.trippilot.notification.domain.ReminderCopyRequest
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.UUID

/**
 * 여행 기간 변경 → 리마인드 예약 재계산(TRIP-1758).
 *
 * 깨지면 사용자는 기간을 고친 뒤에도 **옛 날짜에 알림을 받거나 새 날짜에 못 받는다.** 반대로 가드가 빠지면 일정을 짜지도 않은 여행에
 * "오늘의 일정" 알림이 울린다 — 둘 다 로그에 안 남는 조용한 오동작이라 직접 잰다.
 */
class TripPeriodChangedSubscriberTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val clock: Clock = Clock.fixed(Instant.parse("2026-08-01T00:00:00Z"), ZoneOffset.UTC)

    /** 문구 경계 미배선 — 이 스펙은 예약의 시각만 본다. */
    class NoCopies : ReminderCopyPort {
        override val enabled = false
        override fun copiesFor(tripTitle: String?, items: List<ReminderCopyRequest>) = emptyMap<String, ReminderCopy>()
    }

    fun kst(date: String, hour: Int) = LocalDate.parse(date).atTime(hour, 0).atZone(ZoneId.of("Asia/Seoul")).toInstant()

    fun envelope(aggregateId: String, payload: String = "{}") = EventEnvelope(
        eventId = UUID.randomUUID(), eventType = "trip.TripPeriodChanged", schemaVersion = 1, aggregateType = "Trip",
        aggregateId = aggregateId, correlationId = null, occurredAt = clock.instant(), payload = payload,
    )

    class Fixture(clock: Clock, hasItinerary: () -> Boolean = { true }) {
        val schedules = FakeSchedules()
        val trips = FakeTripOwner()
        private val plans = object : ItineraryPlanFacade by FakePlans() {
            override fun hasItinerary(accountId: UUID, tripId: UUID) = hasItinerary()
        }
        val service = NotificationScheduleService(trips, schedules, NoCopies(), plans, clock, ReminderCopyRetries(listOf(180_000L)), NoDeletionPending)
        val subscriber = TripPeriodChangedSubscriber(service)
    }

    fun Fixture.period(start: String, end: String) = trips.put(tripId, acc, LocalDate.parse(start), LocalDate.parse(end))

    "일정을 버린 여행 — 예약을 다시 세우지 않고 비운다(TRIP-1789 · 없는 일정의 오늘의 일정이 울리면 안 된다)" {
        var kept = true
        val f = Fixture(clock) { kept }
        f.period("2026-08-10", "2026-08-12")
        f.service.reload(tripId)
        kept = false
        f.period("2026-08-11", "2026-08-15")

        f.subscriber.handle(envelope(tripId.toString()))

        f.schedules.findPendingByTrip(tripId) shouldBe emptyList()
    }

    "예약이 있는 여행 — 기간이 바뀌면 새 기간으로 다시 선다" {
        val f = Fixture(clock)
        f.period("2026-08-10", "2026-08-12")
        f.service.reload(tripId) // 일정 생성이 만든 예약
        f.period("2026-08-11", "2026-08-13")

        f.subscriber.handle(envelope(tripId.toString()))

        f.schedules.findPendingByTrip(tripId).map { it.fireAt } shouldContainExactly listOf(
            kst("2026-08-10", 8), kst("2026-08-11", 8), kst("2026-08-12", 8), kst("2026-08-13", 8),
        )
        f.schedules.findPendingByTrip(tripId).map { it.kind } shouldContainExactly listOf(
            NotificationKind.TRIP_PRE, NotificationKind.TRIP_DAY, NotificationKind.TRIP_DAY, NotificationKind.TRIP_DAY,
        )
    }

    "예약이 한 번도 만들어진 적 없는 여행은 건드리지 않는다 — 일정도 없는 여행의 알림이 울리면 안 된다" {
        val f = Fixture(clock)
        f.period("2026-08-10", "2026-08-12")

        f.subscriber.handle(envelope(tripId.toString()))

        f.schedules.stored shouldBe emptyList()
    }

    "같은 이벤트가 두 번 배달돼도 예약은 한 벌이다(at-least-once)" {
        val f = Fixture(clock)
        f.period("2026-08-10", "2026-08-12")
        f.service.reload(tripId)
        f.period("2026-08-10", "2026-08-13")

        repeat(2) { f.subscriber.handle(envelope(tripId.toString())) }

        f.schedules.findPendingByTrip(tripId).size shouldBe 5 // 전날 1 + 4일
    }

    "사건에 실린 날짜가 아니라 배달 시점의 현재 기간을 따른다 — 뒤늦게 온 옛 사건이 새 기간을 덮지 않는다" {
        val f = Fixture(clock)
        f.period("2026-08-10", "2026-08-12")
        f.service.reload(tripId)
        f.period("2026-08-20", "2026-08-21") // 그 사이 한 번 더 바뀌었다

        f.subscriber.handle(envelope(tripId.toString(), """{"tripId":"$tripId","startDate":"2026-08-10","endDate":"2026-08-13"}"""))

        f.schedules.findPendingByTrip(tripId).map { it.fireAt } shouldContainExactly listOf(
            kst("2026-08-19", 8), kst("2026-08-20", 8), kst("2026-08-21", 8),
        )
    }

    "aggregateId 를 여행으로 못 읽으면 예외로 올린다 — 릴레이가 재시도하고 상한에서 남긴다" {
        val f = Fixture(clock)

        shouldThrow<IllegalStateException> { f.subscriber.handle(envelope("not-a-uuid")) }
    }

    "구독하는 이벤트 타입은 trip 이 내는 것과 같다" {
        TripPeriodChangedSubscriber(Fixture(clock).service).eventType shouldBe "trip.TripPeriodChanged"
    }
})
