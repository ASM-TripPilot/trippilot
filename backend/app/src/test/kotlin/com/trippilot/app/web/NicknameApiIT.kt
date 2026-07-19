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
import java.util.UUID

/**
 * TRIP-157 — 닉네임 API E2E. 후보 생성·검사·설정(프로필 생성)·중복 409·금칙어 400.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class NicknameApiIT : AbstractPostgresIntegrationTest() {

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

    private fun uniqueNick() = "여행자" + UUID.randomUUID().toString().replace("-", "").take(8)

    @Test
    fun `suggestions 는 후보 3개를 반환`() {
        val (status, body) = call(HttpMethod.POST, "/api/v1/nickname/suggestions", newToken())
        status shouldBe 200
        body["suggestions"].size() shouldBe 3
    }

    @Test
    fun `check — 신규는 available, 설정 후 동일값은 TAKEN`() {
        val token = newToken()
        val nick = uniqueNick()

        call(HttpMethod.POST, "/api/v1/nickname/check", token, """{"nickname":"$nick"}""").let { (s, b) ->
            s shouldBe 200
            b["available"].asBoolean() shouldBe true
            b["reason"].asText() shouldBe "OK"
        }

        call(HttpMethod.PATCH, "/api/v1/me/profile/nickname", token, """{"nickname":"$nick"}""").first shouldBe 200

        call(HttpMethod.POST, "/api/v1/nickname/check", newToken(), """{"nickname":"$nick"}""").let { (_, b) ->
            b["available"].asBoolean() shouldBe false
            b["reason"].asText() shouldBe "TAKEN"
        }
    }

    @Test
    fun `PATCH 닉네임 설정은 프로필을 생성하고 GET me profile 로 조회된다`() {
        val token = newToken()
        val nick = uniqueNick()

        // 설정 전에는 프로필 없음(404)
        call(HttpMethod.GET, "/api/v1/me/profile", token).first shouldBe 404

        val (setStatus, setBody) = call(HttpMethod.PATCH, "/api/v1/me/profile/nickname", token, """{"nickname":"$nick"}""")
        setStatus shouldBe 200
        setBody["nickname"].asText() shouldBe nick

        val (getStatus, getBody) = call(HttpMethod.GET, "/api/v1/me/profile", token)
        getStatus shouldBe 200
        getBody["nickname"].asText() shouldBe nick
        getBody["onboardingCompletedAt"].isNull shouldBe true
    }

    @Test
    fun `다른 계정이 같은 닉네임을 설정하면 409`() {
        val nick = uniqueNick()
        call(HttpMethod.PATCH, "/api/v1/me/profile/nickname", newToken(), """{"nickname":"$nick"}""").first shouldBe 200
        call(HttpMethod.PATCH, "/api/v1/me/profile/nickname", newToken(), """{"nickname":"$nick"}""").first shouldBe 409
    }

    @Test
    fun `금칙어 닉네임은 400`() {
        // 시드 금칙어 '비속어예시1'
        call(HttpMethod.PATCH, "/api/v1/me/profile/nickname", newToken(), """{"nickname":"비속어예시1닉"}""").first shouldBe 400
    }

    @Test
    fun `너무 짧은 닉네임은 400`() {
        call(HttpMethod.PATCH, "/api/v1/me/profile/nickname", newToken(), """{"nickname":"가"}""").first shouldBe 400
    }
}
