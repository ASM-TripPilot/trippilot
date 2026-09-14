package com.trippilot.notification.application

import com.trippilot.notification.domain.DevicePlatform
import com.trippilot.notification.domain.Notification
import com.trippilot.notification.domain.PushedCounts
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
import io.kotest.property.arbitrary.int
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

        /**
         * 발송량 상한 판정용(COST-U6-01). 대역은 **푸시가 나간 것으로 표시된** 행만 센다 —
         * 창 계산은 실 DB 가 하므로 여기서는 시각 비교만 흉내 낸다.
         */
        override fun countPushed(accountId: UUID, hourFrom: Instant, dayFrom: Instant): PushedCounts {
            val mine = appended.filter { it.accountId == accountId && it.pushSentAt != null }
            return PushedCounts(
                inHour = mine.count { it.pushSentAt!! >= hourFrom }.toLong(),
                inDay = mine.count { it.pushSentAt!! >= dayFrom }.toLong(),
            )
        }

        /** 관측 전용(OBS-U6-04) — 이 테스트는 값을 보지 않는다. */
        override fun countUnread(): Long = appended.count { it.readAt == null }.toLong()
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
        override val deliversExternally = true

        val calls = mutableListOf<List<String>>()

        /** 나간 메시지 자체를 붙든다 — 긴급도가 실제로 실렸는지는 본문을 봐야 안다. */
        val messages = mutableListOf<PushMessage>()

        override fun send(tokens: List<String>, message: PushMessage): List<PushReceipt> {
            calls += tokens
            messages += message
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
        PushDispatchService(tokens, notifications, NotificationToggleService(Toggles(pushOn), clock), sender, testMetrics(notifications), PushRateLimits(), clock)

    /**
     * **"보냈다"와 "보낸 척했다"를 지표가 가른다**(TRIP-834).
     *
     * 기본 발송기는 아무 데도 안 보내면서 성공을 보고한다 — 그 판단 자체는 옳다(실패로 보고하면
     * 진짜 실패가 묻힌다). 문제는 그 상태에서 발송 지표가 **"성공률 100%"** 를 그린다는 것이고,
     * 운영에서 그 그래프를 보면 푸시가 잘 나가고 있다고 읽는다. 태그가 그 오독을 막는다.
     */
    "미발송 모드의 성공은 delivery=none 으로 갈린다" {
        val registry = io.micrometer.core.instrument.simple.SimpleMeterRegistry()
        val notifications = Notifications()
        val notSending = object : PushPort {
            override val deliversExternally = false
            override fun send(tokens: List<String>, message: PushMessage) =
                tokens.map { PushReceipt(it, PushStatus.SENT) }
        }
        val svc = PushDispatchService(
            Tokens(listOf(token(deliverable = true))), notifications,
            NotificationToggleService(Toggles(true), clock), notSending,
            NotificationMetrics(registry, notifications), PushRateLimits(), clock,
        )

        svc.dispatch(notification()) shouldBe PushOutcome.SENT

        registry.counter(
            NotificationMetrics.PUSH_DISPATCH,
            "outcome", "SENT", "reason", "none", "delivery", NotificationMetrics.DELIVERY_NONE,
        ).count() shouldBe 1.0
        // 실발송 태그로는 세지 않는다 — 두 값이 섞이면 가르는 의미가 없다.
        registry.counter(
            NotificationMetrics.PUSH_DISPATCH,
            "outcome", "SENT", "reason", "none", "delivery", NotificationMetrics.DELIVERY_REAL,
        ).count() shouldBe 0.0
    }

    /**
     * **발송량 소프트 상한**(COST-U6-01). 막지 못하면 버그 하나로 한 계정이 폭주하고, Expo 무료
     * 티어는 레이트리밋이 **계정 단위**라 그 계정 전체 발송이 죽는다.
     */
    "시간 상한을 넘기면 푸시를 생략한다 — 발송 시도 자체를 하지 않는다" {
        val notifications = Notifications()
        // 이미 10건이 나간 상태를 만든다(기본 상한 = 시간 10건).
        repeat(10) { notifications.appended += notification().copy(pushSentAt = clock.instant()) }
        val sender = Sender()
        val svc = serviceOf(Tokens(listOf(token(deliverable = true))), sender, notifications)

        val outcome = svc.dispatch(notification())

        outcome shouldBe PushOutcome.RATE_LIMITED
        // 레이트리밋을 아끼는 것이 목적이므로 **부르지 않는 것**까지가 요구다.
        sender.calls.shouldBeEmpty()
    }

    "상한 아래면 평소대로 나간다 — 상한이 늘 물려 있으면 기능이 죽은 것과 같다" {
        val notifications = Notifications()
        repeat(9) { notifications.appended += notification().copy(pushSentAt = clock.instant()) }
        val sender = Sender()
        val svc = serviceOf(Tokens(listOf(token(deliverable = true))), sender, notifications)

        svc.dispatch(notification()) shouldBe PushOutcome.SENT
    }

    /**
     * **불변식**: 상한은 푸시만 생략한다(COST-U6-02). 이미 나간 건수가 몇이든 **알림함 행은
     * 건드리지 않는다** — 버리면 catch-up 으로도 못 받아 사용자에게 알림이 사라진다.
     */
    "이미 나간 건수가 얼마든 알림함 행은 그대로다" {
        checkAll(Arb.int(0..60)) { already ->
            val notifications = Notifications()
            repeat(already) { notifications.appended += notification().copy(pushSentAt = clock.instant()) }
            val before = notifications.appended.size
            val svc = serviceOf(Tokens(listOf(token(deliverable = true))), Sender(), notifications)

            svc.dispatch(notification())

            notifications.appended.size shouldBe before // 지우지도, 되돌리지도 않는다
        }
    }

    /**
     * **계측이 실제로 배선돼 있는가**(OBS-U6-02). 지표 클래스만 테스트하면 호출을 통째로 지워도
     * 아무것도 안 깨진다 — 그러면 지표는 영원히 0 이고 아무도 모른다.
     */
    "발송 결과가 지표로 흘러간다 — 계측이 호출 경로에 실제로 걸려 있다" {
        val registry = io.micrometer.core.instrument.simple.SimpleMeterRegistry()
        val notifications = Notifications()
        val svc = PushDispatchService(
            Tokens(), notifications, NotificationToggleService(Toggles(true), clock),
            object : PushPort {
                override val deliversExternally = true
                override fun send(tokens: List<String>, message: com.trippilot.notification.domain.PushMessage) =
                    emptyList<com.trippilot.notification.domain.PushReceipt>()
            },
            NotificationMetrics(registry, notifications), PushRateLimits(), clock,
        )

        svc.dispatch(notification())

        // 쏠 기기가 없는 경로(NO_DEVICE)도 세어야 한다 — "안 갔다"의 사유가 지표에서 갈려야 한다.
        registry.find(NotificationMetrics.PUSH_DISPATCH).counters().sumOf { it.count() } shouldBe 1.0
    }

    /**
     * 발송 지점이 **종류의 긴급도를 그대로 싣는가**.
     *
     * 타입만으로는 부족하다 — 아무 값이나 넣어도 컴파일된다. 역검증에서 이 배선을 지웠을 때
     * 처음엔 아무 테스트도 안 깨졌다(당시 기본값이 있었다). 기본값을 없애 컴파일로 막았고,
     * **어느 값을 싣는지**는 이 단정이 지킨다.
     */
    "발송 본문의 긴급도는 알림 종류가 정한다" {
        NotificationKind.entries.forEach { kind ->
            val sender = Sender()
            val tokens = Tokens(listOf(token(deliverable = true)))
            serviceOf(tokens, sender, Notifications()).dispatch(notification(kind))

            sender.messages.single().urgency shouldBe kind.urgency
        }
    }

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
            override val deliversExternally = true
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
