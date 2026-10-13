package com.trippilot.recalculation.adapter.out.persistence

import com.trippilot.recalculation.domain.OriginKind
import com.trippilot.recalculation.domain.ReplanOrigin
import com.trippilot.recalculation.domain.ReplanScope
import com.trippilot.recalculation.domain.ReplanSession
import com.trippilot.recalculation.domain.ReplanSessionRepository
import com.trippilot.recalculation.domain.ReplanStatus
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import jakarta.persistence.LockModeType
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Component
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * replan_session 매핑(V2.17 · `target_date` 는 V2.60).
 *
 * `reasons`·`directives`·`excluded_poi_ids` 는 Postgres 배열이다. `@JdbcTypeCode(SqlTypes.ARRAY)` 로
 * 매핑하며 **컬렉션 매핑(@ElementCollection)을 쓰지 않는다** — 그랬다면 별도 조인 테이블이 생겨
 * 마이그레이션(배열 컬럼)과 어긋난다.
 */
@Entity
@Table(name = "replan_session")
class ReplanSessionEntity(
    @Id @Column(name = "session_id") var sessionId: UUID,
    @Column(name = "trip_id") var tripId: UUID,
    @Column(name = "itinerary_id") var itineraryId: UUID,
    @Column(name = "trigger_id") var triggerId: UUID?,
    @Column(name = "scope") var scope: String,
    @Column(name = "target_date") var targetDate: LocalDate,
    @Column(name = "from_instant") var fromInstant: Instant,
    @Column(name = "origin_kind") var originKind: String,
    @Column(name = "origin_lat") var originLat: Double?,
    @Column(name = "origin_lng") var originLng: Double?,
    @JdbcTypeCode(SqlTypes.ARRAY) @Column(name = "reasons") var reasons: Array<String>,
    @JdbcTypeCode(SqlTypes.ARRAY) @Column(name = "directives") var directives: Array<String>,
    @Column(name = "free_text") var freeText: String?,
    @JdbcTypeCode(SqlTypes.ARRAY) @Column(name = "excluded_poi_ids") var excludedPoiIds: Array<UUID>,
    @Column(name = "status") var status: String,
    @JdbcTypeCode(SqlTypes.JSON) @Column(name = "draft") var draft: Map<String, Any>?,
    @Column(name = "created_at") var createdAt: Instant,
    @Column(name = "closed_at") var closedAt: Instant?,
) {
    protected constructor() : this(
        UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), null, "", LocalDate.EPOCH, Instant.EPOCH, "", null, null,
        emptyArray(), emptyArray(), null, emptyArray(), "", null, Instant.EPOCH, null,
    )
}

interface ReplanSessionJpaRepository : JpaRepository<ReplanSessionEntity, UUID> {
    fun findFirstByTripIdAndStatusIn(tripId: UUID, statuses: Collection<String>): ReplanSessionEntity?

    /** 행 잠금 조회 — 비동기 산출과 취소·재진입의 경합을 직렬화한다(`SELECT … FOR UPDATE`). */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from ReplanSessionEntity s where s.sessionId = :sessionId")
    fun findForUpdate(sessionId: UUID): ReplanSessionEntity?

    /**
     * 위치 동의 철회 파기(TRIP-992). 좌표만 null 로 지우면 CHECK(GPS·MANUAL 은 좌표 필수)에 걸린다 —
     * kind 를 PURGED 로 함께 바꿔 "파기됐다"는 사실을 값으로 남긴다(다른 실값으로 바꾸면 출처 조작이다).
     */
    @Modifying(clearAutomatically = true)
    @Query(
        "update ReplanSessionEntity s set s.originKind = 'PURGED', s.originLat = null, s.originLng = null " +
            "where s.tripId in :tripIds and s.originKind in ('GPS', 'MANUAL')",
    )
    fun purgeOrigins(tripIds: List<UUID>): Int
}

@Component
class ReplanSessionPersistence(private val jpa: ReplanSessionJpaRepository) : ReplanSessionRepository {

    /**
     * **`saveAndFlush`** 여야 한다. 새 진입은 한 트랜잭션에서 "기존 세션 CANCELED → 새 세션 INSERT" 를 잇는데,
     * 일반 `save` 는 UPDATE 를 커밋 시점까지 미뤄 **INSERT 가 먼저 나간다** — 그 순간 열린 세션이 둘이 되어
     * 부분 유니크 인덱스(`ux_replan_session_open`)에 걸리고 사용자에게 500 이 나간다(실제로 겪었다).
     */
    override fun save(session: ReplanSession): ReplanSession =
        jpa.saveAndFlush(
            ReplanSessionEntity(
                session.sessionId, session.tripId, session.itineraryId, session.triggerId,
                session.scope.name, session.targetDate, session.fromInstant,
                session.origin.kind.name, session.origin.lat, session.origin.lng,
                session.reasons.toTypedArray(), session.directives.toTypedArray(), session.freeText,
                session.excludedPoiIds.toTypedArray(),
                session.status.name, session.draft, session.createdAt, session.closedAt,
            ),
        ).toDomain()

    override fun findById(sessionId: UUID): ReplanSession? =
        jpa.findById(sessionId).orElse(null)?.toDomain()

    override fun findByIdForUpdate(sessionId: UUID): ReplanSession? =
        jpa.findForUpdate(sessionId)?.toDomain()

    override fun findOpenByTrip(tripId: UUID): ReplanSession? =
        jpa.findFirstByTripIdAndStatusIn(tripId, OPEN_STATUSES)?.toDomain()

    override fun purgeOrigins(tripIds: List<UUID>): Int =
        if (tripIds.isEmpty()) 0 else jpa.purgeOrigins(tripIds)

    private fun ReplanSessionEntity.toDomain() = ReplanSession(
        sessionId, tripId, itineraryId, triggerId,
        ReplanScope.valueOf(scope), targetDate, fromInstant,
        ReplanOrigin(OriginKind.valueOf(originKind), originLat, originLng),
        reasons.toList(), directives.toList(), freeText, excludedPoiIds.toList(),
        ReplanStatus.valueOf(status), draft, createdAt, closedAt,
    )

    private companion object {
        /**
         * 열린 상태. DB 부분 유니크 인덱스(`ux_replan_session_open`)·도메인 [ReplanSession.isOpen] 과
         * **같은 집합**이어야 한다 — 셋 중 하나만 어긋나도 앱이 "없다"고 보고 INSERT 해 500 이 된다.
         */
        private val OPEN_STATUSES = listOf(
            ReplanStatus.COLLECTING.name, ReplanStatus.SOLVING.name, ReplanStatus.DRAFT.name,
        )
    }
}
