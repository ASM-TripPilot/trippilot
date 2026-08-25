package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.web.client.RestClient
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 오프라인 재생의 **계약 표면**(TRIP-546 · BR-U5-20·21·22).
 *
 * 여기서만 드러나는 것 — 서비스 단위 테스트로는 못 본다:
 * - 두 충돌이 **서로 다른 `error.code`** 로 나가는지. 사유 없이 409 만 주면 클라이언트가
 *   "이미 됐다"와 "다른 게 기록돼 있다"를 구분하지 못해, 둘 다 충돌 화면이거나 둘 다 조용한 성공이 된다
 * - 봉투가 `visitCheckId`·`serverUpdatedAt` 을 **실제로 직렬화**하는지. `@JsonInclude(NON_NULL)` 이라
 *   추출기가 null 을 내면 필드 자체가 사라지고, 그래도 테스트는 초록일 수 있다(TRIP-403 에서 겪었다)
 * - `updatedAt` 이 방문 응답에 실려 나가는지 — 클라이언트가 다음 재생의 기준값으로 쓸 수 있어야 한다
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class VisitReplayApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var mapper: ObjectMapper

    private val now = Instant.parse("2026-08-11T01:00:00Z")

    private fun newToken(): String {
        val account = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now))
        return accessTokenIssuer.issue(account.id.value.toString()).value
    }

    private fun newTrip(token: String): UUID {
        val accountId = UUID.fromString(subjectOf(token))
        return trips.save(
            Trip.create(
                accountId = accountId, title = null,
                startDate = LocalDate.parse("2026-08-10"), endDate = LocalDate.parse("2026-08-12"),
                party = 2, companionType = null, budgetTotal = null,
                preferenceSnapshot = emptyMap(),
                destinations = listOf(TripDestination(0, "제주", 2)), now = now,
            ),
        ).tripId
    }

    private fun call(method: HttpMethod, path: String, token: String, body: String? = null): Pair<Int, JsonNode> {
        val spec = RestClient.builder().baseUrl("http://localhost:$port").build().method(method).uri(path)
        spec.header("Authorization", "Bearer $token")
        body?.let { spec.contentType(MediaType.APPLICATION_JSON).body(it) }
        val res = spec.retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java)
        val parsed = res.body?.takeIf { it.isNotBlank() }?.let { mapper.readTree(it) } ?: mapper.createObjectNode()
        return res.statusCode.value() to parsed
    }

    @Test
    fun `같은 도착을 다시 재생하면 VISIT_ALREADY_RECORDED — 클라이언트가 수렴할 수 있다`() {
        val token = newToken()
        val trip = newTrip(token)
        val poi = UUID.randomUUID()
        val arrive = """{"slotKey":"2026-08-11#$poi","poiId":"$poi","source":"AUTO_GEOFENCE"}"""

        val (created, first) = call(HttpMethod.POST, "/api/v1/trips/$trip/visits", token, arrive)
        created shouldBe 201
        // 클라이언트가 다음 재생의 기준으로 쓸 값이 실려 나와야 한다(BR-U5-22).
        first["updatedAt"].isNull shouldBe false

        val (status, error) = call(HttpMethod.POST, "/api/v1/trips/$trip/visits", token, arrive)

        status shouldBe 409
        error["error"]["code"].asText() shouldBe "VISIT_ALREADY_RECORDED"
        error["error"]["visitCheckId"].asText() shouldBe first["visitCheckId"].asText()
        error["error"]["serverUpdatedAt"].isNull shouldBe false
    }

    @Test
    fun `같은 슬롯에 다른 장소면 VISIT_CONFLICT — 사용자가 풀어야 한다`() {
        val token = newToken()
        val trip = newTrip(token)
        val slot = "2026-08-11#${UUID.randomUUID()}"
        call(HttpMethod.POST, "/api/v1/trips/$trip/visits", token, """{"slotKey":"$slot","poiId":"${UUID.randomUUID()}","source":"MANUAL"}""")

        val (status, error) = call(
            HttpMethod.POST, "/api/v1/trips/$trip/visits", token,
            """{"slotKey":"$slot","poiId":"${UUID.randomUUID()}","source":"MANUAL"}""",
        )

        status shouldBe 409
        // 같은 409 라도 코드가 갈려야 클라이언트가 수렴과 해소를 나눌 수 있다.
        error["error"]["code"].asText() shouldBe "VISIT_CONFLICT"
        error["error"]["visitCheckId"].isNull shouldBe false
    }

    @Test
    fun `기록된 결과와 다른 결과를 요청하면 VISIT_CONFLICT, 같은 결과면 ALREADY_RECORDED`() {
        val token = newToken()
        val trip = newTrip(token)
        val poi = UUID.randomUUID()
        val (_, visit) = call(
            HttpMethod.POST, "/api/v1/trips/$trip/visits", token,
            """{"slotKey":"2026-08-11#$poi","poiId":"$poi","source":"MANUAL"}""",
        )
        val id = visit["visitCheckId"].asText()
        call(HttpMethod.POST, "/api/v1/trips/$trip/visits/$id/complete", token).first shouldBe 200

        // 같은 결과를 또 요청 — 수렴 가능
        val (again, sameState) = call(HttpMethod.POST, "/api/v1/trips/$trip/visits/$id/complete", token)
        again shouldBe 409
        sameState["error"]["code"].asText() shouldBe "VISIT_ALREADY_RECORDED"

        // 다른 결과를 요청 — 사용자 해소 필요
        val (skipStatus, conflict) = call(HttpMethod.POST, "/api/v1/trips/$trip/visits/$id/skip", token)
        skipStatus shouldBe 409
        conflict["error"]["code"].asText() shouldBe "VISIT_CONFLICT"
    }

    @Test
    fun `낡은 기준으로 보정하면 조용히 덮지 않고 VISIT_CONFLICT 로 갈린다(BR-U5-22)`() {
        val token = newToken()
        val trip = newTrip(token)
        val poi = UUID.randomUUID()
        val (_, visit) = call(
            HttpMethod.POST, "/api/v1/trips/$trip/visits", token,
            """{"slotKey":"2026-08-11#$poi","poiId":"$poi","source":"MANUAL"}""",
        )
        val id = visit["visitCheckId"].asText()
        val staleBase = visit["updatedAt"].asText()

        // 다른 기기가 먼저 반영해 서버가 앞서 나간다.
        call(HttpMethod.POST, "/api/v1/trips/$trip/visits/$id/complete", token).first shouldBe 200

        val (status, error) = call(
            HttpMethod.PATCH, "/api/v1/trips/$trip/visits/$id", token,
            """{"arrivedAt":"2026-08-11T02:00:00Z","expectedUpdatedAt":"$staleBase"}""",
        )

        status shouldBe 409
        error["error"]["code"].asText() shouldBe "VISIT_CONFLICT"
        // 새 기준값을 함께 줘야 클라이언트가 다시 시도할 수 있다.
        error["error"]["serverUpdatedAt"].asText() shouldNotBe staleBase
    }

    @Test
    fun `기준을 보내지 않으면 검사하지 않는다 — 있던 온라인 편집 경로를 막지 않는다`() {
        val token = newToken()
        val trip = newTrip(token)
        val poi = UUID.randomUUID()
        val (_, visit) = call(
            HttpMethod.POST, "/api/v1/trips/$trip/visits", token,
            """{"slotKey":"2026-08-11#$poi","poiId":"$poi","source":"MANUAL"}""",
        )
        val id = visit["visitCheckId"].asText()

        val (status, _) = call(
            HttpMethod.PATCH, "/api/v1/trips/$trip/visits/$id", token,
            """{"arrivedAt":"2026-08-11T02:00:00Z"}""",
        )

        status shouldBe 200
    }

    private fun subjectOf(token: String): String =
        String(java.util.Base64.getUrlDecoder().decode(token.split(".")[1]))
            .let { mapper.readTree(it)["sub"].asText() }
}
