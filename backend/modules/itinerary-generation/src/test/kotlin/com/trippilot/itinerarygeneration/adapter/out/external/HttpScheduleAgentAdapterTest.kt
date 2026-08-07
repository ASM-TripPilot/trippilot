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
import com.trippilot.placedata.api.Area
import com.trippilot.placedata.api.CandidatePoolPort
import com.trippilot.placedata.api.GroundedPlace
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath
import org.springframework.test.web.client.match.MockRestRequestMatchers.method
import org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo
import org.springframework.test.web.client.response.MockRestResponseCreators.withStatus
import org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess
import org.springframework.http.converter.json.JacksonJsonHttpMessageConverter
import org.springframework.web.client.RestClient
import tools.jackson.databind.json.JsonMapper
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset
import java.util.UUID

/**
 * 포워드 경계 HTTP 어댑터(TRIP-229) — 계약(PR #104) 준수 검증. 외부 호출 0(MockRestServiceServer).
 * 핵심: **200 이면 예외 없음**(is_fallback=true 여도) · 4xx/5xx·네트워크 실패만 ScheduleAgentCallFailed.
 */
class HttpScheduleAgentAdapterTest : StringSpec({

    val clock = Clock.fixed(Instant.parse("2026-08-07T00:00:00Z"), ZoneOffset.UTC)
    val d1 = LocalDate.parse("2026-08-01")
    val poi = UUID.randomUUID()
    // 프로덕션과 동일한 경계 매퍼(snake_case) 사용 — 설정에서 그대로 가져온다.
    val mapper = ScheduleAgentConfiguration.snakeCase(JsonMapper.builder().build())

    /** 어댑터 + 바인딩된 mock 서버. */
    fun fixture(): Pair<HttpScheduleAgentAdapter, MockRestServiceServer> {
        val builder = RestClient.builder()
            .baseUrl("http://ai.test")
            .messageConverters { it.add(0, JacksonJsonHttpMessageConverter(mapper)) }
        val server = MockRestServiceServer.bindTo(builder).build()
        val fake = FakeScheduleAgent(emptyPool(), clock)
        return HttpScheduleAgentAdapter(builder.build(), mapper, fake) to server
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
        requestMeta = RequestMeta("req-1", clock.instant(), 20_000),
    )

    fun okBody(isFallback: Boolean, solveMode: String) = """
        {"days":[{"date":"2026-08-01","slots":[
          {"poi_id":"$poi","start_at":"10:00:00","end_at":"11:00:00","ends_next_day":false,"distance_range":null,"is_fixed":false}]}],
         "day1_ready_at":null,"explanations":{},"solve_mode":"$solveMode","is_fallback":$isFallback,
         "freshness":{"generated_at":"2026-08-07T00:00:00Z","degraded":false}}
    """.trimIndent()

    "정상 200 — snake_case 요청·응답 왕복(계약 경로)" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/generate"))
            .andExpect(method(org.springframework.http.HttpMethod.POST))
            .andExpect(jsonPath("$.trip_id").exists())         // camel→snake 변환 확인
            .andExpect(jsonPath("$.request_meta.deadline_ms").value(20000))
            .andRespond(withSuccess(okBody(isFallback = false, solveMode = "FULL_AI"), MediaType.APPLICATION_JSON))

        val out = adapter.generate(input)
        out.solveMode shouldBe SolveMode.FULL_AI
        out.days.single().slots.single().poiId shouldBe poi
        server.verify()
    }

    "200 + is_fallback=true — 예외 없이 그대로 사용(대원칙: AI 200 이면 백엔드 폴백 금지)" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/generate"))
            .andRespond(withSuccess(okBody(isFallback = true, solveMode = "MINIMAL"), MediaType.APPLICATION_JSON))

        val out = adapter.generate(input) // 던지지 않아야 한다
        out.isFallback shouldBe true
        out.solveMode shouldBe SolveMode.MINIMAL
    }

    "422(스키마 위반) — ScheduleAgentCallFailed(retryable=false) → 백엔드 폴백 신호" {
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

    "500(미분류) — 에러 바디 없어도 상태코드로 실패 판정" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/generate"))
            .andRespond(withStatus(HttpStatus.INTERNAL_SERVER_ERROR))

        val e = shouldThrow<ScheduleAgentCallFailed> { adapter.generate(input) }
        e.retryable shouldBe false // 계약 기본: AI 오류는 재시도 이득 없음
        e.message!! shouldContain "500"
    }

    "역직렬화 실패(깨진 본문) — 유효한 200 이 아니므로 폴백 대상" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://ai.test/ai/v1/itinerary/generate"))
            .andRespond(withSuccess("{\"nope\":1}", MediaType.APPLICATION_JSON))

        shouldThrow<ScheduleAgentCallFailed> { adapter.generate(input) }
    }

    "validate·repair 는 TRIP-292 까지 Fake 위임(http 모드에서도 편집 흐름 유지)" {
        val (adapter, _) = fixture()
        adapter.validate(okOutput()) shouldBe emptyList()
        adapter.repair(okOutput(), emptyList()).changes shouldBe emptyList()
    }
})

private fun emptyPool() = object : CandidatePoolPort {
    override fun resolve(area: Area, categories: Set<String>): List<GroundedPlace> = emptyList()
    override fun ground(poiIds: List<UUID>): List<GroundedPlace> = emptyList()
}

private fun okOutput() = com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput(
    days = emptyList(), day1ReadyAt = null, explanations = emptyMap(),
    solveMode = SolveMode.DETERMINISTIC, isFallback = false,
    freshness = com.trippilot.itinerarygeneration.domain.FreshnessMeta(Instant.parse("2026-08-07T00:00:00Z"), false),
)
