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
import com.trippilot.planbdetection.domain.OpportunityPort
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.ObjectProvider
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.HttpMethod
import org.springframework.http.client.JdkClientHttpRequestFactory
import org.springframework.web.client.RestClient
import java.time.Clock
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID

/**
 * 기회 조회 API — **기본 모드(off)** 의 앱 표면(situation-awareness BR-SA-22 규칙 6 · SEC-SA-02).
 *
 * 꺼져 있으면 기회 경계 빈 자체가 없다 — 그래도 앱이 뜨고, 소유 여행은 200 빈 목록(앱은 아무것도 그리지 않는다),
 * 남의 여행은 404 로 존재를 숨긴다. 켠 모드의 왕복은 [OpportunityHttpModeIT] 가 대역 AI 로 잰다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class OpportunityApiIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var itineraries: ItineraryRepository
    @Autowired private lateinit var tokens: AccessTokenIssuer
    @Autowired private lateinit var clock: Clock
    @Autowired private lateinit var ports: ObjectProvider<OpportunityPort>

    private val json = ObjectMapper()

    private fun call(path: String, token: String?): Pair<Int, JsonNode> {
        val spec = RestClient.builder().requestFactory(JdkClientHttpRequestFactory()).baseUrl("http://localhost:$port").build()
            .method(HttpMethod.GET).uri("/api/v1$path")
        token?.let { spec.header("Authorization", "Bearer $it") }
        val res = spec.retrieve().onStatus({ it.isError }, { _, _ -> }).toEntity(String::class.java)
        return res.statusCode.value() to (res.body?.takeIf { it.isNotBlank() }?.let { json.readTree(it) } ?: json.createObjectNode())
    }

    private fun account(): Pair<UUID, String> {
        val id = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, clock.instant())).id.value
        return id to tokens.issue(id.toString()).value
    }

    /** 진행 중 여행(어제~내일, 실 시계 KST) + 내일 슬롯(시드 장소 — 좌표 있음). 켰다면 AI 에 물었을 재료다. */
    private fun inProgressTrip(owner: UUID): UUID {
        val today = LocalDate.now(clock.withZone(KST))
        val tripId = trips.save(
            Trip.create(
                accountId = owner, title = null, startDate = today.minusDays(1), endDate = today.plusDays(1),
                party = 2, companionType = null, budgetTotal = null, preferenceSnapshot = emptyMap(),
                destinations = listOf(TripDestination(0, "제주", 2)), now = clock.instant(),
            ),
        ).tripId
        itineraries.save(
            Itinerary.create(
                tripId, SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, isFallback = false,
                days = listOf(
                    ItineraryDay.of(today.plusDays(1), 0, listOf(VisitSlot.of(SEONGSAN, null, 0, LocalTime.of(10, 0), LocalTime.of(11, 0)))),
                ),
                now = clock.instant(),
            ),
        )
        return tripId
    }

    @Test
    fun `꺼져 있으면 기회 경계 빈이 없고, 진행 중 여행이어도 200 빈 목록이다`() {
        val (owner, token) = account()
        val tripId = inProgressTrip(owner)
        val tomorrow = LocalDate.now(clock.withZone(KST)).plusDays(1)

        val (rc, body) = call("/trips/$tripId/opportunities?date=$tomorrow", token)

        ports.getIfAvailable().shouldBeNull()
        rc shouldBe 200
        body.fieldNames().asSequence().toList() shouldBe listOf("items") // 모양은 openapi OpportunityList 그대로
        body["items"].size() shouldBe 0
    }

    @Test
    fun `남의 여행·없는 여행은 404 로 숨기고, 인증이 없으면 401 이다`() {
        val (owner, _) = account()
        val tripId = inProgressTrip(owner)
        val (_, stranger) = account()
        val tomorrow = LocalDate.now(clock.withZone(KST)).plusDays(1)

        call("/trips/$tripId/opportunities?date=$tomorrow", stranger).first shouldBe 404
        call("/trips/${UUID.randomUUID()}/opportunities?date=$tomorrow", stranger).first shouldBe 404
        call("/trips/$tripId/opportunities?date=$tomorrow", null).first shouldBe 401
    }

    @Test
    fun `date 가 없거나 날짜 꼴이 아니면 400 이다`() {
        val (owner, token) = account()
        val tripId = inProgressTrip(owner)

        call("/trips/$tripId/opportunities", token).first shouldBe 400
        call("/trips/$tripId/opportunities?date=tomorrow", token).first shouldBe 400
        call("/trips/not-a-uuid/opportunities?date=2026-10-20", token).first shouldBe 400
    }

    private companion object {
        val KST: ZoneId = ZoneId.of("Asia/Seoul")
        val SEONGSAN: UUID = UUID.fromString("e0000000-0000-4000-8000-000000000001") // 시드 '성산일출봉'
    }
}
