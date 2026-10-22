package com.trippilot.app

import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
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
import com.trippilot.planbdetection.application.AirQualityDetector
import com.trippilot.planbdetection.application.KmaWarningDetector
import com.trippilot.planbdetection.application.SituationDetector
import com.trippilot.planbdetection.application.SituationSweep
import com.trippilot.planbdetection.application.SituationSweepProperties
import com.trippilot.planbdetection.application.SweepHorizon
import com.trippilot.planbdetection.application.SweepMode
import com.trippilot.planbdetection.application.TriggerService
import com.trippilot.planbdetection.domain.DataSource
import com.trippilot.planbdetection.domain.PlanBTriggerRepository
import com.trippilot.planbdetection.domain.PlanBWatchRepository
import com.trippilot.planbdetection.domain.SweepSource
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerScope
import com.trippilot.planbdetection.domain.TriggerSeverity
import com.trippilot.planbdetection.domain.TriggerState
import com.trippilot.planbdetection.domain.TriggerVariant
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripWatchFacade
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import com.trippilot.weathercontext.api.ActiveWarning
import com.trippilot.weathercontext.api.AirGrade
import com.trippilot.weathercontext.api.AirRegion
import com.trippilot.weathercontext.api.AlertRead
import com.trippilot.weathercontext.api.WarningArea
import com.trippilot.weathercontext.api.WeatherAlertFacade
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.ObjectProvider
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID
import java.util.stream.Stream

/**
 * 특보·대기질 감지기 실 DB 관통(설계서 T-IT-1 류) — 원천(WeatherAlertFacade)만 대역이고 감지기·대상 조회·일정 표면·판정·아웃박스는 실물이다.
 *
 * 여기서만 보이는 것: 실 일정 표면(시드 POI 의 카테고리·이름)과 실 여행 목적지(행정구역 코드)로 감지기가 신호를 만들고, 그 신호가 판정의
 * 문구 가드·결정표를 지나 `detector`·`dataSource` 를 단 행이 되는가. 관찰 전용(출발 상태)이면 표본 줄만 남고 쓰기가 0인가.
 * 한 출처의 모름이 다른 출처의 발화를 막지 않는가(CD17).
 *
 * 스윕은 설정만 바꿔 실물로 조립한다(SituationSweepIT 의 dry-run 인스턴스와 같은 방식 — 컨텍스트를 더 띄우지 않는다). 감지기는 이 둘만
 * 넘긴다 — 단기예보·장소 감지기는 다른 IT 가 본다. 회차 날짜는 다른 IT 가 쓰지 않는 먼 날(2032-03-16 화)이다.
 */
@SpringBootTest
class WeatherAlertSweepIT : AbstractPostgresIntegrationTest() {

    /** 원천 대역 — 실물(WeatherAlertService)처럼 실패를 값(Unknown)으로 말한다. 날짜별 대기질, 지금의 특보. */
    class StubAlerts : WeatherAlertFacade {
        @Volatile var warnings: AlertRead<List<ActiveWarning>> = AlertRead.Ok(emptyList())
        val air = HashMap<LocalDate, AlertRead<Map<AirRegion, AirGrade>>>()
        override fun isLive() = true
        override fun warnings(at: Instant) = warnings
        override fun airGrades(date: LocalDate, at: Instant) = air[date] ?: AlertRead.Unknown("no-forecast")
    }

    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var itineraries: ItineraryRepository
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var triggers: PlanBTriggerRepository
    @Autowired private lateinit var watches: PlanBWatchRepository
    @Autowired private lateinit var jdbc: JdbcTemplate
    @Autowired private lateinit var mapper: ObjectMapper
    @Autowired private lateinit var tripFacade: TripFacade
    @Autowired private lateinit var tripWatch: TripWatchFacade
    @Autowired private lateinit var itineraryFacade: ItineraryFacade
    @Autowired private lateinit var planFacade: ItineraryPlanFacade
    @Autowired private lateinit var triggerService: TriggerService
    @Autowired private lateinit var clock: Clock

    private val kst = ZoneId.of("Asia/Seoul")
    private val day = LocalDate.parse("2032-03-16")
    private val tomorrow = day.plusDays(1)
    private val mine = mutableListOf<UUID>()
    private val alerts = StubAlerts()

    private fun at(hhmm: String, date: LocalDate = day): Instant = date.atTime(LocalTime.parse(hhmm)).atZone(kst).toInstant()

    /** 운영과 같은 조립 — [observeOnly] 만 바꾼다(출발 = 두 출처 관찰 전용, 켜기 = 목록에서 뺌). */
    private fun sweep(observeOnly: Set<String>) = SituationSweep(
        SituationSweepProperties(mode = SweepMode.ON, horizon = SweepHorizon.TOMORROW, observeOnly = observeOnly),
        tripWatch, itineraryFacade, planFacade, triggerService, triggers, watches,
        providerOf(KmaWarningDetector(alerts, tripFacade), AirQualityDetector(alerts, tripFacade)), clock,
    )

    @AfterEach
    fun cleanUp() {
        mine.forEach {
            jdbc.update("DELETE FROM outbox_event WHERE event_type = ? AND payload->>'tripId' = ?", TYPE, it.toString())
            jdbc.update("UPDATE trip SET deleted_at = now() WHERE trip_id = ?", it)
        }
    }

    /**
     * 진행 중 제주 여행(어제~내일, 목적지 코드 50) + 확정 일정. 슬롯은 시드 POI 라 실 표면(이름·카테고리)이 붙는다 —
     * 오늘 성산일출봉(자연 14:00~15:00) · 본태박물관(문화 15:30~16:30), 내일 한라산 어리목(자연 10:00~12:00).
     */
    private fun jejuTrip(): UUID {
        val created = Instant.parse("2032-03-01T00:00:00Z")
        val accountId = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, created)).id.value
        val tripId = trips.save(
            Trip.create(
                accountId = accountId, title = null, startDate = day.minusDays(1), endDate = tomorrow,
                party = 2, companionType = null, budgetTotal = null, preferenceSnapshot = emptyMap(),
                destinations = listOf(TripDestination(0, "제주", 2, "50")), now = created,
            ),
        ).tripId
        itineraries.save(
            Itinerary.create(
                tripId, SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, isFallback = false,
                days = listOf(
                    ItineraryDay.of(
                        day, 0,
                        listOf(
                            VisitSlot.of(SEONGSAN, null, 0, LocalTime.of(14, 0), LocalTime.of(15, 0)),
                            VisitSlot.of(BONTAE, null, 1, LocalTime.of(15, 30), LocalTime.of(16, 30)),
                        ),
                    ),
                    ItineraryDay.of(tomorrow, 1, listOf(VisitSlot.of(HALLASAN, null, 0, LocalTime.of(10, 0), LocalTime.of(12, 0)))),
                ),
                now = created,
            ).confirm(created),
        )
        return tripId.also { mine += it }
    }

    private fun events(tripId: UUID): List<String> = jdbc.queryForList(
        "SELECT payload::text FROM outbox_event WHERE event_type = ? AND payload->>'tripId' = ?",
        String::class.java, TYPE, tripId.toString(),
    )

    private fun rowCount(tripId: UUID): Int =
        jdbc.queryForObject("SELECT count(*) FROM plan_b_trigger WHERE trip_id = ?", Int::class.java, tripId)!!

    @Test
    fun `출발 상태(관찰 전용)에서는 특보 신호가 표본 줄로만 남는다 — 트리거·사건 0`() {
        val tripId = jejuTrip()
        alerts.warnings = AlertRead.Ok(listOf(ActiveWarning("호우", "경보", listOf(WarningArea("제주도", listOf("제주도산지"))))))

        val lines = sweepLogs { sweep(setOf(SweepSource.KMA_WARNING, SweepSource.AIRKOREA)).sweep(at("13:15")) }

        lines shouldContain "planb.situation_sample tripId=$tripId source=kma-warning kind=WEATHER date=$day variant=RAIN severity=RISK slot=null name=null at=null"
        rowCount(tripId) shouldBe 0
        events(tripId).shouldBeEmpty()
        watches.findByTrip(tripId).shouldBeEmpty()
    }

    @Test
    fun `켜면 특보가 오늘 위험 트리거가 된다 — 출처·해제 자격·정본 문구, 다시 돌려도 늘지 않고, 특보가 걷히면 그 출처가 해제한다`() {
        val tripId = jejuTrip()
        alerts.warnings = AlertRead.Ok(listOf(ActiveWarning("호우", "경보", listOf(WarningArea("제주도", listOf("제주도산지"))))))
        val live = sweep(emptySet())

        live.sweep(at("13:15"))

        val active = triggers.findActiveByTrip(tripId).single()
        active.kind shouldBe TriggerKind.WEATHER
        active.affectedDate shouldBe day
        active.slotKey shouldBe null
        active.scope shouldBe TriggerScope.PARTIAL_SLOTS
        active.severity shouldBe TriggerSeverity.RISK
        active.variant shouldBe TriggerVariant.RAIN
        active.detector shouldBe SweepSource.KMA_WARNING
        active.dataSource shouldBe DataSource.KMA_WARNING
        active.reason shouldBe "기상청이 제주에 호우경보를 발표했어요. 성산일출봉 일정이 영향을 받을 수 있어요."
        active.poiIds shouldBe listOf(SEONGSAN.toString())
        val event = mapper.readTree(events(tripId).single())
        event["variant"].asText() shouldBe "RAIN"
        event["push"].asBoolean() shouldBe true

        val rows = rowCount(tripId)
        live.sweep(at("14:15")) // 같은 특보가 이어진다 — 제자리 갱신, 알림 없음
        rowCount(tripId) shouldBe rows
        events(tripId).size shouldBe 1

        alerts.warnings = AlertRead.Ok(emptyList()) // 특보 해제 — 남은 실외 슬롯(성산 15시 끝)이 있어 확인이 난다
        live.sweep(at("14:20"))
        triggers.findById(active.triggerId)!!.state shouldBe TriggerState.EXPIRED
    }

    /** 출처별 감지기(CD17) — 특보가 키 미등록(30)으로 종일 모름이어도 대기질의 발화·해제는 그대로 돈다. */
    @Test
    fun `특보가 모름이어도 대기질은 발화하고 해제된다 — 오늘 나쁨은 주의`() {
        val tripId = jejuTrip()
        alerts.warnings = AlertRead.Unknown("gateway:30")
        alerts.air[day] = AlertRead.Ok(mapOf(AirRegion.JEJU to AirGrade(pm10 = "나쁨", pm25 = "보통")))
        val live = sweep(emptySet())

        live.sweep(at("13:15"))

        val active = triggers.findActiveByTrip(tripId).single()
        active.severity shouldBe TriggerSeverity.CAUTION
        active.variant shouldBe TriggerVariant.DUST
        active.detector shouldBe SweepSource.AIRKOREA
        active.dataSource shouldBe DataSource.AIRKOREA
        active.reason shouldBe "제주 미세먼지 예보가 '나쁨'이에요. 성산일출봉 일정이 영향을 받을 수 있어요."
        active.payload["pm10"] shouldBe "나쁨"

        alerts.air[day] = AlertRead.Ok(mapOf(AirRegion.JEJU to AirGrade(pm10 = "보통", pm25 = "좋음"))) // 특보는 여전히 모름
        live.sweep(at("14:15"))
        triggers.findById(active.triggerId)!!.state shouldBe TriggerState.EXPIRED
    }

    @Test
    fun `저녁 회차는 내일 대기질을 본다 — 매우나쁨은 위험 · 미래일 FULL_DAY · 날짜 머리 · 특보는 내일을 보지 않는다`() {
        val tripId = jejuTrip()
        alerts.warnings = AlertRead.Ok(listOf(ActiveWarning("강풍", "주의보", listOf(WarningArea("제주도"))))) // 내일은 보지 않는다
        alerts.air[tomorrow] = AlertRead.Ok(mapOf(AirRegion.JEJU to AirGrade(pm10 = "매우나쁨", pm25 = "나쁨")))

        sweep(emptySet()).sweep(at("20:15"))

        val active = triggers.findActiveByTrip(tripId).single()
        active.affectedDate shouldBe tomorrow
        active.scope shouldBe TriggerScope.FULL_DAY
        active.severity shouldBe TriggerSeverity.RISK
        active.detector shouldBe SweepSource.AIRKOREA
        active.reason shouldBe "3월 17일(수) 제주 미세먼지 예보가 '매우나쁨'이에요. 한라산 어리목 일정이 영향을 받을 수 있어요."
        events(tripId).size shouldBe 1
    }

    /** 스윕 로거의 INFO 줄. */
    private fun sweepLogs(block: () -> Unit): List<String> {
        val logger = LoggerFactory.getLogger(SituationSweep::class.java) as Logger
        val appender = ListAppender<ILoggingEvent>().apply { start() }
        logger.addAppender(appender)
        try {
            block()
        } finally {
            logger.detachAppender(appender)
        }
        return appender.list.map { it.formattedMessage }
    }

    private fun providerOf(vararg detectors: SituationDetector): ObjectProvider<SituationDetector> = object : ObjectProvider<SituationDetector> {
        override fun getObject(): SituationDetector = detectors.first()
        override fun getIfAvailable(): SituationDetector? = detectors.firstOrNull()
        override fun stream(): Stream<SituationDetector> = detectors.toList().stream()
        override fun orderedStream(): Stream<SituationDetector> = detectors.toList().stream()
    }

    companion object {
        private const val TYPE = "planb.PlanBTriggered"

        /** 시드 POI(R__seed_stub_pois.sql) — 제주. */
        private val SEONGSAN = UUID.fromString("e0000000-0000-4000-8000-000000000001") // 성산일출봉 · 자연
        private val HALLASAN = UUID.fromString("e0000000-0000-4000-8000-000000000004") // 한라산 어리목 · 자연
        private val BONTAE = UUID.fromString("e0000000-0000-4000-8000-000000000010") // 본태박물관 · 문화
    }
}
