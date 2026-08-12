package com.trippilot.recalculation.application

import com.trippilot.itinerarygeneration.api.ReplanCommand
import com.trippilot.itinerarygeneration.api.ReplanFacade
import com.trippilot.recalculation.domain.ReplanScope
import com.trippilot.recalculation.domain.ReplanSessionRepository
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Async
import com.trippilot.recalculation.domain.ReplanSession
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Component
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/**
 * 재계획 산출 — `SOLVING → DRAFT | NO_SOLUTION | FAILED`.
 *
 * **별도 빈인 이유**: `@Async` 는 프록시로 동작해 같은 빈 내부 호출(self-invocation)에는 걸리지 않는다
 * (`SecondPhaseGenerator` 와 같은 이유). 동기로 풀면 화면이 `SOLVING` 을 볼 수 없어 i12 로딩이 성립하지 않는다.
 *
 * **아무것도 쓰지 않는다**(INV-U4-05) — 초안은 세션 jsonb 에만 남고, 원 일정은 확정에서만 바뀐다.
 */
@Component
class ReplanSolver(
    private val sessions: ReplanSessionRepository,
    private val visits: VisitCheckService,
    private val replans: ReplanFacade,
    transactionManager: PlatformTransactionManager,
    private val clock: Clock,
) {
    private val tx = TransactionTemplate(transactionManager)

    /**
     * 실패는 삼키지 않고 `FAILED` 로 드러낸다 — 화면은 그걸 보고 수동 편집(i15)으로 넘긴다
     * (INV-4 · US-PLANB-11). 삼키면 사용자는 "생각 중"인 화면을 영원히 본다.
     */
    @Async
    fun solve(accountId: UUID, sessionId: UUID) {
        val session = sessions.findById(sessionId) ?: return
        val today = LocalDate.ofInstant(session.fromInstant, TRAVEL_ZONE)
        try {
            val proposal = replans.propose(
                ReplanCommand(
                    accountId = accountId,
                    tripId = session.tripId,
                    targetDate = today,
                    fromInstant = session.fromInstant,
                    fullDay = session.scope == ReplanScope.FULL_DAY,
                    completedSlotKeys = visits.lockedSlotKeys(session.tripId).toList(),
                    originLat = session.origin.lat,
                    originLng = session.origin.lng,
                    reasons = session.reasons,
                    directives = session.directives,
                    freeText = session.freeText,
                    excludedPoiIds = session.excludedPoiIds,
                ),
            )
            settle(sessionId) { fresh ->
                if (proposal == null) {
                    log.info("재계획 대안 없음 — tripId={} session={}", session.tripId, sessionId)
                    fresh.noSolution(clock.instant())
                } else {
                    fresh.drafted(proposal.toMap())
                }
            }
        } catch (e: RuntimeException) {
            log.warn("재계획 산출 실패 — 수동 편집 전환(INV-4). tripId={}", session.tripId, e)
            settle(sessionId) { it.failed(clock.instant()) }
        }
    }

    /**
     * 결과를 **자기 트랜잭션 안에서** 기록한다.
     *
     * 산출과 한 트랜잭션으로 묶으면, 산출이 터진 뒤 같은 트랜잭션에 `FAILED` 를 쓰려다
     * "current transaction is aborted" 로 그 기록마저 잃는다 — 세션은 열린 채 남고 화면은 영원히 로딩이다(실측).
     *
     * 잠금으로 읽어 **검사와 쓰기 사이**를 직렬화한다. 그 사이 취소·재진입이 끼어들면 닫힌 세션이
     * 초안으로 되살아나거나 열린 세션이 둘이 된다.
     */
    private fun settle(sessionId: UUID, transition: (ReplanSession) -> ReplanSession) {
        try {
            tx.executeWithoutResult {
                val fresh = sessions.findByIdForUpdate(sessionId)?.takeIf { it.isOpen }
                if (fresh == null) {
                    log.info("재계획 산출 결과 폐기 — 세션이 이미 닫혔습니다. session={}", sessionId)
                    return@executeWithoutResult
                }
                sessions.save(transition(fresh))
            }
        } catch (e: DataIntegrityViolationException) {
            // 그 사이 같은 여행에 새 세션이 열렸다(부분 유니크). 이 산출은 밀려난 것이라 버린다 —
            // FAILED 로 적으면 사용자가 보고 있는 **새 세션**과 무관한 실패를 남기게 된다.
            log.info("재계획 산출 결과 폐기 — 새 세션에 밀려났습니다. session={}", sessionId, e)
        }
    }

    private companion object {
        private val log = LoggerFactory.getLogger(ReplanSolver::class.java)

        /** 여행 "오늘"은 사용자가 있는 곳의 날짜지, 서버 UTC 날짜가 아니다. */
        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")
    }
}
