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
}
