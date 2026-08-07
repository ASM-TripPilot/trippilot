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

        val generatedSlotCount = call(HttpMethod.GET, "/api/v1/trips/$trip/itinerary", token)
            .second["days"][0]["slots"].size()

        // isFixed·endsNextDay 를 true 로 넣어 Boolean 왕복까지 본다
        val editBody = """{"reason":"비 예보로 실내로 변경","days":[
            {"date":"2026-08-01","slots":[{"poiId":"$poi","startAt":"10:00","endAt":"01:00","isFixed":true,"endsNextDay":true}]}]}"""
        call(HttpMethod.PUT, "/api/v1/trips/$trip/itinerary", token, editBody).first shouldBe 200

        val (rc, body) = call(HttpMethod.GET, "/api/v1/trips/$trip/change-log", token)
        rc shouldBe 200
        val entry = body["entries"][0]
        entry["sourceType"].asText() shouldBe "MANUAL"
        entry["reason"].asText() shouldBe "비 예보로 실내로 변경"
        entry.has("at") shouldBe true
        // 전후 스냅숏이 jsonb 왕복(직렬화→저장→역직렬화)을 견디는지 — 이중 인코딩이면 여기서 깨진다
        val after = entry["after"]["days"][0]["slots"][0]
        after["poiId"].asText() shouldBe poi
        after["startAt"].asText() shouldBe "10:00:00"
        after["isFixed"].asBoolean() shouldBe true       // Boolean 이 문자열로 새지 않는지
        after["endsNextDay"].asBoolean() shouldBe true   // 자정 넘김 플래그도 jsonb 를 건너 살아남는지
        // before 는 "무엇이 있었는지"를 담아야 한다 — 값까지 확인(빈 껍데기면 되짚을 수 없다)
        val before = entry["before"]["days"][0]
        before["date"].asText() shouldBe "2026-08-01"
        before["slots"].size() shouldBe generatedSlotCount
    }

    @Test
    fun `여러 번 편집하면 최신순으로 쌓인다`() {
        val token = newToken()
        val trip = tripWithItinerary(token)
        val poi = poiId(token)

        // 매번 **다른** 내용으로 편집한다 — 내용이 같으면 이력을 남기지 않는 것이 의도된 동작이다
        listOf("첫 번째" to "10:00", "두 번째" to "14:00").forEach { (reason, start) ->
            val body = """{"reason":"$reason","days":[
                {"date":"2026-08-01","slots":[{"poiId":"$poi","startAt":"$start","endAt":"15:00","isFixed":false,"endsNextDay":false}]}]}"""
            call(HttpMethod.PUT, "/api/v1/trips/$trip/itinerary", token, body).first shouldBe 200
        }

        val entries = call(HttpMethod.GET, "/api/v1/trips/$trip/change-log", token).second["entries"]
        entries.size() shouldBe 2
        entries[0]["reason"].asText() shouldBe "두 번째" // 최신이 앞
    }

    @Test
    fun `사유가 500자를 넘으면 400 — 편집도 저장되지 않는다`() {
        val token = newToken()
        val trip = tripWithItinerary(token)
        val poi = poiId(token)
        val before = call(HttpMethod.GET, "/api/v1/trips/$trip/itinerary", token).second["days"][0]["slots"].size()

        val body = """{"reason":"${"가".repeat(501)}","days":[
            {"date":"2026-08-01","slots":[{"poiId":"$poi","startAt":"10:00","endAt":"11:00","isFixed":false,"endsNextDay":false}]}]}"""
        // DB varchar(500) 에 맡기면 22001 이 500 으로 새고 편집까지 롤백된다 — 트랜잭션 열기 전에 막아야 한다
        call(HttpMethod.PUT, "/api/v1/trips/$trip/itinerary", token, body).first shouldBe 400
        call(HttpMethod.GET, "/api/v1/trips/$trip/itinerary", token).second["days"][0]["slots"].size() shouldBe before
        call(HttpMethod.GET, "/api/v1/trips/$trip/change-log", token).second["entries"].size() shouldBe 0
    }

    @Test
    fun `limit 으로 타임라인 건수를 제한한다`() {
        val token = newToken()
        val trip = tripWithItinerary(token)
        val poi = poiId(token)
        listOf("하나", "둘", "셋").forEachIndexed { i, reason ->
            val body = """{"reason":"$reason","days":[
                {"date":"2026-08-01","slots":[{"poiId":"$poi","startAt":"1${i}:00","endAt":"1${i + 1}:00","isFixed":false,"endsNextDay":false}]}]}"""
            call(HttpMethod.PUT, "/api/v1/trips/$trip/itinerary", token, body).first shouldBe 200
        }
        call(HttpMethod.GET, "/api/v1/trips/$trip/change-log?limit=2", token).second["entries"].size() shouldBe 2
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
