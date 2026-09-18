package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.GenerationSession
import com.trippilot.itinerarygeneration.domain.GenerationSessionRepository
import com.trippilot.trip.api.TripFacade
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

/**
 * 인메모리 세션 저장소.
 *
 * DB 부분 유니크(진행 중 1개)는 **여기서 흉내 내지 않는다** — 서비스가 이전 세션을 닫고 시작하는지는
 * 저장된 상태로 확인하고, 인덱스 자체는 [com.trippilot.app.SchemaMigrationIT] 계열의 실물 검증이 맡는다.
 */
internal class FakeGenerationSessions : GenerationSessionRepository {
    val rows = linkedMapOf<UUID, GenerationSession>()

    override fun save(session: GenerationSession): GenerationSession {
        rows[session.sessionId] = session
        return session
    }

    override fun findById(sessionId: UUID): GenerationSession? = rows[sessionId]

    /** 단일 스레드 대역이라 잠글 것이 없다 — 직렬화가 실제로 도는지는 실 DB IT 가 본다. */
    override fun lockAccount(accountId: UUID) = Unit

    override fun findRunningByTrip(tripId: UUID): GenerationSession? =
        rows.values.firstOrNull { it.tripId == tripId && it.isRunning }

    /** 실물과 같이 **가장 최근** 것을 준다 — 여러 건이면 어느 것을 보여줄지가 판정에 걸린다. */
    override fun findRunningByAccount(accountId: UUID): GenerationSession? =
        rows.values.filter { it.accountId == accountId && it.isRunning }.maxByOrNull { it.startedAt }
}

/** 기본값은 **배포 기본과 같다**(시한 미전송) — 대역이 실제와 다른 모드로 돌면 검증이 헛돈다. */
internal val defaultDeadlines = ScheduleDeadlineProperties()

internal fun genSessions(
    trips: TripFacade = stubTrips,
    repo: GenerationSessionRepository = FakeGenerationSessions(),
    clock: Clock = Clock.fixed(Instant.parse("2026-08-06T00:00:00Z"), ZoneOffset.UTC),
    deadlines: ScheduleDeadlineProperties = defaultDeadlines,
) = GenerationSessionService(trips, repo, clock, deadlines)
