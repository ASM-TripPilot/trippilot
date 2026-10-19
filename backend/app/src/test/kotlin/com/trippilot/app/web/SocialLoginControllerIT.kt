package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Provider
import com.trippilot.auth.domain.RefreshSession
import com.trippilot.auth.domain.SocialProfile
import com.trippilot.auth.domain.port.SocialAuthPort
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.assertions.withClue
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotBeBlank
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Primary
import org.springframework.core.io.ClassPathResource
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
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

    @Autowired private lateinit var jdbc: JdbcTemplate

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

    /**
     * TRIP-858 — apple 이 토큰 경로의 계약 enum 에 들어왔다(종전 `[kakao, naver, google]`).
     *
     * **이 테스트가 재는 범위는 좁다.** `FakeProviderConfig` 가 `SocialAuthPort` 를 통째로 갈아끼우므로
     * `AppleOAuthClient` 는 생성도 호출도 되지 않고, `Provider.APPLE` 은 이번 변경 이전부터 있었다 —
     * 즉 **변경 이전 커밋에서도 초록이다**(적대적 리뷰 지적). 남는 값은 "provider=apple 이 컨트롤러·
     * 유스케이스·영속을 지나 APPLE 계정으로 떨어진다"는 회귀 심판뿐이다.
     *
     * 서명·aud·iss·exp 검증은 `AppleOAuthClientTest`, 설정 통로는 `AppleClientIdWiringTest` 가 각각 잰다.
     */
    @Test
    fun `애플 identityToken 로그인은 200 + APPLE 계정을 만든다`() {
        val (status, body) = post(
            "/api/v1/auth/social/apple/token",
            """{"accessToken":"apple-identity-token","ageConfirmation":{"method":"SELF_DECLARED"}}""",
        )

        status shouldBe 200
        body["isNewUser"].asBoolean() shouldBe true
        body["accessToken"].asText().shouldNotBeBlank()
        body["account"]["socialProviders"].map { it.asText() } shouldBe listOf("APPLE")
    }

    /**
     * TRIP-933 — 애플은 `authorizationCode` 를 선택으로 더 싣는다(revoke 용 refresh_token 교환).
     * 이 환경은 Team ID·Key ID·p8 이 비어 있어 교환을 건너뛴다 — 재는 것은 **그래도 로그인이 된다**는 것,
     * 즉 새 필드가 계약에 들어와도 역직렬화·검증에서 막히지 않고 revoke 설정 부재가 로그인을 막지 않는다는 것.
     */
    @Test
    fun `애플 로그인에 authorizationCode 가 붙어도 200 — revoke 설정이 없어도 로그인은 막히지 않는다`() {
        val (status, body) = post(
            "/api/v1/auth/social/apple/token",
            """{"accessToken":"apple-identity-token","authorizationCode":"apple-code","ageConfirmation":{"method":"SELF_DECLARED"}}""",
        )

        status shouldBe 200
        body["account"]["socialProviders"].map { it.asText() } shouldBe listOf("APPLE")
    }

    @Test
    fun `신규 가입인데 연령확인 누락이면 400 VALIDATION_ERROR`() {
        val (status, body) = post(
            "/api/v1/auth/social/kakao",
            """{"authorizationCode":"code","codeVerifier":"verifier","redirectUri":"trippilot://auth"}""",
        )

        status shouldBe 400
        body["error"]["code"].asText() shouldBe "VALIDATION_ERROR"
    }

    /**
     * 기기 식별자는 세션 컬럼(`refresh_session.device_id varchar(128)`)에 그대로 들어간다. 요청에서 막지 않으면
     * 저장에서 22001 이 나 로그인 트랜잭션 전체가 롤백되고 **500** 이 나간다 — 클라이언트 탓인데 서버 장애로 보인다.
     * 두 로그인 경로가 각자 DTO 를 가지므로 둘 다 본다.
     */
    private val loginBodies = mapOf(
        "/api/v1/auth/social/kakao" to { deviceId: String ->
            """{"authorizationCode":"code","codeVerifier":"verifier","redirectUri":"trippilot://auth","ageConfirmation":{"method":"SELF_DECLARED"},"deviceId":"$deviceId"}"""
        },
        "/api/v1/auth/social/kakao/token" to { deviceId: String ->
            """{"accessToken":"sdk-access-token","ageConfirmation":{"method":"SELF_DECLARED"},"deviceId":"$deviceId"}"""
        },
    )

    @Test
    fun `deviceId 가 상한을 넘으면 두 로그인 경로 모두 400 — deviceId 검증 실패로, 500 이 아니다`() {
        loginBodies.forEach { (path, body) ->
            val (status, response) = post(path, body("d".repeat(RefreshSession.DEVICE_ID_MAX + 1)))

            withClue(path) {
                status shouldBe 400
                response["error"]["code"].asText() shouldBe "VALIDATION_ERROR"
                response["error"]["fields"].map { it["field"].asText() } shouldBe listOf("deviceId")
            }
        }
    }

    @Test
    fun `deviceId 상한이 세션 컬럼 폭과 같다 — 둘이 갈라지면 22001 → 500 이 돌아온다`() {
        val width = jdbc.queryForObject(
            "SELECT character_maximum_length FROM information_schema.columns " +
                "WHERE table_schema = current_schema() AND table_name = 'refresh_session' AND column_name = 'device_id'",
            Int::class.java,
        )

        width shouldBe RefreshSession.DEVICE_ID_MAX
    }

    @Test
    fun `deviceId 상한이 계약의 maxLength 와 같다 — 다르면 생성 클라이언트 검증과 서버가 갈린다`() {
        listOf("SocialLoginRequest", "SocialTokenLoginRequest").forEach { name ->
            @Suppress("UNCHECKED_CAST")
            val deviceId = schemaPropertySpecs(name)["deviceId"] as Map<String, Any>

            withClue(name) { deviceId["maxLength"] shouldBe RefreshSession.DEVICE_ID_MAX }
        }
    }

    @Test
    fun `deviceId 상한 길이는 두 로그인 경로 모두 받는다 — 상한 경계`() {
        loginBodies.forEach { (path, body) ->
            val (status, _) = post(path, body("d".repeat(RefreshSession.DEVICE_ID_MAX)))

            withClue(path) { status shouldBe 200 }
        }
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
            "/api/v1/auth/social/kakao",
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

        // 실행 — 같은 이메일을 가진 구글 계정으로 신규 가입을 시도한다(네이버는 code 경로를 닫았다 — TRIP-1317).
        val (status, body) = post(
            "/api/v1/auth/social/google",
            """{"authorizationCode":"$FIXED_EMAIL_MARKER-google","codeVerifier":"v","redirectUri":"trippilot://auth","ageConfirmation":{"method":"SELF_DECLARED"}}""",
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
            "/api/v1/auth/social/kakao",
            """{"authorizationCode":"code","codeVerifier":"verifier","redirectUri":"trippilot://auth"}""",
        )

        status shouldBe 400
        body["error"]["code"].asText() shouldBe "VALIDATION_ERROR"
        body["error"].has("existingProvider") shouldBe false
    }

    // ── 응답 모양 게이트(TRIP-249 5번) ────────────────────────────────────────────
    // 당시 OpenApiContractIT 는 **경로**만 봤고, TokenPair 가 7필드를 선언하는 동안 서버가 3필드만 내도 초록이었다.
    // 지금은 그 클래스의 필드 게이트가 DTO 와 스키마의 **이름**을 정적으로 대조한다(요청 본문 포함). 아래 둘은
    // 그와 별개로 **실제 응답**의 키 집합을 본다 — 정적 대조가 못 보는 런타임 생략(NON_NULL 등)까지 잡는다.

    /**
     * 501 설명이 **통째로** 계약에 실린다(TRIP-1317). `{ description: … }` 흐름 매핑 안의 평문에 쉼표가 들면
     * YAML 이 거기서 값을 끊고 나머지를 **별개의 키**로 읽는다 — 파일은 여전히 유효해서 아무것도 빨개지지 않고,
     * "어느 제공자를 왜 안 받는지"가 계약에서 조용히 사라진다(실측: 구글 쪽 설명이 그렇게 잘려 머지돼 있었다).
     */
    @Test
    fun `두 로그인 경로의 501 설명이 잘리지 않는다 — 닫아 둔 제공자를 계약이 말한다`() {
        @Suppress("UNCHECKED_CAST")
        fun response501(path: String): Map<String, Any?> {
            val spec = Yaml().load<Map<String, Any>>(ClassPathResource("static/openapi.yaml").inputStream)
            val post = ((spec["paths"] as Map<String, Any>)[path] as Map<String, Any>)["post"] as Map<String, Any>
            return (post["responses"] as Map<Any, Any>).entries.single { it.key.toString() == "501" }.value as Map<String, Any?>
        }

        val code = response501("/auth/social/{provider}")
        code.keys shouldBe setOf("description")
        code["description"].toString() shouldContain "네이버"

        val token = response501("/auth/social/{provider}/token")
        token.keys shouldBe setOf("description")
        token["description"].toString() shouldContain "구글"
    }

    /** openapi 정본에서 스키마 하나의 property 이름 집합을 읽는다. */
    private fun schemaProperties(name: String): Set<String> = schemaPropertySpecs(name).keys

    @Suppress("UNCHECKED_CAST")
    private fun schemaPropertySpecs(name: String): Map<String, Any> = OpenApiSpec.schema(name)["properties"] as Map<String, Any>

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
