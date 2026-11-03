package com.trippilot.notification.adapter.out.persistence

import com.trippilot.notification.domain.DevicePlatform
import com.trippilot.notification.domain.PushTicket
import com.trippilot.notification.domain.ReceiptStatus
import com.trippilot.notification.domain.PushTicketRepository
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component
import java.time.Instant
import java.util.UUID

/**
 * push_ticket 매핑(V2.89). JPA 가 아니라 네이티브인 이유는 **`ON CONFLICT DO NOTHING`** 이 이 쓰기의 계약이기 때문이다 —
 * 같은 티켓 id 가 두 번 와도(다중 인스턴스·재전달) 오류 없이 한 행이어야 하고, 오류가 나면 발송 트랜잭션이 통째로 죽는다.
 */
@Component
class PushTicketRepositoryAdapter(private val jdbc: JdbcTemplate) : PushTicketRepository {

    override fun record(tickets: List<PushTicket>) {
        if (tickets.isEmpty()) return
        jdbc.batchUpdate(
            """
            INSERT INTO push_ticket (ticket_id, notification_id, token, platform, sent_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (ticket_id) DO NOTHING
            """.trimIndent(),
            tickets,
            tickets.size,
        ) { ps, t ->
            ps.setString(1, t.ticketId)
            ps.setObject(2, t.notificationId)
            ps.setString(3, t.token)
            ps.setString(4, t.platform.name)
            ps.setTimestamp(5, java.sql.Timestamp.from(t.sentAt))
        }
    }

    override fun findDue(sentBefore: Instant, limit: Int): List<PushTicket> = jdbc.query(
        """
        SELECT ticket_id, notification_id, token, platform, sent_at
          FROM push_ticket
         WHERE checked_at IS NULL AND sent_at <= ?
         ORDER BY sent_at
         LIMIT ?
        """.trimIndent(),
        { rs, _ ->
            PushTicket(
                ticketId = rs.getString("ticket_id"),
                notificationId = rs.getObject("notification_id", UUID::class.java),
                token = rs.getString("token"),
                platform = DevicePlatform.valueOf(rs.getString("platform")),
                sentAt = rs.getTimestamp("sent_at").toInstant(),
            )
        },
        java.sql.Timestamp.from(sentBefore), limit,
    )

    // 조건부 쓰기 — 다른 인스턴스가 먼저 판정했으면 0 행이라 false. 부수효과는 true 를 받은 쪽만 낸다.
    override fun settle(ticketId: String, status: ReceiptStatus, error: String?, at: Instant): Boolean = jdbc.update(
        "UPDATE push_ticket SET checked_at = ?, receipt_status = ?, receipt_error = ? WHERE ticket_id = ? AND checked_at IS NULL",
        java.sql.Timestamp.from(at), status.name, error?.take(ERROR_MAX), ticketId,
    ) == 1

    override fun purgeSettledBefore(sentBefore: Instant): Int = jdbc.update(
        "DELETE FROM push_ticket WHERE checked_at IS NOT NULL AND sent_at < ?",
        java.sql.Timestamp.from(sentBefore),
    )

    override fun countPending(): Long =
        jdbc.queryForObject("SELECT count(*) FROM push_ticket WHERE checked_at IS NULL", Long::class.java) ?: 0L

    private companion object {
        /** `push_ticket.receipt_error` 컬럼 폭. */
        private const val ERROR_MAX = 64
    }
}
