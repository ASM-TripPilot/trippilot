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
 * TRIP-154 — 동의 API E2E. 공개 약관 열람 + Bearer 게이트 + 온보딩 제출→폴드 반영.
 * 토큰은 AccessTokenIssuer 로 직접 발급(실제 IdP 불필요). 시드 약관(R__) 위에서 동작.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ConsentControllerIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository

    private val json = ObjectMapper()
    private val now = Instant.parse("2026-07-19T00:00:00Z")

    private fun client() = RestClient.builder()
        .requestFactory(JdkClientHttpRequestFactory()) // PATCH 지원
        .baseUrl("http://localhost:$port")
        .build()

    private fun call(method: HttpMethod, path: String, bearer: String? = null, body: String? = null): Pair<Int, JsonNode> {
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
    fun `GET terms 는 토큰 없이 200, 시드 약관을 반환`() {
        val (status, body) = call(HttpMethod.GET, "/api/v1/terms")
        status shouldBe 200
        body.isArray shouldBe true
        (body.size() >= 6) shouldBe true
    }

    @Test
    fun `인증 없이 GET me consents 는 401`() {
        call(HttpMethod.GET, "/api/v1/me/consents").first shouldBe 401
    }

    @Test
    fun `온보딩 일괄 제출 후 status 에 폴드가 반영된다`() {
        val token = newToken()
        val (submitStatus, _) = call(
            HttpMethod.POST, "/api/v1/me/consents", token,
            """{"consents":[
                 {"termsType":"TERMS_OF_SERVICE","termsVersion":"1.0","action":"GRANT"},
                 {"termsType":"PRIVACY_POLICY","termsVersion":"1.0","action":"GRANT"}
               ]}""",
        )
        submitStatus shouldBe 200

        val (statusCode, body) = call(HttpMethod.GET, "/api/v1/me/consents", token)
        statusCode shouldBe 200
        val granted = body.filter { it["granted"].asBoolean() }.map { it["termsType"].asText() }.toSet()
        granted shouldBe setOf("TERMS_OF_SERVICE", "PRIVACY_POLICY")
    }

    @Test
    fun `필수 약관 누락 온보딩은 400`() {
        val token = newToken()
        val (status, _) = call(
            HttpMethod.POST, "/api/v1/me/consents", token,
            """{"consents":[{"termsType":"TERMS_OF_SERVICE","termsVersion":"1.0","action":"GRANT"}]}""",
        )
        status shouldBe 400
    }

    @Test
    fun `마케팅 토글은 200`() {
        val token = newToken()
        call(HttpMethod.PUT, "/api/v1/me/marketing-consent", token, """{"optIn":true}""").first shouldBe 200
    }

    @Test
    fun `본문의 잘못된 enum 값은 400(500 아님)`() {
        val token = newToken()
        call(
            HttpMethod.PATCH, "/api/v1/me/consents/PRIVACY_POLICY", token,
            """{"action":"YES","termsVersion":"1.0"}""",
        ).first shouldBe 400
    }
}
