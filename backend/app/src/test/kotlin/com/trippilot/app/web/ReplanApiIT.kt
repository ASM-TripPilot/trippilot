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
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/**
 * TRIP-273 — 재계획 진입 API E2E(i10·i18).
 * 여기서 보는 것은 HTTP 표면이다 — 상태코드·소유 스코프·입력 검증. 저장 정합은 ReplanSessionPersistenceIT.
 *
 * 일정이 있어야 진입할 수 있으므로 **생성까지 태운다**(Fake ScheduleAgent 가 실 POI 를 emit 한다).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ReplanApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository

    private val json = ObjectMapper()

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
            accounts.save(
                Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, Instant.parse("2026-07-26T00:00:00Z")),
            ).id.value.toString(),
        ).value

    private val today: LocalDate get() = LocalDate.now(ZoneId.of("Asia/Seoul"))

    /** 서버 실 시계로 판정하므로 **오늘을 포함한** 여행을 만든다(고정 날짜는 날이 바뀌며 깨진다). */
    private fun createTrip(token: String, start: LocalDate = today.minusDays(1), end: LocalDate = today.plusDays(1)): String {
        val body = """
            {"startDate":"$start","endDate":"$end","party":2,
             "destinations":[{"seq":0,"region":"제주","nights":${end.toEpochDay() - start.toEpochDay()}}]}
        """.trimIndent()
        return call(HttpMethod.POST, "/api/v1/trips", token, body).second["tripId"].asText()
    }

    private fun generate(token: String, tripId: String): Int =
        call(HttpMethod.POST, "/api/v1/trips/$tripId/itinerary?mode=FULLY_AI", token).first

    private val startBody = """
        {"scope":"PARTIAL_SLOTS","originKind":"GPS","originLat":33.45,"originLng":126.56,
         "reasons":["비가 와요"],"directives":["실내로 바꿔줘"]}
    """.trimIndent()

    @Test
    fun `일정이 있으면 세션이 열리고 곧바로 산출로 넘어간다 · 입력이 그대로 실린다`() {
        val token = newToken()
        val tripId = createTrip(token)
        generate(token, tripId) shouldBe 201

        val (rc, body) = call(HttpMethod.POST, "/api/v1/trips/$tripId/replan-sessions", token, startBody)
        rc shouldBe 201
        // 시트 제출과 동시에 산출이 시작된다 — COLLECTING 에 멈추면 화면이 영원히 로딩이다.
        body["status"].asText() shouldBe "SOLVING"
        body["scope"].asText() shouldBe "PARTIAL_SLOTS"
        body["reasons"][0].asText() shouldBe "비가 와요"
        body["originEstimated"].asBoolean() shouldBe false // GPS 는 추정이 아니다
        body["closedAt"].isNull shouldBe true
    }

    @Test
    fun `다시 진입하면 이전 세션을 닫고 새로 연다 — 막지 않는다(INV-U4-06)`() {
        val token = newToken()
        val tripId = createTrip(token)
        generate(token, tripId)
        val first = call(HttpMethod.POST, "/api/v1/trips/$tripId/replan-sessions", token, startBody)
            .second["sessionId"].asText()

        val (rc, second) = call(HttpMethod.POST, "/api/v1/trips/$tripId/replan-sessions", token, startBody)
        rc shouldBe 201 // 409 가 아니다
        (second["sessionId"].asText() == first) shouldBe false // 새 세션이다

        val (_, closed) = call(HttpMethod.GET, "/api/v1/trips/$tripId/replan-sessions/$first", token)
        closed["status"].asText() shouldBe "CANCELED" // 이전 시도는 이력으로 남는다
    }

    @Test
    fun `생성된 일정이 없으면 404 — 그건 재계획이 아니라 생성이다`() {
        val token = newToken()
        val tripId = createTrip(token)
        call(HttpMethod.POST, "/api/v1/trips/$tripId/replan-sessions", token, startBody).first shouldBe 404
    }

    @Test
    fun `여행 기간 밖이면 409`() {
        val token = newToken()
        val past = createTrip(token, today.minusDays(10), today.minusDays(8))
        generate(token, past)
        call(HttpMethod.POST, "/api/v1/trips/$past/replan-sessions", token, startBody).first shouldBe 409
    }

    @Test
    fun `GPS·MANUAL 인데 좌표가 없으면 400 — 500 으로 새지 않는다`() {
        val token = newToken()
        val tripId = createTrip(token)
        generate(token, tripId)
        call(
            HttpMethod.POST, "/api/v1/trips/$tripId/replan-sessions", token,
            """{"scope":"FULL_DAY","originKind":"GPS"}""",
        ).first shouldBe 400
    }

    @Test
    fun `좌표 없는 기준점은 허용된다 — 추정 출발지로 표시된다`() {
        val token = newToken()
        val tripId = createTrip(token)
        generate(token, tripId)
        val (rc, body) = call(
            HttpMethod.POST, "/api/v1/trips/$tripId/replan-sessions", token,
            """{"scope":"FULL_DAY","originKind":"STAY_ANCHOR"}""",
        )
        rc shouldBe 201
        body["originEstimated"].asBoolean() shouldBe true
    }

    @Test
    fun `취소는 세션만 닫는다 · 두 번 닫으면 409`() {
        val token = newToken()
        val tripId = createTrip(token)
        generate(token, tripId)
        val id = call(HttpMethod.POST, "/api/v1/trips/$tripId/replan-sessions", token, startBody)
            .second["sessionId"].asText()

        val (rc, canceled) = call(HttpMethod.POST, "/api/v1/trips/$tripId/replan-sessions/$id/cancel", token)
        rc shouldBe 200
        canceled["status"].asText() shouldBe "CANCELED"
        call(HttpMethod.POST, "/api/v1/trips/$tripId/replan-sessions/$id/cancel", token).first shouldBe 409

        // 원 일정은 그대로다(INV-U4-05)
        call(HttpMethod.GET, "/api/v1/trips/$tripId/itinerary", token).first shouldBe 200
    }

    @Test
    fun `타 계정이면 404 · 다른 여행의 세션도 404`() {
        val owner = newToken()
        val tripId = createTrip(owner)
        generate(owner, tripId)
        val id = call(HttpMethod.POST, "/api/v1/trips/$tripId/replan-sessions", owner, startBody)
            .second["sessionId"].asText()

        call(HttpMethod.POST, "/api/v1/trips/$tripId/replan-sessions", newToken(), startBody).first shouldBe 404
        val otherTrip = createTrip(owner)
        call(HttpMethod.GET, "/api/v1/trips/$otherTrip/replan-sessions/$id", owner).first shouldBe 404
    }

    @Test
    fun `기준점을 아예 안 보내도 열린다 — 서버가 사다리로 정한다(BR-U4-19)`() {
        // 위치를 못 잡았다고 재계획을 막으면, 정작 위치가 불안정한 실내에서 가장 필요한데 못 쓴다.
        val token = newToken()
        val tripId = createTrip(token)
        generate(token, tripId)

        val (rc, body) = call(
            HttpMethod.POST, "/api/v1/trips/$tripId/replan-sessions", token,
            """{"scope":"FULL_DAY"}""",
        )
        rc shouldBe 201
        body["originKind"].asText() shouldBe "STAY_ANCHOR" // 숙소 없는 여행이라 사다리 끝
        body["originEstimated"].asBoolean() shouldBe true  // 추정임을 밝힌다
    }

    /**
     * TRIP — 재계획의 결말. 산출(비동기)이 끝나 초안이 나오고, 확정에서 **비로소** 일정이 바뀐다.
     * `@Async` 라 완료 시점이 비결정적이므로 상태로 기다린다(고정 sleep 금지).
     */
    @Test
    fun `산출이 끝나면 초안이 나오고 확정에서 일정이 바뀐다`() {
        val token = newToken()
        val tripId = createTrip(token)
        generate(token, tripId) shouldBe 201
        // 생성 2차가 끝나기 전에 기준을 잡으면, 2차가 채운 일자를 재계획이 바꾼 것으로 오독한다.
        awaitGenerated(token, tripId)
        // **일자·슬롯**만 비교한다 — 응답 전체를 비교하면 그 사이 생성 세션이 닫히며(generationSessionId→null)
        // 계획과 무관한 필드 때문에 실패한다. INV-U4-05 가 지키는 것은 계획이다.
        val before = call(HttpMethod.GET, "/api/v1/trips/$tripId/itinerary", token).second["days"]

        val sessionId = call(HttpMethod.POST, "/api/v1/trips/$tripId/replan-sessions", token, startBody)
            .second["sessionId"].asText()
        val settled = awaitSettled(token, tripId, sessionId)

        // 확정 전에는 일정이 그대로다(INV-U4-05).
        call(HttpMethod.GET, "/api/v1/trips/$tripId/itinerary", token).second["days"] shouldBe before

        when (settled["status"].asText()) {
            "DRAFT" -> {
                val (rc, applied) = call(HttpMethod.POST, "/api/v1/trips/$tripId/replan-sessions/$sessionId/apply", token)
                rc shouldBe 200
                applied["status"].asText() shouldBe "APPLIED"
                // 두 번 확정하면 409 — 같은 초안이 두 번 반영되면 안 된다.
                call(HttpMethod.POST, "/api/v1/trips/$tripId/replan-sessions/$sessionId/apply", token).first shouldBe 409
            }
            // 후보풀이 얕으면 대안이 없을 수 있다 — 그때도 확정은 막혀야 한다(빈 하루 확정 금지).
            "NO_SOLUTION", "FAILED" ->
                call(HttpMethod.POST, "/api/v1/trips/$tripId/replan-sessions/$sessionId/apply", token).first shouldBe 409
            else -> error("산출이 끝나지 않았습니다: $settled")
        }
    }

    /** 생성 2차(@Async)가 끝날 때까지 — 고정 sleep 대신 상태로 기다린다. */
    private fun awaitGenerated(token: String, tripId: String) {
        val deadline = System.nanoTime() + java.time.Duration.ofSeconds(20).toNanos()
        while (System.nanoTime() < deadline) {
            val state = call(HttpMethod.GET, "/api/v1/trips/$tripId/itinerary", token).second["generationState"].asText()
            if (state != "PARTIAL") return
            Thread.sleep(50)
        }
        error("생성이 기한 내 끝나지 않았습니다.")
    }

    /** 열린 상태(COLLECTING·SOLVING)를 벗어날 때까지 폴링 — 실 클라이언트가 하는 일과 같다. */
    private fun awaitSettled(token: String, tripId: String, sessionId: String): JsonNode {
        val deadline = System.nanoTime() + java.time.Duration.ofSeconds(20).toNanos()
        var last = json.createObjectNode() as JsonNode
        while (System.nanoTime() < deadline) {
            last = call(HttpMethod.GET, "/api/v1/trips/$tripId/replan-sessions/$sessionId", token).second
            if (last["status"].asText() !in setOf("COLLECTING", "SOLVING")) return last
            Thread.sleep(50)
        }
        error("재계획 산출이 기한 내 끝나지 않았습니다. 마지막 상태=$last")
    }

    @Test
    fun `인증 없으면 401`() {
        call(HttpMethod.POST, "/api/v1/trips/${UUID.randomUUID()}/replan-sessions", null, startBody).first shouldBe 401
    }
}
