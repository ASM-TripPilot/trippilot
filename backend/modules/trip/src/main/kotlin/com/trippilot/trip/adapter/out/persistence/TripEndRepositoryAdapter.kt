package com.trippilot.trip.adapter.out.persistence

import com.trippilot.trip.domain.TripEndRepository
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * `trip.ended_at` 조건부 쓰기(V2.37).
 *
 * JPA 대신 네이티브인 이유는 **조건을 UPDATE 문에 넣어야** 하기 때문이다 — 엔티티를 읽어 고치면
 * 읽고-검사-쓰기 사이가 벌어져 다중 인스턴스에서 같은 여행에 이벤트가 두 번 나간다.
 */
@Component
class TripEndRepositoryAdapter(private val jdbc: JdbcTemplate) : TripEndRepository {

    override fun findEndedButUnmarked(today: LocalDate, limit: Int): List<UUID> = jdbc.queryForList(
        """
        SELECT trip_id FROM trip
         WHERE end_date < ? AND ended_at IS NULL AND deleted_at IS NULL
         ORDER BY end_date
         LIMIT ?
        """.trimIndent(),
        UUID::class.java, today, limit,
    )

    override fun markEnded(tripId: UUID, at: Instant): Boolean = jdbc.update(
        "UPDATE trip SET ended_at = ? WHERE trip_id = ? AND ended_at IS NULL",
        java.sql.Timestamp.from(at), tripId,
    ) == 1
}
