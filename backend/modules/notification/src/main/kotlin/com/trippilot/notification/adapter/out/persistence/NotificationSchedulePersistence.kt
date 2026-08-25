package com.trippilot.notification.adapter.out.persistence

import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.NotificationSchedule
import com.trippilot.notification.domain.NotificationScheduleRepository
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component
import java.sql.ResultSet
import java.time.Instant
import java.util.UUID

/** notification_schedule 매핑(V2.32). 예약은 사실이 아니라 예정이라 미발화분은 통째로 갈린다(INV-U6-08). */
@Entity
@Table(name = "notification_schedule")
class NotificationScheduleEntity(
    @Id @Column(name = "schedule_id") var scheduleId: UUID,
    @Column(name = "account_id") var accountId: UUID,
    @Column(name = "trip_id") var tripId: UUID,
    @Column(name = "kind") var kind: String,
    @Column(name = "slot_key") var slotKey: String?,
    @Column(name = "fire_at") var fireAt: Instant,
    @Column(name = "fired_at") var firedAt: Instant?,
    @Column(name = "canceled_at") var canceledAt: Instant?,
)

interface NotificationScheduleJpaRepository : JpaRepository<NotificationScheduleEntity, UUID> {
    fun findByTripIdAndFiredAtIsNullAndCanceledAtIsNullOrderByFireAt(tripId: UUID): List<NotificationScheduleEntity>
}

@Component
class NotificationScheduleRepositoryAdapter(
    private val jpa: NotificationScheduleJpaRepository,
    private val jdbc: JdbcTemplate,
) : NotificationScheduleRepository {

    /**
     * 지우고 다시 넣는다. 차이를 계산해 일부만 고치지 않는 이유는 [NotificationScheduleRepository.replacePending]
     * 에 적었다 — 어긋난 한 줄이 지난 일정을 알린다.
     *
     * 삭제 대상을 **미발화·미취소로 좁히는 것이 핵심**이다. 이미 발화한 행까지 지우면 같은 이벤트가 두 번
     * 배달됐을 때(at-least-once) 보냈던 알림을 또 예약하게 된다.
     */
    override fun replacePending(tripId: UUID, schedules: List<NotificationSchedule>) {
        jdbc.update(
            "DELETE FROM notification_schedule WHERE trip_id = ? AND fired_at IS NULL AND canceled_at IS NULL",
            tripId,
        )
        if (schedules.isEmpty()) return
        jpa.saveAll(schedules.map { it.toEntity() })
    }

    /**
     * 도래분. `ORDER BY fire_at` 은 밀렸을 때 **오래된 것부터** 빠지게 한다 —
     * 최신부터 집으면 밀린 뒤쪽이 유예를 넘겨 통째로 취소된다(INV-U6-09).
     */
    override fun findDue(now: Instant, limit: Int): List<NotificationSchedule> = jdbc.query(
        """
        SELECT schedule_id, account_id, trip_id, kind, slot_key, fire_at, fired_at, canceled_at
          FROM notification_schedule
         WHERE fired_at IS NULL AND canceled_at IS NULL AND fire_at <= ?
         ORDER BY fire_at
         LIMIT ?
        """.trimIndent(),
        { rs, _ -> rs.toDomain() },
        java.sql.Timestamp.from(now), limit,
    )

    // 조건부 쓰기 — 다중 인스턴스가 같은 행을 집어도 UPDATE 는 하나만 성공한다. 이것이 발화 멱등의 전부다.
    override fun markFired(scheduleId: UUID, at: Instant): Boolean =
        jdbc.update(
            "UPDATE notification_schedule SET fired_at = ? WHERE schedule_id = ? AND fired_at IS NULL AND canceled_at IS NULL",
            java.sql.Timestamp.from(at), scheduleId,
        ) == 1

    override fun markCanceled(scheduleId: UUID, at: Instant): Boolean =
        jdbc.update(
            "UPDATE notification_schedule SET canceled_at = ? WHERE schedule_id = ? AND fired_at IS NULL AND canceled_at IS NULL",
            java.sql.Timestamp.from(at), scheduleId,
        ) == 1

    override fun findPendingByTrip(tripId: UUID): List<NotificationSchedule> =
        jpa.findByTripIdAndFiredAtIsNullAndCanceledAtIsNullOrderByFireAt(tripId).map { it.toDomain() }

    private fun NotificationSchedule.toEntity() = NotificationScheduleEntity(
        scheduleId = scheduleId,
        accountId = accountId,
        tripId = tripId,
        kind = kind.name,
        slotKey = slotKey,
        fireAt = fireAt,
        firedAt = firedAt,
        canceledAt = canceledAt,
    )

    private fun NotificationScheduleEntity.toDomain() = NotificationSchedule(
        scheduleId = scheduleId,
        accountId = accountId,
        tripId = tripId,
        kind = NotificationKind.of(kind),
        slotKey = slotKey,
        fireAt = fireAt,
        firedAt = firedAt,
        canceledAt = canceledAt,
    )

    private fun ResultSet.toDomain() = NotificationSchedule(
        scheduleId = getObject("schedule_id", UUID::class.java),
        accountId = getObject("account_id", UUID::class.java),
        tripId = getObject("trip_id", UUID::class.java),
        kind = NotificationKind.of(getString("kind")),
        slotKey = getString("slot_key"),
        fireAt = getTimestamp("fire_at").toInstant(),
        firedAt = getTimestamp("fired_at")?.toInstant(),
        canceledAt = getTimestamp("canceled_at")?.toInstant(),
    )
}
