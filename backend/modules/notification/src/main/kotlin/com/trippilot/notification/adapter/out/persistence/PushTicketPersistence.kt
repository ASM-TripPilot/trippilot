package com.trippilot.notification.adapter.out.persistence

import com.trippilot.notification.domain.PushTicket
import com.trippilot.notification.domain.PushTicketRepository
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component

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
}
