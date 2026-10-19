package com.trippilot.planbdetection.adapter.out.persistence

import com.trippilot.planbdetection.domain.PlanBTrigger
import com.trippilot.planbdetection.domain.PlanBTriggerRepository
import com.trippilot.planbdetection.domain.PlanBWatch
import com.trippilot.planbdetection.domain.PlanBWatchRepository
import com.trippilot.planbdetection.domain.Sensitivity
import com.trippilot.planbdetection.domain.SensitivityRepository
import com.trippilot.planbdetection.domain.Suppression
import com.trippilot.planbdetection.domain.SuppressionRepository
import com.trippilot.planbdetection.domain.SuppressionScope
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerScope
import com.trippilot.planbdetection.domain.TriggerSeverity
import com.trippilot.planbdetection.domain.TriggerState
import com.trippilot.planbdetection.domain.WatchStatus
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.IdClass
import jakarta.persistence.Table
import jakarta.persistence.Version
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import org.springframework.stereotype.Component
import java.io.Serializable
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/** plan_b_trigger 매핑(V2.18 + 상황 감지 확장 — 심각도·알림 이력·낙관적 잠금). */
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
    @Column(name = "severity") var severity: String,
    @Column(name = "alerted_severity") var alertedSeverity: String?,
    @Column(name = "pushed_at") var pushedAt: Instant?,
    /**
     * 낙관적 잠금. **래퍼 타입(null 가능)이어야 한다** — Spring Data 가 null 이면 persist(INSERT), 아니면
     * merge(UPDATE … WHERE version = ?)로 가른다. 원시 long 이면 id 로 가르는데 id 는 늘 채워져 있어 새 행도 merge 로 간다.
     */
    @Version @Column(name = "version") var version: Long?,
) {
    protected constructor() : this(
        UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), "", LocalDate.EPOCH, null,
        emptyMap(), false, null, "", "", Instant.EPOCH, TriggerSeverity.RISK.name, null, null, null,
    )
}

interface PlanBTriggerJpaRepository : JpaRepository<PlanBTriggerEntity, UUID> {
    fun findByTripIdAndStateOrderByDetectedAtDesc(tripId: UUID, state: String): List<PlanBTriggerEntity>

    fun findByTripIdAndAffectedDateIn(tripId: UUID, dates: Collection<LocalDate>): List<PlanBTriggerEntity>

    /** 그 구간에 **푸시 대상이었던** 사건 대표 수 — 조용한 발화·주의는 `pushed_at` 이 없어 세지 않는다. */
    @Query(
        """
        SELECT COUNT(t) FROM PlanBTriggerEntity t
        WHERE t.tripId = :tripId AND t.pushedAt >= :from AND t.pushedAt < :to
        """,
    )
    fun countPushedBetween(
        @Param("tripId") tripId: UUID,
        @Param("from") from: Instant,
        @Param("to") to: Instant,
    ): Long
}

@Component
class PlanBTriggerPersistence(private val jpa: PlanBTriggerJpaRepository) : PlanBTriggerRepository {

    /**
     * **`saveAndFlush`** — 한 판정이 "기존 행 갱신 → 새 행" 순서로 쓰므로 UPDATE 가 그 자리에서 나가야 한다.
     * `save` 는 UPDATE 를 커밋까지 미뤄 INSERT 가 먼저 나가고 부분 유니크(`ux_plan_b_trigger_active`)에 걸린다.
     * 낡은 version 이면 Spring 이 `OptimisticLockingFailureException` 으로 올린다 — 호출측이 다음 판정에 맡긴다.
     */
    override fun save(trigger: PlanBTrigger): PlanBTrigger =
        jpa.saveAndFlush(
            PlanBTriggerEntity(
                trigger.triggerId, trigger.tripId, trigger.itineraryId, trigger.kind.name,
                trigger.affectedDate, trigger.slotKey, trigger.payload, trigger.shouldReplan,
                trigger.scope?.name, trigger.reason, trigger.state.name, trigger.detectedAt,
                trigger.severity.name, trigger.alertedSeverity?.name, trigger.pushedAt, trigger.version,
            ),
        ).toDomain()

    override fun findById(triggerId: UUID): PlanBTrigger? =
        jpa.findById(triggerId).orElse(null)?.toDomain()

    override fun findActiveByTrip(tripId: UUID): List<PlanBTrigger> =
        jpa.findByTripIdAndStateOrderByDetectedAtDesc(tripId, TriggerState.ACTIVE.name).map { it.toDomain() }

    override fun findByTripOn(tripId: UUID, dates: Collection<LocalDate>): List<PlanBTrigger> =
        if (dates.isEmpty()) emptyList() else jpa.findByTripIdAndAffectedDateIn(tripId, dates).map { it.toDomain() }

    override fun countPushedOn(tripId: UUID, date: LocalDate): Int {
        val from = date.atStartOfDay(TRAVEL_ZONE).toInstant()
        val to = date.plusDays(1).atStartOfDay(TRAVEL_ZONE).toInstant()
        return jpa.countPushedBetween(tripId, from, to).toInt()
    }

    private fun PlanBTriggerEntity.toDomain() = PlanBTrigger(
        triggerId, tripId, itineraryId, TriggerKind.valueOf(kind), affectedDate, slotKey, payload,
        shouldReplan, scope?.let { TriggerScope.valueOf(it) }, reason, TriggerState.valueOf(state), detectedAt,
        TriggerSeverity.valueOf(severity), alertedSeverity?.let { TriggerSeverity.valueOf(it) }, pushedAt, version,
    )

    private companion object {
        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")
    }
}

/** plan_b_suppression 매핑(V2.18 + 날짜·심각도 범위). */
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
    @Column(name = "affected_date") var affectedDate: LocalDate?,
    @Column(name = "max_severity") var maxSeverity: String?,
) {
    protected constructor() : this(UUID.randomUUID(), UUID.randomUUID(), "", null, "", Instant.EPOCH, null, null, null)
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
                suppression.affectedDate, suppression.maxSeverity?.name,
            ),
        ).toDomain()

    override fun findByTrip(tripId: UUID): List<Suppression> = jpa.findByTripId(tripId).map { it.toDomain() }

    private fun SuppressionEntity.toDomain() = Suppression(
        suppressionId, tripId, TriggerKind.valueOf(kind), slotKey,
        SuppressionScope.valueOf(scopeType), suppressedAt, expiresAt,
        affectedDate, maxSeverity?.let { TriggerSeverity.valueOf(it) },
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

/** plan_b_watch 매핑 — (여행, 출처)당 마지막 관측 1행. */
@Entity
@Table(name = "plan_b_watch")
@IdClass(PlanBWatchKey::class)
class PlanBWatchEntity(
    @Id @Column(name = "trip_id") var tripId: UUID,
    @Id @Column(name = "source") var source: String,
    @Column(name = "status") var status: String,
    @Column(name = "checked_at") var checkedAt: Instant,
) {
    protected constructor() : this(UUID.randomUUID(), "", "", Instant.EPOCH)
}

data class PlanBWatchKey(var tripId: UUID? = null, var source: String? = null) : Serializable

interface PlanBWatchJpaRepository : JpaRepository<PlanBWatchEntity, PlanBWatchKey> {
    fun findByTripId(tripId: UUID): List<PlanBWatchEntity>
}

@Component
class PlanBWatchPersistence(private val jpa: PlanBWatchJpaRepository) : PlanBWatchRepository {

    /**
     * 같은 키면 덮는다 — 키가 늘 채워져 있어 Spring Data 가 merge(조회 후 INSERT·UPDATE)로 보낸다.
     * 쓰는 쪽(스윕)은 단일 실행(ShedLock)이라 같은 키 동시 INSERT 경합이 없다.
     */
    override fun upsert(watch: PlanBWatch) {
        jpa.save(PlanBWatchEntity(watch.tripId, watch.source, watch.status.name, watch.checkedAt))
    }

    override fun findByTrip(tripId: UUID): List<PlanBWatch> =
        jpa.findByTripId(tripId).map { PlanBWatch(it.tripId, it.source, WatchStatus.valueOf(it.status), it.checkedAt) }
}
