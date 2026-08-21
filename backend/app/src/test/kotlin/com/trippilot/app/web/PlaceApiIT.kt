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
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.collections.shouldNotContain
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
    /**
     * **동명이구가 섞이지 않는다**(TRIP-503).
     *
     * 이름(`poi.region`)으로 거르던 시절, `동구` 는 대전·대구·광주·부산에 모두 있어 네 도시가 한 목록에
     * 섞여 나왔다(실측 118건). 사용자가 대전 동구를 골라도 부산 것이 보인다 — 상한 문제가 아니라
     * **틀린 결과**다. 코드 접두사로 거르면 그 이름을 가진 지역들만 정확히 모인다.
     *
     * 실 DB 로만 확인되는 이유: 인메모리 대역은 우리가 넣은 것만 들고 있어 **섞일 다른 도시가 없다.**
     */
    @Test
    fun `같은 이름의 다른 도시 장소가 섞이지 않는다`() {
        val token = newToken()
        val 부산동구 = seedPoi("코드검증-부산동구", 35.13, 129.05, "26170")
        val 대구동구 = seedPoi("코드검증-대구동구", 35.88, 128.63, "27140")

        try {
            val 부산 = call("/api/v1/places?region=부산", token).second.names()
            val 대구 = call("/api/v1/places?region=대구", token).second.names()

            부산 shouldContain "코드검증-부산동구"
            부산 shouldNotContain "코드검증-대구동구"
            대구 shouldContain "코드검증-대구동구"
            대구 shouldNotContain "코드검증-부산동구"
        } finally {
            cleanupJdbc.update("DELETE FROM poi WHERE poi_id in (?, ?)", 부산동구, 대구동구)
        }
    }

    /**
     * **시도를 고르면 그 안 시군구가 전부 잡힌다** — 코드 접두사라 성립한다.
     * 이름 일치 시절에는 적재분 `region` 이 시군구명이라 광역 조회가 거의 비었다(실측 부산 8/149).
     */
    @Test
    fun `시도로 조회하면 하위 시군구 장소까지 잡힌다`() {
        val token = newToken()
        val id = seedPoi("코드검증-해운대", 35.16, 129.16, "26350")

        try {
            call("/api/v1/places?region=부산", token).second.names() shouldContain "코드검증-해운대"
        } finally {
            cleanupJdbc.update("DELETE FROM poi WHERE poi_id = ?", id)
        }
    }

    /** 모르는 이름에 전국을 돌려주면 화면이 그것을 "그 지역 장소"로 표시한다 — 없다고 말하는 편이 맞다. */
    @Test
    fun `모르는 지역명은 빈 목록이다`() {
        call("/api/v1/places?region=Paris", newToken()).second.size() shouldBe 0
    }

    /** 정렬이 결정적이어야 뒤에 붙일 페이지네이션(TRIP-502)이 성립한다 — 없으면 행이 중복·누락된다. */
    @Test
    fun `같은 조회는 같은 순서를 준다`() {
        val token = newToken()

        val first = call("/api/v1/places?region=제주", token).second.names()
        val second = call("/api/v1/places?region=제주", token).second.names()

        first shouldBe second
        first shouldBe first.sorted()
    }

    /** 지역 코드를 직접 심는다 — 수집 경로는 코드를 붙이지만 이 테스트가 보려는 것은 조회 규칙이다. */
    private fun seedPoi(name: String, lat: Double, lng: Double, regionCode: String): java.util.UUID {
        val id = java.util.UUID.randomUUID()
        cleanupJdbc.update(
            """
            INSERT INTO poi (poi_id, name_ko, lat, lng, category, region, region_code, data_status, source)
            VALUES (?, ?, ?, ?, '명소', '동구', ?, 'ACTIVE', 'MANUAL')
            """.trimIndent(),
            id, name, lat, lng, regionCode,
        )
        return id
    }

}
