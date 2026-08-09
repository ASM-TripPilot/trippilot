package com.trippilot.itinerarygeneration.contract

import com.trippilot.itinerarygeneration.adapter.out.external.ScheduleAgentConfiguration
import com.trippilot.itinerarygeneration.domain.DayAnchor
import com.trippilot.itinerarygeneration.domain.FixedBlock
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.PreferenceProfile
import com.trippilot.itinerarygeneration.domain.RequestMeta
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
import com.trippilot.itinerarygeneration.domain.TimeWindow
import com.trippilot.itinerarygeneration.domain.TripContext
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 경계 요청의 **실물 픽스처**를 남긴다(TRIP-229).
 *
 * 기존 계약 테스트는 매퍼 설정을 *재현*해 검사했다 — 실 어댑터가 쓰는 매퍼가 바뀌면 그 차이를 못 잡는다.
 * 여기서는 어댑터가 실제로 쓰는 [ScheduleAgentConfiguration.boundaryMapper] 로 직렬화해
 * `build/contract/schedule-agent-request.json` 에 떨군다. 상대 팀(AI)이 자기 스키마로 이 파일을 검증하면
 * **양쪽이 같은 바이트를 놓고 대조**하게 된다(문서 대조가 아니라).
 */
class BoundaryFixtureTest : StringSpec({

    val mapper = ScheduleAgentConfiguration.boundaryMapper()

    // 선택 필드를 비우지 않은 "가장 넓은" 요청 — 좁은 픽스처는 누락을 못 드러낸다.
    val input = ScheduleAgentInput(
        tripId = UUID.fromString("11111111-1111-4111-8111-111111111111"),
        generationMode = GenerationMode.FULLY_AI,
        tripContext = TripContext(
            destinations = listOf("제주"),
            startDate = LocalDate.parse("2026-08-01"),
            endDate = LocalDate.parse("2026-08-03"),
            companionType = "친구",
            budgetLevel = "고급",
        ),
        anchors = listOf(DayAnchor(LocalDate.parse("2026-08-01"), 33.4996, 126.5312)),
        timeWindows = listOf(TimeWindow(LocalDate.parse("2026-08-01"), LocalTime.parse("09:00"), LocalTime.parse("21:00"))),
        fixedBlocks = listOf(
            FixedBlock(UUID.fromString("22222222-2222-4222-8222-222222222222"), LocalDate.parse("2026-08-01"), LocalTime.parse("12:00"), 90),
            FixedBlock(UUID.fromString("33333333-3333-4333-8333-333333333333"), null, null, null), // ANYTIME
        ),
        preferenceProfile = PreferenceProfile(
            styles = listOf("미식"), activities = listOf("야경"), foodTastes = listOf("해산물"),
            transportModes = listOf("렌터카"), pace = "알차게", companionTypes = listOf("친구"),
            petFriendly = true, budgetTier = "고급",
        ),
        recommendationStrength = null,
        requestMeta = RequestMeta("req-fixture-1", Instant.parse("2026-08-01T00:00:00Z"), 5_000),
        excludedPoiIds = listOf(UUID.fromString("44444444-4444-4444-8444-444444444444")),
    )

    "실 어댑터 매퍼로 만든 요청이 커밋된 골든 픽스처와 같다" {
        val json = mapper.writerWithDefaultPrettyPrinter().writeValueAsString(input)
        val golden = requireNotNull(this::class.java.getResourceAsStream("/contract/schedule-agent-request.json"))
            .readBytes().decodeToString()

        // 골든 파일은 AI 의 Pydantic 모델로 검증을 통과한 실물이다. 여기서 어긋나면
        // **중첩 필드 이름이 바뀌었다는 뜻**이고, 상대는 extra="forbid" 라 런타임 422 가 된다.
        // (예전엔 build/ 로만 떨궈 매번 새로 만든 문자열을 자기 자신과 비교했다 — 드리프트를 못 잡았다.)
        json.trim() shouldBe golden.trim()
    }

    "경계로 나가는 모든 요청 타입에 카멜케이스가 새지 않는다" {
        // 키만 본다 — 값에 섞인 카멜케이스에 오탐하지 않게. 숫자를 낀 이름(day1ReadyAt)도 잡는다.
        val camelKey = Regex("\"[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\"\\s*:")

        // 요청 타입 전부 — 생성뿐 아니라 TRIP-309 가 더한 검증·수리 요청도 같은 규칙을 받는다.
        listOf(
            mapper.writeValueAsString(input),
            mapper.writeValueAsString(sampleValidateRequest),
            mapper.writeValueAsString(sampleRepairRequest),
        ).forEach { camelKey.containsMatchIn(it) shouldBe false }
    }

})

private val samplePayload = com.trippilot.itinerarygeneration.adapter.out.external.AiScheduleResponse(
    days = emptyList(), day1ReadyAt = null, explanations = emptyMap(),
    solveMode = "OR_TOOLS", isFallback = false, freshness = null,
)
private val sampleMeta = com.trippilot.itinerarygeneration.adapter.out.external.AiRequestMeta(
    "req-1", Instant.parse("2026-08-01T00:00:00Z"), 3_000,
)
private val sampleValidateRequest =
    com.trippilot.itinerarygeneration.adapter.out.external.AiValidateRequest(samplePayload, sampleMeta)
private val sampleRepairRequest =
    com.trippilot.itinerarygeneration.adapter.out.external.AiRepairRequest(
        samplePayload,
        listOf(com.trippilot.itinerarygeneration.adapter.out.external.AiViolation("TRAVEL_TIME", "2026-08-01#p", "", 0, 1)),
        sampleMeta,
    )
