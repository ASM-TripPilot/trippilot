package com.trippilot.archive.adapter.out.persistence

import com.trippilot.archive.domain.ActualRouteDay
import com.trippilot.archive.domain.ActualRouteDayRepository
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.stereotype.Component
import java.sql.Date
import java.sql.ResultSet
import java.sql.Timestamp
import java.util.UUID

/** `actual_route_day`(V2.69). `text[]` 과 upsert 를 그대로 쓰려고 SQL 로 둔다. */
@Component
class ActualRouteDayPersistence(private val jdbc: NamedParameterJdbcTemplate) : ActualRouteDayRepository {

    override fun upsert(day: ActualRouteDay): ActualRouteDay = jdbc.query(
        """
        INSERT INTO actual_route_day (route_day_id, trip_id, local_date, segments, distance_m, distance_clamped,
                                      raw_point_count, stored_point_count, recorded_from, recorded_to, created_at, updated_at)
        VALUES (:id, :trip, :date, :segments, :distance, :clamped, :raw, :stored, :from, :to, :now, :now)
        ON CONFLICT (trip_id, local_date) DO UPDATE SET
          segments = EXCLUDED.segments, distance_m = EXCLUDED.distance_m, distance_clamped = EXCLUDED.distance_clamped,
          raw_point_count = EXCLUDED.raw_point_count, stored_point_count = EXCLUDED.stored_point_count,
          recorded_from = EXCLUDED.recorded_from, recorded_to = EXCLUDED.recorded_to, updated_at = EXCLUDED.updated_at
        RETURNING *
        """.trimIndent(),
        mapOf(
            "id" to day.routeDayId, "trip" to day.tripId, "date" to Date.valueOf(day.localDate),
            "segments" to day.segments.toTypedArray(), "distance" to day.distanceM, "clamped" to day.distanceClamped,
            "raw" to day.rawPointCount, "stored" to day.storedPointCount,
            "from" to day.recordedFrom?.let(Timestamp::from), "to" to day.recordedTo?.let(Timestamp::from),
            "now" to Timestamp.from(day.updatedAt),
        ),
        ::row,
    ).single()

    override fun findByTrip(tripId: UUID): List<ActualRouteDay> =
        jdbc.query("SELECT * FROM actual_route_day WHERE trip_id = :trip ORDER BY local_date", mapOf("trip" to tripId), ::row)

    override fun deleteByTrips(tripIds: List<UUID>): Int =
        if (tripIds.isEmpty()) 0 else jdbc.update("DELETE FROM actual_route_day WHERE trip_id IN (:trips)", mapOf("trips" to tripIds))

    private fun row(rs: ResultSet, @Suppress("UNUSED_PARAMETER") n: Int) = ActualRouteDay(
        routeDayId = rs.getObject("route_day_id", UUID::class.java),
        tripId = rs.getObject("trip_id", UUID::class.java),
        localDate = rs.getDate("local_date").toLocalDate(),
        segments = (rs.getArray("segments").array as Array<*>).map { it as String },
        distanceM = rs.getInt("distance_m"),
        distanceClamped = rs.getBoolean("distance_clamped"),
        rawPointCount = rs.getInt("raw_point_count"),
        storedPointCount = rs.getInt("stored_point_count"),
        recordedFrom = rs.getTimestamp("recorded_from")?.toInstant(),
        recordedTo = rs.getTimestamp("recorded_to")?.toInstant(),
        createdAt = rs.getTimestamp("created_at").toInstant(),
        updatedAt = rs.getTimestamp("updated_at").toInstant(),
    )
}
