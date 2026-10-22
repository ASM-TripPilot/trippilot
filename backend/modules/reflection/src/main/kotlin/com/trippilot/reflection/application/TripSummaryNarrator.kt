package com.trippilot.reflection.application

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.archive.api.ArchiveRecordFacade
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.reflection.domain.AiAttempt
import com.trippilot.reflection.domain.ReflectionSource
import com.trippilot.reflection.domain.TripSummaryRepository
import com.trippilot.reflection.domain.port.ReflectionAgentInput
import com.trippilot.reflection.domain.port.ReflectionAgentPort
import com.trippilot.reflection.domain.port.ReflectionVisit
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripOwnerFacade
import jakarta.annotation.PreDestroy
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Autowired
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionOperations
import org.springframework.transaction.support.TransactionTemplate
import java.time.Duration
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * 여행 요약에 AI 회고 문장을 붙인다(TRIP-1488) — 규칙 요약이 저장된 **뒤에**, 백그라운드에서.
 *
 * 사용자 결정(2026-10-20) "여행 회고는 몇 초가 걸리든 만들어지기만 하면 된다" — 그래서 화면은 기다리지 않는다: 규칙 요약이 먼저
 * 저장되고(`ready`), 여기서 AI 가 성공하면 같은 행의 `narrative` 를 회고 부제(`cover.subtitle`)로, `source` 를 AI 로 바꾼다.
 * 실패하면 규칙 요약이 그대로 남는다(지금과 같다) — 사유는 로그로 남긴다(INV-4).
 *
 * ## 어디서 기다리나
 * - **아웃박스 릴레이 스레드가 아니다.** 릴레이는 한 번에 100건을 차례로 돌리고 ShedLock 5분이다 — 수십 초 호출이 끼면 그동안 푸시 등
 *   다른 이벤트가 막힌다. 공용 `@Async` 풀도 쓰지 않는다: 포화 시 **호출자 실행**이라 그때는 결국 릴레이 스레드에서 AI 를 기다린다.
 *   그래서 전용 실행기([RUNNING] 스레드 · 대기 [WAITING])이고, 넘치면 **버리고 WARN** 을 남긴다(규칙 요약은 이미 저장됐다).
 *
 * ## 사라진 회고는 스윕이 다시 맡는다
 * 맡긴 일은 사라질 수 있다 — 대기열 넘침(여행 종료 스윕은 한 번에 200건까지 끝내고, 릴레이는 그것을 몇 초 안에 넘긴다), AI 행(호출 하나가
 * read 상한 605초+), 종료·크래시. 사용자 결정은 "만들어지기만 하면 된다"라 버려 두지 않는다: 시도는 요약 행에 남고(V2.84 `ai_attempts`·
 * `ai_attempted_at`), [sweep] 이 마지막으로 다시 짠 지 [SWEEP_WINDOW] 안인 규칙 요약 중 시도가 [MAX_ATTEMPTS] 미만이고 마지막 시도에서
 * [reclaimAfter] 가 지난 것을 다시 맡긴다.
 * **선점이 시도 하나를 쓴다** — 선점은 AI 를 부르기 바로 앞이고, 진행 중 배포·크래시로 끊긴 시도도 한 번으로 센다. 선점 전 조회가 던져도 그 자리에서
 * 선점해 한 번으로 센다([narrate]). 쓰지 않는 것은 실행기가 받지 않은 경우(넘침·종료 중)와 선점 전에 파드가 사라진 경우다 — 둘 다 다음 회차에 다시 집힌다.
 * 마지막 시도를 선점하는 순간 WARN 을 남긴다 — 그 시도가 파드와 함께 사라져도 "더 맡지 않는다"가 조용히 지나가지 않게(INV-4).
 * - **트랜잭션 밖이다**(TRIP-1463 교훈). 실적·재료 조회와 AI 호출은 각 퍼사드의 짧은 읽기 트랜잭션만 쓰고, 마지막 쓰기만 짧은
 *   트랜잭션에서 요약 잠금([TripSummaryRepository.findForUpdate])을 잡는다 — 커넥션을 AI 대기 동안 쥐지 않는다.
 *
 * ## 멱등(at-least-once)
 * 같은 `TripEnded` 가 다시 와도 AI 를 다시 부르지 않고, 이미 붙은 AI 문장을 덮지 않는다:
 * 이 파드에서 같은 여행이 대기·실행 중이면 받지 않고([inFlight]), AI 를 부르기 전에 시도를 **선점**한다([TripSummaryRepository.claimAiAttempt] —
 * 조건부 UPDATE 한 문장이라 파드 사이에서도 한쪽만 이긴다. 진행 중인 다른 파드의 시도는 호출 상한이 지나기 전엔 선점되지 않는다). 쓸 때 출처가
 * 이미 AI 면 덮지 않는다.
 * 요약 생성([TripSummaryService.generate])도 AI 문장을 규칙 문장으로 되돌리지 않는다.
 *
 * 요약에는 사용자가 쓰는 칸이 없다(수정 API 없음) — 비동기 쓰기와 겹칠 사용자 쓰기가 없다. 경로 갱신(`refreshRouteStats`)은
 * 같은 잠금을 잡고 문장·출처를 건드리지 않는다.
 *
 * 알림(`ReflectionReady`)은 다시 내지 않는다 — 요약을 처음 만들 때 이미 "요약이 준비됐어요"가 나갔다. 문장이 나중에 바뀌는 것은 다음 조회에서 보인다.
 */
@Component
class TripSummaryNarrator internal constructor(
    private val owners: TripOwnerFacade,
    private val trips: TripFacade,
    private val archive: ArchiveRecordFacade,
    private val poiSurfaces: PoiSurfaceFacade,
    private val summaries: TripSummaryRepository,
    private val agent: ReflectionAgentPort,
    private val cards: ReflectionCardCodec,
    private val materials: ReflectionMaterials,
    private val metrics: ReflectionMetrics,
    private val mapper: ObjectMapper,
    private val writes: TransactionOperations,
    private val executor: ExecutorService,
) {
    @Autowired
    constructor(
        owners: TripOwnerFacade,
        trips: TripFacade,
        archive: ArchiveRecordFacade,
        poiSurfaces: PoiSurfaceFacade,
        summaries: TripSummaryRepository,
        agent: ReflectionAgentPort,
        cards: ReflectionCardCodec,
        materials: ReflectionMaterials,
        metrics: ReflectionMetrics,
        mapper: ObjectMapper,
        transactions: PlatformTransactionManager,
    ) : this(owners, trips, archive, poiSurfaces, summaries, agent, cards, materials, metrics, mapper, TransactionTemplate(transactions), newExecutor())

    /** 이 파드에서 대기·실행 중인 여행. 다른 파드와의 중복은 시도 선점이 막는다. */
    private val inFlight: MutableSet<UUID> = ConcurrentHashMap.newKeySet()

    /**
     * AI 회고를 맡긴다 — **요약이 커밋된 뒤에**(트랜잭션 밖에서) 부른다. 안에서 맡기면 실행기가 아직 없는 행을 보고 그냥 끝난다.
     * 즉시 돌아온다.
     */
    fun request(tripId: UUID) {
        if (submit(tripId) == Submitted.REJECTED) {
            // 대기열이 찼거나 종료 중이다. 시도를 쓰지 않았으니 스윕이 다음 회차에 다시 맡는다 — 조용히 넘기지는 않는다(INV-4).
            log.warn("요약 회고 실행기가 받지 않았습니다(대기열 포화·종료 중) — 스윕이 다음 회차에 다시 맡습니다. tripId={}", tripId)
        }
    }

    private enum class Submitted { ACCEPTED, SKIPPED, REJECTED }

    private fun submit(tripId: UUID): Submitted {
        if (!agent.enabled) return Submitted.SKIPPED
        if (!inFlight.add(tripId)) {
            log.debug("이 여행의 요약 회고가 이미 대기·실행 중이라 다시 맡지 않습니다. tripId={}", tripId)
            return Submitted.SKIPPED
        }
        return try {
            executor.execute {
                try {
                    narrate(tripId) // 던지지 않는다 — 실패는 안에서 시도로 세고 남긴다
                } finally {
                    inFlight.remove(tripId)
                }
            }
            Submitted.ACCEPTED
        } catch (e: RejectedExecutionException) {
            inFlight.remove(tripId)
            Submitted.REJECTED
        }
    }

    /**
     * 사라진 회고를 다시 맡긴다(위 "사라진 회고" 절). 다중 파드에서 하나만 돈다(ShedLock) — 둘이 돌아도 시도 선점이 중복 호출을 막는다.
     * 한 번에 대기열 크기만큼만 집는다 — 넘치면 어차피 거절된다(시도를 쓰지 않으므로 다음 회차에 다시 집힌다). 거절은 회차마다 한 줄로 모은다 —
     * 건마다 남기면 넘칠 때 파드마다 5분에 100줄이다.
     */
    @Scheduled(
        fixedDelayString = "\${trippilot.reflection.summary-narrate-sweep-ms:300000}",
        initialDelayString = "\${trippilot.reflection.summary-narrate-sweep-initial-delay-ms:60000}",
    )
    @SchedulerLock(name = "trip-summary-narrate-sweep", lockAtMostFor = "PT4M", lockAtLeastFor = "PT0S")
    fun sweep() {
        if (!agent.enabled) return
        val pending = summaries.findAiPending(SWEEP_WINDOW, reclaimAfter(), MAX_ATTEMPTS, WAITING)
        if (pending.isEmpty()) return
        val results = pending.groupingBy { submit(it) }.eachCount()
        val rejected = results[Submitted.REJECTED] ?: 0
        log.info(
            "요약 회고를 다시 맡깁니다 {}건(시도 기록 기준 — 넘침·행·종료로 사라진 것). 이 파드에서 이미 대기·진행 중이라 건너뜀 {}건.",
            results[Submitted.ACCEPTED] ?: 0, results[Submitted.SKIPPED] ?: 0,
        )
        if (rejected > 0) log.warn("요약 회고 실행기가 {}건을 받지 않았습니다(대기열 포화·종료 중) — 다음 회차에 다시 맡습니다.", rejected)
    }

    /**
     * 다시 선점해도 되는 때 — 마지막 시도에서 요약 호출 상한이 지나고 [RECLAIM_MARGIN] 이 더 지난 뒤. 선점은 호출 바로 앞이지만 선점 트랜잭션 커밋과
     * HTTP 연결 사이에도 틈이 있고 두 파드의 시계 처리도 다르다 — 상한에 딱 맞추면 아직 기다리는 다른 파드의 호출을 중복할 수 있다.
     */
    private fun reclaimAfter(): Duration = agent.summaryCallTimeout.plus(RECLAIM_MARGIN)

    /**
     * AI 문장 한 번 — 근거를 모으고, 부르기 직전에 시도를 선점하고, 부르고, 쓸 수 있으면 잠근 뒤 쓴다. **`Exception` 은 던지지 않는다**(`Error` 는
     * 우리 로그에 남기고·선점 전이면 시도로 센 뒤 그대로 올린다 — 메모리 부족 같은 것을 시도 실패로 삼키지 않는다).
     *
     * 어디서 던지든(근거 조회·선점·카드 읽기·환각 대조·쓰기) 그 실패는 **시도 하나로 센다** — 선점 전에 던졌으면 여기서 선점해 센다. 안 세면
     * 늘 던지는 여행이 7일 동안 5분마다 다시 집혀(스택이 든 WARN 이 하루 수백 줄) 오래된 순 상위 자리를 차지해 다른 여행을 굶긴다. 상한(3)이 그것을 묶는다.
     * 예외: 선점 전에 **종료 인터럽트**로 끊긴 것은 세지 않는다 — 파드가 사라진 것과 같고(시도를 안 쓴다) 인터럽트 표시는 그대로 둔다.
     */
    internal fun narrate(tripId: UUID) {
        val claim = Claim()
        try {
            narrateOnce(tripId, claim)
        } catch (e: Exception) {
            val stage = if (claim.attempt == null) "선점 전" else "선점 뒤"
            if (claim.attempt == null && interrupted(e)) {
                log.warn("요약 회고 준비가 종료로 끊겼습니다(선점 전) — 시도를 쓰지 않았고 스윕이 다시 맡습니다. tripId={}", tripId, e)
                return
            }
            val next = claim.attempt?.let(::afterAttempt) ?: countPreClaim(tripId, e)
            log.warn("요약 회고 중 실패했습니다({}) — {}. tripId={}", stage, next, tripId, e)
        } catch (e: Error) {
            // 삼키지 않는다 — 다만 실행기 밖(JVM 기본 처리기 → 표준 오류, tripId 없음)으로 나가기 전에 우리 로그에 남기고, 선점 전이면 시도로 센다.
            // 안 세면 늘 Error 를 내는 여행이 7일 동안 5분마다 다시 집힌다. 세는 일이 실패해도 Error 를 가리지 않는다(붙여서 그대로 올린다).
            val next = claim.attempt?.let(::afterAttempt) ?: countPreClaim(tripId, e)
            log.error("요약 회고 중 Error 가 났습니다({}) — {}. tripId={}", if (claim.attempt == null) "선점 전" else "선점 뒤", next, tripId, e)
            throw e
        }
    }

    /**
     * 선점 전 실패를 시도 하나로 센다 — 다음 행동을 문장으로 돌려준다. 세는 쓰기·조회가 실패하면 그 예외를 [cause] 에 붙인다(가리지 않는다).
     * 못 셌으면(선점 조건에 걸렸다) 행을 한 번 읽어 까닭을 가린다 — 그래야 "다시 집히는가"를 맞게 말한다.
     */
    private fun countPreClaim(tripId: UUID, cause: Throwable): String = try {
        writes.execute { summaries.claimAiAttempt(tripId, reclaimAfter(), MAX_ATTEMPTS) }?.let(::afterAttempt) ?: notCounted(summaries.findAiAttempt(tripId))
    } catch (counting: Exception) {
        cause.addSuppressed(counting)
        "시도를 기록하지 못했습니다(쓰기·조회 실패 — 함께 붙인 예외) — 시도 수가 그대로라 다음 스윕이 다시 집습니다"
    }

    private fun notCounted(row: AiAttempt?): String = when {
        row == null -> "시도로 세지 않았습니다 — 요약 행이 없습니다(여행이 지워졌을 수 있다). 다시 집히지 않습니다"
        row.source != ReflectionSource.RULE.name -> "시도로 세지 않았습니다 — 이미 AI 문장이 붙었거나 규칙 요약이 아닙니다. 다시 집히지 않습니다"
        row.attempts >= MAX_ATTEMPTS -> "시도로 세지 않았습니다 — 시도 상한($MAX_ATTEMPTS)을 이미 다 썼습니다. 다시 집히지 않습니다"
        else -> "시도로 세지 않았습니다 — 다른 쪽의 최근 시도가 다시 선점 기준(${reclaimAfter().toSeconds()}초) 안에 있습니다. 그 기준이 지나면 스윕이 다시 집습니다"
    }

    private fun afterAttempt(attempt: Int): String =
        if (attempt >= MAX_ATTEMPTS) "시도 상한($MAX_ATTEMPTS)을 다 써 더 맡지 않고 규칙 요약으로 남깁니다"
        else "시도 $attempt/$MAX_ATTEMPTS 로 세고 스윕이 다시 맡습니다"

    /** 종료 인터럽트인가 — 표시가 서 있거나 원인 사슬에 [InterruptedException] 이 있다(드라이버가 감싸 올린다). 표시를 지우지 않는다. */
    private fun interrupted(e: Throwable): Boolean =
        Thread.currentThread().isInterrupted || generateSequence(e) { it.cause }.any { it is InterruptedException }

    /** 이번 회차에 선점한 시도 번호 — 실패가 선점 전인지 뒤인지 가른다. */
    private class Claim { var attempt: Int? = null }

    private fun narrateOnce(tripId: UUID, claim: Claim) {
        val owned = owners.findOwnedPeriod(tripId) ?: return retire("DELETED", tripId)
        val ctx = trips.findGenerationContext(owned.accountId, tripId)
        val days = archive.findDailyVisits(tripId)
        val surfaces = poiSurfaces.findSurfaces(days.flatMap { d -> d.visits.map { it.poiId } })
        // 근거 안에서만(BR-U5-31) — 건너뛴 방문은 싣지 않고, 이름을 못 찾은 방문도 뺀다. 순서는 그날 안에서 센다(하루 회고와 같은 규칙).
        val visits = days.flatMap { day ->
            day.visits.filterNot { it.skipped }.mapIndexedNotNull { index, v ->
                surfaces[v.poiId]?.let { ReflectionVisit(v.poiId, day.date, it.nameKo, it.category, index + 1, v.photoCount) }
            }
        }
        val region = materials.regionOfTrip(ctx)
        if (!ReflectionAgentInput.callable(region, visits)) return retire("NOT_CALLABLE", tripId)
        val skippedByDate = days.associate { d -> d.date to d.visits.count { it.skipped } }
        val input = ReflectionAgentInput(
            kind = ReflectionAgentInput.KIND_TRIP_SUMMARY,
            region = region,
            startDate = owned.startDate,
            endDate = owned.endDate,
            visits = visits,
            personaSummary = materials.personaOf(owned.accountId, ctx),
            weatherSummary = null, // 비운다 — 이유는 ReflectionMaterials(관측값이 없다, BR-U5-31)
            events = materials.eventsIn(
                owned.accountId, tripId,
                generateSequence(owned.startDate) { it.plusDays(1) }.takeWhile { !it.isAfter(owned.endDate) }
                    .associateWith { skippedByDate[it] ?: 0 },
            ),
        )
        // 선점은 **부르기 바로 앞**이다 — 위 조회들(커넥션 대기 포함)이 끝난 뒤라, 다시 선점 여유([RECLAIM_MARGIN])가 덮을 것은 연결 시간뿐이다.
        // 지워진 여행·실을 방문이 없는 여행은 선점 없이 위에서 끝난다(시도를 쓰지 않고 채운다 — 어느 파드가 봐도 같은 결론이다).
        val attempt = writes.execute { summaries.claimAiAttempt(tripId, reclaimAfter(), MAX_ATTEMPTS) }
            ?: return outcome("NOT_CLAIMED", tripId) // 요약이 없음·이미 AI·기본 요약이거나, 다른 파드가 진행 중이거나, 상한을 다 썼다
        claim.attempt = attempt
        if (attempt >= MAX_ATTEMPTS) {
            // 부르기 **전에** 남긴다 — 이 시도가 파드와 함께 사라져도 "더 맡지 않는다"가 기록된다.
            log.warn("요약 회고 마지막 시도({}/{})입니다 — 이번에도 못 붙이면 더 맡지 않고 규칙 요약으로 남깁니다. tripId={}", attempt, MAX_ATTEMPTS, tripId)
        }
        val card = try {
            agent.generate(input)?.let { cards.read(it.payload) }
        } catch (e: Exception) { // Error 는 삼키지 않는다 — narrate 와 같은 규칙
            log.warn("요약 회고 카드를 읽을 수 없어 규칙 요약으로 둡니다. tripId={}", tripId, e)
            null
        } ?: return outcome("NO_CARD", tripId)
        // 상대 자기 폴백이면 쓰지 않는다 — 하루 회고와 다르다: 요약 문장은 우리 규칙 문장이 실적 수치를 담고 있어 상대 고정 문구보다 낫다.
        if (mapper.readTree(card.payload).path("is_fallback").asBoolean(false)) return outcome("AI_FALLBACK", tripId)
        // 자리표시자가 남은 부제(`{region} · {start_date}~{end_date}`)는 "서술 없음" 신호다.
        val narrative = card.subtitle.trim().takeIf { it.isNotEmpty() && '{' !in it } ?: return outcome("NO_NARRATIVE", tripId)
        val notVisited = days.flatMap { d -> d.visits.filter { it.skipped } }.mapNotNull { surfaces[it.poiId]?.nameKo }
        val offending = HallucinationGate.offendingPlaces(card.payload, notVisited, visits.map { it.poiName })
        if (offending.isNotEmpty()) {
            log.warn("요약 회고가 안 간 장소를 말해 규칙 요약으로 둡니다. tripId={} 장소={}", tripId, offending)
            metrics.hallucinationRejected(ReflectionAgentInput.KIND_TRIP_SUMMARY)
            return outcome("HALLUCINATION", tripId)
        }
        val written = writes.execute {
            // 잠근 뒤 다시 본다 — 기다리는 사이 다른 파드가 먼저 붙였으면 덮지 않는다.
            val current = summaries.findForUpdate(tripId)?.takeIf { it.source == ReflectionSource.RULE } ?: return@execute false
            summaries.upsert(current.copy(narrative = narrative, source = ReflectionSource.AI))
            true
        } == true
        outcome(if (written) "WRITTEN" else "SKIPPED", tripId)
    }

    private fun outcome(outcome: String, tripId: UUID) = log.info("trip.summary.narrate outcome={} tripId={}", outcome, tripId)

    /** 더 할 것이 없다 — 스윕이 다시 집지 않게 시도를 채운다. 상한 소진이 아니라 WARN 은 없다(규칙 요약이 맞는 답이다). */
    private fun retire(outcome: String, tripId: UUID) {
        writes.executeWithoutResult { summaries.retireAiAttempts(tripId, MAX_ATTEMPTS) }
        outcome(outcome, tripId)
    }

    /**
     * 종료 — 진행 중인 호출을 [AWAIT_TERMINATION_SECONDS] 까지 기다리고 나머지는 버린다. 파드 종료 유예(660초)보다 훨씬 짧은 이유: AI 행이면
     * 호출 하나가 605초+라 다 기다리면 배포가 그만큼 멈추는데, 버린 것 중 시도가 남은 것은 스윕이 다시 맡는다(시작 못 한 것은 시도를 안 썼고,
     * 진행 중이던 것은 시도 하나를 쓴 채 [reclaimAfter] 가 지나면 다시 선점된다). 버린 여행(대기 + 진행 중)을 남긴다. 진행 중 소켓 read 는 인터럽트로 깨지 않는다 — 데몬 스레드라
     * 프로세스 종료를 막지 않는다.
     */
    @PreDestroy
    fun shutdown() {
        executor.shutdown()
        if (executor.awaitTermination(AWAIT_TERMINATION_SECONDS, TimeUnit.SECONDS)) return
        val pending = inFlight.toList()
        executor.shutdownNow()
        log.warn(
            "요약 회고 실행기 종료 대기({}초)를 넘겼습니다 — 대기·진행 중이던 {}건 가운데 시도가 남은 것은 스윕이 다시 맡습니다. tripIds={}",
            AWAIT_TERMINATION_SECONDS, pending.size, pending,
        )
    }

    internal companion object {
        private val log = LoggerFactory.getLogger(TripSummaryNarrator::class.java)

        // ponytail: 고정 2·100 — 하루 끝에 여행이 몰려 끝나면 대기가 길어지고 넘친 건 규칙 요약에 남는다. 관측(outcome 로그)이 넘침을 보이면 늘린다.
        const val RUNNING = 2
        const val WAITING = 100
        private const val AWAIT_TERMINATION_SECONDS = 30L

        /** 시도 상한 — 결정적으로 실패하는 여행(상대 폴백·환각)이 스윕마다 AI 를 부르지 않게. */
        const val MAX_ATTEMPTS = 3

        /**
         * 스윕이 보는 요약의 나이 — `generated_at`(**마지막으로 다시 짠 시각**: `TripEnded` 재배달·못 읽는 요약 고침이 새 시각으로 덮는다. 경로 갱신과
         * 이 클래스의 AI 문장 쓰기는 그대로 둔다)이 이보다 오래된 규칙 요약은 다시 맡지 않는다. 이 기능 전에 만든 요약은 배포 뒤 이 창 안의 것만 채워진다.
         */
        val SWEEP_WINDOW: Duration = Duration.ofDays(7)

        /** 다시 선점 여유([reclaimAfter]) — 선점(호출 바로 앞) 커밋과 HTTP 연결 사이의 틈을 덮는다. 조회는 선점 앞이라 여기 들지 않는다. */
        val RECLAIM_MARGIN: Duration = Duration.ofSeconds(60)

        internal fun newExecutor(): ExecutorService {
            val seq = AtomicInteger()
            return ThreadPoolExecutor(
                RUNNING, RUNNING, 0L, TimeUnit.MILLISECONDS, LinkedBlockingQueue(WAITING),
                { r -> Thread(r, "tp-trip-summary-${seq.incrementAndGet()}").apply { isDaemon = true } },
                ThreadPoolExecutor.AbortPolicy(),
            )
        }
    }
}
