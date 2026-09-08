package com.trippilot.itinerarygeneration.adapter.out.external

import com.trippilot.itinerarygeneration.domain.FixedBlock
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.PreferenceProfile
import com.trippilot.itinerarygeneration.domain.RequestMeta
import com.trippilot.itinerarygeneration.domain.ScheduleAgentCallFailed
import com.trippilot.placedata.api.Area
import com.trippilot.placedata.api.CandidatePoolPort
import com.trippilot.placedata.api.GroundedPlace
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
import com.trippilot.itinerarygeneration.domain.SlotCandidatesEmptyReason
import com.trippilot.itinerarygeneration.domain.SlotCandidatesInput
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.TimeWindow
import com.trippilot.itinerarygeneration.domain.TripContext
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.converter.json.JacksonJsonHttpMessageConverter
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath
import org.springframework.test.web.client.match.MockRestRequestMatchers.method
import org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo
import org.springframework.test.web.client.response.MockRestResponseCreators.withStatus
import org.springframework.test.web.client.response.MockRestResponseCreators.withServerError
import org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess
import org.springframework.web.client.RestClient
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset
import java.util.UUID

/**
 * 포워드 경계 HTTP 어댑터(TRIP-229) — 계약(PR #104) 준수 + **AI 실 스키마 흡수** 검증. 외부 호출 0.
 * 핵심: 200 이면 예외 없음(is_fallback=true 여도) · 4xx/5xx·네트워크·스키마 불일치만 ScheduleAgentCallFailed.
 */
class HttpScheduleAgentAdapterTest : StringSpec({

    val now = Instant.parse("2026-08-07T00:00:00Z")
    val clock = Clock.fixed(now, ZoneOffset.UTC)
    val d1 = LocalDate.parse("2026-08-01")
    val poi = UUID.randomUUID()

    /** 실재 확인(ground)까지 목으로 — 슬롯 후보 케이스는 채운 풀을 넣는다(TRIP-463). */
    val emptyPool = object : CandidatePoolPort {
        override fun resolve(area: Area, categories: Set<String>) = emptyList<GroundedPlace>()
        override fun ground(poiIds: List<UUID>) = emptyList<GroundedPlace>()
    }

    fun fixture(pool: CandidatePoolPort = emptyPool): Pair<HttpScheduleAgentAdapter, MockRestServiceServer> {
        // 프로덕션과 동일한 경계 매퍼·컨버터 구성(설정에서 그대로 가져옴).
        val builder = RestClient.builder()
            .baseUrl("http://ai.test")
            .messageConverters { it.add(0, JacksonJsonHttpMessageConverter(ScheduleAgentConfiguration.boundaryMapper())) }
        val server = MockRestServiceServer.bindTo(builder).build()
        // 생성용·편집용 두 클라이언트로 나뉘었지만(read 상한만 다르다) 여기선 같은 목 서버를 본다 —
        // 이 테스트가 보는 것은 경계 페이로드지 타임아웃이 아니다.
        val client = builder.build()
        return HttpScheduleAgentAdapter(client, client, LocalSlotCandidateSource(pool, clock), pool, clock) to server
    }

    val input = ScheduleAgentInput(
        tripId = UUID.randomUUID(),
        generationMode = GenerationMode.FULLY_AI,
        tripContext = TripContext(listOf("제주"), d1, d1, "친구", null),
        anchors = emptyList(),
        timeWindows = listOf(TimeWindow(d1, LocalTime.of(9, 0), LocalTime.of(21, 0))),
        fixedBlocks = listOf(FixedBlock(poi, d1, LocalTime.of(12, 0), 60)),
        preferenceProfile = PreferenceProfile(emptyList(), emptyList(), emptyList(), emptyList(), null, emptyList(), false, null),
        recommendationStrength = null,
        requestMeta = RequestMeta("req-1", now, 20_000),
    )

    /** AI 실제 응답 형태(itinerary.py·freshness.py 기준) — 백엔드 도메인과 다른 solve_mode·freshness. */
    fun aiBody(solveMode: String, isFallback: Boolean = false, freshness: String = """{"source":"M7_CACHE","fetched_at":"2026-08-07T00:00:00Z","cache_hit":true,"ttl_sec":600,"stale":false}""") = """
        {"days":[{"date":"2026-08-01","slots":[
          {"poi_id":"$poi","start_at":"10:00:00","end_at":"11:00:00","ends_next_day":false,"distance_range":"약 1km","is_fixed":false}]}],
         "day1_ready_at":null,"explanations":{},"solve_mode":"$solveMode","is_fallback":$isFallback,
         "freshness":$freshness,"candidates_summary":{"total":42}}
    """.trimIndent()

    "정상 200 — snake_case 요청 + AI 실 스키마(OR_TOOLS·freshness) 흡수" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/generate"))
            .andExpect(method(HttpMethod.POST))
            .andExpect(jsonPath("$.trip_id").exists())                      // camel→snake 변환
            .andExpect(jsonPath("$.request_meta.deadline_ms").value(20000))
            .andRespond(withSuccess(aiBody("OR_TOOLS"), MediaType.APPLICATION_JSON))

        val out = adapter.generate(input)
        out.solveMode shouldBe SolveMode.FULL_AI          // AI OR_TOOLS → 도메인 FULL_AI
        out.freshness.degraded shouldBe false             // AI stale → degraded
        out.freshness.generatedAt shouldBe now            // AI fetched_at → generatedAt
        out.days.single().slots.single().poiId shouldBe poi
        server.verify()
    }

    "AI 미지 필드(candidates_summary)는 무시하고 파싱" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/generate"))
            .andRespond(withSuccess(aiBody("LLM"), MediaType.APPLICATION_JSON))
        val out = adapter.generate(input)
        out.solveMode shouldBe SolveMode.FULL_AI // LLM 도 정상 산출
        // 형태가 계약과 다르면(level 없음) 등급을 지어내지 않고 없는 것으로 둔다 — 생성은 정상 진행
        out.candidatesSummary shouldBe null
    }

    "candidates_summary 가 계약 형태면 그대로 전달한다(판정은 AI 소유 — 재계산 없음)" {
        val (adapter, server) = fixture()
        val body = aiBody("OR_TOOLS").replace(
            """"candidates_summary":{"total":42}""",
            """"candidates_summary":{"level":"LOW","pool_size":7,"shortfall_categories":["CAFE"]}""",
        )
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/generate"))
            .andRespond(withSuccess(body, MediaType.APPLICATION_JSON))
        val summary = adapter.generate(input).candidatesSummary!!
        summary.level shouldBe "LOW"
        summary.poolSize shouldBe 7
        summary.shortfallCategories shouldBe listOf("CAFE")
    }

    "RULE_FALLBACK → DETERMINISTIC, 200 + is_fallback=true 는 예외 없이 사용(대원칙)" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/generate"))
            .andRespond(withSuccess(aiBody("RULE_FALLBACK", isFallback = true), MediaType.APPLICATION_JSON))

        val out = adapter.generate(input) // 던지면 안 됨 — AI 가 이미 폴백을 마친 결과물
        out.solveMode shouldBe SolveMode.DETERMINISTIC
        out.isFallback shouldBe true
    }

    "freshness 누락(stale 정보 없음)이어도 200 은 사용 — generatedAt 은 수신 시각" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/generate"))
            .andRespond(withSuccess(aiBody("MINIMAL", freshness = "null"), MediaType.APPLICATION_JSON))

        val out = adapter.generate(input)
        out.solveMode shouldBe SolveMode.MINIMAL
        out.freshness.generatedAt shouldBe now
    }

    "미지 solve_mode — 조용히 넘기지 않고 폴백 신호(INV-4 침묵 금지)" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/generate"))
            .andRespond(withSuccess(aiBody("QUANTUM_MAGIC"), MediaType.APPLICATION_JSON))

        val e = shouldThrow<ScheduleAgentCallFailed> { adapter.generate(input) }
        e.message!! shouldContain "스키마 불일치"
        e.retryable shouldBe false
    }

    "422(스키마 위반) — errorCode·retryable=false 전달" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/generate"))
            .andRespond(
                withStatus(HttpStatus.UNPROCESSABLE_ENTITY)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body("""{"error_code":"INVALID_INPUT","message":"bad schema","retryable":false}"""),
            )

        val e = shouldThrow<ScheduleAgentCallFailed> { adapter.generate(input) }
        e.errorCode shouldBe "INVALID_INPUT"
        e.retryable shouldBe false
        e.message!! shouldContain "422"
    }

    "500(바디 없음) — 상태코드만으로 실패 판정" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/generate"))
            .andRespond(withStatus(HttpStatus.INTERNAL_SERVER_ERROR))

        shouldThrow<ScheduleAgentCallFailed> { adapter.generate(input) }.message!! shouldContain "500"
    }

    "validate — 위반은 200 정상 응답이고 위치 인덱스가 그대로 실린다" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/validate"))
            .andExpect(method(HttpMethod.POST))
            // 산출물 전체를 되돌려 보낸다 — 슬롯만 보내면 상대가 날짜 맥락을 잃는다
            .andExpect(jsonPath("$.itinerary.days").exists())
            .andExpect(jsonPath("$.request_meta.deadline_ms").exists())
            .andRespond(
                withSuccess(
                    """{"violations":[{"code":"TRAVEL_TIME","slot_ref":"2026-08-01#p","detail":"이동이 빠듯해요","day_index":0,"slot_index":1}]}""",
                    MediaType.APPLICATION_JSON,
                ),
            )

        val v = adapter.validate(dummyOutput()).single()
        v.type shouldBe "TRAVEL_TIME"
        v.dayIndex shouldBe 0
        v.slotIndex shouldBe 1
        v.detail shouldBe "이동이 빠듯해요"
        server.verify()
    }

    "validate — 상대가 위치를 못 찾으면 인덱스가 비지만 위반은 버리지 않는다" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/validate"))
            .andRespond(withSuccess("""{"violations":[{"code":"OPENING_HOURS","detail":""}]}""", MediaType.APPLICATION_JSON))

        val v = adapter.validate(dummyOutput()).single()
        v.type shouldBe "OPENING_HOURS"
        v.dayIndex shouldBe null // 슬롯엔 못 붙지만 "위반 없음"으로 위장하지 않는다(INV-4)
        v.detail shouldBe null   // 빈 문자열은 사유 없음으로 본다
        server.verify()
    }

    "validate — 위반 없으면 빈 목록" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/validate"))
            .andRespond(withSuccess("""{"violations":[]}""", MediaType.APPLICATION_JSON))
        adapter.validate(dummyOutput()) shouldBe emptyList()
    }

    "repair — 수리 불가(repaired=null)는 오류가 아니라 원본 유지" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/repair"))
            .andRespond(withSuccess("""{"repaired":null,"changes":[]}""", MediaType.APPLICATION_JSON))

        val result = adapter.repair(dummyOutput(), emptyList())
        result.repaired shouldBe dummyOutput()  // 원본 그대로
        result.changes shouldBe emptyList()
        server.verify()
    }

    "repair — 수리되면 조정 결과와 변경 목록을 돌려준다" {
        val (adapter, server) = fixture()
        val poi = UUID.randomUUID()
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/repair"))
            .andRespond(
                withSuccess(
                    """{"repaired":{"days":[{"date":"2026-08-01","slots":[
                       {"poi_id":"$poi","start_at":"11:00:00","end_at":"12:00:00","ends_next_day":false,"is_fixed":false}]}],
                       "explanations":{},"solve_mode":"OR_TOOLS","is_fallback":false},
                       "changes":["2번째 슬롯을 30분 뒤로"]}""",
                    MediaType.APPLICATION_JSON,
                ),
            )

        val result = adapter.repair(dummyOutput(), emptyList())
        result.repaired.days.single().slots.single().startAt.toString() shouldBe "11:00"
        result.changes.single() shouldBe "2번째 슬롯을 30분 뒤로"
        server.verify()
    }

    // ───────── 슬롯 후보(alternatives) — TRIP-463 · 연동 설계 §7 ─────────

    val targetPoi = UUID.fromString("e0000000-0000-4000-8000-00000000c001")
    val nearPoi = UUID.fromString("e0000000-0000-4000-8000-00000000c002")   // 중심에서 ~1.1km
    val farPoi = UUID.fromString("e0000000-0000-4000-8000-00000000c003")    // 중심에서 ~8.1km (33.51,126.61 기준 — 하버사인 실측)

    fun place(id: UUID, lat: Double, lng: Double, category: String = "카페") =
        GroundedPlace(id, "이름-$id", lat, lng, category, null, null)

    /** 후보 2곳(가까운·먼)을 실재로 아는 풀. */
    fun poolOf(vararg places: GroundedPlace) = object : CandidatePoolPort {
        override fun resolve(area: Area, categories: Set<String>) = places.toList()
        override fun ground(poiIds: List<UUID>) = places.filter { it.poiId in poiIds }
    }

    fun candidatesInput(radiusM: Int? = null, concept: String? = null) = SlotCandidatesInput(
        tripId = UUID.randomUUID(),
        slotKey = "2026-09-01#$targetPoi",
        neighborSlotKeys = emptyList(),
        centerLat = 33.45, centerLng = 126.56,
        radiusM = radiusM, concept = concept, excludePoiIds = listOf(targetPoi),
        placementReason = "일몰 명소",
        requestMeta = RequestMeta(UUID.randomUUID().toString(), clock.instant(), 25_000L),
    )

    fun altBody(fallbackLevel: Int, alternatives: String, emptyReason: String? = null) = """
        {"alternatives":[$alternatives],
         "is_fallback":${fallbackLevel >= 1},"fallback_level":$fallbackLevel,
         "notes":[],"retrieved":{"kb":0},"dropped_out_of_pool":[],
         ${if (emptyReason != null) "\"empty_reason\":\"$emptyReason\"," else ""}
         "pool_size":7}
    """.trimIndent()

    "슬롯 후보 요청이 설계 §2 매핑대로 나간다 — MANUAL 트리거·앵커·제외목록·배치사유" {
        val (adapter, server) = fixture(poolOf(place(nearPoi, 33.46, 126.56)))
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/alternatives"))
            .andExpect(jsonPath("$.trigger.kind").value("MANUAL"))
            .andExpect(jsonPath("$.trigger.affected_date").value("2026-09-01"))
            .andExpect(jsonPath("$.dates[0]").value("2026-09-01"))
            .andExpect(jsonPath("$.anchor.lat").value(33.45))
            .andExpect(jsonPath("$.reason").value("none"))
            .andExpect(jsonPath("$.excluded_poi_ids[0]").value(targetPoi.toString()))
            .andExpect(jsonPath("$.affected_reasons['$targetPoi']").value("일몰 명소"))
            .andExpect(jsonPath("$.request_meta.deadline_ms").value(25000))
            .andRespond(withSuccess(altBody(0, """{"label":"B","poi_ids":["$nearPoi"],"rationale":"근거"}"""), MediaType.APPLICATION_JSON))

        adapter.proposeSlotCandidates(candidatesInput())

        server.verify()
    }

    "LLM 랭킹(fallback_level=0)이면 degraded=false · 근거 원문 · AI 순서 보존" {
        // AI 가 먼 곳을 먼저 꼽았다 — 거리순이 아니라 랭킹순이 살아야 한다(D-3a).
        val (adapter, server) = fixture(poolOf(place(farPoi, 33.51, 126.61), place(nearPoi, 33.46, 126.56)))
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/alternatives")).andRespond(
            withSuccess(
                altBody(
                    0,
                    """{"label":"B","poi_ids":["$farPoi"],"rationale":"취향에 맞는 곳"},
                       {"label":"C","poi_ids":["$nearPoi"],"rationale":"조용한 곳"}""",
                ),
                MediaType.APPLICATION_JSON,
            ),
        )

        val out = adapter.proposeSlotCandidates(candidatesInput(radiusM = 10_000))

        out.freshness.degraded shouldBe false
        out.candidates.map { it.poiId } shouldBe listOf(farPoi, nearPoi)
        out.candidates[0].rationale shouldBe "취향에 맞는 곳"
        out.candidates[0].distanceRange shouldContain "km"
    }

    "규칙 폴백(fallback_level=1)이면 degraded=true · 기계 문자열 근거를 템플릿으로 · 거리 오름차순" {
        val (adapter, server) = fixture(poolOf(place(farPoi, 33.51, 126.61), place(nearPoi, 33.46, 126.56)))
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/alternatives")).andRespond(
            withSuccess(
                altBody(
                    1,
                    """{"label":"B","poi_ids":["$farPoi"],"rationale":"MANUAL/none · rule_ranking"},
                       {"label":"C","poi_ids":["$nearPoi"],"rationale":"MANUAL/none · rule_ranking"}""",
                ),
                MediaType.APPLICATION_JSON,
            ),
        )

        val out = adapter.proposeSlotCandidates(candidatesInput(radiusM = 10_000, concept = "감성"))

        out.freshness.degraded shouldBe true
        // FE 강등 고지가 '가까운 순'이라고 못박고 있다 — 재정렬해야 문구가 사실이 된다.
        out.candidates.map { it.poiId } shouldBe listOf(nearPoi, farPoi)
        // "MANUAL/none · rule_ranking" 이 사용자에게 새면 안 된다.
        out.candidates[0].rationale shouldBe "감성 컨셉에 맞는 카페"
    }

    "후보 0건(fallback_level=2)의 no_candidates 는 ALL_IN_ITINERARY 로 매핑된다" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/alternatives"))
            .andRespond(withSuccess(altBody(2, "", emptyReason = "no_candidates"), MediaType.APPLICATION_JSON))

        val out = adapter.proposeSlotCandidates(candidatesInput())

        out.candidates shouldBe emptyList()
        out.freshness.degraded shouldBe true
        out.emptyReason shouldBe SlotCandidatesEmptyReason.ALL_IN_ITINERARY
    }

    "반경 컷으로 0건이 되면 10km 로 한 번 넓혀 재컷한다 — 실사용 반경을 그대로 알린다" {
        // AI 는 ~8.1km 후보를 줬고 요청 반경은 3km — 컷 후 0건 → 10km 재컷에 걸린다.
        val (adapter, server) = fixture(poolOf(place(farPoi, 33.51, 126.61)))
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/alternatives")).andRespond(
            withSuccess(altBody(0, """{"label":"B","poi_ids":["$farPoi"],"rationale":"근거"}"""), MediaType.APPLICATION_JSON),
        )

        val out = adapter.proposeSlotCandidates(candidatesInput(radiusM = 3_000))

        out.candidates.map { it.poiId } shouldBe listOf(farPoi)
        out.radiusMUsed shouldBe 10_000
    }

    "10km 로 넓혀도 없으면 후보 0건 + NO_NEARBY — 주변엔 없다는 사실을 지어내지 않는다" {
        // ~12km 후보뿐 — 풀 상한(10km) 재컷에도 걸리지 않는다.
        val outsidePoi = UUID.fromString("e0000000-0000-4000-8000-00000000c004")
        val (adapter, server) = fixture(poolOf(place(outsidePoi, 33.55, 126.61)))
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/alternatives")).andRespond(
            withSuccess(altBody(0, """{"label":"B","poi_ids":["$outsidePoi"],"rationale":"근거"}"""), MediaType.APPLICATION_JSON),
        )

        val out = adapter.proposeSlotCandidates(candidatesInput(radiusM = 3_000))

        out.candidates shouldBe emptyList()
        out.emptyReason shouldBe SlotCandidatesEmptyReason.NO_NEARBY
    }

    "반경 20km 요청은 AI 풀 상한 10km 로 접힌다 — 본 적 없는 범위를 표시하지 않는다" {
        val (adapter, server) = fixture(poolOf(place(nearPoi, 33.46, 126.56)))
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/alternatives")).andRespond(
            withSuccess(altBody(0, """{"label":"B","poi_ids":["$nearPoi"],"rationale":"근거"}"""), MediaType.APPLICATION_JSON),
        )

        val out = adapter.proposeSlotCandidates(candidatesInput(radiusM = 20_000))

        out.radiusMUsed shouldBe 10_000
    }

    "ground 미통과 건은 그 건만 빠진다 — INV-1 게이트" {
        // 풀은 nearPoi 만 안다 — farPoi 는 상대가 뭐라 했든 후보가 될 수 없다.
        val (adapter, server) = fixture(poolOf(place(nearPoi, 33.46, 126.56)))
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/alternatives")).andRespond(
            withSuccess(
                altBody(
                    0,
                    """{"label":"B","poi_ids":["$farPoi"],"rationale":"a"},
                       {"label":"C","poi_ids":["$nearPoi"],"rationale":"b"}""",
                ),
                MediaType.APPLICATION_JSON,
            ),
        )

        val out = adapter.proposeSlotCandidates(candidatesInput(radiusM = 10_000))

        out.candidates.map { it.poiId } shouldBe listOf(nearPoi)
    }

    /**
     * **미도달은 로컬 폴백이다(D-4가)** — 오늘까지의 http 모드 동작과 같아 가용성 회귀가 0 이다.
     * 예전 이 자리의 테스트는 "상대를 부르지 않는다"를 단정했다 — TRIP-463 으로 전제가 뒤집혔다.
     */
    "AI 가 5xx 면 예외가 새지 않고 로컬 후보풀 결과 + degraded=true 다" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/alternatives"))
            .andRespond(withServerError())

        val out = adapter.proposeSlotCandidates(candidatesInput())

        out.freshness.degraded shouldBe true
        server.verify()
    }
})

private fun dummyOutput() = com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput(
    days = emptyList(), day1ReadyAt = null, explanations = emptyMap(),
    solveMode = SolveMode.DETERMINISTIC, isFallback = false,
    freshness = com.trippilot.itinerarygeneration.domain.FreshnessMeta(Instant.parse("2026-08-07T00:00:00Z"), false),
)
