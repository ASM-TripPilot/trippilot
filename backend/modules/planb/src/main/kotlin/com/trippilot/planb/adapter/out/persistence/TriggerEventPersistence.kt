package com.trippilot.planb.adapter.out.persistence

import com.trippilot.planb.domain.Sensitivity
import com.trippilot.planb.domain.TriggerEvent
import com.trippilot.planb.domain.TriggerEventRepository
import com.trippilot.planb.domain.TriggerSettingRepository
import com.trippilot.planb.domain.TriggerStatus
import com.trippilot.planb.domain.TriggerType
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import org.springframework.stereotype.Component
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/** trigger_event 매핑(V2.18). */
@Entity
@Table(name = "trigger_event")
class TriggerEventEntity(
    @Id @Column(name = "trigger_event_id") var triggerEventId: UUID,
    @Column(name = "trip_id") var tripId: UUID,
    @Column(name = "type") var type: String,
    @Column(name = "target_slot_id") var targetSlotId: UUID?,
    @Column(name = "value") var value: String,
    @Column(name = "status") var status: String,
    @Column(name = "detected_at") var detectedAt: Instant,
    @Column(name = "updated_at") var updatedAt: Instant,
) {
    protected constructor() : this(UUID.randomUUID(), UUID.randomUUID(), "", null, "", "", Instant.EPOCH, Instant.EPOCH)
}

interface TriggerEventJpaRepository : JpaRepository<TriggerEventEntity, UUID> {
    fun findByTripIdOrderByDetectedAtDesc(tripId: UUID): List<TriggerEventEntity>

    /**
     * 같은 사유·같은 방문지 이력. `target_slot_id` 가 null 인 행(일정 전체 신호)도 찾아야 해서
     * `= :slotId` 로는 안 된다 — SQL 에서 `null = null` 은 참이 아니다(억제가 통째로 무력화된다).
     */
    @Query(
        """
        SELECT e FROM TriggerEventEntity e
        WHERE e.tripId = :tripId AND e.type = :type
          AND ((:slotId IS NULL AND e.targetSlotId IS NULL) OR e.targetSlotId = :slotId)
        """,
    )
    fun findHistory(
        @Param("tripId") tripId: UUID,
        @Param("type") type: String,
        @Param("slotId") slotId: UUID?,
    ): List<TriggerEventEntity>

    /** 그 날 **새로 띄운** 수 — detected_at 기준(상태가 나중에 바뀌어도 그날 띄운 사실은 변하지 않는다). */
    @Query("SELECT COUNT(e) FROM TriggerEventEntity e WHERE e.tripId = :tripId AND e.detectedAt >= :from AND e.detectedAt < :to")
    fun countDetectedBetween(
        @Param("tripId") tripId: UUID,
        @Param("from") from: Instant,
        @Param("to") to: Instant,
    ): Long
}

@Component
class TriggerEventPersistence(private val jpa: TriggerEventJpaRepository) : TriggerEventRepository {

    override fun save(event: TriggerEvent): TriggerEvent =
        jpa.save(
            TriggerEventEntity(
                event.triggerEventId, event.tripId, event.type.name, event.targetSlotId,
                event.value, event.status.name, event.detectedAt, event.updatedAt,
            ),
        ).toDomain()

    override fun findById(triggerEventId: UUID): TriggerEvent? =
        jpa.findById(triggerEventId).orElse(null)?.toDomain()

    override fun findByTrip(tripId: UUID): List<TriggerEvent> =
        jpa.findByTripIdOrderByDetectedAtDesc(tripId).map { it.toDomain() }

    override fun findHistory(tripId: UUID, type: TriggerType, targetSlotId: UUID?): List<TriggerEvent> =
        jpa.findHistory(tripId, type.name, targetSlotId).map { it.toDomain() }

    override fun countRaisedOn(tripId: UUID, date: LocalDate): Int {
        // 여행지 기준 하루 경계를 Instant 로 바꿔 센다 — 서버 UTC 날짜로 세면 자정 무렵 한도가 어긋난다.
        val from = date.atStartOfDay(TRAVEL_ZONE).toInstant()
        val to = date.plusDays(1).atStartOfDay(TRAVEL_ZONE).toInstant()
        return jpa.countDetectedBetween(tripId, from, to).toInt()
    }

    private fun TriggerEventEntity.toDomain() = TriggerEvent(
        triggerEventId, tripId, TriggerType.valueOf(type), targetSlotId, value,
        TriggerStatus.valueOf(status), detectedAt, updatedAt,
    )

    private companion object {
        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")
    }
}

/** replan_trigger_setting 매핑(V2.18). 행이 없으면 NORMAL — 설정이 없다고 알림이 멈추면 안 된다. */
@Entity
@Table(name = "replan_trigger_setting")
class TriggerSettingEntity(
    @Id @Column(name = "trip_id") var tripId: UUID,
    @Column(name = "sensitivity") var sensitivity: String,
    @Column(name = "updated_at") var updatedAt: Instant,
) {
    protected constructor() : this(UUID.randomUUID(), "", Instant.EPOCH)
}

interface TriggerSettingJpaRepository : JpaRepository<TriggerSettingEntity, UUID>

@Component
class TriggerSettingPersistence(private val jpa: TriggerSettingJpaRepository) : TriggerSettingRepository {
    override fun sensitivityOf(tripId: UUID): Sensitivity =
        jpa.findById(tripId).orElse(null)?.let { Sensitivity.valueOf(it.sensitivity) } ?: Sensitivity.NORMAL
}
