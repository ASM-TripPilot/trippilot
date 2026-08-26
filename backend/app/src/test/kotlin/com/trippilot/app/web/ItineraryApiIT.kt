package com.trippilot.app.web

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiRepository
import com.trippilot.itinerarygeneration.domain.CandidatesSummary
import com.trippilot.itinerarygeneration.domain.GenerationState
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.VisitSlot
import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.jdbc.core.JdbcTemplate
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
    @Autowired private lateinit var pois: PoiRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

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

    /**
     * **미래 날짜** 여행 — 재생성이 허용되는 유일한 구간이다(여행 중·후는 409).
     * 서버 실 시계로 판정하므로 고정 날짜를 쓸 수 없다. 날짜를 단언하는 테스트는 [newTrip] 을 그대로 쓴다.
     */
    private fun newFutureTrip(token: String): String {
        val start = java.time.LocalDate.now(java.time.ZoneId.of("Asia/Seoul")).plusDays(30)
        val body = """{"startDate":"$start","endDate":"${start.plusDays(1)}","party":2,
            "destinations":[{"seq":0,"region":"제주","nights":1}],"preferenceSnapshot":{}}""".trimIndent()
        return call(HttpMethod.POST, "/api/v1/trips", token, body).second["tripId"].asText()
    }

    private fun newTrip(token: String): String {
        val body = """{"startDate":"2026-08-01","endDate":"2026-08-02","party":2,
            "destinations":[{"seq":0,"region":"제주","nights":1}],"preferenceSnapshot":{}}""".trimIndent()
        return call(HttpMethod.POST, "/api/v1/trips", token, body).second["tripId"].asText()
    }

    /**
     * 2차 생성(백그라운드) 완료까지 조회 폴링 — 실 클라이언트가 하는 일과 동일.
     * `@Async` 라 완료 시점이 비결정적이므로 상태로 기다린다(고정 sleep 금지).
     */
    private fun awaitComplete(trip: String, token: String): JsonNode {
        val deadline = System.nanoTime() + AWAIT_TIMEOUT_NANOS
        var last = json.createObjectNode() as JsonNode
        while (System.nanoTime() < deadline) {
            last = call(HttpMethod.GET, "/api/v1/trips/$trip/itinerary", token).second
            when (last["generationState"]?.asText()) {
                "PARTIAL" -> Thread.sleep(POLL_INTERVAL_MS)
                // FAILED 를 통과시키면 뒤따르는 확정·편집 검증이 조용히 "실패한 일정" 위에서 돌게 된다.
                "COMPLETE" -> return last
                else -> error("2차 생성이 완료되지 않았습니다. 상태=$last")
            }
        }
        error("2차 생성이 기한 내 끝나지 않았습니다. 마지막 상태=$last")
    }

    /** 하루 여행 — 생성이 2차 없이 즉시 COMPLETE 라 확정·편집을 바로 검증할 수 있다. */
    private fun tripOneDay(token: String): String {
        val body = """{"startDate":"2026-08-01","endDate":"2026-08-01","party":2,
            "destinations":[{"seq":0,"region":"제주","nights":0}],"preferenceSnapshot":{}}""".trimIndent()
        return call(HttpMethod.POST, "/api/v1/trips", token, body).second["tripId"].asText()
    }

    private fun poiId(token: String): String =
        call(HttpMethod.GET, "/api/v1/places?region=제주", token).second["items"][0]["poiId"].asText()

    private companion object {
        const val POLL_INTERVAL_MS = 50L
        val AWAIT_TIMEOUT_NANOS = java.time.Duration.ofSeconds(20).toNanos()
    }

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
        val midnight = Itinerary.create(UUID.fromString(trip), SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, isFallback = false,
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
        // day1 조기 노출(TRIP-267): 즉시 응답은 첫날만·생성 중
        body["days"].size() shouldBe 1
        body["generationState"].asText() shouldBe "PARTIAL"
        val slot = body["days"][0]["slots"][0]
        slot.has("startAt") shouldBe true
        slot.has("endAt") shouldBe true
        slot.has("duration") shouldBe false // INV-3: 소요시간 미노출
        // POI 표면(TRIP-307) — 지도·카드를 추가 왕복 없이 그릴 수 있어야 한다
        slot["nameKo"].isNull shouldBe false
        slot["lat"].isNull shouldBe false
        slot["lng"].isNull shouldBe false
        slot.has("openingHoursKnown") shouldBe true
        slot.has("imageUrl") shouldBe true   // 미확보면 null — 기본 이미지를 지어내지 않는다

        // 2차(백그라운드)가 나머지 일자를 채우고 COMPLETE 로 전이
        val completed = awaitComplete(trip, token)
        completed["generationState"].asText() shouldBe "COMPLETE"
        completed["days"].size() shouldBe 2 // 08-01 ~ 08-02(체크아웃 포함)
    }

    @Test
    fun `확정 후 원본 POI 가 개명돼도 확정 일정은 동결 이름을 보여준다(INV-U1-03 · TRIP-307)`() {
        val token = newToken()
        val trip = tripOneDay(token)
        val poi = poiId(token)
        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token).first shouldBe 201
        // 하루 여행도 근거 조회가 남아 응답 직후는 PARTIAL 이다(TRIP-511) — 그 상태의 확정은 409 다.
        awaitComplete(trip, token)
        val confirmedName = call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary/confirm", token)
            .second["days"][0]["slots"][0]["nameKo"].asText()

        // 확정 후 정본을 개명 — 확정 일정이 흔들리면 안 된다
        val before = pois.findById(UUID.fromString(poi))!!
        pois.saveAll(
            listOf(
                Poi.reconstitute(
                    before.poiId, "이름이 바뀐 곳", before.lat, before.lng, before.category, before.region,
                    before.openingHours, before.dataStatus, before.source, before.savedCount,
                    before.createdAt, before.updatedAt, before.imageUrl, before.tags,
                    before.sourceRef, before.regionCode,
                ),
            ),
        )

        // **개명한 것을 되돌린다.** Testcontainers 는 전 IT 가 공유하는 싱글톤이고 이 쓰기는 HTTP 밖
        // 리포지토리 직접 호출이라 롤백이 닿지 않는다. 되돌리지 않으면 시드 POI 가 '이름이 바뀐 곳'인 채로
        // 남아 뒤에 도는 IT 가 이름으로 그 POI 를 찾지 못한다 — 실패가 테스트 순서에 따라 갈린다(실측).
        try {
            val after = call(HttpMethod.GET, "/api/v1/trips/$trip/itinerary", token)
                .second["days"][0]["slots"].let { slots -> (0 until slots.size()).map { slots[it] } }
                .first { it["poiId"].asText() == poi }
            after["nameKo"].asText() shouldBe confirmedName          // 동결값 유지
            after["nameKo"].asText() shouldNotBe "이름이 바뀐 곳"
            after["openingHoursKnown"].isNull shouldBe true          // 확정 일정엔 판정을 내지 않는다
        } finally {
            pois.saveAll(listOf(before))
        }
    }

    @Test
    fun `편집해도 추천 근거가 응답에 남고 표면도 실린다(TRIP-306·307)`() {
        val token = newToken()
        val trip = tripOneDay(token)
        val poi = poiId(token)
        // 근거·요약을 넣은 상태를 만든 뒤 편집한다
        itineraries.replaceForTrip(
            UUID.fromString(trip),
            Itinerary.create(UUID.fromString(trip), SolveMode.FULL_AI, GenerationMode.FULLY_AI, isFallback = false,
                days = listOf(
                    ItineraryDay.of(
                        LocalDate.parse("2026-08-01"), 0,
                        listOf(VisitSlot.of(UUID.fromString(poi), null, 0, LocalTime.parse("09:00"), LocalTime.parse("10:00"), placementReason = "취향에 맞는 곳")),
                    ),
                ),
                now = Instant.parse("2026-08-01T00:00:00Z"),
                candidatesSummary = CandidatesSummary("LOW", 7, listOf("CAFE")),
            ),
        )

        val editBody = """{"days":[
            {"date":"2026-08-01","slots":[{"poiId":"$poi","startAt":"13:00","endAt":"14:00","isFixed":false,"endsNextDay":false}]}]}"""
        val (rc, body) = call(HttpMethod.PUT, "/api/v1/trips/$trip/itinerary", token, editBody)
        rc shouldBe 200
        // 시각만 옮긴 편집이 근거·요약을 지우면 안 된다(회귀 가드)
        body["days"][0]["slots"][0]["placementReason"].asText() shouldBe "취향에 맞는 곳"
        body["candidatesSummary"]["level"].asText() shouldBe "LOW"
        body["days"][0]["slots"][0]["nameKo"].isNull shouldBe false // 편집 응답에도 표면이 실린다
    }

    @Test
    fun `슬롯 교체 후보 — closed-set 이고 이미 일정에 있는 장소는 안 나온다(TRIP-311)`() {
        val token = newToken()
        val trip = tripOneDay(token)
        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token).first shouldBe 201

        // **2차 생성이 끝나기를 기다린다.** 그 단계는 `@Async` 로 돌면서 `replaceIfCurrent`
        // (DELETE→INSERT)로 일정을 통째 교체하는데, 기다리지 않고 조회하면 그 교체 창에 걸려
        // 슬롯이 0개인 순간을 본다 — 로컬은 빨라서 통과하고 CI 만 간헐적으로 빨개진다(실측).
        // 같은 파일의 다른 테스트들이 이미 쓰는 대기 헬퍼이고, 그 반환값이 곧 최종 일정이라
        // 조회를 한 번 더 하지 않는다.
        val itin = awaitComplete(trip, token)
        val inItinerary = itin["days"][0]["slots"].let { s -> (0 until s.size()).map { s[it]["poiId"].asText() } }
        val slotKey = "2026-08-01#${inItinerary.first()}"

        val (rc, body) = call(
            HttpMethod.POST, "/api/v1/trips/$trip/itinerary/slot-candidates", token,
            """{"slotKey":"$slotKey","radiusM":20000}""",
        )
        rc shouldBe 200
        body.has("radiusMUsed") shouldBe true

        val candidates = body["candidates"].let { c -> (0 until c.size()).map { c[it]["poiId"].asText() } }
        // 0건이면 아래 단언들이 전부 공허하게 통과한다 — 후보가 실제로 나왔는지부터 못박는다.
        candidates.isNotEmpty() shouldBe true
        // 이미 일정에 있는 장소는 다시 제안되지 않는다(BR-U3-24) — 서버가 유도한 제외 목록이 실제로 먹는지
        candidates.none { it in inItinerary } shouldBe true
        body["candidates"][0]["distanceRange"].isNull shouldBe false
        body["candidates"][0].has("duration") shouldBe false // INV-3
    }

    @Test
    fun `슬롯 키 형식이 틀리면 400, 없는 슬롯이면 404`() {
        val token = newToken()
        val trip = tripOneDay(token)
        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token).first shouldBe 201

        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary/slot-candidates", token, """{"slotKey":"이상한키"}""").first shouldBe 400
        call(
            HttpMethod.POST, "/api/v1/trips/$trip/itinerary/slot-candidates", token,
            """{"slotKey":"2026-08-01#${UUID.randomUUID()}"}""",
        ).first shouldBe 404
    }

    @Test
    fun `직접 만들기로 생성하면 빈 일자만 만들어지고 편집으로 채운다(TRIP-268)`() {
        val token = newToken()
        val trip = newTrip(token)   // 08-01 ~ 08-02
        val poi = poiId(token)

        val (rc, body) = call(
            HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token, """{"generationMode":"MANUAL"}""",
        )
        rc shouldBe 201
        body["generationMode"].asText() shouldBe "MANUAL"
        body["generationState"].asText() shouldBe "COMPLETE"   // 2차를 기다리지 않는다
        body["isFallback"].asBoolean() shouldBe false          // 실패가 아니라 사용자의 선택
        body["days"].size() shouldBe 2
        (0 until body["days"].size()).all { body["days"][it]["slots"].size() == 0 } shouldBe true

        // 빈 일정도 편집으로 채워진다(편집 서브태스크 재사용)
        val editBody = """{"days":[
            {"date":"2026-08-01","slots":[{"poiId":"$poi","startAt":"10:00","endAt":"11:00","isFixed":false,"endsNextDay":false}]}]}"""
        val (erc, edited) = call(HttpMethod.PUT, "/api/v1/trips/$trip/itinerary", token, editBody)
        erc shouldBe 200
        edited["days"][0]["slots"][0]["poiId"].asText() shouldBe poi
        edited["generationMode"].asText() shouldBe "MANUAL"    // 편집으로 방식이 바뀌지 않는다
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
        awaitComplete(trip, token)

        val (rc, body) = call(HttpMethod.GET, "/api/v1/trips/$trip/itinerary", token)
        rc shouldBe 200
        body["tripId"].asText() shouldBe trip
        body["status"].asText() shouldBe "PLANNED"
        body["days"].size() shouldBe 2
    }

    @Test
    fun `distanceRange 가 저장·조회·확정을 관통한다(TRIP-308)`() {
        val token = newToken()
        val trip = newTrip(token)
        // Fake 는 거리 추정이 없어 null 을 낸다 → 리포지토리로 직접 값을 넣어 영속·왕복·동결 보존을 본다.
        val slot = VisitSlot.of(
            UUID.fromString(poiId(token)), null, 0, LocalTime.parse("10:00"), LocalTime.parse("11:00"),
            distanceRange = "약 1.2km · 도보 추정",
        )
        itineraries.replaceForTrip(
            UUID.fromString(trip),
            Itinerary.create(UUID.fromString(trip), SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, isFallback = false,
                days = listOf(ItineraryDay.of(LocalDate.parse("2026-08-01"), 0, listOf(slot))),
                now = Instant.parse("2026-08-01T00:00:00Z"),
            ),
        )

        val (rc, body) = call(HttpMethod.GET, "/api/v1/trips/$trip/itinerary", token)
        rc shouldBe 200
        body["days"][0]["slots"][0]["distanceRange"].asText() shouldBe "약 1.2km · 도보 추정"
        body["days"][0]["slots"][0].has("duration") shouldBe false // INV-3

        // 확정해도 유지된다 — 동결은 스냅숏 참조만 붙이는 것
        val (crc, confirmed) = call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary/confirm", token)
        crc shouldBe 200
        confirmed["days"][0]["slots"][0]["distanceRange"].asText() shouldBe "약 1.2km · 도보 추정"
    }

    @Test
    fun `추천 근거·후보 요약이 재조회에서 유실되지 않는다(TRIP-306)`() {
        val token = newToken()
        val trip = newTrip(token)
        // Fake 는 explanations·candidatesSummary 를 내지 않으므로 리포지토리로 직접 넣어 영속·왕복을 본다.
        val slot = VisitSlot.of(
            UUID.fromString(poiId(token)), null, 0, LocalTime.parse("10:00"), LocalTime.parse("11:00"),
            placementReason = "취향(미식)과 동선에 맞는 곳",
        )
        itineraries.replaceForTrip(
            UUID.fromString(trip),
            Itinerary.create(UUID.fromString(trip), SolveMode.FULL_AI, GenerationMode.FULLY_AI, isFallback = false,
                days = listOf(ItineraryDay.of(LocalDate.parse("2026-08-01"), 0, listOf(slot))),
                now = Instant.parse("2026-08-01T00:00:00Z"),
                candidatesSummary = CandidatesSummary("LOW", 7, listOf("CAFE")),
            ),
        )

        val (rc, body) = call(HttpMethod.GET, "/api/v1/trips/$trip/itinerary", token)
        rc shouldBe 200
        body["days"][0]["slots"][0]["placementReason"].asText() shouldBe "취향(미식)과 동선에 맞는 곳"
        body["candidatesSummary"]["level"].asText() shouldBe "LOW"      // jsonb 왕복
        body["candidatesSummary"]["poolSize"].asInt() shouldBe 7
        body["candidatesSummary"]["shortfallCategories"][0].asText() shouldBe "CAFE"

        // 확정해도 남는다 — 동결은 스냅숏 참조만 붙이는 것
        val (crc, confirmed) = call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary/confirm", token)
        crc shouldBe 200
        confirmed["days"][0]["slots"][0]["placementReason"].asText() shouldBe "취향(미식)과 동선에 맞는 곳"
        confirmed["candidatesSummary"]["level"].asText() shouldBe "LOW"
    }

    @Test
    fun `위반 사유가 저장·재조회·확정을 관통한다(TRIP-309 · BR-U3-13)`() {
        val token = newToken()
        val trip = newTrip(token)
        // Fake 는 위반을 만들지 않으므로 리포지토리로 직접 넣어 영속·왕복·동결 보존을 본다.
        val slot = VisitSlot.of(
            UUID.fromString(poiId(token)), null, 0, LocalTime.parse("10:00"), LocalTime.parse("11:00"),
            hasViolation = true, violationReason = "이동이 빠듯해요 · 영업시간 밖",
        )
        itineraries.replaceForTrip(
            UUID.fromString(trip),
            Itinerary.create(UUID.fromString(trip), SolveMode.FULL_AI, GenerationMode.FULLY_AI, isFallback = false,
                days = listOf(ItineraryDay.of(LocalDate.parse("2026-08-01"), 0, listOf(slot))),
                now = Instant.parse("2026-08-01T00:00:00Z"),
            ),
        )

        val (rc, body) = call(HttpMethod.GET, "/api/v1/trips/$trip/itinerary", token)
        rc shouldBe 200
        val s0 = body["days"][0]["slots"][0]
        s0["hasViolation"].asBoolean() shouldBe true
        s0["violationReason"].asText() shouldBe "이동이 빠듯해요 · 영업시간 밖"

        // 확정해도 남는다 — 동결은 스냅숏 참조만 붙이는 것
        val (crc, confirmed) = call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary/confirm", token)
        crc shouldBe 200
        confirmed["days"][0]["slots"][0]["violationReason"].asText() shouldBe "이동이 빠듯해요 · 영업시간 밖"
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
        awaitComplete(trip, token)

        val (rc, body) = call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary/confirm", token)
        rc shouldBe 200
        body["status"].asText() shouldBe "CONFIRMED"
        // 확정 응답에도 표면이 실린다 — 확정 직후 화면이 비면 안 된다
        body["days"][0]["slots"][0]["nameKo"].isNull shouldBe false
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
        awaitComplete(trip, token)

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
        awaitComplete(trip, token)
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
        val partial = Itinerary.create(UUID.fromString(trip), SolveMode.FULL_AI, GenerationMode.FULLY_AI, isFallback = false,
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
        // 생성 중 편집도 409 — 뒤이어 오는 2차 결과가 편집을 덮어써 유실되는 것 방지
        val editBody = """{"days":[{"date":"2026-08-01","slots":[]}]}"""
        call(HttpMethod.PUT, "/api/v1/trips/$trip/itinerary", token, editBody).first shouldBe 409
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
        val trip = newFutureTrip(token)   // 재생성은 여행 시작 전에만 허용된다
        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token).first shouldBe 201
        awaitComplete(trip, token)
        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token).first shouldBe 201
        awaitComplete(trip, token)
        itineraries.findByTrip(UUID.fromString(trip)).size shouldBe 1
    }

    /**
     * 재생성 가드의 HTTP 표면. 여행 중 재생성은 따라가던 계획을 지우고 방문 실적을 유령으로 만든다 —
     * 그 변경은 재계획(Plan-B)의 몫이다. **첫 생성은 막지 않는다**(지울 계획이 없다).
     */
    @Test
    fun `끝난 여행은 첫 생성만 되고 재생성은 409`() {
        val token = newToken()
        val trip = newTrip(token)   // 2026-08-01~02 — 이미 지난 여행

        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token).first shouldBe 201  // 첫 생성은 허용
        awaitComplete(trip, token)

        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token).first shouldBe 409
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
    /**
     * **실제 생성이 아웃박스에 적재한다**(TRIP-539).
     *
     * `OutboxRelayIT` 는 대역 이벤트로 적재·배달을 확인하지만, **업무 경로가 실제로 그 길을 타는지**는
     * 여기서만 드러난다. 이벤트를 발행하는 코드는 그대로 두고 발행 구현만 바꿨으므로,
     * 이 테스트가 깨지면 "U5·U6 가 받을 이벤트가 애초에 안 쌓인다"는 뜻이다.
     *
     * 인프로세스 발행은 그대로 유지되므로 기존 구독자는 영향이 없다 — 그 사실은 이 테스트가 아니라
     * 기존 IT 들이 통과하는 것으로 확인된다.
     */
    @Test
    fun `일정 생성이 아웃박스에 이벤트를 남긴다`() {
        val token = newToken()
        val trip = tripOneDay(token)

        call(HttpMethod.POST, "/api/v1/trips/$trip/itinerary", token).first shouldBe 201

        val rows = jdbc.queryForList(
            """
            SELECT event_type, aggregate_type, schema_version, payload::text AS payload
              FROM outbox_event
             WHERE event_type = 'itinerary.ItineraryGenerated'
               AND payload ->> 'tripId' = ?
            """.trimIndent(),
            trip,
        )

        rows.size shouldBe 1
        rows.single()["aggregate_type"] shouldBe "Itinerary"
        rows.single()["schema_version"] shouldBe 1
        // payload 가 비어 있으면 구독자가 다시 조회해야 하고, 그때는 값이 이미 바뀌어 있을 수 있다.
        (rows.single()["payload"] as String) shouldContain "isFallback"
    }

}
