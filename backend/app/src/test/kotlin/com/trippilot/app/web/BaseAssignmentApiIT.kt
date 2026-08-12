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
 * TRIP-178 — 구간 거점 배정 + 커버리지 API E2E. 배정·소유 스코프·기간검증·커버리지(auto/gap/overlap 차단)·삭제.
 * 여행(TRIP-177)·저장숙소(TRIP-176) API를 조립해 실제 크로스모듈(TripFacade) 경로를 태운다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class BaseAssignmentApiIT : AbstractPostgresIntegrationTest() {

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

    private fun newTrip(token: String): String {
        val body = """
            {"startDate":"2026-08-01","endDate":"2026-08-04","party":2,
             "destinations":[{"seq":0,"region":"제주","nights":3}],"preferenceSnapshot":{}}
        """.trimIndent()
        return call(HttpMethod.POST, "/api/v1/trips", token, body).second["tripId"].asText()
    }

    private fun newStay(token: String): String {
        val body = """{"name":"제주숙소","registerRoute":"PIN","lat":33.5,"lng":126.5,"coordConfirmed":true}"""
        return call(HttpMethod.POST, "/api/v1/saved-stays", token, body).second["savedStayId"].asText()
    }

    private fun newUnconfirmedStay(token: String): String {
        val body = """{"name":"미확정숙소","registerRoute":"LINK_PASTE","coordConfirmed":false}"""
        return call(HttpMethod.POST, "/api/v1/saved-stays", token, body).second["savedStayId"].asText()
    }

    private fun assignBody(stayId: String, from: String, to: String) =
        """{"savedStayId":"$stayId","dateFrom":"$from","dateTo":"$to"}"""

    @Test
    fun `인증 없으면 401`() {
        call(HttpMethod.GET, "/api/v1/trips/${java.util.UUID.randomUUID()}/coverage", null).first shouldBe 401
    }

    @Test
    fun `전 기간 단일 거점 배정(201) 후 커버리지 비차단`() {
        val token = newToken()
        val trip = newTrip(token)
        val stay = newStay(token)
        val (rc, base) = call(HttpMethod.POST, "/api/v1/trips/$trip/bases", token, assignBody(stay, "2026-08-01", "2026-08-04"))
        rc shouldBe 201
        base["savedStayId"].asText() shouldBe stay

        val (cs, cov) = call(HttpMethod.GET, "/api/v1/trips/$trip/coverage", token)
        cs shouldBe 200
        cov["blocked"].asBoolean() shouldBe false
        cov["days"].size() shouldBe 3
        cov["days"][0]["status"].asText() shouldBe "AUTO"
    }

    @Test
    fun `공백일이 있으면 커버리지 차단(GAP)`() {
        val token = newToken()
        val trip = newTrip(token)
        val stay = newStay(token)
        call(HttpMethod.POST, "/api/v1/trips/$trip/bases", token, assignBody(stay, "2026-08-01", "2026-08-03"))
        val cov = call(HttpMethod.GET, "/api/v1/trips/$trip/coverage", token).second
        cov["blocked"].asBoolean() shouldBe true
        cov["days"][2]["status"].asText() shouldBe "GAP"
    }

    /**
     * TRIP-190 — 겹치게 등록한 사용자가 실제로 빠져나오는 경로. 해소가 없으면 배정을 지우는 것 말고
     * 방법이 없었다. 화면이 하는 그대로 따라간다: 차단 확인 → 후보 확인 → 날짜별 선택 → 차단 해제.
     */
    @Test
    fun `겹침을 날짜별로 골라 풀면 커버리지 차단이 해제된다`() {
        val token = newToken()
        val trip = newTrip(token)
        val a = newStay(token)
        val b = newStay(token)
        call(HttpMethod.POST, "/api/v1/trips/$trip/bases", token, assignBody(a, "2026-08-01", "2026-08-04"))
        call(HttpMethod.POST, "/api/v1/trips/$trip/bases", token, assignBody(b, "2026-08-01", "2026-08-04"))

        val before = call(HttpMethod.GET, "/api/v1/trips/$trip/coverage", token).second
        before["blocked"].asBoolean() shouldBe true
        // 화면이 해소 시트를 그리려면 후보가 응답에 있어야 한다.
        before["days"][0]["candidates"].size() shouldBe 2
        before["days"][0]["resolution"].isNull shouldBe true

        listOf("2026-08-01", "2026-08-02", "2026-08-03").forEachIndexed { i, date ->
            val (rc, cov) = call(
                HttpMethod.PUT, "/api/v1/trips/$trip/coverage/days/$date", token, """{"savedStayId":"$b"}""",
            )
            rc shouldBe 200
            cov["days"][i]["resolution"].asText() shouldBe "USER_PICK"
            cov["days"][i]["savedStayId"].asText() shouldBe b
            // 배정이 겹친 사실 자체는 남는다 — 두 축이 다르다.
            cov["days"][i]["status"].asText() shouldBe "OVERLAP"
        }

        call(HttpMethod.GET, "/api/v1/trips/$trip/coverage", token).second["blocked"].asBoolean() shouldBe false
    }

    @Test
    fun `자동 확정된 날은 해소로 덮어쓸 수 없다(409)`() {
        val token = newToken()
        val trip = newTrip(token)
        val stay = newStay(token)
        call(HttpMethod.POST, "/api/v1/trips/$trip/bases", token, assignBody(stay, "2026-08-01", "2026-08-04"))

        val (rc, _) = call(
            HttpMethod.PUT, "/api/v1/trips/$trip/coverage/days/2026-08-01", token, """{"savedStayId":"$stay"}""",
        )
        rc shouldBe 409
    }

    @Test
    fun `남의 여행은 해소할 수 없다(404)`() {
        val owner = newToken()
        val trip = newTrip(owner)
        val a = newStay(owner)
        val b = newStay(owner)
        call(HttpMethod.POST, "/api/v1/trips/$trip/bases", owner, assignBody(a, "2026-08-01", "2026-08-04"))
        call(HttpMethod.POST, "/api/v1/trips/$trip/bases", owner, assignBody(b, "2026-08-01", "2026-08-04"))

        val stranger = newToken()
        val (rc, _) = call(
            HttpMethod.PUT, "/api/v1/trips/$trip/coverage/days/2026-08-01", stranger, """{"savedStayId":"$b"}""",
        )
        rc shouldBe 404
    }

    @Test
    fun `겹치는 두 거점은 OVERLAP 차단`() {
        val token = newToken()
        val trip = newTrip(token)
        val s1 = newStay(token)
        val s2 = newStay(token)
        call(HttpMethod.POST, "/api/v1/trips/$trip/bases", token, assignBody(s1, "2026-08-01", "2026-08-03"))
        call(HttpMethod.POST, "/api/v1/trips/$trip/bases", token, assignBody(s2, "2026-08-02", "2026-08-04"))
        val cov = call(HttpMethod.GET, "/api/v1/trips/$trip/coverage", token).second
        cov["blocked"].asBoolean() shouldBe true
        cov["days"][1]["status"].asText() shouldBe "OVERLAP"
    }

    @Test
    fun `좌표 미확정 숙소는 거점 배정 400(INV-U1-08)`() {
        val token = newToken()
        val trip = newTrip(token)
        val stay = newUnconfirmedStay(token)
        call(HttpMethod.POST, "/api/v1/trips/$trip/bases", token, assignBody(stay, "2026-08-01", "2026-08-04")).first shouldBe 400
    }

    @Test
    fun `거점으로 사용 중인 숙소 삭제는 409(500 아님)`() {
        val token = newToken()
        val trip = newTrip(token)
        val stay = newStay(token)
        call(HttpMethod.POST, "/api/v1/trips/$trip/bases", token, assignBody(stay, "2026-08-01", "2026-08-04")).first shouldBe 201
        call(HttpMethod.DELETE, "/api/v1/saved-stays/$stay", token).first shouldBe 409
    }

    /**
     * 기간 밖은 거부한다(INV-U1-15) — 서버가 여행 기간을 늘려 주지 않는다(US-TRIP-03 예외는 클라 2단계).
     * 화면이 "여행은 8/4까지예요. 늘릴까요?"를 그리려면 **어느 칸이 왜 틀렸는지**가 응답에 있어야 한다.
     */
    @Test
    fun `여행 기간 밖 구간은 400 — 어느 칸이 왜 틀렸는지 응답에 담긴다`() {
        val token = newToken()
        val trip = newTrip(token)
        val stay = newStay(token)

        val (rc, body) = call(
            HttpMethod.POST, "/api/v1/trips/$trip/bases", token, assignBody(stay, "2026-08-01", "2026-08-05"),
        )

        rc shouldBe 400
        val error = body["error"]["fields"][0]
        error["field"].asText() shouldBe "dateTo"
        error["reason"].asText().contains("2026-08-04") shouldBe true
    }

    @Test
    fun `타 계정 여행에 거점 배정은 404`() {
        val owner = newToken()
        val trip = newTrip(owner)
        val intruder = newToken()
        val stay = newStay(intruder)
        call(HttpMethod.POST, "/api/v1/trips/$trip/bases", intruder, assignBody(stay, "2026-08-01", "2026-08-04")).first shouldBe 404
    }

    @Test
    fun `거점 삭제(204) 후 목록 제외 · 커버리지 공백`() {
        val token = newToken()
        val trip = newTrip(token)
        val stay = newStay(token)
        val base = call(HttpMethod.POST, "/api/v1/trips/$trip/bases", token, assignBody(stay, "2026-08-01", "2026-08-04")).second["baseAssignmentId"].asText()
        call(HttpMethod.DELETE, "/api/v1/trips/$trip/bases/$base", token).first shouldBe 204
        call(HttpMethod.GET, "/api/v1/trips/$trip/bases", token).second.size() shouldBe 0
        call(HttpMethod.GET, "/api/v1/trips/$trip/coverage", token).second["blocked"].asBoolean() shouldBe true
    }
}
