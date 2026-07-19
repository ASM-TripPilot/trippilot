package com.trippilot.auth.adapter.out.persistence

import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.CascadeSummary
import com.trippilot.auth.domain.DeletionSchedule
import com.trippilot.auth.domain.port.DeletionScheduleRepository
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Repository
import java.time.Instant
import java.util.UUID

/** deletion_schedule 매핑(V1.4). cascade_summary 는 jsonb(범주 목록). 활성=cancelled_at IS NULL(INV-D1). */
@Entity
@Table(name = "deletion_schedule")
class DeletionScheduleJpaEntity(
    @Id
    @Column(name = "deletion_id")
    var deletionId: UUID,

    @Column(name = "account_id")
    var accountId: UUID,

    @Column(name = "requested_at")
    var requestedAt: Instant,

    @Column(name = "purge_at")
    var purgeAt: Instant,

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "cascade_summary")
    var cascadeSummary: Map<String, List<String>>,

    @Column(name = "cancelled_at")
    var cancelledAt: Instant?,
)

interface DeletionScheduleJpaRepository : JpaRepository<DeletionScheduleJpaEntity, UUID> {
    fun findFirstByAccountIdAndCancelledAtIsNull(accountId: UUID): DeletionScheduleJpaEntity?
}

/** DeletionScheduleRepository 포트의 JPA 구현. */
@Repository
class JpaDeletionScheduleRepository(
    private val jpa: DeletionScheduleJpaRepository,
) : DeletionScheduleRepository {
    override fun findActive(accountId: AccountId): DeletionSchedule? =
        jpa.findFirstByAccountIdAndCancelledAtIsNull(accountId.value)?.toDomain()

    override fun save(schedule: DeletionSchedule): DeletionSchedule {
        jpa.save(schedule.toEntity())
        return schedule
    }
}

private fun DeletionScheduleJpaEntity.toDomain(): DeletionSchedule =
    DeletionSchedule.reconstitute(
        deletionId = deletionId,
        accountId = AccountId(accountId),
        requestedAt = requestedAt,
        purgeAt = purgeAt,
        cascadeSummary = CascadeSummary(
            purgeScheduled = cascadeSummary["purgeScheduled"] ?: emptyList(),
            legallyRetained = cascadeSummary["legallyRetained"] ?: emptyList(),
        ),
        cancelledAt = cancelledAt,
    )

private fun DeletionSchedule.toEntity(): DeletionScheduleJpaEntity =
    DeletionScheduleJpaEntity(
        deletionId = deletionId,
        accountId = accountId.value,
        requestedAt = requestedAt,
        purgeAt = purgeAt,
        cascadeSummary = mapOf(
            "purgeScheduled" to cascadeSummary.purgeScheduled,
            "legallyRetained" to cascadeSummary.legallyRetained,
        ),
        cancelledAt = cancelledAt,
    )
