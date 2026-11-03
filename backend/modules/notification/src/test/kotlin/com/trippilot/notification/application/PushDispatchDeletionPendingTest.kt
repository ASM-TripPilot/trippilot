package com.trippilot.notification.application

import com.trippilot.notification.domain.DevicePlatform
import com.trippilot.notification.domain.Notification
import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.OsPermission
import com.trippilot.notification.domain.PushMessage
import com.trippilot.notification.domain.PushPort
import com.trippilot.notification.domain.PushReceipt
import com.trippilot.notification.domain.PushStatus
import com.trippilot.notification.domain.PushToken
import com.trippilot.notification.domain.PushTokenRepository
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

/**
 * 삭제 유예 중인 계정에는 **어떤 종류도** 푸시하지 않는다 — 리마인드만이 아니라 Plan-B·숙소·회고 알림도 같은 발송 지점을 지난다.
 *
 * 푸시 토큰은 일부러 안 지운다(철회해도 앱이 같은 토큰을 다시 올리지 않을 수 있다) — 보내지 않는 것을 이 지점이 지킨다. 그래서 여기서 못 막으면
 * 탈퇴하겠다고 한 사람의 폰이 계속 울린다.
 */
class PushDispatchDeletionPendingTest : StringSpec({

    val acc = UUID.randomUUID()
    val clock: Clock = Clock.fixed(Instant.parse("2026-11-04T00:00:00Z"), ZoneOffset.UTC)

    val device = PushToken(
        pushTokenId = UUID.randomUUID(), accountId = acc, token = "ExponentPushToken[dev]", deviceId = null, platform = DevicePlatform.IOS,
        osPermission = OsPermission.GRANTED, lastSeenAt = Instant.EPOCH, invalidatedAt = null,
    )

    class Recording : PushPort {
        override val deliversExternally = true
        var sent = 0
        override fun send(tokens: List<String>, message: PushMessage): List<PushReceipt> {
            sent++
            return tokens.map { PushReceipt(it, PushStatus.SENT, ticketId = "T") }
        }
    }

    fun service(state: PendingDeletion, push: PushPort): PushDispatchService {
        val notifications = FakeNotifications()
        return PushDispatchService(
            object : PushTokenRepository {
                override fun register(token: PushToken) = token
                override fun findActive(accountId: UUID) = listOf(device).filter { it.accountId == accountId }
                override fun invalidate(token: String, at: Instant) = false
                override fun invalidateIfNotSeenSince(token: String, notSeenAfter: Instant, at: Instant) = false
                override fun remove(accountId: UUID, token: String) = false
            },
            notifications, NotificationToggleService(FakeToggles(), clock), push, testMetrics(notifications), PushRateLimits(), clock, FakeTickets(), state,
        )
    }

    NotificationKind.entries.forEach { kind ->
        "삭제 유예 중이면 $kind 알림도 푸시하지 않는다 — 기기가 있어도" {
            val push = Recording()

            val outcome = service(PendingDeletion(acc), push).dispatch(Notification.raise(acc, kind, "제목", "본문", clock.instant()))

            outcome shouldBe PushOutcome.MUTED
            push.sent shouldBe 0
        }
    }

    "철회하면(유예가 끝나면) 같은 계정에 다시 푸시한다 — 토큰을 지우지 않았으므로 앱이 다시 올릴 필요가 없다" {
        val state = PendingDeletion(acc)
        val push = Recording()
        val svc = service(state, push)
        val n = Notification.raise(acc, NotificationKind.TRIP_DAY, "제목", "본문", clock.instant())

        svc.dispatch(n) shouldBe PushOutcome.MUTED
        state.pending.clear()
        svc.dispatch(n) shouldBe PushOutcome.SENT

        push.sent shouldBe 1
    }

    "남의 계정은 막지 않는다" {
        val push = Recording()

        service(PendingDeletion(UUID.randomUUID()), push)
            .dispatch(Notification.raise(acc, NotificationKind.TRIP_DAY, "제목", "본문", clock.instant())) shouldBe PushOutcome.SENT
        push.sent shouldBe 1
    }
})
