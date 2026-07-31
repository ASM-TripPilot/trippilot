package com.trippilot.trip.adapter.out.persistence

import com.trippilot.trip.domain.MustVisit
import com.trippilot.trip.domain.MustVisitRepository
import com.trippilot.trip.domain.MustVisitType
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Component
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/** must_visit(V2.3) 매핑. type은 문자열, poi_snapshot_id는 place-data 소유 테이블 FK. */
@Entity
@Table(name = "must_visit")
class MustVisitEntity(
    @Id @Column(name = "must_visit_id") var mustVisitId: UUID,
    @Column(name = "trip_id") var tripId: UUID,
    @Column(name = "poi_snapshot_id") var poiSnapshotId: UUID,
    @Column(name = "source_poi_id") var sourcePoiId: UUID,
    @Column(name = "type") var type: String,
    @Column(name = "fixed_date") var fixedDate: LocalDate?,
    @Column(name = "fixed_start") var fixedStart: LocalTime?,
    @Column(name = "dwell_min") var dwellMin: Int?,
    @Column(name = "created_at") var createdAt: Instant,
)

interface MustVisitJpaRepository : JpaRepository<MustVisitEntity, UUID> {
    fun findByTripId(tripId: UUID): List<MustVisitEntity>
    fun existsByTripIdAndSourcePoiId(tripId: UUID, sourcePoiId: UUID): Boolean
}

@Component
class MustVisitRepositoryAdapter(
    private val jpa: MustVisitJpaRepository,
) : MustVisitRepository {

    override fun save(mustVisit: MustVisit): MustVisit = jpa.save(mustVisit.toEntity()).let { mustVisit }
    override fun findByTrip(tripId: UUID) = jpa.findByTripId(tripId).map { it.toDomain() }
    override fun findById(mustVisitId: UUID) = jpa.findById(mustVisitId).orElse(null)?.toDomain()
    override fun existsByTripAndSourcePoi(tripId: UUID, sourcePoiId: UUID) = jpa.existsByTripIdAndSourcePoiId(tripId, sourcePoiId)
    override fun delete(mustVisit: MustVisit) = jpa.deleteById(mustVisit.mustVisitId)

    private fun MustVisit.toEntity() = MustVisitEntity(
        mustVisitId, tripId, poiSnapshotId, sourcePoiId, type.name, fixedDate, fixedStart, dwellMin, createdAt,
    )

    private fun MustVisitEntity.toDomain() = MustVisit.reconstitute(
        mustVisitId, tripId, poiSnapshotId, sourcePoiId, MustVisitType.valueOf(type), fixedDate, fixedStart, dwellMin, createdAt,
    )
}
