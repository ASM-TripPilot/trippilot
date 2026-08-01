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

    @Test
    fun `같은 이메일이 이미 다른 소셜로 가입돼 있으면 409 + existingProvider 를 계약 필드로 준다`() {
        // 준비 — 카카오로 먼저 가입한다. 고정 이메일 마커(FIXED_EMAIL_MARKER)를 쓰면 Fake 가
        // 랜덤 대신 같은 이메일을 돌려주므로 충돌을 재현할 수 있다.
        val (firstStatus, _) = post(
            "/api/v1/auth/social/kakao",
            """{"authorizationCode":"$FIXED_EMAIL_MARKER-kakao","codeVerifier":"v","redirectUri":"trippilot://auth","ageConfirmation":{"method":"SELF_DECLARED"}}""",
        )
        firstStatus shouldBe 200

        // 실행 — 같은 이메일을 가진 네이버 계정으로 신규 가입을 시도한다.
        val (status, body) = post(
            "/api/v1/auth/social/naver",
            """{"authorizationCode":"$FIXED_EMAIL_MARKER-naver","codeVerifier":"v","redirectUri":"trippilot://auth","ageConfirmation":{"method":"SELF_DECLARED"}}""",
        )

        // 단언 — 안내가 message 문자열이 아니라 **계약 필드**로 실려야 한다(TRIP-211 · BR-U0-04).
        status shouldBe 409
        body["error"]["code"].asText() shouldBe "SOCIAL_EMAIL_CONFLICT"
        body["error"]["existingProvider"].asText() shouldBe "kakao"
    }

    @Test
    fun `소셜 충돌이 아닌 에러 응답에는 existingProvider 필드가 나타나지 않는다`() {
        // 대조군 — 다른 409·4xx 의 응답 형태가 이 필드 추가로 바뀌지 않았다(회귀 금지).
        val (status, body) = post(
            "/api/v1/auth/social/naver",
            """{"authorizationCode":"code","codeVerifier":"verifier","redirectUri":"trippilot://auth"}""",
        )

        status shouldBe 400
        body["error"]["code"].asText() shouldBe "VALIDATION_ERROR"
        body["error"].has("existingProvider") shouldBe false
    }

    companion object {
        /** 이 마커가 인가 코드에 있으면 Fake 가 provider 와 무관하게 같은 이메일을 준다(충돌 재현용). */
        const val FIXED_EMAIL_MARKER = "fixed-email"
        const val FIXED_EMAIL = "dup@example.com"
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
            ) = profile(provider, authorizationCode)

            override fun authenticateWithAccessToken(provider: Provider, accessToken: String) =
                profile(provider, accessToken)

            /**
             * sub 는 항상 새로 만든다(= 매번 신규 소셜 계정). 이메일만 마커 유무로 갈라,
             * 기본은 랜덤(기존 테스트의 독립성 유지) · 마커가 있으면 고정(충돌 재현)이다.
             */
            private fun profile(provider: Provider, credential: String) = SocialProfile(
                provider,
                "sub-${UUID.randomUUID()}",
                if (credential.startsWith(FIXED_EMAIL_MARKER)) FIXED_EMAIL else "user-${UUID.randomUUID()}@example.com",
            )
        }
    }
}
