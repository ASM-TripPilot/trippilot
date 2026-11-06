package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.itinerarygeneration.application.ItineraryPeriodShiftService
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.VisitSlot
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.collections.shouldContainExactly
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
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID

/**
 * 여행 기간 이동 · 커버(TRIP-1789) — 인메모리 대역이 **원리적으로** 못 보는 것:
 * - `trip_base_day` 날짜가 PK 라, 겹치는 칸수로 밀면 UPDATE 는 아직 안 옮긴 행과 부딪힌다(대역은 Map 이라 언제나 통과)
 * - 일정 교체의 bulk clear 가 같은 트랜잭션의 앞선 쓰기를 버릴 수 있다 — 네 표가 **한 트랜잭션에서 다 바뀌는지**
 * - 409 면 트랜잭션째 롤백이라 아무 날짜도 안 바뀌는지
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class TripPeriodShiftIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var itineraries: ItineraryRepository
    @Autowired private lateinit var shifts: ItineraryPeriodShiftService
    @Autowired private lateinit var jdbc: JdbcTemplate

    private val json = ObjectMapper()
    private val now = Instant.parse("2026-07-26T00:00:00Z")

    /** 서버 오늘과 같은 존(KST). 러너 기본 존으로 재면 하루가 어긋난다. */
    private val today = LocalDate.now(ZoneId.of("Asia/Seoul"))

    private fun call(method: HttpMethod, path: String, bearer: String, body: String? = null): Pair<Int, JsonNode> {
        val spec = RestClient.builder().requestFactory(JdkClientHttpRequestFactory()).baseUrl("http://localhost:$port").build()
            .method(method).uri(path).header("Authorization", "Bearer $bearer")
        body?.let { spec.contentType(MediaType.APPLICATION_JSON).body(it) }
        val res = spec.retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> }).toEntity(String::class.java)
        return res.statusCode.value() to (res.body?.takeIf { it.isNotBlank() }?.let { json.readTree(it) } ?: json.createObjectNode())
    }

    private fun newToken() =
        accessTokenIssuer.issue(accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)).id.value.toString()).value

    private fun tripBody(start: LocalDate, end: LocalDate, extra: String = "") = """
        {"startDate":"$start","endDate":"$end","party":2,"destinations":[{"seq":0,"region":"제주","nights":0}]$extra}
    """.trimIndent()

    private fun newTrip(token: String, start: LocalDate, end: LocalDate): UUID =
        UUID.fromString(call(HttpMethod.POST, "/api/v1/trips", token, tripBody(start, end)).second["tripId"].asText())

    private fun patch(token: String, trip: UUID, start: LocalDate, end: LocalDate, extra: String = "") =
        call(HttpMethod.PATCH, "/api/v1/trips/$trip", token, tripBody(start, end, extra))

    private val poiA = UUID.randomUUID()
    private val poiB = UUID.randomUUID()

    private fun seedItinerary(trip: UUID, start: LocalDate, flagged: Boolean = false) = itineraries.replaceForTrip(
        trip,
        Itinerary.create(
            trip, SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, isFallback = false,
            days = (0..2).map { i ->
                ItineraryDay.of(
                    start.plusDays(i.toLong()), i,
                    listOf(
                        VisitSlot.of(poiA, null, 0, LocalTime.of(10, 0), LocalTime.of(11, 0), hasViolation = flagged, violationReason = "옛 사유".takeIf { flagged }),
                        VisitSlot.of(poiB, null, 1, LocalTime.of(13, i), LocalTime.of(14, 0), isFixed = true, distanceRange = "약 1km"),
                    ),
                )
            },
            now = now,
        ),
    )

    private fun newStay(token: String): UUID = UUID.fromString(
        call(HttpMethod.POST, "/api/v1/saved-stays", token, """{"name":"제주숙소","registerRoute":"PIN","lat":33.5,"lng":126.5,"coordConfirmed":true}""").second["savedStayId"].asText(),
    )

    /** 하루 1행(PK) 3개를 잇달아 — 하루만 밀어도 2개 칸이 겹친다. */
    private fun seedBases(trip: UUID, stay: UUID, start: LocalDate) {
        jdbc.update("INSERT INTO base_assignment (trip_id, saved_stay_id, date_from, date_to) VALUES (?, ?, ?, ?)", trip, stay, start, start.plusDays(2))
        (0L..2L).forEach { jdbc.update("INSERT INTO trip_base_day (trip_id, day_date, saved_stay_id, resolution) VALUES (?, ?, ?, 'user_pick')", trip, start.plusDays(it), stay) }
    }

    private fun seedFixedMustVisit(trip: UUID, date: LocalDate) {
        val poi = UUID.randomUUID()
        val snapshot = jdbc.queryForObject(
            "INSERT INTO poi_snapshot (source_poi_id, name_ko, lat, lng, category) VALUES (?, '동결', 33.5, 126.5, '명소') RETURNING poi_snapshot_id", UUID::class.java, poi,
        )
        jdbc.update("INSERT INTO must_visit (trip_id, poi_snapshot_id, source_poi_id, type, fixed_date, fixed_start) VALUES (?, ?, ?, 'FIXED', ?, '10:00')", trip, snapshot, poi, date)
    }

    private fun itineraryDates(trip: UUID) =
        jdbc.queryForList("SELECT d.day_date FROM itinerary_day d JOIN itinerary i USING (itinerary_id) WHERE i.trip_id = ? ORDER BY d.day_order", LocalDate::class.java, trip)

    private fun baseDays(trip: UUID) =
        jdbc.queryForList("SELECT day_date FROM trip_base_day WHERE trip_id = ? ORDER BY day_date", LocalDate::class.java, trip)

    private fun fixedDate(trip: UUID) =
        jdbc.queryForObject("SELECT fixed_date FROM must_visit WHERE trip_id = ?", LocalDate::class.java, trip)

    private fun assignment(trip: UUID) = jdbc.queryForMap("SELECT date_from, date_to FROM base_assignment WHERE trip_id = ?", trip).values.map { (it as java.sql.Date).toLocalDate() }

    @Test
    fun `하루 뒤로 — 일정 거점 꼭 갈 곳이 같이 밀리고 슬롯 순서 시각은 그대로다`() {
        val token = newToken()
        val start = today.plusDays(30)
        val trip = newTrip(token, start, start.plusDays(2))
        seedItinerary(trip, start)
        val stay = newStay(token)
        seedBases(trip, stay, start)
        seedFixedMustVisit(trip, start.plusDays(1))

        val (status, body) = patch(token, trip, start.plusDays(1), start.plusDays(3))

        status shouldBe 200
        body["startDate"].asText() shouldBe start.plusDays(1).toString()
        itineraryDates(trip) shouldContainExactly (1L..3L).map { start.plusDays(it) }
        baseDays(trip) shouldContainExactly (1L..3L).map { start.plusDays(it) }
        assignment(trip) shouldContainExactly listOf(start.plusDays(1), start.plusDays(3))
        fixedDate(trip) shouldBe start.plusDays(2)

        val days = call(HttpMethod.GET, "/api/v1/trips/$trip/itinerary", token).second["days"]
        days.map { it["date"].asText() } shouldContainExactly (1L..3L).map { start.plusDays(it).toString() }
        days[1]["slots"].map { it["poiId"].asText() } shouldContainExactly listOf(poiA.toString(), poiB.toString())
        days[1]["slots"][1]["startAt"].asText().startsWith("13:01") shouldBe true
        days[1]["slots"][1]["distanceRange"].asText() shouldBe "약 1km"

        // 알림 재적재·위반 재검증 구독자가 받을 사건이 같은 트랜잭션에 쌓였다
        jdbc.queryForObject(
            "SELECT count(*) FROM outbox_event WHERE event_type = 'trip.TripPeriodChanged' AND aggregate_id = ?", Long::class.java, trip.toString(),
        ) shouldBe 1L
    }

    @Test
    fun `앞으로 하루 — 음수 칸수도 겹쳐서 민다`() {
        val token = newToken()
        val start = today.plusDays(30)
        val trip = newTrip(token, start, start.plusDays(2))
        seedItinerary(trip, start)
        seedBases(trip, newStay(token), start)

        patch(token, trip, start.minusDays(1), start.plusDays(1)).first shouldBe 200

        baseDays(trip) shouldContainExactly (-1L..1L).map { start.plusDays(it) }
        itineraryDates(trip).first() shouldBe start.minusDays(1)
    }

    @Test
    fun `일수가 바뀌면 409 — 일정 거점 꼭 갈 곳 여행 어느 것도 안 바뀐다`() {
        val token = newToken()
        val start = today.plusDays(30)
        val trip = newTrip(token, start, start.plusDays(2))
        seedItinerary(trip, start)
        seedBases(trip, newStay(token), start)
        seedFixedMustVisit(trip, start)

        val (status, body) = patch(token, trip, start.plusDays(1), start.plusDays(5))

        status shouldBe 409
        body["error"]["code"].asText() shouldBe "TRIP_PERIOD_LENGTH_CHANGED"
        itineraryDates(trip).first() shouldBe start
        baseDays(trip).first() shouldBe start
        fixedDate(trip) shouldBe start
        call(HttpMethod.GET, "/api/v1/trips/$trip", token).second["endDate"].asText() shouldBe start.plusDays(2).toString()
    }

    @Test
    fun `여행 중이면 409 — 시작일 당일도 시작이다`() {
        val token = newToken()
        val trip = newTrip(token, today, today.plusDays(2))
        seedItinerary(trip, today)

        val (status, body) = patch(token, trip, today.plusDays(1), today.plusDays(3))

        status shouldBe 409
        body["error"]["code"].asText() shouldBe "TRIP_PERIOD_STARTED"
        itineraryDates(trip).first() shouldBe today
    }

    @Test
    fun `배정만 있고 날짜별 거점이 없어도 밀린다 — 일정 교체의 clear 가 거점 쓰기를 버리지 않는다`() {
        val token = newToken()
        val start = today.plusDays(30)
        val trip = newTrip(token, start, start.plusDays(2))
        seedItinerary(trip, start)
        jdbc.update("INSERT INTO base_assignment (trip_id, saved_stay_id, date_from, date_to) VALUES (?, ?, ?, ?)", trip, newStay(token), start, start.plusDays(2))

        patch(token, trip, start.plusDays(5), start.plusDays(7)).first shouldBe 200

        assignment(trip) shouldContainExactly listOf(start.plusDays(5), start.plusDays(7))
    }

    @Test
    fun `버리기 — 일수를 늘려도 일정이 사라지고 기간이 바뀌며 꼭 갈 곳은 장소만 거점은 잘려 남는다`() {
        val token = newToken()
        val start = today.plusDays(30)
        val trip = newTrip(token, start, start.plusDays(2))
        seedItinerary(trip, start)
        seedBases(trip, newStay(token), start)
        seedFixedMustVisit(trip, start)

        val (status, body) = patch(token, trip, start.plusDays(1), start.plusDays(6), ""","discardItinerary":true""")

        status shouldBe 200
        body["endDate"].asText() shouldBe start.plusDays(6).toString()
        body["itineraryDayCount"].asInt() shouldBe 0
        call(HttpMethod.GET, "/api/v1/trips/$trip/itinerary", token).first shouldBe 404
        itineraryDates(trip) shouldBe emptyList()
        // [start, start+2) → [start+1, start+2)
        assignment(trip) shouldContainExactly listOf(start.plusDays(1), start.plusDays(2))
        baseDays(trip) shouldContainExactly listOf(start.plusDays(1), start.plusDays(2))
        // 날짜·시각만 비고 자유 배치로 — DB CHECK(chk_mustvisit_fixed)도 통과해야 한다
        jdbc.queryForMap("SELECT type, fixed_date, fixed_start FROM must_visit WHERE trip_id = ?", trip).let {
            it["type"] shouldBe "ANYTIME"
            it["fixed_date"] shouldBe null
            it["fixed_start"] shouldBe null
        }
        // 버린 일정은 되돌리기 목록에 남는다(같은 트랜잭션 — 삭제의 clear 에 버려지지 않았다)
        jdbc.queryForObject("SELECT summary FROM itinerary_revision WHERE trip_id = ?", String::class.java, trip) shouldBe "기간을 바꾸며 버린 일정"
    }

    @Test
    fun `버리기 — 거점이 전부 새 기간 밖이면 지워진다`() {
        val token = newToken()
        val start = today.plusDays(30)
        val trip = newTrip(token, start, start.plusDays(2))
        seedItinerary(trip, start)
        seedBases(trip, newStay(token), start)

        patch(token, trip, start.plusDays(20), start.plusDays(21), ""","discardItinerary":true""").first shouldBe 200

        jdbc.queryForObject("SELECT count(*) FROM base_assignment WHERE trip_id = ?", Long::class.java, trip) shouldBe 0L
        baseDays(trip) shouldBe emptyList()
    }

    @Test
    fun `버리기 — 시작 뒤면 true 여도 409 이고 일정이 그대로다`() {
        val token = newToken()
        val trip = newTrip(token, today, today.plusDays(2))
        seedItinerary(trip, today)

        val (status, body) = patch(token, trip, today.plusDays(1), today.plusDays(9), ""","discardItinerary":true""")

        status shouldBe 409
        body["error"]["code"].asText() shouldBe "TRIP_PERIOD_STARTED"
        itineraryDates(trip).size shouldBe 3
    }

    @Test
    fun `커버 키 — 저장되고 조회에 실리고 형식이 틀리면 400 이다`() {
        val token = newToken()
        val start = today.plusDays(30)
        val trip = newTrip(token, start, start.plusDays(2))

        patch(token, trip, start, start.plusDays(2), ""","coverKey":"11110"""").second["coverKey"].asText() shouldBe "11110"
        call(HttpMethod.GET, "/api/v1/trips/$trip", token).second["coverKey"].asText() shouldBe "11110"

        patch(token, trip, start, start.plusDays(2), ""","coverKey":"../evil"""").first shouldBe 400
        patch(token, trip, start, start.plusDays(2), ""","coverKey":"${"a".repeat(41)}"""").first shouldBe 400
        patch(token, trip, start, start.plusDays(2), ""","coverKey":""""").first shouldBe 400

        patch(token, trip, start, start.plusDays(2)).second["coverKey"].isNull shouldBe true
    }

    @Test
    fun `재검증이 실 DB 에 위반 표시를 다시 쓴다 — 일정 id 유지`() {
        val token = newToken()
        val start = today.plusDays(30)
        val trip = newTrip(token, start, start.plusDays(2))
        val seeded = seedItinerary(trip, start, flagged = true)

        shifts.revalidate(trip) // 기본 모드는 가짜 검증 — 위반 없음

        val after = itineraries.findByTrip(trip).single()
        after.itineraryId shouldBe seeded.itineraryId
        after.days.flatMap { it.slots }.any { it.hasViolation } shouldBe false
        after.days.first().slots[1].distanceRange shouldBe "약 1km"
    }
}
