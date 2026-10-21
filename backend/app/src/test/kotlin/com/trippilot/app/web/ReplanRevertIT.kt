package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
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
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.matchers.collections.shouldContainExactly
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
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.http.client.JdkClientHttpRequestFactory
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.web.client.RestClient
import java.time.Clock
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * 원탭 [다시 짜기] 적용 뒤 — 빠진 곳 보기와 확정 일정 되돌리기(TRIP-1412) 관통.
 *
 * 여기서만 보이는 것: 반영 순간 떠 둔 기준·되돌리기 지점이 **실제 jsonb 를 왕복**하고(새 칸 V2.81), 되돌린 날이 확정 동결
 * (`visit_slot.poi_snapshot_id` → `poi_snapshot` FK)의 **같은 행**을 다시 가리키는가, 그리고 DB CHECK 가 도메인 규칙과 같은가.
 *
 * 산출만 대역이다 — 대역 AI 는 '지금' 시각부터 채워 늦은 밤엔 해가 없다(시각 의존). 등록한 여행만 고정 초안을 낸다.
 * 대상은 시각과 무관한 **내일**(하루 전체)이다 — 진입 검증이 서버 실 시계를 본다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ReplanRevertIT : AbstractPostgresIntegrationTest() {

    /** 등록한 여행만 고정 초안 — 나머지는 실물에 위임한다(반영·되돌리기는 언제나 실물이다). */
    class FixedDraftReplans(private val delegate: ReplanFacade) : ReplanFacade by delegate {
        val drafts = ConcurrentHashMap<UUID, ReplanProposal>()
        override fun propose(command: ReplanCommand): ReplanProposal? =
            drafts[command.tripId]?.copy(date = command.targetDate) ?: delegate.propose(command)
    }

    @TestConfiguration
    class Doubles {
        @Bean
        @Primary
        fun fixedDraftReplans(@Qualifier("replanFacadeService") delegate: ReplanFacade) = FixedDraftReplans(delegate)
    }

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var replans: FixedDraftReplans
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
        mine.forEach { jdbc.update("DELETE FROM outbox_event WHERE payload->>'tripId' = ? OR aggregate_id = ?", it.toString(), it.toString()) }
    }

    private fun call(method: HttpMethod, path: String, token: String, body: String? = null): Pair<Int, JsonNode> {
        val spec = RestClient.builder().requestFactory(JdkClientHttpRequestFactory()).baseUrl("http://localhost:$port").build()
            .method(method).uri("/api/v1$path").header("Authorization", "Bearer $token")
        body?.let { spec.contentType(MediaType.APPLICATION_JSON).body(it) }
        val res = spec.retrieve().onStatus({ it.isError }, { _, _ -> }).toEntity(String::class.java)
        return res.statusCode.value() to (res.body?.takeIf { it.isNotBlank() }?.let { json.readTree(it) } ?: json.createObjectNode())
    }

    /** 확정에 쓸 실 POI — 동결은 ACTIVE 행만 얼린다. 이 테스트 전용 id 라 다른 IT 와 겹치지 않는다. */
    private fun activePoi(name: String): UUID = UUID.randomUUID().also {
        jdbc.update(
            "INSERT INTO poi (poi_id, name_ko, lat, lng, category, region, data_status, source) " +
                "VALUES (?::uuid, ?, 33.50, 126.53, '카페', '제주', 'ACTIVE', 'MANUAL')",
            it.toString(), name,
        )
    }

    private fun snapshotsOn(tripId: UUID, date: LocalDate): List<Pair<UUID, UUID?>> = jdbc.query(
        """
        SELECT s.source_poi_id, s.poi_snapshot_id FROM visit_slot s
          JOIN itinerary_day d ON d.itinerary_day_id = s.itinerary_day_id
          JOIN itinerary i ON i.itinerary_id = d.itinerary_id
         WHERE i.trip_id = ? AND d.day_date = ? ORDER BY s.order_index
        """.trimIndent(),
        { rs, _ -> rs.getObject(1, UUID::class.java) to rs.getObject(2, UUID::class.java) },
        tripId, date,
    )

    private fun awaitDraft(token: String, tripId: UUID, sessionId: String): JsonNode {
        val deadline = System.nanoTime() + java.time.Duration.ofSeconds(20).toNanos()
        var last: JsonNode = json.createObjectNode()
        while (System.nanoTime() < deadline) {
            last = call(HttpMethod.GET, "/trips/$tripId/replan-sessions/$sessionId", token).second
            if (last["status"].asText() !in setOf("COLLECTING", "SOLVING")) return last
            Thread.sleep(50)
        }
        error("재계획 산출이 기한 내 끝나지 않았습니다. 마지막 상태=$last")
    }

    @Test
    fun `확정 일정에 원탭 재계획을 적용하면 빠진 곳을 보여 주고, 되돌리면 그 날이 같은 동결 참조로 돌아온다`() {
        val today = LocalDate.now(clock.withZone(kst))
        val tomorrow = today.plusDays(1)
        val kept = activePoi("남는 곳")
        val dropped = activePoi("빠지는 곳")
        val added = activePoi("새로 들어온 곳")
        val created = clock.instant()
        val accountId = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, created)).id.value
        val token = tokens.issue(accountId.toString()).value
        val tripId = trips.save(
            Trip.create(
                accountId = accountId, title = null, startDate = today.minusDays(1), endDate = tomorrow,
                party = 2, companionType = null, budgetTotal = null, preferenceSnapshot = emptyMap(),
                destinations = listOf(TripDestination(0, "제주", 2)), now = created,
            ),
        ).tripId.also { mine += it }
        val itinerary = itineraries.save(
            Itinerary.create(
                tripId, SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, isFallback = false,
                days = listOf(
                    ItineraryDay.of(today, 0, listOf(VisitSlot.of(kept, null, 0, LocalTime.of(10, 0), LocalTime.of(11, 0)))),
                    ItineraryDay.of(
                        tomorrow, 1,
                        listOf(
                            VisitSlot.of(kept, null, 0, LocalTime.of(10, 0), LocalTime.of(11, 0)),
                            VisitSlot.of(dropped, null, 1, LocalTime.of(14, 0), LocalTime.of(15, 0)),
                        ),
                    ),
                ),
                now = created,
            ),
        )
        // 여행 중 일정은 대개 확정이다 — 실 확정 경로로 동결한다.
        call(HttpMethod.POST, "/trips/$tripId/itinerary/confirm", token).first shouldBe 200
        val frozenBefore = snapshotsOn(tripId, tomorrow)
        frozenBefore.map { it.first } shouldContainExactly listOf(kept, dropped)
        frozenBefore.forEach { (_, snapshot) -> (snapshot != null) shouldBe true }
        replans.drafts[tripId] = ReplanProposal(
            itinerary.itineraryId, tomorrow,
            listOf(
                ReplanSlot(kept, LocalTime.of(10, 0), LocalTime.of(11, 0), false, false, null, null, hasViolation = false, violationReason = null),
                ReplanSlot(added, LocalTime.of(14, 0), LocalTime.of(15, 30), false, false, "약 1.2km", "실내라 비를 피해요", hasViolation = false, violationReason = null),
            ),
        )

        val sessionId = call(
            HttpMethod.POST, "/trips/$tripId/replan-sessions", token, """{"scope":"FULL_DAY","targetDate":"$tomorrow"}""",
        ).second["sessionId"].asText()
        awaitDraft(token, tripId, sessionId)["status"].asText() shouldBe "DRAFT"
        val (applyRc, applied) = call(HttpMethod.POST, "/trips/$tripId/replan-sessions/$sessionId/apply", token)
        applyRc shouldBe 200
        applied["revertible"].asBoolean() shouldBe true
        snapshotsOn(tripId, tomorrow).map { it.first } shouldContainExactly listOf(kept, added)

        // AC 1 — 적용 직후 APPLIED 에서도 비교가 나오고, 빠진 곳(장소·시각)이 실린다.
        val diff = call(HttpMethod.GET, "/trips/$tripId/replan-sessions/$sessionId/diff", token).second
        diff["ready"].asBoolean() shouldBe true
        diff["status"].asText() shouldBe "APPLIED"
        val removed = diff["entries"].filter { it["change"].asText() == "REMOVED" }
        removed.map { it["slotKey"].asText() } shouldContainExactly listOf("$tomorrow#$dropped")
        removed.single()["beforeStart"].asText() shouldBe "14:00:00"
        diff["before"].map { it["nameKo"].asText() } shouldContainExactly listOf("남는 곳", "빠지는 곳") // jsonb 를 거친 표면

        // AC 2 — 되돌리기가 200 이고 그 날이 적용 전과 같으며, 상태는 CONFIRMED 그대로다.
        val (revertRc, reverted) = call(HttpMethod.POST, "/trips/$tripId/replan-sessions/$sessionId/revert", token)
        revertRc shouldBe 200
        reverted["status"].asText() shouldBe "APPLIED"
        reverted["revertedAt"].isNull shouldBe false
        reverted["revertible"].asBoolean() shouldBe false
        val now = call(HttpMethod.GET, "/trips/$tripId/itinerary", token).second
        now["status"].asText() shouldBe "CONFIRMED"
        // 동결은 반영 직전의 **같은 스냅숏 행**이다 — 빠졌다 돌아온 곳이 지금 값으로 새로 얼려지지 않았다.
        snapshotsOn(tripId, tomorrow) shouldContainExactly frozenBefore

        // 한 번만 된다. 막힌 되돌리기는 일정을 건드리지 않는다.
        call(HttpMethod.POST, "/trips/$tripId/replan-sessions/$sessionId/revert", token).first shouldBe 409
        snapshotsOn(tripId, tomorrow) shouldContainExactly frozenBefore

        // 이력 — 반영(PLAN_B) 뒤 되돌림(MANUAL). 되돌린 뒤에도 비교는 무엇을 되돌렸는지 그대로 준다.
        val entries = call(HttpMethod.GET, "/trips/$tripId/change-log", token).second["entries"]
        entries.map { it["sourceType"].asText() }.toSet() shouldBe setOf("PLAN_B", "MANUAL")
        entries.single { it["sourceType"].asText() == "MANUAL" }["reason"].asText().startsWith("재계획 되돌림") shouldBe true
        call(HttpMethod.GET, "/trips/$tripId/replan-sessions/$sessionId/diff", token).second["ready"].asBoolean() shouldBe true
    }

    @Test
    fun `되돌린 세션 행은 DB 에서도 되돌리기 지점 없이 존재할 수 없다 — CHECK 가 도메인 규칙과 같다`() {
        val today = LocalDate.now(clock.withZone(kst))
        val created = clock.instant()
        val accountId = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, created)).id.value
        val tripId = trips.save(
            Trip.create(
                accountId = accountId, title = null, startDate = today, endDate = today.plusDays(1),
                party = 1, companionType = null, budgetTotal = null, preferenceSnapshot = emptyMap(),
                destinations = listOf(TripDestination(0, "제주", 1)), now = created,
            ),
        ).tripId.also { mine += it }
        fun insert(status: String, restorePoint: String?) = runCatching {
            jdbc.update(
                "INSERT INTO replan_session (trip_id, itinerary_id, scope, from_instant, origin_kind, status, created_at, closed_at, " +
                    "target_date, restore_point, reverted_at) VALUES (?, ?, 'FULL_DAY', now(), 'STAY_ANCHOR', ?, now(), now(), ?, ?::jsonb, now())",
                tripId, UUID.randomUUID(), status, today, restorePoint,
            )
        }

        insert("APPLIED", null).isFailure shouldBe true // 지점 없이 되돌림
        insert("CANCELED", "{}").isFailure shouldBe true // 반영 안 된 세션의 되돌림
        insert("APPLIED", "{}").isSuccess shouldBe true
    }
}
