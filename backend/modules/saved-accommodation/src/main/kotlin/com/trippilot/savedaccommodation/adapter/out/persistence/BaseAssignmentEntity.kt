package com.trippilot.savedaccommodation.adapter.out.persistence

import com.trippilot.savedaccommodation.domain.BaseAssignment
import com.trippilot.savedaccommodation.domain.BaseAssignmentRepository
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Component
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/** base_assignment(V2.4) 매핑. 구간 [date_from, date_to). */
@Entity
@Table(name = "base_assignment")
class BaseAssignmentEntity(
    @Id @Column(name = "base_assignment_id") var baseAssignmentId: UUID,
    @Column(name = "trip_id") var tripId: UUID,
    @Column(name = "saved_stay_id") var savedStayId: UUID,
    @Column(name = "date_from") var dateFrom: LocalDate,
    @Column(name = "date_to") var dateTo: LocalDate,
    @Column(name = "created_at") var createdAt: Instant,
)

interface BaseAssignmentJpaRepository : JpaRepository<BaseAssignmentEntity, UUID> {
    fun findByTripId(tripId: UUID): List<BaseAssignmentEntity>
    fun existsBySavedStayId(savedStayId: UUID): Boolean
    fun findBySavedStayIdIn(savedStayIds: Collection<UUID>): List<BaseAssignmentEntity>
}

@Component
class BaseAssignmentRepositoryAdapter(
    private val jpa: BaseAssignmentJpaRepository,
) : BaseAssignmentRepository {

    override fun save(base: BaseAssignment): BaseAssignment = jpa.save(base.toEntity()).toDomain()

    override fun findByTrip(tripId: UUID): List<BaseAssignment> =
        jpa.findByTripId(tripId).map { it.toDomain() }

    /** 같은 여행에 여러 구간이 배정되면 행이 여럿이다 — 여행 id 는 중복을 뺀다. */
    override fun findTripIdsByStays(savedStayIds: Collection<UUID>): Map<UUID, List<UUID>> {
        if (savedStayIds.isEmpty()) return emptyMap()
        return jpa.findBySavedStayIdIn(savedStayIds)
            .groupBy { it.savedStayId }
            .mapValues { (_, rows) -> rows.map { it.tripId }.distinct() }
    }

    override fun findById(baseAssignmentId: UUID): BaseAssignment? =
        jpa.findById(baseAssignmentId).orElse(null)?.toDomain()

    override fun delete(base: BaseAssignment) = jpa.deleteById(base.baseAssignmentId)

    override fun existsByStayId(savedStayId: UUID): Boolean = jpa.existsBySavedStayId(savedStayId)

    private fun BaseAssignment.toEntity() = BaseAssignmentEntity(
        baseAssignmentId = baseAssignmentId, tripId = tripId, savedStayId = savedStayId,
        dateFrom = dateFrom, dateTo = dateTo, createdAt = createdAt,
    )

    private fun BaseAssignmentEntity.toDomain() = BaseAssignment.reconstitute(
        baseAssignmentId = baseAssignmentId, tripId = tripId, savedStayId = savedStayId,
        dateFrom = dateFrom, dateTo = dateTo, createdAt = createdAt,
    )
}
