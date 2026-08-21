package com.trippilot.placedata.adapter.out.persistence

import com.trippilot.placedata.domain.DataStatus
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiCursor
import com.trippilot.placedata.domain.PoiRepository
import com.trippilot.placedata.domain.PoiSource
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import org.slf4j.LoggerFactory
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
    /**
     * ACTIVE만(INV-U1-01) + 선택 카테고리·이름검색, **지점 이후**부터 상한만큼.
     *
     * ## null 대신 빈 값을 센티넬로 쓴다
     * `:q` 를 null 로 두고 `concat('%', :q, '%')` 를 태우면 드라이버가 타입을 못 정해
     * `operator does not exist: character varying ~~ bytea` 로 **500** 이 난다(실측, `/regions`).
     * 빈 문자열이면 `'%%'` 가 되어 "안 걸렀다"와 같은 뜻이 되므로 분기가 필요 없다.
     * 커서도 같다 — 빈 이름·0 UUID 는 모든 행보다 앞이라 "처음부터"가 된다.
     *
     * ## 정렬과 커서 비교는 **같은 기준**이어야 한다
     * 둘 다 DB 가 한다. 한쪽이라도 앱으로 넘어오면 콜레이션과 코드포인트 순서가 갈려
     * 커서가 가리키는 지점이 정렬 순서와 어긋나고, 행이 중복·누락된다.
     */
    @Query(
        "select p from PoiEntity p where p.dataStatus = 'ACTIVE' " +
            "and (:category is null or p.category = :category) " +
            "and lower(p.nameKo) like lower(concat('%', :q, '%')) escape '\\' " +
            "and (p.nameKo > :afterName or (p.nameKo = :afterName and p.poiId > :afterId)) " +
            "order by p.nameKo, p.poiId",
    )
    fun findActive(
        @Param("category") category: String?,
        @Param("q") q: String,
        @Param("afterName") afterName: String,
        @Param("afterId") afterId: UUID,
        pageable: Pageable,
    ): List<PoiEntity>

    /**
     * 지역 코드 **접두사** 매칭(TRIP-503). `26` → 부산 전체, `26440` → 강서구만.
     *
     * 이름(`p.region`)으로 거르지 않는 이유: 시군구명은 **유일하지 않다**. `동구` 는 대전·대구·광주·부산에
     * 모두 있어 이름으로 거르면 네 도시가 한 목록에 섞인다(실측 118건). 광역명(`부산`)은 적재분에
     * 거의 없어 8건만 잡혔다(코드 기준 149건). 코드가 유일하고 접두사로 롤업까지 된다 —
     * 숙소(`StayEntity.findByRegionPrefix`)가 같은 방식이다.
     */
    @Query(
        "select p from PoiEntity p where p.dataStatus = 'ACTIVE' " +
            "and (:category is null or p.category = :category) " +
            "and substring(p.regionCode, 1, :len) in :codes " +
            "and lower(p.nameKo) like lower(concat('%', :q, '%')) escape '\\' " +
            "and (p.nameKo > :afterName or (p.nameKo = :afterName and p.poiId > :afterId)) " +
            "order by p.nameKo, p.poiId",
    )
    fun findActiveByRegionPrefixes(
        @Param("len") len: Int,
        @Param("codes") codes: Collection<String>,
        @Param("category") category: String?,
        @Param("q") q: String,
        @Param("afterName") afterName: String,
        @Param("afterId") afterId: UUID,
        pageable: Pageable,
    ): List<PoiEntity>

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

    /**
     * **정렬·커서 비교를 DB 한 곳에서만 한다.** 코드별로 나눠 조회하고 앱에서 합쳐 정렬하면 정렬
     * 구현이 둘이 되는데, 그 둘은 같지 않다 — DB 는 콜레이션(`en_US.utf8`)을, JVM 은 코드포인트
     * 순서를 쓴다. 그러면 커서가 가리키는 지점이 정렬과 어긋나 행이 중복·누락된다.
     * (로컬·CI 의 alpine 은 musl 이라 로케일이 사실상 C 로 동작해 **이 차이가 안 드러난다** —
     * glibc 이미지나 관리형 DB 에서만 갈린다. 그래서 테스트로 잡히지 않는 종류다.)
     *
     * 한 이름이 가리키는 코드들은 같은 층이라 길이가 같다(`동구` → 26170·27140). 그래도 길이로 묶어
     * 두는 이유는, 섞이면 `substring` 길이가 어긋나 **조용히 다른 지역을 잡기** 때문이다.
     */
    override fun findActive(
        regionCodes: List<String>,
        category: PoiCategory?,
        query: String,
        after: PoiCursor?,
        limit: Int,
    ): List<Poi> {
        val page = PageRequest.of(0, limit)
        val name = after?.nameKo ?: ""          // 빈 이름은 모든 행보다 앞 — "처음부터"
        val id = after?.poiId ?: FIRST_ID
        if (regionCodes.isEmpty()) {
            return jpa.findActive(category?.name, query, name, id, page).map { it.toDomain() }
        }
        val byLength = regionCodes.groupBy { it.length }
        if (byLength.size == 1) {
            val (len, codes) = byLength.entries.single()
            return jpa.findActiveByRegionPrefixes(len, codes, category?.name, query, name, id, page)
                .map { it.toDomain() }
        }
        // 층이 섞이는 이름은 현재 카탈로그에 없다. 생기면 정렬 권한이 앱으로 넘어오므로 로그로 드러낸다.
        log.warn("지역 코드 길이가 섞였습니다 — 정렬이 DB 콜레이션을 따르지 않습니다. codes={}", regionCodes)
        return byLength.entries
            .flatMap { (len, codes) -> jpa.findActiveByRegionPrefixes(len, codes, category?.name, query, name, id, page) }
            .distinctBy { it.poiId }
            .map { it.toDomain() }
            .sortedWith(compareBy({ it.nameKo }, { it.poiId }))
            .take(limit)
    }

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

    private companion object {
        private val log = LoggerFactory.getLogger("com.trippilot.placedata.poi")

        /** 모든 UUID 보다 앞 — 커서 없음을 값으로 표현한다(분기 대신). */
        private val FIRST_ID: UUID = UUID(0L, 0L)
    }

}
