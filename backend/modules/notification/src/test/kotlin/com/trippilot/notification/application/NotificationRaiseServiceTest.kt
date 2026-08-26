package com.trippilot.notification.application

import com.trippilot.notification.domain.DevicePlatform
import com.trippilot.notification.domain.Notification
import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.NotificationRepository
import com.trippilot.notification.domain.NotificationToggle
import com.trippilot.notification.domain.NotificationToggleRepository
import com.trippilot.notification.domain.OsPermission
import com.trippilot.notification.domain.PushMessage
import com.trippilot.notification.domain.PushPort
import com.trippilot.notification.domain.PushReceipt
import com.trippilot.notification.domain.PushStatus
import com.trippilot.notification.domain.PushToken
import com.trippilot.notification.domain.PushTokenRepository
import com.trippilot.trip.api.OwnedTripPeriod
import com.trippilot.trip.api.TripOwnerFacade
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

/**
 * 도메인 사건 적재의 **재배달 처리**(INV-U6-01 · BR-U6-34).
 *
 * `source_event_id` UNIQUE 가 알림 행의 중복을 막는 것은 실 DB IT 가 본다. 여기서 묻는 것은
 * 그 다음이다 — **삽입되지 않았을 때 푸시까지 멈추는가.** 멈추지 않으면 알림함에는 한 줄인데
 * 사용자 기기는 두 번 울린다. 행이 하나라서 조회로는 영영 드러나지 않는 종류의 결함이다.
 */
class NotificationRaiseServiceTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val clock: Clock = Clock.fixed(Instant.parse("2026-08-11T01:00:00Z"), ZoneOffset.UTC)

    /** 같은 `sourceEventId` 는 한 번만 삽입한다 — DB UNIQUE 를 흉내 낸다(보증은 IT 가 한다). */
    class Notifications : NotificationRepository {
        val stored = mutableListOf<Notification>()
        override fun appendIfAbsent(notification: Notification): Boolean {
            if (notification.sourceEventId != null && stored.any { it.sourceEventId == notification.sourceEventId }) return false
            stored += notification
            return true
        }
        override fun findByAccount(accountId: UUID, unreadOnly: Boolean, limit: Int) = stored.toList()
        override fun markRead(accountId: UUID, notificationId: UUID, at: Instant) = true
        override fun exists(accountId: UUID, notificationId: UUID) = true
        override fun markPushResult(notificationId: UUID, sentAt: Instant?, failedReason: String?) = Unit
    }

    class Tokens : PushTokenRepository {
        override fun register(token: PushToken) = token
        override fun findActive(accountId: UUID) = listOf(
            PushToken(
                UUID.randomUUID(), accountId, "ExponentPushToken[x]", null,
                DevicePlatform.IOS, OsPermission.GRANTED, Instant.EPOCH, null,
            ),
        )
        override fun invalidate(token: String, at: Instant) = false
        override fun remove(accountId: UUID, token: String) = false
    }

    class Sender : PushPort {
        var calls = 0
        override fun send(tokens: List<String>, message: PushMessage): List<PushReceipt> {
            calls++
            return tokens.map { PushReceipt(it, PushStatus.SENT) }
        }
    }

    val toggles = object : NotificationToggleRepository {
        override fun findByAccount(accountId: UUID) = emptyList<NotificationToggle>()
        override fun upsert(toggle: NotificationToggle) = toggle
    }

    val trips = object : TripOwnerFacade {
        override fun findOwnedPeriod(tripId: UUID) =
            OwnedTripPeriod(acc, LocalDate.parse("2026-08-10"), LocalDate.parse("2026-08-12"))
    }

    fun serviceOf(notifications: Notifications, sender: Sender): NotificationRaiseService {
        val toggleService = NotificationToggleService(toggles, clock)
        return NotificationRaiseService(
            notifications, toggleService,
            PushDispatchService(Tokens(), notifications, toggleService, sender, clock),
            trips, clock,
        )
    }

    fun raise(svc: NotificationRaiseService, eventId: UUID) = svc.raise(
        accountId = acc, kind = NotificationKind.STAY, title = "숙소가 등록됐어요", body = "제주 호텔",
        sourceEventId = eventId, dedupKey = "STAY#x",
    )

    "재배달이면 푸시도 하지 않는다 — 알림함은 한 줄인데 기기가 두 번 울리는 일을 막는다" {
        val notifications = Notifications()
        val sender = Sender()
        val svc = serviceOf(notifications, sender)
        val eventId = UUID.randomUUID()

        raise(svc, eventId)
        raise(svc, eventId)

        notifications.stored.size shouldBe 1
        // UNIQUE 가 막아 준 중복이 푸시 경로로 새어 나가는 자리다.
        sender.calls shouldBe 1
    }

    "다른 사건이면 각각 나간다 — 멱등이 과하게 걸리지 않는다" {
        val notifications = Notifications()
        val sender = Sender()
        val svc = serviceOf(notifications, sender)

        raise(svc, UUID.randomUUID())
        raise(svc, UUID.randomUUID())

        notifications.stored.size shouldBe 2
        sender.calls shouldBe 2
    }

    "인앱 수신을 끈 종류는 적재도 푸시도 없다" {
        val off = object : NotificationToggleRepository {
            override fun findByAccount(accountId: UUID) = listOf(
                NotificationToggle(accountId, NotificationKind.STAY, pushEnabled = true, inAppEnabled = false, updatedAt = Instant.EPOCH),
            )
            override fun upsert(toggle: NotificationToggle) = toggle
        }
        val notifications = Notifications()
        val sender = Sender()
        val toggleService = NotificationToggleService(off, clock)
        val svc = NotificationRaiseService(
            notifications, toggleService,
            PushDispatchService(Tokens(), notifications, toggleService, sender, clock),
            trips, clock,
        )

        raise(svc, UUID.randomUUID())

        notifications.stored.size shouldBe 0
        sender.calls shouldBe 0
    }

    "삭제된 여행의 소유자는 없다 — 회고 알림이 갈 곳이 없다" {
        val deleted = object : TripOwnerFacade {
            override fun findOwnedPeriod(tripId: UUID) = null
        }
        val notifications = Notifications()
        val toggleService = NotificationToggleService(toggles, clock)
        val svc = NotificationRaiseService(
            notifications, toggleService,
            PushDispatchService(Tokens(), notifications, toggleService, Sender(), clock),
            deleted, clock,
        )

        svc.ownerOfTrip(tripId) shouldBe null
    }
})
