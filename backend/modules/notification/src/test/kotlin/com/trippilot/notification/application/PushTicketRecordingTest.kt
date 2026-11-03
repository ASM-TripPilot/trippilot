package com.trippilot.notification.application

import com.trippilot.notification.domain.DevicePlatform
import com.trippilot.notification.domain.Notification
import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.OsPermission
import com.trippilot.notification.domain.PushMessage
import com.trippilot.notification.domain.PushPort
import com.trippilot.notification.domain.PushReceipt
import com.trippilot.notification.domain.PushStatus
import com.trippilot.notification.domain.PushTicket
import com.trippilot.notification.domain.PushToken
import com.trippilot.notification.domain.PushTokenRepository
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

/**
 * 발송이 받은 **티켓 id 를 남기는가**(TRIP-1707). 접수(SENT)와 도착은 다르고, 도착 실패는 15분 뒤 영수증을 이 id 로 조회해야 안다.
 *
 * 지키는 것: (1) 접수된(`SENT` + id) 티켓만, 그 토큰의 **플랫폼과 함께** 남긴다. (2) 실패·id 없음·컬럼 폭 초과는 안 남긴다 — INSERT 가 터지면
 * 발송 트랜잭션이 죽는다. (3) **저장소가 터져도 발송 결과는 그대로다**(알림은 이미 알림함에 있고 푸시는 나갔다).
 */
class PushTicketRecordingTest : StringSpec({

    val acc = UUID.randomUUID()
    val clock: Clock = Clock.fixed(Instant.parse("2026-11-04T00:00:00Z"), ZoneOffset.UTC)

    fun token(value: String, platform: DevicePlatform) = PushToken(
        pushTokenId = UUID.randomUUID(), accountId = acc, token = value, deviceId = null, platform = platform,
        osPermission = OsPermission.GRANTED, lastSeenAt = Instant.EPOCH, invalidatedAt = null,
    )

    fun notification() = Notification.raise(acc, NotificationKind.TRIP_DAY, "제목", "본문", clock.instant())

    /** 토큰마다 정해 둔 영수증을 돌려주는 발송기. */
    fun sender(vararg answers: Pair<String, PushReceipt>) = object : PushPort {
        override val deliversExternally = true
        private val byToken = answers.toMap()
        override fun send(tokens: List<String>, message: PushMessage) = tokens.map { byToken.getValue(it) }
    }

    fun service(tokens: List<PushToken>, push: PushPort, tickets: FakeTickets): PushDispatchService {
        val notifications = FakeNotifications()
        return PushDispatchService(
            OwnedTokens(tokens), notifications, NotificationToggleService(FakeToggles(), clock), push,
            testMetrics(notifications), PushRateLimits(), clock, tickets,
        )
    }

    "접수된 티켓만 그 토큰의 플랫폼과 함께 남긴다 — 실패·id 없음은 안 남긴다" {
        val ios = token("ExponentPushToken[ios]", DevicePlatform.IOS)
        val android = token("ExponentPushToken[and]", DevicePlatform.ANDROID)
        val dead = token("ExponentPushToken[dead]", DevicePlatform.IOS)
        val noId = token("ExponentPushToken[noid]", DevicePlatform.IOS)
        val tickets = FakeTickets()
        val notification = notification()

        val outcome = service(
            listOf(ios, android, dead, noId),
            sender(
                ios.token to PushReceipt(ios.token, PushStatus.SENT, ticketId = "T-IOS"),
                android.token to PushReceipt(android.token, PushStatus.SENT, ticketId = "T-AND"),
                dead.token to PushReceipt(dead.token, PushStatus.DEVICE_NOT_REGISTERED, "DeviceNotRegistered"),
                noId.token to PushReceipt(noId.token, PushStatus.SENT),
            ),
            tickets,
        ).dispatch(notification)

        outcome shouldBe PushOutcome.SENT
        tickets.recorded.map { Triple(it.ticketId, it.token, it.platform) }.toSet() shouldBe setOf(
            Triple("T-IOS", ios.token, DevicePlatform.IOS),
            Triple("T-AND", android.token, DevicePlatform.ANDROID),
        )
        tickets.recorded.all { it.notificationId == notification.notificationId && it.sentAt == clock.instant() } shouldBe true
    }

    /** 컬럼 폭을 넘는 id 는 남기지 않는다 — INSERT 가 터지면 발송 트랜잭션이 통째로 죽는다(Postgres 는 오류 뒤 트랜잭션을 abort 한다). */
    "컬럼 폭을 넘는 티켓 id 는 남기지 않는다" {
        val t = token("ExponentPushToken[x]", DevicePlatform.IOS)
        val tickets = FakeTickets()

        service(
            listOf(t),
            sender(t.token to PushReceipt(t.token, PushStatus.SENT, ticketId = "x".repeat(PushTicket.TICKET_ID_MAX + 1))),
            tickets,
        ).dispatch(notification()) shouldBe PushOutcome.SENT

        tickets.recorded shouldBe emptyList()
    }

    "저장소가 터져도 발송 결과는 그대로다 — 티켓을 못 남기면 영수증 확인에서 빠질 뿐이다" {
        val t = token("ExponentPushToken[x]", DevicePlatform.IOS)
        val tickets = FakeTickets().apply { failWith = IllegalStateException("db down") }

        service(
            listOf(t),
            sender(t.token to PushReceipt(t.token, PushStatus.SENT, ticketId = "T-1")),
            tickets,
        ).dispatch(notification()) shouldBe PushOutcome.SENT
    }

    "기록만 하는 발송기(티켓 id 없음)는 아무것도 남기지 않는다" {
        val t = token("ExponentPushToken[x]", DevicePlatform.IOS)
        val tickets = FakeTickets()

        service(listOf(t), sender(t.token to PushReceipt(t.token, PushStatus.SENT)), tickets).dispatch(notification())

        tickets.recorded shouldBe emptyList()
    }
})

/** 계정의 활성 토큰만 돌려주는 대역 — 이 테스트가 보는 것은 발송 뒤 티켓 기록이다. */
private class OwnedTokens(private val rows: List<PushToken>) : PushTokenRepository {
    override fun register(token: PushToken) = token
    override fun findActive(accountId: UUID) = rows.filter { it.accountId == accountId && it.invalidatedAt == null }
    override fun invalidate(token: String, at: Instant) = false
    override fun invalidateIfNotSeenSince(token: String, notSeenAfter: Instant, at: Instant) = false
    override fun remove(accountId: UUID, token: String) = false
}
