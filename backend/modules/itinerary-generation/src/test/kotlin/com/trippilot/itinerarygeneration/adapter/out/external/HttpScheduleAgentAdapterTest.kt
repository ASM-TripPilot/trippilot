package com.trippilot.itinerarygeneration.adapter.out.external

import com.trippilot.itinerarygeneration.domain.FixedBlock
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.PreferenceProfile
import com.trippilot.itinerarygeneration.domain.ReplanCurrentSlot
import com.trippilot.itinerarygeneration.domain.ReplanInput
import com.trippilot.itinerarygeneration.domain.SavedPlaceRef
import com.trippilot.itinerarygeneration.domain.ReplanScope
import com.trippilot.itinerarygeneration.domain.RequestMeta
import com.trippilot.itinerarygeneration.domain.ScheduleAgentCallFailed
import com.trippilot.placedata.api.Area
import com.trippilot.placedata.api.CandidatePoolPort
import com.trippilot.placedata.api.GroundedPlace
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
import com.trippilot.itinerarygeneration.domain.SlotCandidatesEmptyReason
import com.trippilot.itinerarygeneration.domain.SlotCandidatesInput
import com.trippilot.itinerarygeneration.domain.DaySchedule
import com.trippilot.itinerarygeneration.domain.SlotAlternative
import com.trippilot.itinerarygeneration.domain.VisitSlotDisplay
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
    /** 재계획 표본이 쓰는 POI — 최상위 함수에서도 봐야 해서 파일 스코프에 둔다. */

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

    /** 재계획 응답 본문 — 생성 응답을 `itinerary` 로 감싼 별도 스키마다(`ReplanResponse`). */
    fun replanBody(
        itinerary: String? = null,
        totalDistanceKm: String = "6.9",
        extra: String = "",
    ) = """
        {"itinerary":${itinerary ?: "null"},"total_distance_km":$totalDistanceKm,
         "is_fallback":false,"fallback_level":0,"notes":[],
         "resolved_directives":["INDOOR"],"unknown_directives":[]$extra}
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

    /**
     * 차선책 수신 + **정본 대조**(TRIP-873 · INV-1).
     *
     * 응답에 셋을 싣는다: 정본에 있는 것 · 정본에 **없는** 것 · UUID 가 아닌 것. 살아남아야 하는 것은
     * 첫째뿐이다. 대조를 안 하면 경계 너머가 지어낸 장소가 "다른 선택지"로 화면에 뜨고, 사용자가
     * 누르는 순간 편집이 깨진다 — 편집 경로에 POI 실재 검사가 없다.
     */
    "차선책을 받아 정본에 있는 것만 남긴다" {
        val kept = UUID.randomUUID()
        val ghost = UUID.randomUUID()   // 정본에 없다 — AI 가 지어낸 참조
        val pool = object : CandidatePoolPort {
            override fun resolve(area: Area, categories: Set<String>) = emptyList<GroundedPlace>()
            override fun ground(poiIds: List<UUID>) =
                poiIds.filter { it == kept }.map { GroundedPlace(it, "남는곳", 33.4, 126.5, "명소", null, null) }
        }
        val body = """
            {"days":[{"date":"2026-08-01","slots":[
              {"poi_id":"$poi","start_at":"10:00:00","end_at":"11:00:00","is_fixed":false,
               "alternatives":[
                 {"poi_id":"$kept","rationale":"같은 카페 후보","distance_range":"약 1.2km"},
                 {"poi_id":"$ghost","rationale":"정본에 없는 곳"},
                 {"poi_id":"not-a-uuid","rationale":"형식이 틀린 것"}]}]}],
             "explanations":{},"solve_mode":"OR_TOOLS","is_fallback":false}
        """.trimIndent()
        val (adapter, server) = fixture(pool)
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/generate"))
            .andRespond(withSuccess(body, MediaType.APPLICATION_JSON))

        val alts = adapter.generate(input).days.single().slots.single().alternatives

        alts.map { it.poiId } shouldBe listOf(kept)
        alts.single().rationale shouldBe "같은 카페 후보"
        alts.single().distanceRange shouldBe "약 1.2km"
        server.verify()
    }

    /**
     * **상한(슬롯당 2건)을 우리 쪽에서도 지킨다.** 계약이 ≤2 인데 3건이 오면 계약 위반이지만,
     * 응답을 통째로 버리는 것은 과하다(INV-4 취지 역행) — 앞의 둘만 쓰고 로그로 드러낸다.
     * 빈 `rationale` 은 버린다 — 화면에 빈 줄이 뜨고, 그건 "후보가 있다"는 신호만 남기고 이유가 없다.
     */
    "상한을 넘긴 차선책은 둘까지만 쓰고, 이유 없는 후보는 버린다" {
        val a = UUID.randomUUID(); val b = UUID.randomUUID(); val c = UUID.randomUUID(); val blank = UUID.randomUUID()
        val all = listOf(a, b, c, blank)
        val pool = object : CandidatePoolPort {
            override fun resolve(area: Area, categories: Set<String>) = emptyList<GroundedPlace>()
            override fun ground(poiIds: List<UUID>) =
                poiIds.filter { it in all }.map { GroundedPlace(it, "정본", 33.4, 126.5, "명소", null, null) }
        }
        val body = """
            {"days":[{"date":"2026-08-01","slots":[
              {"poi_id":"$poi","start_at":"10:00:00","end_at":"11:00:00","is_fixed":false,
               "alternatives":[
                 {"poi_id":"$blank","rationale":"   "},
                 {"poi_id":"$a","rationale":"첫째"},
                 {"poi_id":"$b","rationale":"둘째"},
                 {"poi_id":"$c","rationale":"셋째"}]}]}],
             "explanations":{},"solve_mode":"OR_TOOLS","is_fallback":false}
        """.trimIndent()
        val (adapter, server) = fixture(pool)
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/generate"))
            .andRespond(withSuccess(body, MediaType.APPLICATION_JSON))

        // 빈 이유가 먼저 빠지고, 남은 셋 중 앞의 둘만 쓴다.
        adapter.generate(input).days.single().slots.single().alternatives.map { it.poiId } shouldBe listOf(a, b)
        server.verify()
    }

    /** 필드가 없는 옛 응답도 같은 뜻이어야 한다 — 빈 목록이지 역직렬화 실패가 아니다. */
    "차선책 필드가 없으면 빈 목록이다" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/generate"))
            .andRespond(withSuccess(aiBody("OR_TOOLS"), MediaType.APPLICATION_JSON))

        adapter.generate(input).days.single().slots.single().alternatives shouldBe emptyList()
        server.verify()
    }

    /**
     * **재계획이 취향·동반·예산을 실어 보낸다**(연동 설계 B-1).
     *
     * 종전에는 `NEUTRAL_PREFERENCES` 로 취향을 덮고 동반·예산을 `null` 로 보냈다 — 값은
     * `ReplanInput` 에 이미 실려 있었는데(호출측이 trip·profile 에서 읽어 채운다) **어댑터가 버렸다.**
     * 그 상태의 증상은 예외가 아니라 *"처음 일정은 취향대로인데 다시 짜면 남의 취향처럼 나온다"* 라
     * 사용자도 우리도 원인을 못 짚는다.
     *
     * **요청 본문을 본다** — 도메인 입력만 확인하면 어댑터가 버리는 이 결함을 원리적으로 못 본다.
     */
    "재계획이 취향·동반·예산을 요청에 싣는다 — 중립으로 덮지 않는다" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/replan"))
            .andExpect(jsonPath("$.preference_profile.styles[0]").value("감성"))
            .andExpect(jsonPath("$.preference_profile.pace").value("여유"))
            .andExpect(jsonPath("$.trip_context.companion_type").value("친구"))
            .andExpect(jsonPath("$.trip_context.budget_level").value("MID"))
            .andRespond(withSuccess(replanBody(aiBody("OR_TOOLS")), MediaType.APPLICATION_JSON))

        adapter.replan(replanInput())

        server.verify()
    }

    /**
     * **전용 경로로 간다**(TRIP-854 B-3). 종전에는 잠금을 고정 블록으로 승격해 `generate` 를
     * 재사용했고, 그 계약에 자리가 없는 값 다섯(사유·지시·자유입력·원 일정·담은 장소)이
     * **조용히 버려졌다.** 증상이 예외가 아니라 "재계획이 내 말을 안 듣는다"라 원인을 못 짚는다.
     *
     * 경로와 본문을 **함께** 본다 — 경로만 보면 옮겨 놓고 값을 안 실어도 통과한다.
     */
    "재계획이 사유·지시·자유입력·원 일정·담은 장소를 전용 경로에 싣는다" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/replan"))
            .andExpect(method(HttpMethod.POST))
            .andExpect(jsonPath("$.scope").value("FULL_DAY"))
            .andExpect(jsonPath("$.reasons[0]").value("WEATHER"))
            .andExpect(jsonPath("$.directives[0]").value("INDOOR"))
            .andExpect(jsonPath("$.free_text").value("비 와서 실내로"))
            .andExpect(jsonPath("$.current_slots[0].poi_id").value(REPLAN_POI.toString()))
            .andExpect(jsonPath("$.current_slots[0].start_at").value("10:00:00"))
            .andExpect(jsonPath("$.current_slots[0].placement_reason").value("동선상 가까워요"))
            .andExpect(jsonPath("$.saved_places[0].name").value("담아 둔 카페"))
            // 창은 **하루 전체**다 — 좁히면 오전에 잠긴 고정 블록이 창 밖이 되어 상대가 409 로 거부한다.
            .andExpect(jsonPath("$.time_window.start").value("09:00:00"))
            .andExpect(jsonPath("$.time_window.end").value("21:00:00"))
            .andExpect(jsonPath("$.anchor.lat").value(33.4))
            .andRespond(withSuccess(replanBody(aiBody("OR_TOOLS")), MediaType.APPLICATION_JSON))

        adapter.replan(richReplanInput())

        server.verify()
    }

    /**
     * 거리는 **상대가 푼 값**이다(INV-2). 흘리면 i08 의 "이동 −6.9km" 를 만들 재료가 사라지는데,
     * 예외가 아니라 화면에서 그 줄만 안 보이는 형태라 아무도 눈치채지 못한다.
     */
    "재계획 응답의 total_distance_km 가 산출물에 실린다" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/replan"))
            .andRespond(withSuccess(replanBody(aiBody("OR_TOOLS")), MediaType.APPLICATION_JSON))

        adapter.replan(replanInput()).totalDistanceKm shouldBe 6.9
    }

    /**
     * **대안 없음은 실패가 아니다.** 상대가 `itinerary: null` + `empty_reason` 으로 정상 응답한 것이고,
     * 화면은 그걸 받아 `i06` 3옵션을 그려야 한다. 여기서 던지면 사용자는 오류 화면을 본다.
     */
    "대안 없음(itinerary=null)은 예외가 아니라 빈 산출이다" {
        val (adapter, server) = fixture()
        val body = replanBody(
            itinerary = null,
            totalDistanceKm = "null",
            extra = ""","empty_reason":{"code":"NO_CANDIDATE","params":{"from":"17:00"}}""",
        )
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/replan"))
            .andRespond(withSuccess(body, MediaType.APPLICATION_JSON))

        adapter.replan(replanInput()).days shouldBe emptyList()
    }

    /**
     * **상대가 아직 배선 전이면(503) 종전 경로로 내려간다.** 계약·스키마는 출하됐는데 오케스트레이터만
     * 진행 중인 상태가 실재한다(실측 2026-09-20). 그동안 재계획을 전부 실패로 올리면 사용자는
     * "다시 짜기"를 누를 때마다 수동 편집으로 튕긴다.
     */
    "상대가 재계획 경로를 배선 전이면(503) 종전 generate 경로로 내려간다" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/replan"))
            .andRespond(
                withStatus(HttpStatus.SERVICE_UNAVAILABLE)
                    .body("""{"error_code":"ORCHESTRATOR_NOT_WIRED","message":"배선 미완료","retryable":false}""")
                    .contentType(MediaType.APPLICATION_JSON),
            )
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/generate"))
            .andRespond(withSuccess(aiBody("OR_TOOLS"), MediaType.APPLICATION_JSON))

        adapter.replan(replanInput()).days.single().slots.single().poiId shouldBe poi

        server.verify()
    }

    /**
     * **다른 503 은 폴백하지 않는다.** 배선 전과 상대 장애는 다른 사실이고, 장애를 조용히 종전 경로로
     * 흘리면 "AI 가 죽었는데 재계획만 이상하게 돈다"가 된다 — 폴백 판정은 INV-4 대로 위에서 한다.
     */
    "배선 전이 아닌 실패는 종전 경로로 내려가지 않는다" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/replan"))
            .andRespond(
                withStatus(HttpStatus.SERVICE_UNAVAILABLE)
                    .body("""{"error_code":"UPSTREAM_DOWN","message":"LLM 게이트웨이 장애","retryable":true}""")
                    .contentType(MediaType.APPLICATION_JSON),
            )

        shouldThrow<ScheduleAgentCallFailed> { adapter.replan(replanInput()) }

        server.verify()
    }

    /**
     * 앵커 없이 부르면 상대가 422 다(실측) — 후보 풀을 매달 기준점이 없다. 그 422 는 로그에서
     * "AI 가 이상하다"로 읽히므로, **부르기 전에** 우리 실패로 올린다. 호출이 나가지 않는 것까지 본다.
     */
    "기준점이 없으면 부르지 않고 실패로 올린다" {
        val (adapter, server) = fixture()   // expect 를 걸지 않는다 — 한 건이라도 나가면 verify 가 깬다

        shouldThrow<ScheduleAgentCallFailed> {
            adapter.replan(replanInput().copy(originLat = null, originLng = null))
        }

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

    /**
     * **요청에 차선책이 실리는지 못 박는다**(TRIP-873 · TRIP-887 로 뒤집힘).
     *
     * 종전에는 반대를 고정했다 — *"검증 요청의 슬롯에는 차선책이 빈 배열로 실린다"*. 그 근거는
     * "상대가 소비하지 않는 값"이었는데, TRIP-887 로 `/explanations` 가 **요청 payload 의
     * `slots[].alternatives[]` 를 읽어** 차선책 문장을 만들게 되면서 근거가 사라졌다.
     *
     * **안 실으면 조용히 꺼진다** — 응답이 늘 `alternative_explanations: {}` 인데 그건 "차선책이
     * 없다"와 **구분되지 않는 모양**이다. 그래서 값이 실제로 본문에 닿는지를 여기서 센다
     * (상대 팀이 같은 부류를 두 번 놓쳐 합성 루트에 가드를 넣었다 — PR #668).
     *
     * 검증·수리 요청에도 같은 `toWire()` 가 쓰여 함께 실리지만, 상대는 그 경로에서 받아만 두고
     * 쓰지 않는다(TRIP-879 로 422 해소). 그래서 여기서 `validate` 로 확인해도 뜻이 같다.
     */
    "요청 슬롯에 차선책이 실린다 — 안 실으면 상대가 문장을 만들 재료를 못 받는다" {
        // dummyOutput() 은 days 가 비어 있어 슬롯 경로가 아예 없다 — 슬롯 하나를 실은 산출물로 본다.
        val altPoi = UUID.randomUUID()
        val solution = dummyOutput().copy(
            days = listOf(
                DaySchedule(
                    d1,
                    listOf(
                        VisitSlotDisplay(
                            poi, LocalTime.of(10, 0), LocalTime.of(11, 0), false, null, false,
                            alternatives = listOf(SlotAlternative(altPoi, "같은 카페 후보", "약 1.2km")),
                        ),
                    ),
                ),
            ),
        )
        val (adapter, server) = fixture()
        val alt = "$.itinerary.days[0].slots[0].alternatives[0]"
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/validate"))
            .andExpect(jsonPath("$alt.poi_id").value(altPoi.toString()))
            .andExpect(jsonPath("$alt.rationale").value("같은 카페 후보"))
            .andExpect(jsonPath("$alt.distance_range").value("약 1.2km"))
            .andRespond(withSuccess("""{"violations":[]}""", MediaType.APPLICATION_JSON))

        adapter.validate(solution)

        server.verify()
    }

    /**
     * **차선책 문장을 받아서 버리지 않는다**(TRIP-873 ② · AI TRIP-887).
     *
     * 와이어 타입에는 `alternative_explanations` 가 먼저 들어와 있었는데(PR #592 가 계약만 맞췄다)
     * `explanations()` 가 `res.explanations` 만 돌려줘 **받고도 버렸다.** 포트 반환이 맵 하나라
     * 돌려줄 자리가 없었던 것이 원인이다 — 여기서 두 축이 다 나오는지 센다.
     */
    "explanations — 슬롯 근거와 차선책 문장을 둘 다 돌려준다" {
        val altPoiId = UUID.randomUUID()
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/explanations"))
            .andRespond(
                withSuccess(
                    """
                    {"explanations":{"2026-08-01#$poi":"오전에 들르기 좋아요"},
                     "alternative_explanations":{"2026-08-01#$altPoiId":"비 오면 여기가 나아요"},
                     "alternatives_reason":null}
                    """.trimIndent(),
                    MediaType.APPLICATION_JSON,
                ),
            )

        val result = adapter.explanations(UUID.randomUUID(), dummyOutput())

        result.slots shouldBe mapOf("2026-08-01#$poi" to "오전에 들르기 좋아요")
        result.alternatives shouldBe mapOf("2026-08-01#$altPoiId" to "비 오면 여기가 나아요")
    }

    /**
     * **옛 응답도 깨지지 않는다** — 두 필드가 없던 시절의 AI 가 돌아와도 슬롯 근거는 살아야 한다.
     * 기본값이 빈 맵이라 성립하는데, 그 기본값이 사라지면 역직렬화가 통째로 실패해 근거가 다 없어진다.
     */
    "explanations — 차선책 필드가 없는 옛 응답도 슬롯 근거는 그대로 받는다" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/explanations"))
            .andRespond(
                withSuccess("""{"explanations":{"2026-08-01#$poi":"좋아요"}}""", MediaType.APPLICATION_JSON),
            )

        val result = adapter.explanations(UUID.randomUUID(), dummyOutput())

        result.slots shouldBe mapOf("2026-08-01#$poi" to "좋아요")
        result.alternatives shouldBe emptyMap()
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

    fun candidatesInput(radiusM: Int? = null, concept: String? = null, reason: String? = null) = SlotCandidatesInput(
        tripId = UUID.randomUUID(),
        slotKey = "2026-09-01#$targetPoi",
        neighborSlotKeys = emptyList(),
        centerLat = 33.45, centerLng = 126.56,
        radiusM = radiusM, concept = concept, excludePoiIds = listOf(targetPoi),
        placementReason = "일몰 명소", reason = reason,
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
            // 사유 없는 편집 흐름(h12·h18) — 입력에 reason 이 없으면 사유 없음으로 나간다.
            .andExpect(jsonPath("$.reason").value("none"))
            .andExpect(jsonPath("$.excluded_poi_ids[0]").value(targetPoi.toString()))
            .andExpect(jsonPath("$.affected_reasons['$targetPoi']").value("일몰 명소"))
            .andExpect(jsonPath("$.request_meta.deadline_ms").value(25000))
            .andRespond(withSuccess(altBody(0, """{"label":"B","poi_ids":["$nearPoi"],"rationale":"근거"}"""), MediaType.APPLICATION_JSON))

        adapter.proposeSlotCandidates(candidatesInput())

        server.verify()
    }

    "FE 사유 코드는 상대 어휘로 번역돼 나간다 — 같은 표를 재계획과 공유한다(B-6)" {
        val (adapter, server) = fixture(poolOf(place(nearPoi, 33.46, 126.56)))
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/alternatives"))
            // FE 는 'TEMP_CLOSED' 를 보내고 상대는 'closed' 만 안다 — 그대로 흘리면 KB 질의가 오염된다.
            .andExpect(jsonPath("$.reason").value("closed"))
            .andRespond(withSuccess(altBody(0, """{"label":"B","poi_ids":["$nearPoi"],"rationale":"근거"}"""), MediaType.APPLICATION_JSON))

        adapter.proposeSlotCandidates(candidatesInput(reason = "TEMP_CLOSED"))

        server.verify()
    }

    "모르는 사유 코드가 와도 요청은 성립한다 — 사유 없음으로 눕는다(INV-4)" {
        val (adapter, server) = fixture(poolOf(place(nearPoi, 33.46, 126.56)))
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/alternatives"))
            .andExpect(jsonPath("$.reason").value("none"))
            .andRespond(withSuccess(altBody(0, """{"label":"B","poi_ids":["$nearPoi"],"rationale":"근거"}"""), MediaType.APPLICATION_JSON))

        // 400 으로 막지 않는다 — 사유는 랭킹 힌트지 요청 성립 조건이 아니다.
        adapter.proposeSlotCandidates(candidatesInput(reason = "PANDEMIC"))

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

private val REPLAN_POI: UUID = UUID.randomUUID()

/** 다섯 값을 전부 채운 표본. 비워 두면 "안 싣는다"와 "빈 값을 싣는다"가 구분되지 않는다. */
private fun richReplanInput() = replanInput().copy(
    freeText = "비 와서 실내로",
    currentSlots = listOf(
        ReplanCurrentSlot(
            REPLAN_POI, LocalTime.of(10, 0), LocalTime.of(11, 0),
            isFixed = true, endsNextDay = false, placementReason = "동선상 가까워요",
        ),
    ),
    savedPlaces = listOf(SavedPlaceRef(UUID.randomUUID(), "담아 둔 카페")),
)

/** 재계획 입력 표본 — 취향·동반·예산을 **실값으로** 채운다(중립이면 이 스펙이 무의미해진다). */
private fun replanInput() = ReplanInput(
    tripId = UUID.randomUUID(),
    itineraryId = UUID.randomUUID(),
    scope = ReplanScope.FULL_DAY,
    destinations = listOf("제주"),
    fromInstant = Instant.parse("2026-08-01T03:00:00Z"),
    targetDate = LocalDate.parse("2026-08-01"),
    originLat = 33.4,
    originLng = 126.5,
    lockedBlocks = emptyList(),
    reasons = listOf("WEATHER"),
    directives = listOf("INDOOR"),
    freeText = null,
    excludedPoiIds = emptyList(),
    companionType = "친구",
    budgetLevel = "MID",
    preferenceProfile = PreferenceProfile(
        styles = listOf("감성"), activities = emptyList(), foodTastes = emptyList(),
        transportModes = emptyList(), pace = "여유", companionTypes = emptyList(),
        petFriendly = false, budgetTier = "MID",
    ),
    currentSlots = emptyList(),
    savedPlaces = emptyList(),
    requestMeta = RequestMeta("replan-1", Instant.parse("2026-08-07T00:00:00Z"), 25_000),
)
