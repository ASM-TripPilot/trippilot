package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldStartWith
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.HttpMethod
import org.springframework.http.ResponseEntity
import org.springframework.http.client.JdkClientHttpRequestFactory
import org.springframework.web.client.RestClient
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.time.Instant

/**
 * 큐레이션 숙소 E2E — 반복 시드(서울 15곳)가 실 DB 에 들어가고, 목록의 stayId 가 그대로 아웃바운드를 탄다.
 * 기본 제휴 모드(fallback)라 Location 은 웹검색이다 — 트립닷컴 상세 URL 은 어댑터 단위 테스트가 잠근다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class CuratedStayApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository

    private val json = ObjectMapper()
    private val now = Instant.parse("2026-10-16T00:00:00Z")

    private fun get(path: String, bearer: String?): ResponseEntity<String> {
        val spec = RestClient.builder()
            .requestFactory(JdkClientHttpRequestFactory())
            .baseUrl("http://localhost:$port")
            .build()
            .method(HttpMethod.GET).uri(path)
        bearer?.let { spec.header("Authorization", "Bearer $it") }
        return spec.retrieve()
            .onStatus({ it.is3xxRedirection || it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java)
    }

    private fun body(res: ResponseEntity<String>): JsonNode = json.readTree(res.body)

    private fun token(): String {
        val account = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now))
        return accessTokenIssuer.issue(account.id.value.toString()).value
    }

    // RestClient 의 uri(String) 은 템플릿이라 스스로 인코딩한다 — 미리 인코딩하면 %25 로 이중 인코딩된다.
    private val seoul = "/api/v1/stays/curated?city=서울"

    @Test
    fun `서울 목록은 시드 15곳을 순위대로 — stayId 는 TRIPCOM 합성키, 이미지는 https`() {
        val res = get(seoul, token())

        res.statusCode.value() shouldBe 200
        val items = body(res)["items"]
        items.size() shouldBe 15
        items.map { it["rank"].asInt() } shouldBe (1..15).toList()
        items[0]["stayId"].asText() shouldBe "TRIPCOM:4645968"
        items[0]["name"].asText() shouldBe "호텔 베뉴지"
        items.forEach { it["imageUrl"].asText() shouldStartWith "https://" }
    }

    @Test
    fun `평점·가격 필드가 없다 — 앱 안에 두지 않는다(BR-U1-18 · INV-U1-05)`() {
        val first = body(get(seoul, token()))["items"][0]
        first.fieldNames().asSequence().toSet() shouldBe setOf("rank", "stayId", "name", "address", "imageUrl")
    }

    @Test
    fun `모르는 도시는 빈 목록 200 — 404 가 아니다`() {
        val res = get("/api/v1/stays/curated?city=nowhere", token())
        res.statusCode.value() shouldBe 200
        body(res)["items"].size() shouldBe 0
    }

    @Test
    fun `city 가 없으면 400 · 인증 없으면 401`() {
        get("/api/v1/stays/curated", token()).statusCode.value() shouldBe 400
        get(seoul, null).statusCode.value() shouldBe 401
    }

    @Test
    fun `목록의 stayId 로 아웃바운드가 열린다 — 큐레이션 이름으로 302`() {
        val res = get("/api/v1/stays/TRIPCOM:4645968/outbound", null)

        res.statusCode.value() shouldBe 302
        res.headers.location.toString() shouldBe "https://www.google.com/search?q=" +
            URLEncoder.encode("호텔 베뉴지 예약", StandardCharsets.UTF_8)
    }

    @Test
    fun `큐레이션에 없는 트립닷컴 호텔은 404`() {
        get("/api/v1/stays/TRIPCOM:999999/outbound", null).statusCode.value() shouldBe 404
    }
}
