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
 * TRIP-177 — 여행 생성 API E2E. 생성·소유 스코프·검증(국내·날짜·Σnights)·편집·삭제 + 취향 스냅숏 jsonb 왕복.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class TripApiIT : AbstractPostgresIntegrationTest() {

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

    /**
     * **미래 날짜** — 여행 단계가 날짜에서 파생되므로(TRIP: statusAt) 고정 과거 날짜를 쓰면
     * 생성 직후 상태가 `ENDED` 로 나온다. 날짜 자체를 단언하는 테스트는 아래 리터럴을 그대로 쓴다.
     */
    private val futureStart: java.time.LocalDate
        get() = java.time.LocalDate.now(java.time.ZoneId.of("Asia/Seoul")).plusDays(30)

    private val createBody: String
        get() = """
        {"startDate":"$futureStart","endDate":"${futureStart.plusDays(3)}","party":2,"companionType":"연인",
         "destinations":[{"seq":0,"region":"제주","nights":3}],
         "preferenceSnapshot":{"pace":"알차게","styles":["휴양"]}}
        """.trimIndent()

    /**
     * 여행 단계는 **날짜에서 파생**한다. 저장된 status 는 `PLANNED` 에서 움직이지 않아
     * (전이를 부르는 코드가 없다), 지난 여행도 계속 "예정"으로 나가고 있었다 —
     * 홈 화면이 끝난 여행을 못 거르고(`ENDED` 를 걸러 낸다) 여행 중 배지도 못 달았다(`ACTIVE` 를 기대한다).
     */
    @Test
    fun `지난 여행은 ENDED · 여행 중이면 ACTIVE 로 나간다`() {
        val token = newToken()
        val today = java.time.LocalDate.now(java.time.ZoneId.of("Asia/Seoul"))

        val past = call(HttpMethod.POST, "/api/v1/trips", token,
            """{"startDate":"${today.minusDays(10)}","endDate":"${today.minusDays(8)}","party":2,
                "destinations":[{"seq":0,"region":"제주","nights":2}]}""").second
        past["status"].asText() shouldBe "ENDED"

        val ongoing = call(HttpMethod.POST, "/api/v1/trips", token,
            """{"startDate":"${today.minusDays(1)}","endDate":"${today.plusDays(1)}","party":2,
                "destinations":[{"seq":0,"region":"제주","nights":2}]}""").second
        ongoing["status"].asText() shouldBe "ACTIVE"

        // 경계 — 시작 당일부터 여행 중이다.
        val startsToday = call(HttpMethod.POST, "/api/v1/trips", token,
            """{"startDate":"$today","endDate":"${today.plusDays(2)}","party":2,
                "destinations":[{"seq":0,"region":"제주","nights":2}]}""").second
        startsToday["status"].asText() shouldBe "ACTIVE"
    }

    @Test
    fun `인증 없으면 401`() {
        call(HttpMethod.GET, "/api/v1/trips", null).first shouldBe 401
    }

    @Test
    fun `생성(201)·조회 · 제목 자동 · 취향 스냅숏 jsonb 왕복`() {
        val token = newToken()
        val (rc, created) = call(HttpMethod.POST, "/api/v1/trips", token, createBody)
        rc shouldBe 201
        val id = created["tripId"].asText()
        created["title"].asText() shouldBe "제주 여행"
        created["status"].asText() shouldBe "PLANNED"
        created["preferenceSnapshot"]["pace"].asText() shouldBe "알차게"

        val (s, b) = call(HttpMethod.GET, "/api/v1/trips/$id", token)
        s shouldBe 200
        b["party"].asInt() shouldBe 2
        b["destinations"][0]["region"].asText() shouldBe "제주"
        b["preferenceSnapshot"]["styles"][0].asText() shouldBe "휴양"
    }

    @Test
    fun `타 계정 리소스는 404`() {
        val id = call(HttpMethod.POST, "/api/v1/trips", newToken(), createBody).second["tripId"].asText()
        call(HttpMethod.GET, "/api/v1/trips/$id", newToken()).first shouldBe 404
    }

    @Test
    fun `국내 밖 목적지는 400`() {
        val body = """{"startDate":"2026-08-01","endDate":"2026-08-03","destinations":[{"seq":0,"region":"도쿄","nights":2}]}"""
        call(HttpMethod.POST, "/api/v1/trips", newToken(), body).first shouldBe 400
    }

    @Test
    fun `도시 박수 합 초과는 400`() {
        val body = """{"startDate":"2026-08-01","endDate":"2026-08-04","destinations":[{"seq":0,"region":"제주","nights":3},{"seq":1,"region":"부산","nights":2}]}"""
        call(HttpMethod.POST, "/api/v1/trips", newToken(), body).first shouldBe 400
    }

    @Test
    fun `편집(200) 후 값 변경`() {
        val token = newToken()
        val id = call(HttpMethod.POST, "/api/v1/trips", token, createBody).second["tripId"].asText()
        val (s, b) = call(HttpMethod.PATCH, "/api/v1/trips/$id", token,
            """{"title":"내 제주","startDate":"2026-08-01","endDate":"2026-08-02","party":4,"destinations":[{"seq":0,"region":"제주","nights":1}]}""")
        s shouldBe 200
        b["title"].asText() shouldBe "내 제주"
        b["party"].asInt() shouldBe 4
    }

    @Test
    fun `삭제(204) 후 조회 404 · 목록 제외`() {
        val token = newToken()
        val id = call(HttpMethod.POST, "/api/v1/trips", token, createBody).second["tripId"].asText()
        call(HttpMethod.DELETE, "/api/v1/trips/$id", token).first shouldBe 204
        call(HttpMethod.GET, "/api/v1/trips/$id", token).first shouldBe 404
        call(HttpMethod.GET, "/api/v1/trips", token).second.size() shouldBe 0
    }
}
