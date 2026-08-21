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
 * TRIP-214 — 담기(saved_place) API E2E. 담기·POI 정보·중복 409·타 계정 404. 시드된 제주 POI 사용.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class SavedPlaceApiIT : AbstractPostgresIntegrationTest() {

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

    private fun anyPoiId(token: String): String =
        call(HttpMethod.GET, "/api/v1/places?region=제주", token).second["items"][0]["poiId"].asText()

    @Test
    fun `인증 없으면 401`() {
        call(HttpMethod.GET, "/api/v1/saved-places", null).first shouldBe 401
    }

    @Test
    fun `담기(201) — POI 정보 포함 · 목록 반영`() {
        val token = newToken()
        val poiId = anyPoiId(token)

        val (rc, saved) = call(HttpMethod.POST, "/api/v1/saved-places", token, """{"poiId":"$poiId"}""")
        rc shouldBe 201
        saved["place"]["poiId"].asText() shouldBe poiId
        saved["place"]["nameKo"].asText().isNotBlank() shouldBe true

        val list = call(HttpMethod.GET, "/api/v1/saved-places", token).second
        (0 until list.size()).any { list[it]["place"]["poiId"].asText() == poiId } shouldBe true
    }

    @Test
    fun `이미 담은 POI 재담기는 409`() {
        val token = newToken()
        val poiId = anyPoiId(token)
        call(HttpMethod.POST, "/api/v1/saved-places", token, """{"poiId":"$poiId"}""").first shouldBe 201
        call(HttpMethod.POST, "/api/v1/saved-places", token, """{"poiId":"$poiId"}""").first shouldBe 409
    }

    @Test
    fun `없는 POI 담기는 404`() {
        call(HttpMethod.POST, "/api/v1/saved-places", newToken(), """{"poiId":"00000000-0000-4000-8000-000000009999"}""").first shouldBe 404
    }

    @Test
    fun `타 계정 담기 항목 해제는 404`() {
        val owner = newToken()
        val poiId = anyPoiId(owner)
        val savedPlaceId = call(HttpMethod.POST, "/api/v1/saved-places", owner, """{"poiId":"$poiId"}""").second["savedPlaceId"].asText()
        call(HttpMethod.DELETE, "/api/v1/saved-places/$savedPlaceId", newToken()).first shouldBe 404
    }

    /**
     * TRIP-219 — image_url·tags(text[]) 왕복. 마이그레이션·Hibernate ARRAY 매핑·DTO·직렬화를 한 번에 태운다.
     * 매핑이 깨지면 여기서 떨어진다(단위 테스트는 InMemory 리포지토리라 text[] 를 못 잡는다).
     */
    @Test
    fun `장소 응답에 tags 배열과 imageUrl 이 실린다`() {
        val token = newToken()
        val place = call(HttpMethod.GET, "/api/v1/places?region=제주", token).second["items"][0]

        place["tags"].isArray shouldBe true
        // 개수를 못박지 않는다 — 태그 수는 시드 내용이라 여기 관심사가 아니다(매핑이 도는지만 본다).
        place["tags"].isEmpty shouldBe false
        place["imageUrl"].isNull shouldBe true   // 실 수집 전이라 NULL(기본 이미지를 지어내지 않는다)
    }
}
