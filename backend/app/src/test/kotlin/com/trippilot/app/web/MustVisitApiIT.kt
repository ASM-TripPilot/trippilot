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
import org.springframework.http.client.JdkClientHttpRequestFactory
import org.springframework.web.client.RestClient
import java.time.Instant

/**
 * TRIP-215 — 필수 방문지 API E2E. 시드 POI 동결→must_visit 추가·목록·삭제·중복 409·FIXED 검증·타 계정 404.
 * 여행(TRIP-177)·place-data(212)·스냅숏 동결(214)을 실제로 관통(크로스모듈 freeze).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class MustVisitApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository

    private val json = ObjectMapper()
    private val now = Instant.parse("2026-07-31T00:00:00Z")

    private fun call(method: HttpMethod, path: String, bearer: String?, body: String? = null): Pair<Int, JsonNode> {
        val spec = RestClient.builder()
            .requestFactory(JdkClientHttpRequestFactory())
            .baseUrl("http://localhost:$port")
            .build()
            .method(method).uri(path)
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

    private fun poiId(token: String): String =
        call(HttpMethod.GET, "/api/v1/places?region=제주", token).second[0]["poiId"].asText()

    @Test
    fun `인증 없으면 401`() {
        call(HttpMethod.GET, "/api/v1/trips/${java.util.UUID.randomUUID()}/must-visits", null).first shouldBe 401
    }

    @Test
    fun `필수방문지 추가(201) — 스냅숏 참조 · 목록 반영`() {
        val token = newToken()
        val trip = newTrip(token)
        val poi = poiId(token)

        val (rc, mv) = call(HttpMethod.POST, "/api/v1/trips/$trip/must-visits", token, """{"poiId":"$poi","type":"ANYTIME","dwellMin":90}""")
        rc shouldBe 201
        mv["sourcePoiId"].asText() shouldBe poi
        mv["poiSnapshotId"].asText().isNotBlank() shouldBe true

        call(HttpMethod.GET, "/api/v1/trips/$trip/must-visits", token).second.size() shouldBe 1
    }

    @Test
    fun `FIXED인데 날짜·시각 없으면 400`() {
        val token = newToken()
        val trip = newTrip(token)
        call(HttpMethod.POST, "/api/v1/trips/$trip/must-visits", token, """{"poiId":"${poiId(token)}","type":"FIXED"}""").first shouldBe 400
    }

    @Test
    fun `같은 POI 중복 추가는 409`() {
        val token = newToken()
        val trip = newTrip(token)
        val poi = poiId(token)
        call(HttpMethod.POST, "/api/v1/trips/$trip/must-visits", token, """{"poiId":"$poi","type":"ANYTIME"}""").first shouldBe 201
        call(HttpMethod.POST, "/api/v1/trips/$trip/must-visits", token, """{"poiId":"$poi","type":"ANYTIME"}""").first shouldBe 409
    }

    @Test
    fun `타 계정 여행에 추가는 404`() {
        val owner = newToken()
        val trip = newTrip(owner)
        val intruder = newToken()
        call(HttpMethod.POST, "/api/v1/trips/$trip/must-visits", intruder, """{"poiId":"${poiId(intruder)}","type":"ANYTIME"}""").first shouldBe 404
    }

    @Test
    fun `삭제(204) 후 목록 제외`() {
        val token = newToken()
        val trip = newTrip(token)
        val id = call(HttpMethod.POST, "/api/v1/trips/$trip/must-visits", token, """{"poiId":"${poiId(token)}","type":"ANYTIME"}""").second["mustVisitId"].asText()
        call(HttpMethod.DELETE, "/api/v1/trips/$trip/must-visits/$id", token).first shouldBe 204
        call(HttpMethod.GET, "/api/v1/trips/$trip/must-visits", token).second.size() shouldBe 0
    }
}
