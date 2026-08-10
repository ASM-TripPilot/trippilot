package com.trippilot.planb.adapter.out.persistence

import com.trippilot.planb.domain.EmptyReason
import com.trippilot.planb.domain.ReplanMode
import com.trippilot.planb.domain.ReplanReason
import com.trippilot.planb.domain.ReplanSession
import com.trippilot.planb.domain.ReplanSessionRepository
import com.trippilot.planb.domain.ReplanStatus
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Component
import java.time.Instant
import java.util.UUID

/** replan_session 매핑(V2.17). 상태·사유는 enum 이름 그대로 저장한다(DB CHECK 와 같은 어휘). */
@Entity
@Table(name = "replan_session")
class ReplanSessionEntity(
    @Id @Column(name = "replan_session_id") var replanSessionId: UUID,
    @Column(name = "trip_id") var tripId: UUID,
    @Column(name = "reason") var reason: String,
    @Column(name = "mode") var mode: String,
    @Column(name = "status") var status: String,
    @Column(name = "empty_reason") var emptyReason: String?,
    @Column(name = "created_at") var createdAt: Instant,
    @Column(name = "updated_at") var updatedAt: Instant,
) {
    protected constructor() : this(UUID.randomUUID(), UUID.randomUUID(), "", "", "", null, Instant.EPOCH, Instant.EPOCH)
}

interface ReplanSessionJpaRepository : JpaRepository<ReplanSessionEntity, UUID> {
    fun findFirstByTripIdAndStatusIn(tripId: UUID, statuses: Collection<String>): ReplanSessionEntity?
}

@Component
class ReplanSessionPersistence(private val jpa: ReplanSessionJpaRepository) : ReplanSessionRepository {

    override fun save(session: ReplanSession): ReplanSession =
        jpa.save(
            ReplanSessionEntity(
                session.replanSessionId, session.tripId, session.reason.name, session.mode.name,
                session.status.name, session.emptyReason?.name, session.createdAt, session.updatedAt,
            ),
        ).toDomain()

    override fun findById(replanSessionId: UUID): ReplanSession? =
        jpa.findById(replanSessionId).orElse(null)?.toDomain()

    override fun findActiveByTrip(tripId: UUID): ReplanSession? =
        jpa.findFirstByTripIdAndStatusIn(tripId, ACTIVE_STATUSES)?.toDomain()

    private fun ReplanSessionEntity.toDomain() = ReplanSession.reconstitute(
        replanSessionId, tripId,
        ReplanReason.valueOf(reason), ReplanMode.valueOf(mode), ReplanStatus.valueOf(status),
        emptyReason?.let { EmptyReason.valueOf(it) },
        createdAt, updatedAt,
    )

    private companion object {
        /**
         * 아직 끝나지 않은 상태. DB 의 부분 유니크 인덱스(`ux_replan_session_active`)와 **같은 집합**이어야 한다 —
         * 어긋나면 앱은 "없다"고 보고 INSERT 하는데 DB 가 막아 500 이 된다.
         */
        private val ACTIVE_STATUSES = listOf(ReplanStatus.LOADING.name, ReplanStatus.PROPOSED.name)
    }
}
