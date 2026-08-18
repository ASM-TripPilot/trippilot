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
import org.springframework.test.context.TestPropertySource
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.web.client.RestClient
import java.time.Instant

/**
 * TRIP-265 — 리버스 POI read 포트 E2E. AI(M7) 경계용 `/internal/pois`(인증 필요, snake_case).
 * 시드 제주 POI(성산일출봉=자연/NATURE, image·영업시간 미보유→PARTIAL) 사용.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestPropertySource(properties = ["trippilot.service-auth.token=" + SERVICE_TOKEN])
class PoiInternalApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository

    private val json = ObjectMapper()
    private val seongsan = "e0000000-0000-4000-8000-000000000001" // 성산일출봉 33.4587,126.9427 자연

    private fun call(method: HttpMethod, path: String, bearer: String?, body: String? = null): Pair<Int, JsonNode> {
        val spec = RestClient.builder().baseUrl("http://localhost:$port").build().method(method).uri(path)
        bearer?.let { spec.header("X-Service-Token", it) }   // /internal 은 서비스 토큰만 받는다(TRIP-393)
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

    /**
     * TRIP-393 — 서비스 경계는 **사용자 토큰으로 열리지 않는다**. 계정 스코프가 없는 호출이라
     * 사용자 토큰을 흉내 내면 감사 로그의 "누가 했나"가 거짓이 된다.
     */
    @Test
    fun `사용자 JWT 로는 서비스 경계를 통과할 수 없다`() {
        val userJwt = newToken()
        val spec = RestClient.builder().baseUrl("http://localhost:$port").build()
            .get().uri("/internal/pois?centerLat=33.4587&centerLng=126.9427&radiusKm=3")
            .header("Authorization", "Bearer $userJwt")
        val rc = spec.retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java).statusCode.value()

        rc shouldBe 403   // 인증은 됐으나 권한이 없다 — 401(무인증)과 구분된다
    }

    // 토큰 비교가 무력화돼도(항상 참) 위 테스트들은 전부 통과한다 — 그래서 **틀린 토큰**을 따로 밀어 본다.
    @Test
    fun `틀린 서비스 토큰은 거부된다`() {
        call(HttpMethod.GET, "/internal/pois?centerLat=33.4587&centerLng=126.9427&radiusKm=3", "wrong-token")
            .first shouldBe 401

        call(HttpMethod.POST, "/internal/pois/proposals", "wrong-token", """{"source":"TOURAPI","proposals":[]}""")
            .first shouldBe 401
    }

    // 길이가 다른 토큰도 같은 경로로 거부된다(상수 시간 비교가 길이 차이에서 일찍 빠지지 않게).
    @Test
    fun `길이가 다른 토큰도 거부된다`() {
        call(HttpMethod.GET, "/internal/pois?centerLat=33.4587&centerLng=126.9427&radiusKm=3", "x")
            .first shouldBe 401
    }

    @Test
    fun `인증 없으면 401`() {
        call(HttpMethod.GET, "/internal/pois?centerLat=33.4587&centerLng=126.9427&radiusKm=5", null).first shouldBe 401
    }

    @Test
    fun `batch-get — 정본 snake_case + 경계코드 + dataQuality`() {
        val token = SERVICE_TOKEN
        val (rc, body) = call(HttpMethod.POST, "/internal/pois/batch-get", token, """{"poi_ids":["$seongsan"]}""")
        rc shouldBe 200
        val poi = body[0]
        poi["poi_id"].asText() shouldBe seongsan
        poi["name_ko"].asText() shouldBe "성산일출봉"
        poi["category"].asText() shouldBe "NATURE"        // 자연 → NATURE
        poi["data_status"].asText() shouldBe "ACTIVE"
        poi["data_quality"].asText() shouldBe "PARTIAL"   // 사진·영업시간 미보유
        poi.has("saved_count") shouldBe true
        poi.has("duration") shouldBe false                // INV-3
    }

    @Test
    fun `radius — 중심 반경 내 ACTIVE 정본`() {
        val token = SERVICE_TOKEN
        val (rc, body) = call(HttpMethod.GET, "/internal/pois?centerLat=33.4587&centerLng=126.9427&radiusKm=3", token)
        rc shouldBe 200
        val names = (0 until body.size()).map { body[it]["name_ko"].asText() }
        names.contains("성산일출봉") shouldBe true          // 중심점
        body[0].has("distance_m") shouldBe true
    }

    /**
     * 수집 등록 제안 수신 — **AI 산출 `collected_pois.json` 의 모양 그대로**를 태운다.
     *
     * 아래 본문은 `ai/.../sourcing/pipeline.py` 의 `to_output_document`(schema_version 1)에서 그대로 옮긴 것이다.
     * 상대가 스키마를 바꾸면 이 테스트가 먼저 깨져야 한다 — 실 파일로 넣어 보고 나서야 아는 것보다 낫다.
     */
    @Test
    fun `등록 제안을 받아 게이트를 태우고 저장한다 · 재수신은 행을 늘리지 않는다`() {
        val token = SERVICE_TOKEN
        val doc = """
            {"schema_version":1,"source":"TOURAPI","collected_at":"2026-08-18T04:00:00+09:00",
             "area_code":"39","content_types":["12"],"stats":{"passed":1},
             "proposals":[
               {"provisional_id":"11111111-1111-4111-8111-111111111111","source":"TOURAPI",
                "poi":{"poi_id":"11111111-1111-4111-8111-111111111111","name":"수신테스트폭포",
                       "category":"NATURE","coord":{"lat":33.2447,"lng":126.5590},
                       "open_hours":[],"avg_cost":null,"rating":null},
                "tags":["폭포","산책"],"region":"서귀포시","opening_hours_raw":"09:00~22:00",
                "provenance":{"content_id":"E2E-126508","content_type_id":"12",
                              "address":"제주특별자치도 서귀포시","image_url":null,
                              "modified_time":"20260818000000"}}]}
        """.trimIndent()

        val (rc, first) = call(HttpMethod.POST, "/internal/pois/proposals", token, doc)
        rc shouldBe 200
        first["registered"].asInt() shouldBe 1
        first["updated"].asInt() shouldBe 0

        // 실제로 후보풀에 들어갔는지 — 조회 경로로 확인한다(응답 숫자만 믿지 않는다).
        val (_, nearby) = call(
            HttpMethod.GET,
            "/internal/pois?centerLat=33.2447&centerLng=126.5590&radiusKm=1",
            token,
        )
        nearby.any { it["name_ko"].asText() == "수신테스트폭포" } shouldBe true

        // 같은 문서를 다시 넣어도 늘지 않는다 — 수집은 매일 돈다.
        val (_, second) = call(HttpMethod.POST, "/internal/pois/proposals", token, doc)
        second["registered"].asInt() shouldBe 0
        second["updated"].asInt() shouldBe 1
    }

    @Test
    fun `우리 어휘에 없는 카테고리는 사유와 함께 탈락한다`() {
        val token = SERVICE_TOKEN
        // STAY 는 AI 내부 전용이라 우리 8종에 없다 — 가까운 값으로 밀어 넣지 않는다.
        val doc = """
            {"schema_version":1,"source":"TOURAPI","proposals":[
              {"poi":{"name":"어떤숙소","category":"STAY","coord":{"lat":33.5,"lng":126.5}},
               "provenance":{"content_id":"E2E-STAY-1"}}]}
        """.trimIndent()

        val (rc, body) = call(HttpMethod.POST, "/internal/pois/proposals", token, doc)

        rc shouldBe 200
        body["registered"].asInt() shouldBe 0
        body["dropped"]["unknown_category"].asInt() shouldBe 1
    }

    @Test
    fun `모르는 출처는 400 — 임의로 가정하지 않는다`() {
        val token = SERVICE_TOKEN
        val doc = """{"schema_version":1,"source":"NAVER_MAP","proposals":[]}"""

        call(HttpMethod.POST, "/internal/pois/proposals", token, doc).first shouldBe 400
    }

    @Test
    fun `제안 수신도 인증이 필요하다`() {
        call(HttpMethod.POST, "/internal/pois/proposals", null, """{"source":"TOURAPI","proposals":[]}""")
            .first shouldBe 401
    }

}
