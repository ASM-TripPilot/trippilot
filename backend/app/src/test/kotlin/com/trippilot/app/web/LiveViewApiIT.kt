package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.planbdetection.domain.PlanBTrigger
import com.trippilot.planbdetection.domain.PlanBTriggerRepository
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerScope
import com.trippilot.planbdetection.domain.TriggerSeverity
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldNotBeEmpty
import io.kotest.matchers.ints.shouldBeLessThanOrEqual
import io.kotest.matchers.shouldBe
import jakarta.persistence.EntityManagerFactory
import org.hibernate.SessionFactory
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
 * 라이브 화면 묶음(TRIP-1467) — 각 섹션이 **개별 엔드포인트 응답과 JSON 으로 같은지**를 실 DB 로 본다.
 * 앱은 섹션을 개별 엔드포인트의 캐시에 그대로 채우므로, 한 글자라도 다르면 캐시에 다른 모양이 들어간다.
 * 실패 경로(섹션 실패·일정의 그 밖의 오류·날짜 규칙 전부)는 `LiveViewControllerTest` 가 본다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class LiveViewApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var triggers: PlanBTriggerRepository
    @Autowired private lateinit var emf: EntityManagerFactory

    private val json = ObjectMapper()

    private fun call(method: HttpMethod, path: String, bearer: String, body: String? = null): Pair<Int, JsonNode> {
        val spec = RestClient.builder()
            .requestFactory(JdkClientHttpRequestFactory())
            .baseUrl("http://localhost:$port")
            .build()
            .method(method).uri(path)
            .header("Authorization", "Bearer $bearer")
        body?.let { spec.contentType(MediaType.APPLICATION_JSON).body(it) }
        val res = spec.retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java)
        val parsed = res.body?.takeIf { it.isNotBlank() }?.let { json.readTree(it) } ?: json.createObjectNode()
        return res.statusCode.value() to parsed
    }

    private fun get(path: String, token: String): JsonNode {
        val (status, body) = call(HttpMethod.GET, path, token)
        status shouldBe 200
        return body
    }

    private fun newToken(): String {
        val accountId = accounts.save(
            Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, Instant.parse("2026-07-26T00:00:00Z")),
        ).id.value
        return accessTokenIssuer.issue(accountId.toString()).value
    }

    /** 서버 실 시계로 날을 고르므로 **오늘을 포함한** 여행을 만든다. */
    private val today: LocalDate get() = LocalDate.now(ZoneId.of("Asia/Seoul"))

    private fun newTrip(token: String): String {
        val start = today.minusDays(1)
        val end = today.plusDays(1)
        val body = """
            {"startDate":"$start","endDate":"$end","party":2,
             "destinations":[{"seq":0,"region":"제주","nights":${end.toEpochDay() - start.toEpochDay()}}]}
        """.trimIndent()
        return call(HttpMethod.POST, "/api/v1/trips", token, body).second["tripId"].asText()
    }

    private fun tripWithItinerary(token: String): String {
        val tripId = newTrip(token)
        call(HttpMethod.POST, "/api/v1/trips/$tripId/itinerary?mode=FULLY_AI", token).first shouldBe 201
        // 생성 2차(@Async)가 끝날 때까지 — 끝나기 전후로 두 응답을 받으면 비교가 흔들린다.
        val deadline = System.nanoTime() + java.time.Duration.ofSeconds(20).toNanos()
        while (System.nanoTime() < deadline) {
            if (get("/api/v1/trips/$tripId/itinerary", token)["generationState"].asText() != "PARTIAL") return tripId
            Thread.sleep(100)
        }
        error("일정 생성이 20초 안에 끝나지 않았다")
    }

    /** 섹션 비교가 빈 목록끼리의 비교로 끝나지 않게 — 오늘 날짜의 트리거와 방문을 하나씩 심는다. */
    private fun seedToday(token: String, tripId: String) {
        triggers.save(
            PlanBTrigger.active(
                UUID.fromString(tripId), UUID.randomUUID(), TriggerKind.WEATHER, today, null, emptyMap(),
                TriggerScope.FULL_DAY, "사유", Instant.now(), TriggerSeverity.RISK,
            ),
        )
        val poiId = get("/api/v1/trips/$tripId/itinerary", token)["days"][0]["slots"][0]["poiId"].asText()
        call(HttpMethod.POST, "/api/v1/trips/$tripId/visits", token, """{"poiId":"$poiId","source":"MANUAL"}""").first shouldBe 201
    }

    @Test
    fun `각 섹션은 개별 엔드포인트 응답과 JSON 으로 같다`() {
        val token = newToken()
        val tripId = tripWithItinerary(token)
        seedToday(token, tripId)

        val live = get("/api/v1/trips/$tripId/live", token)

        live["day"].asText() shouldBe today.toString()
        live["trip"] shouldBe get("/api/v1/trips/$tripId", token)
        live["itinerary"] shouldBe get("/api/v1/trips/$tripId/itinerary", token)
        live["triggers"] shouldBe get("/api/v1/trips/$tripId/triggers", token)
        live["visits"] shouldBe get("/api/v1/trips/$tripId/visits/days/$today", token)
        live["locationConsent"] shouldBe get("/api/v1/me/location-consent", token)
        live["unavailable"].toList().shouldBeEmpty()
        // 빈 목록끼리 같은 것이 아니다
        live["triggers"]["triggers"].toList().shouldNotBeEmpty()
        live["visits"]["visits"].toList().shouldNotBeEmpty()
    }

    @Test
    fun `요청한 날이 일정에 있으면 그날, 없으면 오늘`() {
        val token = newToken()
        val tripId = tripWithItinerary(token)
        val first = today.minusDays(1)

        get("/api/v1/trips/$tripId/live?day=$first", token)["day"].asText() shouldBe first.toString()
        get("/api/v1/trips/$tripId/live?day=${today.plusYears(1)}", token)["day"].asText() shouldBe today.toString()
    }

    @Test
    fun `일정이 없으면 일정과 날짜에 매인 섹션은 null 이고 위치 동의는 준다`() {
        val token = newToken()
        val tripId = newTrip(token)

        val live = get("/api/v1/trips/$tripId/live", token)

        live["trip"]["tripId"].asText() shouldBe tripId
        live["itinerary"].isNull shouldBe true
        live["day"].isNull shouldBe true
        live["triggers"].isNull shouldBe true
        live["visits"].isNull shouldBe true
        live["locationConsent"] shouldBe get("/api/v1/me/location-consent", token)
        live["unavailable"].toList().shouldBeEmpty()
    }

    @Test
    fun `남의 여행과 없는 여행은 404 다`() {
        val owner = newToken()
        val tripId = tripWithItinerary(owner)

        call(HttpMethod.GET, "/api/v1/trips/$tripId/live", newToken()).first shouldBe 404
        call(HttpMethod.GET, "/api/v1/trips/${UUID.randomUUID()}/live", owner).first shouldBe 404
    }

    /**
     * 측정 — 쿼리 수가 개별 5회 호출의 합을 넘지 않는다(같은 핸들러를 부르므로 늘 이유가 없다).
     * 수치는 PR 본문에 옮기려고 찍는다. 어떤 값이 이겨야 하는지는 단언하지 않는다 — 이 묶음의 이득은 쿼리가 아니라 왕복 수다.
     */
    @Test
    fun `묶음의 쿼리 수는 개별 5회 호출의 합을 넘지 않는다`() {
        val token = newToken()
        val tripId = tripWithItinerary(token)
        seedToday(token, tripId)
        val stats = emf.unwrap(SessionFactory::class.java).statistics
        stats.isStatisticsEnabled = true
        fun statements(block: () -> Unit): Long {
            stats.clear()
            block()
            return stats.prepareStatementCount
        }
        val paths = listOf(
            "/api/v1/trips/$tripId", "/api/v1/trips/$tripId/itinerary", "/api/v1/trips/$tripId/triggers",
            "/api/v1/trips/$tripId/visits/days/$today", "/api/v1/me/location-consent",
        )
        try {
            repeat(3) { paths.forEach { get(it, token) }; get("/api/v1/trips/$tripId/live", token) } // 데우기
            val separate = statements { paths.forEach { get(it, token) } }
            val bundled = statements { get("/api/v1/trips/$tripId/live", token) }
            // 시간은 로컬 왕복이라 네트워크 지연이 빠진 서버 처리 시간에 가깝다 — 20회 중앙값(ms).
            fun medianMs(block: () -> Unit) = List(20) { val t = System.nanoTime(); block(); (System.nanoTime() - t) / 1e6 }.sorted()[10]
            val separateMs = medianMs { paths.forEach { get(it, token) } }
            val bundledMs = medianMs { get("/api/v1/trips/$tripId/live", token) }
            println("LIVE-VIEW-MEASURE 개별 5회 쿼리=$separate 묶음 1회 쿼리=$bundled 개별 5회 순차 ms=%.1f 묶음 ms=%.1f".format(separateMs, bundledMs))
            bundled.toInt() shouldBeLessThanOrEqual separate.toInt()
        } finally {
            stats.isStatisticsEnabled = false
        }
    }
}
