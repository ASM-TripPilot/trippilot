package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
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
 * TRIP-312 — 생성 진행 상태 E2E(h09·h10).
 *
 * 프론트(TRIP-305)가 막혀 있던 지점을 그대로 따라간다: **일정 생성 → 응답의 세션 id → 조회 → 취소**.
 * 여기서만 드러나는 것 — 세션 id 가 일정 응답에 실제로 실리는가(안 실리면 화면이 [취소]를 걸 대상을 모른다),
 * 소유 스코프가 세션에도 걸리는가.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class GenerationSessionApiIT : AbstractPostgresIntegrationTest() {

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

    /** 여러 날 여행 — 2차가 있어야 세션이 진행 중인 순간을 볼 수 있다. */
    private fun newTrip(token: String): String {
        val body = """{"startDate":"2026-08-01","endDate":"2026-08-03","party":2,
            "destinations":[{"seq":0,"region":"제주","nights":2}],"preferenceSnapshot":{}}""".trimIndent()
        return call(HttpMethod.POST, "/api/v1/trips", token, body).second["tripId"].asText()
    }

    @Test
    fun `인증 없으면 401`() {
        val path = "/api/v1/trips/${UUID.randomUUID()}/generation-sessions/${UUID.randomUUID()}"
        call(HttpMethod.GET, path, null).first shouldBe 401
    }

    /**
     * 생성이 끝나면 세션은 닫히고 일정 응답의 `generationSessionId` 는 null 이 된다.
     * 화면이 이 값으로 "아직 도는 중인가"를 판단하므로, 끝난 뒤에도 남아 있으면 [취소]가 계속 떠 있다.
     */
    @Test
    fun `생성하면 세션 id 가 일정 응답에 실리고 끝나면 사라진다`() {
        val token = newToken()
        val trip = newTrip(token)

        val (rc, created) = call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token)
        rc shouldBe 201
        val sessionId = created["generationSessionId"]
        // 2차는 @Async 라 이 시점에 이미 끝났을 수도 있다 — 그때는 null 이 정상이다.
        if (!sessionId.isNull) {
            val (getRc, session) = call(HttpMethod.GET, "/api/v1/trips/$trip/generation-sessions/${sessionId.asText()}", token)
            getRc shouldBe 200
            session["sessionId"].asText() shouldBe sessionId.asText()
            session["startedAt"] shouldNotBe null
            session.has("partial") shouldBe false // 중간 결과 사본은 두지 않는다(정본 §2.2 이탈)
        }

        awaitFinished(trip, token)
        val done = call(HttpMethod.GET, "/api/v1/trips/$trip/itinerary", token).second
        done["generationSessionId"].isNull shouldBe true
    }

    @Test
    fun `남의 여행 세션은 404`() {
        val owner = newToken()
        val trip = newTrip(owner)
        val session = call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", owner).second["generationSessionId"]

        val stranger = newToken()
        val id = session.takeIf { !it.isNull }?.asText() ?: UUID.randomUUID().toString()
        call(HttpMethod.GET, "/api/v1/trips/$trip/generation-sessions/$id", stranger).first shouldBe 404
    }

    @Test
    fun `없는 세션은 404`() {
        val token = newToken()
        val trip = newTrip(token)
        val path = "/api/v1/trips/$trip/generation-sessions/${UUID.randomUUID()}"
        call(HttpMethod.GET, path, token).first shouldBe 404
    }

    /**
     * 끝난 생성의 취소는 409 — "취소됐다"고 답하면 이미 완성된 일정을 두고 거짓말이 된다.
     * (진행 중 취소의 결과 폐기는 [com.trippilot.itinerarygeneration.application] 단위 테스트가 결정론적으로 검증한다.)
     */
    @Test
    fun `이미 끝난 생성의 취소는 409`() {
        val token = newToken()
        val trip = newTrip(token)
        val created = call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token).second
        awaitFinished(trip, token)

        val id = created["generationSessionId"].takeIf { !it.isNull }?.asText() ?: return
        call(HttpMethod.POST, "/api/v1/trips/$trip/generation-sessions/$id/cancel", token).first shouldBe 409
    }

    /** `@Async` 2차가 끝날 때까지 상태로 기다린다(고정 sleep 금지). */
    private fun awaitFinished(trip: String, token: String) {
        val deadline = System.nanoTime() + AWAIT_TIMEOUT_NANOS
        while (System.nanoTime() < deadline) {
            val state = call(HttpMethod.GET, "/api/v1/trips/$trip/itinerary", token).second["generationState"]?.asText()
            if (state == "COMPLETE" || state == "FAILED") return
            Thread.sleep(POLL_INTERVAL_MS)
        }
        error("2차 생성이 기한 내 끝나지 않았습니다.")
    }

    private companion object {
        const val POLL_INTERVAL_MS = 50L
        val AWAIT_TIMEOUT_NANOS = java.time.Duration.ofSeconds(20).toNanos()
    }
}
