package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.sun.net.httpserver.HttpServer
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.VisitSlot
import com.trippilot.planbdetection.adapter.out.external.HttpOpportunityAdapter
import com.trippilot.planbdetection.domain.OpportunityPort
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.collections.shouldContainExactlyInAnyOrder
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.shouldBe
import io.kotest.matchers.types.shouldBeInstanceOf
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.core.io.ClassPathResource
import org.springframework.http.HttpMethod
import org.springframework.http.client.JdkClientHttpRequestFactory
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.web.client.RestClient
import org.yaml.snakeyaml.Yaml
import java.net.InetSocketAddress
import java.time.Clock
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.Collections
import java.util.UUID

/**
 * 기회 조회 — **켠 모드(http)** 의 앱 관통(situation-awareness T-IT-10): 컨트롤러 → 서비스(남은 슬롯·계획 POI 를 서버가 채움)
 * → 실 HTTP 어댑터(경계 매퍼·시한) → 상대 → 2차 게이트 → camelCase 응답.
 *
 * 상대는 로컬 대역 서버다(CI 외부 호출 0). 실 AI 왕복은 이 테스트가 보증하지 않는다 — 계약 게이트와 대역이 지키는 것은
 * 이름·모양까지다(수용 보증 아님). 날짜는 서버 실 시계로 정하고, 대상은 시각과 무관한 **내일**(하루 전체가 남은 슬롯)이다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class OpportunityHttpModeIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var itineraries: ItineraryRepository
    @Autowired private lateinit var tokens: AccessTokenIssuer
    @Autowired private lateinit var clock: Clock
    @Autowired private lateinit var opportunityPort: OpportunityPort

    private val json = ObjectMapper()

    @BeforeEach
    fun reset() {
        FakeAi.received.clear()
        FakeAi.status = 200
    }

    private fun call(path: String, token: String): Pair<Int, JsonNode> {
        val res = RestClient.builder().requestFactory(JdkClientHttpRequestFactory()).baseUrl("http://localhost:$port").build()
            .method(HttpMethod.GET).uri("/api/v1$path").header("Authorization", "Bearer $token")
            .retrieve().onStatus({ it.isError }, { _, _ -> }).toEntity(String::class.java)
        return res.statusCode.value() to (res.body?.takeIf { it.isNotBlank() }?.let { json.readTree(it) } ?: json.createObjectNode())
    }

    private class Fixture(val tripId: UUID, val token: String, val today: LocalDate)

    /** 진행 중 여행(어제~내일, 실 시계 KST) — 오늘 용두암 하나, 내일 성산일출봉 → 만장굴(시드 장소, 좌표 있음). */
    private fun inProgressTrip(): Fixture {
        val today = LocalDate.now(clock.withZone(KST))
        val owner = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, clock.instant())).id.value
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
                    ItineraryDay.of(today, 0, listOf(VisitSlot.of(YONGDUAM, null, 0, LocalTime.of(10, 0), LocalTime.of(11, 0)))),
                    ItineraryDay.of(
                        today.plusDays(1), 1,
                        listOf(
                            VisitSlot.of(SEONGSAN, null, 0, LocalTime.of(10, 0), LocalTime.of(11, 0)),
                            VisitSlot.of(MANJANGGUL, null, 1, LocalTime.of(12, 0), LocalTime.of(13, 0)),
                        ),
                    ),
                ),
                now = clock.instant(),
            ),
        )
        return Fixture(tripId, tokens.issue(owner.toString()).value, today)
    }

    /** openapi 정본 스키마의 속성 이름 — 응답 키 집합을 이것과 맞대 본다(있는 키만 골라 묻는 단언은 누락·초과를 못 본다). */
    @Suppress("UNCHECKED_CAST")
    private fun schemaProps(name: String): Set<String> {
        val spec = Yaml().load<Map<String, Any>>(ClassPathResource("static/openapi.yaml").inputStream)
        val schemas = (spec["components"] as Map<String, Any>)["schemas"] as Map<String, Any>
        return ((schemas[name] as Map<String, Any>)["properties"] as Map<String, Any>).keys
    }

    @Test
    fun `http 모드에서 앱이 뜨고 실 HTTP 어댑터가 주입된다`() {
        opportunityPort.shouldBeInstanceOf<HttpOpportunityAdapter>()
    }

    @Test
    fun `내일을 보면 그 날 남은 슬롯과 일정 전체 장소를 실어 묻고, 받은 기회를 앱 계약 모양으로 낸다`() {
        val f = inProgressTrip()
        val tomorrow = f.today.plusDays(1)

        val (rc, body) = call("/trips/${f.tripId}/opportunities?date=$tomorrow", f.token)

        rc shouldBe 200
        // 상대가 받은 것 — 서버가 일정에서 채웠다(앱은 날짜만 보냈다).
        val sent = json.readTree(FakeAi.received.single())
        sent["date"].asText() shouldBe tomorrow.toString()
        sent["slots"].map { it["slot_key"].asText() } shouldContainExactly listOf("$tomorrow#$SEONGSAN", "$tomorrow#$MANJANGGUL")
        sent["slots"][0]["coord"]["lat"].asDouble() shouldBe 33.4587
        sent["slots"][0]["coord"]["lng"].asDouble() shouldBe 126.9427
        sent["planned_poi_ids"].map { it.asText() } shouldContainExactlyInAnyOrder listOf(SEONGSAN, MANJANGGUL, YONGDUAM).map { it.toString() }
        sent["request_meta"]["deadline_ms"].asLong() shouldBe 3_000
        // 앱이 받은 것 — camelCase · 키 집합이 정본 스키마와 같다.
        body.fieldNames().asSequence().toSet() shouldBe schemaProps("OpportunityList")
        val item = body["items"].single()
        item.fieldNames().asSequence().toSet() shouldBe schemaProps("Opportunity")
        item["kind"].asText() shouldBe "TRENDING"
        item["poiId"].asText() shouldBe WOLJEONGRI.toString()
        item["poiName"].asText() shouldBe "월정리 카페거리"
        item["nearSlotKey"].asText() shouldBe "$tomorrow#$SEONGSAN"
        item["distanceLabel"].asText() shouldBe "약 400m"
        item["eventName"].isNull shouldBe true
        item["end"].isNull shouldBe true
    }

    @Test
    fun `상대가 실패하면 200 빈 목록이다 — 허브를 막지 않는다`() {
        val f = inProgressTrip()
        FakeAi.status = 503

        val (rc, body) = call("/trips/${f.tripId}/opportunities?date=${f.today.plusDays(1)}", f.token)

        FakeAi.received shouldHaveSize 1 // 물었고, 실패를 빈 목록으로 접었다
        rc shouldBe 200
        body["items"].size() shouldBe 0
    }

    @Test
    fun `지난 날짜는 상대를 부르지 않는다`() {
        val f = inProgressTrip()

        val (rc, body) = call("/trips/${f.tripId}/opportunities?date=${f.today.minusDays(1)}", f.token)

        rc shouldBe 200
        body["items"].size() shouldBe 0
        FakeAi.received.shouldBeEmpty()
    }

    /** 상대 대역 — 받은 본문을 모으고, 보낸 첫 슬롯 곁의 '요즘 인기' 한 곳(일정 밖 시드 장소)을 답한다. */
    private object FakeAi {
        val received: MutableList<String> = Collections.synchronizedList(mutableListOf())

        @Volatile var status = 200

        val server: HttpServer by lazy {
            HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
                createContext("/ai/v1/planb/opportunities") { ex ->
                    val body = ex.requestBody.readBytes().decodeToString()
                    received += body
                    if (status != 200) {
                        ex.sendResponseHeaders(status, -1)
                    } else {
                        val near = ObjectMapper().readTree(body)["slots"][0]["slot_key"].asText()
                        val reply = """{"opportunities":[{"key":"trending:$WOLJEONGRI","kind":"TRENDING","event_name":null,
                            "start":null,"end":null,"poi_id":"$WOLJEONGRI","poi_name":"월정리 카페거리",
                            "near_slot_key":"$near","distance_label":"약 400m"}],"notes":["events_unwired"]}""".toByteArray()
                        ex.responseHeaders.add("Content-Type", "application/json")
                        ex.sendResponseHeaders(200, reply.size.toLong())
                        ex.responseBody.use { it.write(reply) }
                    }
                    ex.close()
                }
                start()
            }
        }
    }

    companion object {
        private val KST: ZoneId = ZoneId.of("Asia/Seoul")
        private val YONGDUAM: UUID = UUID.fromString("e0000000-0000-4000-8000-000000000008")   // 시드 '용두암'
        private val SEONGSAN: UUID = UUID.fromString("e0000000-0000-4000-8000-000000000001")   // 시드 '성산일출봉' 33.4587, 126.9427
        private val MANJANGGUL: UUID = UUID.fromString("e0000000-0000-4000-8000-000000000007") // 시드 '만장굴'
        private val WOLJEONGRI: UUID = UUID.fromString("e0000000-0000-4000-8000-000000000003") // 시드 '월정리 카페거리' — 일정 밖

        /** 이름을 베이스(`springProperties`)와 달리 둔다 — 같은 이름의 정적 메서드는 상위 것을 가릴 수 있다. */
        @JvmStatic
        @DynamicPropertySource
        fun opportunityHttpMode(registry: DynamicPropertyRegistry) {
            registry.add("trippilot.ai.opportunity.mode") { "http" }
            registry.add("trippilot.ai.opportunity.base-url") { "http://127.0.0.1:${FakeAi.server.address.port}" }
        }

        @JvmStatic
        @AfterAll
        fun stopFakeAi() = FakeAi.server.stop(0)
    }
}
