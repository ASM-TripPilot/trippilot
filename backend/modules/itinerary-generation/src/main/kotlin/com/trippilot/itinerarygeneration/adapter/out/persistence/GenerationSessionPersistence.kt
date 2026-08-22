package com.trippilot.itinerarygeneration.adapter.out.persistence

import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.GenerationSession
import com.trippilot.itinerarygeneration.domain.GenerationSessionRepository
import com.trippilot.itinerarygeneration.domain.GenerationStatus
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Component
import java.time.Instant
import java.util.UUID

/** generation_session 매핑(V2.22). 진행률은 컬럼이 없다 — 시각에서 파생된다. */
@Entity
@Table(name = "generation_session")
class GenerationSessionEntity(
    @Id @Column(name = "session_id") var sessionId: UUID,
    @Column(name = "trip_id") var tripId: UUID,
    /** V2.27 — 동시 생성 제한의 단위(TRIP-403). */
    @Column(name = "account_id") var accountId: UUID,
    @Column(name = "itinerary_id") var itineraryId: UUID?,
    @Column(name = "status") var status: String,
    @Column(name = "mode") var mode: String,
    @Column(name = "is_fallback") var isFallback: Boolean,
    @Column(name = "candidates_level") var candidatesLevel: String?,
    @Column(name = "started_at") var startedAt: Instant,
    @Column(name = "day1_ready_at") var day1ReadyAt: Instant?,
    @Column(name = "finished_at") var finishedAt: Instant?,
) {
    protected constructor() : this(
        UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), null, "", "", false, null,
        Instant.EPOCH, null, null,
    )
}

interface GenerationSessionJpaRepository : JpaRepository<GenerationSessionEntity, UUID> {
    fun findFirstByTripIdAndStatusIn(tripId: UUID, statuses: Collection<String>): GenerationSessionEntity?

    /** 가장 최근 것 하나 — 제한 판정에는 "살아 있는 게 있는가"와 "어느 여행인가"만 필요하다. */
    fun findFirstByAccountIdAndStatusInOrderByStartedAtDesc(
        accountId: UUID,
        statuses: Collection<String>,
    ): GenerationSessionEntity?

    /**
     * 트랜잭션 범위 권고 잠금 — 커밋·롤백 어느 쪽으로 끝나도 풀린다(해제를 잊을 수 없다).
     *
     * 계정 행을 직접 잠그지 않는 이유: `account` 는 auth 모듈 소유라 여기서 조회하면 경계(R1)를 넘는다.
     * 권고 잠금은 테이블이 필요 없어 남의 스키마를 건드리지 않는다.
     *
     * FROM 절에서 부르고 상수를 고르는 형태다 — 이 함수는 `void` 를 돌려주므로 `SELECT 함수(...)` 로
     * 쓰면 드라이버가 `PGobject` 를 주고 매핑이 깨진다(실제로 겪었다).
     */
    @Query(value = "SELECT 1 FROM pg_advisory_xact_lock(:namespace, :key)", nativeQuery = true)
    fun advisoryXactLock(namespace: Int, key: Int): Int
}

@Component
class GenerationSessionPersistence(
    private val jpa: GenerationSessionJpaRepository,
) : GenerationSessionRepository {

    /**
     * `saveAndFlush` — 새 생성은 한 트랜잭션에서 "이전 세션 닫기 → 새 세션 INSERT" 를 이을 수 있는데,
     * UPDATE 가 커밋까지 밀리면 INSERT 가 먼저 나가 부분 유니크에 걸린다(재계획 세션에서 실제로 겪었다).
     */
    override fun save(session: GenerationSession): GenerationSession = jpa.saveAndFlush(
        GenerationSessionEntity(
            session.sessionId, session.tripId, session.accountId, session.itineraryId,
            session.status.name, session.mode.name,
            session.isFallback, session.candidatesLevel,
            session.startedAt, session.day1ReadyAt, session.finishedAt,
        ),
    ).toDomain()

    override fun findById(sessionId: UUID): GenerationSession? =
        jpa.findById(sessionId).orElse(null)?.toDomain()

    override fun findRunningByTrip(tripId: UUID): GenerationSession? =
        jpa.findFirstByTripIdAndStatusIn(tripId, RUNNING_STATUSES)?.toDomain()

    override fun lockAccount(accountId: UUID) {
        // 두 int 로 나눠 거는 형태를 쓴다 — namespace 가 있어야 다른 용도의 권고 잠금과 안 겹친다.
        // UUID 를 int 로 접으므로 서로 다른 계정이 같은 키가 될 수 있다. 그때 생기는 일은 잠깐 줄을
        // 서는 것뿐이라 정확성에는 영향이 없다(잠금 구간이 세션 쓰기 몇 줄이다).
        jpa.advisoryXactLock(LOCK_NAMESPACE, accountId.hashCode())
    }

    override fun findRunningByAccount(accountId: UUID): GenerationSession? =
        jpa.findFirstByAccountIdAndStatusInOrderByStartedAtDesc(accountId, RUNNING_STATUSES)?.toDomain()

    private fun GenerationSessionEntity.toDomain() = GenerationSession.reconstitute(
        sessionId, tripId, accountId, itineraryId, GenerationStatus.valueOf(status), GenerationMode.valueOf(mode),
        isFallback, candidatesLevel, startedAt, day1ReadyAt, finishedAt,
    )

    private companion object {
        /** 생성 세션 전용 권고 잠금 공간(TRIP-403). */
        private const val LOCK_NAMESPACE = 403

        /** DB 부분 유니크 인덱스·도메인 `isRunning` 과 **같은 집합**이어야 한다. */
        private val RUNNING_STATUSES = listOf(GenerationStatus.RUNNING.name, GenerationStatus.DAY1_READY.name)
    }
}
