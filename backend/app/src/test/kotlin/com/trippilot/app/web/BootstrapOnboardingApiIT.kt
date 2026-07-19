package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Provider
import com.trippilot.auth.domain.SocialProfile
import com.trippilot.auth.domain.port.SocialAuthPort
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
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
 * TRIP-159 — 부트스트랩 + 온보딩 완료 E2E. 교차모듈 facade(profile→auth.api.ConsentFacade) 실배선 검증.
 * GUEST/인증 부트스트랩, X-App-Version FORCED, 온보딩 전제(약관+닉네임)·멱등.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class BootstrapOnboardingApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    private val json = ObjectMapper()

    private fun client() = RestClient.builder()
        .requestFactory(JdkClientHttpRequestFactory()).baseUrl("http://localhost:$port").build()

    private fun call(
        method: HttpMethod,
        path: String,
        bearer: String? = null,
        body: String? = null,
        headers: Map<String, String> = emptyMap(),
    ): Pair<Int, JsonNode> {
        val spec = client().method(method).uri(path)
        bearer?.let { spec.header("Authorization", "Bearer $it") }
        headers.forEach { (k, v) -> spec.header(k, v) }
        body?.let { spec.contentType(MediaType.APPLICATION_JSON).body(it) }
        val res = spec.retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java)
        val parsed = res.body?.takeIf { it.isNotBlank() }?.let { json.readTree(it) } ?: json.createObjectNode()
        return res.statusCode.value() to parsed
    }

    private fun login(): String {
        val (status, body) = call(
            HttpMethod.POST, "/api/v1/auth/social/kakao", body =
            """{"authorizationCode":"c","codeVerifier":"v","redirectUri":"trippilot://auth","ageConfirmation":{"method":"SELF_DECLARED"}}""",
        )
        status shouldBe 200
        return body["accessToken"].asText()
    }

    private fun uniqueNick() = "탐험가" + UUID.randomUUID().toString().replace("-", "").take(8)

    @Test
    fun `비인증 부트스트랩은 GUEST`() {
        val (status, body) = call(HttpMethod.GET, "/api/v1/bootstrap")
        status shouldBe 200
        body["session"]["state"].asText() shouldBe "GUEST"
        body["reconsent"]["required"].asBoolean() shouldBe false
        body["session"]["onboardingCompleted"].asBoolean() shouldBe false
    }

    @Test
    fun `구버전 클라이언트는 FORCED`() {
        val (_, body) = call(HttpMethod.GET, "/api/v1/bootstrap", headers = mapOf("X-App-Version" to "0.9.0"))
        body["appUpdate"]["status"].asText() shouldBe "FORCED"
        body["appUpdate"]["minSupportedVersion"].asText() shouldBe "1.0.0"
    }

    @Test
    fun `인증 부트스트랩은 AUTHENTICATED, 초기 온보딩 미완료`() {
        val token = login()
        val (status, body) = call(HttpMethod.GET, "/api/v1/bootstrap", token)
        status shouldBe 200
        body["session"]["state"].asText() shouldBe "AUTHENTICATED"
        body["session"]["onboardingCompleted"].asBoolean() shouldBe false
    }

    @Test
    fun `온보딩 완료 — 약관·닉네임 충족 후 완료되고 부트스트랩에 반영, 멱등`() {
        val token = login()

        // 전제 미충족 → 400
        call(HttpMethod.POST, "/api/v1/onboarding/complete", token).first shouldBe 400

        // 필수 약관 동의(이용약관·개인정보)
        call(
            HttpMethod.POST, "/api/v1/me/consents", token,
            """{"consents":[
                 {"termsType":"TERMS_OF_SERVICE","termsVersion":"1.0","action":"GRANT"},
                 {"termsType":"PRIVACY_POLICY","termsVersion":"1.0","action":"GRANT"}
               ]}""",
        ).first shouldBe 200
        // 닉네임 설정(프로필 생성)
        call(HttpMethod.PATCH, "/api/v1/me/profile/nickname", token, """{"nickname":"${uniqueNick()}"}""").first shouldBe 200

        // 이제 완료 가능
        val (completeStatus, completeBody) = call(HttpMethod.POST, "/api/v1/onboarding/complete", token)
        completeStatus shouldBe 200
        val completedAt = completeBody["onboardingCompletedAt"].asText()

        // 부트스트랩에 반영
        call(HttpMethod.GET, "/api/v1/bootstrap", token).second["session"]["onboardingCompleted"].asBoolean() shouldBe true

        // 멱등 — 재호출도 200, 동일 시각
        val (againStatus, againBody) = call(HttpMethod.POST, "/api/v1/onboarding/complete", token)
        againStatus shouldBe 200
        againBody["onboardingCompletedAt"].asText() shouldBe completedAt
    }

    @TestConfiguration
    class FakeProviderConfig {
        @Bean
        @Primary
        fun fakeSocialAuthPort(): SocialAuthPort = object : SocialAuthPort {
            override fun exchange(provider: Provider, authorizationCode: String, codeVerifier: String, redirectUri: String) =
                SocialProfile(provider, "sub-${UUID.randomUUID()}", "user-${UUID.randomUUID()}@example.com")
        }
    }
}
