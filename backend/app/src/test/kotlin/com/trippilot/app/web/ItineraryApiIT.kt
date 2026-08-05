package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
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
 * TRIP-267 — 일정 생성 API E2E(첫 슬라이스). 소유 여행 날짜 기준 생성·영속(스텁 ScheduleAgent).
 * 앵커·필수방문지·취향 조립은 후속 슬라이스라 여기선 흐름(생성 201·일자 수·소유 404·INV-3)만 검증.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ItineraryApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var itineraries: ItineraryRepository

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
        val body = """{"startDate":"2026-08-01","endDate":"2026-08-02","party":2,
            "destinations":[{"seq":0,"region":"제주","nights":1}],"preferenceSnapshot":{}}""".trimIndent()
        return call(HttpMethod.POST, "/api/v1/trips", token, body).second["tripId"].asText()
    }

    @Test
    fun `인증 없으면 401`() {
        call(HttpMethod.POST, "/api/v1/trips/${UUID.randomUUID()}/itinerary", null).first shouldBe 401
    }

    @Test
    fun `생성하면 201, 여행 날짜만큼 일자 생성 + PLANNED`() {
        val token = newToken()
        val trip = newTrip(token)

        val (rc, body) = call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token, """{"generationMode":"FULLY_AI"}""")
        rc shouldBe 201
        body["status"].asText() shouldBe "PLANNED"
        body["tripId"].asText() shouldBe trip
        body["days"].size() shouldBe 2 // 08-01 ~ 08-02(체크아웃 포함)
        val slot = body["days"][0]["slots"][0]
        slot.has("startAt") shouldBe true
        slot.has("endAt") shouldBe true
        slot.has("duration") shouldBe false // INV-3: 소요시간 미노출
    }

    @Test
    fun `타 계정 여행이면 404`() {
        val owner = newToken()
        val trip = newTrip(owner)
        val intruder = newToken()
        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", intruder).first shouldBe 404
    }

    @Test
    fun `재생성하면 기존 일정 교체 — 여행당 1개`() {
        val token = newToken()
        val trip = newTrip(token)
        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token).first shouldBe 201
        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token).first shouldBe 201
        itineraries.findByTrip(UUID.fromString(trip)).size shouldBe 1
    }
}
