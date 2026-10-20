package com.trippilot.reflection.adapter.out.persistence

import com.trippilot.reflection.domain.DistanceSource
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ErrorCode
import com.trippilot.reflection.domain.Reflection
import com.trippilot.reflection.domain.ReflectionCard
import com.trippilot.reflection.domain.ReflectionRepository
import com.trippilot.reflection.domain.ReflectionSource
import com.trippilot.reflection.domain.ReflectionStats
import com.trippilot.reflection.domain.UnreadableDraft
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EntityManager
import jakarta.persistence.Id
import jakarta.persistence.LockModeType
import jakarta.persistence.PersistenceContext
import jakarta.persistence.Table
import org.hibernate.annotations.ColumnTransformer
import org.hibernate.annotations.Formula
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import org.slf4j.LoggerFactory
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Component
import java.time.Instant
import java.time.LocalDate
import java.util.Objects
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
 *
 * **jsonb 모양이 틀린 행도 실린다**(TRIP-1476) — 객체가 아닌 칸은 SQL 이 빈 객체로 읽고(`@ColumnTransformer`), 원래 모양은
 * `*Shape` 가 따로 읽는다. 그러지 않으면 Hibernate 가 싣는 순간 던져, 한 하루 때문에 그 여행의 회고 목록 전체가 500 이었다.
 * 무엇을 할지는 어댑터가 정한다 — 초안·출처는 다시 만들면 낫는 하루로, 수정본은 쓰지 않는 하루로, 수치는 0 으로(아래 [ReflectionRepositoryAdapter]).
 */
@Entity
@Table(name = "reflection")
class ReflectionEntity(
    @Id @Column(name = "reflection_id") var reflectionId: UUID,
    @Column(name = "trip_id") var tripId: UUID,
    @Column(name = "day_date") var dayDate: LocalDate,
    @JdbcTypeCode(SqlTypes.JSON)
    @ColumnTransformer(read = "CASE WHEN jsonb_typeof(draft_card) = 'object' THEN draft_card ELSE jsonb_build_object() END")
    @Column(name = "draft_card") var draftCard: Map<String, Any?>,
    @JdbcTypeCode(SqlTypes.JSON)
    @ColumnTransformer(
        read = "CASE WHEN edited_card IS NULL OR jsonb_typeof(edited_card) = 'object' THEN edited_card ELSE jsonb_build_object() END",
    )
    @Column(name = "edited_card") var editedCard: Map<String, Any?>?,
    /**
     * **초안 카드의** 템플릿·형식이다(수정본 것이 아니다). jsonb 를 파싱하지 않고 "규칙 카드가 몇 %인가"를
     * 세기 위한 투영이고, 읽을 때는 쓰지 않는다 — 카드는 자기 payload 에서 읽는다.
     */
    @Column(name = "template_id") var templateId: String,
    @Column(name = "card_format") var cardFormat: String,
    @Column(name = "source") var source: String,
    @JdbcTypeCode(SqlTypes.JSON)
    @ColumnTransformer(read = "CASE WHEN jsonb_typeof(stats) = 'object' THEN stats ELSE jsonb_build_object() END")
    @Column(name = "stats") var stats: Map<String, Any?>,
    @Column(name = "generated_at") var generatedAt: Instant,
    @Column(name = "updated_at") var updatedAt: Instant,
    @Column(name = "mood") var mood: String? = null,
    @Column(name = "short_memo") var shortMemo: String? = null,
) {
    /** 저장된 jsonb 의 원래 최상위 모양(`object`·`array`…). 읽기 전용 — 대역으로 만든 엔티티에서는 null(모름)이다. */
    @Formula("jsonb_typeof(draft_card)") var draftCardShape: String? = null

    @Formula("jsonb_typeof(edited_card)") var editedCardShape: String? = null

    @Formula("jsonb_typeof(stats)") var statsShape: String? = null
}

interface ReflectionJpaRepository : JpaRepository<ReflectionEntity, UUID> {
    fun findByTripIdAndDayDate(tripId: UUID, dayDate: LocalDate): ReflectionEntity?
    fun findByTripIdOrderByDayDate(tripId: UUID): List<ReflectionEntity>
    fun existsByTripIdAndDayDate(tripId: UUID, dayDate: LocalDate): Boolean

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from ReflectionEntity r where r.tripId = :tripId and r.dayDate = :dayDate")
    fun lockByTripIdAndDayDate(tripId: UUID, dayDate: LocalDate): ReflectionEntity?

    /** 트랜잭션 범위 권고 잠금. FROM 절 형태인 이유는 `GenerationSessionJpaRepository.advisoryXactLock` 주석과 같다. */
    @Query(value = "SELECT 1 FROM pg_advisory_xact_lock(:namespace, :key)", nativeQuery = true)
    fun advisoryXactLock(namespace: Int, key: Int): Int
}

@Component
class ReflectionRepositoryAdapter(
    private val jpa: ReflectionJpaRepository,
    private val mapper: ObjectMapper,
) : ReflectionRepository {

    @PersistenceContext private lateinit var em: EntityManager

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
            mood = reflection.mood
            shortMemo = reflection.shortMemo
            // 실을 때 읽은 옛 모양이다 — 방금 덮었으니 아래 다시 읽기가 새 값을 "못 읽었다"고 다루지 않게 지운다.
            draftCardShape = null
            editedCardShape = null
            statsShape = null
        } ?: reflection.toEntity()
        return jpa.save(entity).toDomain()
    }

    override fun find(tripId: UUID, dayDate: LocalDate): Reflection? =
        jpa.findByTripIdAndDayDate(tripId, dayDate)?.toDomain()

    override fun exists(tripId: UUID, dayDate: LocalDate): Boolean = jpa.existsByTripIdAndDayDate(tripId, dayDate)

    /**
     * 행 잠금만으로는 **아직 행이 없는 하루**를 못 막는다 — 겹친 첫 쓰기 둘이 모두 "없음"을 읽고 넣어
     * 진 쪽이 UNIQUE 위반(500)으로 끝났다. 그 하루에 권고 잠금을 먼저 걸어, 뒤 요청이 앞 요청의 행을 읽게 한다.
     */
    override fun findForUpdate(tripId: UUID, dayDate: LocalDate): Reflection? {
        jpa.advisoryXactLock(LOCK_NAMESPACE, Objects.hash(tripId, dayDate))
        return lockedFresh(tripId, dayDate)?.toDomain()
    }

    /**
     * 잠그고 **DB 에서 다시** 싣는다. 같은 트랜잭션이 잠그기 전에 이 행을 실어 뒀으면(생성이 AI 를 부르기 전에 그 하루를 먼저 본다)
     * 잠금 질의도 영속성 컨텍스트의 옛 값을 돌려준다 — 그 사이 들어온 기분·수정본을 옛 값으로 덮게 된다.
     */
    private fun lockedFresh(tripId: UUID, dayDate: LocalDate): ReflectionEntity? =
        jpa.lockByTripIdAndDayDate(tripId, dayDate)?.also { em.refresh(it) }

    override fun findForRedraft(tripId: UUID, dayDate: LocalDate, draft: ReflectionCard, source: ReflectionSource): Reflection? {
        jpa.advisoryXactLock(LOCK_NAMESPACE, Objects.hash(tripId, dayDate))
        return lockedFresh(tripId, dayDate)?.toDomain(redraft = draft to source)
    }

    /**
     * **못 읽는 하루는 목록에서 빼고 남긴다**(TRIP-1476) — 한 장 때문에 그 여행의 회고 전체가 500 이 되지 않게. 사유는 [toDomain] 이 남겼다.
     * 그 하루의 쓰기는 무엇을 못 읽었는가로 갈린다([toDomain]).
     */
    override fun findByTrip(tripId: UUID): List<Reflection> =
        jpa.findByTripIdOrderByDayDate(tripId).mapNotNull { row ->
            try {
                row.toDomain()
            } catch (_: UnreadableDraft) {
                null
            } catch (_: ConflictDetected) {
                null
            }
        }

    private fun Reflection.toEntity() = ReflectionEntity(
        reflectionId, tripId, dayDate, draftCard.toMap(), editedCard?.toMap(),
        draftCard.templateId, draftCard.format, source.name,
        stats.toMap(), generatedAt, updatedAt, mood, shortMemo,
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
    private fun Map<String, Any?>.toCard(shape: String?): ReflectionCard {
        // 객체가 아니던 카드는 SQL 이 빈 객체로 읽어 온다 — 제목 검사로도 막히지만, 사유를 그것대로 남긴다.
        require(shape == null || shape == "object") { "회고 카드가 객체가 아닙니다(jsonb $shape)." }
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

    /**
     * 카드·출처를 못 읽으면 **행 단위로 던진다**(TRIP-1476). 칸 하나를 대체값으로 읽으면 다음 쓰기가 그 대체값을 저장한다 — 출처를
     * 아는 단으로 바꿔 읽으면 품질 관측(DEC-U5-5a)의 원래 값이 사라지고, 수정본을 비우면 사용자가 쓴 글이 사라진다. 무엇을 못 읽었나로 갈린다.
     * - **수정본**: 사용자가 쓴 것이라 이 하루에는 아무것도 쓰지 않는다 — 409 `REFLECTION_UNREADABLE`.
     * - **초안·출처**: [UnreadableDraft] — 초안은 다시 만들 수 있다. 생성·수정이 [findForRedraft] 로 초안·출처만 갈아끼워 고친다([redraft]).
     */
    private fun ReflectionEntity.toDomain(redraft: Pair<ReflectionCard, ReflectionSource>? = null): Reflection {
        val edited = try {
            editedCard?.toCard(editedCardShape)
        } catch (e: IllegalArgumentException) {
            log.error(
                "회고 수정본을 읽을 수 없어 이 하루는 목록에서 빼고 쓰기는 거절합니다 — 행은 그대로 둡니다. tripId={} date={} 사유={}",
                tripId, dayDate, e.message,
            )
            throw ConflictDetected(message = "이 날의 회고를 읽을 수 없어 저장할 수 없어요.", errorCode = ErrorCode.REFLECTION_UNREADABLE)
        }
        val (draft, readSource) = redraft ?: try {
            draftCard.toCard(draftCardShape) to ReflectionSource.valueOf(source)
        } catch (e: IllegalArgumentException) {
            log.error(
                "회고 초안·출처를 읽을 수 없어 이 하루는 목록에서 뺍니다 — 다음 생성·수정이 초안을 다시 만들어 고칩니다. tripId={} date={} 사유={}",
                tripId, dayDate, e.message,
            )
            throw UnreadableDraft(e.message.orEmpty())
        }
        return Reflection(
            reflectionId = reflectionId,
            tripId = tripId,
            dayDate = dayDate,
            draftCard = draft,
            editedCard = edited,
            source = readSource,
            stats = statsOf(this),
            generatedAt = generatedAt,
            updatedAt = updatedAt,
            mood = mood,
            shortMemo = shortMemo,
        )
    }

    /**
     * jsonb → 근거 수치. **읽기는 방어적으로** 한다 — 옛 행에 없는 필드를 단정 캐스팅하면
     * 그 여행의 회고가 영구히 500 이 된다(change_log_entry 에서 같은 판단을 했다).
     * 다만 `stats` 는 비어 있을 수 없다는 것이 불변식이라(INV-U5-07) 못 읽으면 0으로 채운다.
     * 객체가 아닌 `stats`·음수도 못 읽는 값이다(TRIP-1476) — 0 으로 채우고 남긴다. 다음 생성·경로 갱신이 다시 센다.
     */
    private fun statsOf(row: ReflectionEntity): ReflectionStats {
        val dropped = mutableListOf<String>()
        if (row.statsShape != null && row.statsShape != "object") dropped += "stats"
        val m = row.stats
        fun nonNegative(key: String): Number? {
            val n = m[key] as? Number ?: return null
            return if (n.toDouble() >= 0.0) n else 0.also { dropped += "stats.$key" }
        }
        val stats = ReflectionStats(
            visitCount = nonNegative("visitCount")?.toInt() ?: 0,
            distanceKm = nonNegative("distanceKm")?.toDouble() ?: 0.0,
            distanceSource = (m["distanceSource"] as? String)
                ?.let { runCatching { DistanceSource.valueOf(it) }.getOrNull() } ?: DistanceSource.VISIT_LINE,
            photoCount = nonNegative("photoCount")?.toInt() ?: 0,
        )
        if (dropped.isNotEmpty()) log.warn("회고 근거 수치 일부를 읽지 못해 0 으로 채웁니다. tripId={} date={} 칸={}", row.tripId, row.dayDate, dropped)
        return stats
    }

    companion object {
        private val log = LoggerFactory.getLogger(ReflectionRepositoryAdapter::class.java)

        /** 다른 용도의 권고 잠금(생성 세션 403)과 안 겹치게 하는 이름공간. */
        private const val LOCK_NAMESPACE = 828
    }
}
