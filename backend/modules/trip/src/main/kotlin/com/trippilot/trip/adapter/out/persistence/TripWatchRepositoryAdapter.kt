package com.trippilot.trip.adapter.out.persistence

import com.trippilot.trip.api.WatchedTrip
import com.trippilot.trip.domain.TripWatchRepository
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component
import java.time.LocalDate
import java.util.UUID

/**
 * 감시 대상 여행 조회 — 네 열만 읽는 네이티브 질의(`TripEndRepositoryAdapter` 와 같은 관례).
 *
 * 술어 `ended_at IS NULL AND deleted_at IS NULL` 은 부분 인덱스 `ix_trip_pending_end`(V2.37)와 같은 집합이다.
 * `after` 는 **타입을 박는다**(`CAST(? AS uuid)`) — 첫 페이지의 널 파라미터는 PG 가 타입을 추론하지 못해
 * `? IS NULL` 만으로는 "could not determine data type of parameter" 로 실패한다.
 */
@Component
class TripWatchRepositoryAdapter(private val jdbc: JdbcTemplate) : TripWatchRepository {

    override fun findOverlapping(from: LocalDate, to: LocalDate, after: UUID?, limit: Int): List<WatchedTrip> = jdbc.query(
        """
        SELECT trip_id, account_id, start_date, end_date FROM trip
         WHERE end_date >= ? AND start_date <= ?
           AND ended_at IS NULL AND deleted_at IS NULL
           AND (CAST(? AS uuid) IS NULL OR trip_id > CAST(? AS uuid))
         ORDER BY trip_id
         LIMIT ?
        """.trimIndent(),
        { rs, _ ->
            WatchedTrip(
                rs.getObject("trip_id", UUID::class.java),
                rs.getObject("account_id", UUID::class.java),
                rs.getObject("start_date", LocalDate::class.java),
                rs.getObject("end_date", LocalDate::class.java),
            )
        },
        from, to, after, after, limit,
    )
}
