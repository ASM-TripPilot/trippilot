package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.planbdetection.domain.Sensitivity
import com.trippilot.planbdetection.domain.SensitivityRepository
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
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.web.client.RestClient
import java.time.Instant
import java.util.UUID

/**
 * Plan-B 알림 민감도 표면(TRIP-616 · BR-U4-08 · BR-U4-03).
 *
 * **저장·적용은 이미 있었다** — 감지(`TriggerService`)가 `plan_b_sensitivity`(V2.18)를 읽어
 * 발화 총량을 제한하고 있었다. 없던 것은 이 표면뿐이라 FE(TRIP-607)가 설정 행을 못 그렸다.
 *
 * 여기서만 드러나는 것:
 * - **계정당 1행 upsert** — 여러 번 바꿔도 행이 하나여야 한다(PK 가 account_id)
 * - **CHECK 어휘** — 컬럼이 `varchar(6) CHECK (LOW·NORMAL·HIGH)` 다. 어휘 밖 값을 400 으로
 *   막지 않으면 저장 자체가 DB 에서 실패해 500 이 나간다
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class PlanBSensitivityApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var sensitivities: SensitivityRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

    private val json = ObjectMapper()
    private val now = Instant.parse("2026-07-26T00:00:00Z")

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

    private fun newAccount(): Pair<UUID, String> {
        val account = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now))
        return account.id.value to accessTokenIssuer.issue(account.id.value.toString()).value
    }

    private fun rowCount(accountId: UUID): Int =
        jdbc.queryForObject("SELECT count(*) FROM plan_b_sensitivity WHERE account_id = ?", Int::class.java, accountId)!!

    @Test
    fun `설정한 적 없으면 NORMAL 이 온다 — 404 가 아니다`() {
        val (_, token) = newAccount()

        val (rc, body) = call(HttpMethod.GET, "/api/v1/me/planb-sensitivity", token)

        rc shouldBe 200
        // 404 였다면 설정이 없다고 화면이 이 행을 못 그린다.
        body["sensitivity"].asText() shouldBe "NORMAL"
    }

    @Test
    fun `바꾸면 저장되고 감지가 그 값을 읽는다`() {
        val (accountId, token) = newAccount()

        call(HttpMethod.PUT, "/api/v1/me/planb-sensitivity", token, """{"sensitivity":"LOW"}""")
            .first shouldBe 200

        call(HttpMethod.GET, "/api/v1/me/planb-sensitivity", token).second["sensitivity"].asText() shouldBe "LOW"
        // 표면과 감지가 **같은 값**을 본다 — 따로 읽으면 설정이 안 먹는 채로 초록이 된다.
        sensitivities.of(accountId) shouldBe Sensitivity.LOW
    }

    @Test
    fun `여러 번 바꿔도 행은 하나다 — 계정당 1행`() {
        val (accountId, token) = newAccount()

        listOf("LOW", "HIGH", "NORMAL").forEach {
            call(HttpMethod.PUT, "/api/v1/me/planb-sensitivity", token, """{"sensitivity":"$it"}""")
        }

        rowCount(accountId) shouldBe 1
        sensitivities.of(accountId) shouldBe Sensitivity.NORMAL
    }

    @Test
    fun `어휘 밖 값은 400 — 조용히 NORMAL 로 떨어뜨리지 않는다`() {
        val (accountId, token) = newAccount()

        val (rc, _) = call(HttpMethod.PUT, "/api/v1/me/planb-sensitivity", token, """{"sensitivity":"VERY_HIGH"}""")

        // 400 이 아니면 컬럼 CHECK 에 걸려 500 이 나가거나, 사용자가 바꾼 줄 알고 화면을 떠난다.
        rc shouldBe 400
        rowCount(accountId) shouldBe 0
    }

    @Test
    fun `상한 수치는 응답에 없다 — 클라가 임계를 알면 안 된다(BR-U4-03)`() {
        val (_, token) = newAccount()

        val fields = call(HttpMethod.GET, "/api/v1/me/planb-sensitivity", token).second
            .fieldNames().asSequence().toList()

        // dailyCap·hourlyCap 같은 수치가 새면 화면이 자체 판단으로 배너를 띄우게 된다.
        fields shouldBe listOf("sensitivity")
    }

    @Test
    fun `남의 설정을 바꾸지 않는다`() {
        val (mineId, mine) = newAccount()
        val (otherId, other) = newAccount()

        call(HttpMethod.PUT, "/api/v1/me/planb-sensitivity", mine, """{"sensitivity":"HIGH"}""")

        call(HttpMethod.GET, "/api/v1/me/planb-sensitivity", other).second["sensitivity"].asText() shouldBe "NORMAL"
        sensitivities.of(mineId) shouldBe Sensitivity.HIGH
        rowCount(otherId) shouldBe 0
    }

    @Test
    fun `인증 없으면 401`() {
        call(HttpMethod.GET, "/api/v1/me/planb-sensitivity", null).first shouldBe 401
    }
}
