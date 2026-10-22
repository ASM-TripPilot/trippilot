package com.trippilot.planbdetection.application

import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.itinerarygeneration.api.ItineraryRef
import com.trippilot.itinerarygeneration.api.PlannedSlotView
import com.trippilot.planbdetection.domain.PlanBTrigger
import com.trippilot.planbdetection.domain.PlanBTriggerRepository
import com.trippilot.planbdetection.domain.PlanBWatch
import com.trippilot.planbdetection.domain.PlanBWatchRepository
import com.trippilot.planbdetection.domain.TriggerLifecycle
import com.trippilot.planbdetection.domain.WatchStatus
import com.trippilot.trip.api.TripPeriod
import com.trippilot.trip.api.TripWatchFacade
import com.trippilot.trip.api.WatchedTrip
import jakarta.annotation.PreDestroy
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.ObjectProvider
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.context.ApplicationContext
import org.springframework.context.ApplicationContextAware
import org.springframework.context.event.ContextClosedEvent
import org.springframework.context.event.EventListener
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.format.TextStyle
import java.time.temporal.ChronoUnit
import java.util.Collections
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutionException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.ceil

/**
 * Plan-B 상황 감시 스윕(C9 · 설계서 §4.1 규칙 1~5 · BR-SA-01~04) — 여행 중 일정을 막는 상황을 서버가 먼저 찾는다.
 *
 * 회차마다: 겹치는 여행을 시작 위치를 돌려 가며 읽고([roundOrder]) → 계정 허용목록 → 확정 일정만 → 그 날 끝나지 않은
 * 슬롯이 있는 날짜마다 감지기를 **트랜잭션 밖에서** 부르고 → 여행 하나씩 `TriggerService.reconcile`(여행 1개 = 트랜잭션 1개)
 * → 본 날짜를 모두 확인한 출처의 감시 상태(확인)를 남긴다. 회차 요약은 INFO 1줄이다(운영은 지표 내보내기가 꺼져 있다 — OBS-SA-01·07).
 *
 * - **쓰지 않는 경우**: 모드 dry-run(판정·요약만), 관찰 전용 출처(요약·표본 줄만), 20:58 이후(INV-SA-5).
 * - **멈추는 경우**: 예산·종료 신호(컨텍스트 닫힘)·20:58 — 여행 사이에서 멈추고 정상 반환해 락을 푼다. 못 본 여행은 `skipped` 다.
 * - **격리**: 감지기 예외는 그 (출처, 여행, 날짜)만 모름, 같은 출처가 한 회차에서 연속 3번 던지면 남은 여행은 그 출처를
 *   모름으로 둔다(회로 차단). 여행 처리 예외는 그 여행만 실패(WARN)로 세고 다음 여행을 계속한다. Error 는 격리하지 않는다 —
 *   남은 여행을 멈추고 진행 중 여행을 기다린 뒤 요약·ERROR 를 남기고 던진다.
 *
 * 이 빈이 [WatchingSources] 다 — 지금 감시 중인 출처를 조회 API(회수 필터·감시 상태 OFF)에 알려 준다.
 */
@Component
class SituationSweep(
    private val props: SituationSweepProperties,
    private val trips: TripWatchFacade,
    private val itineraries: ItineraryFacade,
    private val plans: ItineraryPlanFacade,
    private val triggers: TriggerService,
    private val rows: PlanBTriggerRepository,
    private val watches: PlanBWatchRepository,
    /** 감지기 빈 — 0개여도 기동한다(감지기는 다음 변경들이 하나씩 더한다). */
    detectors: ObjectProvider<SituationDetector>,
    private val clock: Clock,
) : WatchingSources, ApplicationContextAware {

    private val detectors: List<SituationDetector> = detectors.orderedStream().toList()

    /** 종료 신호 — 받으면 여행 사이에서 멈춘다. */
    private val stopping = AtomicBoolean(false)

    /** 이 빈이 든 컨텍스트 — 닫힘 사건이 내 것인지 가린다. */
    @Volatile private var context: ApplicationContext? = null

    init {
        val doubled = this.detectors.groupBy { it.source }.filterValues { it.size > 1 }.keys
        require(doubled.isEmpty()) { "같은 출처의 감지기가 둘 이상입니다: $doubled — 어느 쪽이 해제 자격인지 갈린다." }
    }

    /**
     * 감시 중 = on ∧ 출처 목록 안 ∧ 관찰 전용 아님 ∧ 그 출처 감지기가 살아 있음 ∧ 그 계정이 스윕 대상(규칙 14 · BR-SA-13).
     * 허용목록(운영 카나리) 밖 계정은 스윕이 보지 않으므로 '꺼짐'이다 — '확인 불가'로 그리지 않고, 그 계정의 스윕 트리거는 숨긴다.
     */
    override fun isWatching(source: String, accountId: UUID): Boolean =
        props.mode == SweepMode.ON && writes(source) && covers(accountId) && detectors.any { it.source == source && it.isLive() }

    /**
     * 매시 :15(07~20시, KST). **cron 인 이유** — KST 정렬과 밤 제외(INV-SA-5)는 cron 만 표현한다(`fixedDelay` 는 기동 시각에 끌려간다).
     * 락: 최소 5분은 두 파드가 같은 순간 깨는 cron 의 재실행을 막고, 최대 24분은 죽은 파드의 락이 20:40 보충을 막지 않게 한다 —
     * 예산 20분 + 진행 중 여행 마무리(감지 시한 ≤ 62초)보다 길고 간격(25분)보다 짧다. 간격과 같으면 락 만료(DB 시각)와 보충
     * 회차의 획득 시도가 같은 순간이라 밀리초 경합이 되고, 지면 ShedLock 은 DEBUG 만 남겨 그날 내일 점검이 조용히 빠진다.
     * 이름은 U10 지연 스캔(`planb-delay-scan`)과 다르다 — 같으면 두 스윕이 서로를 막는다.
     */
    @Scheduled(cron = "\${trippilot.planb.situation-sweep.cron:0 15 7-20 * * *}", zone = "Asia/Seoul")
    @SchedulerLock(name = LOCK_NAME, lockAtMostFor = "PT24M", lockAtLeastFor = "PT5M")
    fun hourly() {
        sweep(clock.instant())
    }

    /** 20:40 보충 — 배포·장애로 끊긴 20:15 회차의 내일 점검을 잇는다(BR-SA-01). 같은 락이다. */
    @Scheduled(cron = "\${trippilot.planb.situation-sweep.evening-cron:0 40 20 * * *}", zone = "Asia/Seoul")
    @SchedulerLock(name = LOCK_NAME, lockAtMostFor = "PT24M", lockAtLeastFor = "PT5M")
    fun eveningCatchUp() {
        sweep(clock.instant())
    }

    override fun setApplicationContext(applicationContext: ApplicationContext) {
        context = applicationContext
    }

    /**
     * 종료 신호는 **컨텍스트 닫힘 사건**에서 받는다(RES-SA-06). 닫힘 순서는 사건 → 스케줄러 생명주기 단계가 진행 중 회차를
     * 단계 시한(운영 630초)까지 기다림 → 빈 파괴(DataSource 닫힘 · 스케줄러 인터럽트)다. 빈 파괴(`@PreDestroy`)에서야 알면
     * 그 시한 내내 회차가 종료를 모른 채 쓰고·푸시하고(끄기 재배포가 늦게 먹는다), 락 해제 UPDATE 는 닫힌 풀에서 실패해
     * 락이 상한까지 남는다. 자식 컨텍스트의 닫힘(부모로 전파된다)에는 멈추지 않는다 — 한 번 서면 재기동까지 회차가 빈다.
     */
    @EventListener
    fun onContextClosed(event: ContextClosedEvent) {
        if (event.applicationContext === context) stop()
    }

    /** 예비 — 컨텍스트 닫힘 없이 빈만 파괴되는 경우. */
    @PreDestroy
    fun stop() = stopping.set(true)

    /** 기동 안내 1줄 — DB 쓰기 없음(기동 시 쓰기는 모든 전체 컨텍스트 테스트를 그 쓰기에 묶는다). */
    @EventListener(ApplicationReadyEvent::class)
    fun announce() = log.info(announcement())

    fun announcement(): String {
        val state = when (props.mode) {
            SweepMode.OFF -> "꺼짐"
            SweepMode.DRY_RUN -> "관찰"
            SweepMode.ON -> "켜짐"
        }
        val live = detectors.filter { it.source in props.sources && it.isLive() }.map { it.source }
        // 대상 = 운영 카나리 적용 여부(켜기 4단계: 내부 계정 → 비움). 개수만 싣는다 — 계정 id 는 로그에 싣지 않는다(SEC-SA-05).
        val target = if (props.accountIds.isEmpty()) "전원" else "계정 ${props.accountIds.size}개"
        return "상황 감시 = $state · 지평=${props.horizon.label} · 대상=$target · 감지기 live=${live.listed()} · " +
            "관찰 전용=${props.observeOnly.listed()}"
    }

    /**
     * 회차 하나. 스케줄이 부르고 테스트가 직접 부른다. [now] = 회차 시각 — 회차 범위·시작 위치를 정하고,
     * 판정 시각은 여기에 회차가 흐른 시간을 더한 값이다(20:58 컷·예산이 같은 축에서 잰다).
     */
    fun sweep(now: Instant): SweepSummary {
        if (props.mode == SweepMode.OFF) return SweepSummary(props.mode, null)
        val scope = scopeAt(now, props.horizon) ?: return SweepSummary(props.mode, null)
        val round = Round(scope, now, clock.instant(), detectors.filter { it.source in props.sources && it.isLive() })
        val order = roundOrder(trips, scope.today, scope.queryTo, pivotFor(now), PAGE_SIZE).filter { covers(it.accountId) }
        val seq = AtomicInteger()
        val pool = Executors.newFixedThreadPool(props.parallelism) { r ->
            Thread(r, "planb-sweep-${seq.incrementAndGet()}").apply { isDaemon = true }
        }
        try {
            order.map { trip -> pool.submit(Runnable { guarded(trip, round) }) }.forEach { it.get() }
        } catch (e: InterruptedException) {
            // 종료 단계 시한을 넘겨 회차 스레드가 끊겼다(RES-SA-06 예비 경로 — 보통은 닫힘 사건이 먼저 멈춘다). 시작 안 한 여행은
            // 건너뛰고, 진행 중 여행은 마치게 둔 뒤 돌아온다 — 먼저 돌아오면 락이 풀린 뒤에도 그 여행이 쓰고, 요약이 실제와 다른 수를 말한다.
            round.aborted.set(true)
            drain(pool)
            Thread.currentThread().interrupt()
            log.warn("상황 스윕 회차가 끊겼습니다 — 남은 여행은 다음 회차가 봅니다.")
        } catch (e: ExecutionException) {
            // 여행 처리가 격리(Exception) 밖의 Error 로 끝났다 — 그 스레드가 이미 회차를 멈췄다([guarded]). 진행 중 여행을 기다리고
            // 요약을 남긴 뒤 그대로 던진다. 기다리지 않고 던지면 락이 풀린 뒤에도 남은 여행이 판정·쓰기·푸시를 이어 간다.
            drain(pool)
            val cause = e.cause ?: e
            log.info(round.summary().line())
            log.error("상황 스윕 회차가 오류로 멈췄습니다 — 남은 여행은 다음 회차가 봅니다.", cause)
            throw cause
        } finally {
            pool.shutdownNow() // 정상 경로에서는 모든 여행이 끝난 뒤라 무해하다 — 남은 대기 작업을 실행하지 않고 버린다.
        }
        return round.summary().also { log.info(it.line()) }
    }

    /**
     * 여행 하나 — Exception 은 [visit] 이 그 여행 안에서 격리한다. 그 밖(Error — 미구현 `TODO()`·클래스 초기화 실패·스택 넘침)이면
     * 이 스레드에서 바로 회차를 멈춘다: 회차 스레드가 알아채기 전에 다음 여행이 시작하지 않게.
     */
    private fun guarded(trip: WatchedTrip, round: Round) {
        try {
            visit(trip, round)
        } catch (t: Throwable) {
            round.aborted.set(true)
            round.failed.incrementAndGet()
            throw t
        }
    }

    /** 대기 중 여행은 회차 중단을 보고 바로 건너뛰고, 진행 중 여행은 상한까지 마치게 둔다. */
    private fun drain(pool: ExecutorService) {
        pool.shutdown()
        runCatching { pool.awaitTermination(IN_FLIGHT_GRACE.seconds, TimeUnit.SECONDS) }
    }

    private fun visit(trip: WatchedTrip, round: Round) {
        val at = round.now()
        if (stopping.get() || round.aborted.get() || round.spent() || !round.scope.writable(at)) {
            round.skipped.incrementAndGet()
            return
        }
        try {
            val itinerary = itineraries.findCurrent(trip.accountId, trip.tripId)
            // 확정 일정만 — 허브·대안 화면(i04~i06)은 확정 일정에만 있다. 계획 중 일정에 알리면 탭할 곳이 없다(BR-SA-02).
            if (itinerary?.status != CONFIRMED) return
            val slots = plans.findPlanSlots(trip.accountId, trip.tripId)
            val observations = observe(round, trip, slots, rows.findActiveByTrip(trip.tripId), at)
            // 판정에 드는 관측 = 켰을 때 쓰는 출처(목록 안 ∧ 관찰 전용 아님). 쓰지 않는 결과(관찰 전용 · dry-run 전부)는 표본 줄로.
            val (judged, unjudged) = observations.partition { writes(it.source) }
            sample(trip, if (props.mode == SweepMode.ON) unjudged else observations, slots)
            val writeAt = round.now()
            if (!round.scope.writable(writeAt)) { // 감지하는 사이 20:58 을 넘겼다 — 쓰지 않는다(dry-run 도 켰을 때와 같은 수를 센다)
                round.skipped.incrementAndGet()
                return
            }
            if (props.mode == SweepMode.ON) {
                round.tally(reconcile(trip, writeAt, itinerary, slots, judged))
                record(trip, judged, writeAt)
            } else { // dry-run — 같은 판정을 쓰기 없이 돌려 켰다면 낼 사건·만료 수만 센다
                round.tally(triggers.preview(trip.accountId, trip.tripId, trip.period, writeAt, itinerary, slots, judged))
            }
            round.trips.incrementAndGet()
        } catch (e: Exception) {
            round.failed.incrementAndGet()
            log.warn("상황 스윕 — 여행 하나를 판정하지 못했습니다(상태 불변, 다음 여행은 계속). tripId={}", trip.tripId, e)
        }
    }

    /** 볼 날짜마다 끝나지 않은 슬롯이 있으면 그 단계·날짜를 원하는 감지기를 부른다. 빈 날은 부르지 않는다(만료는 판정이 돈다). */
    private fun observe(
        round: Round, trip: WatchedTrip, slots: List<PlannedSlotView>, actives: List<PlanBTrigger>, at: Instant,
    ): List<Observation> {
        val day = LocalDate.ofInstant(at, TriggerLifecycle.TRAVEL_ZONE)
        val time = LocalTime.ofInstant(at, TriggerLifecycle.TRAVEL_ZONE)
        val result = mutableListOf<Observation>()
        for (date in round.scope.datesOf(trip.startDate, trip.endDate)) {
            val remaining = slots.filter {
                it.date == date && !TriggerLifecycle.SlotTime(it.slotKey, it.date, it.startAt, it.endAt, it.endsNextDay).endedAt(day, time)
            }
            if (remaining.isEmpty()) continue
            val offset = ChronoUnit.DAYS.between(round.scope.today, date).toInt()
            for (d in round.called) {
                if (!d.wants(round.scope.phase, offset)) continue
                val mine = actives.filter { it.detector == d.source && it.affectedDate == date }
                val target = SweepTarget(
                    trip.tripId, trip.accountId, date, round.scope.phase, round = round.start, now = at, slots = remaining, active = mine,
                )
                result += Observation(d.source, d.kind, date, round.detect(d, target))
            }
        }
        return result
    }

    /** 대상 유일 키 위반이면 새 트랜잭션으로 한 번 다시 판정한다(RES-SA-05) — 다른 경로(날씨 확인 등)의 같은 대상 INSERT 와 겹친 것이다. */
    private fun reconcile(
        trip: WatchedTrip, at: Instant, itinerary: ItineraryRef, slots: List<PlannedSlotView>, observations: List<Observation>,
    ): ReconcileOutcome = try {
        triggers.reconcile(trip.accountId, trip.tripId, trip.period, at, itinerary, slots, observations)
    } catch (e: DataIntegrityViolationException) {
        log.info("상황 스윕 — 대상 유일 키 경합, 새 트랜잭션으로 한 번 다시 판정합니다. tripId={}", trip.tripId)
        triggers.reconcile(trip.accountId, trip.tripId, trip.period, at, itinerary, slots, observations)
    }

    /**
     * 감시 상태 — 쓴 출처가 이 회차에 본 날짜를 **모두 확인했을 때만** 확인을 남긴다(BR-SA-13 ③ · RES-SA-01).
     * 모름(회로 차단 포함)이나 일부 모름([Detection.Checked.partial] — G-SA-21)이 낀 출처는 행을 건드리지 않는다 — 마지막 확인이
     * 신선 창을 지나면 '확인 불가'가 된다. 그래서 일시 모름 한 번은 창이 흡수하고(PERF-SA-09) 거짓 '정상'도 새로 쓰지 않는다.
     * 관찰 전용·안 부른 출처는 쓰지 않는다.
     */
    private fun record(trip: WatchedTrip, written: List<Observation>, at: Instant) {
        written.groupBy { it.source }.forEach { (source, seen) ->
            if (seen.any { val d = it.detection; d !is Detection.Checked || d.partial }) return@forEach
            runCatching { watches.upsert(PlanBWatch(trip.tripId, source, WatchStatus.CHECKED, at)) }
                .onFailure { log.warn("감시 상태를 남기지 못했습니다 — 다음 회차가 다시 씁니다. tripId={} source={}", trip.tripId, source, it) }
        }
    }

    /**
     * 쓰지 않은 신호의 표본 줄 — dry-run·관찰 전용으로 휴무 오탐·광역 특보를 재는 재료(OBS-SA-01). 좌표·계정 id 는 싣지 않는다.
     * 슬롯 신호는 장소 이름과 계획 시각(요일 포함)을 싣는다 — 장소 id 는 환경마다 다른 무작위 값이라, 이것 없이는 영업시간 원문과
     * 로그만으로 대조할 수 없다(운영 dry-run 첫 아침 표본 3건이 그랬다). 날짜 전체 신호는 둘 다 null 이다.
     */
    private fun sample(trip: WatchedTrip, observed: List<Observation>, slots: List<PlannedSlotView>) {
        val byKey = slots.associateBy { it.slotKey }
        for (o in observed) {
            val checked = o.detection as? Detection.Checked ?: continue
            for (s in checked.signals) {
                val slot = s.slotKey?.let(byKey::get)
                log.info(
                    "planb.situation_sample tripId={} source={} kind={} date={} variant={} severity={} slot={} name={} at={}",
                    trip.tripId, o.source, s.kind, s.affectedDate, s.variant, s.severity, s.slotKey,
                    slot?.nameKo?.let { "\"${it.replace('"', '\'')}\"" }, slot?.let(::plannedAt),
                )
            }
        }
    }

    private fun writes(source: String) = source in props.sources && source !in props.observeOnly

    /** 스윕 대상 계정인가 — 허용목록(운영 카나리)이 비면 전원. 회차 대상과 감시 판정이 같은 답을 내도록 한 곳에 둔다. */
    private fun covers(accountId: UUID) = props.accountIds.isEmpty() || accountId in props.accountIds

    /** 회차 하나의 상태 — 여행 단위 병렬이라 모두 스레드 안전하다. 회차가 끝나면 버린다(저장 없음). */
    private inner class Round(
        val scope: SweepScope,
        /** 회차 시각 = 회차 키(감지기의 회차 범위 기억을 묶는다). */
        val start: Instant,
        private val startedAt: Instant,
        val called: List<SituationDetector>,
    ) {
        val trips = AtomicInteger()
        val skipped = AtomicInteger()
        val failed = AtomicInteger()
        val aborted = AtomicBoolean()
        private val announced = AtomicInteger()
        private val pushed = AtomicInteger()
        private val quiet = AtomicInteger()
        private val expired = AtomicInteger()
        private val unknown = ConcurrentHashMap<String, AtomicInteger>()
        private val latency = ConcurrentHashMap<String, MutableList<Long>>()
        private val failures = ConcurrentHashMap<String, AtomicInteger>()
        private val open: MutableSet<String> = ConcurrentHashMap.newKeySet()

        fun elapsed(): Duration = Duration.between(startedAt, clock.instant())

        /** 판정 시각 = 회차 시각 + 흐른 시간. */
        fun now(): Instant = start.plus(elapsed())

        fun spent(): Boolean = elapsed() >= props.budget

        fun tally(o: ReconcileOutcome) {
            if (o.announced) announced.incrementAndGet()
            if (o.pushed) pushed.incrementAndGet()
            quiet.addAndGet(o.quiet)
            expired.addAndGet(o.expired)
        }

        /**
         * 감지기 한 번 — 예외는 그 대상만 모름, 같은 출처의 연속 실패가 [CIRCUIT_THRESHOLD] 에 닿으면 회로를 연다.
         * 예외는 **종류만** 적는다 — 외부 호출 예외 메시지에는 요청 주소(서비스 키가 질의 문자열에 있다)가 실릴 수 있다(SEC-SA-03).
         */
        fun detect(d: SituationDetector, target: SweepTarget): Detection {
            val result = if (d.source in open) {
                Detection.Unknown(CIRCUIT_OPEN)
            } else {
                val begin = clock.instant()
                val failuresOf = failures.computeIfAbsent(d.source) { AtomicInteger() }
                val answer = try {
                    d.detect(target).also { failuresOf.set(0) }
                } catch (e: Exception) {
                    log.warn(
                        "상황 감지기 실패 — 그 출처·여행·날짜만 모름으로 둡니다. source={} tripId={} date={} 예외={}",
                        d.source, target.tripId, target.date, e.javaClass.name,
                    )
                    if (failuresOf.incrementAndGet() >= CIRCUIT_THRESHOLD && open.add(d.source)) {
                        log.warn("상황 감지기 회로를 엽니다 — {} 가 연속 {}번 실패했습니다. 이 회차의 남은 여행은 이 출처를 모름으로 둡니다.", d.source, CIRCUIT_THRESHOLD)
                    }
                    Detection.Unknown("error:${e.javaClass.simpleName}")
                }
                latency.computeIfAbsent(d.source) { Collections.synchronizedList(mutableListOf()) } +=
                    Duration.between(begin, clock.instant()).toMillis()
                answer
            }
            if (result is Detection.Unknown) unknown.computeIfAbsent(d.source) { AtomicInteger() }.incrementAndGet()
            return result
        }

        fun summary(): SweepSummary {
            val calledSources = called.map { it.source }.toSet()
            return SweepSummary(
                mode = props.mode,
                phase = scope.phase,
                trips = trips.get(),
                skipped = skipped.get(),
                failed = failed.get(),
                live = calledSources.filter { it !in props.observeOnly }.sorted(),
                off = ((props.sources + detectors.map { it.source }).toSet() - calledSources).sorted(),
                observe = calledSources.filter { it in props.observeOnly }.sorted(),
                unknown = unknown.mapValues { it.value.get() }.toSortedMap(),
                announced = announced.get(),
                pushed = pushed.get(),
                quiet = quiet.get(),
                expired = expired.get(),
                elapsedMs = elapsed().toMillis(),
                detectorMs = latency.mapValues { (_, ms) -> synchronized(ms) { percentile(ms, 50) to percentile(ms, 95) } }.toSortedMap(),
            )
        }
    }

    companion object {
        private val log = LoggerFactory.getLogger(SituationSweep::class.java)

        /** 클러스터 단일 실행 락(`shedlock` 행은 첫 획득 때 스스로 생긴다 — 마이그레이션 없음). */
        private const val LOCK_NAME = "planb-situation-scan"

        /** 감시 대상 조회 한 페이지 — 퍼사드 상한과 같다. */
        private const val PAGE_SIZE = 500

        /** 한 회차에서 같은 출처가 연속 몇 번 실패하면 회로를 여는가(RES-SA-04). */
        private const val CIRCUIT_THRESHOLD = 3

        /** 끊긴 회차가 진행 중 여행을 기다려 주는 상한 — AI 검증 소켓 상한(62초) + 판정. graceful 종료(630초) 안이다. */
        private val IN_FLIGHT_GRACE: Duration = Duration.ofSeconds(90)

        private const val CIRCUIT_OPEN = "circuit-open"

        /** 스윕 대상 일정 상태 — 일정 모듈이 문자열로 넘긴다(`ItineraryRef.status`). */
        private const val CONFIRMED = "CONFIRMED"

        /** 근사 순위 백분위(nearest-rank). 목록은 부른 만큼 쌓여서 비어 있지 않다. */
        private fun percentile(values: List<Long>, p: Int): Long {
            val sorted = values.sorted()
            return sorted[ceil(p / 100.0 * sorted.size).toInt().coerceIn(1, sorted.size) - 1]
        }
    }
}

/**
 * 회차 요약 — 로그 1줄(OBS-SA-01, 형식 고정)의 재료이자 테스트가 보는 값. [phase] 가 null 이면 회차가 없었다(꺼짐·밤).
 *
 * `trips` 본 여행 · `skipped` 예산·종료·20:58 로 못 본 여행 · `failed` 일정 조회·판정이 실패한 여행 ·
 * `live`/`observe`/`off` 쓴 출처·관찰 전용 출처·안 부른 출처 · `unknown` 출처별 모름 수 · `announced`/`pushed`/`quiet`/`expired`
 * 알림 사건·그중 푸시·조용한 발화·만료(dry-run 은 켰다면 냈을 수 — 쓰지 않는 판정) · `elapsedMs` 회차 소요 ·
 * `detectorMs` 출처별 감지 지연 p50/p95.
 */
data class SweepSummary(
    val mode: SweepMode,
    val phase: SweepPhase?,
    val trips: Int = 0,
    val skipped: Int = 0,
    val failed: Int = 0,
    val live: List<String> = emptyList(),
    val off: List<String> = emptyList(),
    val observe: List<String> = emptyList(),
    val unknown: Map<String, Int> = emptyMap(),
    val announced: Int = 0,
    val pushed: Int = 0,
    val quiet: Int = 0,
    val expired: Int = 0,
    val elapsedMs: Long = 0,
    val detectorMs: Map<String, Pair<Long, Long>> = emptyMap(),
) {
    fun line(): String =
        "planb.situation_sweep mode=${mode.label} phase=$phase trips=$trips skipped=$skipped failed=$failed " +
            "live=${live.listed()} off=${off.listed()} observe=${observe.listed()} " +
            "unknown=${unknown.entries.joinToString(",", "{", "}") { "${it.key}:${it.value}" }} " +
            "announced=$announced pushed=$pushed quiet=$quiet expired=$expired elapsedMs=$elapsedMs " +
            "detectorMs=${detectorMs.entries.joinToString(",", "{", "}") { "${it.key}:${it.value.first}/${it.value.second}" }}"
}

private fun Collection<String>.listed(): String = sorted().joinToString(",", "[", "]")

/** 표본 줄의 계획 시각 — `화 18:00~19:00`(자정을 넘기면 끝에 `(+1)`). 정기 휴무는 요일로, 영업시간은 시각으로 대조한다. */
private fun plannedAt(slot: PlannedSlotView): String =
    "${slot.date.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.KOREAN)} ${slot.startAt}~${slot.endAt}" +
        if (slot.endsNextDay) "(+1)" else ""

private val WatchedTrip.period: TripPeriod get() = TripPeriod(startDate, endDate)

/**
 * 회차 하나가 보는 범위(설계서 규칙 1 · BR-SA-01) — 단계·오늘(KST)·지평.
 *
 * 밤(21:00~06:59)에는 회차가 없고([scopeAt] 이 null), 회차 안에서도 [writeCut](20:58) 이후에는 쓰지 않는다(INV-SA-5) —
 * 아웃박스 발행·푸시가 21시를 넘지 않게 하는 여유다.
 */
data class SweepScope(val phase: SweepPhase, val today: LocalDate, val horizon: SweepHorizon) {

    /** 쓰기 마감 — 그 날 20:58(KST). */
    val writeCut: Instant = today.atTime(WRITE_CUT).atZone(TriggerLifecycle.TRAVEL_ZONE).toInstant()

    /** 감시 대상 조회의 끝 날짜 — 내일 시작 여행(D-1)을 보는 저녁 pre-trip 회차만 내일까지 묻는다. */
    val queryTo: LocalDate get() = if (phase == SweepPhase.EVENING && horizon == SweepHorizon.PRE_TRIP) today.plusDays(1) else today

    /**
     * 그 여행에서 이번 회차가 볼 날짜 — 오늘(구간 안이면) + 저녁 회차의 내일(지평이 열 때만).
     * 진행 중 여행의 내일은 지평 tomorrow 이상, 내일 시작하는 여행의 첫날은 pre-trip 일 때만이다.
     */
    fun datesOf(start: LocalDate, end: LocalDate): List<LocalDate> = buildList {
        if (today in start..end) add(today)
        val tomorrow = today.plusDays(1)
        if (phase != SweepPhase.EVENING || tomorrow !in start..end) return@buildList
        val opened = if (start == tomorrow) horizon == SweepHorizon.PRE_TRIP else horizon != SweepHorizon.TODAY
        if (opened) add(tomorrow)
    }

    /** 이 시각에 쓰기·발행을 해도 되는가. */
    fun writable(at: Instant): Boolean = at.isBefore(writeCut)

    private companion object {
        private val WRITE_CUT: LocalTime = LocalTime.of(20, 58)
    }
}

/** [now] 의 회차 범위 — 07시 아침 · 08~19시 낮 · 20시 저녁, 그 밖(21:00~06:59 KST)은 null(회차 없음). */
fun scopeAt(now: Instant, horizon: SweepHorizon): SweepScope? {
    val local = LocalDateTime.ofInstant(now, TriggerLifecycle.TRAVEL_ZONE)
    val phase = when (local.hour) {
        7 -> SweepPhase.MORNING
        in 8..19 -> SweepPhase.DAYTIME
        20 -> SweepPhase.EVENING
        else -> return null
    }
    return SweepScope(phase, local.toLocalDate(), horizon)
}

/**
 * 회차의 시작 키 — 회차 시각에서 결정론적으로 만든다(상태 저장 없음 · BR-SA-03 ①).
 * 매 회차 같은 첫 페이지부터 돌면 예산에 걸린 꼬리 여행이 영영 평가되지 않는다(검토 K6).
 */
fun pivotFor(now: Instant): UUID = UUID.nameUUIDFromBytes(now.epochSecond.toString().toByteArray())

/**
 * 회차가 도는 여행 순서 — [pivot] 다음 키부터 끝까지, 이어 처음부터 [pivot] 까지(키셋 페이지 [pageSize] 건씩).
 *
 * 두 바퀴째는 **이미 본 키를 만나면 멈춘다** — 키 순서를 여기서 비교하지 않으므로(PG uuid 순서는 자바 `UUID.compareTo` 와
 * 다르다) 그 차이에 기대지 않고, 읽는 사이 여행이 생기거나 지워져도 같은 여행을 두 번 넣지 않는다.
 */
internal fun roundOrder(trips: TripWatchFacade, from: LocalDate, to: LocalDate, pivot: UUID, pageSize: Int): List<WatchedTrip> {
    val seen = LinkedHashMap<UUID, WatchedTrip>()
    fun drain(start: UUID?, stopAtSeen: Boolean) {
        var after = start
        while (true) {
            val page = trips.findOverlapping(from, to, after, pageSize)
            for (t in page) {
                if (stopAtSeen && t.tripId in seen) return
                seen.putIfAbsent(t.tripId, t)
            }
            if (page.size < pageSize) return
            after = page.last().tripId
        }
    }
    drain(pivot, stopAtSeen = false)
    drain(null, stopAtSeen = true)
    return seen.values.toList()
}
