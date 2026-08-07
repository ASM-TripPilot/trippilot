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
import org.springframework.web.client.RestClient
import java.time.Instant

/**
 * TRIP-265 — 리버스 POI read 포트 E2E. AI(M7) 경계용 `/internal/pois`(인증 필요, snake_case).
 * 시드 제주 POI(성산일출봉=자연/NATURE, 영업시간 미보유→MINIMAL) 사용.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class PoiInternalApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository

    private val json = ObjectMapper()
    private val seongsan = "e0000000-0000-4000-8000-000000000001" // 성산일출봉 33.4587,126.9427 자연

    private fun call(method: HttpMethod, path: String, bearer: String?, body: String? = null): Pair<Int, JsonNode> {
        val spec = RestClient.builder().baseUrl("http://localhost:$port").build().method(method).uri(path)
        bearer?.let { spec.header("Authorization", "Bearer $it") }
        body?.let { spec.contentType(MediaType.APPLICATION_JSON).body(it) }
        val res = spec.retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java)
        val parsed = res.body?.takeIf { it.isNotBlank() }?.let { json.readTree(it) } ?: json.createObjectNode()
        return res.statusCode.value() to parsed
    }

    private fun newToken(): String {
        val account = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, Instant.parse("2026-08-01T00:00:00Z")))
        return accessTokenIssuer.issue(account.id.value.toString()).value
    }

    @Test
    fun `인증 없으면 401`() {
        call(HttpMethod.GET, "/internal/pois?centerLat=33.4587&centerLng=126.9427&radiusKm=5", null).first shouldBe 401
    }

    @Test
    fun `batch-get — 정본 snake_case + 경계코드 + dataQuality`() {
        val token = newToken()
        val (rc, body) = call(HttpMethod.POST, "/internal/pois/batch-get", token, """{"poi_ids":["$seongsan"]}""")
        rc shouldBe 200
        val poi = body[0]
        poi["poi_id"].asText() shouldBe seongsan
        poi["name_ko"].asText() shouldBe "성산일출봉"
        poi["category"].asText() shouldBe "NATURE"        // 자연 → NATURE
        poi["data_status"].asText() shouldBe "ACTIVE"
        poi["data_quality"].asText() shouldBe "MINIMAL"   // 영업시간 미보유 → 영업일 판정 불가(AI 후보풀 제외 대상)
        poi.has("saved_count") shouldBe true
        poi.has("duration") shouldBe false                // INV-3
    }

    @Test
    fun `radius — 중심 반경 내 ACTIVE 정본`() {
        val token = newToken()
        val (rc, body) = call(HttpMethod.GET, "/internal/pois?centerLat=33.4587&centerLng=126.9427&radiusKm=3", token)
        rc shouldBe 200
        val names = (0 until body.size()).map { body[it]["name_ko"].asText() }
        names.contains("성산일출봉") shouldBe true          // 중심점
        body[0].has("distance_m") shouldBe true
    }
}
