package com.trippilot.reflection.adapter.out.persistence

import com.trippilot.reflection.domain.DayHighlight
import com.trippilot.reflection.domain.DistanceSource
import com.trippilot.reflection.domain.ReflectionSource
import com.trippilot.reflection.domain.TripSummary
import com.trippilot.reflection.domain.TripSummaryRepository
import com.trippilot.reflection.domain.TripSummaryStats
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Component
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/** trip_summary 매핑(V2.38). PK 가 `trip_id` 라 여행당 하나가 물리적으로 보장된다. */
@Entity
@Table(name = "trip_summary")
class TripSummaryEntity(
    @Id @Column(name = "trip_id") var tripId: UUID,
    @Column(name = "narrative") var narrative: String,
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "highlights") var highlights: List<Map<String, Any?>>,
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "stats") var stats: Map<String, Any?>,
    @Column(name = "source") var source: String,
    @Column(name = "generated_at") var generatedAt: Instant,
)

interface TripSummaryJpaRepository : JpaRepository<TripSummaryEntity, UUID>

@Component
class TripSummaryRepositoryAdapter(private val jpa: TripSummaryJpaRepository) : TripSummaryRepository {

    override fun upsert(summary: TripSummary): TripSummary {
        val existing = jpa.findById(summary.tripId).orElse(null)
        val entity = existing?.apply {
            narrative = summary.narrative
            highlights = summary.highlights.map { it.toMap() }
            stats = summary.stats.toMap()
            source = summary.source.name
            generatedAt = summary.generatedAt
        } ?: summary.toEntity()
        return jpa.save(entity).toDomain()
    }

    override fun find(tripId: UUID): TripSummary? = jpa.findById(tripId).orElse(null)?.toDomain()

    private fun TripSummary.toEntity() = TripSummaryEntity(
        tripId, narrative, highlights.map { it.toMap() }, stats.toMap(), source.name, generatedAt,
    )

    private fun DayHighlight.toMap(): Map<String, Any?> =
        mapOf("date" to date.toString(), "dayOrder" to dayOrder, "visitCount" to visitCount, "places" to places)

    private fun TripSummaryStats.toMap(): Map<String, Any?> = mapOf(
        "totalVisits" to totalVisits,
        "totalDistanceKm" to totalDistanceKm,
        "distanceSource" to distanceSource.name,
        "totalPhotos" to totalPhotos,
        "hasLocationData" to hasLocationData,
    )

    private fun TripSummaryEntity.toDomain() = TripSummary(
        tripId = tripId,
        narrative = narrative,
        highlights = highlights.mapNotNull { it.toHighlight() },
        stats = stats.toStats(),
        source = ReflectionSource.valueOf(source),
        generatedAt = generatedAt,
    )

    /** 읽기는 방어적으로 — 못 읽는 조각은 버리고 읽히는 만큼 돌려준다(옛 행이 필드를 덜 가질 수 있다). */
    @Suppress("UNCHECKED_CAST")
    private fun Map<String, Any?>.toHighlight(): DayHighlight? {
        val date = (this["date"] as? String)?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: return null
        return DayHighlight(
            date = date,
            dayOrder = (this["dayOrder"] as? Number)?.toInt() ?: 0,
            visitCount = (this["visitCount"] as? Number)?.toInt() ?: 0,
            places = (this["places"] as? List<String>).orEmpty(),
        )
    }

    private fun Map<String, Any?>.toStats() = TripSummaryStats(
        totalVisits = (this["totalVisits"] as? Number)?.toInt() ?: 0,
        totalDistanceKm = (this["totalDistanceKm"] as? Number)?.toDouble() ?: 0.0,
        distanceSource = (this["distanceSource"] as? String)
            ?.let { runCatching { DistanceSource.valueOf(it) }.getOrNull() } ?: DistanceSource.VISIT_LINE,
        totalPhotos = (this["totalPhotos"] as? Number)?.toInt() ?: 0,
        hasLocationData = this["hasLocationData"] as? Boolean ?: false,
    )
}
