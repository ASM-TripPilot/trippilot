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
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
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
    /** V2.25 — 행정구역 표준코드. region(FK) 참조. 못 정한 행은 null. */
    @Column(name = "region_code") var regionCode: String? = null,
    @Column(name = "opening_hours") var openingHours: String?,
    @Column(name = "data_status") var dataStatus: String,
    @Column(name = "source") var source: String,
    @Column(name = "saved_count") var savedCount: Long,
    @Column(name = "created_at") var createdAt: Instant,
    @Column(name = "updated_at") var updatedAt: Instant,
    @Column(name = "image_url") var imageUrl: String? = null,
    // text[] 매핑은 preference_set(V1.5) 선례와 동일 — 컨버터 없이 Hibernate 네이티브 배열.
    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "tags") var tags: Array<String> = emptyArray(),
    /** V2.23 — 출처 원본 식별자. 수동 등록분은 null. (source, source_ref) 부분 유니크. */
    @Column(name = "source_ref") var sourceRef: String? = null,
)

interface PoiJpaRepository : JpaRepository<PoiEntity, UUID> {
    /** ACTIVE만(INV-U1-01) + 선택 지역·카테고리 필터. 상태를 쿼리에 고정해 closed-set 서빙 보장. */
    @Query(
        "select p from PoiEntity p where p.dataStatus = 'ACTIVE' " +
            "and (:region is null or p.region = :region) " +
            "and (:category is null or p.category = :category)",
    )
    fun findActive(@Param("region") region: String?, @Param("category") category: String?): List<PoiEntity>

    @Query(
        "select p from PoiEntity p where p.dataStatus = 'ACTIVE' " +
            "and p.lat between :latMin and :latMax and p.lng between :lngMin and :lngMax",
    )
    fun findActiveInBounds(
        @Param("latMin") latMin: Double, @Param("latMax") latMax: Double,
        @Param("lngMin") lngMin: Double, @Param("lngMax") lngMax: Double,
    ): List<PoiEntity>

    fun findByPoiIdInAndDataStatus(poiIds: Collection<UUID>, dataStatus: String): List<PoiEntity>

    fun findByPoiIdIn(poiIds: Collection<UUID>): List<PoiEntity>

    /** 멱등 판정용 — 같은 출처의 원본 식별자로 이미 아는 행을 찾는다. 상태 무관(폐업분도 다시 안 만든다). */
    fun findBySourceAndSourceRefIn(source: String, sourceRefs: Collection<String>): List<PoiEntity>

    /**
     * 지역 커버리지 집계(TRIP-359) — ACTIVE 만 센다(INV-U1-01).
     *
     * 코드별로 한 번에 모아 온 뒤 시도 롤업은 앱에서 접두사로 접는다([coverageOf]).
     * 지역마다 상관 서브쿼리를 돌리면 300행짜리 목록 한 번에 300번 센다.
     */
    @Query(
        "select p.regionCode, count(p) from PoiEntity p " +
            "where p.dataStatus = 'ACTIVE' and p.regionCode is not null group by p.regionCode",
    )
    fun countActiveByRegionCode(): List<Array<Any>>
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

    override fun findActiveInBounds(latMin: Double, latMax: Double, lngMin: Double, lngMax: Double): List<Poi> =
        jpa.findActiveInBounds(latMin, latMax, lngMin, lngMax).map { it.toDomain() }

    override fun findActiveByIds(poiIds: List<UUID>): List<Poi> =
        if (poiIds.isEmpty()) emptyList() else jpa.findByPoiIdInAndDataStatus(poiIds, DataStatus.ACTIVE.name).map { it.toDomain() }

    override fun findByIds(poiIds: List<UUID>): List<Poi> =
        if (poiIds.isEmpty()) emptyList() else jpa.findByPoiIdIn(poiIds).map { it.toDomain() }

    override fun findBySourceRefs(source: PoiSource, sourceRefs: Collection<String>): Map<String, Poi> =
        if (sourceRefs.isEmpty()) {
            emptyMap()
        } else {
            jpa.findBySourceAndSourceRefIn(source.name, sourceRefs)
                // sourceRef 가 null 인 행은 애초에 조회되지 않지만, 키가 null 이면 맵이 깨지므로 명시적으로 거른다.
                .mapNotNull { e -> e.sourceRef?.let { it to e.toDomain() } }
                .toMap()
        }

    private fun Poi.toEntity() = PoiEntity(
        poiId = poiId, nameKo = nameKo, lat = lat, lng = lng, category = category.name, region = region,
        regionCode = regionCode,
        openingHours = openingHours, dataStatus = dataStatus.name, source = source.name,
        savedCount = savedCount, createdAt = createdAt, updatedAt = updatedAt,
        imageUrl = imageUrl, tags = tags.toTypedArray(), sourceRef = sourceRef,
    )

    private fun PoiEntity.toDomain() = Poi.reconstitute(
        poiId = poiId, nameKo = nameKo, lat = lat, lng = lng, category = PoiCategory.valueOf(category), region = region,
        regionCode = regionCode,
        openingHours = openingHours, dataStatus = DataStatus.valueOf(dataStatus), source = PoiSource.valueOf(source),
        savedCount = savedCount, createdAt = createdAt, updatedAt = updatedAt,
        imageUrl = imageUrl, tags = tags.toList(), sourceRef = sourceRef,
    )
}
