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
import org.springframework.core.io.ClassPathResource
import org.springframework.http.MediaType
import org.springframework.web.client.RestClient
import org.yaml.snakeyaml.Yaml
import java.time.LocalDate
import java.time.ZoneId
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

    /**
     * BR-U0-05 — "미충족 **422**, 계정 미생성". 오래도록 403 이 나가고 있었다(TRIP-249).
     *
     * 403 이면 클라이언트는 "권한 문제"로 읽어 재로그인·권한요청으로 유도한다 — 나이는 그걸로 바뀌지 않는다.
     * 입력도 인증도 정상이고 **업무 규칙**에 걸린 것이라 422 다. 위 400(연령확인 값 자체가 없음)과 갈린다.
     */
    @Test
    fun `만 14세 미만이면 422 — 400 과 갈린다`() {
        val underage = LocalDate.now(ZoneId.of("Asia/Seoul")).minusYears(10)
        val (status, body) = post(
            "/api/v1/auth/social/naver",
            """{"authorizationCode":"code","codeVerifier":"verifier","redirectUri":"trippilot://auth",
                "ageConfirmation":{"method":"BIRTH_DATE","birthDate":"$underage"}}""",
        )

        status shouldBe 422
        body["error"]["code"].asText() shouldBe "AGE_REQUIREMENT_NOT_MET"
    }

    @Test
    fun `지원하지 않는 provider 는 400`() {
        val (status, body) = post(
            "/api/v1/auth/social/facebook",
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

    // ── 응답 모양 게이트(TRIP-249 5번) ────────────────────────────────────────────
    // OpenApiContractIT 는 **경로**가 맞는지만 본다. 응답 **본문 필드**는 아무도 안 봤고,
    // 그래서 TokenPair 가 7필드를 선언하는 동안 서버는 3필드만 내보내도 전부 초록이었다.
    // 아래 둘이 그 구멍을 막는다 — 계약이 선언한 키 집합과 실제 응답 키 집합을 정확히 대조한다.

    /** openapi 정본에서 스키마 하나의 property 이름 집합을 읽는다. */
    private fun schemaProperties(name: String): Set<String> {
        @Suppress("UNCHECKED_CAST")
        val spec = Yaml().load<Map<String, Any>>(ClassPathResource("static/openapi.yaml").inputStream)
        @Suppress("UNCHECKED_CAST")
        val schemas = (spec["components"] as Map<String, Any>)["schemas"] as Map<String, Map<String, Any>>
        val schema = requireNotNull(schemas[name]) { "openapi.yaml 에 $name 스키마가 없다" }
        @Suppress("UNCHECKED_CAST")
        return (schema["properties"] as Map<String, Any>).keys.toSet()
    }

    private fun JsonNode.keys(): Set<String> = fieldNames().asSequence().toSet()

    @Test
    fun `소셜 로그인 응답 키가 계약의 TokenPair 와 정확히 일치한다`() {
        val (status, body) = post(
            "/api/v1/auth/social/kakao",
            """{"authorizationCode":"code","codeVerifier":"verifier","redirectUri":"trippilot://auth","ageConfirmation":{"method":"SELF_DECLARED"}}""",
        )

        status shouldBe 200
        body.keys() shouldBe schemaProperties("TokenPair")
        body["account"].keys() shouldBe schemaProperties("AccountSummary")

        // 값도 함께 본다 — 키만 있고 0 이면 클라의 갱신 판단은 여전히 불가능하다.
        body["tokenType"].asText() shouldBe "Bearer"
        (body["expiresIn"].asLong() > 0) shouldBe true
        (body["refreshExpiresIn"].asLong() > body["expiresIn"].asLong()) shouldBe true
        body["account"]["status"].asText() shouldBe "ACTIVE"
        body["account"]["socialProviders"].map { it.asText() } shouldBe listOf("KAKAO")
    }

    @Test
    fun `갱신 응답 키가 계약의 RefreshedTokenPair 와 정확히 일치한다`() {
        val login = post(
            "/api/v1/auth/social/kakao",
            """{"authorizationCode":"code","codeVerifier":"verifier","redirectUri":"trippilot://auth","ageConfirmation":{"method":"SELF_DECLARED"}}""",
        ).second

        val (status, body) = post(
            "/api/v1/auth/token/refresh",
            """{"refreshToken":"${login["refreshToken"].asText()}"}""",
        )

        status shouldBe 200
        // 갱신에는 isNewUser·account 가 없다 — 있으면 매 갱신마다 계정 조회를 강요하게 된다.
        body.keys() shouldBe schemaProperties("RefreshedTokenPair")
        (body["expiresIn"].asLong() > 0) shouldBe true
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
