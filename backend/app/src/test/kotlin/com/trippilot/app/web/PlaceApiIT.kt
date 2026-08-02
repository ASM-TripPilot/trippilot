package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.placedata.application.PoiCollectionService
import com.trippilot.placedata.domain.Area
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.HttpMethod
import org.springframework.http.client.JdkClientHttpRequestFactory
import org.springframework.web.client.RestClient
import java.time.Instant

/**
 * TRIP-212 — place-data 탐색 API E2E. 시드 POI 조회 + 수집 게이트(INV-1) 실증(좌표 미확보 배제) + ACTIVE-only.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class PlaceApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var collection: PoiCollectionService

    private val json = ObjectMapper()
    private val now = Instant.parse("2026-07-31T00:00:00Z")

    private fun call(path: String, bearer: String?): Pair<Int, JsonNode> {
        val spec = RestClient.builder()
            .requestFactory(JdkClientHttpRequestFactory())
            .baseUrl("http://localhost:$port")
            .build()
            .method(HttpMethod.GET).uri(path)
        bearer?.let { spec.header("Authorization", "Bearer $it") }
        val res = spec.retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java)
        val parsed = res.body?.takeIf { it.isNotBlank() }?.let { json.readTree(it) } ?: json.createObjectNode()
        return res.statusCode.value() to parsed
    }

    private fun newToken(): String {
        val account = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now))
        return accessTokenIssuer.issue(account.id.value.toString()).value
    }

    private fun JsonNode.names() = (0 until size()).map { this[it]["nameKo"].asText() }

    @Test
    fun `인증 없으면 401`() {
        call("/api/v1/places?region=제주", null).first shouldBe 401
    }

    @Test
    fun `시드된 제주 POI 조회(ACTIVE)`() {
        val (status, body) = call("/api/v1/places?region=제주", newToken())
        status shouldBe 200
        body.names().contains("성산일출봉") shouldBe true
        (0 until body.size()).all { body[it]["category"].asText().isNotBlank() } shouldBe true
    }

    @Test
    fun `수집 후 조회 — 게이트 통과분만(좌표 미확보 배제)`() {
        collection.collect(Area("부산")) // 스텁: 자갈치·해운대·감천 + 좌표없는후보(배제)
        val body = call("/api/v1/places?region=부산", newToken()).second
        val names = body.names()
        names.contains("자갈치시장") shouldBe true
        names.contains("해운대해수욕장") shouldBe true
        names.contains("좌표없는후보") shouldBe false // INV-1: 후보풀 미통과
    }

    @Test
    fun `카테고리 필터 — 부산 맛집`() {
        collection.collect(Area("부산"))
        val body = call("/api/v1/places?region=부산&category=맛집", newToken()).second
        (0 until body.size()).all { body[it]["category"].asText() == "맛집" } shouldBe true
        body.names().contains("자갈치시장") shouldBe true
    }
}
