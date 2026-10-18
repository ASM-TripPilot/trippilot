package com.trippilot.accommodationsearch.adapter.out.persistence

import com.trippilot.accommodationsearch.domain.CuratedStay
import com.trippilot.accommodationsearch.domain.CuratedStayPort
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.IdClass
import jakarta.persistence.Table
import org.springframework.data.jpa.repository.JpaRepository
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
}

@Component
class CuratedStayAdapter(
    private val repo: CuratedStayJpaRepository,
) : CuratedStayPort {
    override fun byCity(city: String): List<CuratedStay> = repo.findByCityOrderByRank(city).map { it.toDomain() }

    override fun findByHotelId(hotelId: String): CuratedStay? = repo.findByTripcomHotelId(hotelId)?.toDomain()
}
