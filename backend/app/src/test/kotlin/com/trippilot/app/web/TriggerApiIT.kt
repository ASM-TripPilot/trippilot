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

/**
 * 날씨 트리거 배선 E2E — `TriggerKind.WEATHER` 가 **실제로 만들어지는지**.
 *
 * 이 경로는 그동안 enum 값만 있고 그것을 만들어내는 코드가 없었다. 단위 테스트는 대역으로 강수확률을
 * 주입하므로 "C11 이 정말 연결됐는지"를 증명하지 못한다 — 여기서는 실 컨텍스트의 `ContextFacade` 를 탄다.
 *
 * `FakeWeatherAdapter` 는 격자 키 해시로 강수확률을 **결정론적으로** 만든다(무작위면 이 테스트가 흔들린다).
 * 격자 키는 여행 목적지명이므로 지역을 골라 두 갈래를 다 밟는다 — 제주 88%(발화) · 부산 22%(무발화).
 * 둘 다 국내강제 스텁의 시드 지역이라 여행 생성도 통과한다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class TriggerApiIT : AbstractPostgresIntegrationTest() {

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

    /** 서버 실 시계로 구간을 판정하므로 **오늘을 포함한** 여행을 만든다(고정 날짜는 날이 바뀌며 깨진다). */
    private val today: LocalDate get() = LocalDate.now(ZoneId.of("Asia/Seoul"))

    private fun tripWithItinerary(token: String, region: String): String {
        val start = today.minusDays(1)
        val end = today.plusDays(1)
        val body = """
            {"startDate":"$start","endDate":"$end","party":2,
             "destinations":[{"seq":0,"region":"$region","nights":${end.toEpochDay() - start.toEpochDay()}}]}
        """.trimIndent()
        val tripId = call(HttpMethod.POST, "/api/v1/trips", token, body).second["tripId"].asText()
        // 일정이 없으면 재계획할 대상이 없어 판정 자체가 성립하지 않는다.
        call(HttpMethod.POST, "/api/v1/trips/$tripId/itinerary?mode=FULLY_AI", token).first shouldBe 201
        awaitGenerated(token, tripId)
        return tripId
    }

    /**
     * 생성 2차(`@Async`)가 끝날 때까지 — 고정 sleep 대신 상태로 기다린다.
     *
     * **이걸 빼면 조용히 204 가 난다.** 1차는 첫날(= 여행 시작일)만 채우는데 그 날은 이미 지난 날짜라
     * "남은 슬롯"이 비고, 날짜 전체 신호는 남은 슬롯이 하나도 없으면 무영향으로 접힌다(BR-U4-06).
     * 임계·배선과 무관한 이유로 발화가 사라지므로 원인을 찾기 어렵다.
     */
    private fun awaitGenerated(token: String, tripId: String) {
        val deadline = System.nanoTime() + java.time.Duration.ofSeconds(20).toNanos()
        while (System.nanoTime() < deadline) {
            val state = call(HttpMethod.GET, "/api/v1/trips/$tripId/itinerary", token).second["generationState"].asText()
            if (state != "PARTIAL") return
            Thread.sleep(50)
        }
        error("생성이 기한 내 끝나지 않았습니다.")
    }

    @Test
    fun `비 예보가 임계를 넘으면 트리거가 만들어지고 목록에 보인다`() {
        val token = newToken()
        val tripId = tripWithItinerary(token, "제주")

        // 확인 전에는 배너가 없다 — 아래 1건이 이 호출로 생겼음을 이 대조가 보장한다.
        call(HttpMethod.GET, "/api/v1/trips/$tripId/triggers", token).second["triggers"].size() shouldBe 0

        val (rc, fired) = call(HttpMethod.POST, "/api/v1/trips/$tripId/triggers/weather-check", token)
        rc shouldBe 200
        fired["kind"].asText() shouldBe "WEATHER"
        // 강수는 특정 슬롯을 짚을 근거가 없다 — 날짜 전체이고, 그래서 [대안 보기] 는 FULL_DAY 로 연다.
        fired["slotKey"].isNull shouldBe true
        fired["scope"].asText() shouldBe "FULL_DAY"
        fired["reason"].asText() shouldBe "비 예보 88%"

        // 발화한 것만 목록에 나간다(INV-U4-01) — 배너가 실제로 뜬다는 뜻이다.
        val listed = call(HttpMethod.GET, "/api/v1/trips/$tripId/triggers", token).second["triggers"]
        listed.size() shouldBe 1
        listed[0]["triggerId"].asText() shouldBe fired["triggerId"].asText()
    }

    // 화면이 주기적으로 부를 수 있어야 한다 — 부를 때마다 배너가 늘면 쓸 수 없다(BR-U4-07).
    @Test
    fun `같은 날 다시 확인해도 배너가 늘지 않는다`() {
        val token = newToken()
        val tripId = tripWithItinerary(token, "제주")

        call(HttpMethod.POST, "/api/v1/trips/$tripId/triggers/weather-check", token).first shouldBe 200
        call(HttpMethod.POST, "/api/v1/trips/$tripId/triggers/weather-check", token).first shouldBe 204

        call(HttpMethod.GET, "/api/v1/trips/$tripId/triggers", token).second["triggers"].size() shouldBe 1
    }

    @Test
    fun `임계 미만이면 204 이고 배너도 없다`() {
        val token = newToken()
        val tripId = tripWithItinerary(token, "부산") // 22%

        call(HttpMethod.POST, "/api/v1/trips/$tripId/triggers/weather-check", token).first shouldBe 204

        call(HttpMethod.GET, "/api/v1/trips/$tripId/triggers", token).second["triggers"].size() shouldBe 0
    }

    @Test
    fun `끈 뒤에는 다시 확인해도 발화하지 않는다`() {
        val token = newToken()
        val tripId = tripWithItinerary(token, "제주")
        val triggerId = call(HttpMethod.POST, "/api/v1/trips/$tripId/triggers/weather-check", token)
            .second["triggerId"].asText()

        call(HttpMethod.POST, "/api/v1/trips/$tripId/triggers/$triggerId/dismiss", token).first shouldBe 200

        // 억제는 화면에서 감추는 것이 아니라 레코드다(BR-U4-15) — 다음 판정이 그것을 본다.
        call(HttpMethod.POST, "/api/v1/trips/$tripId/triggers/weather-check", token).first shouldBe 204
        call(HttpMethod.GET, "/api/v1/trips/$tripId/triggers", token).second["triggers"].size() shouldBe 0
    }

    @Test
    fun `타 계정 여행이면 404 · 인증 없으면 401`() {
        val token = newToken()
        val tripId = tripWithItinerary(token, "제주")

        call(HttpMethod.POST, "/api/v1/trips/$tripId/triggers/weather-check", newToken()).first shouldBe 404
        call(HttpMethod.POST, "/api/v1/trips/$tripId/triggers/weather-check", null).first shouldBe 401
    }
}
