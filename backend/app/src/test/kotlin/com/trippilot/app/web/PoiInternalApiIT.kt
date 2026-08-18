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
 * 시드 제주 POI(성산일출봉=자연/NATURE, image·영업시간 미보유→PARTIAL) 사용.
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
        poi["data_quality"].asText() shouldBe "PARTIAL"   // 사진·영업시간 미보유
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

    /**
     * 수집 등록 제안 수신 — **AI 산출 `collected_pois.json` 의 모양 그대로**를 태운다.
     *
     * 아래 본문은 `ai/.../sourcing/pipeline.py` 의 `to_output_document`(schema_version 1)에서 그대로 옮긴 것이다.
     * 상대가 스키마를 바꾸면 이 테스트가 먼저 깨져야 한다 — 실 파일로 넣어 보고 나서야 아는 것보다 낫다.
     */
    @Test
    fun `등록 제안을 받아 게이트를 태우고 저장한다 · 재수신은 행을 늘리지 않는다`() {
        val token = newToken()
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
        val token = newToken()
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
        val token = newToken()
        val doc = """{"schema_version":1,"source":"NAVER_MAP","proposals":[]}"""

        call(HttpMethod.POST, "/internal/pois/proposals", token, doc).first shouldBe 400
    }

    @Test
    fun `제안 수신도 인증이 필요하다`() {
        call(HttpMethod.POST, "/internal/pois/proposals", null, """{"source":"TOURAPI","proposals":[]}""")
            .first shouldBe 401
    }

}
