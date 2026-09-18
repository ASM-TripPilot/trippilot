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

/**
 * TRIP-156 — 프로필·취향 API E2E. 중립 기본값 파생, PUT tri-state(생략/null/값), INV-PR3 400, 프로필 404.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ProfileApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository

    private val json = ObjectMapper()
    private val now = Instant.parse("2026-07-19T00:00:00Z")

    private fun client() = RestClient.builder()
        .requestFactory(JdkClientHttpRequestFactory())
        .baseUrl("http://localhost:$port")
        .build()

    private fun call(method: HttpMethod, path: String, bearer: String?, body: String? = null): Pair<Int, JsonNode> {
        val spec = client().method(method).uri(path)
        bearer?.let { spec.header("Authorization", "Bearer $it") }
        body?.let { spec.contentType(MediaType.APPLICATION_JSON).body(it) }
        val res = spec.retrieve()
            .onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java)
        val parsed = res.body?.takeIf { it.isNotBlank() }?.let { json.readTree(it) } ?: json.createObjectNode()
        return res.statusCode.value() to parsed
    }

    private fun newToken(): String {
        val account = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now))
        return accessTokenIssuer.issue(account.id.value.toString()).value
    }

    @Test
    fun `미설정 취향 조회는 중립 기본값 완전 응답`() {
        val (status, body) = call(HttpMethod.GET, "/api/v1/me/preferences", newToken())
        status shouldBe 200
        body["transportModes"]["value"].map { it.asText() } shouldBe listOf("대중교통")
        body["transportModes"]["isNeutralDefault"].asBoolean() shouldBe true
        body["styles"]["isNeutralDefault"].asBoolean() shouldBe true
    }

    @Test
    fun `PUT tri-state — 값 설정, 생략은 유지, null은 초기화`() {
        val token = newToken()
        call(HttpMethod.PUT, "/api/v1/me/preferences", token, """{"styles":["휴양"],"pace":"알차게"}""").first shouldBe 200

        // pace 만 변경 → styles 유지(Keep)
        val (_, afterKeep) = call(HttpMethod.PUT, "/api/v1/me/preferences", token, """{"pace":"느긋하게"}""")
        afterKeep["styles"]["value"].map { it.asText() } shouldBe listOf("휴양")
        afterKeep["styles"]["isNeutralDefault"].asBoolean() shouldBe false

        // styles=null → 미설정(중립)
        val (_, afterNull) = call(HttpMethod.PUT, "/api/v1/me/preferences", token, """{"styles":null}""")
        afterNull["styles"]["isNeutralDefault"].asBoolean() shouldBe true
        afterNull["pace"]["value"].asText() shouldBe "느긋하게" // pace 는 유지
    }

    @Test
    fun `예산 금액만(등급 없음)은 400 (INV-PR3)`() {
        call(HttpMethod.PUT, "/api/v1/me/preferences", newToken(), """{"budgetRawAmount":100000}""").first shouldBe 400
    }

    @Test
    fun `허용되지 않은 축 값은 400`() {
        call(HttpMethod.PUT, "/api/v1/me/preferences", newToken(), """{"styles":["우주여행"]}""").first shouldBe 400
    }

    @Test
    fun `배열 축을 문자열로 보내면 400 (조용한 강제 방지)`() {
        call(HttpMethod.PUT, "/api/v1/me/preferences", newToken(), """{"styles":"휴양"}""").first shouldBe 400
    }

    @Test
    fun `숫자 축을 문자열로 보내면 400`() {
        call(HttpMethod.PUT, "/api/v1/me/preferences", newToken(), """{"budgetTier":"고급","budgetRawAmount":"많이"}""").first shouldBe 400
    }

    @Test
    fun `프로필 미생성 계정의 GET me profile 은 404`() {
        call(HttpMethod.GET, "/api/v1/me/profile", newToken()).first shouldBe 404
    }

    @Test
    fun `인증 없이 취향 조회는 401`() {
        call(HttpMethod.GET, "/api/v1/me/preferences", null).first shouldBe 401
    }
}
