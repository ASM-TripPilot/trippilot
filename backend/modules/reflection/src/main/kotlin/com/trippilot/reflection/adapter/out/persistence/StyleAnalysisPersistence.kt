package com.trippilot.reflection.adapter.out.persistence

import com.trippilot.reflection.domain.CategoryShare
import com.trippilot.reflection.domain.StyleAnalysis
import com.trippilot.reflection.domain.StyleAnalysisRepository
import com.trippilot.reflection.domain.TraitGauges
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Component
import java.time.Instant
import java.util.UUID

/** style_analysis 매핑(V2.39). PK 가 `account_id` 라 계정당 하나가 물리적으로 보장된다. */
@Entity
@Table(name = "style_analysis")
class StyleAnalysisEntity(
    @Id @Column(name = "account_id") var accountId: UUID,
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "descriptors") var descriptors: List<String>,
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "trait_gauges") var traitGauges: Map<String, Any?>,
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "category_breakdown") var categoryBreakdown: List<Map<String, Any?>>,
    @Column(name = "avg_places_per_day") var avgPlacesPerDay: Double,
    @Column(name = "avg_radius_km") var avgRadiusKm: Double,
    @Column(name = "avg_dwell_minutes") var avgDwellMinutes: Int?,
    @Column(name = "sample_trip_count") var sampleTripCount: Int,
    @Column(name = "sample_visit_count") var sampleVisitCount: Int,
    @Column(name = "updated_at") var updatedAt: Instant,
)

interface StyleAnalysisJpaRepository : JpaRepository<StyleAnalysisEntity, UUID>

@Component
class StyleAnalysisRepositoryAdapter(private val jpa: StyleAnalysisJpaRepository) : StyleAnalysisRepository {

    override fun upsert(analysis: StyleAnalysis): StyleAnalysis {
        val existing = jpa.findById(analysis.accountId).orElse(null)
        val entity = existing?.apply {
            descriptors = analysis.descriptors
            traitGauges = analysis.traitGauges.toMap()
            categoryBreakdown = analysis.categoryBreakdown.map { it.toMap() }
            avgPlacesPerDay = analysis.avgPlacesPerDay
            avgRadiusKm = analysis.avgRadiusKm
            avgDwellMinutes = analysis.avgDwellMinutes
            sampleTripCount = analysis.sampleTripCount
            sampleVisitCount = analysis.sampleVisitCount
            updatedAt = analysis.updatedAt
        } ?: analysis.toEntity()
        return jpa.save(entity).toDomain()
    }

    override fun find(accountId: UUID): StyleAnalysis? = jpa.findById(accountId).orElse(null)?.toDomain()

    private fun StyleAnalysis.toEntity() = StyleAnalysisEntity(
        accountId, descriptors, traitGauges.toMap(), categoryBreakdown.map { it.toMap() },
        avgPlacesPerDay, avgRadiusKm, avgDwellMinutes, sampleTripCount, sampleVisitCount, updatedAt,
    )

    private fun TraitGauges.toMap(): Map<String, Any?> =
        mapOf("easygoing" to easygoing, "foodAffinity" to foodAffinity, "activeness" to activeness)

    private fun CategoryShare.toMap(): Map<String, Any?> =
        mapOf("category" to category, "ratio" to ratio, "isOther" to isOther)

    private fun StyleAnalysisEntity.toDomain() = StyleAnalysis(
        accountId = accountId,
        descriptors = descriptors,
        traitGauges = traitGauges.toGauges(),
        categoryBreakdown = categoryBreakdown.mapNotNull { it.toShare() },
        avgPlacesPerDay = avgPlacesPerDay,
        avgRadiusKm = avgRadiusKm,
        avgDwellMinutes = avgDwellMinutes,
        sampleTripCount = sampleTripCount,
        sampleVisitCount = sampleVisitCount,
        updatedAt = updatedAt,
    )

    /** 읽기는 방어적으로 — 잠정 식(O-U5-9)이 바뀌면 축 이름도 바뀔 수 있다. 못 읽는 축은 0 이다. */
    private fun Map<String, Any?>.toGauges() = TraitGauges(
        easygoing = (this["easygoing"] as? Number)?.toInt() ?: 0,
        foodAffinity = (this["foodAffinity"] as? Number)?.toInt() ?: 0,
        activeness = (this["activeness"] as? Number)?.toInt() ?: 0,
    )

    /** 카테고리 이름이 없는 줄은 버린다 — 이름 없는 막대는 화면에 그릴 수 없다. */
    private fun Map<String, Any?>.toShare(): CategoryShare? {
        val category = this["category"] as? String ?: return null
        return CategoryShare(
            category = category,
            ratio = (this["ratio"] as? Number)?.toDouble() ?: 0.0,
            isOther = this["isOther"] as? Boolean ?: false,
        )
    }
}
