package com.trippilot.itinerarygeneration.adapter.out.persistence

import com.trippilot.itinerarygeneration.domain.RejectedPoi
import com.trippilot.itinerarygeneration.domain.RejectionStore
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Repository
import java.util.UUID

/**
 * `trip_poi_rejection`(V2.53) — upsert 로 횟수를 누적한다.
 *
 * JPA 가 아니라 JdbcTemplate 인 이유: 판정(있나)과 증가(count+1)를 **한 문장**으로 묶는 것이
 * `ON CONFLICT` 뿐이다(NotificationPersistence 선례). JPA 로 하면 읽고-검사-쓰기 사이에
 * 다른 트랜잭션이 끼어 같은 거절이 행 둘로 갈라질 수 있다.
 */
@Repository
class RejectionStorePersistence(private val jdbc: JdbcTemplate) : RejectionStore {

    override fun record(tripId: UUID, poiIds: Collection<UUID>, kind: RejectedPoi.Kind) {
        if (poiIds.isEmpty()) return
        // 같은 편집에서 중복 POI 가 와도 한 번만 센다 — 한 행위 = 거절 1회.
        poiIds.distinct().forEach { poiId ->
            jdbc.update(
                """
                INSERT INTO trip_poi_rejection (trip_id, poi_id, kind, count, updated_at)
                VALUES (?, ?, ?, 1, now())
                ON CONFLICT (trip_id, poi_id, kind)
                  DO UPDATE SET count = trip_poi_rejection.count + 1, updated_at = now()
                """.trimIndent(),
                tripId, poiId, kind.name,
            )
        }
    }

    override fun findByTrip(tripId: UUID): List<RejectedPoi> =
        jdbc.query(
            "SELECT poi_id, kind, count FROM trip_poi_rejection WHERE trip_id = ?",
            { rs, _ ->
                RejectedPoi(
                    poiId = rs.getObject("poi_id", UUID::class.java),
                    kind = RejectedPoi.Kind.valueOf(rs.getString("kind")),
                    count = rs.getInt("count"),
                )
            },
            tripId,
        )
}
