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
import java.util.UUID

/**
 * 편집 이력·되돌리기 E2E(TRIP-310). 실 DB 로 `seq` 유일·단조(INV-U3-06)와 되돌리기 왕복을 본다.
 * 하루 여행을 쓰는 이유: 생성이 2차 없이 즉시 COMPLETE 라 편집·되돌리기를 바로 검증할 수 있다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ItineraryRevisionApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository

    private val json = ObjectMapper()

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
        val account = accounts.save(
            Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, Instant.parse("2026-08-01T00:00:00Z")),
        )
        return accessTokenIssuer.issue(account.id.value.toString()).value
    }

    private fun tripWithItinerary(token: String): String {
        val body = """{"startDate":"2026-08-01","endDate":"2026-08-01","party":2,
            "destinations":[{"seq":0,"region":"제주","nights":0}],"preferenceSnapshot":{}}""".trimIndent()
        val trip = call(HttpMethod.POST, "/api/v1/trips", token, body).second["tripId"].asText()
        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token).first shouldBe 201
        return trip
    }

    private fun poiId(token: String): String =
        call(HttpMethod.GET, "/api/v1/places?region=제주", token).second[0]["poiId"].asText()

    @Test
    fun `인증 없으면 401`() {
        call(HttpMethod.GET, "/api/v1/trips/${UUID.randomUUID()}/itinerary/revisions", null).first shouldBe 401
    }

    @Test
    fun `생성하면 BASELINE 이 남고 편집하면 EDIT 이 쌓인다 — seq 단조`() {
        val token = newToken()
        val trip = tripWithItinerary(token)
        val poi = poiId(token)

        val editBody = """{"reason":"카페 먼저 가기","days":[
            {"date":"2026-08-01","slots":[{"poiId":"$poi","startAt":"13:00","endAt":"14:00","isFixed":false,"endsNextDay":false}]}]}"""
        call(HttpMethod.PUT, "/api/v1/trips/$trip/itinerary", token, editBody).first shouldBe 200

        val (rc, body) = call(HttpMethod.GET, "/api/v1/trips/$trip/itinerary/revisions", token)
        rc shouldBe 200
        val revs = body["revisions"]
        revs.size() shouldBe 2
        revs[0]["seq"].asInt() shouldBe 2        // 최신순
        revs[0]["kind"].asText() shouldBe "EDIT"
        revs[0]["actor"].asText() shouldBe "USER"
        revs[0]["summary"].asText() shouldBe "카페 먼저 가기"
        revs[1]["seq"].asInt() shouldBe 1
        revs[1]["kind"].asText() shouldBe "BASELINE"
        revs[1]["actor"].asText() shouldBe "AI"
        revs[0].has("snapshot") shouldBe false   // 목록엔 스냅숏을 싣지 않는다
    }

    @Test
    fun `되돌리면 과거 버전이 복원되고 RESTORE 가 새로 쌓인다`() {
        val token = newToken()
        val trip = tripWithItinerary(token)
        val poi = poiId(token)
        val originalFirstStart = call(HttpMethod.GET, "/api/v1/trips/$trip/itinerary", token)
            .second["days"][0]["slots"][0]["startAt"].asText()

        val editBody = """{"days":[
            {"date":"2026-08-01","slots":[{"poiId":"$poi","startAt":"19:00","endAt":"20:00","isFixed":false,"endsNextDay":false}]}]}"""
        call(HttpMethod.PUT, "/api/v1/trips/$trip/itinerary", token, editBody).first shouldBe 200

        val baseline = call(HttpMethod.GET, "/api/v1/trips/$trip/itinerary/revisions", token)
            .second["revisions"].let { r -> (0 until r.size()).map { r[it] } }
            .first { it["kind"].asText() == "BASELINE" }

        val (rc, restored) = call(
            HttpMethod.POST,
            "/api/v1/trips/$trip/itinerary/revisions/${baseline["revisionId"].asText()}/restore", token,
        )
        rc shouldBe 200
        restored["days"][0]["slots"][0]["startAt"].asText() shouldBe originalFirstStart // 원본 복원
        restored["days"][0]["slots"][0]["nameKo"].isNull shouldBe false                 // 표면도 함께 실린다

        // 과거를 지우지 않고 RESTORE 를 쌓는다(BR-U3-32) — 되돌리기의 되돌리기가 가능하다
        val after = call(HttpMethod.GET, "/api/v1/trips/$trip/itinerary/revisions", token).second["revisions"]
        after.size() shouldBe 3
        after[0]["kind"].asText() shouldBe "RESTORE"
        after[0]["seq"].asInt() shouldBe 3
    }

    @Test
    fun `확정된 일정은 되돌리기 409`() {
        val token = newToken()
        val trip = tripWithItinerary(token)
        val rev = call(HttpMethod.GET, "/api/v1/trips/$trip/itinerary/revisions", token)
            .second["revisions"][0]["revisionId"].asText()
        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary/confirm", token).first shouldBe 200

        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary/revisions/$rev/restore", token).first shouldBe 409
    }

    @Test
    fun `타 계정은 404`() {
        val owner = newToken()
        val trip = tripWithItinerary(owner)
        call(HttpMethod.GET, "/api/v1/trips/$trip/itinerary/revisions", newToken()).first shouldBe 404
    }
}
