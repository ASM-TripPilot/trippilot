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
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldContainExactlyInAnyOrder
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.property.Arb
import io.kotest.property.PropTestConfig
import io.kotest.property.arbitrary.enum
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.boolean
import io.kotest.property.checkAll
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

/**
 * 푸시 채널 판정과 죽은 토큰 처리(INV-U6-02 · 06 · 07 · BR-U6-38).
 *
 * 성질로 쓰는 이유는 조합이 곱해지기 때문이다 — 기기 수 × OS 권한 × 무효화 여부 × 토글 × 발송 결과.
 * 손으로 고른 예시는 반드시 성기고, **틀린 결과가 조용하다**: 알림이 안 왔는데 오류도 로그도 없다.
 */
class PushDispatchPropertyTest : StringSpec({

    val acc = UUID.randomUUID()
    val clock: Clock = Clock.fixed(Instant.parse("2026-08-14T12:00:00Z"), ZoneOffset.UTC)

    class Tokens(initial: List<PushToken> = emptyList()) : PushTokenRepository {
        val rows = initial.toMutableList()
        val invalidated = mutableListOf<String>()
        override fun register(token: PushToken) = token.also { rows += it }
        override fun findActive(accountId: UUID) =
            rows.filter { it.accountId == accountId && it.invalidatedAt == null }
        override fun invalidate(token: String, at: Instant): Boolean {
            val i = rows.indexOfFirst { it.token == token && it.invalidatedAt == null }
            if (i < 0) return false
            rows[i] = rows[i].copy(invalidatedAt = at)
            invalidated += token
            return true
        }
        override fun remove(accountId: UUID, token: String) = rows.removeIf { it.token == token }
    }

    class Notifications : NotificationRepository {
        val appended = mutableListOf<Notification>()
        val pushResults = mutableListOf<Triple<UUID, Instant?, String?>>()
        override fun appendIfAbsent(notification: Notification) = true.also { appended += notification }
        override fun findByAccount(accountId: UUID, unreadOnly: Boolean, limit: Int) = appended.toList()
        override fun markRead(accountId: UUID, notificationId: UUID, at: Instant) = true
        override fun exists(accountId: UUID, notificationId: UUID) = true
        override fun markPushResult(notificationId: UUID, sentAt: Instant?, failedReason: String?) {
            pushResults += Triple(notificationId, sentAt, failedReason)
        }
    }

    class Toggles(private val push: Boolean) : NotificationToggleRepository {
        override fun findByAccount(accountId: UUID) = NotificationToggle.TOGGLEABLE.map {
            NotificationToggle(accountId, it, pushEnabled = push, inAppEnabled = true, updatedAt = Instant.EPOCH)
        }
        override fun upsert(toggle: NotificationToggle) = toggle
    }

    /** 토큰마다 결과를 정해 주는 발송기. 호출된 토큰 목록을 남겨 "전부에 보냈나"를 볼 수 있게 한다. */
    class Sender(private val outcome: (String) -> PushStatus = { PushStatus.SENT }) : PushPort {
        val calls = mutableListOf<List<String>>()
        override fun send(tokens: List<String>, message: PushMessage): List<PushReceipt> {
            calls += tokens
            return tokens.map { PushReceipt(it, outcome(it), if (outcome(it) == PushStatus.SENT) null else outcome(it).name) }
        }
    }

    fun token(deliverable: Boolean, invalidated: Boolean = false) = PushToken(
        pushTokenId = UUID.randomUUID(), accountId = acc, token = "ExponentPushToken[${UUID.randomUUID()}]",
        deviceId = null, platform = DevicePlatform.IOS,
        osPermission = if (deliverable) OsPermission.GRANTED else OsPermission.DENIED,
        lastSeenAt = Instant.EPOCH, invalidatedAt = if (invalidated) Instant.EPOCH else null,
    )

    fun notification(kind: NotificationKind = NotificationKind.TRIP_DAY) =
        Notification.raise(acc, kind, "제목", "본문", clock.instant())

    fun serviceOf(tokens: Tokens, sender: PushPort, notifications: Notifications, pushOn: Boolean = true) =
        PushDispatchService(tokens, notifications, NotificationToggleService(Toggles(pushOn), clock), sender, clock)

    "INV-U6-06 쏠 수 있는 기기 전부에 보낸다 — 하나만 울리면 다른 기기를 보던 사용자가 놓친다" {
        checkAll(PropTestConfig(iterations = 40), Arb.list(Arb.boolean(), 0..5), Arb.list(Arb.boolean(), 0..3)) { live, dead ->
            val rows = live.map { token(deliverable = it) } + dead.map { token(deliverable = true, invalidated = true) }
            val tokens = Tokens(rows)
            val sender = Sender()
            val expected = rows.filter { it.deliverable }.map { it.token }

            val outcome = serviceOf(tokens, sender, Notifications()).dispatch(notification())

            if (expected.isEmpty()) {
                outcome shouldBe PushOutcome.NO_DEVICE
                // 후보가 없으면 **호출 자체를 하지 않는다** — 레이트리밋을 아낀다.
                sender.calls.shouldBeEmpty()
            } else {
                outcome shouldBe PushOutcome.SENT
                sender.calls.single() shouldContainExactlyInAnyOrder expected
            }
        }
    }

    "INV-U6-07 DeviceNotRegistered 는 즉시 무효화된다 — 그 토큰만" {
        val doomed = token(deliverable = true)
        val fine = token(deliverable = true)
        val tokens = Tokens(listOf(doomed, fine))
        val sender = Sender { if (it == doomed.token) PushStatus.DEVICE_NOT_REGISTERED else PushStatus.SENT }

        val outcome = serviceOf(tokens, sender, Notifications()).dispatch(notification())

        tokens.invalidated shouldContainExactlyInAnyOrder listOf(doomed.token)
        // 하나가 죽었어도 나머지에는 갔다 — 한 기기의 실패가 다른 기기를 취소하지 않는다.
        outcome shouldBe PushOutcome.SENT
        tokens.findActive(acc).map { it.token } shouldContainExactlyInAnyOrder listOf(fine.token)
    }

    "죽은 토큰만 있으면 실패로 남기되 알림은 그대로다(BR-U6-38 · INV-U6-02)" {
        val tokens = Tokens(listOf(token(deliverable = true)))
        val notifications = Notifications()

        val n = notification()
        val outcome = serviceOf(tokens, Sender { PushStatus.DEVICE_NOT_REGISTERED }, notifications).dispatch(n)

        outcome shouldBe PushOutcome.FAILED
        // 사유를 남긴다 — 조용히 지나가면 "왜 푸시가 안 왔나"에 답할 근거가 없다.
        val (id, sentAt, reason) = notifications.pushResults.single()
        id shouldBe n.notificationId
        sentAt shouldBe null
        reason shouldNotBe null
    }

    "발송기가 통째로 터져도 예외를 올리지 않는다 — 알림함에는 이미 있다" {
        val tokens = Tokens(listOf(token(deliverable = true)))
        val notifications = Notifications()
        val broken = object : PushPort {
            override fun send(tokens: List<String>, message: PushMessage): List<PushReceipt> = error("네트워크 없음")
        }

        val outcome = serviceOf(tokens, broken, notifications).dispatch(notification())

        outcome shouldBe PushOutcome.FAILED
        notifications.pushResults.single().third shouldNotBe null
    }

    "푸시를 끈 종류는 시도조차 하지 않는다 — 인앱함에는 남는다(BR-U6-36)" {
        val tokens = Tokens(listOf(token(deliverable = true)))
        val sender = Sender()

        val outcome = serviceOf(tokens, sender, Notifications(), pushOn = false).dispatch(notification())

        outcome shouldBe PushOutcome.MUTED
        sender.calls.shouldBeEmpty()
    }

    "SYSTEM 은 토글과 무관하게 나간다(INV-U6-03)" {
        val tokens = Tokens(listOf(token(deliverable = true)))
        val sender = Sender()

        val outcome = serviceOf(tokens, sender, Notifications(), pushOn = false)
            .dispatch(notification(NotificationKind.SYSTEM))

        outcome shouldBe PushOutcome.SENT
        sender.calls.single().size shouldBe 1
    }

    "OS 권한이 없으면 그 기기에는 쏘지 않는다 — 쏴도 닿지 않는다" {
        checkAll(PropTestConfig(iterations = 20), Arb.enum<OsPermission>()) { permission ->
            val row = token(deliverable = true).copy(osPermission = permission)
            val sender = Sender()

            val outcome = serviceOf(Tokens(listOf(row)), sender, Notifications()).dispatch(notification())

            if (permission == OsPermission.GRANTED) outcome shouldBe PushOutcome.SENT
            else {
                outcome shouldBe PushOutcome.NO_DEVICE
                sender.calls.shouldBeEmpty()
            }
        }
    }
})
