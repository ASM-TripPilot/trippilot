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

    /** 여행 요약에만 카드를 준다. 하루 회고는 null(규칙 카드). 받은 입력을 남긴다. */
    class SummaryAgent : ReflectionAgentPort {
        val sent = CopyOnWriteArrayList<ReflectionAgentInput>()
        override val enabled = true
        override fun generate(input: ReflectionAgentInput): ReflectionCard? {
            sent += input
            if (input.kind != ReflectionAgentInput.KIND_TRIP_SUMMARY) return null
            Thread.sleep(300) // 구독자가 이 호출을 기다리지 않는다는 것을 보이려고 조금 걸린다
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

    @Test
    fun `여행이 끝나면 규칙 요약이 먼저 서고, 뒤이어 AI 회고 문장이 붙는다 — 재배달은 다시 부르지 않고 문장을 지킨다`() {
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

        subscriber.handle(ended(tripId))
        // 구독자는 AI 를 기다리지 않는다 — 돌아온 순간 규칙 요약이 서 있다.
        summaryRow(tripId)?.second shouldBe "RULE"

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
}
