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
import java.util.UUID

/**
 * 숙소 행의 연결 여행(TRIP-617 · BR-U6-20).
 *
 * 여기서만 드러나는 것 — 인메모리 대역으로는 **원리적으로** 못 본다:
 * - **소프트 삭제된 여행이 배정 행에 남는다** — `base_assignment` 는 여행이 지워져도 그대로다.
 *   Map 대역은 지우면 사라지므로 "걸러야 한다"는 성질 자체가 재현되지 않는다
 * - **한 여행에 구간이 여럿일 수 있다** — 날짜를 나눠 배정하면 행이 둘이고, 중복을 빼지 않으면
 *   같은 여행이 두 번 실린다
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class SavedStayLinkedTripsIT : AbstractPostgresIntegrationTest() {

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

    private fun newTrip(token: String): String {
        val body = """
            {"startDate":"2026-08-01","endDate":"2026-08-04","party":2,
             "destinations":[{"seq":0,"region":"제주","nights":3}],"preferenceSnapshot":{}}
        """.trimIndent()
        return call(HttpMethod.POST, "/api/v1/trips", token, body).second["tripId"].asText()
    }

    private fun newStay(token: String, name: String): String {
        val body = """{"name":"$name","registerRoute":"PIN","lat":33.5,"lng":126.5,"coordConfirmed":true}"""
        return call(HttpMethod.POST, "/api/v1/saved-stays", token, body).second["savedStayId"].asText()
    }

    private fun assignBase(token: String, trip: String, stay: String, from: String, to: String) {
        val body = """{"savedStayId":"$stay","dateFrom":"$from","dateTo":"$to"}"""
        call(HttpMethod.POST, "/api/v1/trips/$trip/bases", token, body).first shouldBe 201
    }

    private fun stayRow(token: String, stay: String): JsonNode =
        call(HttpMethod.GET, "/api/v1/saved-stays", token).second.single { it["savedStayId"].asText() == stay }

    private fun linked(token: String, stay: String): List<String> =
        stayRow(token, stay)["linkedTripIds"].map { it.asText() }

    @Test
    fun `거점이 아닌 숙소는 빈 목록이다 — 화면이 연결된 여행 없음 을 그리는 근거`() {
        val token = newToken()
        val stay = newStay(token, "그냥담은숙소")

        linked(token, stay) shouldBe emptyList()
    }

    @Test
    fun `거점으로 쓰인 여행이 실린다`() {
        val token = newToken()
        val trip = newTrip(token)
        val stay = newStay(token, "제주숙소")
        assignBase(token, trip, stay, "2026-08-01", "2026-08-04")

        linked(token, stay) shouldBe listOf(trip)
    }

    @Test
    fun `한 여행에 구간이 둘이어도 여행은 한 번만 실린다`() {
        val token = newToken()
        val trip = newTrip(token)
        val stay = newStay(token, "제주숙소")
        assignBase(token, trip, stay, "2026-08-01", "2026-08-02")
        assignBase(token, trip, stay, "2026-08-03", "2026-08-04")

        // 배정 행은 둘이다 — 중복을 빼지 않으면 같은 여행이 두 번 나온다.
        linked(token, stay) shouldBe listOf(trip)
    }

    @Test
    fun `지워진 여행은 빠진다 — 배정 행은 남아 있다`() {
        val token = newToken()
        val alive = newTrip(token)
        val gone = newTrip(token)
        val stay = newStay(token, "두여행숙소")
        assignBase(token, alive, stay, "2026-08-01", "2026-08-02")
        assignBase(token, gone, stay, "2026-08-03", "2026-08-04")

        call(HttpMethod.DELETE, "/api/v1/trips/$gone", token).first shouldBe 204
        // 소프트 삭제라 배정 행 자체는 그대로다 — 여기서 거르지 않으면 열 수 없는 여행이 붙는다.
        jdbc.queryForObject(
            "SELECT count(*) FROM base_assignment WHERE trip_id = ?", Int::class.java, UUID.fromString(gone),
        )!! shouldBe 1

        linked(token, stay) shouldBe listOf(alive)
    }

    @Test
    fun `단건 조회에도 연결이 실린다 — 목록만 채우면 상세가 비어 보인다`() {
        val token = newToken()
        val trip = newTrip(token)
        val stay = newStay(token, "제주숙소")
        assignBase(token, trip, stay, "2026-08-01", "2026-08-04")

        val (rc, body) = call(HttpMethod.GET, "/api/v1/saved-stays/$stay", token)

        rc shouldBe 200
        body["linkedTripIds"].map { it.asText() } shouldBe listOf(trip)
    }

    @Test
    fun `수정 응답에도 실제 연결이 실린다 — 빈 목록을 보내면 화면 캐시가 지워진다`() {
        val token = newToken()
        val trip = newTrip(token)
        val stay = newStay(token, "제주숙소")
        assignBase(token, trip, stay, "2026-08-01", "2026-08-04")

        // 메모만 고친다 — 거점 관계는 그대로다.
        val (rc, body) = call(
            HttpMethod.PATCH, "/api/v1/saved-stays/$stay", token,
            // 좌표 확정 숙소는 수정할 때도 좌표를 함께 실어야 한다(INV-U1-08).
            """{"name":"제주숙소","lat":33.5,"lng":126.5,"coordConfirmed":true,"memo":"주차 가능"}""",
        )

        rc shouldBe 200
        body["linkedTripIds"].map { it.asText() } shouldBe listOf(trip)
    }

    @Test
    fun `남의 여행은 실리지 않는다`() {
        val mine = newToken()
        val stay = newStay(mine, "내숙소")
        val myTrip = newTrip(mine)
        assignBase(mine, myTrip, stay, "2026-08-01", "2026-08-04")

        // 다른 계정에서 같은 숙소 id 를 물어도 그 계정의 숙소가 아니므로 목록에 없다.
        val other = newToken()
        call(HttpMethod.GET, "/api/v1/saved-stays", other).second.count() shouldBe 0
        linked(mine, stay) shouldBe listOf(myTrip)
    }
}
