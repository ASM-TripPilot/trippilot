package com.trippilot.itinerarygeneration.contract

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.PropertyNamingStrategies
import com.fasterxml.jackson.databind.SerializationFeature
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import com.trippilot.itinerarygeneration.domain.DayAnchor
import com.trippilot.itinerarygeneration.domain.DaySchedule
import com.trippilot.itinerarygeneration.domain.FixedBlock
import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.PreferenceProfile
import com.trippilot.itinerarygeneration.domain.RequestMeta
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.TimeWindow
import com.trippilot.itinerarygeneration.domain.TripContext
import com.trippilot.itinerarygeneration.domain.VisitSlotDisplay
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * BE-1 계약 테스트 — ScheduleAgent I/O DTO가 AI 경계(snake_case)로 정확히 직렬화·왕복하는지.
 * 어댑터(BE-2)의 실제 ObjectMapper 설정(snake_case)을 재현해 필드명 정합·INV-3(소요시간 부재)를 고정한다.
 * (domain 순수성(R2, 경로 `/domain/`) 때문에 jackson 쓰는 이 테스트는 domain 밖 `/contract/`에 둔다.)
 */
class ScheduleAgentContractTest : StringSpec({

    val mapper: ObjectMapper = ObjectMapper()
        .registerKotlinModule()
        .registerModule(JavaTimeModule())
        .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
        .setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)

    val trip = UUID.randomUUID()
    val poi = UUID.randomUUID()

    val input = ScheduleAgentInput(
        tripId = trip,
        generationMode = GenerationMode.FULLY_AI,
        tripContext = TripContext(listOf("부산"), LocalDate.parse("2026-08-10"), LocalDate.parse("2026-08-12"), "친구", "중간"),
        anchors = listOf(DayAnchor(LocalDate.parse("2026-08-10"), 35.1, 129.0)),
        timeWindows = listOf(TimeWindow(LocalDate.parse("2026-08-10"), LocalTime.parse("09:00"), LocalTime.parse("21:00"))),
        fixedBlocks = listOf(FixedBlock(poi, LocalDate.parse("2026-08-10"), LocalTime.parse("12:00"), 60)),
        preferenceProfile = PreferenceProfile(
            styles = listOf("미식"), activities = listOf("야경"), foodTastes = listOf("해산물"),
            transportModes = listOf("대중교통"), pace = "균형있게", companionTypes = listOf("친구"),
            petFriendly = false, budgetTier = "중간",
        ),
        recommendationStrength = null,
        requestMeta = RequestMeta("req-1", Instant.parse("2026-08-10T00:00:00Z"), 20000),
    )

    val output = ScheduleAgentOutput(
        days = listOf(
            DaySchedule(
                LocalDate.parse("2026-08-10"),
                listOf(VisitSlotDisplay(poi, LocalTime.parse("10:30"), LocalTime.parse("12:00"), false, "약 1.2km", true)),
            ),
        ),
        day1ReadyAt = Instant.parse("2026-08-10T00:00:04Z"),
        explanations = mapOf("slot-0" to "미식 취향 반영"),
        solveMode = SolveMode.FULL_AI,
        isFallback = false,
        freshness = FreshnessMeta(Instant.parse("2026-08-10T00:00:04Z"), degraded = false),
    )

    "ScheduleAgentInput은 snake_case로 직렬화·왕복" {
        val json = mapper.writeValueAsString(input)
        json shouldContain "\"trip_id\""
        json shouldContain "\"generation_mode\""
        json shouldContain "\"preference_profile\""
        json shouldContain "\"deadline_ms\""
        json shouldContain "\"fixed_blocks\""
        // 2단계 생성 중복 방지(TRIP-293) — 이름이 어긋나면 제외가 조용히 무력화된다
        json shouldContain "\"excluded_poi_ids\""
        mapper.readValue(json, ScheduleAgentInput::class.java) shouldBe input
    }

    "ScheduleAgentOutput 왕복 + VisitSlotDisplay에 소요시간 필드 없음(INV-3)" {
        val json = mapper.writeValueAsString(output)
        json shouldContain "\"day1_ready_at\""
        json shouldContain "\"solve_mode\""
        json shouldContain "\"is_fallback\""
        mapper.readValue(json, ScheduleAgentOutput::class.java) shouldBe output

        // INV-3: 표시 슬롯에 소요시간(duration/minutes)은 없고 거리만.
        val slotJson = mapper.writeValueAsString(output.days.first().slots.first())
        slotJson shouldContain "\"distance_range\""
        slotJson shouldContain "\"ends_next_day\""
        slotJson shouldNotContain "duration"
        slotJson shouldNotContain "minutes"
    }
})
