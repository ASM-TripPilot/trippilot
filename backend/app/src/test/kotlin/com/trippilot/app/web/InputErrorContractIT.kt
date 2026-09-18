package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotBeBlank
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.TestPropertySource
import org.springframework.web.client.RestClient
import java.time.Instant
import java.util.UUID

/**
 * 클라이언트 입력 오류가 **4xx 로 나가는가**(UUID-PATH-400).
 *
 * 실측(2026-09-01, 수정 전): 아래 셋이 전부 `500 INTERNAL` 이었다.
 * - `GET /api/v1/trips/not-a-uuid` — 경로변수 타입 변환 실패
 * - `GET /internal/pois?centerLat=abc…` — 쿼리 타입 변환 실패
 * - `GET /internal/pois` 에서 `radiusKm` 누락 — 필수 파라미터 누락
 *
 * 왜 중요한가: 프론트·AI 의 재시도·폴백 판단이 5xx 기준으로 갈린다. 자기 입력이 틀린 것을
 * 서버 장애로 읽으면 **잘못된 갈래를 탄다** — TRIP-249 3번(미매핑 경로 500)과 같은 실패 형태다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestPropertySource(properties = ["trippilot.service-auth.token=" + SERVICE_TOKEN])
class InputErrorContractIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository

    private val json = ObjectMapper()

    private fun newToken(): String {
        val account = accounts.save(
            Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, Instant.parse("2026-08-01T00:00:00Z")),
        )
        return accessTokenIssuer.issue(account.id.value.toString()).value
    }

    /** 사용자 JWT 로 부르는 공개 표면. */
    private fun asUser(path: String): Pair<Int, JsonNode> = call(path, "Authorization" to "Bearer ${newToken()}")

    /** 서비스 토큰으로 부르는 내부 경계. */
    private fun asService(path: String): Pair<Int, JsonNode> = call(path, "X-Service-Token" to SERVICE_TOKEN)

    private fun call(path: String, header: Pair<String, String>): Pair<Int, JsonNode> {
        val res = RestClient.builder().baseUrl("http://localhost:$port").build()
            .get().uri(path).header(header.first, header.second)
            .retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java)
        val parsed = res.body?.takeIf { it.isNotBlank() }?.let { json.readTree(it) } ?: json.createObjectNode()
        return res.statusCode.value() to parsed
    }

    @Test
    fun `UUID 경로변수가 형식에 안 맞으면 400 이다`() {
        val (status, body) = asUser("/api/v1/trips/not-a-uuid")

        status shouldBe 400
        body["error"]["code"].asText() shouldBe "VALIDATION_ERROR"
        // 어느 파라미터가 문제인지 알려야 클라이언트가 고칠 수 있다.
        body["error"]["fields"][0]["field"].asText() shouldBe "tripId"
        // ADR-0011 — 봉투는 어떤 갈래로 가든 지킨다.
        body["error"]["traceId"].asText().shouldNotBeBlank()
    }

    @Test
    fun `숫자 쿼리가 형식에 안 맞으면 400 이다`() {
        val (status, body) = asService("/internal/pois?centerLat=abc&centerLng=126.9&radiusKm=3")

        status shouldBe 400
        body["error"]["code"].asText() shouldBe "VALIDATION_ERROR"
        body["error"]["fields"][0]["field"].asText() shouldBe "centerLat"
    }

    @Test
    fun `필수 쿼리가 없으면 400 이다`() {
        val (status, body) = asService("/internal/pois?centerLat=33.4&centerLng=126.9")

        status shouldBe 400
        body["error"]["code"].asText() shouldBe "VALIDATION_ERROR"
        body["error"]["fields"][0]["field"].asText() shouldBe "radiusKm"
    }

    /**
     * 보낸 값을 응답에 되비추지 않는다(SECURITY-15). 어느 파라미터인지만 알리면 고칠 수 있고,
     * 임의 문자열을 그대로 반사하면 응답이 입력의 통로가 된다.
     */
    @Test
    fun `틀린 값 자체는 응답에 실리지 않는다`() {
        val marker = "probe-${UUID.randomUUID()}"

        val body = asUser("/api/v1/trips/$marker").second

        body.toString().contains(marker) shouldBe false
    }

    /**
     * 대조군 — 이 변경이 **정상 요청**이나 다른 4xx 갈래를 건드리지 않았다.
     * 형식이 맞는 UUID 는 타입변환을 통과하므로 여기 오지 않고 도메인 판정(404)으로 간다.
     */
    @Test
    fun `형식이 맞는 UUID 는 400 이 아니라 도메인 판정으로 간다`() {
        val (status, _) = asUser("/api/v1/trips/${UUID.randomUUID()}")

        (status == 400) shouldBe false
    }

    /** 대조군 — 매핑 없는 경로의 404 는 그대로다(TRIP-249 3번 회귀 금지). */
    @Test
    fun `매핑 없는 경로는 여전히 404 다`() {
        val (status, body) = call(
            "/api/v1/auth/social/does-not-exist-${UUID.randomUUID()}/nope",
            "X-Service-Token" to SERVICE_TOKEN,
        )

        status shouldBe 404
        body["error"]["code"].asText() shouldBe "RESOURCE_NOT_FOUND"
    }
}
