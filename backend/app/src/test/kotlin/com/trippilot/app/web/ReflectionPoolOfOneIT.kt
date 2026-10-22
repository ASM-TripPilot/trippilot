package com.trippilot.app.web

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.archive.application.VisitCheckService
import com.trippilot.archive.domain.CheckSource
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.changelog.api.AppendChangeLog
import com.trippilot.changelog.api.ChangeLogFacade
import com.trippilot.changelog.api.ChangeSourceType
import com.trippilot.changelog.api.DaySnapshotView
import com.trippilot.changelog.api.ItinerarySnapshotView
import com.trippilot.changelog.api.SlotSnapshotView
import com.trippilot.reflection.application.ReflectionService
import com.trippilot.reflection.domain.ReflectionCard
import com.trippilot.reflection.domain.port.ReflectionAgentInput
import com.trippilot.reflection.domain.port.ReflectionAgentPort
import com.trippilot.reflection.domain.port.ReflectionEvent
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
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.web.client.RestClient
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * **커넥션 하나로도** 하루 회고가 재료를 채워 만들어진다(TRIP-1463 · 실 Postgres · 실 퍼사드).
 *
 * 재료 조회(취향·변경 이력)를 쓰기 트랜잭션 **안에서** 따로 연 트랜잭션(`REQUIRES_NEW`)으로 돌리면 생성 한 번이 커넥션 둘을 쥔다 —
 * 풀(운영 기본 10)보다 많은 생성이 겹치면 서로가 쥔 바깥 커넥션 때문에 안쪽이 커넥션을 못 얻어 시한(기본 30초)까지 서고, 재료는 조용히 빈다.
 * 풀을 1 로 줄이면 그 모양이 곧바로 드러난다(재현: 두 조회가 `CannotCreateTransactionException` 으로 실패하고 재료가 빈다).
 * 재료와 AI 호출을 쓰기 트랜잭션 밖에서 하면 한 번에 커넥션 하나만 쓴다.
 *
 * AI 는 입력을 받아 두는 대역이다 — 실릴 재료를 그대로 본다(응답은 null → 규칙 카드).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(ReflectionPoolOfOneIT.CapturingAgentConfig::class)
@TestPropertySource(
    properties = [
        "spring.datasource.hikari.maximum-pool-size=1",
        "spring.datasource.hikari.minimum-idle=1",
        "spring.datasource.hikari.connection-timeout=2000",
    ],
)
class ReflectionPoolOfOneIT : AbstractPostgresIntegrationTest() {

    class CapturingAgent : ReflectionAgentPort {
        @Volatile var sent: ReflectionAgentInput? = null
        override val enabled = true
        override fun generate(input: ReflectionAgentInput): ReflectionCard? = null.also { sent = input }
    }

    @TestConfiguration
    class CapturingAgentConfig {
        @Bean @Primary fun capturingAgent(): CapturingAgent = CapturingAgent()
    }

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var reflections: ReflectionService
    @Autowired private lateinit var visits: VisitCheckService
    @Autowired private lateinit var changeLogs: ChangeLogFacade
    @Autowired private lateinit var agent: CapturingAgent
    @Autowired private lateinit var txManager: PlatformTransactionManager
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

    /** 방문의 날은 도착 시각(없으면 만든 시각, KST)으로 갈린다 — 실행하는 오늘이 아니라 그 여행의 첫날에 둔다. */
    private fun pinToDay1(visitCheckId: UUID) {
        val at = java.sql.Timestamp.from(Instant.parse("2026-08-01T03:00:00Z"))
        jdbc.update("UPDATE visit_check SET created_at = ? WHERE visit_check_id = ?", at, visitCheckId) shouldBe 1
        jdbc.update("UPDATE visit_check SET arrived_at = ? WHERE visit_check_id = ? AND arrived_at IS NOT NULL", at, visitCheckId)
    }

    @Test
    fun `풀이 커넥션 하나여도 하루 회고가 만들어지고 취향·변경 이력 재료가 채워진다`() {
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
        // 그날 칸을 바꾼 적용된 재계획 한 건 — 변경 이력 조회가 실제로 돌아야 PLAN_B 사건이 실린다.
        fun day(poi: UUID) = ItinerarySnapshotView(listOf(DaySnapshotView(day1, listOf(SlotSnapshotView(poi, LocalTime.NOON, LocalTime.of(13, 0), false, false)))))
        TransactionTemplate(txManager).executeWithoutResult {
            changeLogs.append(AppendChangeLog(tripId, accountId.toString(), ChangeSourceType.PLAN_B, "자동 감지 · 비", day(missed), day(went)))
        }

        val saved = reflections.generateDaily(accountId, tripId, day1)

        val input = agent.sent!!
        input.region shouldBe "제주"
        input.personaSummary shouldBe "여행 스타일 미식"
        input.events shouldBe listOf(
            ReflectionEvent(ReflectionEvent.SKIPPED, day1, "계획한 곳 중 1곳을 들르지 못했다"),
            ReflectionEvent(ReflectionEvent.PLAN_B, day1, "상황 변화를 감지해 일정을 바꿨다"),
        )
        jdbc.queryForObject(
            "SELECT source FROM reflection WHERE trip_id = ? AND day_date = ?", String::class.java, tripId, day1,
        ) shouldBe saved.source.name
    }
}
