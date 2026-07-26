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
}

@Component
class BaseAssignmentRepositoryAdapter(
    private val jpa: BaseAssignmentJpaRepository,
) : BaseAssignmentRepository {

    override fun save(base: BaseAssignment): BaseAssignment = jpa.save(base.toEntity()).toDomain()

    override fun findByTrip(tripId: UUID): List<BaseAssignment> =
        jpa.findByTripId(tripId).map { it.toDomain() }

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
