package com.trippilot.archive.adapter.out.persistence

import com.trippilot.archive.domain.IntervalEndReason
import com.trippilot.archive.domain.IntervalKind
import com.trippilot.archive.domain.LocationAutomationInterval
import com.trippilot.archive.domain.LocationAutomationIntervalRepository
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.stereotype.Component
import java.sql.ResultSet
import java.sql.Timestamp
import java.util.UUID

/**
 * `location_automation_interval`(V2.68). 닫기가 **조건부 UPDATE** 라 JPA 엔티티 대신 SQL 로 둔다 — 기기 END·철회 구독·
 * 스위퍼가 같은 구간을 동시에 닫으려 해도 `ended_at IS NULL` 을 통과하는 쪽은 하나다.
 */
@Component
class LocationAutomationIntervalPersistence(private val jdbc: NamedParameterJdbcTemplate) : LocationAutomationIntervalRepository {

    override fun find(intervalId: UUID): LocationAutomationInterval? =
        jdbc.query("SELECT * FROM location_automation_interval WHERE interval_id = :id", mapOf("id" to intervalId), ::row).firstOrNull()

    override fun insertIfAbsent(interval: LocationAutomationInterval): Boolean =
        jdbc.update(
            """
            INSERT INTO location_automation_interval (interval_id, trip_id, account_id, kind, started_at)
            VALUES (:id, :trip, :account, :kind, :startedAt)
            ON CONFLICT (interval_id) DO NOTHING
            """.trimIndent(),
            mapOf(
                "id" to interval.intervalId, "trip" to interval.tripId, "account" to interval.accountId,
                "kind" to interval.kind.name, "startedAt" to Timestamp.from(interval.startedAt),
            ),
        ) == 1

    override fun closeIfOpen(closed: LocationAutomationInterval): Boolean = jdbc.update(
        """
        UPDATE location_automation_interval
           SET ended_at = :endedAt, end_reason = :reason, point_count = :points, region_count = :regions
         WHERE interval_id = :id AND ended_at IS NULL
        """.trimIndent(),
        mapOf(
            "id" to closed.intervalId, "endedAt" to Timestamp.from(closed.endedAt!!), "reason" to closed.endReason!!.name,
            "points" to closed.pointCount, "regions" to closed.regionCount,
        ),
    ) == 1

    override fun findByTrip(tripId: UUID, kind: IntervalKind): List<LocationAutomationInterval> = jdbc.query(
        "SELECT * FROM location_automation_interval WHERE trip_id = :trip AND kind = :kind ORDER BY started_at",
        mapOf("trip" to tripId, "kind" to kind.name), ::row,
    )

    override fun findOpenByAccount(accountId: UUID): List<LocationAutomationInterval> = jdbc.query(
        "SELECT * FROM location_automation_interval WHERE account_id = :account AND ended_at IS NULL",
        mapOf("account" to accountId), ::row,
    )

    override fun findOpen(): List<LocationAutomationInterval> =
        // 순서를 고정한다 — 두 인스턴스가 다른 순서로 행을 잠그면 교착이 난다(하나가 취소될 뿐이지만).
        jdbc.query("SELECT * FROM location_automation_interval WHERE ended_at IS NULL ORDER BY interval_id", ::row)

    private fun row(rs: ResultSet, @Suppress("UNUSED_PARAMETER") n: Int) = LocationAutomationInterval(
        intervalId = rs.getObject("interval_id", UUID::class.java),
        tripId = rs.getObject("trip_id", UUID::class.java),
        accountId = rs.getObject("account_id", UUID::class.java),
        kind = IntervalKind.valueOf(rs.getString("kind")),
        startedAt = rs.getTimestamp("started_at").toInstant(),
        endedAt = rs.getTimestamp("ended_at")?.toInstant(),
        endReason = rs.getString("end_reason")?.let(IntervalEndReason::valueOf),
        pointCount = rs.getObject("point_count") as Int?,
        regionCount = rs.getObject("region_count") as Int?,
    )
}
