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

    override fun findRunningByAccount(accountId: UUID): GenerationSession? =
        jpa.findFirstByAccountIdAndStatusInOrderByStartedAtDesc(accountId, RUNNING_STATUSES)?.toDomain()

    private fun GenerationSessionEntity.toDomain() = GenerationSession.reconstitute(
        sessionId, tripId, accountId, itineraryId, GenerationStatus.valueOf(status), GenerationMode.valueOf(mode),
        isFallback, candidatesLevel, startedAt, day1ReadyAt, finishedAt,
    )

    private companion object {
        /** DB 부분 유니크 인덱스·도메인 `isRunning` 과 **같은 집합**이어야 한다. */
        private val RUNNING_STATUSES = listOf(GenerationStatus.RUNNING.name, GenerationStatus.DAY1_READY.name)
    }
}
