package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.planb.domain.TriggerEvent
import com.trippilot.planb.domain.TriggerEventRepository
import com.trippilot.planb.domain.TriggerType
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
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/**
 * TRIP-273 — 트리거 목록·닫기 API E2E(i08·i09).
 * 발생(raise)은 감지기가 부르는 내부 동작이라 API 가 없다 — 여기서는 저장소로 직접 심어 표면만 본다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class TriggerApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var triggers: TriggerEventRepository

    private val json = ObjectMapper()
    private val now: Instant = Instant.parse("2026-08-11T03:00:00Z")

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

    private fun newToken(): String =
        accessTokenIssuer.issue(
            accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)).id.value.toString(),
        ).value

    private val today: LocalDate get() = LocalDate.now(ZoneId.of("Asia/Seoul"))

    private fun createTrip(token: String): String {
        val body = """
            {"startDate":"${today.minusDays(1)}","endDate":"${today.plusDays(1)}","party":2,
             "destinations":[{"seq":0,"region":"제주","nights":2}]}
        """.trimIndent()
        return call(HttpMethod.POST, "/api/v1/trips", token, body).second["tripId"].asText()
    }

    @Test
    fun `목록 조회 · 닫기 · 닫은 뒤 재차 닫으면 409`() {
        val token = newToken()
        val tripId = UUID.fromString(createTrip(token))
        triggers.save(TriggerEvent.raise(tripId, TriggerType.WEATHER, null, "강수확률 80%", now))

        val (rc, list) = call(HttpMethod.GET, "/api/v1/trips/$tripId/triggers", token)
        rc shouldBe 200
        list["triggers"].size() shouldBe 1
        val id = list["triggers"][0]["triggerEventId"].asText()
        list["triggers"][0]["status"].asText() shouldBe "ACTIVE"
        list["triggers"][0]["targetSlotId"].isNull shouldBe true // 일정 전체 신호

        val (dc, dismissed) = call(HttpMethod.POST, "/api/v1/trips/$tripId/triggers/$id/dismiss", token)
        dc shouldBe 200
        dismissed["status"].asText() shouldBe "DISMISSED"

        call(HttpMethod.POST, "/api/v1/trips/$tripId/triggers/$id/dismiss", token).first shouldBe 409
    }

    @Test
    fun `타 계정이면 404 · 다른 여행의 트리거도 404`() {
        val owner = newToken()
        val tripId = UUID.fromString(createTrip(owner))
        val otherTrip = UUID.fromString(createTrip(owner))
        val id = triggers.save(TriggerEvent.raise(tripId, TriggerType.DELAY, null, "20분 지연", now)).triggerEventId

        call(HttpMethod.GET, "/api/v1/trips/$tripId/triggers", newToken()).first shouldBe 404
        // 트리거 id 를 알아도 다른 여행 경로로는 닫지 못한다
        call(HttpMethod.POST, "/api/v1/trips/$otherTrip/triggers/$id/dismiss", owner).first shouldBe 404
    }

    @Test
    fun `인증 없으면 401`() {
        call(HttpMethod.GET, "/api/v1/trips/${UUID.randomUUID()}/triggers", null).first shouldBe 401
    }
}
