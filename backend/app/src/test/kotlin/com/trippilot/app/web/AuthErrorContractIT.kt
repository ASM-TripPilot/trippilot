package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotBeBlank
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.http.client.JdkClientHttpRequestFactory
import org.springframework.web.client.RestClient
import java.util.UUID

/**
 * 인증 에러 계약 정합(TRIP-249).
 *
 * ⚠ **가짜 소셜 포트를 쓰지 않는다.** `SocialLoginControllerIT` 는 `@Primary` 로 포트를 대체해
 * 실제 어댑터 경로를 타지 않는다 — 그러면 "Apple 이 어떤 실패로 나가는가"를 잴 수 없다.
 * 여기서는 실물 배선 그대로 태운다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AuthErrorContractIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    private val json = ObjectMapper()

    private fun call(method: HttpMethod, path: String, body: String? = null): Pair<Int, JsonNode> {
        val spec = RestClient.builder()
            .requestFactory(JdkClientHttpRequestFactory())
            .baseUrl("http://localhost:$port")
            .build()
            .method(method).uri(path)
        body?.let { spec.contentType(MediaType.APPLICATION_JSON).body(it) }
        val res = spec.retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java)
        val parsed = res.body?.takeIf { it.isNotBlank() }?.let { json.readTree(it) } ?: json.createObjectNode()
        return res.statusCode.value() to parsed
    }

    private val appleBody =
        """{"authorizationCode":"code","codeVerifier":"verifier","redirectUri":"trippilot://auth",
            "ageConfirmation":{"method":"SELF_DECLARED"}}"""

    /**
     * **공개 프리픽스**(`/api/v1/auth/social/` 하위)에서 잰다. 티켓이 500 을 실측한 자리가 거기다
     *
     * ⚠ 주석에 `social/` + 별표 두 개를 그대로 쓰면 **Kotlin 이 중첩 주석 시작으로 읽어** 파일 끝까지
     * 주석이 된다(실측으로 컴파일이 깨졌다). 경로 와일드카드는 문장으로 쓴다.
     * (`POST /api/v1/auth/social/google/token` — 라우트가 없던 시점).
     *
     * 보호 경로에서는 시큐리티가 핸들러 이전에 401 을 낸다 — 그건 **올바른 동작**이라(미인증자에게
     * 경로 존재를 알리지 않는다) 아래 별도 테스트로 함께 못 박는다.
     */
    @Test
    fun `공개 프리픽스의 매핑 없는 경로는 404 다 — 500 이면 클라가 서버 장애로 오인한다`() {
        val (status, body) = call(HttpMethod.GET, "/api/v1/auth/social/does-not-exist-${UUID.randomUUID()}/nope")

        // 500 이면 프론트의 재시도·폴백 판단이 5xx 기준으로 갈려 **잘못된 갈래를 탄다**.
        status shouldBe 404
        body["error"]["code"].asText() shouldBe "RESOURCE_NOT_FOUND"
        // ADR-0011 — 미처리도 봉투를 지킨다.
        body["error"]["traceId"].asText().shouldNotBeBlank()
    }

    @Test
    fun `보호 경로의 매핑 없는 경로는 401 이다 — 경로 존재를 알리지 않는다`() {
        // 404 로 바꾸면 미인증자가 "어떤 경로가 있는지"를 훑을 수 있다. 여기서는 401 이 맞다.
        call(HttpMethod.GET, "/api/v1/nope-${UUID.randomUUID()}").first shouldBe 401
    }

    @Test
    fun `애플 로그인은 501 — 자격 증명 실패(401)와 갈린다`() {
        val (status, body) = call(HttpMethod.POST, "/api/v1/auth/social/apple", appleBody)

        // 401 이면 앱이 "다시 시도"를 권하고 사용자는 같은 실패를 반복한다.
        // 재시도로 풀리지 않는 상태라 **미지원**으로 말해야 한다.
        status shouldBe 501
        body["error"]["code"].asText() shouldBe "PROVIDER_NOT_SUPPORTED"
    }

    @Test
    fun `애플 SDK 토큰 로그인도 501 이다`() {
        val (status, body) = call(
            HttpMethod.POST, "/api/v1/auth/social/apple/token", """{"accessToken":"token"}""",
        )

        status shouldBe 501
        body["error"]["code"].asText() shouldBe "PROVIDER_NOT_SUPPORTED"
    }

    @Test
    fun `미지원 사유는 본문에 새지 않는다 — 가용성만 말한다(SECURITY-15)`() {
        val body = call(HttpMethod.POST, "/api/v1/auth/social/apple", appleBody).second

        val message = body["error"]["message"].asText()
        // JWKS·서명검증 같은 내부 사정을 노출하면 공격자에게 구현 상태를 알려 준다.
        listOf("JWKS", "서명", "id_token", "aud", "iss").forEach { secret ->
            message.contains(secret, ignoreCase = true) shouldBe false
        }
    }
}
