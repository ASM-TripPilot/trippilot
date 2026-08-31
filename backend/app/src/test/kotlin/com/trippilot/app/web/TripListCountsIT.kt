package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.VisitSlot
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
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID

/**
 * 여행 카드 집계(TRIP-617 · BR-U6-22).
 *
 * 여기서만 드러나는 것 — 인메모리 대역으로는 **원리적으로** 못 본다:
 * - **배선이 실제로 이어지는가** — 여행(C6)은 숙소(C5)·일정(C8)을 의존할 수 없다(순환). 집계는
 *   `app` 의 포트 어댑터가 잇는데, 그 조립이 맞는지는 컨텍스트를 띄워야만 안다
 * - **거점 배정이 날짜별 행이라는 사실** — 한 숙소가 사흘을 덮으면 행이 셋이다. Fake 로는 그 모양이
 *   재현되지 않아 "숙소 수"와 "구간 수"의 차이가 드러나지 않는다
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class TripListCountsIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var itineraries: ItineraryRepository

    private val json = ObjectMapper()
    private val now = Instant.parse("2026-07-26T00:00:00Z")

    /** 서버가 "오늘"을 재는 존과 같은 값을 쓴다 — 러너 기본(UTC)으로 재면 하루가 어긋난다. */
    private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")

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

    private fun newTripBetween(token: String, start: LocalDate, end: LocalDate): String {
        val body = """
            {"startDate":"$start","endDate":"$end","party":2,
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

    private fun giveItinerary(trip: String, vararg dates: String) {
        itineraries.replaceForTrip(
            UUID.fromString(trip),
            Itinerary.create(
                UUID.fromString(trip), SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, isFallback = false,
                days = dates.mapIndexed { i, d ->
                    ItineraryDay.of(
                        LocalDate.parse(d), i,
                        listOf(VisitSlot.of(UUID.randomUUID(), null, 0, LocalTime.of(10, 0), LocalTime.of(11, 0))),
                    )
                },
                now = now,
            ),
        )
    }

    private fun tripCard(token: String, trip: String): JsonNode =
        call(HttpMethod.GET, "/api/v1/trips", token).second.single { it["tripId"].asText() == trip }

    @Test
    fun `아무것도 없는 여행은 0 이다 — 화면이 숙소 미등록 칩을 그리는 근거`() {
        val token = newToken()
        val trip = newTrip(token)

        val card = tripCard(token, trip)

        card["baseCount"].asInt() shouldBe 0
        card["itineraryDayCount"].asInt() shouldBe 0
    }

    @Test
    fun `한 숙소가 사흘을 덮어도 등록 숙소 수는 1이다 — 구간 수가 아니다(BR-U6-22)`() {
        val token = newToken()
        val trip = newTrip(token)
        val stay = newStay(token, "제주숙소")
        assignBase(token, trip, stay, "2026-08-01", "2026-08-04")

        // 배정은 날짜별 행이라 사흘이면 셋이다 — 중복을 빼지 않으면 여기서 3이 나온다.
        tripCard(token, trip)["baseCount"].asInt() shouldBe 1
    }

    @Test
    fun `숙소가 둘이면 2다`() {
        val token = newToken()
        val trip = newTrip(token)
        assignBase(token, trip, newStay(token, "앞숙소"), "2026-08-01", "2026-08-03")
        assignBase(token, trip, newStay(token, "뒷숙소"), "2026-08-03", "2026-08-04")

        tripCard(token, trip)["baseCount"].asInt() shouldBe 2
    }

    @Test
    fun `일정 일수는 일정이 있는 날의 수다`() {
        val token = newToken()
        val trip = newTrip(token)
        giveItinerary(trip, "2026-08-01", "2026-08-02", "2026-08-03")

        tripCard(token, trip)["itineraryDayCount"].asInt() shouldBe 3
    }

    @Test
    fun `남의 여행 집계가 섞이지 않는다`() {
        val mine = newToken()
        val other = newToken()
        val myTrip = newTrip(mine)
        val otherTrip = newTrip(other)
        assignBase(other, otherTrip, newStay(other, "남의숙소"), "2026-08-01", "2026-08-04")
        giveItinerary(otherTrip, "2026-08-01", "2026-08-02")

        // 집계를 계정으로 좁히지 않으면 남의 숙소·일정이 내 카드에 실린다.
        val card = tripCard(mine, myTrip)
        card["baseCount"].asInt() shouldBe 0
        card["itineraryDayCount"].asInt() shouldBe 0
    }

    @Test
    fun `수정 응답에도 실제 집계가 실린다 — 0 을 보내면 화면 캐시가 비어 버린다`() {
        val token = newToken()
        // **끝난 여행은 수정이 막힌다**(409). 다른 테스트는 고정 날짜로 충분하지만 이 칸만은
        // 오늘 이후여야 한다 — 고정 날짜로 두면 그 날이 지나는 순간 조용히 빨개진다.
        val start = LocalDate.now(TRAVEL_ZONE).plusDays(7)
        val end = start.plusDays(3)
        val trip = newTripBetween(token, start, end)
        assignBase(token, trip, newStay(token, "제주숙소"), "$start", "$end")
        giveItinerary(trip, "$start", "${start.plusDays(1)}")

        // 제목만 고친다 — 숙소·일정은 그대로다.
        val (rc, body) = call(
            HttpMethod.PATCH, "/api/v1/trips/$trip", token,
            """{"title":"이름만 바꾼 여행","startDate":"$start","endDate":"$end","party":2,
                "destinations":[{"seq":0,"region":"제주","nights":3}]}""",
        )

        rc shouldBe 200
        body["baseCount"].asInt() shouldBe 1
        body["itineraryDayCount"].asInt() shouldBe 2
    }

    @Test
    fun `INV-3 카드 어디에도 소요시간이 없다`() {
        val token = newToken()
        val trip = newTrip(token)
        giveItinerary(trip, "2026-08-01")

        val names = tripCard(token, trip).fieldNames().asSequence().toList()

        // 개수는 싣고 시간은 싣지 않는다 — 한 번 열리면 화면이 그것을 그린다.
        names.none { it.contains("duration", true) || it.contains("minutes", true) } shouldBe true
        names.contains("itineraryDayCount") shouldBe true
    }
}
