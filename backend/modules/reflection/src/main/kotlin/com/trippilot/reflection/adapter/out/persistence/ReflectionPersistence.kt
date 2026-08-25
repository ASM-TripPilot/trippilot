package com.trippilot.reflection.adapter.out.persistence

import com.trippilot.reflection.domain.DistanceSource
import com.trippilot.reflection.domain.Reflection
import com.trippilot.reflection.domain.ReflectionRepository
import com.trippilot.reflection.domain.ReflectionSource
import com.trippilot.reflection.domain.ReflectionStats
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

/**
 * reflection 매핑(V2.36).
 *
 * `stats` 는 Map 으로 jsonb 매핑한다 — 문자열을 미리 직렬화해 넘기면 이중 인코딩되어 jsonb 에
 * 이스케이프된 스칼라가 저장된다(change_log_entry 에서 겪은 것과 같은 함정).
 */
@Entity
@Table(name = "reflection")
class ReflectionEntity(
    @Id @Column(name = "reflection_id") var reflectionId: UUID,
    @Column(name = "trip_id") var tripId: UUID,
    @Column(name = "day_date") var dayDate: LocalDate,
    @Column(name = "draft_narrative") var draftNarrative: String,
    @Column(name = "edited_narrative") var editedNarrative: String?,
    @Column(name = "source") var source: String,
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "stats") var stats: Map<String, Any?>,
    @Column(name = "generated_at") var generatedAt: Instant,
    @Column(name = "updated_at") var updatedAt: Instant,
)

interface ReflectionJpaRepository : JpaRepository<ReflectionEntity, UUID> {
    fun findByTripIdAndDayDate(tripId: UUID, dayDate: LocalDate): ReflectionEntity?
    fun findByTripIdOrderByDayDate(tripId: UUID): List<ReflectionEntity>
}

@Component
class ReflectionRepositoryAdapter(private val jpa: ReflectionJpaRepository) : ReflectionRepository {

    /**
     * 하루 한 장. 기존 행이 있으면 **그 행을 고친다** — 새 id 로 넣으면 UNIQUE 에 걸리고,
     * 걸리지 않게 지웠다 넣으면 `generated_at`("언제 처음 만들어졌나")이 사라진다.
     */
    override fun upsert(reflection: Reflection): Reflection {
        val existing = jpa.findByTripIdAndDayDate(reflection.tripId, reflection.dayDate)
        val entity = existing?.apply {
            draftNarrative = reflection.draftNarrative
            editedNarrative = reflection.editedNarrative
            source = reflection.source.name
            stats = reflection.stats.toMap()
            updatedAt = reflection.updatedAt
        } ?: reflection.toEntity()
        return jpa.save(entity).toDomain()
    }

    override fun find(tripId: UUID, dayDate: LocalDate): Reflection? =
        jpa.findByTripIdAndDayDate(tripId, dayDate)?.toDomain()

    override fun findByTrip(tripId: UUID): List<Reflection> =
        jpa.findByTripIdOrderByDayDate(tripId).map { it.toDomain() }

    private fun Reflection.toEntity() = ReflectionEntity(
        reflectionId, tripId, dayDate, draftNarrative, editedNarrative, source.name,
        stats.toMap(), generatedAt, updatedAt,
    )

    private fun ReflectionStats.toMap(): Map<String, Any?> = mapOf(
        "visitCount" to visitCount,
        "distanceKm" to distanceKm,
        "distanceSource" to distanceSource.name,
        "photoCount" to photoCount,
    )

    private fun ReflectionEntity.toDomain() = Reflection(
        reflectionId = reflectionId,
        tripId = tripId,
        dayDate = dayDate,
        draftNarrative = draftNarrative,
        editedNarrative = editedNarrative,
        source = ReflectionSource.valueOf(source),
        stats = stats.toStats(),
        generatedAt = generatedAt,
        updatedAt = updatedAt,
    )

    /**
     * jsonb → 근거 수치. **읽기는 방어적으로** 한다 — 옛 행에 없는 필드를 단정 캐스팅하면
     * 그 여행의 회고가 영구히 500 이 된다(change_log_entry 에서 같은 판단을 했다).
     * 다만 `stats` 는 비어 있을 수 없다는 것이 불변식이라(INV-U5-07) 못 읽으면 0으로 채운다.
     */
    private fun Map<String, Any?>.toStats() = ReflectionStats(
        visitCount = (this["visitCount"] as? Number)?.toInt() ?: 0,
        distanceKm = (this["distanceKm"] as? Number)?.toDouble() ?: 0.0,
        distanceSource = (this["distanceSource"] as? String)
            ?.let { runCatching { DistanceSource.valueOf(it) }.getOrNull() } ?: DistanceSource.VISIT_LINE,
        photoCount = (this["photoCount"] as? Number)?.toInt() ?: 0,
    )
}
