package com.trippilot.planbdetection.adapter.out.persistence

import com.trippilot.planbdetection.domain.PlanBTrigger
import com.trippilot.planbdetection.domain.PlanBTriggerRepository
import com.trippilot.planbdetection.domain.Sensitivity
import com.trippilot.planbdetection.domain.SensitivityRepository
import com.trippilot.planbdetection.domain.Suppression
import com.trippilot.planbdetection.domain.SuppressionRepository
import com.trippilot.planbdetection.domain.SuppressionScope
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerScope
import com.trippilot.planbdetection.domain.TriggerState
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import org.springframework.stereotype.Component
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/** plan_b_trigger 매핑(V2.18). */
@Entity
@Table(name = "plan_b_trigger")
class PlanBTriggerEntity(
    @Id @Column(name = "trigger_id") var triggerId: UUID,
    @Column(name = "trip_id") var tripId: UUID,
    @Column(name = "itinerary_id") var itineraryId: UUID,
    @Column(name = "kind") var kind: String,
    @Column(name = "affected_date") var affectedDate: LocalDate,
    @Column(name = "slot_key") var slotKey: String?,
    @JdbcTypeCode(SqlTypes.JSON) @Column(name = "payload") var payload: Map<String, Any>,
    @Column(name = "should_replan") var shouldReplan: Boolean,
    @Column(name = "scope") var scope: String?,
    @Column(name = "reason") var reason: String,
    @Column(name = "state") var state: String,
    @Column(name = "detected_at") var detectedAt: Instant,
) {
    protected constructor() : this(
        UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), "", LocalDate.EPOCH, null,
        emptyMap(), false, null, "", "", Instant.EPOCH,
    )
}

interface PlanBTriggerJpaRepository : JpaRepository<PlanBTriggerEntity, UUID> {
    fun findByTripIdAndStateOrderByDetectedAtDesc(tripId: UUID, state: String): List<PlanBTriggerEntity>

    /**
     * 그 날 **발화한** 수. `should_replan` 이 참인 것만 센다 — 무발화 판정까지 세면 억제가 상한을 잡아먹어,
     * 억제될수록 알림이 더 막히는 뒤집힌 동작이 된다.
     */
    @Query(
        """
        SELECT COUNT(t) FROM PlanBTriggerEntity t
        WHERE t.tripId = :tripId AND t.shouldReplan = true
          AND t.detectedAt >= :from AND t.detectedAt < :to
        """,
    )
    fun countActivatedBetween(
        @Param("tripId") tripId: UUID,
        @Param("from") from: Instant,
        @Param("to") to: Instant,
    ): Long
}

@Component
class PlanBTriggerPersistence(private val jpa: PlanBTriggerJpaRepository) : PlanBTriggerRepository {

    override fun save(trigger: PlanBTrigger): PlanBTrigger =
        jpa.saveAndFlush(
            PlanBTriggerEntity(
                trigger.triggerId, trigger.tripId, trigger.itineraryId, trigger.kind.name,
                trigger.affectedDate, trigger.slotKey, trigger.payload, trigger.shouldReplan,
                trigger.scope?.name, trigger.reason, trigger.state.name, trigger.detectedAt,
            ),
        ).toDomain()

    override fun findById(triggerId: UUID): PlanBTrigger? =
        jpa.findById(triggerId).orElse(null)?.toDomain()

    override fun findActiveByTrip(tripId: UUID): List<PlanBTrigger> =
        jpa.findByTripIdAndStateOrderByDetectedAtDesc(tripId, TriggerState.ACTIVE.name).map { it.toDomain() }

    override fun countActivatedOn(tripId: UUID, date: LocalDate): Int {
        val from = date.atStartOfDay(TRAVEL_ZONE).toInstant()
        val to = date.plusDays(1).atStartOfDay(TRAVEL_ZONE).toInstant()
        return jpa.countActivatedBetween(tripId, from, to).toInt()
    }

    private fun PlanBTriggerEntity.toDomain() = PlanBTrigger(
        triggerId, tripId, itineraryId, TriggerKind.valueOf(kind), affectedDate, slotKey, payload,
        shouldReplan, scope?.let { TriggerScope.valueOf(it) }, reason, TriggerState.valueOf(state), detectedAt,
    )

    private companion object {
        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")
    }
}

/** plan_b_suppression 매핑(V2.18). */
@Entity
@Table(name = "plan_b_suppression")
class SuppressionEntity(
    @Id @Column(name = "suppression_id") var suppressionId: UUID,
    @Column(name = "trip_id") var tripId: UUID,
    @Column(name = "kind") var kind: String,
    @Column(name = "slot_key") var slotKey: String?,
    @Column(name = "scope_type") var scopeType: String,
    @Column(name = "suppressed_at") var suppressedAt: Instant,
    @Column(name = "expires_at") var expiresAt: Instant?,
) {
    protected constructor() : this(UUID.randomUUID(), UUID.randomUUID(), "", null, "", Instant.EPOCH, null)
}

interface SuppressionJpaRepository : JpaRepository<SuppressionEntity, UUID> {
    fun findByTripId(tripId: UUID): List<SuppressionEntity>
}

@Component
class SuppressionPersistence(private val jpa: SuppressionJpaRepository) : SuppressionRepository {
    override fun save(suppression: Suppression): Suppression =
        jpa.saveAndFlush(
            SuppressionEntity(
                suppression.suppressionId, suppression.tripId, suppression.kind.name, suppression.slotKey,
                suppression.scopeType.name, suppression.suppressedAt, suppression.expiresAt,
            ),
        ).toDomain()

    override fun findByTrip(tripId: UUID): List<Suppression> = jpa.findByTripId(tripId).map { it.toDomain() }

    private fun SuppressionEntity.toDomain() = Suppression(
        suppressionId, tripId, TriggerKind.valueOf(kind), slotKey,
        SuppressionScope.valueOf(scopeType), suppressedAt, expiresAt,
    )
}

/**
 * plan_b_sensitivity 매핑(V2.18). 정본은 **계정 단위** 설정이라 하고, 물리 소유(profile 이관)는
 * U6 설정과 함께 정한다(G-U4-6). 그 결정 전까지 여기 최소 형태로 둔다.
 */
@Entity
@Table(name = "plan_b_sensitivity")
class SensitivityEntity(
    @Id @Column(name = "account_id") var accountId: UUID,
    @Column(name = "sensitivity") var sensitivity: String,
    @Column(name = "updated_at") var updatedAt: Instant,
) {
    protected constructor() : this(UUID.randomUUID(), "", Instant.EPOCH)
}

interface SensitivityJpaRepository : JpaRepository<SensitivityEntity, UUID>

@Component
class SensitivityPersistence(
    private val jpa: SensitivityJpaRepository,
    private val clock: Clock,
) : SensitivityRepository {
    override fun of(accountId: UUID): Sensitivity =
        jpa.findById(accountId).orElse(null)?.let { Sensitivity.valueOf(it.sensitivity) } ?: Sensitivity.NORMAL

    override fun set(accountId: UUID, sensitivity: Sensitivity): Sensitivity {
        jpa.save(SensitivityEntity(accountId, sensitivity.name, clock.instant()))
        return sensitivity
    }
}
