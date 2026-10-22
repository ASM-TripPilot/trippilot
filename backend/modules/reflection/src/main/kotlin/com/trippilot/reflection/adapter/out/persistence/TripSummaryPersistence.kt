package com.trippilot.reflection.adapter.out.persistence

import com.trippilot.reflection.domain.DayHighlight
import com.trippilot.reflection.domain.DistanceSource
import com.trippilot.reflection.domain.ReflectionSource
import com.trippilot.reflection.domain.TripSummary
import com.trippilot.reflection.domain.TripSummaryRepository
import com.trippilot.reflection.domain.TripSummaryStats
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EntityManager
import jakarta.persistence.Id
import jakarta.persistence.PersistenceContext
import jakarta.persistence.Table
import org.hibernate.annotations.ColumnTransformer
import org.hibernate.annotations.Formula
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import org.slf4j.LoggerFactory
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Component
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * trip_summary 매핑(V2.38). PK 가 `trip_id` 라 여행당 하나가 물리적으로 보장된다.
 *
 * **jsonb 모양이 틀린 행도 실린다**(TRIP-1476). Hibernate 는 엔티티를 싣는 순간 jsonb 를 선언 타입으로 읽어, 모양이 다르면
 * 어댑터의 방어적 읽기에 닿기도 전에 던졌다 — 조회·생성·경로 갱신이 전부 그 자리에서 막혀 스스로 낫지 못했다.
 * - 최상위 모양은 SQL 이 맞춘다(`@ColumnTransformer`) — 배열 칸에 객체가 오면 빈 배열로 읽는다. 원래 모양은 `*Shape` 가 따로 읽어
 *   어댑터가 버린 칸을 남긴다(INV-4).
 * - 배열 원소는 `List<Any?>` 로 받고 어댑터가 거른다 — `List<Map<..>>` 면 원소 하나가 객체가 아니어도 싣기에서 던진다.
 */
@Entity
@Table(name = "trip_summary")
class TripSummaryEntity(
    @Id @Column(name = "trip_id") var tripId: UUID,
    @Column(name = "narrative") var narrative: String,
    @JdbcTypeCode(SqlTypes.JSON)
    @ColumnTransformer(read = "CASE WHEN jsonb_typeof(highlights) = 'array' THEN highlights ELSE jsonb_build_array() END")
    @Column(name = "highlights") var highlights: List<Any?>,
    @JdbcTypeCode(SqlTypes.JSON)
    @ColumnTransformer(read = "CASE WHEN jsonb_typeof(stats) = 'object' THEN stats ELSE jsonb_build_object() END")
    @Column(name = "stats") var stats: Map<String, Any?>,
    @Column(name = "source") var source: String,
    @Column(name = "generated_at") var generatedAt: Instant,
) {
    /** 저장된 jsonb 의 원래 최상위 모양(`array`·`object`…). 읽기 전용 — 대역으로 만든 엔티티에서는 null(모름)이다. */
    @Formula("jsonb_typeof(highlights)") var highlightsShape: String? = null

    @Formula("jsonb_typeof(stats)") var statsShape: String? = null
}

interface TripSummaryJpaRepository : JpaRepository<TripSummaryEntity, UUID> {
    /** 트랜잭션 범위 권고 잠금 — 행이 없어도 잡힌다(첫 생성). FROM 절 형태인 이유는 `GenerationSessionJpaRepository.advisoryXactLock` 주석과 같다. */
    @org.springframework.data.jpa.repository.Query(value = "SELECT 1 FROM pg_advisory_xact_lock(:namespace, :key)", nativeQuery = true)
    fun advisoryXactLock(namespace: Int, key: Int): Int
}

@Component
class TripSummaryRepositoryAdapter(private val jpa: TripSummaryJpaRepository) : TripSummaryRepository {

    @PersistenceContext private lateinit var em: EntityManager

    override fun upsert(summary: TripSummary): TripSummary {
        val existing = jpa.findById(summary.tripId).orElse(null)
        val entity = existing?.apply {
            narrative = summary.narrative
            highlights = summary.highlights.map { it.toMap() }
            stats = summary.stats.toMap()
            source = summary.source.name
            generatedAt = summary.generatedAt
            // 실을 때 읽은 옛 모양이다 — 방금 덮었으니 아래 다시 읽기가 새 값을 "못 읽었다"고 남기지 않게 지운다.
            highlightsShape = null
            statsShape = null
        } ?: summary.toEntity()
        return checkNotNull(jpa.save(entity).toDomain()) { "방금 쓴 요약을 다시 읽지 못했습니다. tripId=${summary.tripId}" }
    }

    override fun find(tripId: UUID): TripSummary? = jpa.findById(tripId).orElse(null)?.toDomain()

    override fun exists(tripId: UUID): Boolean = jpa.existsById(tripId)

    override fun findForUpdate(tripId: UUID): TripSummary? {
        jpa.advisoryXactLock(LOCK_NAMESPACE, tripId.hashCode())
        // 잠근 **뒤에** DB 에서 다시 읽는다 — 같은 트랜잭션이 잠그기 전에 이 행을 실어 뒀으면(조회가 못 읽는 요약을 고칠 때)
        // 영속성 컨텍스트가 그 옛 값을 돌려줘, 잠금을 기다린 사이 겹친 요청이 고친 결과를 못 보고 다시 만든다(검수 재현).
        return jpa.findById(tripId).orElse(null)?.also { em.refresh(it) }?.toDomain()
    }

    // 시도 기록(V2.84)은 엔티티에 매핑하지 않는다 — 요약을 덮는 생성·경로 갱신이 지우지 않게. 쓰기 둘은 호출자의 트랜잭션을 탄다.
    override fun claimAiAttempt(tripId: UUID, now: Instant, staleBefore: Instant, maxAttempts: Int): Int? =
        em.createNativeQuery(
            """
            UPDATE trip_summary SET ai_attempts = ai_attempts + 1, ai_attempted_at = :now
             WHERE trip_id = :tripId AND source = 'RULE' AND ai_attempts < :max
               AND (ai_attempted_at IS NULL OR ai_attempted_at < :staleBefore)
            RETURNING ai_attempts
            """.trimIndent(),
        ).setParameter("now", now).setParameter("tripId", tripId).setParameter("max", maxAttempts).setParameter("staleBefore", staleBefore)
            .resultList.firstOrNull()?.let { (it as Number).toInt() }

    override fun retireAiAttempts(tripId: UUID, maxAttempts: Int) {
        em.createNativeQuery("UPDATE trip_summary SET ai_attempts = GREATEST(ai_attempts, :max) WHERE trip_id = :tripId")
            .setParameter("max", maxAttempts).setParameter("tripId", tripId).executeUpdate()
    }

    @Suppress("UNCHECKED_CAST")
    override fun findAiPending(generatedAfter: Instant, staleBefore: Instant, maxAttempts: Int, limit: Int): List<UUID> =
        (
            em.createNativeQuery(
                """
                SELECT trip_id FROM trip_summary
                 WHERE source = 'RULE' AND generated_at > :after AND ai_attempts < :max
                   AND (ai_attempted_at IS NULL OR ai_attempted_at < :staleBefore)
                 ORDER BY generated_at
                 LIMIT :limit
                """.trimIndent(),
            ).setParameter("after", generatedAfter).setParameter("max", maxAttempts).setParameter("staleBefore", staleBefore)
                .setParameter("limit", limit).resultList as List<Any>
            ).map { it as? UUID ?: UUID.fromString(it.toString()) }

    private fun TripSummary.toEntity() = TripSummaryEntity(
        tripId, narrative, highlights.map { it.toMap() }, stats.toMap(), source.name, generatedAt,
    )

    private fun DayHighlight.toMap(): Map<String, Any?> = mapOf(
        "date" to date.toString(), "dayOrder" to dayOrder, "visitCount" to visitCount, "places" to places,
        "distanceKm" to distanceKm, "distanceSource" to distanceSource?.name,
    )

    private fun TripSummaryStats.toMap(): Map<String, Any?> = mapOf(
        "totalVisits" to totalVisits,
        "totalDistanceKm" to totalDistanceKm,
        "distanceSource" to distanceSource.name,
        "totalPhotos" to totalPhotos,
        "hasLocationData" to hasLocationData,
    )

    /**
     * **못 읽는 요약은 없는 것으로 읽는다**(TRIP-1476) — 본문이 비었거나(PBT-U5-1) 출처가 모르는 단이면 그 행은 이 버전이
     * 쓴 것이 아니다(손상·수동 변경·이 버전이 모르는 단). 요약에는 사용자가 쓴 것이 없어 통째로 다시 만들면 낫는다 — 생성은 여행당 한 번
     * (`TripEnded`)뿐이라, 조회와 경로 갱신이 [exists] 로 이 경우를 알아보고 다시 만든다(`TripSummaryService.find`·`refreshRouteStats`; `generate` 는 같은 값으로 알림 여부를 정한다).
     * 던지면 그 경로들까지 같은 읽기에서 막혀 스스로 낫지 못하고, 출처를 아는 단으로 바꿔 읽으면 품질 관측(DEC-U5-5a)이 거짓이 된다.
     *
     * 나머지 칸은 **읽히는 만큼** 돌려주고, 버린 칸을 남긴다(INV-4) — 다음 생성·경로 갱신이 다시 계산해 덮는다.
     */
    private fun TripSummaryEntity.toDomain(): TripSummary? {
        val readSource = ReflectionSource.entries.firstOrNull { it.name == source }
        if (narrative.isBlank() || readSource == null) {
            log.error("요약을 읽을 수 없어 없는 것으로 다룹니다 — 조회·경로 갱신이 다시 만들어 덮습니다. tripId={} 본문비었음={} source={}", tripId, narrative.isBlank(), source)
            return null
        }
        val dropped = mutableListOf<String>()
        if (highlightsShape != null && highlightsShape != "array") dropped += "highlights"
        if (statsShape != null && statsShape != "object") dropped += "stats"
        val read = highlights.mapNotNull { row ->
            if (row is Map<*, *>) row.toHighlight(dropped) else null.also { dropped += "highlights[]" }
        }
        val summary = TripSummary(tripId, narrative, read, stats.toStats(dropped), readSource, generatedAt)
        if (dropped.isNotEmpty()) log.warn("요약 행 일부를 읽지 못해 읽히는 만큼 돌려줍니다. tripId={} 칸={}", tripId, dropped.distinct())
        return summary
    }

    /** 읽기는 방어적으로 — 못 읽는 조각은 버리고 읽히는 만큼 돌려준다(옛 행이 필드를 덜 가질 수 있다). */
    private fun Map<*, *>.toHighlight(dropped: MutableList<String>): DayHighlight? {
        val date = (this["date"] as? String)?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: return null
        val places = this["places"] as? List<*>
        // 이름이 아닌 원소는 버린다 — 그대로 두면 응답 직렬화(`List<String>`)에서 터져 그 요약 전체가 500 이다.
        if (places != null && places.any { it !is String }) dropped += "highlights[].places"
        return DayHighlight(
            date = date,
            dayOrder = (this["dayOrder"] as? Number)?.toInt() ?: 0,
            visitCount = (this["visitCount"] as? Number)?.toInt() ?: 0,
            places = places?.filterIsInstance<String>().orEmpty(),
            // U10 이전 행에는 없다 — 모른다(null). 0 으로 채우면 실제 0km 로 읽힌다. 다음 생성·경로 갱신 때 채워진다.
            distanceKm = (this["distanceKm"] as? Number)?.toDouble(),
            distanceSource = (this["distanceSource"] as? String)?.let { runCatching { DistanceSource.valueOf(it) }.getOrNull() },
        )
    }

    /** 음수는 0 으로 붙인다 — 도메인이 막는 값이라 그대로 넘기면 그 요약 전체가 500 이다. 다음 갱신이 다시 센다. */
    private fun Map<*, *>.toStats(dropped: MutableList<String>) = TripSummaryStats(
        totalVisits = inRange("totalVisits", dropped)?.toInt() ?: 0,
        totalDistanceKm = inRange("totalDistanceKm", dropped, Double.MAX_VALUE) ?: 0.0,
        distanceSource = (this["distanceSource"] as? String)
            ?.let { runCatching { DistanceSource.valueOf(it) }.getOrNull() } ?: DistanceSource.VISIT_LINE,
        totalPhotos = inRange("totalPhotos", dropped)?.toInt() ?: 0,
        hasLocationData = this["hasLocationData"] as? Boolean ?: false,
    )

    /**
     * 0~max 로 붙이고 남긴다. **Double 에서 붙인 뒤** 정수로 바꾼다 — Int 를 넘는 값(3000000000, Jackson 은 Long)을 바로
     * toInt() 하면 음수로 감겨 도메인 require 가 다시 500 을 낸다(검수 실측). jsonb 는 NaN 을 담지 못하고, 아주 큰 수는 Infinity 로 읽혀 상한으로 붙는다.
     */
    private fun Map<*, *>.inRange(key: String, dropped: MutableList<String>, max: Double = Int.MAX_VALUE.toDouble()): Double? {
        val n = (this[key] as? Number)?.toDouble() ?: return null
        val c = if (n >= 0.0) minOf(n, max) else 0.0
        if (c != n) dropped += "stats.$key"
        return c
    }

    private companion object {
        private val log = LoggerFactory.getLogger(TripSummaryRepositoryAdapter::class.java)

        /** 회고(828)와 갈라 둔다 — 같은 여행 키가 겹쳐도 서로 기다리지 않게. */
        const val LOCK_NAMESPACE = 829
    }
}
