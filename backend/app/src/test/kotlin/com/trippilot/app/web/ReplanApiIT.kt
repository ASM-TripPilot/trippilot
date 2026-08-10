package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.http.client.JdkClientHttpRequestFactory
import org.springframework.web.client.RestClient
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * TRIP-273 — 재계획 진입 API E2E.
 *
 * 여기서 보는 것은 **HTTP 표면**이다 — 상태코드·소유 스코프·필수값.
 * DB 부분 유니크 인덱스와 앱 판정의 정합은 세션이 PROPOSED 까지 가야 드러나므로 [com.trippilot.app.persistence.ReplanSessionPersistenceIT] 에서 본다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ReplanApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository

    private val json = ObjectMapper()

    private fun call(method: HttpMethod, path: String, bearer: String?, body: String? = null): Pair<Int, JsonNode> {
        val spec = RestClient.builder()
            .requestFactory(JdkClientHttpRequestFactory())
            .baseUrl("http://localhost:$port")
            .build()
            .method(method).uri(path)
        bearer?.let { spec.header("Authorization", "Bearer $it") }
        body?.let { spec.contentType(MediaType.APPLICATION_JSON).body(it) }
        val res = spec.retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java)
        val parsed = res.body?.takeIf { it.isNotBlank() }?.let { json.readTree(it) } ?: json.createObjectNode()
        return res.statusCode.value() to parsed
    }

    private fun newToken(): String {
        val account = accounts.save(
            Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, Instant.parse("2026-07-26T00:00:00Z")),
        )
        return accessTokenIssuer.issue(account.id.value.toString()).value
    }

    /** 서버의 실 시계로 판정하므로 **오늘을 포함한** 여행을 만든다(고정 날짜를 쓰면 날이 바뀌며 깨진다). */
    private fun tripBody(start: LocalDate, end: LocalDate) = """
        {"startDate":"$start","endDate":"$end","party":2,"companionType":"친구",
         "destinations":[{"seq":0,"region":"제주","nights":${end.toEpochDay() - start.toEpochDay()}}]}
    """.trimIndent()

    private fun createTrip(token: String, start: LocalDate, end: LocalDate): String =
        call(HttpMethod.POST, "/api/v1/trips", token, tripBody(start, end)).second["tripId"].asText()

    private val today: LocalDate get() = LocalDate.now(ZoneId.of("Asia/Seoul"))

    @Test
    fun `여행 중이면 세션이 열린다 — 숙소를 한 건도 등록하지 않았어도`() {
        val token = newToken()
        // 숙소 등록 없이 여행만 만든다. 재계획 진입은 등록 숙소를 전제하지 않는다.
        val tripId = createTrip(token, today.minusDays(1), today.plusDays(1))

        val (rc, body) = call(
            HttpMethod.POST, "/api/v1/trips/$tripId/replan-sessions", token,
            """{"reason":"WEATHER","mode":"AI"}""",
        )
        rc shouldBe 201
        body["status"].asText() shouldBe "LOADING"
        body["reason"].asText() shouldBe "WEATHER"
        body["emptyReason"].isNull shouldBe true // 산출 전에는 사유가 없어야 한다
    }

    @Test
    fun `여행 기간 밖이면 409`() {
        val token = newToken()
        val past = createTrip(token, today.minusDays(10), today.minusDays(8))
        call(HttpMethod.POST, "/api/v1/trips/$past/replan-sessions", token, """{"reason":"NONE","mode":"AI"}""")
            .first shouldBe 409

        val future = createTrip(token, today.plusDays(8), today.plusDays(10))
        call(HttpMethod.POST, "/api/v1/trips/$future/replan-sessions", token, """{"reason":"NONE","mode":"AI"}""")
            .first shouldBe 409
    }

    @Test
    fun `진행 중 세션이 있으면 409`() {
        val token = newToken()
        val tripId = createTrip(token, today.minusDays(1), today.plusDays(1))
        call(HttpMethod.POST, "/api/v1/trips/$tripId/replan-sessions", token, """{"reason":"WEATHER","mode":"AI"}""")

        val (rc, _) = call(
            HttpMethod.POST, "/api/v1/trips/$tripId/replan-sessions", token, """{"reason":"FATIGUE","mode":"MANUAL"}""",
        )
        rc shouldBe 409 // 앱이 먼저 걸러낸다(여기서는 LOADING 만 밟는다 — PROPOSED 정합은 ReplanSessionPersistenceIT)
    }

    @Test
    fun `취소하면 다시 열 수 있다 — 취소분은 이력으로 남는다`() {
        val token = newToken()
        val tripId = createTrip(token, today.minusDays(1), today.plusDays(1))
        val first = call(
            HttpMethod.POST, "/api/v1/trips/$tripId/replan-sessions", token, """{"reason":"WEATHER","mode":"AI"}""",
        ).second["replanSessionId"].asText()

        call(HttpMethod.POST, "/api/v1/trips/$tripId/replan-sessions/$first/cancel", token).first shouldBe 200
        call(HttpMethod.POST, "/api/v1/trips/$tripId/replan-sessions", token, """{"reason":"FATIGUE","mode":"MANUAL"}""")
            .first shouldBe 201

        // 취소된 세션도 조회된다 — 지우지 않는다
        val (rc, body) = call(HttpMethod.GET, "/api/v1/trips/$tripId/replan-sessions/$first", token)
        rc shouldBe 200
        body["status"].asText() shouldBe "CANCELED"
    }

    @Test
    fun `타 계정 여행이면 404 · 다른 여행의 세션도 404`() {
        val owner = newToken()
        val tripId = createTrip(owner, today.minusDays(1), today.plusDays(1))
        val sessionId = call(
            HttpMethod.POST, "/api/v1/trips/$tripId/replan-sessions", owner, """{"reason":"NONE","mode":"AI"}""",
        ).second["replanSessionId"].asText()

        call(HttpMethod.POST, "/api/v1/trips/$tripId/replan-sessions", newToken(), """{"reason":"NONE","mode":"AI"}""")
            .first shouldBe 404

        // 세션 id 를 알아도 **다른 여행 경로로는** 못 본다
        val otherTrip = createTrip(owner, today.minusDays(1), today.plusDays(1))
        call(HttpMethod.GET, "/api/v1/trips/$otherTrip/replan-sessions/$sessionId", owner).first shouldBe 404
    }

    @Test
    fun `사유·방식이 빠지면 400 — 기본값을 두지 않는다`() {
        val token = newToken()
        val tripId = createTrip(token, today.minusDays(1), today.plusDays(1))
        call(HttpMethod.POST, "/api/v1/trips/$tripId/replan-sessions", token, """{"mode":"AI"}""").first shouldBe 400
        call(HttpMethod.POST, "/api/v1/trips/$tripId/replan-sessions", token, """{"reason":"NONE"}""").first shouldBe 400
    }

    @Test
    fun `인증 없으면 401`() {
        call(HttpMethod.POST, "/api/v1/trips/${java.util.UUID.randomUUID()}/replan-sessions", null, """{"reason":"NONE","mode":"AI"}""")
            .first shouldBe 401
    }
}
