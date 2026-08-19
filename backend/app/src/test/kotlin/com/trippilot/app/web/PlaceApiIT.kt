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
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.http.HttpMethod
import org.springframework.http.client.JdkClientHttpRequestFactory
import org.springframework.web.client.RestClient
import java.time.Instant

/**
 * TRIP-212 — place-data 탐색 API E2E. 시드 POI 조회 + 수집 게이트(INV-1) 실증(좌표 미확보 배제) + ACTIVE-only.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class PlaceApiIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var cleanupJdbc: JdbcTemplate

    /**
     * **넣은 것을 치운다.** Testcontainers 는 전 IT 가 공유하는 싱글톤이고, 여기 쓰기는 트랜잭션
     * 롤백이 닿지 않는다. 수집 스텁이 만드는 행은 시드와 **이름이 같아** 후보풀에 같은 장소가 두 벌 쌓인다.
     *
     * 무서운 점은 발현 시점이다 — 테스트를 **추가하기만 해도** 실행 순서가 바뀌어 몇 달 잠복하던
     * 오염이 무관한 PR 에서 터진다(PR #241 실측).
     */
    @AfterEach
    fun cleanUpOwnRows() {
        cleanupJdbc.update("DELETE FROM poi WHERE source = 'MANUAL' AND source_ref IS NULL AND poi_id::text NOT LIKE 'e0000000-%'")
    }

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
