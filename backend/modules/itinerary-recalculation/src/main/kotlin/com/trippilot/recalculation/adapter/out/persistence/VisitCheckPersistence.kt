package com.trippilot.recalculation.adapter.out.persistence

import com.trippilot.recalculation.domain.CheckSource
import com.trippilot.recalculation.domain.VisitCheck
import com.trippilot.recalculation.domain.VisitCheckRepository
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Component
import java.time.Instant
import java.util.UUID

/**
 * visit_check 매핑(V2.21).
 * 체류(dwell)는 **컬럼이 없다** — 두 시각의 파생값이라 저장하면 어긋날 수 있고,
 * 어긋났을 때 어느 쪽이 사실인지 알 수 없다.
 */
@Entity
@Table(name = "visit_check")
class VisitCheckEntity(
    @Id @Column(name = "visit_check_id") var visitCheckId: UUID,
    @Column(name = "trip_id") var tripId: UUID,
    @Column(name = "slot_key") var slotKey: String?,
    @Column(name = "poi_id") var poiId: UUID,
    @Column(name = "arrived_at") var arrivedAt: Instant?,
    @Column(name = "completed_at") var completedAt: Instant?,
    @Column(name = "skipped_at") var skippedAt: Instant?,
    @Column(name = "source") var source: String,
    @Column(name = "created_at") var createdAt: Instant,
    @Column(name = "updated_at") var updatedAt: Instant,
) {
    protected constructor() : this(
        UUID.randomUUID(), UUID.randomUUID(), null, UUID.randomUUID(), null, null, null, "", Instant.EPOCH, Instant.EPOCH,
    )
}

interface VisitCheckJpaRepository : JpaRepository<VisitCheckEntity, UUID> {
    fun findByTripIdOrderByArrivedAtDesc(tripId: UUID): List<VisitCheckEntity>

    fun findFirstByTripIdAndSlotKey(tripId: UUID, slotKey: String): VisitCheckEntity?
}

@Component
class VisitCheckPersistence(private val jpa: VisitCheckJpaRepository) : VisitCheckRepository {

    override fun save(check: VisitCheck): VisitCheck = jpa.saveAndFlush(
        VisitCheckEntity(
            check.visitCheckId, check.tripId, check.slotKey, check.poiId,
            check.arrivedAt, check.completedAt, check.skippedAt, check.source.name, check.createdAt, check.updatedAt,
        ),
    ).toDomain()

    override fun findById(visitCheckId: UUID): VisitCheck? = jpa.findById(visitCheckId).orElse(null)?.toDomain()

    override fun findByTrip(tripId: UUID): List<VisitCheck> =
        jpa.findByTripIdOrderByArrivedAtDesc(tripId).map { it.toDomain() }

    override fun findBySlot(tripId: UUID, slotKey: String): VisitCheck? =
        jpa.findFirstByTripIdAndSlotKey(tripId, slotKey)?.toDomain()

    private fun VisitCheckEntity.toDomain() = VisitCheck.reconstitute(
        visitCheckId, tripId, slotKey, poiId, arrivedAt, completedAt, skippedAt,
        CheckSource.valueOf(source), createdAt, updatedAt,
    )
}
