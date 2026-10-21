package com.trippilot.app.web

import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.archive.application.VisitCheckService
import com.trippilot.archive.domain.CheckSource
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.changelog.api.AppendChangeLog
import com.trippilot.changelog.api.ChangeLogEntryView
import com.trippilot.changelog.api.ChangeLogFacade
import com.trippilot.profile.api.PreferenceFacade
import com.trippilot.profile.api.PreferenceSnapshot
import com.trippilot.reflection.application.ReflectionMaterials
import com.trippilot.reflection.application.ReflectionService
import com.trippilot.reflection.domain.ReflectionSource
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.slf4j.LoggerFactory
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
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.client.RestClient
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 회고 재료 조회가 실패해도 **하루 회고가 저장된다**(TRIP-1463 · 실 Postgres).
 *
 * 재료(취향·변경 이력)는 회고 생성의 쓰기 트랜잭션을 **열기 전에** 구한다. 그 조회가 쓰기 트랜잭션에 참여한 채 실패하면 `runCatching` 으로
 * 잡아도 바깥 트랜잭션이 rollback-only 가 되고(PG 는 SQL 오류 뒤 그 트랜잭션의 문장을 전부 거절한다) 커밋에서 회고까지 사라진다 — 재료 조회를
 * 쓰기 트랜잭션 안으로 옮기면 이 테스트가 `current transaction is aborted` 로 빨개진다(역검증).
 * 대역 단위 테스트로는 원리적으로 안 보인다 — 트랜잭션도 PG 도 없다. 그래서 두 퍼사드를 **실제로 SQL 오류를 내는 트랜잭션 빈**으로 갈아 끼우고
 * 진짜 생성 경로를 태운다.
 *
 * AI 는 http 모드로 켜되 닿지 않는 주소를 준다 — 재료를 구하는 갈래까지 가야 하고(꺼져 있으면 재료를 안 구한다), 응답은 필요 없다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(ReflectionMaterialsIsolationIT.FailingLookups::class)
@TestPropertySource(
    properties = [
        "trippilot.ai.reflection.mode=http",
        "trippilot.ai.reflection.base-url=http://127.0.0.1:9",
        "trippilot.ai.reflection.connect-timeout-ms=500",
    ],
)
class ReflectionMaterialsIsolationIT : AbstractPostgresIntegrationTest() {

    /** 참여한 트랜잭션 안에서 SQL 오류를 낸다 — 실제 퍼사드 구현(`@Transactional(readOnly)` · JPA 조회)이 실패하는 모양 그대로다. */
    open class FailingPreferences(private val jdbc: JdbcTemplate) : PreferenceFacade {
        @Transactional(readOnly = true)
        override fun findPreferences(accountId: UUID): PreferenceSnapshot {
            jdbc.queryForObject("SELECT 1 / 0", Int::class.java)
            error("도달하지 않는다")
        }
    }

    open class FailingChangeLog(private val jdbc: JdbcTemplate) : ChangeLogFacade {
        override fun append(command: AppendChangeLog) = Unit

        @Transactional(readOnly = true)
        override fun findTimeline(accountId: UUID, tripId: UUID, limit: Int): List<ChangeLogEntryView> {
            jdbc.queryForObject("SELECT 1 / 0", Int::class.java)
            error("도달하지 않는다")
        }
    }

    @TestConfiguration
    class FailingLookups {
        @Bean @Primary fun failingPreferences(jdbc: JdbcTemplate): PreferenceFacade = FailingPreferences(jdbc)
        @Bean @Primary fun failingChangeLog(jdbc: JdbcTemplate): ChangeLogFacade = FailingChangeLog(jdbc)
    }

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var reflections: ReflectionService
    @Autowired private lateinit var visits: VisitCheckService
    @Autowired private lateinit var jdbc: JdbcTemplate

    private val json = ObjectMapper()
    private val day1 = LocalDate.parse("2026-08-01")

    @Test
    fun `취향·변경 이력 조회가 SQL 오류로 실패해도 하루 회고가 커밋된다 — 실패는 그 조회 안에서 끝난다`() {
        val account = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, Instant.parse("2026-08-01T00:00:00Z")))
        val accountId = account.id.value
        val token = accessTokenIssuer.issue(accountId.toString()).value
        val created = RestClient.builder().baseUrl("http://localhost:$port").build()
            .method(HttpMethod.POST).uri("/api/v1/trips")
            .header("Authorization", "Bearer $token")
            .contentType(MediaType.APPLICATION_JSON)
            .body(
                """{"startDate":"$day1","endDate":"${day1.plusDays(1)}","party":2,
                    "destinations":[{"seq":0,"region":"제주","nights":1}],"preferenceSnapshot":{}}""".trimIndent(),
            )
            .retrieve().body(String::class.java)
        val tripId = UUID.fromString(json.readTree(created)["tripId"].asText())
        // AI 에 실을 방문이 하나 있어야 재료를 구한다(ReflectionAgentInput.callable).
        val poi = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO poi (poi_id, name_ko, lat, lng, category, data_status, source, created_at, updated_at) " +
                "VALUES (?, '성산일출봉', 33.46, 126.94, '자연', 'ACTIVE', 'MANUAL', now(), now())",
            poi,
        )
        val arrived = visits.arrive(accountId, tripId, "$day1#$poi", poi, CheckSource.MANUAL)
        visits.complete(accountId, tripId, arrived.visitCheckId)
        // 방문의 날은 도착 시각(KST)으로 갈린다 — 실행하는 오늘이 아니라 그 여행의 첫날에 둔다.
        jdbc.update(
            "UPDATE visit_check SET arrived_at = ?, completed_at = ? WHERE visit_check_id = ?",
            java.sql.Timestamp.from(Instant.parse("2026-08-01T03:00:00Z")), java.sql.Timestamp.from(Instant.parse("2026-08-01T04:00:00Z")),
            arrived.visitCheckId,
        ) shouldBe 1

        val appender = ListAppender<ILoggingEvent>().apply { start() }
        val logger = LoggerFactory.getLogger(ReflectionMaterials::class.java) as Logger
        logger.addAppender(appender)
        val saved = try {
            reflections.generateDaily(accountId, tripId, day1)
        } finally {
            logger.detachAppender(appender)
        }

        // 두 조회가 실제로 돌았고 실패했다 — 재료 갈래를 건너뛴 초록이 아니다.
        val warns = appender.list.filter { it.level == Level.WARN }.map { it.formattedMessage }
        warns.count { it.startsWith("회고 성향 재료를 읽지 못해") } shouldBe 1
        warns.count { it.startsWith("회고 재계획 재료를 읽지 못해") } shouldBe 1
        // AI 는 닿지 않으니 규칙 카드다. 그리고 그 회고가 **커밋됐다** — 다른 트랜잭션(jdbc)에서 보인다.
        saved.source shouldBe ReflectionSource.RULE
        jdbc.queryForObject(
            "SELECT source FROM reflection WHERE trip_id = ? AND day_date = ?", String::class.java, tripId, day1,
        ) shouldBe ReflectionSource.RULE.name
    }
}
