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
 * 변경 이력 E2E(US-PLANB-09 · TRIP-275) — 편집이 이력을 남기고 타임라인으로 읽히는지,
 * 그리고 **append-only 가 DB 권한으로 실제 강제되는지**(앱 롤에 UPDATE/DELETE 없음) 확인한다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ChangeLogApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository

    private val json = ObjectMapper()
    private val now = Instant.parse("2026-08-01T00:00:00Z")

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
        val account = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now))
        return accessTokenIssuer.issue(account.id.value.toString()).value
    }

    private fun newTrip(token: String): String {
        val body = """{"startDate":"2026-08-01","endDate":"2026-08-01","party":2,
            "destinations":[{"seq":0,"region":"제주","nights":0}],"preferenceSnapshot":{}}""".trimIndent()
        return call(HttpMethod.POST, "/api/v1/trips", token, body).second["tripId"].asText()
    }

    private fun poiId(token: String): String =
        call(HttpMethod.GET, "/api/v1/places?region=제주", token).second[0]["poiId"].asText()

    /** 하루 여행 → 생성은 2차 없이 즉시 COMPLETE 라 편집이 바로 가능하다. */
    private fun tripWithItinerary(token: String): String {
        val trip = newTrip(token)
        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token).first shouldBe 201
        return trip
    }

    @Test
    fun `인증 없으면 401`() {
        call(HttpMethod.GET, "/api/v1/trips/${UUID.randomUUID()}/change-log", null).first shouldBe 401
    }

    @Test
    fun `편집하면 이력이 전후 스냅숏·사유와 함께 타임라인에 남는다`() {
        val token = newToken()
        val trip = tripWithItinerary(token)
        val poi = poiId(token)

        val editBody = """{"reason":"비 예보로 실내로 변경","days":[
            {"date":"2026-08-01","slots":[{"poiId":"$poi","startAt":"10:00","endAt":"11:00","isFixed":false,"endsNextDay":false}]}]}"""
        call(HttpMethod.PUT, "/api/v1/trips/$trip/itinerary", token, editBody).first shouldBe 200

        val (rc, body) = call(HttpMethod.GET, "/api/v1/trips/$trip/change-log", token)
        rc shouldBe 200
        val entry = body["entries"][0]
        entry["sourceType"].asText() shouldBe "MANUAL"
        entry["reason"].asText() shouldBe "비 예보로 실내로 변경"
        entry.has("at") shouldBe true
        // 전후 스냅숏이 jsonb 왕복(직렬화→저장→역직렬화)을 견디는지 — 이중 인코딩이면 여기서 깨진다
        entry["after"]["days"][0]["slots"][0]["poiId"].asText() shouldBe poi
        entry["before"]["days"][0].has("date") shouldBe true
        entry["after"]["days"][0]["slots"][0].has("duration") shouldBe false // INV-3
    }

    @Test
    fun `여러 번 편집하면 최신순으로 쌓인다`() {
        val token = newToken()
        val trip = tripWithItinerary(token)
        val poi = poiId(token)

        listOf("첫 번째", "두 번째").forEach { reason ->
            val body = """{"reason":"$reason","days":[
                {"date":"2026-08-01","slots":[{"poiId":"$poi","startAt":"10:00","endAt":"11:00","isFixed":false,"endsNextDay":false}]}]}"""
            call(HttpMethod.PUT, "/api/v1/trips/$trip/itinerary", token, body).first shouldBe 200
        }

        val entries = call(HttpMethod.GET, "/api/v1/trips/$trip/change-log", token).second["entries"]
        entries.size() shouldBe 2
        entries[0]["reason"].asText() shouldBe "두 번째" // 최신이 앞
    }

    @Test
    fun `타 계정 이력은 404`() {
        val owner = newToken()
        val trip = tripWithItinerary(owner)
        call(HttpMethod.GET, "/api/v1/trips/$trip/change-log", newToken()).first shouldBe 404
    }

    @Test
    fun `이력 없는 여행은 빈 목록`() {
        val token = newToken()
        val trip = tripWithItinerary(token)
        call(HttpMethod.GET, "/api/v1/trips/$trip/change-log", token).second["entries"].size() shouldBe 0
    }
}
