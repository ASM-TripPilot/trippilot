package com.trippilot.notification.application

import com.trippilot.core.error.ResourceNotFound
import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.NotificationSchedule
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

/**
 * 예약 → 알림 발화(INV-U6-09)와 알림함 읽음(`l01`).
 *
 * 발화의 멱등은 조건부 쓰기 하나에 달려 있다 — 그 조건이 빠지면 다중 인스턴스에서 같은 알림이 두 번 뜬다.
 */
class NotificationFiringServiceTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val fireAt = Instant.parse("2026-08-10T23:00:00Z")

    fun clockAt(i: String): Clock = Clock.fixed(Instant.parse(i), ZoneOffset.UTC)

    fun pending() = NotificationSchedule.pending(acc, tripId, NotificationKind.TRIP_DAY, fireAt)

    /** 기본값이 전부 인앱 ON 이라, 저장된 토글이 없으면 그대로 통과한다. */
    fun allowAll(clock: Clock) = NotificationToggleService(FakeToggles(), clock)

    fun fixture(now: String, schedule: NotificationSchedule): Triple<NotificationFiringService, FakeSchedules, FakeNotifications> {
        val schedules = FakeSchedules().apply { stored += schedule }
        val notifications = FakeNotifications()
        return Triple(NotificationFiringService(schedules, notifications, allowAll(clockAt(now)), clockAt(now)), schedules, notifications)
    }

    "도래하면 알림이 적재되고 예약은 발화로 닫힌다" {
        val s = pending()
        val (svc, schedules, notifications) = fixture("2026-08-10T23:00:30Z", s)

        svc.fire(s) shouldBe FireOutcome.FIRED

        notifications.stored.single().kind shouldBe NotificationKind.TRIP_DAY
        // 시각은 예정이 아니라 실제 발화 시각이다 — 화면이 상대 시각으로 그리므로 오차만큼 어긋난 말이 된다.
        notifications.stored.single().occurredAt shouldBe Instant.parse("2026-08-10T23:00:30Z")
        notifications.stored.single().sourceEventId shouldBe null
        schedules.findPendingByTrip(tripId) shouldBe emptyList()
    }

    "유예를 넘겨 발견되면 발화하지 않고 닫는다(INV-U6-09)" {
        val s = pending()
        // 유예 10분 + 1분.
        val (svc, schedules, notifications) = fixture("2026-08-10T23:11:00Z", s)

        svc.fire(s) shouldBe FireOutcome.CANCELED_LATE

        notifications.stored shouldBe emptyList()
        schedules.stored.single().canceledAt shouldBe Instant.parse("2026-08-10T23:11:00Z")
        schedules.stored.single().firedAt shouldBe null
    }

    "유예 안쪽이면 늦게 집혀도 정상 발화한다 — 폴링 주기만큼은 늘 늦다" {
        val s = pending()
        val (svc, _, notifications) = fixture("2026-08-10T23:09:00Z", s)

        svc.fire(s) shouldBe FireOutcome.FIRED
        notifications.stored.size shouldBe 1
    }

    "다른 인스턴스가 이미 집었으면 알림을 만들지 않는다" {
        val s = pending()
        val (svc, schedules, notifications) = fixture("2026-08-10T23:00:30Z", s)
        schedules.markFired(s.scheduleId, Instant.parse("2026-08-10T23:00:10Z")) // 남이 먼저

        svc.fire(s) shouldBe FireOutcome.ALREADY_TAKEN

        notifications.stored shouldBe emptyList()
    }

    "읽음 표시는 멱등이고 처음 읽은 시각이 덮이지 않는다" {
        val notifications = FakeNotifications()
        val s = pending()
        NotificationFiringService(FakeSchedules().apply { stored += s }, notifications, allowAll(clockAt("2026-08-10T23:00:30Z")), clockAt("2026-08-10T23:00:30Z")).fire(s)
        val id = notifications.stored.single().notificationId

        val query = NotificationQueryService(notifications, clockAt("2026-08-11T00:00:00Z"))
        query.markRead(acc, id)
        // 두 번째 호출은 오류가 아니다 — 목록을 열 때마다 클라이언트가 재시도할 수 있다.
        NotificationQueryService(notifications, clockAt("2026-08-12T00:00:00Z")).markRead(acc, id)

        notifications.stored.single().readAt shouldBe Instant.parse("2026-08-11T00:00:00Z")
    }

    "남의 알림은 404 로 은닉한다" {
        val notifications = FakeNotifications()
        val s = pending()
        NotificationFiringService(FakeSchedules().apply { stored += s }, notifications, allowAll(clockAt("2026-08-10T23:00:30Z")), clockAt("2026-08-10T23:00:30Z")).fire(s)
        val id = notifications.stored.single().notificationId

        shouldThrow<ResourceNotFound> {
            NotificationQueryService(notifications, clockAt("2026-08-11T00:00:00Z")).markRead(UUID.randomUUID(), id)
        }
    }

    "미읽음만 조회는 읽은 것을 빼고 준다" {
        val notifications = FakeNotifications()
        listOf("2026-08-10T23:00:30Z", "2026-08-10T23:05:30Z").forEach {
            val s = NotificationSchedule.pending(acc, tripId, NotificationKind.TRIP_DAY, Instant.parse(it))
            NotificationFiringService(FakeSchedules().apply { stored += s }, notifications, allowAll(clockAt(it)), clockAt(it)).fire(s)
        }
        val query = NotificationQueryService(notifications, clockAt("2026-08-11T00:00:00Z"))
        query.markRead(acc, notifications.stored.first().notificationId)

        query.list(acc, unreadOnly = true, limit = 50).size shouldBe 1
        query.list(acc, unreadOnly = false, limit = 50).size shouldBe 2
        // 최신이 앞이다.
        query.list(acc, unreadOnly = false, limit = 50).first().occurredAt shouldBe Instant.parse("2026-08-10T23:05:30Z")
    }
})
