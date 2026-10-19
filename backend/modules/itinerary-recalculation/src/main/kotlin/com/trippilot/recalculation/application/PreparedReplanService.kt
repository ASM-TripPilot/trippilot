package com.trippilot.recalculation.application

import com.trippilot.recalculation.domain.ReplanSession
import com.trippilot.recalculation.domain.ReplanSessionRepository
import jakarta.annotation.PreDestroy
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.Semaphore
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** 위험 알림 사건 한 건 — 선계산 구독자가 payload 를 읽어 만든다(계약 위반은 거기서 걸러진다). */
data class RiskEvent(
    val accountId: UUID,
    val tripId: UUID,
    /** 사건의 대표 트리거(`aggregateId`). */
    val triggerId: UUID,
    /** 대표 날짜의 위험 전부(`dateRisks`) — 재료는 [ReplanMaterial] 이 만든다. */
    val risks: List<ReplanMaterial.Risk>,
)

/**
 * 미리 짜 둔 대안(situation-awareness BR-SA-18 · DEC-SA-4) — 위험 알림 사건마다 재계획 초안을 미리 짠다.
 * 일정은 쓰지 않는다(INV-SA-1) — 초안까지이고, 적용은 사용자의 [ReplanSessionService.apply] 뿐이다.
 *
 * ## 거름
 * 스위치(`PLANB_PREPARED_REPLAN`)가 켜져 있고 · 재료가 있고(흐림·지연뿐이면 없다) · 사건 나이가 [MAX_EVENT_AGE] 이하일 때만
 * 움직인다 — 릴레이가 오래 밀렸던 사건의 초안은 이미 늦다.
 *
 * ## 실행 자리를 얻은 뒤에만 세션을 연다
 * 자리(실행 [RUNNING] + 대기 [WAITING])를 못 얻으면 세션 없이 BUSY 다 — 상한도 트리거당 1회도 쓰지 않는다. 종전 설계처럼
 * 세션을 먼저 열고 실행기에서 거절되면 FAILED 세션이 하루 상한을 먹는다. 지역 날씨 하나에 많은 여행이 함께 위험해지는 날이 그렇다.
 *
 * ## 전용 실행기 1스레드
 * 공용 비동기 풀(`backgroundTaskExecutor`)은 포화 시 **호출자 실행**이라 아웃박스 릴레이 스레드를 산출 시간만큼 막는다.
 * 1 인 이유는 커넥션이다 — 재계획 산출이 읽기 전용 트랜잭션 안에서 AI 를 부른다(`ReplanFacadeService.propose`). AI 예산은
 * 25초지만 그것은 상대의 계산 예산이고, 우리는 생성 클라이언트의 소켓 read 상한까지 기다린다(배포 60초 + 여유 2초) — 그동안
 * 커넥션을 쥔다. 사용자 재계획과 함께 Hikari(기본 10)를 말리지 않게 묶는다. 늘리려면 AI 호출을 트랜잭션 밖으로 빼는 변경이 먼저다.
 * 실행기는 빈이 아니다 — 공용 실행기와 타입이 겹쳐 `@Async` 의 실행기 선택을 흔들지 않게.
 *
 * 관측은 요약 로그 한 줄 `replan.prepared outcome=…` 이다(개인정보·좌표 없음 — 운영은 지표 내보내기가 꺼져 있다).
 */
@Service
class PreparedReplanService internal constructor(
    private val sessions: ReplanSessionService,
    private val repository: ReplanSessionRepository,
    private val solver: ReplanSolver,
    private val properties: ReplanProperties,
    private val clock: Clock,
    private val executor: ExecutorService,
) {
    @Autowired
    constructor(
        sessions: ReplanSessionService,
        repository: ReplanSessionRepository,
        solver: ReplanSolver,
        properties: ReplanProperties,
        clock: Clock,
    ) : this(sessions, repository, solver, properties, clock, newExecutor())

    /** 실행 자리 — 얻은 것은 산출이 끝날 때(또는 넘기지 못했을 때) 돌려준다. */
    private val slots = Semaphore(RUNNING + WAITING)

    /**
     * 위험 사건 한 건의 선계산. 일시 오류(DB 등)는 **던진다** — 릴레이가 이벤트째 재시도하고(같은 이벤트의 알림 구독자는
     * 서로 독립으로 이미 돌았다, #1348), 재배달은 트리거당 1개 규칙이 받아 넘긴다(멱등). 판정 결과는 예외가 아니다.
     *
     * 트랜잭션 밖(릴레이 스레드)에서 불린다 — [ReplanSessionService.prepare] 가 커밋하고 돌아온 뒤에 실행기에 넘기므로
     * 산출 스레드가 그 세션을 본다(트랜잭션 안에서 넘기면 다른 커넥션의 산출이 아직 없는 행을 읽고 SOLVING 에 멈춘다).
     */
    fun onRisk(event: RiskEvent, occurredAt: Instant) {
        if (properties.prepared.mode != PreparedMode.ON) return
        val material = ReplanMaterial.of(event.risks) ?: run {
            log.debug("선계산 재료가 없어(흐림·지연뿐) 건너뜁니다. tripId={} triggerId={}", event.tripId, event.triggerId)
            return
        }
        if (Duration.between(occurredAt, clock.instant()) > MAX_EVENT_AGE) return summary("OLD", event)
        // 종료가 시작됐다(이미 돌던 릴레이 배치가 아직 넘긴다). 열면 실행기가 거절해 FAILED 가 그 트리거의 선계산 1회를 먹는다 —
        // 던지면 릴레이가 이벤트째 다음 파드에 다시 배달한다.
        check(!executor.isShutdown) { "선계산 실행기가 닫히는 중입니다 — 이 사건은 다음 파드가 다시 받습니다." }
        if (!slots.tryAcquire()) return summary(PrepareSkip.BUSY.name, event)

        var handedOff = false
        try {
            val prepared = try {
                sessions.prepare(
                    PrepareReplan(event.accountId, event.tripId, event.triggerId, material.reasons, material.directives, material.excludedPoiIds),
                )
            } catch (e: DataIntegrityViolationException) {
                // 같은 순간 다른 진입이 먼저 저장했다 — 부분 유니크가 막았고 그 트랜잭션은 롤백됐다. 사용자가 이긴다(BR-SA-20 ④).
                Prepared.Skipped(
                    if (repository.findSystemByTrigger(event.triggerId) != null) PrepareSkip.DUPLICATE else PrepareSkip.OPEN_SESSION,
                )
            }
            when (prepared) {
                is Prepared.Skipped -> summary(prepared.reason.name, event)
                is Prepared.Opened -> handedOff = submit(event, prepared.session)
            }
        } finally {
            if (!handedOff) slots.release()
        }
    }

    /** 산출을 전용 실행기에 넘긴다. 넘겼으면 true — 자리는 산출이 끝날 때 돌아온다. */
    private fun submit(event: RiskEvent, session: ReplanSession): Boolean = try {
        executor.execute(SolveTask(event.accountId, session.sessionId))
        summary("OPENED", event, session)
        true
    } catch (e: RejectedExecutionException) {
        // 드물다(종료 중). 열어 둔 채 두면 화면은 끝나지 않는 산출을 기다리고 열린 세션 자리를 붙잡는다 — FAILED 로 닫는다.
        log.warn("선계산 실행기가 산출을 받지 않아 세션을 닫습니다. session={}", session.sessionId, e)
        solver.giveUp(session.sessionId)
        summary("REJECTED", event, session)
        false
    }

    /** 산출 한 건 — 끝나면 자리를 돌려준다. 종료 때 시작 못 한 것을 닫으려고 세션 id 를 들고 있다. */
    private inner class SolveTask(val accountId: UUID, val sessionId: UUID) : Runnable {
        override fun run() {
            try {
                solver.solveNow(accountId, sessionId)
            } catch (e: RuntimeException) {
                // solveNow 는 산출 실패를 FAILED 로 닫는다 — 여기 오는 것은 기록조차 못 한 경우다(DB). 2분 뒤 낡음으로 보인다.
                log.error("선계산 산출을 기록하지 못했습니다. session={}", sessionId, e)
            } finally {
                slots.release()
            }
        }
    }

    private fun summary(outcome: String, event: RiskEvent, session: ReplanSession? = null) {
        log.info(
            "replan.prepared outcome={} tripId={} triggerId={} session={} date={}",
            outcome, event.tripId, event.triggerId, session?.sessionId, session?.targetDate,
        )
    }

    /**
     * 종료 — 진행 중 산출을 소켓 read 상한까지 기다린다. 넘기면 대기열의 시작 못 한 산출을 FAILED 로 닫는다 — SOLVING 으로 남기면
     * 화면이 끝나지 않는 산출을 기다린다(INV-4). 이 빈이 저장소·솔버보다 먼저 닫히므로 DB 는 아직 살아 있다.
     */
    @PreDestroy
    fun shutdown() {
        executor.shutdown()
        if (executor.awaitTermination(AWAIT_TERMINATION_SECONDS, TimeUnit.SECONDS)) return
        val dropped = executor.shutdownNow().filterIsInstance<SolveTask>()
        dropped.forEach { task -> runCatching { solver.giveUp(task.sessionId) } }
        log.warn("선계산 실행기 종료 대기를 넘겼습니다 — 시작 못 한 산출 {}건을 FAILED 로 닫았습니다.", dropped.size)
    }

    internal companion object {
        /** 실행 1 + 대기 10(BR-SA-18 ③). */
        const val RUNNING = 1
        const val WAITING = 10

        /** 이보다 오래된 사건은 무시한다 — 초안이 이미 늦다(BR-SA-18 ①). */
        private val MAX_EVENT_AGE: Duration = Duration.ofMinutes(30)

        /**
         * 진행 중 산출의 소켓 read 상한(생성 클라이언트 — 배포 60초 + 여유 2초)을 덮는다. AI 예산 25초로 잡으면 예산을 넘긴 산출이
         * 잘려(소켓 read 는 인터럽트로 깨지 않는다) 컨텍스트가 닫힌 뒤 기록을 못 하고 SOLVING 에 남는다. 종료 유예(배포 660초) 안이다.
         */
        private const val AWAIT_TERMINATION_SECONDS = 65L

        private val log = LoggerFactory.getLogger(PreparedReplanService::class.java)

        /**
         * 대기열은 대기 자리가 아니라 **자리 전부**를 받는다 — 자리는 산출 작업의 finally 에서 돌아오고 일꾼이 다음 것을 꺼내는 것은
         * 그 뒤라, 그 사이 대기열은 아직 [WAITING] 개로 차 있다. 그때 자리를 얻은 사건을 거절하면 세션이 FAILED 로 열린다.
         * 상한은 자리([slots])가 지므로 거절은 종료 때뿐이다.
         */
        internal fun newExecutor(): ExecutorService {
            val seq = AtomicInteger()
            return ThreadPoolExecutor(
                RUNNING, RUNNING, 0L, TimeUnit.MILLISECONDS, LinkedBlockingQueue(RUNNING + WAITING),
                { r -> Thread(r, "tp-prepared-${seq.incrementAndGet()}").apply { isDaemon = true } },
                ThreadPoolExecutor.AbortPolicy(),
            )
        }
    }
}
