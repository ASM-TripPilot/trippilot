package com.trippilot.planbdetection.application

import com.trippilot.core.event.DomainEvent
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.itinerarygeneration.api.ItineraryRef
import com.trippilot.itinerarygeneration.api.PlannedSlotView
import com.trippilot.planbdetection.domain.DataSource
import com.trippilot.planbdetection.domain.PlanBTrigger
import com.trippilot.planbdetection.domain.PlanBTriggerRepository
import com.trippilot.planbdetection.domain.PlanBWatch
import com.trippilot.planbdetection.domain.PlanBWatchRepository
import com.trippilot.planbdetection.domain.Sensitivity
import com.trippilot.planbdetection.domain.SweepSource
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerScope
import com.trippilot.planbdetection.domain.TriggerState
import com.trippilot.planbdetection.domain.TriggerVariant
import com.trippilot.planbdetection.domain.WatchStatus
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.WatchedTrip
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldContainExactlyInAnyOrder
import io.kotest.matchers.shouldBe
import org.springframework.beans.factory.ObjectProvider
import org.springframework.dao.DataIntegrityViolationException
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Collections
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.stream.Stream

private val KST: ZoneId = ZoneId.of("Asia/Seoul")
private val DAY: LocalDate = LocalDate.parse("2026-08-11") // 화요일

private fun at(hhmm: String, date: LocalDate = DAY): Instant = date.atTime(LocalTime.parse(hhmm)).atZone(KST).toInstant()

/** 테스트가 미는 시계 — 회차가 흐른 시간(예산·20:58 컷·감지 지연)의 원천이다. */
private class StepClock(@Volatile var current: Instant) : Clock() {
    override fun getZone(): ZoneId = ZoneOffset.UTC
    override fun withZone(zone: ZoneId?): Clock = this
    override fun instant(): Instant = current

    @Synchronized
    fun advance(by: Duration) {
        current = current.plus(by)
    }
}

/** 감지기 대역 — 받은 대상을 적고, 정해 둔 답을 낸다(던지면 실물처럼 예외로 실패한다). */
private class FakeDetector(
    override val source: String,
    override val kind: TriggerKind = TriggerKind.WEATHER,
    @Volatile var live: Boolean = true,
    private val wanted: (SweepPhase, Int) -> Boolean = { _, _ -> true },
    @Volatile var answer: (SweepTarget) -> Detection = { CLEAR },
) : SituationDetector {
    val calls: MutableList<SweepTarget> = Collections.synchronizedList(mutableListOf())
    override fun wants(phase: SweepPhase, dayOffset: Int) = wanted(phase, dayOffset)
    override fun isLive() = live
    override fun detect(target: SweepTarget): Detection {
        calls += target
        return answer(target)
    }
}

/** 해소 확인(날짜 전체). */
private val CLEAR = Detection.Checked(setOf(null), emptyList())

/** 그 날짜 전체의 비 신호 — 문구는 가드를 통과하는 꼴(상대 날짜어 없음). */
private fun rain(target: SweepTarget) = Detection.Checked(
    emptySet(),
    listOf(
        DetectionSignal(
            kind = TriggerKind.WEATHER, affectedDate = target.date, slotKey = null, payload = emptyMap(),
            reason = if (target.date == DAY) "오후에 비 소식이 있어요." else "8월 12일(수) 오전에 비 소식이 있어요.",
            scope = TriggerScope.FULL_DAY, variant = TriggerVariant.RAIN, dataSource = DataSource.KMA_VILAGE,
        ),
    ),
)

/** 저장소 대역을 여러 스레드에서 써도 되게 감싼다(실 저장소는 트랜잭션이 막는다 — 여기선 구조만 지킨다). */
private class LockedTriggers(val inner: PlanBTriggerRepository, private val failSaves: Int = 0) : PlanBTriggerRepository {
    private var failed = 0
    val stored: List<PlanBTrigger> get() = synchronized(this) { (inner as InMemoryTriggers).stored.toList() }

    @Synchronized
    override fun save(trigger: PlanBTrigger): PlanBTrigger {
        // 실 저장소가 같은 대상의 동시 INSERT 를 부분 유니크로 거절하는 모양 그대로 실패한다.
        if (failed < failSaves) {
            failed++
            throw DataIntegrityViolationException("ux_plan_b_trigger_active")
        }
        return inner.save(trigger)
    }

    @Synchronized override fun findById(triggerId: UUID) = inner.findById(triggerId)
    @Synchronized override fun findActiveByTrip(tripId: UUID) = inner.findActiveByTrip(tripId)
    @Synchronized override fun findByTripOn(tripId: UUID, dates: Collection<LocalDate>) = inner.findByTripOn(tripId, dates)
    @Synchronized override fun countPushedOn(tripId: UUID, date: LocalDate) = inner.countPushedOn(tripId, date)
}

private class LockedWatches : PlanBWatchRepository {
    private val stored = ConcurrentHashMap<Pair<UUID, String>, PlanBWatch>()
    val all: Collection<PlanBWatch> get() = stored.values
    override fun upsert(watch: PlanBWatch) {
        stored[watch.tripId to watch.source] = watch
    }
    override fun findByTrip(tripId: UUID) = stored.values.filter { it.tripId == tripId }
}

private class LockedEvents : DomainEventPublisher {
    val published: MutableList<DomainEvent> = Collections.synchronizedList(mutableListOf())
    override fun publish(event: DomainEvent) {
        published += event
    }
}

private fun providerOf(detectors: List<SituationDetector>): ObjectProvider<SituationDetector> =
    object : ObjectProvider<SituationDetector> {
        override fun getObject(): SituationDetector = detectors.single()
        override fun getIfAvailable(): SituationDetector? = detectors.singleOrNull()
        override fun stream(): Stream<SituationDetector> = detectors.stream()
        override fun orderedStream(): Stream<SituationDetector> = detectors.stream()
    }

/** 한 테스트의 세계 — 여행·일정·슬롯과 실 판정(`TriggerService`)을 인메모리 저장소로 묶는다. */
private class World(failSaves: Int = 0) {
    val acc: UUID = UUID.randomUUID()
    val watched = InMemoryWatchedTrips()
    private val refs = ConcurrentHashMap<UUID, ItineraryRef>()
    private val owners = ConcurrentHashMap<UUID, UUID>()
    private val slotsOf = ConcurrentHashMap<UUID, List<PlannedSlotView>>()
    val broken: MutableSet<UUID> = ConcurrentHashMap.newKeySet()
    val triggers = LockedTriggers(InMemoryTriggers(), failSaves)
    val watches = LockedWatches()
    val events = LockedEvents()

    fun slot(date: LocalDate, start: String, end: String) = UUID.randomUUID().let { poi ->
        PlannedSlotView(
            slotKey = "$date#$poi", date = date, poiId = poi, orderIndex = 0,
            startAt = LocalTime.parse(start), endAt = LocalTime.parse(end),
            isFixed = false, endsNextDay = false, hasViolation = false, nameKo = "성산일출봉", category = "자연",
        )
    }

    /** 여행 하나 — [status] null 이면 일정이 없다. 슬롯은 (날짜, "HH:mm-HH:mm"). */
    fun trip(
        start: LocalDate = DAY.minusDays(1), end: LocalDate = DAY.plusDays(1),
        status: String? = "CONFIRMED", account: UUID = acc,
        slots: List<Pair<LocalDate, String>> = listOf(DAY to "18:00-19:00"),
    ): UUID {
        val tripId = UUID.randomUUID()
        watched.trips += WatchedTrip(tripId, account, start, end)
        owners[tripId] = account
        val views = slots.map { (d, span) -> slot(d, span.substringBefore('-'), span.substringAfter('-')) }
        slotsOf[tripId] = views
        if (status != null) {
            refs[tripId] = ItineraryRef(UUID.randomUUID(), status, "COMPLETE", views.map { it.date }.distinct(), views.map { it.slotKey })
        }
        return tripId
    }

    /** 이 여행에 스윕 출처가 띄운 트리거를 심는다. */
    fun plant(tripId: UUID, date: LocalDate, detector: String = SweepSource.KMA_FORECAST): PlanBTrigger = triggers.save(
        PlanBTrigger.active(
            tripId, refs[tripId]?.itineraryId ?: UUID.randomUUID(), TriggerKind.WEATHER, date, null,
            mapOf(PlanBTrigger.PAYLOAD_DETECTOR to detector), TriggerScope.PARTIAL_SLOTS, "오후에 비 소식이 있어요.", at("07:15"),
        ),
    )

    fun rows(tripId: UUID) = triggers.stored.filter { it.tripId == tripId }

    private val itineraries = object : ItineraryFacade {
        override fun findCurrent(accountId: UUID, tripId: UUID): ItineraryRef? {
            if (tripId in broken) throw IllegalStateException("일정 조회 실패(대역)")
            return refs[tripId]?.takeIf { owners[tripId] == accountId }
        }
    }

    private val plans = object : ItineraryPlanFacade {
        override fun findPlanSlots(accountId: UUID, tripId: UUID) = slotsOf[tripId].orEmpty()
        override fun findPlannedPlaces(accountId: UUID, tripId: UUID) = error("스윕은 쓰지 않습니다.")
    }

    /** reconcile 은 여행 조회를 쓰지 않는다 — 부르면 실패한다. */
    private val noTrips = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) = error("reconcile 은 여행을 다시 묻지 않습니다.")
        override fun findGenerationContext(accountId: UUID, tripId: UUID) = error("쓰지 않습니다.")
    }

    fun sweep(props: SituationSweepProperties, detectors: List<SituationDetector>, clock: Clock): SituationSweep {
        val service = TriggerService(
            noTrips, itineraries, triggers, InMemorySuppressions(), FixedSensitivity(Sensitivity.NORMAL), events, clock,
            watches, watchingProvider(),
        )
        return SituationSweep(props, watched, itineraries, plans, service, triggers, watches, providerOf(detectors), clock)
    }
}

private fun props(
    mode: SweepMode = SweepMode.ON,
    horizon: SweepHorizon = SweepHorizon.TODAY,
    accountIds: Set<UUID> = emptySet(),
    sources: List<String> = listOf(SweepSource.KMA_FORECAST, SweepSource.KMA_WARNING, SweepSource.AIRKOREA, SweepSource.PLACE),
    observeOnly: Set<String> = setOf(SweepSource.KMA_WARNING, SweepSource.AIRKOREA),
    parallelism: Int = 1,
    budget: Duration = Duration.ofMinutes(20),
) = SituationSweepProperties(mode, horizon, accountIds, sources, observeOnly, parallelism, budget)

/**
 * 상황 감시 스윕(설계서 §4.1 규칙 1~5 · BR-SA-01~04 · INV-SA-3·5 · T-D1-U 스윕 항목).
 *
 * 판정(만료·해제·결정표·사건)은 A1 의 실 `TriggerService.reconcile` 이 인메모리 저장소 위에서 한다 — 여기서는 **스윕이
 * 무엇을 언제 부르고 무엇을 넘기고 무엇을 쓰지 않는가**를 본다. 병렬도 1 은 순서를 결정론으로 만들려는 것이다.
 */
class SituationSweepTest : StringSpec({

    "모드 off — 대상 조회도 감지도 하지 않고 바로 돌아온다" {
        val world = World()
        world.trip()
        val forecast = FakeDetector(SweepSource.KMA_FORECAST)

        val summary = world.sweep(props(mode = SweepMode.OFF), listOf(forecast), StepClock(at("12:15"))).sweep(at("12:15"))

        summary.phase shouldBe null
        world.watched.queries.shouldBeEmpty()
        forecast.calls.shouldBeEmpty()
    }

    "dry-run — 감지기는 부르고 요약에 남기지만 쓰기는 0이다(트리거·사건·만료·감시 상태 없음)" {
        val world = World()
        val tripId = world.trip()
        val stale = world.plant(tripId, DAY.minusDays(1)) // reconcile 이 돌면 지난 날이라 만료될 행
        val forecast = FakeDetector(SweepSource.KMA_FORECAST, answer = ::rain)

        val summary = world.sweep(props(mode = SweepMode.DRY_RUN), listOf(forecast), StepClock(at("12:15"))).sweep(at("12:15"))

        forecast.calls.size shouldBe 1
        summary.trips shouldBe 1
        summary.mode shouldBe SweepMode.DRY_RUN
        world.rows(tripId) shouldBe listOf(stale)
        world.events.published.shouldBeEmpty()
        world.watches.all.shouldBeEmpty()
    }

    "on — 감지 결과를 판정으로 쓰고(사건 1건) 부른 출처의 감시 상태를 남긴다" {
        val world = World()
        val tripId = world.trip()
        val forecast = FakeDetector(SweepSource.KMA_FORECAST, answer = ::rain)

        val summary = world.sweep(props(), listOf(forecast), StepClock(at("12:15"))).sweep(at("12:15"))

        val active = world.rows(tripId).single()
        active.state shouldBe TriggerState.ACTIVE
        active.detector shouldBe SweepSource.KMA_FORECAST
        active.scope shouldBe TriggerScope.PARTIAL_SLOTS // 오늘은 PARTIAL_SLOTS 로 교정된다(CD7)
        world.events.published.size shouldBe 1
        world.watches.all.single() shouldBe PlanBWatch(tripId, SweepSource.KMA_FORECAST, WatchStatus.CHECKED, at("12:15"))
        summary.trips shouldBe 1
        summary.announced shouldBe 1
        summary.pushed shouldBe 1
    }

    "감지기가 받는 대상 — 그 날 끝나지 않은 슬롯만, 이 출처가 그 날 띄운 트리거만, 회차 단계·시각" {
        val world = World()
        val tripId = world.trip(slots = listOf(DAY to "10:00-11:00", DAY to "18:00-19:00"))
        val mine = world.plant(tripId, DAY)
        world.plant(tripId, DAY.plusDays(1)) // 다른 날
        val forecast = FakeDetector(SweepSource.KMA_FORECAST)

        world.sweep(props(), listOf(forecast), StepClock(at("12:15"))).sweep(at("12:15"))

        val target = forecast.calls.single()
        target.tripId shouldBe tripId
        target.accountId shouldBe world.acc
        target.date shouldBe DAY
        target.phase shouldBe SweepPhase.DAYTIME
        target.now shouldBe at("12:15")
        target.slots.map { it.startAt } shouldBe listOf(LocalTime.of(18, 0)) // 10~11시는 끝났다
        target.active shouldBe listOf(mine)
    }

    "관찰 전용 출처는 요약·표본 줄에만 — 그 출처의 신호는 쓰지 않고 감시 상태도 남기지 않는다(BR-SA-04)" {
        val world = World()
        val tripId = world.trip()
        val forecast = FakeDetector(SweepSource.KMA_FORECAST)
        val warning = FakeDetector(SweepSource.KMA_WARNING, answer = ::rain)

        val summary = world.sweep(props(), listOf(forecast, warning), StepClock(at("12:15"))).sweep(at("12:15"))

        warning.calls.size shouldBe 1 // 부르기는 한다 — 키 등록·실응답을 재는 것이 관찰의 목적이다
        world.rows(tripId).shouldBeEmpty()
        world.events.published.shouldBeEmpty()
        world.watches.all.map { it.source } shouldBe listOf(SweepSource.KMA_FORECAST)
        summary.live shouldBe listOf(SweepSource.KMA_FORECAST)
        summary.observe shouldBe listOf(SweepSource.KMA_WARNING)
    }

    "isLive=false 이거나 출처 목록 밖인 감지기는 한 번도 부르지 않는다 — off 로 센다" {
        val world = World()
        world.trip()
        val forecast = FakeDetector(SweepSource.KMA_FORECAST, live = false)
        val place = FakeDetector(SweepSource.PLACE, kind = TriggerKind.CLOSURE)
        val sources = listOf(SweepSource.KMA_FORECAST, SweepSource.KMA_WARNING, SweepSource.AIRKOREA)

        val summary = world.sweep(props(sources = sources), listOf(forecast, place), StepClock(at("12:15"))).sweep(at("12:15"))

        forecast.calls.shouldBeEmpty()
        place.calls.shouldBeEmpty()
        world.watches.all.shouldBeEmpty()
        summary.live.shouldBeEmpty()
        summary.off shouldBe listOf(SweepSource.AIRKOREA, SweepSource.KMA_FORECAST, SweepSource.KMA_WARNING, SweepSource.PLACE)
    }

    "회로 차단 — 같은 출처가 연속 3번 던지면 남은 여행은 그 출처를 부르지 않고 모름으로 둔다, 다른 출처는 그대로 돈다" {
        val world = World()
        val tripIds = List(5) { world.trip() }
        val forecast = FakeDetector(SweepSource.KMA_FORECAST, answer = { throw IllegalStateException("기상청 5xx(대역)") })
        val place = FakeDetector(SweepSource.PLACE, kind = TriggerKind.CLOSURE)

        val summary = world.sweep(props(), listOf(forecast, place), StepClock(at("12:15"))).sweep(at("12:15"))

        forecast.calls.size shouldBe 3
        place.calls.size shouldBe 5
        summary.unknown shouldBe mapOf(SweepSource.KMA_FORECAST to 5)
        summary.trips shouldBe 5
        summary.failed shouldBe 0 // 감지기 실패는 그 출처의 모름이지 여행 실패가 아니다
        // 모름도 관측이다 — 감시 상태가 '확인 불가'로 바로 내려간다(거짓 정상 금지).
        tripIds.forEach { id ->
            world.watches.findByTrip(id).associate { it.source to it.status } shouldBe
                mapOf(SweepSource.KMA_FORECAST to WatchStatus.UNKNOWN, SweepSource.PLACE to WatchStatus.CHECKED)
        }
    }

    "성공이 끼면 연속이 끊긴다 — 실패·실패·성공·실패·실패는 회로를 열지 않는다" {
        val world = World()
        repeat(5) { world.trip() }
        var n = 0
        val forecast = FakeDetector(SweepSource.KMA_FORECAST, answer = { if (++n == 3) CLEAR else throw IllegalStateException("시한 초과(대역)") })

        val summary = world.sweep(props(), listOf(forecast), StepClock(at("12:15"))).sweep(at("12:15"))

        forecast.calls.size shouldBe 5
        summary.unknown shouldBe mapOf(SweepSource.KMA_FORECAST to 4)
    }

    "예산을 다 쓰면 여행 사이에서 멈추고 못 본 여행 수를 요약에 남긴다" {
        val world = World()
        repeat(4) { world.trip() }
        val clock = StepClock(at("12:15"))
        val forecast = FakeDetector(SweepSource.KMA_FORECAST, answer = { clock.advance(Duration.ofMinutes(6)); CLEAR })

        val summary = world.sweep(props(budget = Duration.ofMinutes(10)), listOf(forecast), clock).sweep(at("12:15"))

        forecast.calls.size shouldBe 2 // 0분·6분에 시작한 여행만 — 12분째는 예산(10분) 밖
        summary.trips shouldBe 2
        summary.skipped shouldBe 2
    }

    "종료 신호를 받으면 여행 사이에서 멈추고 정상으로 돌아온다 — 락을 쥔 채 죽지 않는다" {
        val world = World()
        repeat(3) { world.trip() }
        lateinit var sweep: SituationSweep
        val forecast = FakeDetector(SweepSource.KMA_FORECAST, answer = { sweep.stop(); CLEAR })
        sweep = world.sweep(props(), listOf(forecast), StepClock(at("12:15")))

        val summary = sweep.sweep(at("12:15"))

        forecast.calls.size shouldBe 1
        summary.trips shouldBe 1 // 하던 여행은 마친다
        summary.skipped shouldBe 2
    }

    "20:58 이후에는 쓰지 않는다 — 회차가 흐르다 컷을 넘기면 감지한 여행도 쓰지 않고 그 뒤는 보지 않는다(INV-SA-5)" {
        val world = World()
        val tripIds = List(3) { world.trip(slots = listOf(DAY to "21:00-22:00")) }
        val clock = StepClock(at("20:55"))
        val forecast = FakeDetector(SweepSource.KMA_FORECAST, answer = { clock.advance(Duration.ofMinutes(2)); rain(it) })

        val summary = world.sweep(props(), listOf(forecast), clock).sweep(at("20:55"))

        forecast.calls.size shouldBe 2 // 20:55·20:57 에 시작 — 20:59 에 시작할 여행은 보지도 않는다
        tripIds.count { world.rows(it).isNotEmpty() } shouldBe 1 // 20:57 감지분은 20:59 라 쓰지 않았다
        world.events.published.size shouldBe 1
        summary.trips shouldBe 1
        summary.skipped shouldBe 2
    }

    "밤(21:00~06:59)에는 아무것도 하지 않는다 — 대상 조회·감지 0" {
        listOf("21:00", "06:59", "23:30").forEach { time ->
            val world = World()
            world.trip()
            val forecast = FakeDetector(SweepSource.KMA_FORECAST)
            val summary = world.sweep(props(horizon = SweepHorizon.PRE_TRIP), listOf(forecast), StepClock(at(time))).sweep(at(time))
            summary.phase shouldBe null
            world.watched.queries.shouldBeEmpty()
            forecast.calls.shouldBeEmpty()
        }
    }

    "07:00 아침 회차는 오늘만 본다 — 지평이 pre-trip 이어도 내일·내일 시작 여행은 보지 않는다" {
        val world = World()
        val inProgress = world.trip(slots = listOf(DAY to "18:00-19:00", DAY.plusDays(1) to "10:00-11:00"))
        world.trip(start = DAY.plusDays(1), end = DAY.plusDays(2), slots = listOf(DAY.plusDays(1) to "10:00-11:00"))
        val forecast = FakeDetector(SweepSource.KMA_FORECAST)

        val summary = world.sweep(props(horizon = SweepHorizon.PRE_TRIP), listOf(forecast), StepClock(at("07:00"))).sweep(at("07:00"))

        summary.phase shouldBe SweepPhase.MORNING
        forecast.calls.map { it.tripId to it.date } shouldBe listOf(inProgress to DAY)
        world.watched.queries.map { it.second }.toSet() shouldBe setOf(DAY) // 조회 구간도 오늘까지
    }

    "20시대 회차는 지평만큼 내일을 본다 — today 오늘만 · tomorrow 진행 중 여행의 내일 · pre-trip 내일 시작 여행의 첫날까지" {
        fun calls(horizon: SweepHorizon): Pair<Set<Pair<String, LocalDate>>, Set<LocalDate>> {
            val world = World()
            world.trip(slots = listOf(DAY to "21:00-22:00", DAY.plusDays(1) to "10:00-11:00"))
            world.trip(start = DAY.plusDays(1), end = DAY.plusDays(2), slots = listOf(DAY.plusDays(1) to "10:00-11:00"))
            val names = world.watched.trips.associate { it.tripId to if (it.startDate == DAY.plusDays(1)) "D-1" else "진행 중" }
            val forecast = FakeDetector(SweepSource.KMA_FORECAST)
            world.sweep(props(mode = SweepMode.DRY_RUN, horizon = horizon), listOf(forecast), StepClock(at("20:15"))).sweep(at("20:15"))
            return forecast.calls.map { names.getValue(it.tripId) to it.date }.toSet() to world.watched.queries.map { it.second }.toSet()
        }

        calls(SweepHorizon.TODAY) shouldBe (setOf("진행 중" to DAY) to setOf(DAY))
        calls(SweepHorizon.TOMORROW) shouldBe (setOf("진행 중" to DAY, "진행 중" to DAY.plusDays(1)) to setOf(DAY))
        calls(SweepHorizon.PRE_TRIP) shouldBe
            (setOf("진행 중" to DAY, "진행 중" to DAY.plusDays(1), "D-1" to DAY.plusDays(1)) to setOf(DAY.plusDays(1)))
    }

    "감지기는 단계·날짜로 고른다 — 저녁의 내일만 원하는 감지기는 오늘을 부르지 않는다(CD2)" {
        val world = World()
        world.trip(slots = listOf(DAY to "21:00-22:00", DAY.plusDays(1) to "10:00-11:00"))
        val place = FakeDetector(
            SweepSource.PLACE, kind = TriggerKind.CLOSURE,
            wanted = { phase, offset -> (phase == SweepPhase.MORNING && offset == 0) || (phase == SweepPhase.EVENING && offset == 1) },
        )

        world.sweep(props(horizon = SweepHorizon.TOMORROW), listOf(place), StepClock(at("20:15"))).sweep(at("20:15"))

        place.calls.map { it.date to it.phase } shouldBe listOf(DAY.plusDays(1) to SweepPhase.EVENING)
    }

    "확정(CONFIRMED) 일정만 본다 — 계획 중·일정 없음은 감지도 판정도 하지 않는다" {
        val world = World()
        val planned = world.trip(status = "PLANNED")
        val stale = world.plant(planned, DAY.minusDays(1)) // 판정이 돌면 지난 날이라 닫힐 행
        world.trip(status = null)
        val confirmed = world.trip()
        val forecast = FakeDetector(SweepSource.KMA_FORECAST)

        val summary = world.sweep(props(), listOf(forecast), StepClock(at("12:15"))).sweep(at("12:15"))

        forecast.calls.map { it.tripId } shouldBe listOf(confirmed)
        world.rows(planned) shouldBe listOf(stale)
        summary.trips shouldBe 1
    }

    "계정 허용목록 — 비어 있으면 전원, 있으면 그 계정의 여행만 본다(운영 카나리)" {
        val world = World()
        val mine = world.trip()
        world.trip(account = UUID.randomUUID())
        val forecast = FakeDetector(SweepSource.KMA_FORECAST)

        val summary = world.sweep(props(accountIds = setOf(world.acc)), listOf(forecast), StepClock(at("12:15"))).sweep(at("12:15"))

        forecast.calls.map { it.tripId } shouldBe listOf(mine)
        summary.trips shouldBe 1

        val everyone = FakeDetector(SweepSource.KMA_FORECAST)
        world.sweep(props(), listOf(everyone), StepClock(at("12:15"))).sweep(at("12:15"))
        everyone.calls.size shouldBe 2
    }

    "남은 슬롯이 없는 날은 감지기를 부르지 않는다 — 그래도 판정은 불러 만료는 돈다" {
        val world = World()
        val tripId = world.trip(slots = listOf(DAY to "10:00-11:00"))
        val planted = world.plant(tripId, DAY)
        val forecast = FakeDetector(SweepSource.KMA_FORECAST)

        val summary = world.sweep(props(), listOf(forecast), StepClock(at("20:15"))).sweep(at("20:15"))

        forecast.calls.shouldBeEmpty()
        world.triggers.findById(planted.triggerId)!!.state shouldBe TriggerState.EXPIRED // 그 날 남은 슬롯이 없다
        summary.expired shouldBe 1
        world.watches.all.shouldBeEmpty() // 부르지 않은 출처는 감시 상태를 쓰지 않는다
    }

    "대상 유일 키 위반은 그 여행을 새 트랜잭션으로 한 번 다시 판정한다" {
        val world = World(failSaves = 1)
        val tripId = world.trip()
        val forecast = FakeDetector(SweepSource.KMA_FORECAST, answer = ::rain)

        val summary = world.sweep(props(), listOf(forecast), StepClock(at("12:15"))).sweep(at("12:15"))

        world.rows(tripId).single().state shouldBe TriggerState.ACTIVE
        summary.failed shouldBe 0
        summary.trips shouldBe 1
        forecast.calls.size shouldBe 1 // 감지는 다시 하지 않는다 — 판정만 다시
    }

    "다시 해도 위반이면 그 여행만 실패로 세고 다음 여행은 계속한다" {
        val world = World(failSaves = 2)
        val tripIds = List(2) { world.trip() }
        val forecast = FakeDetector(SweepSource.KMA_FORECAST, answer = ::rain)

        val summary = world.sweep(props(), listOf(forecast), StepClock(at("12:15"))).sweep(at("12:15"))

        summary.failed shouldBe 1
        summary.trips shouldBe 1
        tripIds.count { world.rows(it).isNotEmpty() } shouldBe 1
    }

    "일정 조회가 실패한 여행은 그 여행만 실패로 남기고 다음 여행은 계속한다" {
        val world = World()
        val broken = world.trip()
        world.broken += broken
        val fine = world.trip()
        val forecast = FakeDetector(SweepSource.KMA_FORECAST)

        val summary = world.sweep(props(), listOf(forecast), StepClock(at("12:15"))).sweep(at("12:15"))

        forecast.calls.map { it.tripId } shouldBe listOf(fine)
        summary.failed shouldBe 1
        summary.trips shouldBe 1
    }

    "감시 상태 — 쓰는 출처마다 확인·모름을 남기고 관찰 전용·안 부른 출처는 남기지 않는다, 날짜 하나라도 모르면 확인 불가" {
        val world = World()
        val tripId = world.trip(slots = listOf(DAY to "21:00-22:00", DAY.plusDays(1) to "10:00-11:00"))
        val forecast = FakeDetector(SweepSource.KMA_FORECAST, answer = { if (it.date == DAY) CLEAR else Detection.Unknown("NO_DATA") })
        val place = FakeDetector(SweepSource.PLACE, kind = TriggerKind.CLOSURE)
        val air = FakeDetector(SweepSource.AIRKOREA)
        val warning = FakeDetector(SweepSource.KMA_WARNING, live = false)

        world.sweep(props(horizon = SweepHorizon.TOMORROW), listOf(forecast, place, air, warning), StepClock(at("20:15")))
            .sweep(at("20:15"))

        world.watches.findByTrip(tripId).associate { it.source to it.status } shouldBe
            mapOf(SweepSource.KMA_FORECAST to WatchStatus.UNKNOWN, SweepSource.PLACE to WatchStatus.CHECKED)
        world.watches.findByTrip(tripId).map { it.checkedAt }.toSet() shouldBe setOf(at("20:15"))
    }

    "여행 단위 병렬 — 병렬 2 에서도 모든 여행을 정확히 한 번 보고 센 값이 맞다" {
        val world = World()
        val tripIds = List(20) { world.trip() }
        val forecast = FakeDetector(SweepSource.KMA_FORECAST, answer = { Thread.sleep(5); CLEAR })

        val summary = world.sweep(props(parallelism = 2), listOf(forecast), StepClock(at("12:15"))).sweep(at("12:15"))

        forecast.calls.map { it.tripId } shouldContainExactlyInAnyOrder tripIds
        summary.trips shouldBe 20
        world.watches.all.size shouldBe 20
    }

    "회차마다 시작 위치를 회전한다 — 시작은 회차 시각의 피벗 다음 여행이고, 한 바퀴에 모두 한 번씩 본다" {
        val world = World()
        val tripIds = List(8) { world.trip() }
        listOf("12:15", "13:15", "14:15").forEach { time ->
            val forecast = FakeDetector(SweepSource.KMA_FORECAST)
            world.sweep(props(mode = SweepMode.DRY_RUN), listOf(forecast), StepClock(at(time))).sweep(at(time))
            val expected = roundOrder(InMemoryWatchedTrips(world.watched.trips), DAY, DAY, pivotFor(at(time)), 500).map { it.tripId }
            forecast.calls.map { it.tripId } shouldBe expected
            expected.toSet() shouldBe tripIds.toSet()
        }
    }

    "요약 줄은 형식이 고정이다 — 출처 목록·모름 수·감지 지연 p50/p95 까지" {
        val world = World()
        repeat(3) { world.trip() }
        val clock = StepClock(at("12:15"))
        var step = 0L
        val forecast = FakeDetector(SweepSource.KMA_FORECAST, answer = { clock.advance(Duration.ofMillis(100 * ++step)); rain(it) })
        val warning = FakeDetector(SweepSource.KMA_WARNING, answer = { Detection.Unknown("SERVICE_KEY_IS_NOT_REGISTERED") })

        val summary = world.sweep(props(), listOf(forecast, warning), clock).sweep(at("12:15"))

        summary.line() shouldBe "planb.situation_sweep mode=on phase=DAYTIME trips=3 skipped=0 failed=0 " +
            "live=[kma-forecast] off=[airkorea,place] observe=[kma-warning] unknown={kma-warning:3} " +
            "announced=3 pushed=3 quiet=0 expired=0 elapsedMs=600 detectorMs={kma-forecast:200/300,kma-warning:0/0}"
    }

    "감시 중인 출처(WatchingSources) — on ∧ 출처 목록 안 ∧ 관찰 전용 아님 ∧ 감지기가 살아 있을 때만" {
        val world = World()
        val detectors = listOf(
            FakeDetector(SweepSource.KMA_FORECAST),
            FakeDetector(SweepSource.PLACE, kind = TriggerKind.CLOSURE, live = false),
            FakeDetector(SweepSource.AIRKOREA),
        )
        val clock = StepClock(at("12:15"))
        val on = world.sweep(props(), detectors, clock)
        on.isWatching(SweepSource.KMA_FORECAST) shouldBe true
        on.isWatching(SweepSource.PLACE) shouldBe false // live 아님
        on.isWatching(SweepSource.AIRKOREA) shouldBe false // 관찰 전용
        on.isWatching(SweepSource.KMA_WARNING) shouldBe false // 감지기 없음
        world.sweep(props(sources = listOf(SweepSource.PLACE)), detectors, clock).isWatching(SweepSource.KMA_FORECAST) shouldBe false
        world.sweep(props(mode = SweepMode.DRY_RUN), detectors, clock).isWatching(SweepSource.KMA_FORECAST) shouldBe false
        world.sweep(props(mode = SweepMode.OFF), detectors, clock).isWatching(SweepSource.KMA_FORECAST) shouldBe false
    }

    "기동 안내 줄 — 모드·지평·살아 있는 감지기·관찰 전용(쓰기 없음)" {
        val world = World()
        val detectors = listOf(FakeDetector(SweepSource.KMA_FORECAST), FakeDetector(SweepSource.PLACE, live = false))
        val clock = StepClock(at("12:15"))

        world.sweep(props(horizon = SweepHorizon.TOMORROW), detectors, clock).announcement() shouldBe
            "상황 감시 = 켜짐 · 지평=tomorrow · 감지기 live=[kma-forecast] · 관찰 전용=[airkorea,kma-warning]"
        world.sweep(props(mode = SweepMode.DRY_RUN), detectors, clock).announcement() shouldBe
            "상황 감시 = 관찰 · 지평=today · 감지기 live=[kma-forecast] · 관찰 전용=[airkorea,kma-warning]"
        world.sweep(props(mode = SweepMode.OFF, horizon = SweepHorizon.PRE_TRIP), emptyList(), clock).announcement() shouldBe
            "상황 감시 = 꺼짐 · 지평=pre-trip · 감지기 live=[] · 관찰 전용=[airkorea,kma-warning]"
    }

    "스케줄 진입점(매시·20:40 보충)은 시계의 지금으로 회차를 돈다" {
        val world = World()
        world.trip(slots = listOf(DAY to "21:00-22:00"))
        val forecast = FakeDetector(SweepSource.KMA_FORECAST)
        val sweep = world.sweep(props(mode = SweepMode.DRY_RUN), listOf(forecast), StepClock(at("20:15")))

        sweep.hourly()
        sweep.eveningCatchUp()

        forecast.calls.map { it.now to it.phase } shouldBe listOf(at("20:15") to SweepPhase.EVENING, at("20:15") to SweepPhase.EVENING)
    }

    "같은 출처의 감지기가 둘이면 기동하지 않는다 — 어느 쪽이 해제 자격인지 갈린다" {
        shouldThrow<IllegalArgumentException> {
            World().sweep(props(), listOf(FakeDetector(SweepSource.PLACE), FakeDetector(SweepSource.PLACE)), StepClock(at("12:15")))
        }
    }
})
