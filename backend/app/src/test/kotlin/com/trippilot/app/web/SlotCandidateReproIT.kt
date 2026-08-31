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
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.web.client.RestClient
import java.time.Instant

/**
 * 슬롯 교체 후보가 정말 0건인가(TRIP-481 재현).
 *
 * 티켓은 "h11 '다른 후보 >' 가 항상 0건"이라 적고 원인을 **로컬 반경 조회 구간**으로 지목했다.
 * 그런데 코드 사슬(SlotCandidateService → LocalSlotCandidateSource → PlaceDataCandidatePool →
 * BoundingBox/Haversine)을 훑어도 깨진 곳이 없고, 시드 실측으로도 용두암 3km 안에 ACTIVE 가 넷이다.
 *
 * 그래서 **읽기를 멈추고 실제 흐름으로 재현한다.** 이 테스트가 후보를 찾으면 티켓의 원인 지목이
 * 틀린 것이고, 0건이 나오면 그 지점부터 좁히면 된다. 어느 쪽이든 다음 한 걸음이 정해진다.
 *
 * 실 시드(`R__seed_stub_pois`)를 쓴다 — 후보가 서로 얼마나 떨어져 있는지가 이 결함의 본질이라,
 * 좌표를 지어내면 재현이 아니라 다른 실험이 된다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class SlotCandidateReproIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

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

    /** 제주 사흘 여행 — 시드 POI 가 가장 촘촘한 지역이고, 슬롯이 많아야 조건을 넓게 훑는다. */
    private fun jejuTrip(token: String): String {
        val body = """
            {"startDate":"2026-08-01","endDate":"2026-08-03","party":2,
             "destinations":[{"seq":0,"region":"제주","nights":2}],"preferenceSnapshot":{}}
        """.trimIndent()
        return call(HttpMethod.POST, "/api/v1/trips", token, body).second["tripId"].asText()
    }

    private fun awaitComplete(token: String, trip: String): JsonNode {
        val deadline = System.nanoTime() + 20_000_000_000L
        var last = json.createObjectNode() as JsonNode
        while (System.nanoTime() < deadline) {
            last = call(HttpMethod.GET, "/api/v1/trips/$trip/itinerary", token).second
            when (last["generationState"]?.asText()) {
                "PARTIAL" -> Thread.sleep(50)
                "COMPLETE" -> return last
                else -> error("생성이 완료되지 않았습니다: $last")
            }
        }
        error("생성이 기한 내 끝나지 않았습니다: $last")
    }

    @Test
    fun `일정의 모든 슬롯에 교체 후보가 나온다 — "항상 0건"이 사실인지 훑는다`() {
        val token = newToken()
        val trip = jejuTrip(token)
        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token).first shouldBe 201
        val itinerary = awaitComplete(token, trip)

        val inItinerary = itinerary["days"].flatMap { d -> d["slots"].map { it["poiId"].asText() } }
        val empty = mutableListOf<String>()
        var checked = 0

        for (day in itinerary["days"]) {
            val date = day["date"].asText()
            for (slot in day["slots"]) {
                val poi = slot["poiId"].asText()
                val (rc, body) = call(
                    HttpMethod.POST, "/api/v1/trips/$trip/itinerary/slot-candidates", token,
                    """{"slotKey":"$date#$poi"}""",
                )
                rc shouldBe 200
                checked++
                if (body["candidates"].size() == 0) {
                    empty += "$date#$poi(반경=${body["radiusMUsed"]}, 주변ACTIVE=${nearbyActive(poi)})"
                }
            }
        }

        // 0건이 나오는 슬롯이 있으면 **어느 것이 왜인지** 메시지에 담는다 — 재현 조건을 좁히는 것이 이 칸의 일이다.
        withClue(
            "후보 0건 슬롯 ${empty.size}/$checked. 일정에 든 POI ${inItinerary.size}개.\n  " +
                empty.joinToString("\n  "),
        ) {
            empty.isEmpty() shouldBe true
        }
    }

    /** 진단용 — 그 슬롯 중심에서 가까운 ACTIVE POI 와 거리(m). 0건일 때 이유가 보이게 한다. */
    private fun nearbyActive(poiId: String): List<Map<String, Any?>> = jdbc.queryForList(
        """
        SELECT p.name_ko,
               round((6371000 * 2 * asin(sqrt(
                 power(sin(radians(p.lat - c.lat) / 2), 2) +
                 cos(radians(c.lat)) * cos(radians(p.lat)) *
                 power(sin(radians(p.lng - c.lng) / 2), 2)
               )))::numeric) AS m
          FROM poi p, (SELECT lat, lng FROM poi WHERE poi_id = ?::uuid) c
         WHERE p.data_status = 'ACTIVE'
         ORDER BY m LIMIT 6
        """.trimIndent(),
        poiId,
    )

}

private inline fun <T> withClue(clue: String, block: () -> T): T =
    io.kotest.assertions.withClue(clue, block)
