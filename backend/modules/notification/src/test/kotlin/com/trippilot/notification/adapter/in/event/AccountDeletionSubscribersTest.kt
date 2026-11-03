package com.trippilot.notification.adapter.`in`.event

import com.trippilot.core.event.EventEnvelope
import com.trippilot.notification.application.FakePlans
import com.trippilot.notification.application.FakeSchedules
import com.trippilot.notification.application.FakeTripOwner
import com.trippilot.notification.application.NotificationScheduleService
import com.trippilot.notification.application.PushTokenService
import com.trippilot.notification.application.ReminderCopyRetries
import com.trippilot.notification.domain.DevicePlatform
import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.NotificationSchedule
import com.trippilot.notification.domain.OsPermission
import com.trippilot.notification.domain.PushToken
import com.trippilot.notification.domain.PushTokenRepository
import com.trippilot.notification.domain.ReminderCopy
import com.trippilot.notification.domain.ReminderCopyPort
import com.trippilot.notification.domain.ReminderCopyRequest
import com.trippilot.trip.api.TripPurgeScopeFacade
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
 * 계정 삭제 요청·철회 → 알림 멈춤·되살림.
 *
 * 깨지면 사용자는 **탈퇴하겠다고 한 뒤에도 아침마다 푸시를 받거나**, 철회해서 돌아온 뒤 **예정된 여행의 알림이
 * 말없이 사라진다.** 둘 다 조용한 실패라 로그에도 안 남는다 — 그래서 남의 계정·이미 나간 예약을 건드리지 않는지까지 잰다.
 */
class AccountDeletionSubscribersTest : StringSpec({

    val leaving = UUID.randomUUID()
    val other = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val otherTrip = UUID.randomUUID()
    val clock: Clock = Clock.fixed(Instant.parse("2026-08-01T00:00:00Z"), ZoneOffset.UTC)

    class NoCopies : ReminderCopyPort {
        override val enabled = false
        override fun copiesFor(tripTitle: String?, items: List<ReminderCopyRequest>) = emptyMap<String, ReminderCopy>()
    }

    class Tokens : PushTokenRepository {
        val rows = mutableListOf<PushToken>()
        override fun register(token: PushToken) = token.also { rows += it }
        override fun findActive(accountId: UUID) = rows.filter { it.accountId == accountId && it.invalidatedAt == null }
        override fun invalidate(token: String, at: Instant) = false
        override fun invalidateIfNotSeenSince(token: String, notSeenAfter: Instant, at: Instant) = false
        override fun remove(accountId: UUID, token: String) = false
        override fun removeAll(accountId: UUID): Int = rows.count { it.accountId == accountId }.also { rows.removeIf { r -> r.accountId == accountId } }
    }

    fun token(accountId: UUID, value: String, invalidated: Boolean = false) = PushToken(
        pushTokenId = UUID.randomUUID(), accountId = accountId, token = value, deviceId = null,
        platform = DevicePlatform.IOS, osPermission = OsPermission.GRANTED, lastSeenAt = clock.instant(),
        invalidatedAt = if (invalidated) clock.instant() else null,
    )

    fun envelope(type: String, aggregateId: String) = EventEnvelope(
        eventId = UUID.randomUUID(), eventType = type, schemaVersion = 1, aggregateType = "Account",
        aggregateId = aggregateId, correlationId = null, occurredAt = clock.instant(), payload = "{}",
    )

    fun pending(accountId: UUID, trip: UUID, kind: NotificationKind, fireAt: String) =
        NotificationSchedule.pending(accountId, trip, kind, Instant.parse(fireAt))

    class Fixture {
        val schedules = FakeSchedules()
        val tokens = Tokens()
        val trips = FakeTripOwner()
    }

    fun scheduleService(f: Fixture) =
        NotificationScheduleService(f.trips, f.schedules, NoCopies(), FakePlans(), clock, ReminderCopyRetries(listOf(180_000L)))

    "삭제 요청 — 이 계정의 미발화 예약을 전부 취소하고 토큰을 지운다" {
        val f = Fixture()
        f.schedules.stored += listOf(
            pending(leaving, tripId, NotificationKind.TRIP_PRE, "2026-08-09T23:00:00Z"),
            pending(leaving, tripId, NotificationKind.TRIP_DAY, "2026-08-10T23:00:00Z"),
        )
        f.tokens.rows += listOf(token(leaving, "ExponentPushToken[a]"), token(leaving, "ExponentPushToken[dead]", invalidated = true))
        val sut = AccountDeletionRequestedSubscriber(PushTokenService(f.tokens, clock), scheduleService(f))

        sut.handle(envelope("auth.AccountDeletionRequested", leaving.toString()))

        f.schedules.findDue(Instant.parse("2099-01-01T00:00:00Z"), 100).shouldBeEmpty()
        f.schedules.stored.all { it.canceledAt == clock.instant() } shouldBe true
        // 무효화된 토큰도 지운다 — 계정에 남는 푸시 식별자가 없어야 한다.
        f.tokens.rows.shouldBeEmpty()
    }

    "삭제 요청 — 남의 계정 예약·토큰과 이미 나간 예약은 건드리지 않는다" {
        val f = Fixture()
        val sent = pending(leaving, tripId, NotificationKind.TRIP_DAY, "2026-07-30T23:00:00Z").copy(firedAt = Instant.parse("2026-07-30T23:00:05Z"))
        val theirs = pending(other, otherTrip, NotificationKind.TRIP_DAY, "2026-08-10T23:00:00Z")
        val mine = pending(leaving, tripId, NotificationKind.TRIP_PRE, "2026-08-09T23:00:00Z")
        f.schedules.stored += listOf(sent, theirs, mine)
        f.tokens.rows += listOf(token(leaving, "ExponentPushToken[a]"), token(other, "ExponentPushToken[b]"))
        val sut = AccountDeletionRequestedSubscriber(PushTokenService(f.tokens, clock), scheduleService(f))

        sut.handle(envelope("auth.AccountDeletionRequested", leaving.toString()))

        f.schedules.stored.first { it.scheduleId == mine.scheduleId }.canceledAt shouldBe clock.instant()
        // 나간 건 지난 사실이다 — 취소 표시가 붙으면 "안 갔다"로 읽힌다.
        f.schedules.stored.first { it.scheduleId == sent.scheduleId }.canceledAt shouldBe null
        f.schedules.stored.first { it.scheduleId == theirs.scheduleId }.canceledAt shouldBe null
        f.tokens.rows.map { it.accountId } shouldBe listOf(other)
    }

    "삭제 요청 — 같은 이벤트가 두 번 와도 결과가 같다(at-least-once)" {
        val f = Fixture()
        f.schedules.stored += pending(leaving, tripId, NotificationKind.TRIP_DAY, "2026-08-10T23:00:00Z")
        f.tokens.rows += token(leaving, "ExponentPushToken[a]")
        val sut = AccountDeletionRequestedSubscriber(PushTokenService(f.tokens, clock), scheduleService(f))
        val e = envelope("auth.AccountDeletionRequested", leaving.toString())

        sut.handle(e)
        val once = f.schedules.stored.toList()
        sut.handle(e)

        f.schedules.stored shouldBe once
        f.tokens.rows.shouldBeEmpty()
    }

    "계정 id 를 못 읽으면 예외로 올린다 — 릴레이가 재시도하고 상한에서 error 로 남긴다" {
        val f = Fixture()
        val sut = AccountDeletionRequestedSubscriber(PushTokenService(f.tokens, clock), scheduleService(f))

        shouldThrow<IllegalStateException> { sut.handle(envelope("auth.AccountDeletionRequested", "계정 아님")) }
    }

    "삭제 철회 — 그 계정의 여행마다 예약을 다시 만든다(지난 시각은 적지 않는다)" {
        val f = Fixture()
        // 08-10~08-12 여행 — 요청 때 취소돼 미발화분이 없다. 철회가 이걸 되살려야 한다.
        f.trips.put(tripId, leaving, LocalDate.parse("2026-08-10"), LocalDate.parse("2026-08-12"))
        // 남의 여행은 건드리지 않는다.
        f.trips.put(otherTrip, other, LocalDate.parse("2026-08-10"), LocalDate.parse("2026-08-10"))
        val sut = AccountDeletionCancelledSubscriber(
            object : TripPurgeScopeFacade {
                override fun findAllTripIdsOf(accountId: UUID) = if (accountId == leaving) listOf(tripId) else emptyList()
            },
            scheduleService(f),
        )

        sut.handle(envelope("auth.AccountDeletionCancelled", leaving.toString()))

        val restored = f.schedules.findPendingByTrip(tripId)
        restored.map { it.kind } shouldBe listOf(NotificationKind.TRIP_PRE, NotificationKind.TRIP_DAY, NotificationKind.TRIP_DAY, NotificationKind.TRIP_DAY)
        restored.all { it.accountId == leaving } shouldBe true
        f.schedules.findPendingByTrip(otherTrip).shouldBeEmpty()
    }

    "삭제 철회 — 두 번 배달돼도 하루 리마인드가 두 벌이 되지 않는다" {
        val f = Fixture()
        f.trips.put(tripId, leaving, LocalDate.parse("2026-08-10"), LocalDate.parse("2026-08-10"))
        val sut = AccountDeletionCancelledSubscriber(
            object : TripPurgeScopeFacade {
                override fun findAllTripIdsOf(accountId: UUID) = listOf(tripId)
            },
            scheduleService(f),
        )
        val e = envelope("auth.AccountDeletionCancelled", leaving.toString())

        sut.handle(e)
        sut.handle(e)

        f.schedules.findPendingByTrip(tripId) shouldHaveSize 2 // TRIP_PRE + TRIP_DAY
    }

    "삭제 철회 — 계정 id 를 못 읽으면 예외로 올린다" {
        val f = Fixture()
        val sut = AccountDeletionCancelledSubscriber(
            object : TripPurgeScopeFacade {
                override fun findAllTripIdsOf(accountId: UUID) = emptyList<UUID>()
            },
            scheduleService(f),
        )

        shouldThrow<IllegalStateException> { sut.handle(envelope("auth.AccountDeletionCancelled", "x")) }
    }
})
