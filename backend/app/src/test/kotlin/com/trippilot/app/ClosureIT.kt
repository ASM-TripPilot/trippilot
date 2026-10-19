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
import com.trippilot.planbdetection.application.SituationDetector
import com.trippilot.planbdetection.application.SituationSweep
import com.trippilot.planbdetection.application.SituationSweepProperties
import com.trippilot.planbdetection.application.SweepHorizon
import com.trippilot.planbdetection.application.SweepMode
import com.trippilot.planbdetection.application.TriggerService
import com.trippilot.planbdetection.domain.DataSource
import com.trippilot.planbdetection.domain.PlanBTrigger
import com.trippilot.planbdetection.domain.PlanBTriggerRepository
import com.trippilot.planbdetection.domain.PlanBWatchRepository
import com.trippilot.planbdetection.domain.SituationCopy
import com.trippilot.planbdetection.domain.SweepSource
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerScope
import com.trippilot.planbdetection.domain.TriggerSeverity
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
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.ObjectProvider
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.TestPropertySource
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID

/**
 * 장소 감지 실 DB 관통(설계서 T-IT-7 · BR-SA-17) — 감지기·하루 점검·장소 상태·판정·아웃박스 모두 실물이다.
 *
 * 컨텍스트는 `ScheduleAgentHttpModeIT` 와 **같은 설정**이다(컨텍스트 캐시를 나눠 쓴다 — 컨텍스트마다 커넥션 풀이 붙는다).
 * AI 모드가 http 라 하루 검증이 AI 를 실제로 부르는데, AI 주소는 풀리지 않는 이름(`.invalid`)이라 실 호출 없이 보류된다 —
 * 영업시간은 모름이고 폐업 판정은 그대로 도는 갈래(설계서 §4.3 실패·모름 표)를 실물로 지난다.
 * 이 컨텍스트의 스윕 빈은 기본값(꺼짐)이다 — '꺼짐 → 0'은 그 빈으로 보고, 켠 회차는 같은 실물로 조립한 인스턴스가 돈다
 * (`SituationSweepIT` 의 dry-run 과 같은 방식). 켠 회차는 내 계정만 본다(허용목록) — 같은 컨테이너의 다른 여행을 판정하지 않게.
 * 회차 시각은 다른 IT 가 쓰지 않는 먼 날(2032-03-09 화)이다 — 스윕은 실 시계가 아니라 넘긴 시각으로 판정한다.
 */
@SpringBootTest
@TestPropertySource(
    properties = [
        "trippilot.ai.schedule.mode=http",
        "trippilot.ai.schedule.base-url=http://ai.invalid:8000",
    ],
)
class ClosureIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var sweep: SituationSweep
    @Autowired private lateinit var sweepProps: SituationSweepProperties
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var itineraries: ItineraryRepository
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var triggers: PlanBTriggerRepository
    @Autowired private lateinit var watches: PlanBWatchRepository
    @Autowired private lateinit var jdbc: JdbcTemplate
    @Autowired private lateinit var mapper: ObjectMapper
    @Autowired private lateinit var tripWatch: TripWatchFacade
    @Autowired private lateinit var itineraryFacade: ItineraryFacade
    @Autowired private lateinit var planFacade: ItineraryPlanFacade
    @Autowired private lateinit var triggerService: TriggerService
    @Autowired private lateinit var detectorBeans: ObjectProvider<SituationDetector>
    @Autowired private lateinit var clock: Clock

    private val kst = ZoneId.of("Asia/Seoul")
    private val day = LocalDate.parse("2032-03-09")
    private val tomorrow = day.plusDays(1)
    private val mine = mutableListOf<UUID>()

    private fun at(hhmm: String): Instant = day.atTime(LocalTime.parse(hhmm)).atZone(kst).toInstant()

    /** 시드 폐업 POI(`R__seed_stub_pois`) — 시드가 빠져도 이 테스트가 같은 행을 세운다(있으면 그대로). */
    @BeforeEach
    fun closedPoi() {
        jdbc.update(
            "INSERT INTO poi (poi_id, name_ko, lat, lng, category, region, data_status, source) " +
                "VALUES (?::uuid, ?, 33.5010, 126.5010, '카페', '제주', 'CLOSED', 'MANUAL') ON CONFLICT (poi_id) DO NOTHING",
            CLOSED_POI.toString(), CLOSED_NAME,
        )
        jdbc.queryForObject("SELECT data_status FROM poi WHERE poi_id = ?::uuid", String::class.java, CLOSED_POI.toString()) shouldBe "CLOSED"
    }

    /** 끝난 뒤 내 여행을 지우고(다음 회차의 대상에서 빠진다) 내 사건을 비운다(같은 컨테이너의 릴레이 배치를 차지하지 않게). */
    @AfterEach
    fun cleanUp() {
        mine.forEach {
            jdbc.update("DELETE FROM outbox_event WHERE event_type = ? AND payload->>'tripId' = ?", TYPE, it.toString())
            jdbc.update("UPDATE trip SET deleted_at = now() WHERE trip_id = ?", it)
        }
    }

    /** 진행 중 여행(어제~내일) + 확정 일정 — 오늘 슬롯은 20:15 에 이미 끝났고, 내일 슬롯이 폐업 POI 다. */
    private fun confirmedTrip(): Pair<UUID, UUID> {
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
                    ItineraryDay.of(tomorrow, 1, listOf(VisitSlot.of(CLOSED_POI, null, 0, LocalTime.of(10, 0), LocalTime.of(11, 0)))),
                ),
                now = created,
            ).confirm(created),
        )
        mine += tripId
        return accountId to tripId
    }

    /** 이 컨텍스트의 실물로 조립한 켠 스윕 — 내 계정만 본다. */
    private fun onFor(accountId: UUID) = SituationSweep(
        SituationSweepProperties(mode = SweepMode.ON, horizon = SweepHorizon.TOMORROW, accountIds = setOf(accountId)),
        tripWatch, itineraryFacade, planFacade, triggerService, triggers, watches, detectorBeans, clock,
    )

    private fun events(tripId: UUID): List<String> = jdbc.queryForList(
        "SELECT payload::text FROM outbox_event WHERE event_type = ? AND payload->>'tripId' = ?",
        String::class.java, TYPE, tripId.toString(),
    )

    private fun rowCount(tripId: UUID): Int =
        jdbc.queryForObject("SELECT count(*) FROM plan_b_trigger WHERE trip_id = ?", Int::class.java, tripId)!!

    @Test
    fun `20시 15분 회차가 내일 일정의 폐업 장소를 PERMANENTLY_CLOSED 로 띄우고 사건 1건을 남긴다 — 다시 돌려도 행·사건이 늘지 않는다`() {
        val (accountId, tripId) = confirmedTrip()
        detectorBeans.orderedStream().toList().single { it.source == SweepSource.PLACE }.isLive() shouldBe true
        val on = onFor(accountId)

        val first = on.sweep(at("20:15"))

        first.live shouldContain SweepSource.PLACE
        first.announced shouldBe 1
        val active = triggers.findActiveByTrip(tripId).single()
        active.kind shouldBe TriggerKind.CLOSURE
        active.affectedDate shouldBe tomorrow
        active.slotKey shouldBe "$tomorrow#$CLOSED_POI"
        active.variant shouldBe TriggerVariant.PERMANENTLY_CLOSED
        active.severity shouldBe TriggerSeverity.RISK
        active.scope shouldBe TriggerScope.FULL_DAY // 미래일(CD7)
        active.detector shouldBe SweepSource.PLACE
        active.dataSource shouldBe DataSource.PLACE_STATUS
        active.payload[PlanBTrigger.PAYLOAD_POI_ID] shouldBe CLOSED_POI.toString()
        active.reason shouldBe "${SituationCopy.dayPrefix(tomorrow)} ‘$CLOSED_NAME’는 폐업한 곳으로 확인됐어요"
        val event = mapper.readTree(events(tripId).single())
        event["aggregateId"].asText() shouldBe active.triggerId.toString()
        event["kind"].asText() shouldBe "CLOSURE"
        event["variant"].asText() shouldBe "PERMANENTLY_CLOSED"
        event["push"].asBoolean() shouldBe true
        event["dateRisks"].single()["poiIds"].map { it.asText() } shouldBe listOf(CLOSED_POI.toString())
        watches.findByTrip(tripId).single().let {
            it.source shouldBe SweepSource.PLACE
            it.status shouldBe WatchStatus.CHECKED
        }

        val rows = rowCount(tripId)
        on.sweep(at("20:40")) // 보충 회차 — 같은 폐업이 이어진다

        rowCount(tripId) shouldBe rows
        events(tripId).size shouldBe 1
        triggers.findActiveByTrip(tripId).single().triggerId shouldBe active.triggerId // 제자리(triggerId 유지)
    }

    @Test
    fun `스윕이 꺼져 있으면 아무것도 하지 않는다 — 감지·행·사건 0`() {
        val (_, tripId) = confirmedTrip()
        sweepProps.mode shouldBe SweepMode.OFF // 이 컨텍스트의 스윕 빈은 기본값(꺼짐)이다

        val summary = sweep.sweep(at("20:15"))

        summary.phase shouldBe null
        rowCount(tripId) shouldBe 0
        events(tripId).shouldBeEmpty()
        watches.findByTrip(tripId).shouldBeEmpty()
    }

    private companion object {
        private const val TYPE = "planb.PlanBTriggered"
        private val CLOSED_POI: UUID = UUID.fromString("e0000000-0000-4000-8000-0000000000f2")
        private const val CLOSED_NAME = "[폐업] 사라진 카페"
    }
}
