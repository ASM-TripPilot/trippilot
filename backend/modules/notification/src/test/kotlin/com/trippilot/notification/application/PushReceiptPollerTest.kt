package com.trippilot.notification.application

import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.trippilot.notification.domain.DevicePlatform
import com.trippilot.notification.domain.OsPermission
import com.trippilot.notification.domain.PushReceiptPort
import com.trippilot.notification.domain.PushTicket
import com.trippilot.notification.domain.PushToken
import com.trippilot.notification.domain.PushTokenRepository
import com.trippilot.notification.domain.ReceiptStatus
import com.trippilot.notification.domain.TicketReceipt
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.PropTestConfig
import io.kotest.property.arbitrary.boolean
import io.kotest.property.arbitrary.element
import io.kotest.property.arbitrary.long
import io.kotest.property.checkAll
import io.micrometer.core.instrument.simple.SimpleMeterRegistry
import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.web.client.HttpClientErrorException
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

/**
 * 영수증 폴러(TRIP-1707) — 발송 뒤 영수증으로 **도착 실패를 서버가 알게** 한다.
 *
 * 지키는 것:
 * 1. 오류의 **종류가 후속 처리를 정한다** — 죽은 토큰만 무효화하고, 프로젝트 자격 오류(.p8 누락 등)는 토큰을 건드리지 않고 경보한다.
 * 2. 다시 보인 토큰은 무효화하지 않는다(영수증은 15분 이상 뒤에 오고 그 사이 앱이 재등록했을 수 있다).
 * 3. 부수효과는 **판정한 쪽만** 낸다(다중 인스턴스).
 * 4. 영수증이 아직 없으면 두고, 24시간이 지나면 EXPIRED 로 닫는다.
 * 5. 조회 실패는 상태를 안 바꾸고 폴러를 죽이지 않는다.
 */
class PushReceiptPollerTest : StringSpec({

    val now = Instant.parse("2026-11-04T12:00:00Z")
    val clock: Clock = Clock.fixed(now, ZoneOffset.UTC)
    val acc = UUID.randomUUID()

    fun ticket(id: String, ageMin: Long, platform: DevicePlatform = DevicePlatform.IOS, token: String = "ExponentPushToken[$id]") =
        PushTicket(id, UUID.randomUUID(), token, platform, now.minus(Duration.ofMinutes(ageMin)))

    fun tokenRow(token: String, lastSeen: Instant) = PushToken(
        UUID.randomUUID(), acc, token, null, DevicePlatform.IOS, OsPermission.GRANTED, lastSeen, null,
    )

    class Receipts(private val script: (List<String>) -> Map<String, TicketReceipt>) : PushReceiptPort {
        val requests = mutableListOf<List<String>>()
        override fun fetch(ticketIds: List<String>): Map<String, TicketReceipt> {
            requests += ticketIds
            return script(ticketIds)
        }
    }

    /** 실 저장소와 같은 조건(`last_seen_at <= notSeenAfter` · 이미 무효면 false)을 흉내 내는 토큰 대역. */
    class Tokens(initial: List<PushToken>) : PushTokenRepository {
        val rows = initial.toMutableList()
        override fun register(token: PushToken) = token.also { rows += it }
        override fun findActive(accountId: UUID) = rows.filter { it.invalidatedAt == null }
        override fun invalidate(token: String, at: Instant) = false
        override fun invalidateIfNotSeenSince(token: String, notSeenAfter: Instant, at: Instant): Boolean {
            val i = rows.indexOfFirst { it.token == token && it.invalidatedAt == null && !it.lastSeenAt.isAfter(notSeenAfter) }
            if (i < 0) return false
            rows[i] = rows[i].copy(invalidatedAt = at)
            return true
        }
        override fun remove(accountId: UUID, token: String) = false
        override fun removeAll(accountId: UUID) = 0
        fun isInvalidated(token: String) = rows.single { it.token == token }.invalidatedAt != null
    }

    fun poller(tickets: FakeTickets, receipts: PushReceiptPort, tokens: Tokens, registry: SimpleMeterRegistry = SimpleMeterRegistry()) =
        PushReceiptPoller(tickets, receipts, tokens, NotificationMetrics(registry, FakeNotifications()), clock, minAgeMs = 15 * 60_000L)

    fun logsFrom(block: () -> Unit): List<ILoggingEvent> {
        val appender = ListAppender<ILoggingEvent>().apply { start() }
        val logger = LoggerFactory.getLogger(PushReceiptPoller::class.java) as Logger
        logger.addAppender(appender)
        try { block() } finally { logger.detachAppender(appender) }
        return appender.list.toList()
    }

    "ok 영수증은 OK 로 닫고 토큰은 건드리지 않는다" {
        val t = ticket("T1", ageMin = 20)
        val tickets = FakeTickets().apply { recorded += t }
        val tokens = Tokens(listOf(tokenRow(t.token, now.minusSeconds(3600))))
        val registry = SimpleMeterRegistry()

        poller(tickets, Receipts { ids -> ids.associateWith { TicketReceipt(true, null, null) } }, tokens, registry).poll()

        tickets.settled["T1"] shouldBe (ReceiptStatus.OK to null)
        tokens.isInvalidated(t.token) shouldBe false
        registry.find(NotificationMetrics.PUSH_RECEIPT).tag("outcome", "OK").tag("platform", "IOS").counter()!!.count() shouldBe 1.0
    }

    "죽은 토큰(DeviceNotRegistered)은 닫고 토큰을 무효화한다 — 그 발송 뒤로 다시 보이지 않았을 때" {
        val t = ticket("T1", ageMin = 20)
        val tickets = FakeTickets().apply { recorded += t }
        // 마지막으로 보인 것이 발송보다 앞이다 = 그 뒤로 재등록이 없었다.
        val tokens = Tokens(listOf(tokenRow(t.token, t.sentAt.minusSeconds(60))))

        poller(tickets, Receipts { ids -> ids.associateWith { TicketReceipt(false, "DeviceNotRegistered", "gone") } }, tokens).poll()

        tickets.settled["T1"] shouldBe (ReceiptStatus.ERROR to "DeviceNotRegistered")
        tokens.isInvalidated(t.token) shouldBe true
    }

    /** 영수증은 발송 15분 이상 뒤에 온다 — 그 사이 앱이 같은 토큰을 재등록했으면 살아 있는 기기다(앱은 같은 서명이면 다시 POST 하지 않아 한 번 잘못 죽이면 못 살린다). */
    "죽은 토큰이라 해도 발송 뒤에 다시 보인 토큰은 무효화하지 않는다" {
        val t = ticket("T1", ageMin = 20)
        val tickets = FakeTickets().apply { recorded += t }
        val tokens = Tokens(listOf(tokenRow(t.token, t.sentAt.plusSeconds(300))))

        poller(tickets, Receipts { ids -> ids.associateWith { TicketReceipt(false, "DeviceNotRegistered", null) } }, tokens).poll()

        tickets.settled["T1"] shouldBe (ReceiptStatus.ERROR to "DeviceNotRegistered")   // 판정은 하되
        tokens.isInvalidated(t.token) shouldBe false                                      // 토큰은 남긴다
    }

    /**
     * **프로젝트 자격 오류는 토큰 탓이 아니다.** .p8·FCM 키가 틀렸는데 토큰을 무효화하면 살아 있는 기기를 전부 죽이고도 원인은 그대로다.
     * 무효화하지 않고 경보(`push.alert`, ERROR)로 올린다.
     */
    "프로젝트 자격 오류는 토큰을 건드리지 않고 push.alert 로 경보한다" {
        listOf("InvalidCredentials", "MismatchSenderId").forEach { code ->
            val t = ticket("T-$code", ageMin = 20)
            val tickets = FakeTickets().apply { recorded += t }
            val tokens = Tokens(listOf(tokenRow(t.token, t.sentAt.minusSeconds(60))))

            val logs = logsFrom {
                poller(tickets, Receipts { ids -> ids.associateWith { TicketReceipt(false, code, "secret detail") } }, tokens).poll()
            }

            tickets.settled[t.ticketId] shouldBe (ReceiptStatus.ERROR to code)
            tokens.isInvalidated(t.token) shouldBe false
            val alert = logs.single { it.level == Level.ERROR }
            alert.formattedMessage shouldBe "push.alert stage=receipt reason=$code platform=IOS ageMin=20"
            // 토큰·원문 message 를 싣지 않는다.
            logs.none { "ExponentPushToken" in it.formattedMessage || "secret detail" in it.formattedMessage } shouldBe true
        }
    }

    "영수증이 아직 없으면 두고, 24시간이 지났으면 EXPIRED 로 닫는다" {
        val young = ticket("young", ageMin = 30)
        val old = ticket("old", ageMin = 25 * 60)
        val tickets = FakeTickets().apply { recorded += listOf(young, old) }
        val tokens = Tokens(emptyList())

        poller(tickets, Receipts { emptyMap() }, tokens).poll()

        tickets.settled.containsKey("young") shouldBe false                    // 다음 회차에 다시 묻는다
        tickets.settled["old"] shouldBe (ReceiptStatus.EXPIRED to null)
    }

    "발송 15분이 안 된 티켓은 묻지 않는다" {
        val tickets = FakeTickets().apply { recorded += ticket("fresh", ageMin = 5) }
        val receipts = Receipts { emptyMap() }

        poller(tickets, receipts, Tokens(emptyList())).poll()

        receipts.requests shouldBe emptyList()
    }

    "조회가 실패하면 상태를 바꾸지 않고 폴러를 죽이지 않는다" {
        val tickets = FakeTickets().apply { recorded += ticket("T1", ageMin = 20) }

        poller(tickets, Receipts { throw IllegalStateException("network") }, Tokens(emptyList())).poll()

        tickets.settled shouldBe emptyMap()
    }

    "영수증 조회가 401·403 으로 거절되면 push.alert 로 경보한다" {
        val tickets = FakeTickets().apply { recorded += ticket("T1", ageMin = 20) }

        val logs = logsFrom {
            poller(tickets, Receipts { throw HttpClientErrorException(HttpStatus.UNAUTHORIZED) }, Tokens(emptyList())).poll()
        }

        tickets.settled shouldBe emptyMap()
        logs.any { it.level == Level.ERROR && it.formattedMessage.startsWith("push.alert stage=receipt reason=HTTP_401") } shouldBe true
    }

    "한 요청에 100건씩 묻고, 한 회차는 최대 10요청이다" {
        val tickets = FakeTickets().apply { recorded += (1..1_050).map { ticket("T$it", ageMin = 20) } }
        val receipts = Receipts { ids -> ids.associateWith { TicketReceipt(true, null, null) } }

        poller(tickets, receipts, Tokens(emptyList())).poll()

        receipts.requests.map { it.size } shouldBe List(10) { 100 }
        tickets.countPending() shouldBe 50L        // 남은 건 다음 회차(5분 뒤)에
    }

    /** 두 인스턴스가 같은 영수증을 받아도 **판정은 하나만** 성공하고 부수효과도 한 번이다. */
    "같은 영수증을 두 번 처리해도 부수효과는 한 번이다" {
        val t = ticket("T1", ageMin = 20)
        val tickets = FakeTickets().apply { recorded += t }
        val registry = SimpleMeterRegistry()
        val tokens = Tokens(listOf(tokenRow(t.token, t.sentAt.minusSeconds(60))))
        // 첫 인스턴스가 조회하는 사이에 다른 인스턴스가 이미 판정을 끝냈다.
        val racing = Receipts { ids ->
            tickets.settle("T1", ReceiptStatus.ERROR, "DeviceNotRegistered", now)
            ids.associateWith { TicketReceipt(false, "DeviceNotRegistered", null) }
        }

        poller(tickets, racing, tokens, registry).poll()

        registry.find(NotificationMetrics.PUSH_RECEIPT).counters().sumOf { it.count() } shouldBe 0.0   // 진 쪽은 세지 않는다
        tokens.isInvalidated(t.token) shouldBe false                                                     // 진 쪽은 무효화도 안 한다
    }

    "판정이 끝난 오래된(7일) 기록은 지우고, 이번 회차에 닫힌 최근 기록은 남긴다" {
        val tickets = FakeTickets().apply { recorded += ticket("done", ageMin = 8 * 24 * 60) }
        tickets.settled["done"] = ReceiptStatus.OK to null
        tickets.recorded += ticket("just-expired", ageMin = 30 * 60)         // 30시간 — 이번 회차에 EXPIRED 로 닫히지만 7일 전은 아니다

        poller(tickets, Receipts { emptyMap() }, Tokens(emptyList())).poll()

        tickets.recorded.map { it.ticketId } shouldBe listOf("just-expired")
        tickets.settled["just-expired"] shouldBe (ReceiptStatus.EXPIRED to null)
    }

    // ── 판정 규칙(순수 함수) ───────────────────────────────────────────

    "어떤 영수증·나이 조합도 하나의 결정으로 수렴한다 — 없으면 Keep/Expired(24시간 경계), 있으면 ok/오류 종류" {
        val codes = listOf("DeviceNotRegistered", "InvalidCredentials", "MismatchSenderId", "MessageRateExceeded", "MessageTooBig", "Whatever", null, "")
        checkAll(PropTestConfig(iterations = 200), Arb.boolean(), Arb.element(codes), Arb.long(0L..72L * 3_600L)) { present, code, ageSec ->
            val age = Duration.ofSeconds(ageSec)
            val expiry = Duration.ofHours(24)
            val receipt = if (present) TicketReceipt(ok = code == null, error = code, message = null) else null

            val decision = decideReceipt(receipt, age, expiry)

            when {
                receipt == null -> decision shouldBe (if (age >= expiry) ReceiptDecision.Expired else ReceiptDecision.Keep)
                receipt.ok -> decision shouldBe ReceiptDecision.Ok
                else -> {
                    val err = decision as ReceiptDecision.Error
                    err.code shouldBe (code?.takeIf { it.isNotBlank() } ?: "UNKNOWN")
                    // 토큰 문제와 프로젝트 문제는 겹치지 않는다 — 자격 오류가 DEAD_TOKEN 이 되면 살아 있는 기기를 죽인다.
                    (err.kind == ErrorKind.DEAD_TOKEN) shouldBe (err.code == "DeviceNotRegistered")
                    (err.kind == ErrorKind.PROJECT_CREDENTIALS) shouldBe (err.code in setOf("InvalidCredentials", "MismatchSenderId"))
                }
            }
        }
    }
})
