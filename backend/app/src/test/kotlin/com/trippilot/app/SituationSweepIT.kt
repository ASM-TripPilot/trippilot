package com.trippilot.app

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.VisitSlot
import com.trippilot.planbdetection.application.Detection
import com.trippilot.planbdetection.application.DetectionSignal
import com.trippilot.planbdetection.application.SituationDetector
import com.trippilot.planbdetection.application.SituationSweep
import com.trippilot.planbdetection.application.SituationSweepProperties
import com.trippilot.planbdetection.application.SweepHorizon
import com.trippilot.planbdetection.application.SweepMode
import com.trippilot.planbdetection.application.SweepTarget
import com.trippilot.planbdetection.application.TriggerService
import com.trippilot.planbdetection.application.WatchingSources
import com.trippilot.planbdetection.domain.DataSource
import com.trippilot.planbdetection.domain.PlanBTriggerRepository
import com.trippilot.planbdetection.domain.PlanBWatchRepository
import com.trippilot.planbdetection.domain.SweepSource
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerScope
import com.trippilot.planbdetection.domain.TriggerState
import com.trippilot.planbdetection.domain.TriggerVariant
import com.trippilot.planbdetection.domain.WatchStatus
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.api.TripWatchFacade
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.springframework.aop.framework.Advised
import org.springframework.aop.support.AopUtils
import org.springframework.beans.factory.ObjectProvider
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * 상황 감시 스윕 실 DB 관통(설계서 T-IT-1) — 감지기만 대역이고 나머지(대상 조회·일정·판정·아웃박스·감시 상태)는 실물이다.
 *
 * 여기서만 보이는 것: 스윕 빈이 감지기 빈을 주워 오는가, reconcile 이 **프록시를 거쳐** 여행 하나 = 트랜잭션 하나로 돌고
 * 사건이 같은 트랜잭션의 아웃박스에 남는가, 다시 돌려도 부분 유니크·결정표가 행을 늘리지 않는가, 모름·해소가 실 행에
 * 어떻게 닿는가. 회차 시각은 다른 IT 가 쓰지 않는 먼 날(2031-05-13 화)이다 — 스윕은 실 시계가 아니라 넘긴 시각으로 판정한다.
 * 배경 스케줄은 테스트 설정이 끈다(cron "-") — 이 컨텍스트는 mode=on 이라 켜져 있으면 남의 여행을 판정한다.
 */
@SpringBootTest(
    properties = [
        "trippilot.planb.situation-sweep.mode=on",
        "trippilot.planb.situation-sweep.horizon=tomorrow",
    ],
)
class SituationSweepIT : AbstractPostgresIntegrationTest() {

    /** 여행마다 답을 정해 두는 단기예보 감지기 — 정하지 않은 여행(같은 컨테이너의 다른 IT 여행)은 모름이라 아무것도 바꾸지 않는다. */
    class StubForecast : SituationDetector {
        override val source: String = SweepSource.KMA_FORECAST
        override val kind: TriggerKind = TriggerKind.WEATHER
        val answers = ConcurrentHashMap<UUID, (SweepTarget) -> Detection>()
        val seen: MutableList<Pair<UUID, LocalDate>> = java.util.Collections.synchronizedList(mutableListOf())
        override fun isLive() = true
        override fun detect(target: SweepTarget): Detection {
            seen += target.tripId to target.date
            return answers[target.tripId]?.invoke(target) ?: Detection.Unknown("다른 테스트의 여행")
        }
    }

    @TestConfiguration
    class StubDetectors {
        @Bean
        fun stubForecast() = StubForecast()
    }

    @Autowired private lateinit var sweep: SituationSweep
    @Autowired private lateinit var stub: StubForecast
    @Autowired private lateinit var watching: WatchingSources
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var itineraries: ItineraryRepository
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var triggers: PlanBTriggerRepository
    @Autowired private lateinit var watches: PlanBWatchRepository
    @Autowired private lateinit var jdbc: JdbcTemplate
    @Autowired private lateinit var mapper: ObjectMapper
    @Autowired private lateinit var scheduler: ThreadPoolTaskScheduler

    // dry-run 인스턴스를 같은 실물로 조립하는 재료 — 설정만 바꾼 컨텍스트를 하나 더 띄우지 않는다(커넥션 풀이 컨텍스트마다 붙는다).
    @Autowired private lateinit var tripWatch: TripWatchFacade
    @Autowired private lateinit var itineraryFacade: ItineraryFacade
    @Autowired private lateinit var planFacade: ItineraryPlanFacade
    @Autowired private lateinit var triggerService: TriggerService
    @Autowired private lateinit var detectorBeans: ObjectProvider<SituationDetector>
    @Autowired private lateinit var clock: Clock

    private val kst = ZoneId.of("Asia/Seoul")
    private val day = LocalDate.parse("2031-05-13")
    private val tomorrow = day.plusDays(1)
    private val mine = mutableListOf<UUID>()

    private fun at(hhmm: String): Instant = day.atTime(LocalTime.parse(hhmm)).atZone(kst).toInstant()

    /** 끝난 뒤 내 여행을 지우고(다음 회차의 대상에서 빠진다) 내 사건을 비운다(같은 컨테이너의 릴레이 배치를 차지하지 않게). */
    @AfterEach
    fun cleanUp() {
        mine.forEach {
            jdbc.update("DELETE FROM outbox_event WHERE event_type = ? AND payload->>'tripId' = ?", TYPE, it.toString())
            jdbc.update("UPDATE trip SET deleted_at = now() WHERE trip_id = ?", it)
        }
    }

    /** 진행 중 여행(어제~내일) + 확정 일정 — 오늘 슬롯은 20:15 에 이미 끝났고 내일 슬롯이 남았다. */
    private fun confirmedTrip(): UUID {
        val created = Instant.parse("2026-10-19T00:00:00Z")
        val accountId = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, created)).id.value
        val tripId = trips.save(
            Trip.create(
                accountId = accountId, title = null, startDate = day.minusDays(1), endDate = tomorrow,
                party = 2, companionType = null, budgetTotal = null, preferenceSnapshot = emptyMap(),
                destinations = listOf(TripDestination(0, "제주", 2)), now = created,
            ),
        ).tripId
        itineraries.save(
            Itinerary.create(
                tripId, SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, isFallback = false,
                days = listOf(
                    ItineraryDay.of(day, 0, listOf(VisitSlot.of(UUID.randomUUID(), null, 0, LocalTime.of(10, 0), LocalTime.of(11, 0)))),
                    ItineraryDay.of(tomorrow, 1, listOf(VisitSlot.of(UUID.randomUUID(), null, 0, LocalTime.of(10, 0), LocalTime.of(11, 0)))),
                ),
                now = created,
            ).confirm(created),
        )
        return tripId.also { mine += it }
    }

    private fun rainTomorrow(target: SweepTarget): Detection = Detection.Checked(
        emptySet(),
        listOf(
            DetectionSignal(
                kind = TriggerKind.WEATHER, affectedDate = target.date, slotKey = null, payload = mapOf("pop" to 80),
                reason = "5월 14일(수) 오전에 비 소식이 있어요.", scope = TriggerScope.FULL_DAY,
                variant = TriggerVariant.RAIN, dataSource = DataSource.KMA_VILAGE,
            ),
        ),
    )

    private fun events(tripId: UUID): List<String> = jdbc.queryForList(
        "SELECT payload::text FROM outbox_event WHERE event_type = ? AND payload->>'tripId' = ?",
        String::class.java, TYPE, tripId.toString(),
    )

    private fun rowCount(tripId: UUID): Int =
        jdbc.queryForObject("SELECT count(*) FROM plan_b_trigger WHERE trip_id = ?", Int::class.java, tripId)!!

    @Test
    fun `20시 15분 회차가 내일 대상을 ACTIVE 로 만들고 사건 1건을 남긴다 — 다시 돌려도 행·사건이 늘지 않는다`() {
        val tripId = confirmedTrip()
        stub.answers[tripId] = ::rainTomorrow

        val first = sweep.sweep(at("20:15"))

        stub.seen.filter { it.first == tripId } shouldBe listOf(tripId to tomorrow) // 오늘은 남은 슬롯이 없어 부르지 않았다
        val active = triggers.findActiveByTrip(tripId).single()
        active.affectedDate shouldBe tomorrow
        active.scope shouldBe TriggerScope.FULL_DAY // 미래일은 FULL_DAY(CD7)
        active.detector shouldBe SweepSource.KMA_FORECAST
        val payload = mapper.readTree(events(tripId).single())
        payload["aggregateId"].asText() shouldBe active.triggerId.toString()
        payload["affectedDate"].asText() shouldBe tomorrow.toString()
        payload["variant"].asText() shouldBe "RAIN"
        payload["push"].asBoolean() shouldBe true
        watches.findByTrip(tripId).single().status shouldBe WatchStatus.CHECKED
        first.announced shouldBe 1

        val rows = rowCount(tripId)
        sweep.sweep(at("20:40")) // 보충 회차 — 같은 위험이 이어진다

        rowCount(tripId) shouldBe rows
        events(tripId).size shouldBe 1
    }

    @Test
    fun `모름은 그대로 두고, 그 출처가 해소를 확인하면 닫는다 — 감시 상태도 따라간다`() {
        val tripId = confirmedTrip()
        stub.answers[tripId] = ::rainTomorrow
        sweep.sweep(at("20:15"))
        val raised = triggers.findActiveByTrip(tripId).single()
        val checked = watches.findByTrip(tripId).single() // 판정 시각 = 회차 시각 + 흐른 시간(실 시계)

        stub.answers[tripId] = { Detection.Unknown("SERVICE_KEY_IS_NOT_REGISTERED") }
        sweep.sweep(at("20:40"))

        triggers.findById(raised.triggerId)!!.state shouldBe TriggerState.ACTIVE // 모름은 해제가 아니다(INV-SA-2)
        // 감시 상태도 건드리지 않는다 — 마지막 확인(20:15 회차)이 신선 창을 지나야 '확인 불가'가 된다(RES-SA-01).
        watches.findByTrip(tripId).single() shouldBe checked
        checked.status shouldBe WatchStatus.CHECKED

        stub.answers[tripId] = { Detection.Checked(setOf(null), emptyList()) }
        sweep.sweep(at("20:45"))

        triggers.findById(raised.triggerId)!!.state shouldBe TriggerState.EXPIRED
        watches.findByTrip(tripId).single().let {
            it.status shouldBe WatchStatus.CHECKED
            it.checkedAt.isBefore(at("20:45")) shouldBe false // 확인이 다시 오면 시각이 앞으로 간다
        }
        events(tripId).size shouldBe 1 // 해제는 알리지 않는다
    }

    @Test
    fun `22시에는 아무것도 하지 않는다 — 감지·행·사건 0`() {
        val tripId = confirmedTrip()
        stub.answers[tripId] = ::rainTomorrow

        val summary = sweep.sweep(at("22:00"))

        summary.phase shouldBe null
        stub.seen.filter { it.first == tripId }.shouldBeEmpty()
        rowCount(tripId) shouldBe 0
        events(tripId).shouldBeEmpty()
    }

    @Test
    fun `dry-run 은 감지·판정만 하고 쓰기가 0이다 — 트리거·사건·감시 상태 없음, 켰다면 냈을 사건은 센다`() {
        val tripId = confirmedTrip()
        stub.answers[tripId] = ::rainTomorrow
        val dryRun = SituationSweep(
            SituationSweepProperties(mode = SweepMode.DRY_RUN, horizon = SweepHorizon.TOMORROW),
            tripWatch, itineraryFacade, planFacade, triggerService, triggers, watches, detectorBeans, clock,
        )

        val summary = dryRun.sweep(at("20:15"))

        stub.seen.filter { it.first == tripId } shouldBe listOf(tripId to tomorrow)
        summary.mode shouldBe SweepMode.DRY_RUN
        summary.announced shouldBe 1 // 실 판정이 읽기 전용 트랜잭션에서 돈다 — 첫 켜기 몰림 규모
        rowCount(tripId) shouldBe 0
        events(tripId).shouldBeEmpty()
        watches.findByTrip(tripId).shouldBeEmpty()
    }

    @Test
    fun `스윕 빈이 감시 출처를 알리고, 스케줄러 풀은 4다 — 회차가 릴레이·폴러를 막지 않게`() {
        val anyone = UUID.randomUUID() // 허용목록이 비어 전원이 대상이다
        watching.isWatching(SweepSource.KMA_FORECAST, anyone) shouldBe true // on ∧ 목록 안 ∧ 관찰 전용 아님 ∧ 감지기 살아 있음
        watching.isWatching(SweepSource.PLACE, anyone) shouldBe false // 장소 감지기는 AI 스케줄 모드가 http 일 때만 산다(여기는 fake)
        watching.isWatching(SweepSource.KMA_WARNING, anyone) shouldBe false // 관찰 전용
        scheduler.scheduledThreadPoolExecutor.corePoolSize shouldBe 4
    }

    @Test
    fun `단일 실행 락이 실제로 가로챈다 — 애너테이션만 있고 가로채기가 없으면 두 파드가 같은 회차를 돈다`() {
        AopUtils.isAopProxy(sweep) shouldBe true
        (sweep as Advised).advisors.map { it.javaClass.simpleName } shouldContain "MethodProxyScheduledLockAdvisor"
    }

    private companion object {
        private const val TYPE = "planb.PlanBTriggered"
    }
}
