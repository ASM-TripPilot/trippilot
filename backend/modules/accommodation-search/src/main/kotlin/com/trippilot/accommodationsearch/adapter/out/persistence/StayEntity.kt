package com.trippilot.accommodationsearch.adapter.out.persistence

import com.trippilot.accommodationsearch.domain.Stay
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.IdClass
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.io.Serializable

/** stay(V2.26) 매핑. 시드가 채우고 앱은 읽기만 한다. */
@Entity
@Table(name = "stay")
@IdClass(StayId::class)
class StayEntity(
    @Id @Column(name = "external_source") var externalSource: String = "",
    @Id @Column(name = "external_id") var externalId: String = "",
    @Column(name = "name") var name: String = "",
    @Column(name = "lat") var lat: Double = 0.0,
    @Column(name = "lng") var lng: Double = 0.0,
    @Column(name = "region") var region: String = "",
    @Column(name = "region_code") var regionCode: String? = null,
    @Column(name = "stay_type") var stayType: String = "",
    // text[] 매핑은 poi.tags 선례와 동일 — 컨버터 없이 Hibernate 네이티브 배열.
    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "amenities") var amenities: Array<String> = emptyArray(),
)

/** 복합 PK 식별자. 엔티티와 달리 ID 클래스는 값이므로 `data class` 가 맞다. */
data class StayId(var externalSource: String = "", var externalId: String = "") : Serializable

interface StayJpaRepository : JpaRepository<StayEntity, StayId> {

    /**
     * 지역코드 **접두사** 조회. 시도 코드(2자리)는 그 안 시군구 코드(5자리)의 접두사라
     * `11` 하나로 서울 전체가 잡힌다 — 시도를 목적지로 고른 사용자에게 그게 맞다.
     *
     * 코드는 숫자뿐이라 LIKE 메타문자가 섞일 수 없다(이스케이프 불필요).
     */
    @Query("select s from StayEntity s where s.regionCode like concat(:code, '%') order by s.name")
    fun findByRegionPrefix(@Param("code") code: String): List<StayEntity>

    fun findAllByOrderByName(): List<StayEntity>
}
