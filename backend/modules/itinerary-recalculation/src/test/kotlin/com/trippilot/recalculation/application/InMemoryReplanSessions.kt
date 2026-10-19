package com.trippilot.recalculation.application

import com.trippilot.recalculation.domain.OriginKind
import com.trippilot.recalculation.domain.ReplanInitiator
import com.trippilot.recalculation.domain.ReplanOrigin
import com.trippilot.recalculation.domain.ReplanSession
import com.trippilot.recalculation.domain.ReplanSessionRepository
import org.springframework.dao.DataIntegrityViolationException
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/** 선계산 조회 3종의 대역 판정 — 저장소 대역들이 같은 뜻으로 답하게 한 곳에 둔다(실물은 JPA 파생 질의). */
internal fun Iterable<ReplanSession>.systemByTrigger(triggerId: UUID): ReplanSession? =
    firstOrNull { it.initiatedBy == ReplanInitiator.SYSTEM && it.triggerId == triggerId }

internal fun Iterable<ReplanSession>.latestSystem(tripId: UUID, targetDate: LocalDate): ReplanSession? =
    filter { it.initiatedBy == ReplanInitiator.SYSTEM && it.tripId == tripId && it.targetDate == targetDate }
        .maxByOrNull { it.createdAt }

internal fun Iterable<ReplanSession>.countSystemSince(tripId: UUID?, since: Instant): Int =
    count { it.initiatedBy == ReplanInitiator.SYSTEM && (tripId == null || it.tripId == tripId) && !it.createdAt.isBefore(since) }

/**
 * 재계획 세션 저장소 대역 — **DB 의 두 부분 유니크를 흉내 낸다**(여행당 열린 세션 1개 · 트리거당 선계산 1개).
 *
 * 실물처럼 **예외로 실패한다**(거울에 방어 코드를 더하지 않는다 — anti-patterns '테스트 거울은 실물과 같아야').
 * 그래서 "열린 세션 ≤ 1"·"트리거당 1개" 성질이 이 대역 위에서도 반증 가능하다 — 서비스가 닫기 전에 열면 여기서 터진다.
 * 동시성(두 트랜잭션의 경합)은 실 DB IT 몫이다.
 */
internal class InMemoryReplanSessions : ReplanSessionRepository {
    val stored = linkedMapOf<UUID, ReplanSession>()

    override fun save(session: ReplanSession): ReplanSession {
        val others = stored.values.filter { it.sessionId != session.sessionId }
        if (session.isOpen && others.any { it.isOpen && it.tripId == session.tripId }) {
            throw DataIntegrityViolationException("ux_replan_session_open")
        }
        if (session.initiatedBy == ReplanInitiator.SYSTEM && others.systemByTrigger(session.triggerId!!) != null) {
            throw DataIntegrityViolationException("ux_replan_session_system_trigger")
        }
        stored[session.sessionId] = session
        return session
    }

    override fun findById(sessionId: UUID) = stored[sessionId]
    override fun findByIdForUpdate(sessionId: UUID) = stored[sessionId]
    override fun findOpenByTrip(tripId: UUID) = stored.values.firstOrNull { it.tripId == tripId && it.isOpen }
    override fun findSystemByTrigger(triggerId: UUID) = stored.values.systemByTrigger(triggerId)
    override fun findLatestSystem(tripId: UUID, targetDate: LocalDate) = stored.values.latestSystem(tripId, targetDate)
    override fun countSystemSince(tripId: UUID?, since: Instant) = stored.values.countSystemSince(tripId, since)

    override fun purgeOrigins(tripIds: List<UUID>): Int {
        val hit = stored.values.filter { it.tripId in tripIds && it.origin.kind in setOf(OriginKind.GPS, OriginKind.MANUAL) }
        hit.forEach { stored[it.sessionId] = it.copy(origin = ReplanOrigin(OriginKind.PURGED, null, null)) }
        return hit.size
    }

    fun system(): List<ReplanSession> = stored.values.filter { it.initiatedBy == ReplanInitiator.SYSTEM }
    fun openOf(tripId: UUID): List<ReplanSession> = stored.values.filter { it.tripId == tripId && it.isOpen }
}
