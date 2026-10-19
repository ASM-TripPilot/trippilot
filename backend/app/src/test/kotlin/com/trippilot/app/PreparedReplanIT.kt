package com.trippilot.app

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.app.event.OutboxRelay
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.itinerarygeneration.api.ReplanCommand
import com.trippilot.itinerarygeneration.api.ReplanFacade
import com.trippilot.itinerarygeneration.api.ReplanProposal
import com.trippilot.itinerarygeneration.api.ReplanSlot
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.VisitSlot
import com.trippilot.planbdetection.api.TriggerLookupFacade
import com.trippilot.planbdetection.api.TriggerRef
import com.trippilot.planbdetection.application.Detection
import com.trippilot.planbdetection.application.DetectionSignal
import com.trippilot.planbdetection.application.Observation
import com.trippilot.planbdetection.application.TriggerService
import com.trippilot.planbdetection.domain.DataSource
import com.trippilot.planbdetection.domain.PlanBTriggerRepository
import com.trippilot.planbdetection.domain.SituationCopy
import com.trippilot.planbdetection.domain.SweepSource
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerScope
import com.trippilot.planbdetection.domain.TriggerState
import com.trippilot.planbdetection.domain.TriggerVariant
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.api.TripPeriod
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Primary
import org.springframework.dao.DataAccessResourceFailureException
import org.springframework.http.HttpMethod
import org.springframework.http.client.JdkClientHttpRequestFactory
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.web.client.RestClient
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * 미리 짜 둔 대안 관통(situation-awareness T-IT-8) — **판정(A1 의 실제 reconcile)이 적재한 위험 사건** → 아웃박스 릴레이 →
 * 선계산 구독자 → SYSTEM 세션 → 전용 실행기 산출(DRAFT) → `prepared?date=` → 사용자 적용 → `ItineraryRecalculated` → 트리거 소비.
 *
 * 여기서만 보이는 것: 이벤트 타입 문자열과 payload 키(`severity`·`dateRisks`)가 jsonb 왕복 뒤에도 두 모듈 사이에서 맞는가,
 * 같은 사건의 알림 구독자와 선계산 구독자가 서로 독립으로 도는가(#1348), 재배달이 세션·알림을 늘리지 않는가(부분 유니크·
 * `source_event_id`), 전용 실행기(비동기)가 실제로 초안까지 가는가.
 *
 * 산출만 대역이다 — 대역 AI 는 '지금' 시각부터 채워 늦은 밤엔 해가 없다(시각 의존). 등록한 여행만 고정 초안을 낸다.
 * 날짜는 서버 실 시계로 정한다(진입 검증이 실 시계를 본다) — 그래서 대상은 시각과 무관한 **내일**(하루 전체)이다.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = ["trippilot.replan.prepared.mode=on"],
)
class PreparedReplanIT : AbstractPostgresIntegrationTest() {

    /** 등록한 여행만 고정 초안 — 나머지는 실물에 위임한다(반영은 언제나 실물이다). */
    class FixedReplanFacade(private val delegate: ReplanFacade) : ReplanFacade by delegate {
        val drafts = ConcurrentHashMap<UUID, ReplanProposal>()
        val proposeCalls = ConcurrentHashMap<UUID, AtomicInteger>()

        override fun propose(command: ReplanCommand): ReplanProposal? {
            val fixed = drafts[command.tripId] ?: return delegate.propose(command)
            proposeCalls.computeIfAbsent(command.tripId) { AtomicInteger() }.incrementAndGet()
            return fixed.copy(date = command.targetDate)
        }
    }

    /** 트리거 조회를 여행 단위로 끊는 대역 — 선계산 구독자의 일시 오류(→ 릴레이 재시도) 경로를 만든다. */
    class FlakyTriggerLookup(private val real: TriggerLookupFacade) : TriggerLookupFacade {
        val down: MutableSet<UUID> = ConcurrentHashMap.newKeySet()
        override fun find(tripId: UUID, triggerId: UUID): TriggerRef? {
            if (tripId in down) throw DataAccessResourceFailureException("트리거 조회 불통(대역)")
            return real.find(tripId, triggerId)
        }
    }

    @TestConfiguration
    class Doubles {
        @Bean
        @Primary
        fun fixedReplans(@Qualifier("replanFacadeService") delegate: ReplanFacade) = FixedReplanFacade(delegate)

        @Bean
        @Primary
        fun flakyTriggers(triggerService: TriggerService) = FlakyTriggerLookup(triggerService)
    }

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var relay: OutboxRelay
    @Autowired private lateinit var triggerService: TriggerService
    @Autowired private lateinit var triggers: PlanBTriggerRepository
    @Autowired private lateinit var replans: FixedReplanFacade
    @Autowired private lateinit var flaky: FlakyTriggerLookup
    @Autowired private lateinit var itineraryFacade: ItineraryFacade
    @Autowired private lateinit var planFacade: ItineraryPlanFacade
    @Autowired private lateinit var itineraries: ItineraryRepository
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var tokens: AccessTokenIssuer
    @Autowired private lateinit var jdbc: JdbcTemplate
    @Autowired private lateinit var clock: Clock

    private val json = ObjectMapper()
    private val kst = ZoneId.of("Asia/Seoul")
    private val mine = mutableListOf<UUID>()

    /** 내 여행의 사건을 지운다 — 남기면 같은 컨테이너의 다른 IT 릴레이 배치를 차지한다. */
    @AfterEach
    fun cleanUp() {
        mine.forEach { trip ->
            jdbc.update("DELETE FROM outbox_event WHERE payload->>'tripId' = ? OR aggregate_id = ?", trip.toString(), trip.toString())
            flaky.down.remove(trip)
        }
    }

    private class Fixture(val accountId: UUID, val tripId: UUID, val itineraryId: UUID, val token: String)

    /** 진행 중 여행(어제~내일, 실 시계) + 오늘·내일 슬롯이 있는 일정 + 그 여행의 고정 초안(내일 13시 한 곳). */
    private fun tripWithItinerary(): Fixture {
        val today = LocalDate.now(clock.withZone(kst))
        val created = clock.instant()
        val accountId = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, created)).id.value
        val tripId = trips.save(
            Trip.create(
                accountId = accountId, title = null, startDate = today.minusDays(1), endDate = today.plusDays(1),
                party = 2, companionType = null, budgetTotal = null, preferenceSnapshot = emptyMap(),
                destinations = listOf(TripDestination(0, "제주", 2)), now = created,
            ),
        ).tripId.also { mine += it }
        val itinerary = itineraries.save(
            Itinerary.create(
                tripId, SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, isFallback = false,
                days = listOf(
                    ItineraryDay.of(today, 0, listOf(VisitSlot.of(UUID.randomUUID(), null, 0, LocalTime.of(10, 0), LocalTime.of(11, 0)))),
                    ItineraryDay.of(today.plusDays(1), 1, listOf(VisitSlot.of(UUID.randomUUID(), null, 0, LocalTime.of(10, 0), LocalTime.of(11, 0)))),
                ),
                now = created,
            ),
        )
        replans.drafts[tripId] = ReplanProposal(
            itinerary.itineraryId, today.plusDays(1),
            listOf(
                ReplanSlot(
                    UUID.randomUUID(), LocalTime.of(13, 0), LocalTime.of(14, 0), isFixed = false, endsNextDay = false,
                    distanceRange = "약 1.2km", placementReason = "실내라 비를 피할 수 있어요", hasViolation = false, violationReason = null,
                ),
            ),
        )
        return Fixture(accountId, tripId, itinerary.itineraryId, tokens.issue(accountId.toString()).value)
    }

    /** 실제 판정 경로 — 단기예보 감지기가 내일 비를 확인했다(위험). 같은 트랜잭션의 아웃박스에 사건이 남는다. */
    private fun rainTomorrow(f: Fixture) {
        val now = clock.instant()
        val tomorrow = LocalDate.ofInstant(now, kst).plusDays(1)
        val period = TripPeriod(tomorrow.minusDays(2), tomorrow)
        triggerService.reconcile(
            f.accountId, f.tripId, period, now,
            itineraryFacade.findCurrent(f.accountId, f.tripId),
            planFacade.findPlanSlots(f.accountId, f.tripId),
            listOf(
                Observation(
                    SweepSource.KMA_FORECAST, TriggerKind.WEATHER, tomorrow,
                    Detection.Checked(
                        emptySet(),
                        listOf(
                            DetectionSignal(
                                kind = TriggerKind.WEATHER, affectedDate = tomorrow, slotKey = null, payload = mapOf("pop" to 80),
                                reason = "${SituationCopy.dayPrefix(tomorrow)} 오후에 비 소식이 있어요.", scope = TriggerScope.FULL_DAY,
                                variant = TriggerVariant.RAIN, dataSource = DataSource.KMA_VILAGE,
                            ),
                        ),
                    ),
                ),
            ),
        )
    }

    private fun call(method: HttpMethod, path: String, token: String?): Pair<Int, JsonNode> {
        val spec = RestClient.builder().requestFactory(JdkClientHttpRequestFactory()).baseUrl("http://localhost:$port").build()
            .method(method).uri("/api/v1$path")
        token?.let { spec.header("Authorization", "Bearer $it") }
        val res = spec.retrieve().onStatus({ it.isError }, { _, _ -> }).toEntity(String::class.java)
        return res.statusCode.value() to (res.body?.takeIf { it.isNotBlank() }?.let { json.readTree(it) } ?: json.createObjectNode())
    }

    private fun events(type: String, tripId: UUID, where: String = "TRUE"): Int = jdbc.queryForObject(
        "SELECT count(*) FROM outbox_event WHERE event_type = ? AND (payload->>'tripId' = ? OR aggregate_id = ?) AND $where",
        Int::class.java, type, tripId.toString(), tripId.toString(),
    )!!

    /** 다른 IT 가 남긴 사건이 배치를 차지할 수 있다 — 내 사건이 처리될 때까지 돌린다(이 리포의 관용구). */
    private fun deliver(type: String, tripId: UUID) =
        repeat(RELAY_TRIES) { if (events(type, tripId, "published_at IS NULL AND attempts = 0") > 0) relay.relay() }

    private fun systemSessions(tripId: UUID): Int = jdbc.queryForObject(
        "SELECT count(*) FROM replan_session WHERE trip_id = ? AND initiated_by = 'SYSTEM'", Int::class.java, tripId,
    )!!

    private fun planBNotifications(accountId: UUID): Int = jdbc.queryForObject(
        "SELECT count(*) FROM notification WHERE account_id = ? AND kind = 'PLAN_B'", Int::class.java, accountId,
    )!!

    /** 전용 실행기는 비동기다 — 상태로 기다린다(고정 sleep 금지). */
    private fun awaitPrepared(f: Fixture, date: LocalDate, status: String): JsonNode {
        val deadline = System.nanoTime() + java.time.Duration.ofSeconds(20).toNanos()
        var last: JsonNode = json.createObjectNode()
        while (System.nanoTime() < deadline) {
            val (rc, body) = call(HttpMethod.GET, "/trips/${f.tripId}/replan-sessions/prepared?date=$date", f.token)
            if (rc == 200) last = body
            if (rc == 200 && body["status"].asText() == status) return body
            Thread.sleep(50)
        }
        error("준비된 대안이 $status 가 되지 않았습니다. 마지막=$last")
    }

    @Test
    fun `위험 사건 하나가 미리 짠 대안이 되고, 사용자가 적용하면 일정이 바뀌고 트리거가 소비된다`() {
        val f = tripWithItinerary()
        val tomorrow = LocalDate.ofInstant(clock.instant(), kst).plusDays(1)

        rainTomorrow(f)
        val trigger = triggers.findActiveByTrip(f.tripId).single()
        deliver(TYPE_TRIGGERED, f.tripId)

        events(TYPE_TRIGGERED, f.tripId, "published_at IS NOT NULL") shouldBe 1 // '배달됐다'를 센다 — 없음을 세지 않는다
        planBNotifications(f.accountId) shouldBe 1 // 같은 사건의 알림 구독자도 돌았다
        val draft = awaitPrepared(f, tomorrow, "DRAFT")
        draft["initiatedBy"].asText() shouldBe "SYSTEM"
        draft["stale"].asBoolean() shouldBe false
        draft["triggerId"].asText() shouldBe trigger.triggerId.toString()
        draft["targetDate"].asText() shouldBe tomorrow.toString()
        draft["scope"].asText() shouldBe "FULL_DAY"
        draft["reasons"].map { it.asText() } shouldBe listOf("WEATHER")
        // 초안까지다 — 사용자가 적용하기 전에는 일정이 그대로다(INV-SA-1)
        planFacade.findPlanSlots(f.accountId, f.tripId).filter { it.date == tomorrow }.map { it.startAt } shouldBe listOf(LocalTime.of(10, 0))

        val sessionId = draft["sessionId"].asText()
        call(HttpMethod.GET, "/trips/${f.tripId}/replan-sessions/$sessionId", f.token).second["stale"].asBoolean() shouldBe false
        val (rc, applied) = call(HttpMethod.POST, "/trips/${f.tripId}/replan-sessions/$sessionId/apply", f.token)
        rc shouldBe 200
        applied["status"].asText() shouldBe "APPLIED"
        planFacade.findPlanSlots(f.accountId, f.tripId).filter { it.date == tomorrow }.map { it.startAt } shouldBe listOf(LocalTime.of(13, 0))

        events(TYPE_RECALCULATED, f.tripId, "payload->>'triggerId' = '${trigger.triggerId}' AND payload->>'targetDate' = '$tomorrow'") shouldBe 1
        deliver(TYPE_RECALCULATED, f.tripId)
        triggers.findById(trigger.triggerId)!!.state shouldBe TriggerState.CONSUMED // 적용이 그 날의 트리거를 닫는다(BR-SA-14)
    }

    @Test
    fun `같은 사건이 다시 배달돼도 선계산 세션·알림이 늘지 않는다 — AI 도 다시 부르지 않는다`() {
        val f = tripWithItinerary()
        val tomorrow = LocalDate.ofInstant(clock.instant(), kst).plusDays(1)
        rainTomorrow(f)
        deliver(TYPE_TRIGGERED, f.tripId)
        awaitPrepared(f, tomorrow, "DRAFT")

        jdbc.update("UPDATE outbox_event SET published_at = NULL WHERE event_type = ? AND payload->>'tripId' = ?", TYPE_TRIGGERED, f.tripId.toString())
        deliver(TYPE_TRIGGERED, f.tripId)

        events(TYPE_TRIGGERED, f.tripId, "published_at IS NOT NULL") shouldBe 1
        systemSessions(f.tripId) shouldBe 1 // 트리거당 1개
        planBNotifications(f.accountId) shouldBe 1 // source_event_id UNIQUE
        replans.proposeCalls.getValue(f.tripId).get() shouldBe 1
    }

    // #1348 — 릴레이는 구독자를 서로 독립으로 돌린다. 선계산이 일시 오류로 던져도 알림은 적재되고, 이벤트째 재시도된다.
    @Test
    fun `선계산이 일시 오류로 실패해도 PLAN_B 알림은 적재되고, 회복 뒤 재배달이 대안을 연다`() {
        val f = tripWithItinerary()
        val tomorrow = LocalDate.ofInstant(clock.instant(), kst).plusDays(1)
        flaky.down += f.tripId
        rainTomorrow(f)

        repeat(RELAY_TRIES) { if (events(TYPE_TRIGGERED, f.tripId, "attempts = 0") > 0) relay.relay() }

        planBNotifications(f.accountId) shouldBe 1 // 알림은 선계산 실패와 무관하게 적재됐다
        events(TYPE_TRIGGERED, f.tripId, "published_at IS NULL AND attempts = 1") shouldBe 1 // 재시도 대기
        systemSessions(f.tripId) shouldBe 0
        call(HttpMethod.GET, "/trips/${f.tripId}/replan-sessions/prepared?date=$tomorrow", f.token).first shouldBe 404

        flaky.down -= f.tripId
        jdbc.update("UPDATE outbox_event SET next_attempt_at = now() WHERE event_type = ? AND payload->>'tripId' = ?", TYPE_TRIGGERED, f.tripId.toString())
        repeat(RELAY_TRIES) { if (events(TYPE_TRIGGERED, f.tripId, "published_at IS NULL") > 0) relay.relay() }

        events(TYPE_TRIGGERED, f.tripId, "published_at IS NOT NULL") shouldBe 1
        awaitPrepared(f, tomorrow, "DRAFT")["initiatedBy"].asText() shouldBe "SYSTEM"
        planBNotifications(f.accountId) shouldBe 1 // 재배달이 알림을 늘리지 않는다
    }

    @Test
    fun `준비된 대안 조회 — 없으면 404, 남의 여행도 404(은닉), 날짜가 없거나 틀리면 400`() {
        val f = tripWithItinerary()
        val tomorrow = LocalDate.ofInstant(clock.instant(), kst).plusDays(1)
        val stranger = tokens.issue(
            accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, Instant.now())).id.value.toString(),
        ).value

        call(HttpMethod.GET, "/trips/${f.tripId}/replan-sessions/prepared?date=$tomorrow", f.token).first shouldBe 404
        rainTomorrow(f)
        deliver(TYPE_TRIGGERED, f.tripId)
        awaitPrepared(f, tomorrow, "DRAFT")

        call(HttpMethod.GET, "/trips/${f.tripId}/replan-sessions/prepared?date=$tomorrow", stranger).first shouldBe 404
        call(HttpMethod.GET, "/trips/${f.tripId}/replan-sessions/prepared", f.token).first shouldBe 400
        call(HttpMethod.GET, "/trips/${f.tripId}/replan-sessions/prepared?date=tomorrow", f.token).first shouldBe 400
    }

    private companion object {
        private const val TYPE_TRIGGERED = "planb.PlanBTriggered"
        private const val TYPE_RECALCULATED = "recalculation.ItineraryRecalculated"

        /** 남의 릴레이 호출에 내 행을 빼앗겨도 결국 결과를 보게 하는 상한. */
        private const val RELAY_TRIES = 20
    }
}
