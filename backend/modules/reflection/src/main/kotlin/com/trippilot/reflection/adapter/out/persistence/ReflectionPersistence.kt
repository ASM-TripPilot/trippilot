package com.trippilot.reflection.adapter.out.persistence

import com.trippilot.reflection.domain.DistanceSource
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.reflection.domain.Reflection
import com.trippilot.reflection.domain.ReflectionCard
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
 * reflection 매핑(V2.36 · 카드 전환 V2.44).
 *
 * `stats`·`*_card` 는 Map 으로 jsonb 매핑한다 — 문자열을 미리 직렬화해 넘기면 이중 인코딩되어 jsonb 에
 * 이스케이프된 스칼라가 저장된다(change_log_entry 에서 겪은 것과 같은 함정).
 *
 * **카드는 여기서만 파싱한다.** 도메인은 원문 문자열만 들고 다니고(프레임워크 무의존, R2), `cover` 에서
 * 제목·부제를 뽑는 것도 이 어댑터 몫이다 — 백엔드가 카드를 해석하는 유일한 지점이고 그 이상은 안 본다
 * (DEC-U5-14).
 *
 * 원문이 **바이트 단위로 보존되지는 않는다** — jsonb 가 공백·키 순서를 정규화한다. 카드는 우리가
 * 해석하지 않는 값이라 순서가 의미를 갖지 않는다.
 */
@Entity
@Table(name = "reflection")
class ReflectionEntity(
    @Id @Column(name = "reflection_id") var reflectionId: UUID,
    @Column(name = "trip_id") var tripId: UUID,
    @Column(name = "day_date") var dayDate: LocalDate,
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "draft_card") var draftCard: Map<String, Any?>,
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "edited_card") var editedCard: Map<String, Any?>?,
    /**
     * **초안 카드의** 템플릿·형식이다(수정본 것이 아니다). jsonb 를 파싱하지 않고 "규칙 카드가 몇 %인가"를
     * 세기 위한 투영이고, 읽을 때는 쓰지 않는다 — 카드는 자기 payload 에서 읽는다.
     */
    @Column(name = "template_id") var templateId: String,
    @Column(name = "card_format") var cardFormat: String,
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
class ReflectionRepositoryAdapter(
    private val jpa: ReflectionJpaRepository,
    private val mapper: ObjectMapper,
) : ReflectionRepository {

    /**
     * 하루 한 장. 기존 행이 있으면 **그 행을 고친다** — 새 id 로 넣으면 UNIQUE 에 걸리고,
     * 걸리지 않게 지웠다 넣으면 `generated_at`("언제 처음 만들어졌나")이 사라진다.
     */
    override fun upsert(reflection: Reflection): Reflection {
        val existing = jpa.findByTripIdAndDayDate(reflection.tripId, reflection.dayDate)
        val entity = existing?.apply {
            draftCard = reflection.draftCard.toMap()
            editedCard = reflection.editedCard?.toMap()
            templateId = reflection.draftCard.templateId
            cardFormat = reflection.draftCard.format
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
        reflectionId, tripId, dayDate, draftCard.toMap(), editedCard?.toMap(),
        draftCard.templateId, draftCard.format, source.name,
        stats.toMap(), generatedAt, updatedAt,
    )

    /** 카드 원문(JSON) → jsonb 로 넘길 Map. 문자열 그대로 넘기면 이중 인코딩된다. */
    private fun ReflectionCard.toMap(): Map<String, Any?> {
        @Suppress("UNCHECKED_CAST")
        return mapper.readValue(payload, Map::class.java) as Map<String, Any?>
    }

    /**
     * jsonb → 카드. **`cover` 만 본다**(DEC-U5-14) — 제목·부제가 목록 화면이 쓰는 값이고,
     * `scenes` 안쪽은 우리가 해석하지 않는다.
     *
     * 제목이 비면 카드 생성이 실패한다(PBT-U5-F1). 그건 옳다 — 빈 제목을 통과시키면 목록에
     * 빈 줄이 그려지고, 어디서 비었는지 추적할 근거가 사라진다.
     */
    private fun Map<String, Any?>.toCard(): ReflectionCard {
        val cover = this["cover"] as? Map<*, *>
        return ReflectionCard(
            // **카드 자신의 payload 에서 읽는다.** 컬럼(`template_id`)을 쓰면 그것은 초안 값이라,
            // 사용자가 고친 카드가 왕복 한 번에 `backend.rule.daily.v1` 로 둔갑한다 —
            // "누가 만든 카드인가"를 답하려고 둔 필드가 정확히 거짓이 된다(검수 실측).
            templateId = this["template_id"]?.toString().orEmpty(),
            format = this["format"]?.toString().orEmpty(),
            title = cover?.get("title")?.toString().orEmpty(),
            subtitle = cover?.get("subtitle")?.toString().orEmpty(),
            payload = mapper.writeValueAsString(this),
        )
    }

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
        draftCard = draftCard.toCard(),
        editedCard = editedCard?.toCard(),
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
