package com.trippilot.notification.adapter.`in`.event

import com.trippilot.core.event.EventEnvelope
import com.trippilot.notification.application.FakePlans
import com.trippilot.notification.application.FakeSchedules
import com.trippilot.notification.application.FakeTripOwner
import com.trippilot.notification.application.NotificationScheduleService
import com.trippilot.notification.application.PendingDeletion
import com.trippilot.notification.application.ReminderCopyRetries
import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.NotificationSchedule
import com.trippilot.notification.domain.ReminderCopy
import com.trippilot.notification.domain.ReminderCopyPort
import com.trippilot.notification.domain.ReminderCopyRequest
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

/**
 * 계정 삭제 요청·철회 → 리마인드 멈춤·되살림 — **처리 시점의 계정 상태**를 따른다.
 *
 * 깨지면 사용자는 탈퇴하겠다고 한 뒤에도 아침마다 푸시를 받거나, 철회해서 돌아온 뒤 예정된 여행의 알림이 말없이 사라진다. 릴레이는 같은 타입의
 * 다른 구독자(도우미 대화 파기)가 실패하면 이벤트를 통째로 백오프 재배달하므로 **뒤늦게 온 요청**이 철회 뒤의 예약을 다시 지우는 일이 실제로 생긴다
 * (독립 리뷰가 찾은 결함) — 그래서 이벤트가 아니라 지금 상태를 본다는 것을 순서를 뒤집어 가며 잰다.
 */
class AccountDeletionSubscribersTest : StringSpec({

    val leaving = UUID.randomUUID()
    val other = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val otherTrip = UUID.randomUUID()
    val clock: Clock = Clock.fixed(Instant.parse("2026-08-01T00:00:00Z"), ZoneOffset.UTC)

    /** 문구를 **얼마나 물었는가**를 센다 — 되살림이 릴레이 스레드에서 AI 를 기다리면 안 된다. */
    class CountingCopies : ReminderCopyPort {
        var asked = 0
        override val enabled = true
        override fun copiesFor(tripTitle: String?, items: List<ReminderCopyRequest>): Map<String, ReminderCopy> {
            asked++
            return emptyMap()
        }
    }

    fun envelope(type: String, aggregateId: String) = EventEnvelope(
        eventId = UUID.randomUUID(), eventType = type, schemaVersion = 1, aggregateType = "Account",
        aggregateId = aggregateId, correlationId = null, occurredAt = clock.instant(), payload = "{}",
    )

    fun pending(accountId: UUID, trip: UUID, kind: NotificationKind, fireAt: String) =
        NotificationSchedule.pending(accountId, trip, kind, Instant.parse(fireAt))

    class Fixture(val state: PendingDeletion, clock: Clock) {
        val schedules = FakeSchedules()
        val trips = FakeTripOwner()
        val copies = CountingCopies()
        val service = NotificationScheduleService(trips, schedules, copies, FakePlans(), clock, ReminderCopyRetries(listOf(180_000L)), state)
        val requested = AccountDeletionRequestedSubscriber(state, service)
        val cancelled = AccountDeletionCancelledSubscriber(state, service)
    }

    "요청 — 삭제 유예 중이면 이 계정의 미발화 예약을 전부 취소한다" {
        val f = Fixture(PendingDeletion(leaving), clock)
        f.schedules.stored += listOf(
            pending(leaving, tripId, NotificationKind.TRIP_PRE, "2026-08-09T23:00:00Z"),
            pending(leaving, tripId, NotificationKind.TRIP_DAY, "2026-08-10T23:00:00Z"),
        )

        f.requested.handle(envelope("auth.AccountDeletionRequested", leaving.toString()))

        f.schedules.findDue(Instant.parse("2099-01-01T00:00:00Z"), 100).shouldBeEmpty()
        f.schedules.stored.all { it.canceledAt == clock.instant() } shouldBe true
    }

    "요청 — 남의 계정 예약과 이미 나간 예약은 건드리지 않는다" {
        val f = Fixture(PendingDeletion(leaving), clock)
        val sent = pending(leaving, tripId, NotificationKind.TRIP_DAY, "2026-07-30T23:00:00Z").copy(firedAt = Instant.parse("2026-07-30T23:00:05Z"))
        val theirs = pending(other, otherTrip, NotificationKind.TRIP_DAY, "2026-08-10T23:00:00Z")
        val mine = pending(leaving, tripId, NotificationKind.TRIP_PRE, "2026-08-09T23:00:00Z")
        f.schedules.stored += listOf(sent, theirs, mine)

        f.requested.handle(envelope("auth.AccountDeletionRequested", leaving.toString()))

        f.schedules.stored.first { it.scheduleId == mine.scheduleId }.canceledAt shouldBe clock.instant()
        // 나간 건 지난 사실이다 — 취소 표시가 붙으면 "안 갔다"로 읽힌다.
        f.schedules.stored.first { it.scheduleId == sent.scheduleId }.canceledAt shouldBe null
        f.schedules.stored.first { it.scheduleId == theirs.scheduleId }.canceledAt shouldBe null
    }

    "요청 — 뒤늦게 온 요청 이벤트는 철회한 계정의 예약을 지우지 않는다(이벤트가 아니라 지금 상태를 본다)" {
        val f = Fixture(PendingDeletion(), clock)   // 이미 철회돼 유예가 아니다
        val restored = pending(leaving, tripId, NotificationKind.TRIP_DAY, "2026-08-10T23:00:00Z")
        f.schedules.stored += restored

        f.requested.handle(envelope("auth.AccountDeletionRequested", leaving.toString()))

        f.schedules.stored.single().canceledAt shouldBe null
    }

    "요청 — 같은 이벤트가 두 번 와도 결과가 같다(at-least-once)" {
        val f = Fixture(PendingDeletion(leaving), clock)
        f.schedules.stored += pending(leaving, tripId, NotificationKind.TRIP_DAY, "2026-08-10T23:00:00Z")
        val e = envelope("auth.AccountDeletionRequested", leaving.toString())

        f.requested.handle(e)
        val once = f.schedules.stored.toList()
        f.requested.handle(e)

        f.schedules.stored shouldBe once
    }

    "계정 id 를 못 읽으면 예외로 올린다 — 릴레이가 재시도하고 상한에서 error 로 남긴다" {
        val f = Fixture(PendingDeletion(leaving), clock)

        shouldThrow<IllegalStateException> { f.requested.handle(envelope("auth.AccountDeletionRequested", "계정 아님")) }
        shouldThrow<IllegalStateException> { f.cancelled.handle(envelope("auth.AccountDeletionCancelled", "x")) }
    }

    "철회 — 요청 때 취소한 예약이 있는 여행만 다시 만든다(지난 시각은 적지 않는다)" {
        val f = Fixture(PendingDeletion(leaving), clock)
        f.trips.put(tripId, leaving, LocalDate.parse("2026-08-10"), LocalDate.parse("2026-08-12"))
        f.schedules.stored += listOf(
            pending(leaving, tripId, NotificationKind.TRIP_PRE, "2026-08-09T23:00:00Z"),
            pending(leaving, tripId, NotificationKind.TRIP_DAY, "2026-08-10T23:00:00Z"),
        )
        f.requested.handle(envelope("auth.AccountDeletionRequested", leaving.toString()))
        f.state.pending.clear()   // 철회

        f.cancelled.handle(envelope("auth.AccountDeletionCancelled", leaving.toString()))

        val restored = f.schedules.findPendingByTrip(tripId)
        restored.map { it.kind } shouldBe listOf(NotificationKind.TRIP_PRE, NotificationKind.TRIP_DAY, NotificationKind.TRIP_DAY, NotificationKind.TRIP_DAY)
        restored.all { it.accountId == leaving } shouldBe true
    }

    "철회 — 취소 흔적이 없는 여행에는 예약을 새로 만들지 않는다(일정이 아직 없어 리마인드가 만들어진 적 없는 여행)" {
        val f = Fixture(PendingDeletion(), clock)
        val neverHadReminders = UUID.randomUUID()
        f.trips.put(tripId, leaving, LocalDate.parse("2026-08-10"), LocalDate.parse("2026-08-12"))
        f.trips.put(neverHadReminders, leaving, LocalDate.parse("2026-08-20"), LocalDate.parse("2026-08-21"))
        f.schedules.stored += pending(leaving, tripId, NotificationKind.TRIP_DAY, "2026-08-10T23:00:00Z").copy(canceledAt = clock.instant())

        f.cancelled.handle(envelope("auth.AccountDeletionCancelled", leaving.toString()))

        f.schedules.findPendingByTrip(neverHadReminders).shouldBeEmpty()
        f.schedules.findPendingByTrip(tripId).shouldHaveSize(4)
    }

    "철회 — 이미 시각이 지나 닫힌 취소는 되살리지 않는다" {
        val f = Fixture(PendingDeletion(), clock)
        f.trips.put(tripId, leaving, LocalDate.parse("2026-07-20"), LocalDate.parse("2026-07-21"))
        // 유예를 넘겨 닫힌 지난 예약(CANCELED_LATE)은 철회와 무관하다.
        f.schedules.stored += pending(leaving, tripId, NotificationKind.TRIP_DAY, "2026-07-20T23:00:00Z").copy(canceledAt = Instant.parse("2026-07-21T00:00:00Z"))

        f.cancelled.handle(envelope("auth.AccountDeletionCancelled", leaving.toString()))

        f.schedules.findPendingByTrip(tripId).shouldBeEmpty()
    }

    "철회 — 철회 뒤 다시 삭제를 요청했다면 뒤늦은 철회 이벤트가 예약을 되살리지 않는다" {
        val f = Fixture(PendingDeletion(leaving), clock)   // 요청2 가 이미 반영됐다
        f.trips.put(tripId, leaving, LocalDate.parse("2026-08-10"), LocalDate.parse("2026-08-12"))
        f.schedules.stored += pending(leaving, tripId, NotificationKind.TRIP_DAY, "2026-08-10T23:00:00Z").copy(canceledAt = clock.instant())

        f.cancelled.handle(envelope("auth.AccountDeletionCancelled", leaving.toString()))

        f.schedules.findPendingByTrip(tripId).shouldBeEmpty()
    }

    "철회 — 되살리면서 문구를 지금 묻지 않는다(릴레이 스레드가 AI 를 기다리지 않게) · 두 번 배달돼도 하루 리마인드가 두 벌이 아니다" {
        val f = Fixture(PendingDeletion(), clock)
        f.trips.put(tripId, leaving, LocalDate.parse("2026-08-10"), LocalDate.parse("2026-08-10"))
        f.schedules.stored += pending(leaving, tripId, NotificationKind.TRIP_DAY, "2026-08-09T23:00:00Z").copy(canceledAt = clock.instant())
        val e = envelope("auth.AccountDeletionCancelled", leaving.toString())

        f.cancelled.handle(e)
        f.cancelled.handle(e)

        f.copies.asked shouldBe 0
        f.schedules.findPendingByTrip(tripId) shouldHaveSize 2   // TRIP_PRE + TRIP_DAY
    }
})
