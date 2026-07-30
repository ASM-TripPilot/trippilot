package com.trippilot.placedata.adapter.out.persistence

import com.trippilot.placedata.domain.DataStatus
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiRepository
import com.trippilot.placedata.domain.PoiSource
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import org.springframework.stereotype.Component
import java.time.Instant
import java.util.UUID

/** poi(V2.0) 매핑. enum은 문자열(DB CHECK와 동일 값). */
@Entity
@Table(name = "poi")
class PoiEntity(
    @Id @Column(name = "poi_id") var poiId: UUID,
    @Column(name = "name_ko") var nameKo: String,
    @Column(name = "lat") var lat: Double,
    @Column(name = "lng") var lng: Double,
    @Column(name = "category") var category: String,
    @Column(name = "region") var region: String?,
    @Column(name = "opening_hours") var openingHours: String?,
    @Column(name = "data_status") var dataStatus: String,
    @Column(name = "source") var source: String,
    @Column(name = "saved_count") var savedCount: Long,
    @Column(name = "created_at") var createdAt: Instant,
    @Column(name = "updated_at") var updatedAt: Instant,
)

interface PoiJpaRepository : JpaRepository<PoiEntity, UUID> {
    /** ACTIVE만(INV-U1-01) + 선택 지역·카테고리 필터. 상태를 쿼리에 고정해 closed-set 서빙 보장. */
    @Query(
        "select p from PoiEntity p where p.dataStatus = 'ACTIVE' " +
            "and (:region is null or p.region = :region) " +
            "and (:category is null or p.category = :category)",
    )
    fun findActive(@Param("region") region: String?, @Param("category") category: String?): List<PoiEntity>
}

@Component
class PoiRepositoryAdapter(
    private val jpa: PoiJpaRepository,
) : PoiRepository {

    override fun saveAll(pois: List<Poi>): List<Poi> {
        jpa.saveAll(pois.map { it.toEntity() })
        return pois
    }

    override fun findById(poiId: UUID): Poi? = jpa.findById(poiId).orElse(null)?.toDomain()

    override fun findActive(region: String?, category: PoiCategory?): List<Poi> =
        jpa.findActive(region, category?.name).map { it.toDomain() }

    private fun Poi.toEntity() = PoiEntity(
        poiId = poiId, nameKo = nameKo, lat = lat, lng = lng, category = category.name, region = region,
        openingHours = openingHours, dataStatus = dataStatus.name, source = source.name,
        savedCount = savedCount, createdAt = createdAt, updatedAt = updatedAt,
    )

    private fun PoiEntity.toDomain() = Poi.reconstitute(
        poiId = poiId, nameKo = nameKo, lat = lat, lng = lng, category = PoiCategory.valueOf(category), region = region,
        openingHours = openingHours, dataStatus = DataStatus.valueOf(dataStatus), source = PoiSource.valueOf(source),
        savedCount = savedCount, createdAt = createdAt, updatedAt = updatedAt,
    )
}
