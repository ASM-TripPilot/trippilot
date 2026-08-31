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
import org.springframework.http.MediaType
import org.springframework.test.context.TestPropertySource
import org.springframework.web.client.RestClient
import java.time.Instant
import java.util.UUID

/**
 * AI 페르소나 재조회 경계 E2E(TRIP-434 선행). `/internal/users/{accountId}/persona`.
 *
 * 취향 저장은 실제 공개 표면(`PUT /api/v1/me/preferences`)으로 넣는다 — 리포지토리에 직접 쓰면
 * 웹 계층의 검증·매핑을 건너뛰어 "저장은 되는데 조회가 다른 모양"인 상태를 못 본다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestPropertySource(properties = ["trippilot.service-auth.token=" + SERVICE_TOKEN])
class PersonaInternalApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository

    private val json = ObjectMapper()

    private fun client() = RestClient.builder().baseUrl("http://localhost:$port").build()

    private fun newAccount(): Pair<UUID, String> {
        val account = accounts.save(
            Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, Instant.parse("2026-08-01T00:00:00Z")),
        )
        return account.id.value to accessTokenIssuer.issue(account.id.value.toString()).value
    }

    /** 서비스 토큰으로 페르소나를 읽는다. */
    private fun persona(accountId: String, serviceToken: String? = SERVICE_TOKEN): Pair<Int, JsonNode> {
        val spec = client().get().uri("/internal/users/$accountId/persona")
        serviceToken?.let { spec.header("X-Service-Token", it) }
        val res = spec.retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java)
        val parsed = res.body?.takeIf { it.isNotBlank() }?.let { json.readTree(it) } ?: json.createObjectNode()
        return res.statusCode.value() to parsed
    }

    private fun putPreferences(userJwt: String, body: String): Int =
        client().put().uri("/api/v1/me/preferences")
            .header("Authorization", "Bearer $userJwt")
            .contentType(MediaType.APPLICATION_JSON).body(body)
            .retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java).statusCode.value()

    @Test
    fun `저장한 취향이 우리 어휘 그대로 snake_case 로 나간다`() {
        val (accountId, userJwt) = newAccount()
        putPreferences(
            userJwt,
            """{"styles":["휴양","자연"],"activities":["카페"],"transportModes":["도보"],
                "foodTastes":["한식"],"pace":"느긋하게","companionTypes":["혼자","커플"],
                "petFlag":true,"budgetTier":"중간"}""",
        ) shouldBe 200

        val (status, body) = persona(accountId.toString())

        status shouldBe 200
        // AI 와이어의 preference_profile 과 **같은 이름**이어야 변환기를 한 벌만 둔다.
        body.fieldNames().asSequence().toSet() shouldBe setOf(
            "styles", "activities", "food_tastes", "transport_modes",
            "pace", "companion_types", "pet_friendly", "budget_tier",
        )
        // 어휘 변환은 AI 소관이다 — 우리가 REST·SOLO·LOW 로 바꿔 내지 않는다.
        body["styles"].map { it.asText() } shouldBe listOf("휴양", "자연")
        body["companion_types"].map { it.asText() } shouldBe listOf("혼자", "커플")
        body["budget_tier"].asText() shouldBe "중간"
        body["pet_friendly"].asBoolean() shouldBe true
        body["pace"].asText() shouldBe "느긋하게"
    }

    @Test
    fun `미설정 계정은 중립 기본값이 아니라 선택 없음을 그대로 낸다`() {
        val (accountId, _) = newAccount()

        val (status, body) = persona(accountId.toString())

        status shouldBe 200
        // 중립 기본값(예: transportModes=[대중교통])을 여기서 주입하면 AI 가 "사용자가 고른 것"과
        // "우리가 채운 것"을 구분하지 못한다 — 소프트 가중치 판단이 거짓 입력 위에서 돈다(INV-PR2).
        body["styles"].isEmpty shouldBe true
        body["transport_modes"].isEmpty shouldBe true
        body["budget_tier"].isNull shouldBe true
        body["pet_friendly"].asBoolean() shouldBe false
    }

    /**
     * TRIP-393 — 서비스 경계는 사용자 토큰으로 열리지 않는다. 계정 스코프가 없는 호출이라
     * 사용자 토큰을 흉내 내면 감사 로그의 "누가 했나"가 거짓이 된다.
     */
    @Test
    fun `사용자 JWT 로는 페르소나 경계를 통과할 수 없다`() {
        val (accountId, userJwt) = newAccount()

        val status = client().get().uri("/internal/users/$accountId/persona")
            .header("Authorization", "Bearer $userJwt")
            .retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java).statusCode.value()

        (status == 401 || status == 403) shouldBe true
    }

    @Test
    fun `서비스 토큰이 없으면 통과할 수 없다`() {
        val (accountId, _) = newAccount()

        val status = persona(accountId.toString(), serviceToken = null).first

        (status == 401 || status == 403) shouldBe true
    }

    @Test
    fun `UUID 가 아닌 accountId 는 400 이다 — 500 이면 AI 가 자기 버그를 우리 장애로 읽는다`() {
        val (status, body) = persona("not-a-uuid")

        status shouldBe 400
        body["error"]["code"].asText() shouldBe "VALIDATION_ERROR"
    }
}
