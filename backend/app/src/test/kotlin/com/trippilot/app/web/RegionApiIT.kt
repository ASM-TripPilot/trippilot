package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.ints.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.HttpMethod
import org.springframework.http.client.JdkClientHttpRequestFactory
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.web.client.RestClient
import java.time.Instant

/**
 * TRIP-358 — 행정구역 카탈로그 조회 API E2E.
 *
 * 시드(TRIP-357)와 함께 봐야 의미가 있는 것들이라 실 DB 로 돈다 — 별칭 검색은 조인 서브쿼리가
 * 실제로 도는지, 정렬은 DB 가 무엇을 돌려주는지가 전부다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class RegionApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

    private val json = ObjectMapper()

    private fun call(path: String, bearer: String?): Pair<Int, JsonNode> {
        val spec = RestClient.builder()
            .requestFactory(JdkClientHttpRequestFactory())
            .baseUrl("http://localhost:$port")
            .build()
            .method(HttpMethod.GET).uri(path)
        bearer?.let { spec.header("Authorization", "Bearer $it") }
        val res = spec.retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java)
        return res.statusCode.value() to (res.body?.takeIf { it.isNotBlank() }?.let { json.readTree(it) } ?: json.createObjectNode())
    }

    private fun newToken(): String = accessTokenIssuer.issue(
        accounts.save(
            Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, Instant.parse("2026-08-14T00:00:00Z")),
        ).id.value.toString(),
    ).value

    private fun JsonNode.names() = (0 until size()).map { this[it]["name"].asText() }
    private fun JsonNode.rowOf(name: String) = (0 until size()).map { this[it] }.first { it["name"].asText() == name }

    @Test
    fun `인증 없으면 401`() {
        call("/api/v1/regions", null).first shouldBe 401
    }

    @Test
    fun `전체 목록이 온다`() {
        val (status, body) = call("/api/v1/regions", newToken())

        status shouldBe 200
        body.size() shouldBeGreaterThan 250
        body.names().contains("홍천군") shouldBe true
    }

    /** 이 부모 티켓의 출발점이 "홍천을 고를 수 없다" 였다. 부분일치로 찾혀야 한다. */
    @Test
    fun `이름 부분일치로 찾는다`() {
        val (_, body) = call("/api/v1/regions?q=홍", newToken())

        body.names().contains("홍천군") shouldBe true
        body.names().all { "홍" in it } shouldBe true
    }

    /**
     * 광주광역시·전라남도가 폐지·통합됐다. 표준명만 보면 사용자가 익숙한 이름으로 검색해도 안 잡힌다 —
     * 별칭 테이블이 실제로 질의에 걸리는지는 여기서만 드러난다(엔티티에 연관관계가 없어 서브쿼리로 본다).
     */
    @Test
    fun `폐지된 옛 이름으로도 찾는다`() {
        val (_, body) = call("/api/v1/regions?q=전라남도", newToken())

        body.names() shouldBe listOf("전남광주통합특별시")
    }

    @Test
    fun `층으로 거르면 시군구가 섞이지 않는다`() {
        val (_, body) = call("/api/v1/regions?level=SIDO", newToken())

        body.size() shouldBe 16
        (0 until body.size()).all { body[it]["level"].asText() == "SIDO" } shouldBe true
    }

    /**
     * **`selectable` 은 잘라 내지 않고 값으로 보낸다.** 도(道)를 목록에서 지우면 화면이 시도로 묶을 때
     * `수원시` 가 어디에도 안 붙는다. 규칙의 주인은 서버이고 이 필드가 그 규칙이다.
     */
    @Test
    fun `목적지 여부가 값으로 실린다`() {
        val (_, body) = call("/api/v1/regions?q=경기", newToken())

        body.rowOf("경기도")["selectable"].asBoolean() shouldBe false
    }

    /**
     * 커버리지 0인 지역을 고르면 후보풀이 비어 일정이 조용히 빈다 — 화면이 "준비 중"을 그릴 근거다.
     *
     * **저장된 값이 아니라 지금 센 값이다**(TRIP-359). 저장하면 POI 를 쓰는 경로를 하나만 빠뜨려도
     * 아무도 실패하지 않고 화면만 계속 틀린 말을 한다.
     */
    @Test
    fun `커버리지가 POI 실측으로 실린다`() {
        val before = coverageOf("홍천군")

        jdbc.update(
            """
            INSERT INTO poi (poi_id, name_ko, lat, lng, category, region, region_code,
                             data_status, source, created_at, updated_at)
            VALUES (gen_random_uuid(), '홍천 테스트', 37.6971, 127.8888, '자연', '홍천군', '51720',
                    'ACTIVE', 'MANUAL', now(), now())
            """.trimIndent(),
        )
        try {
            coverageOf("홍천군") shouldBe before + 1

            // 시도를 고르면 그 안 시군구 POI 가 전부 후보풀이 된다 — 커버리지도 그렇게 접혀야 한다.
            coverageOf("강원특별자치도") shouldBeGreaterThan 0
        } finally {
            jdbc.update("DELETE FROM poi WHERE name_ko = '홍천 테스트'")
        }
    }

    private fun coverageOf(name: String): Int =
        call("/api/v1/regions?q=$name", newToken()).second.rowOf(name)["poiCount"].asInt()

    /** 화면이 시도로 묶어 보여준다 — 같은 시도가 흩어져 오면 묶음이 여러 번 열린다. */
    @Test
    fun `같은 시도끼리 붙어 오고 시도가 그 앞에 선다`() {
        val (_, body) = call("/api/v1/regions", newToken())

        val sidoNames = (0 until body.size()).map { body[it]["sidoName"].asText() }
        sidoNames shouldBe sidoNames.distinct().flatMap { s -> sidoNames.filter { it == s } }

        val firstOfGyeonggi = (0 until body.size()).first { body[it]["sidoName"].asText() == "경기도" }
        body[firstOfGyeonggi]["level"].asText() shouldBe "SIDO"
    }
}
