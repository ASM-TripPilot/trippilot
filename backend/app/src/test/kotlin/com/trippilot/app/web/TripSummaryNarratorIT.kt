package com.trippilot.app.web

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.archive.application.VisitCheckService
import com.trippilot.archive.domain.CheckSource
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.core.event.EventEnvelope
import com.trippilot.reflection.adapter.`in`.event.TripEndedSubscriber
import com.trippilot.reflection.domain.ReflectionCard
import com.trippilot.reflection.domain.port.ReflectionAgentInput
import com.trippilot.reflection.domain.port.ReflectionAgentPort
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Import
import org.springframework.context.annotation.Primary
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.TestPropertySource
import org.springframework.web.client.RestClient
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.time.Duration
import com.trippilot.reflection.application.TripSummaryNarrator
import com.trippilot.reflection.application.TripSummaryService
import com.trippilot.reflection.domain.TripSummaryRepository
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate

/**
 * 여행이 끝나면 규칙 요약이 먼저 저장되고, 그 뒤 **백그라운드에서** AI 회고 문장이 같은 행에 붙는다(TRIP-1488 · 실 Postgres · 실 배선).
 *
 * 실 배선으로 보는 것: 소유자 조회(구독자는 사용자 맥락이 없다) · 요약 잠금(권고 잠금은 실 DB 에만 있다) · 구독자가 기다리지 않는다 ·
 * 재배달에 AI 를 다시 부르지 않고 붙은 문장을 지킨다. 풀을 커넥션 하나로 줄여 둔다 — AI 를 기다리는 동안 커넥션을 쥐면 그동안 다른 쓰기가 선다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TripSummaryNarratorIT.SummaryAgentConfig::class)
@TestPropertySource(
    properties = [
        "spring.datasource.hikari.maximum-pool-size=1",
        "spring.datasource.hikari.minimum-idle=1",
        "spring.datasource.hikari.connection-timeout=2000",
    ],
)
class TripSummaryNarratorIT : AbstractPostgresIntegrationTest() {

    /** 여행 요약에만 카드를 준다. 하루 회고는 null(규칙 카드). 받은 입력을 남긴다. [gate] 가 있으면 열릴 때까지 답하지 않는다(AI 대기 흉내). */
    class SummaryAgent : ReflectionAgentPort {
        val sent = CopyOnWriteArrayList<ReflectionAgentInput>()
        @Volatile var gate: CountDownLatch? = null
        val waiting = CountDownLatch(1)
        override val enabled = true
        override val summaryCallTimeout: Duration = Duration.ofMinutes(10)
        override fun generate(input: ReflectionAgentInput): ReflectionCard? {
            sent += input
            if (input.kind != ReflectionAgentInput.KIND_TRIP_SUMMARY) return null
            gate?.let { waiting.countDown(); it.await(30, TimeUnit.SECONDS) }
            val payload = """{"template_id":"ai.summary.v1","kind":"TRIP_SUMMARY","format":"CARD","is_fallback":false,
                "cover":{"title":"제주 이틀","subtitle":"바다를 따라 함께 걸었다."},"scenes":[{"caption":"성산일출봉"}]}"""
            return ReflectionCard("ai.summary.v1", "CARD", "제주 이틀", "바다를 따라 함께 걸었다.", payload)
        }
    }

    @TestConfiguration
    class SummaryAgentConfig {
        @Bean @Primary fun summaryAgent(): SummaryAgent = SummaryAgent()
    }

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var visits: VisitCheckService
    @Autowired private lateinit var subscriber: TripEndedSubscriber
    @Autowired private lateinit var agent: SummaryAgent
    @Autowired private lateinit var jdbc: JdbcTemplate
    @Autowired private lateinit var summaryService: TripSummaryService
    @Autowired private lateinit var narrator: TripSummaryNarrator
    @Autowired private lateinit var summaries: TripSummaryRepository
    @Autowired private lateinit var txManager: PlatformTransactionManager

    private val json = ObjectMapper()
    private val day1 = LocalDate.parse("2026-08-01")

    private fun poi(name: String): UUID = UUID.randomUUID().also {
        jdbc.update(
            "INSERT INTO poi (poi_id, name_ko, lat, lng, category, data_status, source, created_at, updated_at) " +
                "VALUES (?, ?, 33.46, 126.94, '자연', 'ACTIVE', 'MANUAL', now(), now())",
            it, name,
        )
    }

    private fun pinToDay1(visitCheckId: UUID) {
        val at = java.sql.Timestamp.from(Instant.parse("2026-08-01T03:00:00Z"))
        jdbc.update("UPDATE visit_check SET created_at = ? WHERE visit_check_id = ?", at, visitCheckId) shouldBe 1
        jdbc.update("UPDATE visit_check SET arrived_at = ? WHERE visit_check_id = ? AND arrived_at IS NOT NULL", at, visitCheckId)
    }

    private fun summaryRow(tripId: UUID): Pair<String, String>? = jdbc.query(
        "SELECT narrative, source FROM trip_summary WHERE trip_id = ?", { rs, _ -> rs.getString(1) to rs.getString(2) }, tripId,
    ).firstOrNull()

    private fun ended(tripId: UUID) = EventEnvelope(
        UUID.randomUUID(), "trip.TripEnded", 1, "Trip", tripId.toString(), null, Instant.now(),
        """{"tripId":"$tripId","endedAt":"2026-08-02T15:00:00Z"}""",
    )

    private fun awaitSource(tripId: UUID, source: String) {
        val until = System.nanoTime() + 15_000_000_000L
        while (summaryRow(tripId)?.second != source && System.nanoTime() < until) Thread.sleep(100)
    }

    /** 제주 1박 여행 — 하나는 다녀오고 하나는 건너뛰었다. */
    private fun tripWithVisits(): UUID {
        val accountId = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, Instant.parse("2026-08-01T00:00:00Z"))).id.value
        val token = accessTokenIssuer.issue(accountId.toString()).value
        val created = RestClient.builder().baseUrl("http://localhost:$port").build()
            .method(HttpMethod.POST).uri("/api/v1/trips")
            .header("Authorization", "Bearer $token")
            .contentType(MediaType.APPLICATION_JSON)
            .body(
                """{"startDate":"$day1","endDate":"${day1.plusDays(1)}","party":2,
                    "destinations":[{"seq":0,"region":"제주","nights":1}],"preferenceSnapshot":{"styles":["미식"]}}""".trimIndent(),
            )
            .retrieve().body(String::class.java)
        val tripId = UUID.fromString(json.readTree(created)["tripId"].asText())
        val went = poi("성산일출봉")
        val missed = poi("우도")
        visits.arrive(accountId, tripId, "$day1#$went", went, CheckSource.MANUAL).also {
            visits.complete(accountId, tripId, it.visitCheckId)
            pinToDay1(it.visitCheckId)
        }
        pinToDay1(visits.skipPlanned(accountId, tripId, "$day1#$missed", missed).visitCheckId)
        return tripId
    }

    @Test
    fun `여행이 끝나면 규칙 요약이 먼저 서고, 뒤이어 AI 회고 문장이 붙는다 — 재배달은 다시 부르지 않고 문장을 지킨다`() {
        agent.sent.clear() // 같은 빈을 두 테스트가 쓴다
        val tripId = tripWithVisits()
        val gate = CountDownLatch(1).also { agent.gate = it }
        try {
            subscriber.handle(ended(tripId))
            // 구독자는 AI 를 기다리지 않는다 — 돌아온 순간 규칙 요약이 서 있다.
            summaryRow(tripId)?.second shouldBe "RULE"

            // AI 를 기다리는 동안 커넥션을 쥐지 않는다 — 풀이 하나뿐인데 그 사이 다른 읽기·쓰기가 연결 대기(2초) 안에 끝난다.
            agent.waiting.await(10, TimeUnit.SECONDS) shouldBe true
            val started = System.nanoTime()
            jdbc.queryForObject("SELECT ai_attempts FROM trip_summary WHERE trip_id = ?", Int::class.java, tripId) shouldBe 1
            jdbc.update("UPDATE trip_summary SET generated_at = generated_at WHERE trip_id = ?", tripId) shouldBe 1
            (System.nanoTime() - started < 1_500_000_000L) shouldBe true
        } finally {
            gate.countDown()
            agent.gate = null
        }

        awaitSource(tripId, "AI")
        summaryRow(tripId) shouldBe ("바다를 따라 함께 걸었다." to "AI")
        val input = agent.sent.single { it.kind == ReflectionAgentInput.KIND_TRIP_SUMMARY }
        input.region shouldBe "제주"
        input.personaSummary shouldBe "여행 스타일 미식"
        input.visits.map { it.poiName } shouldBe listOf("성산일출봉")
        input.events.map { it.kind } shouldBe listOf("SKIPPED")

        // 재배달(at-least-once) — 붙은 문장을 규칙 문장으로 되돌리지 않고, AI 를 다시 부르지 않는다.
        subscriber.handle(ended(tripId))
        Thread.sleep(1_000)
        summaryRow(tripId) shouldBe ("바다를 따라 함께 걸었다." to "AI")
        agent.sent.count { it.kind == ReflectionAgentInput.KIND_TRIP_SUMMARY } shouldBe 1
        // "요약이 준비됐어요"는 처음 만들 때 한 번뿐이다 — 문장이 붙어도, 재배달이 와도 다시 내지 않는다.
        jdbc.queryForObject(
            "SELECT count(*) FROM outbox_event WHERE event_type = 'reflection.ReflectionReady' AND aggregate_id = ?", Int::class.java, tripId.toString(),
        ) shouldBe 1
    }

    /** 시도 선점과 스윕 조회의 실 SQL(V2.84) — 대역은 같은 조건을 흉내 낼 뿐이라 쿼리 자체는 여기서 본다. */
    @Test
    fun `시도 선점은 한 번만 이기고, 스윕은 상한·최근 시도·창·출처를 지켜 집고, 집은 회고를 붙인다`() {
        agent.sent.clear()
        val tripId = tripWithVisits()
        summaryService.generate(tripId) // 구독자 없이 규칙 요약만 — AI 는 아직 안 맡겼다
        val tx = TransactionTemplate(txManager)
        val reclaim = Duration.ofMinutes(10)
        fun pending() = summaries.findAiPending(Duration.ofDays(7), reclaim, 3, 100).contains(tripId)
        fun claim() = tx.execute { summaries.claimAiAttempt(tripId, reclaim, 3) }

        pending() shouldBe true
        claim() shouldBe 1
        claim() shouldBe null // 진행 중일 수 있는 시도 — 다른 파드도 못 가져간다
        pending() shouldBe false
        // 시각은 DB 시계로 찍힌다 — 앱 시계가 아니라 DB now() 기준으로 늙힌다.
        jdbc.queryForObject("SELECT ai_attempted_at > now() - interval '1 minute' FROM trip_summary WHERE trip_id = ?", Boolean::class.java, tripId) shouldBe true
        jdbc.update("UPDATE trip_summary SET ai_attempted_at = now() - interval '9 minutes' WHERE trip_id = ?", tripId)
        (pending() to claim()) shouldBe (false to null) // 다시 선점 기준(10분) 안
        jdbc.update("UPDATE trip_summary SET ai_attempted_at = now() - interval '11 minutes' WHERE trip_id = ?", tripId)
        pending() shouldBe true
        claim() shouldBe 2
        jdbc.update("UPDATE trip_summary SET ai_attempts = 3, ai_attempted_at = NULL WHERE trip_id = ?", tripId)
        (pending() to claim()) shouldBe (false to null) // 상한
        jdbc.update("UPDATE trip_summary SET ai_attempts = 0, generated_at = now() - interval '8 days' WHERE trip_id = ?", tripId)
        pending() shouldBe false // 창 밖
        jdbc.update("UPDATE trip_summary SET generated_at = now() WHERE trip_id = ?", tripId)
        tx.executeWithoutResult { summaries.retireAiAttempts(tripId, 3) }
        pending() shouldBe false // 더 할 것이 없는 여행
        // 요약을 다시 덮어도(재배달·경로 갱신) 시도 기록은 지워지지 않는다 — 엔티티가 그 칸을 매핑하지 않는다.
        summaryService.generate(tripId)
        jdbc.queryForObject("SELECT ai_attempts FROM trip_summary WHERE trip_id = ?", Int::class.java, tripId) shouldBe 3

        // 스윕이 실제로 집어 붙인다.
        jdbc.update("UPDATE trip_summary SET ai_attempts = 0, ai_attempted_at = NULL WHERE trip_id = ?", tripId)
        narrator.sweep()
        awaitSource(tripId, "AI")
        summaryRow(tripId) shouldBe ("바다를 따라 함께 걸었다." to "AI")
        jdbc.update("UPDATE trip_summary SET ai_attempts = 0 WHERE trip_id = ?", tripId)
        pending() shouldBe false // 이미 AI
    }
}
