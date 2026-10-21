package com.trippilot.accommodationsearch.adapter.out.persistence

import com.trippilot.accommodationsearch.domain.CuratedStay
import com.trippilot.accommodationsearch.domain.CuratedStayPort
import com.trippilot.placedata.api.RegionLookupFacade
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.IdClass
import jakarta.persistence.Table
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Component
import java.io.Serializable

/** curated_stay 매핑. 반복 시드가 채우고 앱은 읽기만 한다. */
@Entity
@Table(name = "curated_stay")
@IdClass(CuratedStayId::class)
class CuratedStayEntity(
    @Id @Column(name = "city") var city: String = "",
    @Id @Column(name = "rank") var rank: Int = 0,
    @Column(name = "tripcom_hotel_id") var tripcomHotelId: String = "",
    @Column(name = "name") var name: String = "",
    @Column(name = "address") var address: String? = null,
    @Column(name = "image_url") var imageUrl: String = "",
) {
    fun toDomain() = CuratedStay(city, rank, tripcomHotelId, name, address, imageUrl)
}

data class CuratedStayId(var city: String = "", var rank: Int = 0) : Serializable

interface CuratedStayJpaRepository : JpaRepository<CuratedStayEntity, CuratedStayId> {
    fun findByCityOrderByRank(city: String): List<CuratedStayEntity>
    fun findByTripcomHotelId(tripcomHotelId: String): CuratedStayEntity?

    @Query("select distinct c.city from CuratedStayEntity c")
    fun findCities(): List<String>
}

@Component
class CuratedStayAdapter(
    private val repo: CuratedStayJpaRepository,
    private val regions: RegionLookupFacade,
) : CuratedStayPort {
    override fun byCity(city: String): List<CuratedStay> = repo.findByCityOrderByRank(city).map { it.toDomain() }

    // 도시 이름('강릉')은 카탈로그 별칭이라 codesOf 가 코드('51150')를 준다 — 매핑 표를 따로 두지 않는다.
    // ponytail: 요청마다 도시 수만큼 별칭 조회. 도시가 수십 개로 늘면 도시→코드를 캐시한다.
    override fun byRegionCode(regionCode: String): List<CuratedStay> =
        repo.findCities()
            .firstOrNull { city -> regions.codesOf(city).any { regionCode.startsWith(family(it)) } }
            ?.let(::byCity)
            .orEmpty()

    override fun findByHotelId(hotelId: String): CuratedStay? = repo.findByTripcomHotelId(hotelId)?.toDomain()
}

/**
 * 그 코드 아래 행정구역이 공유하는 접두사. 일반시(끝자리 0, `52110` 전주시)는 그 행정구(`52111`·`52113`)를
 * 품어야 해서 끝자리를 뗀다. 시도(2자리)·자치구·군은 코드 그대로다.
 */
internal fun family(code: String): String = if (code.length == 5 && code.endsWith('0')) code.dropLast(1) else code
