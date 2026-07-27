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
 * TRIP-176 — 저장/등록 숙소 API E2E. 3경로 등록·소유 스코프(타 계정 404)·편집·삭제·검증·지오코딩.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class SavedStayApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository

    private val json = ObjectMapper()
    private val now = Instant.parse("2026-07-26T00:00:00Z")

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

    private val pinBody = """{"name":"제주 오션 리조트","registerRoute":"PIN","lat":33.24,"lng":126.56,"coordConfirmed":true}"""

    @Test
    fun `인증 없으면 401`() {
        call(HttpMethod.GET, "/api/v1/saved-stays", null).first shouldBe 401
    }

    @Test
    fun `등록(201) 후 조회·목록`() {
        val token = newToken()
        val (rc, created) = call(HttpMethod.POST, "/api/v1/saved-stays", token, pinBody)
        rc shouldBe 201
        val id = created["savedStayId"].asText()
        created["coordConfirmed"].asBoolean() shouldBe true

        call(HttpMethod.GET, "/api/v1/saved-stays/$id", token).let { (s, b) ->
            s shouldBe 200
            b["name"].asText() shouldBe "제주 오션 리조트"
        }
        call(HttpMethod.GET, "/api/v1/saved-stays", token).second.size() shouldBe 1
    }

    @Test
    fun `타 계정 리소스는 404(BR-U1-56)`() {
        val (_, created) = call(HttpMethod.POST, "/api/v1/saved-stays", newToken(), pinBody)
        val id = created["savedStayId"].asText()
        call(HttpMethod.GET, "/api/v1/saved-stays/$id", newToken()).first shouldBe 404
    }

    @Test
    fun `편집(좌표확정·메모) 200`() {
        val token = newToken()
        val id = call(HttpMethod.POST, "/api/v1/saved-stays", token,
            """{"name":"링크숙소","registerRoute":"LINK_PASTE"}""").second["savedStayId"].asText()
        val (s, b) = call(HttpMethod.PATCH, "/api/v1/saved-stays/$id", token,
            """{"name":"링크숙소","lat":33.5,"lng":126.5,"coordConfirmed":true,"memo":"체크인 15시"}""")
        s shouldBe 200
        b["coordConfirmed"].asBoolean() shouldBe true
        b["memo"].asText() shouldBe "체크인 15시"
    }

    @Test
    fun `삭제(204) 후 조회 404`() {
        val token = newToken()
        val id = call(HttpMethod.POST, "/api/v1/saved-stays", token, pinBody).second["savedStayId"].asText()
        call(HttpMethod.DELETE, "/api/v1/saved-stays/$id", token).first shouldBe 204
        call(HttpMethod.GET, "/api/v1/saved-stays/$id", token).first shouldBe 404
    }

    @Test
    fun `체크아웃이 체크인 이하면 400`() {
        val (rc, _) = call(HttpMethod.POST, "/api/v1/saved-stays", newToken(),
            """{"name":"h","registerRoute":"PIN","lat":33.5,"lng":126.5,"coordConfirmed":true,"checkIn":"2026-08-02","checkOut":"2026-08-01"}""")
        rc shouldBe 400
    }

    @Test
    fun `지오코딩은 좌표 후보 반환`() {
        val (s, b) = call(HttpMethod.GET, "/api/v1/stays/geocode?q=제주호텔", newToken())
        s shouldBe 200
        (b.size() > 0) shouldBe true
        b[0]["lat"].asDouble() shouldBe 33.4996
    }
}
