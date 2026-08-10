package com.trippilot.itinerarygeneration.adapter.out.external

import com.trippilot.itinerarygeneration.domain.FixedBlock
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.PreferenceProfile
import com.trippilot.itinerarygeneration.domain.RequestMeta
import com.trippilot.itinerarygeneration.domain.ScheduleAgentCallFailed
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
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

    fun fixture(): Pair<HttpScheduleAgentAdapter, MockRestServiceServer> {
        // 프로덕션과 동일한 경계 매퍼·컨버터 구성(설정에서 그대로 가져옴).
        val builder = RestClient.builder()
            .baseUrl("http://ai.test")
            .messageConverters { it.add(0, JacksonJsonHttpMessageConverter(ScheduleAgentConfiguration.boundaryMapper())) }
        val server = MockRestServiceServer.bindTo(builder).build()
        return HttpScheduleAgentAdapter(builder.build(), clock) to server
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
})

private fun dummyOutput() = com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput(
    days = emptyList(), day1ReadyAt = null, explanations = emptyMap(),
    solveMode = SolveMode.DETERMINISTIC, isFallback = false,
    freshness = com.trippilot.itinerarygeneration.domain.FreshnessMeta(Instant.parse("2026-08-07T00:00:00Z"), false),
)
