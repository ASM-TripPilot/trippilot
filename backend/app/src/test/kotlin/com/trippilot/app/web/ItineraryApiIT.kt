package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.GenerationState
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
import org.springframework.web.client.RestClient
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * TRIP-267 — 일정 생성 API E2E(첫 슬라이스). 소유 여행 날짜 기준 생성·영속(스텁 ScheduleAgent).
 * 앵커·필수방문지·취향 조립은 후속 슬라이스라 여기선 흐름(생성 201·일자 수·소유 404·INV-3)만 검증.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ItineraryApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accessTokenIssuer: AccessTokenIssuer
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var itineraries: ItineraryRepository

    private val json = ObjectMapper()
    private val now = Instant.parse("2026-08-01T00:00:00Z")

    private fun call(method: HttpMethod, path: String, bearer: String?, body: String? = null): Pair<Int, JsonNode> {
        val spec = RestClient.builder().baseUrl("http://localhost:$port").build().method(method).uri(path)
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
        val body = """{"startDate":"2026-08-01","endDate":"2026-08-02","party":2,
            "destinations":[{"seq":0,"region":"제주","nights":1}],"preferenceSnapshot":{}}""".trimIndent()
        return call(HttpMethod.POST, "/api/v1/trips", token, body).second["tripId"].asText()
    }

    private fun poiId(token: String): String =
        call(HttpMethod.GET, "/api/v1/places?region=제주", token).second[0]["poiId"].asText()

    @Test
    fun `인증 없으면 401`() {
        call(HttpMethod.POST, "/api/v1/trips/${UUID.randomUUID()}/itinerary", null).first shouldBe 401
    }

    @Test
    fun `자정 넘김 슬롯 저장·조회 — ends_next_day 관통(TRIP-279)`() {
        val token = newToken()
        val trip = newTrip(token)
        // Fake 는 자정 슬롯을 안 만드므로 리포지토리로 직접 저장 → CHECK 완화 + 엔티티 매핑 + DTO 노출 검증.
        // POI 는 실 ACTIVE 정본을 쓴다(확정 시 poi_snapshot 동결이 가능해야 함).
        val midnight = Itinerary.create(
            UUID.fromString(trip), SolveMode.DETERMINISTIC, isFallback = false,
            days = listOf(
                ItineraryDay.of(
                    LocalDate.parse("2026-08-01"), 0,
                    listOf(VisitSlot.of(UUID.fromString(poiId(token)), null, 0, LocalTime.parse("23:00"), LocalTime.parse("01:00"), endsNextDay = true)),
                ),
            ),
            now = Instant.parse("2026-08-01T00:00:00Z"),
        )
        itineraries.replaceForTrip(UUID.fromString(trip), midnight) // end<start 인 슬롯 INSERT → 새 CHECK 통과해야

        val (rc, body) = call(HttpMethod.GET, "/api/v1/trips/$trip/itinerary", token)
        rc shouldBe 200
        val slot = body["days"][0]["slots"][0]
        slot["endsNextDay"].asBoolean() shouldBe true // 저장→조회→직렬화 전 구간 관통
        slot.has("startAt") shouldBe true
        slot.has("endAt") shouldBe true

        // 확정도 통과해야 한다 — 동결 재조립에서 플래그가 빠지면 endAt<startAt 검증에 걸려 400(회귀).
        val (confirmRc, confirmed) = call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary/confirm", token)
        confirmRc shouldBe 200
        confirmed["days"][0]["slots"][0]["endsNextDay"].asBoolean() shouldBe true
    }

    @Test
    fun `생성하면 201, 여행 날짜만큼 일자 생성 + PLANNED`() {
        val token = newToken()
        val trip = newTrip(token)

        val (rc, body) = call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token, """{"generationMode":"FULLY_AI"}""")
        rc shouldBe 201
        body["status"].asText() shouldBe "PLANNED"
        body["tripId"].asText() shouldBe trip
        body["days"].size() shouldBe 2 // 08-01 ~ 08-02(체크아웃 포함)
        body["generationState"].asText() shouldBe "COMPLETE" // 단일 호출 = 완료(2단계 day1 은 U5 이후 PARTIAL)
        val slot = body["days"][0]["slots"][0]
        slot.has("startAt") shouldBe true
        slot.has("endAt") shouldBe true
        slot.has("duration") shouldBe false // INV-3: 소요시간 미노출
    }

    @Test
    fun `타 계정 여행이면 404`() {
        val owner = newToken()
        val trip = newTrip(owner)
        val intruder = newToken()
        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", intruder).first shouldBe 404
    }

    @Test
    fun `생성 후 조회하면 200, 동일 일정`() {
        val token = newToken()
        val trip = newTrip(token)
        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token).first shouldBe 201

        val (rc, body) = call(HttpMethod.GET, "/api/v1/trips/$trip/itinerary", token)
        rc shouldBe 200
        body["tripId"].asText() shouldBe trip
        body["status"].asText() shouldBe "PLANNED"
        body["days"].size() shouldBe 2
    }

    @Test
    fun `생성 전 조회는 404`() {
        val token = newToken()
        val trip = newTrip(token)
        call(HttpMethod.GET, "/api/v1/trips/$trip/itinerary", token).first shouldBe 404
    }

    @Test
    fun `타 계정 조회는 404`() {
        val owner = newToken()
        val trip = newTrip(owner)
        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", owner).first shouldBe 201
        val intruder = newToken()
        call(HttpMethod.GET, "/api/v1/trips/$trip/itinerary", intruder).first shouldBe 404
    }

    @Test
    fun `확정하면 200 CONFIRMED, 조회 반영, 재확정 409`() {
        val token = newToken()
        val trip = newTrip(token)
        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token).first shouldBe 201

        val (rc, body) = call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary/confirm", token)
        rc shouldBe 200
        body["status"].asText() shouldBe "CONFIRMED"
        // poi_snapshot 동결(INV-U1-03) — 확정 시 전 슬롯이 스냅숏 참조를 가진다(실 ACTIVE POI, Fake 에이전트).
        itineraries.findByTrip(UUID.fromString(trip)).single().days.flatMap { it.slots }
            .all { it.poiSnapshotId != null } shouldBe true
        // 조회에도 CONFIRMED 반영
        call(HttpMethod.GET, "/api/v1/trips/$trip/itinerary", token).second["status"].asText() shouldBe "CONFIRMED"
        // 재확정은 409(단방향 잠금)
        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary/confirm", token).first shouldBe 409
    }

    @Test
    fun `편집(PUT)하면 200, 새 배열 저장 + hasViolation 표시(비차단)`() {
        val token = newToken()
        val trip = newTrip(token)
        val poi = poiId(token)
        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token).first shouldBe 201

        val editBody = """{"days":[
            {"date":"2026-08-01","slots":[{"poiId":"$poi","startAt":"10:00","endAt":"11:00","isFixed":false,"endsNextDay":false}]},
            {"date":"2026-08-02","slots":[{"poiId":"$poi","startAt":"23:00","endAt":"01:00","isFixed":false,"endsNextDay":true}]}]}""".trimIndent()
        val (rc, body) = call(HttpMethod.PUT, "/api/v1/trips/$trip/itinerary", token, editBody)
        rc shouldBe 200
        body["status"].asText() shouldBe "PLANNED"
        val slot = body["days"][0]["slots"][0]
        slot["poiId"].asText() shouldBe poi
        slot["hasViolation"].asBoolean() shouldBe false // Fake validate 빈 목록(위반 내용 검증은 229)
        // 자정 넘김 슬롯도 편집으로 재현·보존된다(회귀) — 요청에 endsNextDay 를 실어야 소실되지 않는다.
        body["days"][1]["slots"][0]["endsNextDay"].asBoolean() shouldBe true

        // 조회에도 편집 반영
        call(HttpMethod.GET, "/api/v1/trips/$trip/itinerary", token).second["days"][0]["slots"][0]["poiId"].asText() shouldBe poi
    }

    @Test
    fun `확정된 일정 편집은 409`() {
        val token = newToken()
        val trip = newTrip(token)
        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token).first shouldBe 201
        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary/confirm", token).first shouldBe 200
        val editBody = """{"days":[{"date":"2026-08-01","slots":[]}]}"""
        call(HttpMethod.PUT, "/api/v1/trips/$trip/itinerary", token, editBody).first shouldBe 409
    }

    @Test
    fun `PARTIAL 저장·조회 관통 + 생성 중 확정은 409(TRIP-267 계약)`() {
        val token = newToken()
        val trip = newTrip(token)
        // Fake 는 항상 COMPLETE 를 만드므로 리포지토리로 PARTIAL 을 직접 저장 —
        // V2.9 CHECK 값 집합·varchar 길이·엔티티 round-trip 을 한 번에 검증한다.
        val partial = Itinerary.create(
            UUID.fromString(trip), SolveMode.FULL_AI, isFallback = false,
            days = listOf(
                ItineraryDay.of(
                    LocalDate.parse("2026-08-01"), 0,
                    listOf(VisitSlot.of(UUID.fromString(poiId(token)), null, 0, LocalTime.parse("10:00"), LocalTime.parse("11:00"))),
                ),
            ),
            now = Instant.parse("2026-08-01T00:00:00Z"),
            generationState = GenerationState.PARTIAL,
        )
        itineraries.replaceForTrip(UUID.fromString(trip), partial)

        val (rc, body) = call(HttpMethod.GET, "/api/v1/trips/$trip/itinerary", token)
        rc shouldBe 200
        body["generationState"].asText() shouldBe "PARTIAL" // 저장→조회→직렬화 관통

        // 생성 중 확정은 409 — day1 만 동결된 채 잠기는 것 방지
        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary/confirm", token).first shouldBe 409
    }

    @Test
    fun `생성 전 확정은 404`() {
        val token = newToken()
        val trip = newTrip(token)
        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary/confirm", token).first shouldBe 404
    }

    @Test
    fun `재생성하면 기존 일정 교체 — 여행당 1개`() {
        val token = newToken()
        val trip = newTrip(token)
        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token).first shouldBe 201
        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token).first shouldBe 201
        itineraries.findByTrip(UUID.fromString(trip)).size shouldBe 1
    }

    @Test
    fun `필수 방문지가 고정 슬롯으로 생성에 반영`() {
        val token = newToken()
        val trip = newTrip(token)
        val poi = poiId(token)
        // FIXED 필수 방문지 08-01 12:00 (여행 기간 내)
        call(
            HttpMethod.POST, "/api/v1/trips/$trip/must-visits", token,
            """{"poiId":"$poi","type":"FIXED","fixedDate":"2026-08-01","fixedStart":"12:00","dwellMin":90}""",
        ).first shouldBe 201

        val (rc, body) = call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token)
        rc shouldBe 201
        val day0 = body["days"][0]["slots"]
        val hasFixed = (0 until day0.size()).any { day0[it]["isFixed"].asBoolean() && day0[it]["poiId"].asText() == poi }
        hasFixed shouldBe true // must_visit → fixedBlock → 고정 슬롯(HC3)
    }
}
