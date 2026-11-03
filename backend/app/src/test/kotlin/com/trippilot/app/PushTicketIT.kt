package com.trippilot.app

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.notification.domain.DevicePlatform
import com.trippilot.notification.domain.Notification
import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.NotificationRepository
import com.trippilot.notification.domain.PushTicket
import com.trippilot.notification.domain.PushTicketRepository
import com.trippilot.notification.domain.ReceiptStatus
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate
import java.time.Instant
import java.util.UUID

/**
 * 푸시 티켓 기록 실 DB 검증(TRIP-1707 · V2.89).
 *
 * 여기서만 드러나는 것 — 인메모리 대역으로는 **원리적으로** 못 본다:
 * - **`ON CONFLICT (ticket_id) DO NOTHING`** — 같은 티켓이 두 번 와도 오류 없이 한 행. 이 INSERT 는 발송 트랜잭션 안이라 터지면
 *   발화가 롤백돼 다음 폴링이 같은 예약을 다시 집는다(Postgres 는 오류 뒤 트랜잭션을 abort 한다)
 * - **알림 삭제 CASCADE** — 알림이 지워지면 그 티켓도 간다(영수증 판정 대상이 사라진다)
 * - **판정 칼럼의 CHECK** — `checked_at` 과 `receipt_status` 는 함께 채워진다(반쪽 판정 거절)
 */
@SpringBootTest
class PushTicketIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var tickets: PushTicketRepository
    @Autowired private lateinit var notifications: NotificationRepository
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

    private val now = Instant.parse("2026-11-04T00:00:00Z")

    private fun newNotification(): UUID {
        val accountId = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)).id.value
        notifications.appendIfAbsent(Notification.raise(accountId, NotificationKind.TRIP_DAY, "제목", "본문", now))
        return notifications.findByAccount(accountId, unreadOnly = false, limit = 1).single().notificationId
    }

    private fun ticket(id: String, notificationId: UUID, platform: DevicePlatform = DevicePlatform.IOS) =
        PushTicket(id, notificationId, "ExponentPushToken[$id]", platform, now)

    private fun count(ticketId: String) =
        jdbc.queryForObject("SELECT count(*) FROM push_ticket WHERE ticket_id = ?", Int::class.java, ticketId)

    @Test
    fun `티켓을 기록하면 판정 전(checked_at NULL)으로 남고, 같은 티켓을 또 기록해도 오류 없이 한 행이다`() {
        val notificationId = newNotification()
        val id = "T-${UUID.randomUUID()}"

        tickets.record(listOf(ticket(id, notificationId), ticket("$id-b", notificationId, DevicePlatform.ANDROID)))
        tickets.record(listOf(ticket(id, notificationId)))   // 재전달·다중 인스턴스 — 터지면 발송 트랜잭션이 죽는다

        count(id) shouldBe 1
        jdbc.queryForObject(
            "SELECT platform FROM push_ticket WHERE ticket_id = ?", String::class.java, "$id-b",
        ) shouldBe "ANDROID"
        jdbc.queryForObject(
            "SELECT checked_at IS NULL AND receipt_status IS NULL FROM push_ticket WHERE ticket_id = ?", Boolean::class.java, id,
        ) shouldBe true
    }

    @Test
    fun `토큰에 FK 가 없다 — 토큰 행이 없어도 기록된다`() {
        // 영수증을 받을 때까지 남아야 하는 기록이라 토큰 행의 생사와 무관해야 한다(그리고 INSERT 가 실패할 수 없어야 한다).
        val notificationId = newNotification()
        val id = "T-${UUID.randomUUID()}"

        tickets.record(listOf(ticket(id, notificationId)))

        count(id) shouldBe 1
    }

    @Test
    fun `알림이 지워지면 그 티켓도 같이 지워진다`() {
        val notificationId = newNotification()
        val id = "T-${UUID.randomUUID()}"
        tickets.record(listOf(ticket(id, notificationId)))

        jdbc.update("DELETE FROM notification WHERE notification_id = ?", notificationId)

        count(id) shouldBe 0
    }

    @Test
    fun `판정 칼럼은 함께 채워진다 — 반쪽 판정은 거절된다`() {
        val notificationId = newNotification()
        val id = "T-${UUID.randomUUID()}"
        tickets.record(listOf(ticket(id, notificationId)))

        shouldThrow<DataIntegrityViolationException> {
            jdbc.update("UPDATE push_ticket SET checked_at = now() WHERE ticket_id = ?", id)
        }
        // 온전한 판정은 받는다.
        jdbc.update(
            "UPDATE push_ticket SET checked_at = now(), receipt_status = 'OK' WHERE ticket_id = ?", id,
        ) shouldBe 1
    }

    // ── 영수증 폴러가 쓰는 질의(V2.89) ──────────────────────────────────────

    private fun ticketAt(id: String, notificationId: UUID, sentAt: Instant) =
        PushTicket(id, notificationId, "ExponentPushToken[$id]", DevicePlatform.IOS, sentAt)

    @Test
    fun `폴러가 묻는 대상은 판정 전이고 기준보다 먼저 보낸 티켓이며 오래된 순이다`() {
        val notificationId = newNotification()
        val prefix = "T-${UUID.randomUUID()}"
        val old = ticketAt("$prefix-old", notificationId, now.minusSeconds(7_200))
        val mid = ticketAt("$prefix-mid", notificationId, now.minusSeconds(3_600))
        val fresh = ticketAt("$prefix-fresh", notificationId, now)           // 기준(now-15분)보다 나중에 보냈다
        val done = ticketAt("$prefix-done", notificationId, now.minusSeconds(5_000))
        tickets.record(listOf(mid, old, fresh, done))
        tickets.settle(done.ticketId, ReceiptStatus.OK, null, now) shouldBe true

        val due = tickets.findDue(now.minusSeconds(900), 1_000).filter { it.ticketId.startsWith(prefix) }

        due.map { it.ticketId } shouldBe listOf(old.ticketId, mid.ticketId)     // 판정된 것·너무 최근 것은 빠지고 오래된 순
        due.first().platform shouldBe DevicePlatform.IOS
    }

    @Test
    fun `판정은 조건부다 — 두 번째는 false 이고 처음 값이 남는다`() {
        val notificationId = newNotification()
        val t = ticketAt("T-${UUID.randomUUID()}", notificationId, now.minusSeconds(3_600))
        tickets.record(listOf(t))

        tickets.settle(t.ticketId, ReceiptStatus.ERROR, "DeviceNotRegistered", now) shouldBe true
        tickets.settle(t.ticketId, ReceiptStatus.OK, null, now.plusSeconds(60)) shouldBe false     // 다른 인스턴스가 먼저 판정했다

        jdbc.queryForObject(
            "SELECT receipt_status || ':' || receipt_error FROM push_ticket WHERE ticket_id = ?", String::class.java, t.ticketId,
        ) shouldBe "ERROR:DeviceNotRegistered"
        tickets.settle("없는-티켓", ReceiptStatus.OK, null, now) shouldBe false
    }

    @Test
    fun `보존 기간이 지난 판정 끝난 기록만 지우고 미판정은 남긴다`() {
        val notificationId = newNotification()
        val prefix = "T-${UUID.randomUUID()}"
        val oldDone = ticketAt("$prefix-olddone", notificationId, now.minusSeconds(9 * 86_400))
        val oldPending = ticketAt("$prefix-oldpending", notificationId, now.minusSeconds(9 * 86_400))
        val recentDone = ticketAt("$prefix-recentdone", notificationId, now.minusSeconds(86_400))
        tickets.record(listOf(oldDone, oldPending, recentDone))
        tickets.settle(oldDone.ticketId, ReceiptStatus.OK, null, now)
        tickets.settle(recentDone.ticketId, ReceiptStatus.OK, null, now)

        tickets.purgeSettledBefore(now.minusSeconds(7 * 86_400))

        count(oldDone.ticketId) shouldBe 0            // 판정 끝났고 오래됨 → 삭제
        count(oldPending.ticketId) shouldBe 1         // 미판정은 오래돼도 남긴다(곧 EXPIRED 로 닫힌다)
        count(recentDone.ticketId) shouldBe 1         // 판정은 끝났지만 최근 → 남긴다
    }

    @Test
    fun `미판정 건수는 판정하면 줄어든다`() {
        val notificationId = newNotification()
        val t = ticketAt("T-${UUID.randomUUID()}", notificationId, now)
        val before = tickets.countPending()
        tickets.record(listOf(t))

        tickets.countPending() shouldBe before + 1
        tickets.settle(t.ticketId, ReceiptStatus.OK, null, now)
        tickets.countPending() shouldBe before
    }
}
