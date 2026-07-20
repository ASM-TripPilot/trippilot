package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Provider
import com.trippilot.auth.domain.SocialProfile
import com.trippilot.auth.domain.port.SocialAuthPort
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.matchers.string.shouldNotBeBlank
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Primary
import org.springframework.http.MediaType
import org.springframework.web.client.RestClient
import java.util.UUID

/**
 * TRIP-153 3단계 — 토큰 갱신·로그아웃 E2E. 로그인으로 받은 리프레시로 회전하고,
 * 소진된 토큰 재사용은 401(체인 폐기), 로그아웃 후 갱신도 401 임을 검증한다. 제공자는 Fake(D37).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class TokenRefreshControllerIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    private val json = ObjectMapper()

    private fun post(path: String, body: String): Pair<Int, JsonNode> {
        val res = RestClient.create("http://localhost:$port").post()
            .uri(path)
            .contentType(MediaType.APPLICATION_JSON)
            .body(body)
            .retrieve()
            .onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java)
        val parsed = res.body?.takeIf { it.isNotBlank() }?.let { json.readTree(it) } ?: json.createObjectNode()
        return res.statusCode.value() to parsed
    }

    /** 신규 소셜 로그인 → 리프레시 토큰 반환. */
    private fun login(): String {
        val (status, body) = post(
            "/api/v1/auth/social/kakao",
            """{"authorizationCode":"c","codeVerifier":"v","redirectUri":"trippilot://auth","ageConfirmation":{"method":"SELF_DECLARED"}}""",
        )
        status shouldBe 200
        return body["refreshToken"].asText()
    }

    @Test
    fun `리프레시로 회전하면 새 액세스·리프레시 토큰을 반환한다`() {
        val refreshToken = login()

        val (status, body) = post("/api/v1/auth/token/refresh", """{"refreshToken":"$refreshToken"}""")

        status shouldBe 200
        body["accessToken"].asText().shouldNotBeBlank()
        body["refreshToken"].asText().shouldNotBeBlank()
        body["refreshToken"].asText() shouldNotBe refreshToken // 회전됨
    }

    @Test
    fun `소진된 리프레시 토큰 재사용은 401 REFRESH_REUSE_DETECTED`() {
        val refreshToken = login()
        post("/api/v1/auth/token/refresh", """{"refreshToken":"$refreshToken"}""") // 1회 회전 → 소진

        val (status, body) = post("/api/v1/auth/token/refresh", """{"refreshToken":"$refreshToken"}""")

        status shouldBe 401
        body["error"]["code"].asText() shouldBe "REFRESH_REUSE_DETECTED"
    }

    @Test
    fun `알 수 없는 리프레시 토큰은 401 REFRESH_TOKEN_INVALID`() {
        val (status, body) = post("/api/v1/auth/token/refresh", """{"refreshToken":"not-a-real-token"}""")

        status shouldBe 401
        body["error"]["code"].asText() shouldBe "REFRESH_TOKEN_INVALID"
    }

    @Test
    fun `로그아웃 후 그 리프레시 토큰으로 갱신하면 401`() {
        val refreshToken = login()

        val (logoutStatus, _) = post("/api/v1/auth/logout", """{"refreshToken":"$refreshToken"}""")
        logoutStatus shouldBe 204

        val (refreshStatus, _) = post("/api/v1/auth/token/refresh", """{"refreshToken":"$refreshToken"}""")
        refreshStatus shouldBe 401
    }

    @TestConfiguration
    class FakeProviderConfig {
        @Bean
        @Primary
        fun fakeSocialAuthPort(): SocialAuthPort = object : SocialAuthPort {
            override fun exchange(
                provider: Provider,
                authorizationCode: String,
                codeVerifier: String,
                redirectUri: String,
            ) = SocialProfile(provider, "sub-${UUID.randomUUID()}", "user-${UUID.randomUUID()}@example.com")
        }
    }
}
