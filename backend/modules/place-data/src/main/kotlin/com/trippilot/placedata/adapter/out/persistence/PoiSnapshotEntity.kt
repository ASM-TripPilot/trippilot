package com.trippilot.placedata.adapter.out.persistence

import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiSnapshot
import com.trippilot.placedata.domain.PoiSnapshotRepository
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Component
import java.time.Instant
import java.util.UUID

/** poi_snapshot(V2.0) 매핑. source_poi_id는 FK 미강제(INV-U1-03 동결). */
@Entity
@Table(name = "poi_snapshot")
class PoiSnapshotEntity(
    @Id @Column(name = "poi_snapshot_id") var poiSnapshotId: UUID,
    @Column(name = "source_poi_id") var sourcePoiId: UUID,
    @Column(name = "name_ko") var nameKo: String,
    @Column(name = "lat") var lat: Double,
    @Column(name = "lng") var lng: Double,
    @Column(name = "category") var category: String,
    @Column(name = "snapshot_at") var snapshotAt: Instant,
)

interface PoiSnapshotJpaRepository : JpaRepository<PoiSnapshotEntity, UUID>

@Component
class PoiSnapshotRepositoryAdapter(
    private val jpa: PoiSnapshotJpaRepository,
) : PoiSnapshotRepository {

    // saveAndFlush: 소비자(must_visit·visit_slot)가 같은 tx 안에서 poi_snapshot_id 를 FK로 참조 —
    // JPA 연관이 아닌 plain UUID FK라 Hibernate가 flush 순서를 보장 못 함. 즉시 flush 해 참조 무결성 확보.
    override fun save(snapshot: PoiSnapshot): PoiSnapshot = jpa.saveAndFlush(snapshot.toEntity()).let { snapshot }
    override fun findById(poiSnapshotId: UUID) = jpa.findById(poiSnapshotId).orElse(null)?.toDomain()

    private fun PoiSnapshot.toEntity() = PoiSnapshotEntity(
        poiSnapshotId, sourcePoiId, nameKo, lat, lng, category.name, snapshotAt,
    )

    private fun PoiSnapshotEntity.toDomain() = PoiSnapshot.reconstitute(
        poiSnapshotId, sourcePoiId, nameKo, lat, lng, PoiCategory.valueOf(category), snapshotAt,
    )
}
