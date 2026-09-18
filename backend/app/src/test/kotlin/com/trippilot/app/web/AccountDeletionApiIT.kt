package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Provider
import com.trippilot.auth.domain.SocialProfile
import com.trippilot.auth.domain.port.SocialAuthPort
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotBeBlank
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Primary
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.http.client.JdkClientHttpRequestFactory
import org.springframework.web.client.RestClient
import java.util.UUID

/**
 * TRIP-158 — 계정 삭제 라이프사이클 E2E. 로그인→GET /me→삭제요청(세션폐기·GPS파기)→철회→재요청 409→미존재 404.
 * 제공자는 Fake(D37). 소셜 로그인으로 액세스+리프레시 토큰을 얻는다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AccountDeletionApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    private val json = ObjectMapper()

    private fun client() = RestClient.builder()
        .requestFactory(JdkClientHttpRequestFactory())
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

    /** 신규 소셜 로그인 → (accessToken, refreshToken). */
    private fun login(): Pair<String, String> {
        val (status, body) = call(
            HttpMethod.POST, "/api/v1/auth/social/kakao", body =
            """{"authorizationCode":"c","codeVerifier":"v","redirectUri":"trippilot://auth","ageConfirmation":{"method":"SELF_DECLARED"}}""",
        )
        status shouldBe 200
        return body["accessToken"].asText() to body["refreshToken"].asText()
    }

    @Test
    fun `GET me 는 상태·소셜제공자를 반환`() {
        val (access, _) = login()
        val (status, body) = call(HttpMethod.GET, "/api/v1/me", access)
        status shouldBe 200
        body["status"].asText() shouldBe "ACTIVE"
        body["socialProviders"].map { it.asText() } shouldBe listOf("KAKAO")
    }

    @Test
    fun `삭제 요청은 유예 예약을 만들고 세션을 폐기한다`() {
        val (access, refresh) = login()

        val (status, body) = call(HttpMethod.POST, "/api/v1/me/deletion", access)
        status shouldBe 200
        body["purgeAt"].asText().shouldNotBeBlank()
        body["cascadeSummary"]["legallyRetained"].map { it.asText() } shouldBe listOf("CONSENT_RECORD", "LOCATION_LEGAL_LOG")

        // 세션 폐기 — 리프레시 토큰으로 갱신 시 401
        call(HttpMethod.POST, "/api/v1/auth/token/refresh", body = """{"refreshToken":"$refresh"}""").first shouldBe 401

        // 상태 DELETION_PENDING (액세스 토큰은 무상태라 만료 전까지 유효)
        call(HttpMethod.GET, "/api/v1/me", access).second["status"].asText() shouldBe "DELETION_PENDING"
    }

    @Test
    fun `철회하면 ACTIVE 로 복원된다`() {
        val (access, _) = login()
        call(HttpMethod.POST, "/api/v1/me/deletion", access).first shouldBe 200

        call(HttpMethod.DELETE, "/api/v1/me/deletion", access).first shouldBe 200
        call(HttpMethod.GET, "/api/v1/me", access).second["status"].asText() shouldBe "ACTIVE"
    }

    @Test
    fun `이미 진행 중이면 재요청은 409`() {
        val (access, _) = login()
        call(HttpMethod.POST, "/api/v1/me/deletion", access).first shouldBe 200
        call(HttpMethod.POST, "/api/v1/me/deletion", access).first shouldBe 409
    }

    @Test
    fun `활성 예약이 없으면 철회는 404`() {
        val (access, _) = login()
        call(HttpMethod.DELETE, "/api/v1/me/deletion", access).first shouldBe 404
    }

    @TestConfiguration
    class FakeProviderConfig {
        @Bean
        @Primary
        fun fakeSocialAuthPort(): SocialAuthPort = object : SocialAuthPort {
            override fun exchange(provider: Provider, authorizationCode: String, codeVerifier: String, redirectUri: String) =
                SocialProfile(provider, "sub-${UUID.randomUUID()}", "user-${UUID.randomUUID()}@example.com")

            override fun authenticateWithAccessToken(provider: Provider, accessToken: String) =
                SocialProfile(provider, "sub-${UUID.randomUUID()}", "user-${UUID.randomUUID()}@example.com")
        }
    }
}
