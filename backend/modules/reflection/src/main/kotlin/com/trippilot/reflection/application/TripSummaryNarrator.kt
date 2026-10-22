package com.trippilot.reflection.application

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.archive.api.ArchiveRecordFacade
import com.trippilot.placedata.api.PoiSurfaceFacade
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
import org.springframework.stereotype.Component
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionOperations
import org.springframework.transaction.support.TransactionTemplate
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
 * - **트랜잭션 밖이다**(TRIP-1463 교훈). 실적·재료 조회와 AI 호출은 각 퍼사드의 짧은 읽기 트랜잭션만 쓰고, 마지막 쓰기만 짧은
 *   트랜잭션에서 요약 잠금([TripSummaryRepository.findForUpdate])을 잡는다 — 커넥션을 AI 대기 동안 쥐지 않는다.
 *
 * ## 멱등(at-least-once)
 * 같은 `TripEnded` 가 다시 와도 AI 를 다시 부르지 않고, 이미 붙은 AI 문장을 덮지 않는다:
 * 이 파드에서 같은 여행이 대기·실행 중이면 받지 않고([inFlight]), 시작할 때와 쓸 때 요약 출처가 이미 AI 면 멈춘다.
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

    /** 이 파드에서 대기·실행 중인 여행. 다른 파드의 중복은 시작·쓰기의 출처 확인이 막는다. */
    private val inFlight: MutableSet<UUID> = ConcurrentHashMap.newKeySet()

    /**
     * AI 회고를 맡긴다 — **요약이 커밋된 뒤에**(트랜잭션 밖에서) 부른다. 안에서 맡기면 실행기가 아직 없는 행을 보고 그냥 끝난다.
     * 즉시 돌아온다.
     */
    fun request(tripId: UUID) {
        if (!agent.enabled) return
        if (!inFlight.add(tripId)) {
            log.debug("이 여행의 요약 회고가 이미 대기·실행 중이라 다시 맡지 않습니다. tripId={}", tripId)
            return
        }
        try {
            executor.execute {
                try {
                    narrate(tripId)
                } catch (e: RuntimeException) {
                    // 쓰기(DB)까지 실패한 경우다 — AI 실패는 narrate 안에서 값으로 끝난다. 규칙 요약은 남아 있다.
                    log.warn("요약 회고를 붙이지 못했습니다 — 규칙 요약이 남습니다. tripId={}", tripId, e)
                } finally {
                    inFlight.remove(tripId)
                }
            }
        } catch (e: RejectedExecutionException) {
            inFlight.remove(tripId)
            // 대기열이 찼거나 종료 중이다. 규칙 요약은 이미 저장됐으니 잃는 것은 AI 문장뿐이다 — 조용히 넘기지 않는다(INV-4).
            log.warn("요약 회고 실행기가 받지 않아 규칙 요약으로 둡니다(대기열 포화·종료 중). tripId={}", tripId)
        }
    }

    /** AI 문장 한 번 — 근거를 모으고, 부르고, 쓸 수 있으면 잠근 뒤 쓴다. */
    internal fun narrate(tripId: UUID) {
        if (summaries.find(tripId)?.source != ReflectionSource.RULE) return outcome("SKIPPED", tripId) // 없음·이미 AI·방문 없는 기본 요약
        val owned = owners.findOwnedPeriod(tripId) ?: return outcome("DELETED", tripId)
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
        if (!ReflectionAgentInput.callable(region, visits)) return outcome("NOT_CALLABLE", tripId)
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
        val card = runCatching { agent.generate(input)?.let { cards.read(it.payload) } }
            .onFailure { log.warn("요약 회고 카드를 읽을 수 없어 규칙 요약으로 둡니다. tripId={}", tripId, it) }
            .getOrNull() ?: return outcome("NO_CARD", tripId)
        // 상대 자기 폴백이면 쓰지 않는다 — 하루 회고와 다르다: 요약 문장은 우리 규칙 문장이 실적 수치를 담고 있어 상대 고정 문구보다 낫다.
        if (mapper.readTree(card.payload).path("is_fallback").asBoolean(false)) return outcome("AI_FALLBACK", tripId)
        // 자리표시자가 남은 부제(`{region} · {start_date}~{end_date}`)는 "서술 없음" 신호다.
        val narrative = card.subtitle.trim().takeIf { it.isNotEmpty() && '{' !in it } ?: return outcome("NO_NARRATIVE", tripId)
        val notVisited = days.flatMap { d -> d.visits.filter { it.skipped } }.mapNotNull { surfaces[it.poiId]?.nameKo }
        val offending = HallucinationGate.offendingPlaces(card.payload, notVisited, visits.map { it.poiName })
        if (offending.isNotEmpty()) {
            log.warn("요약 회고가 안 간 장소를 말해 규칙 요약으로 둡니다. tripId={} 장소={}", tripId, offending)
            metrics.hallucinationRejected()
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

    /**
     * 종료 — 진행 중인 호출을 [AWAIT_TERMINATION_SECONDS] 까지 기다리고 나머지는 버린다. 버려도 규칙 요약이 남아 있고, 버린 건수를 남긴다.
     * 진행 중 소켓 read 는 인터럽트로 깨지 않는다 — 데몬 스레드라 프로세스 종료를 막지 않는다.
     */
    @PreDestroy
    fun shutdown() {
        executor.shutdown()
        if (executor.awaitTermination(AWAIT_TERMINATION_SECONDS, TimeUnit.SECONDS)) return
        val dropped = executor.shutdownNow().size
        log.warn("요약 회고 실행기 종료 대기를 넘겼습니다 — 시작 못 한 {}건은 규칙 요약으로 남습니다.", dropped)
    }

    internal companion object {
        private val log = LoggerFactory.getLogger(TripSummaryNarrator::class.java)

        // ponytail: 고정 2·100 — 하루 끝에 여행이 몰려 끝나면 대기가 길어지고 넘친 건 규칙 요약에 남는다. 관측(outcome 로그)이 넘침을 보이면 늘린다.
        const val RUNNING = 2
        const val WAITING = 100
        private const val AWAIT_TERMINATION_SECONDS = 30L

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
