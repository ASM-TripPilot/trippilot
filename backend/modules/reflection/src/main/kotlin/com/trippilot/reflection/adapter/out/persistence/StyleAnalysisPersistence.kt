package com.trippilot.reflection.adapter.out.persistence

import com.trippilot.reflection.domain.CategoryShare
import com.trippilot.reflection.domain.StyleAnalysis
import com.trippilot.reflection.domain.StyleAnalysisRepository
import com.trippilot.reflection.domain.TraitGauges
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.ColumnTransformer
import org.hibernate.annotations.Formula
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import org.slf4j.LoggerFactory
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Component
import java.time.Instant
import java.util.UUID

/**
 * style_analysis 매핑(V2.39). PK 가 `account_id` 라 계정당 하나가 물리적으로 보장된다.
 *
 * **jsonb 모양이 틀린 행도 실린다**(TRIP-1476). 그러지 않으면 Hibernate 가 싣는 순간 던지는데, 이 행은 개인화
 * (`PersonalizationService.deriveFor`)가 읽고 그것을 일정 생성이 묻기 때문에 행 하나가 그 계정의 일정 생성까지 500 으로 만들었다.
 * 최상위 모양은 SQL 이 맞추고(`@ColumnTransformer`, 원래 모양은 `*Shape`), 배열 원소는 `List<Any?>` 로 받아 어댑터가 거른다.
 */
@Entity
@Table(name = "style_analysis")
class StyleAnalysisEntity(
    @Id @Column(name = "account_id") var accountId: UUID,
    @JdbcTypeCode(SqlTypes.JSON)
    @ColumnTransformer(read = "CASE WHEN jsonb_typeof(descriptors) = 'array' THEN descriptors ELSE jsonb_build_array() END")
    @Column(name = "descriptors") var descriptors: List<Any?>,
    @JdbcTypeCode(SqlTypes.JSON)
    @ColumnTransformer(read = "CASE WHEN jsonb_typeof(trait_gauges) = 'object' THEN trait_gauges ELSE jsonb_build_object() END")
    @Column(name = "trait_gauges") var traitGauges: Map<String, Any?>,
    @JdbcTypeCode(SqlTypes.JSON)
    @ColumnTransformer(
        read = "CASE WHEN jsonb_typeof(category_breakdown) = 'array' THEN category_breakdown ELSE jsonb_build_array() END",
    )
    @Column(name = "category_breakdown") var categoryBreakdown: List<Any?>,
    @Column(name = "avg_places_per_day") var avgPlacesPerDay: Double,
    @Column(name = "avg_radius_km") var avgRadiusKm: Double,
    @Column(name = "avg_dwell_minutes") var avgDwellMinutes: Int?,
    @Column(name = "sample_trip_count") var sampleTripCount: Int,
    @Column(name = "sample_visit_count") var sampleVisitCount: Int,
    @Column(name = "updated_at") var updatedAt: Instant,
) {
    /** 저장된 jsonb 의 원래 최상위 모양(`array`·`object`…). 읽기 전용 — 대역으로 만든 엔티티에서는 null(모름)이다. */
    @Formula("jsonb_typeof(descriptors)") var descriptorsShape: String? = null

    @Formula("jsonb_typeof(trait_gauges)") var traitGaugesShape: String? = null

    @Formula("jsonb_typeof(category_breakdown)") var categoryBreakdownShape: String? = null
}

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
            // 실을 때 읽은 옛 모양이다 — 방금 덮었으니 아래 다시 읽기가 새 값을 "못 읽었다"고 남기지 않게 지운다.
            descriptorsShape = null
            traitGaugesShape = null
            categoryBreakdownShape = null
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

    /**
     * **이 읽기는 던지지 않는다**(TRIP-1476) — 칸 단위로 읽히는 만큼 돌려주고, 고친 칸을 남긴다(INV-4).
     * 모양이 틀린 jsonb 는 비었다고 보고, 범위 밖 수치는 범위 끝으로 붙인다. 재분석(`analyze`)이 행을 통째로 덮어 고친다.
     *
     * 범위 밖을 "못 읽는 값(0)"이 아니라 **끝값으로 붙이는** 이유: 잠정 식(O-U5-9)이 바뀌어 옛 행에 9 가 남았다면
     * 그 행이 말하려던 방향은 "높다"다. 0 으로 읽으면 여유로운 사람이 개인화에서 "알차게"로 뒤집힌다.
     */
    private fun StyleAnalysisEntity.toDomain(): StyleAnalysis {
        val dropped = mutableListOf<String>()
        if (descriptorsShape != null && descriptorsShape != "array") dropped += "descriptors"
        val gaugesObject = traitGaugesShape == null || traitGaugesShape == "object"
        if (!gaugesObject) dropped += "trait_gauges"
        // 속도(개인화)가 읽는 축은 여유로움 하나다 — 그 축이 숫자가 아니면(`{}`·`"x"`) 0 은 자리값이지 저장된 값이 아니다.
        // 다른 축과 달리 남긴다: 이 때문에 개인화가 속도를 빼므로, 말없이 빼면 "왜 속도가 안 들어갔나"를 답할 수 없다(INV-4).
        val easygoingRead = gaugesObject && traitGauges["easygoing"] is Number
        if (gaugesObject && !easygoingRead) dropped += "trait_gauges.easygoing"
        if (categoryBreakdownShape != null && categoryBreakdownShape != "array") dropped += "category_breakdown"
        if (descriptors.any { it !is String }) dropped += "descriptors[]"
        val analysis = StyleAnalysis(
            accountId = accountId,
            descriptors = descriptors.filterIsInstance<String>(),
            traitGauges = traitGauges.toGauges(dropped),
            categoryBreakdown = categoryBreakdown.mapNotNull { row ->
                if (row is Map<*, *>) row.toShare(dropped) else null.also { dropped += "category_breakdown[]" }
            },
            // double precision(V2.41)은 NaN 도 담는다 — `>= 0` 이 그것까지 거른다.
            avgPlacesPerDay = avgPlacesPerDay.takeIf { it >= 0.0 } ?: 0.0.also { dropped += "avg_places_per_day" },
            avgRadiusKm = avgRadiusKm.takeIf { it >= 0.0 } ?: 0.0.also { dropped += "avg_radius_km" },
            // 잴 수 없는 체류는 null 이다 — 0 으로 채우면 "0분 머물렀다"는 거짓말이 된다.
            avgDwellMinutes = avgDwellMinutes?.let { m -> m.takeIf { it >= 0 } ?: null.also { dropped += "avg_dwell_minutes" } },
            sampleTripCount = sampleTripCount,
            sampleVisitCount = sampleVisitCount,
            updatedAt = updatedAt,
            traitGaugesRead = easygoingRead,
        )
        if (dropped.isNotEmpty()) log.warn("스타일 분석 행 일부를 읽지 못해 읽히는 만큼 씁니다. accountId={} 칸={}", accountId, dropped.distinct())
        return analysis
    }

    /** 읽기는 방어적으로 — 잠정 식(O-U5-9)이 바뀌면 축 이름도 바뀔 수 있다. 못 읽는 축은 0 이다. */
    private fun Map<*, *>.toGauges(dropped: MutableList<String>): TraitGauges {
        fun axis(key: String): Int {
            val n = (this[key] as? Number)?.toInt() ?: return 0
            return n.coerceIn(0, TraitGauges.MAX).also { if (it != n) dropped += "trait_gauges.$key" }
        }
        return TraitGauges(easygoing = axis("easygoing"), foodAffinity = axis("foodAffinity"), activeness = axis("activeness"))
    }

    /** 카테고리 이름이 없는 줄은 버린다 — 이름 없는 막대는 화면에 그릴 수 없다. 비율은 0~1 로 붙인다. */
    private fun Map<*, *>.toShare(dropped: MutableList<String>): CategoryShare? {
        val category = this["category"] as? String ?: return null
        val ratio = (this["ratio"] as? Number)?.toDouble() ?: 0.0
        return CategoryShare(
            category = category,
            ratio = ratio.coerceIn(0.0, 1.0).also { if (it != ratio) dropped += "category_breakdown[].ratio" },
            isOther = this["isOther"] as? Boolean ?: false,
        )
    }

    private companion object {
        private val log = LoggerFactory.getLogger(StyleAnalysisRepositoryAdapter::class.java)
    }
}
