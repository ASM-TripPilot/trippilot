package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import io.kotest.matchers.collections.shouldContainExactly
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.HttpMethod
import org.springframework.http.client.JdkClientHttpRequestFactory
import org.springframework.web.client.RestClient
import java.time.Instant

/**
 * TRIP-175 — 숙소 탐색 API E2E. 스텁 콘텐츠(제주 5) + R__ 시드 최저가 → 최저가순·필터·가격 결합.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class StaySearchApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository

    private val json = ObjectMapper()
    private val now = Instant.parse("2026-07-26T00:00:00Z")

    private fun get(path: String, bearer: String?): Pair<Int, JsonNode> {
        val spec = RestClient.builder()
            .requestFactory(JdkClientHttpRequestFactory())
            .baseUrl("http://localhost:$port")
            .build()
            .method(HttpMethod.GET).uri(path)
        bearer?.let { spec.header("Authorization", "Bearer $it") }
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

    private fun ids(body: JsonNode) = body["items"].map { it["externalId"].asText() }

    @Test
    fun `인증 없으면 401`() {
        get("/api/v1/stays/search", null).first shouldBe 401
    }

    @Test
    fun `탐색은 최저가순 · 모든 항목 가격 결합(시드)`() {
        val (status, body) = get("/api/v1/stays/search", newToken())
        status shouldBe 200
        // 시드 최저가: 002=45k < 005=95k < 004=130k < 003=180k < 001=220k
        ids(body) shouldContainExactly listOf("jeju-002", "jeju-005", "jeju-004", "jeju-003", "jeju-001")
        body["items"].all { it["price"]["amount"].asLong() > 0 } shouldBe true
        body["degraded"].asBoolean() shouldBe false
    }

    @Test
    fun `amenity 필터 AND — 오션뷰는 리조트·비치호텔만`() {
        val (status, body) = get("/api/v1/stays/search?amenity=오션뷰", newToken())
        status shouldBe 200
        ids(body) shouldContainExactly listOf("jeju-003", "jeju-001") // 180k, 220k
    }

    @Test
    fun `stayType 필터 — 게스트하우스`() {
        val (_, body) = get("/api/v1/stays/search?stayType=게스트하우스", newToken())
        ids(body) shouldContainExactly listOf("jeju-002")
    }

    @Test
    fun `필터로 0건이면 완화 후보 반환(BR-U1-16)`() {
        val (_, body) = get("/api/v1/stays/search?amenity=닌텐도", newToken())
        body["items"].size() shouldBe 0
        body["filterZeroReasons"].map { it.asText() } shouldContainExactly listOf("amenity:닌텐도")
    }
}
