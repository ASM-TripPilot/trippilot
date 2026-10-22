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
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.web.client.RestClient
import java.time.Clock
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * 원탭 [다시 짜기] 적용 뒤 — 빠진 곳 보기와 확정 일정 되돌리기(TRIP-1412) 관통.
 *
 * 여기서만 보이는 것: 반영 순간 떠 둔 기준·되돌리기 지점이 **실제 jsonb 를 왕복**하고(새 칸 V2.82), 되돌린 날이 확정 동결
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
    @Autowired private lateinit var transactions: PlatformTransactionManager

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

    private fun snapshotsOn(tripId: UUID, date: LocalDate): List<Pair<UUID, UUID?>> = slotRows(tripId, date).map { it[0] as UUID to it[1] as UUID? }

    /** 그 날 슬롯의 저장값 — (장소, 동결, 위반, 위반 사유, 거리 문구, 추천 이유). 되돌린 날이 반영 전과 칸마다 같은지 본다. */
    private fun slotRows(tripId: UUID, date: LocalDate): List<List<Any?>> = jdbc.query(
        """
        SELECT s.source_poi_id, s.poi_snapshot_id, s.has_violation, s.violation_reason, s.distance_range, s.placement_reason
          FROM visit_slot s
          JOIN itinerary_day d ON d.itinerary_day_id = s.itinerary_day_id
          JOIN itinerary i ON i.itinerary_id = d.itinerary_id
         WHERE i.trip_id = ? AND d.day_date = ? ORDER BY s.order_index
        """.trimIndent(),
        { rs, _ ->
            listOf(
                rs.getObject(1, UUID::class.java), rs.getObject(2, UUID::class.java), rs.getBoolean(3),
                rs.getString(4), rs.getString(5), rs.getString(6),
            )
        },
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

    /** 확정 일정 + 반영된 원탭 재계획(내일 하루 전체 — 실 시계와 무관한 날). 빠지는 곳에는 위반 표시·사유·거리·추천 이유를 단다. */
    private class Applied(
        val tripId: UUID, val token: String, val sessionId: String, val tomorrow: LocalDate,
        val kept: UUID, val dropped: UUID, val added: UUID, val frozenBefore: List<Pair<UUID, UUID?>>, val rowsBefore: List<List<Any?>>,
    )

    private class Drafted(
        val tripId: UUID, val token: String, val sessionId: String, val tomorrow: LocalDate,
        val kept: UUID, val dropped: UUID, val added: UUID, val frozenBefore: List<Pair<UUID, UUID?>>, val rowsBefore: List<List<Any?>>,
    )

    private fun appliedReplan(): Applied {
        val d = draftedReplan()
        val (applyRc, applied) = call(HttpMethod.POST, "/trips/${d.tripId}/replan-sessions/${d.sessionId}/apply", d.token)
        applyRc shouldBe 200
        applied["revertible"].asBoolean() shouldBe true
        snapshotsOn(d.tripId, d.tomorrow).map { it.first } shouldContainExactly listOf(d.kept, d.added)
        return Applied(d.tripId, d.token, d.sessionId, d.tomorrow, d.kept, d.dropped, d.added, d.frozenBefore, d.rowsBefore)
    }

    /** [appliedReplan] 의 반영 직전까지 — 세션이 DRAFT 에 있다. */
    private fun draftedReplan(): Drafted {
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
                            VisitSlot.of(
                                dropped, null, 1, LocalTime.of(14, 0), LocalTime.of(15, 0),
                                hasViolation = true, violationReason = "영업시간 밖이에요",
                                distanceRange = "약 2.3km · 도보 추정", placementReason = "노을이 좋은 곳",
                            ),
                        ),
                    ),
                ),
                now = created,
            ),
        )
        // 여행 중 일정은 대개 확정이다 — 실 확정 경로로 동결한다.
        call(HttpMethod.POST, "/trips/$tripId/itinerary/confirm", token).first shouldBe 200
        val frozenBefore = snapshotsOn(tripId, tomorrow)
        val rowsBefore = slotRows(tripId, tomorrow)
        rowsBefore[1].drop(2) shouldContainExactly listOf(true, "영업시간 밖이에요", "약 2.3km · 도보 추정", "노을이 좋은 곳")
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
        return Drafted(tripId, token, sessionId, tomorrow, kept, dropped, added, frozenBefore, rowsBefore)
    }

    /**
     * 다른 트랜잭션이 일정 행 잠금을 쥔 채 내일 시각을 30분 미루고 멈춘다 — [action] 이 그 잠금을 **기다리는 것**을 DB 로 확인한 뒤 풀어 준다.
     * 상대 쓰기는 실 저장소의 교체(`replaceForTrip` — 편집·복원·반영·되돌리기가 쓰는 같은 PK 지우고 다시 넣기)다.
     */
    private fun <T> behindLockedReplace(tripId: UUID, date: LocalDate, action: () -> T): T {
        val locked = CountDownLatch(1)
        val release = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(2)
        try {
            val writer = pool.submit {
                TransactionTemplate(transactions).executeWithoutResult {
                    val current = itineraries.lockForTrip(tripId)!!
                    val edited = Itinerary.reconstitute(
                        current.itineraryId, current.tripId, current.status, current.solveMode, current.generationMode,
                        current.isFallback, current.generationState,
                        current.days.map { d ->
                            if (d.date != date) d
                            else ItineraryDay.of(d.date, d.dayOrder, d.slots.map { s -> VisitSlot.of(s.sourcePoiId, s.poiSnapshotId, s.orderIndex, s.startAt.plusMinutes(30), s.endAt.plusMinutes(30)) })
                        },
                        current.createdAt, clock.instant(), current.candidatesSummary, current.unplacedMustVisits,
                    )
                    itineraries.replaceForTrip(tripId, edited)
                    locked.countDown()
                    check(release.await(20, TimeUnit.SECONDS)) { "해제되지 않았습니다." }
                }
            }
            check(locked.await(20, TimeUnit.SECONDS)) { "교체가 잠금을 잡지 못했습니다." }
            val result = pool.submit<T> { action() }
            awaitLockWaiter()
            release.countDown()
            writer.get(20, TimeUnit.SECONDS)
            return result.get(20, TimeUnit.SECONDS)
        } finally {
            release.countDown()
            pool.shutdownNow()
        }
    }

    private fun firstStart(tripId: UUID, date: LocalDate): String = jdbc.queryForObject(
        "SELECT min(s.start_at)::text FROM visit_slot s JOIN itinerary_day d ON d.itinerary_day_id = s.itinerary_day_id " +
            "JOIN itinerary i ON i.itinerary_id = d.itinerary_id WHERE i.trip_id = ? AND d.day_date = ?",
        String::class.java, tripId, date,
    )!!

    @Test
    fun `확정 일정에 원탭 재계획을 적용하면 빠진 곳을 보여 주고, 되돌리면 그 날이 같은 동결 참조로 돌아온다`() {
        val a = appliedReplan()
        val tripId = a.tripId
        val token = a.token
        val sessionId = a.sessionId
        val tomorrow = a.tomorrow
        val dropped = a.dropped
        val frozenBefore = a.frozenBefore
        val rowsBefore = a.rowsBefore

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
        // 위반 배지·사유·거리 문구·추천 이유도 jsonb 를 거쳐 그대로 돌아왔다.
        slotRows(tripId, tomorrow) shouldContainExactly rowsBefore

        // 한 번만 된다. 막힌 되돌리기는 일정을 건드리지 않는다.
        call(HttpMethod.POST, "/trips/$tripId/replan-sessions/$sessionId/revert", token).first shouldBe 409
        snapshotsOn(tripId, tomorrow) shouldContainExactly frozenBefore

        // 이력 — 반영(PLAN_B) 뒤 되돌림(MANUAL). 되돌린 뒤에도 비교는 무엇을 되돌렸는지 그대로 준다.
        val entries = call(HttpMethod.GET, "/trips/$tripId/change-log", token).second["entries"]
        entries.map { it["sourceType"].asText() }.toSet() shouldBe setOf("PLAN_B", "MANUAL")
        entries.single { it["sourceType"].asText() == "MANUAL" }["reason"].asText().startsWith("재계획 되돌림") shouldBe true
        call(HttpMethod.GET, "/trips/$tripId/replan-sessions/$sessionId/diff", token).second["ready"].asBoolean() shouldBe true
    }

    /**
     * 되돌리기와 다른 교체가 겹치면 — 되돌리기는 일정 행 잠금을 기다렸다가 **잠금 뒤의 일정**으로 판정한다. 먼저 커밋된 교체가
     * 그 날을 바꿨으면 409 `STALE` 이고, 세션에 되돌린 시각이 찍히지 않으며, 그 교체는 지워지지 않는다(조용히 잃지 않는다).
     * 상대는 실 저장소의 교체(`replaceForTrip` — 편집·재생성·복원·반영이 모두 쓰는 쓰기)를 잠금을 쥔 채 커밋 직전에 멈춰 둔 것이다.
     */
    @Test
    fun `되돌리기는 다른 교체가 쥔 일정 행 잠금을 기다리고, 그 교체가 날을 바꿨으면 STALE 로 물러난다`() {
        val a = appliedReplan()

        val (rc, body) = behindLockedReplace(a.tripId, a.tomorrow) {
            call(HttpMethod.POST, "/trips/${a.tripId}/replan-sessions/${a.sessionId}/revert", a.token)
        }

        rc shouldBe 409
        body["error"]["code"].asText() shouldBe "STALE"
        call(HttpMethod.GET, "/trips/${a.tripId}/replan-sessions/${a.sessionId}", a.token).second["revertedAt"].isNull shouldBe true
        // 먼저 커밋된 교체가 그대로다 — 되돌리기가 덮지 않았다.
        firstStart(a.tripId, a.tomorrow) shouldBe "10:30:00"
    }

    /**
     * 반영이 다른 교체 뒤에서 기다리면 — 상대 커밋은 같은 PK 를 지우고 다시 넣어 READ COMMITTED 의 첫 `FOR UPDATE` 가 0행을 본다.
     * 잠금이 새 문장으로 다시 물어 새 행을 잡아야 반영이 "일정이 없습니다"(404)가 아니라 정상 반영된다. 그리고 반영 직전 비교 기준·되돌리기
     * 지점은 **잠금 뒤** 일정(상대가 미룬 10:30)으로 떠져야 한다 — 잠금 전에 뜨면 기준이 실제로 덮은 일정과 어긋난다.
     */
    @Test
    fun `반영은 다른 교체가 쥔 잠금을 기다린 뒤 새 행을 잡아 반영하고, 비교 기준을 잠금 뒤 일정으로 뜬다`() {
        val d = draftedReplan()

        val (rc, _) = behindLockedReplace(d.tripId, d.tomorrow) {
            call(HttpMethod.POST, "/trips/${d.tripId}/replan-sessions/${d.sessionId}/apply", d.token)
        }

        rc shouldBe 200
        val diff = call(HttpMethod.GET, "/trips/${d.tripId}/replan-sessions/${d.sessionId}/diff", d.token).second
        diff["before"].map { it["startAt"].asText() } shouldContainExactly listOf("10:30:00", "14:30:00")
        // 되돌리기 지점도 같은 일정이다 — 되돌리면 상대가 미룬 시각으로 돌아온다.
        call(HttpMethod.POST, "/trips/${d.tripId}/replan-sessions/${d.sessionId}/revert", d.token).first shouldBe 200
        firstStart(d.tripId, d.tomorrow) shouldBe "10:30:00"
    }

    /** 같은 트랜잭션이 먼저 읽어 둔 일정(관리 중 엔티티)이 있어도, 잠금 뒤 읽기는 그 사이 커밋된 값이다(JPA 는 쿼리로 덮지 않는다). */
    @Test
    fun `잠금 읽기는 같은 트랜잭션이 먼저 읽어 둔 낡은 엔티티 대신 잠금 뒤 값을 준다`() {
        val d = draftedReplan()
        val pool = Executors.newSingleThreadExecutor()
        try {
            val status = TransactionTemplate(transactions).execute {
                itineraries.findByTrip(d.tripId).single().status.name shouldBe "CONFIRMED" // 엔티티가 이 트랜잭션에 들어온다
                pool.submit { jdbc.update("UPDATE itinerary SET status = 'PLANNED' WHERE trip_id = ?", d.tripId) }.get(20, TimeUnit.SECONDS)
                itineraries.lockForTrip(d.tripId)!!.status.name
            }
            status shouldBe "PLANNED"
        } finally {
            pool.shutdownNow()
        }
    }

    /** 되돌리기 요청이 행 잠금을 **실제로 기다리는 중**인지 — 고정 sleep 대신 DB 가 말하는 대기 상태로 본다. */
    private fun awaitLockWaiter() {
        val deadline = System.nanoTime() + java.time.Duration.ofSeconds(20).toNanos()
        while (System.nanoTime() < deadline) {
            val waiting = jdbc.queryForObject(
                "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE '%itinerary%for%'",
                Int::class.java,
            )!!
            if (waiting > 0) return
            Thread.sleep(20)
        }
        error("되돌리기가 일정 행 잠금을 기다리지 않았습니다.")
    }

    /** 비교 기준 칸이 깨진 행도 세션 조회를 500 으로 막지 않는다 — 기준 없이 읽혀 비교만 ready=false 가 된다. */
    @Test
    fun `깨진 applied_before 는 세션 조회를 막지 않고 비교만 ready=false 로 둔다`() {
        val a = appliedReplan()
        jdbc.update("UPDATE replan_session SET applied_before = '[{\"slotKey\": 1}]'::jsonb WHERE session_id = ?::uuid", a.sessionId)

        val (rc, session) = call(HttpMethod.GET, "/trips/${a.tripId}/replan-sessions/${a.sessionId}", a.token)
        rc shouldBe 200
        session["status"].asText() shouldBe "APPLIED"
        call(HttpMethod.GET, "/trips/${a.tripId}/replan-sessions/${a.sessionId}/diff", a.token).second["ready"].asBoolean() shouldBe false
    }

    @Test
    fun `맨 위 모양이 틀린 applied_before 도 세션 조회를 막지 않는다`() {
        val a = appliedReplan()
        jdbc.update("UPDATE replan_session SET applied_before = '{}'::jsonb WHERE session_id = ?::uuid", a.sessionId)

        call(HttpMethod.GET, "/trips/${a.tripId}/replan-sessions/${a.sessionId}", a.token).first shouldBe 200
        call(HttpMethod.GET, "/trips/${a.tripId}/replan-sessions/${a.sessionId}/diff", a.token).second["ready"].asBoolean() shouldBe false
    }

    @Test
    fun `맨 위 모양이 틀린 restore_point 는 세션 조회를 막지 않고 되돌리기만 409 로 막는다`() {
        val a = appliedReplan()
        jdbc.update("UPDATE replan_session SET restore_point = '[]'::jsonb WHERE session_id = ?::uuid", a.sessionId)

        val (rc, session) = call(HttpMethod.GET, "/trips/${a.tripId}/replan-sessions/${a.sessionId}", a.token)
        rc shouldBe 200
        session["revertible"].asBoolean() shouldBe false
        call(HttpMethod.POST, "/trips/${a.tripId}/replan-sessions/${a.sessionId}/revert", a.token).first shouldBe 409
        slotRows(a.tripId, a.tomorrow).map { it[0] } shouldContainExactly listOf(a.kept, a.added) // 일정은 그대로
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
