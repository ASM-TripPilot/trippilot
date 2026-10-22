package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.reflection.application.TripSummaryService
import com.trippilot.reflection.domain.port.ShareCardUsageRepository
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
import java.time.LocalDate
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.UUID

/**
 * 공유 카드 문구(TRIP-1411) — 실 MVC·실 Postgres. AI 는 꺼진 기본 모드(`rule`)라 규칙 문구가 나온다(CI 외부 호출 0회).
 *
 * 재는 것: 와이어 이름(`isFallback` — Kotlin `is` 접두가 `fallback` 으로 바뀌지 않는가) · 요약 전 409 · 타 계정 404 ·
 * 하루 상한 카운터의 실 SQL(상한·날 바뀜·계정 분리·동시 요청).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ShareCardCopyApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var summaries: TripSummaryService
    @Autowired private lateinit var usage: ShareCardUsageRepository

    private val json = ObjectMapper()

    private fun call(method: HttpMethod, path: String, bearer: String, body: String? = null): Pair<Int, JsonNode> {
        val spec = RestClient.builder().baseUrl("http://localhost:$port").build().method(method).uri(path)
        spec.header("Authorization", "Bearer $bearer")
        body?.let { spec.contentType(MediaType.APPLICATION_JSON).body(it) }
        val res = spec.retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java)
        return res.statusCode.value() to (res.body?.takeIf { it.isNotBlank() }?.let { json.readTree(it) } ?: json.createObjectNode())
    }

    private fun newToken(): String {
        val account = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, Instant.parse("2026-08-01T00:00:00Z")))
        return accessTokenIssuer.issue(account.id.value.toString()).value
    }

    @Test
    fun `요약 전이면 409, 요약 뒤에는 규칙 문구 200, 남의 여행이면 404`() {
        val token = newToken()
        val body = """{"startDate":"2026-08-01","endDate":"2026-08-03","party":2,
            "destinations":[{"seq":0,"region":"부산","nights":1},{"seq":1,"region":"제주","nights":1}],"preferenceSnapshot":{}}""".trimIndent()
        val tripId = UUID.fromString(call(HttpMethod.POST, "/api/v1/trips", token, body).second["tripId"].asText())
        val path = "/api/v1/trips/$tripId/share-card/copy"

        call(HttpMethod.POST, path, token).first shouldBe 409

        summaries.generate(tripId) // 여행 종료 때 구독자가 하는 일
        val (status, copy) = call(HttpMethod.POST, path, token)
        status shouldBe 200
        copy["caption"].asText() shouldBe "" // 규칙 조립은 캡션을 비운다(TRIP-766)
        copy["hashtags"].map(JsonNode::asText) shouldBe listOf("#부산여행", "#제주여행")
        copy["isFallback"].asBoolean() shouldBe true
        copy.size() shouldBe 3 // 계약의 세 키뿐이다

        call(HttpMethod.POST, path, newToken()).first shouldBe 404
    }

    private fun newAccountId(): UUID =
        accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, Instant.parse("2026-08-01T00:00:00Z"))).id.value

    @Test
    fun `하루 상한 카운터 — 상한까지만 집고, 날이 바뀌면 1 부터, 계정마다 따로`() {
        val a = newAccountId()
        val b = newAccountId()
        val d1 = LocalDate.parse("2026-08-12")

        (1..3).map { usage.claim(a, d1, 2) } shouldBe listOf(true, true, false)
        usage.claim(b, d1, 2) shouldBe true // 다른 계정은 따로 센다
        usage.claim(a, d1.plusDays(1), 2) shouldBe true // 날이 바뀌면 같은 행을 1 로
        usage.claim(a, d1.plusDays(1), 2) shouldBe true
        usage.claim(a, d1.plusDays(1), 2) shouldBe false
    }

    @Test
    fun `동시 요청도 상한을 넘지 않는다 — 세기와 더하기가 한 문장이다`() {
        val a = newAccountId()
        val day = LocalDate.parse("2026-08-12")
        val pool = Executors.newFixedThreadPool(8)
        try {
            val granted = pool.invokeAll((1..20).map { Callable { usage.claim(a, day, 5) } }).count { it.get() }
            granted shouldBe 5
        } finally {
            pool.shutdown()
        }
    }
}
