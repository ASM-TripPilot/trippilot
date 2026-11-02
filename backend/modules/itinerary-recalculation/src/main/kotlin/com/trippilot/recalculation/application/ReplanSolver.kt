package com.trippilot.recalculation.application

import com.trippilot.archive.api.ArchiveFacade
import com.trippilot.itinerarygeneration.api.ReplanCommand
import com.trippilot.itinerarygeneration.api.ReplanFacade
import com.trippilot.recalculation.domain.ReplanScope
import com.trippilot.recalculation.domain.ReplanSessionRepository
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Async
import com.trippilot.recalculation.domain.ReplanSession
import com.trippilot.recalculation.domain.ReplanStatus
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Component
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
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
    private val archive: ArchiveFacade,
    private val replans: ReplanFacade,
    transactionManager: PlatformTransactionManager,
    private val clock: Clock,
) {
    private val tx = TransactionTemplate(transactionManager)

    /** 사용자 진입의 산출 — 공용 비동기 풀에서 돈다(화면이 SOLVING 을 폴링해 로딩을 그린다). */
    @Async
    fun solve(accountId: UUID, sessionId: UUID) = solveNow(accountId, sessionId)

    /**
     * 그 자리(호출 스레드)에서 산출한다 — 선계산은 전용 실행기가 이것을 부른다(공용 풀은 포화 시 호출자 실행이라
     * 아웃박스 릴레이 스레드를 산출 시간만큼 막는다 — BR-SA-18).
     *
     * **SOLVING 이 아니면 AI 를 부르지 않는다.** 대기열에 있는 동안 새 선계산·사용자 진입에 대체돼 닫힌 세션은 비용 0 이다
     * (종전에는 닫힌 세션에도 AI 를 끝까지 부르고 결과만 버렸다).
     *
     * 실패는 삼키지 않고 `FAILED` 로 드러낸다 — 화면은 그걸 보고 수동 편집(i15)으로 넘긴다
     * (INV-4 · US-PLANB-11). 삼키면 사용자는 "생각 중"인 화면을 영원히 본다.
     */
    fun solveNow(accountId: UUID, sessionId: UUID) {
        val session = sessions.findById(sessionId)?.takeIf { it.status == ReplanStatus.SOLVING } ?: run {
            log.info("재계획 산출 생략 — 세션이 산출 중이 아닙니다(대체·취소). session={}", sessionId)
            return
        }
        try {
            val proposal = replans.propose(
                ReplanCommand(
                    accountId = accountId,
                    tripId = session.tripId,
                    // 진입에서 정해진 일자다(TRIP-1182). 종전에는 여기서 `fromInstant` 로 '오늘'을
                    // 다시 계산해 **오늘만** 다시 짤 수 있었다 — 미래일 재계획이 막혀 있던 지점이다.
                    targetDate = session.targetDate,
                    fromInstant = session.fromInstant,
                    fullDay = session.scope == ReplanScope.FULL_DAY,
                    // 잠금(INV-U4-04)의 원천은 방문 실적이고, 실적은 archive 소유다(BR-U5-10).
                    completedSlotKeys = archive.getCompletedSlots(session.tripId).toList(),
                    originLat = session.origin.lat,
                    originLng = session.origin.lng,
                    reasons = session.reasons,
                    directives = session.directives,
                    freeText = session.freeText,
                    // 그날 건너뛴 곳은 서버가 합친다(U4 BR-U4-17 개정 2026-11-01). 앱은 수동 진입에서 빈 목록을 보내고
                    // 선계산(SYSTEM)은 앱을 거치지 않는다 — 안 빼면 새 일정에 다시 들어와, 같은 슬롯 키의 건너뜀 기록과
                    // 부딪혀 [도착]이 영원히 409 인 칸이 된다(BR-U5-02). 세션 저장값이 아니라 **산출 시점**에 읽는다 —
                    // 선계산 세션도 산출 때의 최신 실적을 본다. AI 는 제외를 원 일정 슬롯보다 우선하므로(합류·남은 방문·진행 중
                    // 잠금 전부 제외를 거른다) `currentSlots` 에서 따로 빼지 않는다.
                    excludedPoiIds = (session.excludedPoiIds + archive.getSkippedPois(session.tripId, session.targetDate)).distinct(),
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
     * 산출을 시작도 못 하고 포기한다(실행기 거절·종료) — `FAILED` 로 닫는다. 열어 둔 채 두면 화면은 끝난 적 없는 산출을
     * 기다리고, 그 여행의 열린 세션 자리(INV-U4-06)를 붙잡는다.
     */
    fun giveUp(sessionId: UUID) = settle(sessionId) { it.failed(clock.instant()) }

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
    }
}
