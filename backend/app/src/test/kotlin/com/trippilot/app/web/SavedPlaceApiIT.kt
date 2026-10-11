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

    /** 담기 목록의 장소도 같은 매핑을 탄다 — 저장 장소를 목적지 코드로 맞추는 쪽이 이 목록이다(TRIP-1042). */
    @Test
    fun `담기 목록의 장소에도 regionCode 키가 실린다`() {
        val token = newToken()
        val poiId = anyPoiId(token)
        call(HttpMethod.POST, "/api/v1/saved-places", token, """{"poiId":"$poiId"}""").first shouldBe 201

        val place = call(HttpMethod.GET, "/api/v1/saved-places", token).second[0]["place"]

        place.has("regionCode") shouldBe true
    }

    // ── 단건 상세(TRIP-824) ─────────────────────────────────────────────

    /** 상세는 목록과 **같은 모양·같은 값**이다 — 따로 조립하면 두 화면이 같은 장소를 다르게 그린다. */
    @Test
    fun `장소 단건은 목록의 그 장소와 똑같이 나온다`() {
        val token = newToken()
        val listed = call(HttpMethod.GET, "/api/v1/places?region=제주", token).second["items"][0]

        val (status, place) = call(HttpMethod.GET, "/api/v1/places/${listed["poiId"].asText()}", token)

        status shouldBe 200
        place shouldBe listed
    }

    @Test
    fun `없는 장소는 404 · 형식이 깨진 id 는 400 · 인증이 없으면 401`() {
        val token = newToken()

        call(HttpMethod.GET, "/api/v1/places/00000000-0000-4000-8000-000000009999", token).first shouldBe 404
        call(HttpMethod.GET, "/api/v1/places/not-a-uuid", token).first shouldBe 400
        call(HttpMethod.GET, "/api/v1/places/00000000-0000-4000-8000-000000009999", null).first shouldBe 401
    }

    /**
     * 목록에서 사라진 장소도 상세는 열린다. 담아 둔 곳이 폐업하면 목록(ACTIVE 만)에서는 빠지는데,
     * 상세까지 404 면 사용자는 담은 장소가 왜 안 열리는지 모른다. 시드의 폐업 장소(…f2)를 쓴다.
     */
    @Test
    fun `폐업한 장소도 단건은 열리고 상태를 말한다 — 목록에서는 빠진다`() {
        val token = newToken()

        val (status, place) = call(HttpMethod.GET, "/api/v1/places/$CLOSED_POI", token)

        status shouldBe 200
        place["dataStatus"].asText() shouldBe "CLOSED"
        val listed = call(HttpMethod.GET, "/api/v1/places?region=제주", token).second["items"]
        (0 until listed.size()).none { listed[it]["poiId"].asText() == CLOSED_POI } shouldBe true
    }

    /** 게이트를 통과한 적 없는 행은 id 를 알아도 안 나온다(INV-1). 시드의 미확인 장소(…f1). */
    @Test
    fun `수집 게이트를 통과하지 못한 장소는 단건으로도 열리지 않는다`() {
        call(HttpMethod.GET, "/api/v1/places/$UNVERIFIED_POI", newToken()).first shouldBe 404
    }

    private companion object {
        /** `R__seed_stub_pois.sql` 의 게이트 검증용 행. */
        const val UNVERIFIED_POI = "e0000000-0000-4000-8000-0000000000f1"
        const val CLOSED_POI = "e0000000-0000-4000-8000-0000000000f2"
    }
}
