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
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.http.client.JdkClientHttpRequestFactory
import org.springframework.web.client.RestClient
import java.time.Instant

/**
 * TRIP-155 — 위치 동의 3층 E2E. 기본 상태 → L2/L3 변경 → OS 미러 → 유효 능력(G182) 반영 검증.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class LocationConsentControllerIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository

    private val json = ObjectMapper()
    private val now = Instant.parse("2026-07-19T00:00:00Z")

    private fun client() = RestClient.builder()
        .requestFactory(JdkClientHttpRequestFactory())
        .baseUrl("http://localhost:$port")
        .build()

    private fun call(method: HttpMethod, path: String, bearer: String?, body: String? = null): Pair<Int, JsonNode> {
        val spec = client().method(method).uri(path)
        bearer?.let { spec.header("Authorization", "Bearer $it") }
        body?.let { spec.contentType(MediaType.APPLICATION_JSON).body(it) }
        val res = spec.retrieve()
            .onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java)
        val parsed = res.body?.takeIf { it.isNotBlank() }?.let { json.readTree(it) } ?: json.createObjectNode()
        return res.statusCode.value() to parsed
    }

    private fun newToken(): String {
        val account = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now))
        return accessTokenIssuer.issue(account.id.value.toString()).value
    }

    @Test
    fun `기본 상태는 모든 층 비활성·능력 없음`() {
        val (status, body) = call(HttpMethod.GET, "/api/v1/me/location-consent", newToken())
        status shouldBe 200
        body["osPermissionMirror"].asText() shouldBe "NOT_DETERMINED"
        body["legalConsent"].asBoolean() shouldBe false
        body["capabilities"]["serverLocationService"].asBoolean() shouldBe false
    }

    @Test
    fun `L2·L3 동의 후 OS 권한 GRANTED 면 유효 능력 활성`() {
        val token = newToken()

        val (putStatus, putBody) = call(
            HttpMethod.PUT, "/api/v1/me/location-consent", token,
            """{"legalConsent":true,"gpsRecordingOptIn":true}""",
        )
        putStatus shouldBe 200
        putBody["capabilities"]["serverLocationService"].asBoolean() shouldBe false // L1 아직 미결정

        call(HttpMethod.PATCH, "/api/v1/me/location-consent/os-permission", token, """{"osPermission":"GRANTED"}""")
            .first shouldBe 204

        val (_, body) = call(HttpMethod.GET, "/api/v1/me/location-consent", token)
        body["capabilities"]["serverLocationService"].asBoolean() shouldBe true
        body["capabilities"]["gpsTrackRetention"].asBoolean() shouldBe true
    }

    @Test
    fun `인증 없이 접근은 401`() {
        val (status, _) = call(HttpMethod.GET, "/api/v1/me/location-consent", null)
        status shouldBe 401
    }
}
