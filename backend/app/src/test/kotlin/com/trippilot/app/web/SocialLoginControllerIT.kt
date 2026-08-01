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
import org.springframework.http.MediaType
import org.springframework.web.client.RestClient
import java.util.UUID

/**
 * TRIP-151 6단계 — 소셜 로그인 엔드포인트 E2E(조립된 앱 + 마이그레이션 DB, 실제 HTTP).
 * SocialAuthPort 는 Fake(@Primary)로 대체 — 실제 제공자 호출 0(D37). 나머지(유스케이스·영속·토큰)는 실제 빈.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class SocialLoginControllerIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    private val json = ObjectMapper()

    private fun post(path: String, body: String): Pair<Int, JsonNode> {
        val res = RestClient.create("http://localhost:$port").post()
            .uri(path)
            .contentType(MediaType.APPLICATION_JSON)
            .body(body)
            .retrieve()
            .onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> }) // 예외 대신 응답 그대로
            .toEntity(String::class.java)
        return res.statusCode.value() to json.readTree(res.body)
    }

    @Test
    fun `신규 소셜 로그인은 200 + isNewUser true + 토큰을 반환한다`() {
        val (status, body) = post(
            "/api/v1/auth/social/kakao",
            """{"authorizationCode":"code","codeVerifier":"verifier","redirectUri":"trippilot://auth","ageConfirmation":{"method":"SELF_DECLARED"}}""",
        )

        status shouldBe 200
        body["isNewUser"].asBoolean() shouldBe true
        body["accessToken"].asText().shouldNotBeBlank()
        body["refreshToken"].asText().shouldNotBeBlank()
    }

    @Test
    fun `SDK 토큰 로그인은 200 + isNewUser true + 토큰을 반환한다`() {
        val (status, body) = post(
            "/api/v1/auth/social/kakao/token",
            """{"accessToken":"sdk-access-token","ageConfirmation":{"method":"SELF_DECLARED"}}""",
        )

        status shouldBe 200
        body["isNewUser"].asBoolean() shouldBe true
        body["accessToken"].asText().shouldNotBeBlank()
        body["refreshToken"].asText().shouldNotBeBlank()
    }

    @Test
    fun `신규 가입인데 연령확인 누락이면 400 VALIDATION_ERROR`() {
        val (status, body) = post(
            "/api/v1/auth/social/naver",
            """{"authorizationCode":"code","codeVerifier":"verifier","redirectUri":"trippilot://auth"}""",
        )

        status shouldBe 400
        body["error"]["code"].asText() shouldBe "VALIDATION_ERROR"
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

            override fun authenticateWithAccessToken(provider: Provider, accessToken: String) =
                SocialProfile(provider, "sub-${UUID.randomUUID()}", "user-${UUID.randomUUID()}@example.com")
        }
    }
}
