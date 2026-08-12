package com.trippilot.app

import com.trippilot.itinerarygeneration.domain.DayAnchor
import com.trippilot.itinerarygeneration.domain.FixedBlock
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.PreferenceProfile
import com.trippilot.itinerarygeneration.domain.ReplanInput
import com.trippilot.itinerarygeneration.domain.ReplanScope
import com.trippilot.itinerarygeneration.domain.RequestMeta
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.TimeWindow
import com.trippilot.itinerarygeneration.domain.TripContext
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.TestPropertySource
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * **실 AI 서비스와의 왕복** — 우리 어댑터가 상대 실물에 대해 실제로 동작하는지.
 *
 * 평소에는 **꺼져 있다**. CI 게이트 정책이 "외부 API 호출 0회"라(모든 외부는 CI 에서 fake) 이 테스트가
 * 상시 켜져 있으면 그 정책이 깨지고, AI 컨테이너가 없는 환경에서는 무조건 빨개진다.
 *
 * 켜는 법 — AI 를 띄우고 환경변수를 준다:
 * ```
 * docker compose --profile full up -d ai
 * LIVE_AI=1 ./gradlew :app:test --tests "*LiveAiRoundTripIT*"
 * ```
 *
 * 여기서만 드러나는 것: 계약 게이트([com.trippilot.itinerarygeneration.contract.AiBoundaryOpenApiTest])는
 * **필드 이름**이 맞는지만 본다. 상대가 그 요청을 **수용하는지**(변환·검증 통과)는 실호출로만 알 수 있다 —
 * 스키마를 통과하고도 한 겹 안쪽 변환에서 422 로 거부되는 사례를 이미 겪었다(anti-patterns.md).
 */
@SpringBootTest
@TestPropertySource(
    properties = [
        "trippilot.ai.schedule.mode=http",
        "trippilot.ai.schedule.base-url=\${LIVE_AI_URL:http://localhost:8000}",
    ],
)
@EnabledIfEnvironmentVariable(named = "LIVE_AI", matches = "1")
class LiveAiRoundTripIT : AbstractPostgresIntegrationTest() {

    @Autowired lateinit var agent: ScheduleAgentPort

    private val today: LocalDate = LocalDate.now()
    private val poi = UUID.randomUUID()

    private fun input(days: List<LocalDate>, fixed: List<FixedBlock> = emptyList()) = ScheduleAgentInput(
        tripId = UUID.randomUUID(),
        generationMode = GenerationMode.FULLY_AI,
        tripContext = TripContext(listOf("제주"), days.first(), days.last(), "친구", "표준"),
        anchors = days.map { DayAnchor(it, 33.4996, 126.5312) },
        timeWindows = days.map { TimeWindow(it, LocalTime.parse("09:00"), LocalTime.parse("21:00")) },
        fixedBlocks = fixed,
        preferenceProfile = PreferenceProfile(
            listOf("미식"), listOf("야경"), listOf("한식"), listOf("렌터카"), "알차게", listOf("친구"), false, "표준",
        ),
        recommendationStrength = null,
        requestMeta = RequestMeta(UUID.randomUUID().toString(), Instant.now(), 20_000L),
        excludedPoiIds = emptyList(),
    )

    @Test
    fun `생성 요청이 상대에 수용되고 응답이 도메인으로 매핑된다`() {
        val output = agent.generate(input(listOf(today, today.plusDays(1))))

        // solve_mode 는 미지 값이면 예외다 — 여기까지 왔다는 것은 상대 어휘가 우리 매핑 안에 있다는 뜻이다.
        assertThat(output.solveMode).isNotNull()
        assertThat(output.freshness).isNotNull()
        println("[LIVE-AI] generate → solveMode=${output.solveMode} isFallback=${output.isFallback} " +
            "days=${output.days.size} slots=${output.days.sumOf { it.slots.size }} " +
            "unplaced=${output.unplacedMustVisits.size} candidates=${output.candidatesSummary?.level}")
    }

    /**
     * 고정 블록(HC3)이 실린 요청 — 재계획이 잠금을 승격해 보내는 모양과 같다.
     * 날짜·시각 없는 ANYTIME 고정 블록은 상대 변환에서 거부된 이력이 있어(계약 M1) 그 모양을 함께 태운다.
     */
    @Test
    fun `날짜 시각이 붙은 고정 블록이 실려도 수용된다`() {
        val output = agent.generate(
            input(listOf(today), listOf(FixedBlock(poi, today, LocalTime.parse("12:00"), 90))),
        )

        assertThat(output.days).isNotEmpty()
        println("[LIVE-AI] generate(fixed) → days=${output.days.size} slots=${output.days.sumOf { it.slots.size }}")
    }

    @Test
    fun `검증 왕복 — 생성 결과를 그대로 되돌려 보낸다`() {
        val generated = agent.generate(input(listOf(today)))

        val violations = agent.validate(generated)

        // 위반이 있든 없든 **200 으로 목록**이 와야 한다(IO-7) — 예외면 경계가 깨진 것이다.
        println("[LIVE-AI] validate → violations=${violations.size} ${violations.take(3).map { it.type }}")
        assertThat(violations).isNotNull()
    }

    /**
     * 재계획(#194) — 잠금을 고정 블록으로 승격해 **기존 generate 경로**에 태운다.
     * 상대에 새 경로를 요구하지 않는 설계라, 실제로 수용되는지가 이 테스트의 전부다.
     */
    @Test
    fun `재계획이 상대에 수용된다 — 잠금이 고정 블록으로 승격돼 나간다`() {
        val output = agent.replan(
            ReplanInput(
                tripId = UUID.randomUUID(), itineraryId = UUID.randomUUID(),
                scope = ReplanScope.PARTIAL_SLOTS, destinations = listOf("제주"), fromInstant = Instant.now(), targetDate = today,
                originLat = 33.45, originLng = 126.56, lockedBlocks = listOf(FixedBlock(poi, today, LocalTime.parse("09:00"), 60)),
                reasons = listOf("비가 와요"), directives = listOf("실내로"), freeText = null,
                excludedPoiIds = emptyList(),
                requestMeta = RequestMeta(UUID.randomUUID().toString(), Instant.now(), 10_000L),
            ),
        )

        assertThat(output.solveMode).isNotNull()
        println("[LIVE-AI] replan → solveMode=${output.solveMode} days=${output.days.size} " +
            "slots=${output.days.sumOf { it.slots.size }} isFallback=${output.isFallback}")
    }

    @Test
    fun `수리 왕복 — 수리 불가는 오류가 아니라 원본 반환이다`() {
        val generated = agent.generate(input(listOf(today)))
        val violations = agent.validate(generated)

        val repaired = agent.repair(generated, violations)

        assertThat(repaired.repaired).isNotNull()
        println("[LIVE-AI] repair → changes=${repaired.changes.size} days=${repaired.repaired.days.size}")
    }
}
