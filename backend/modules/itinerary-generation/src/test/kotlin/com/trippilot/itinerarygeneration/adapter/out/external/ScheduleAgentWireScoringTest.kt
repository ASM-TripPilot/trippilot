package com.trippilot.itinerarygeneration.adapter.out.external

import com.trippilot.itinerarygeneration.domain.ScoringMode
import com.trippilot.itinerarygeneration.domain.ScoringSignal
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Instant

/**
 * 취향 점수 신호 매핑(TRIP-1173). `solve_mode` 는 조립 축이라 LLM 실패를 말하지 않는다 — 이 신호가
 * 도메인까지 와야 일정에 저장되고 앱이 "LLM 이 안 돈다"와 "LLM 이 실패했다"를 가른다.
 */
class ScheduleAgentWireScoringTest : StringSpec({
    val mapper = ScheduleAgentConfiguration.boundaryMapper()
    val now = Instant.parse("2026-08-01T00:00:00Z")

    fun response(scoringMode: String?, degradations: List<String>) =
        AiScheduleResponse(solveMode = "OR_TOOLS", scoringMode = scoringMode, degradations = degradations)

    "LLM 점수에 실패한 응답은 RULE 과 llm: 코드가 그대로 도메인에 온다" {
        response("RULE", listOf("llm:c1_fallback", "explanation:explanation_fallback")).toDomain(now).scoring shouldBe
            ScoringSignal(ScoringMode.RULE, listOf("llm:c1_fallback", "explanation:explanation_fallback"))
    }

    "정상 LLM 점수는 LLM, 규칙 보충이 섞이면 MIXED" {
        response("LLM", emptyList()).toDomain(now).scoring shouldBe ScoringSignal(ScoringMode.LLM, emptyList())
        response("MIXED", emptyList()).toDomain(now).scoring.mode shouldBe ScoringMode.MIXED
    }

    "두 필드가 없는 옛 응답은 오류 없이 모름 — 상대가 직렬화한 실물 픽스처로 본다" {
        val old = mapper.readValue(
            requireNotNull(this::class.java.getResourceAsStream("/contract/response-or-tools.json")),
            AiScheduleResponse::class.java,
        )
        old.toDomain(now).scoring shouldBe ScoringSignal.UNKNOWN
    }

    "모르는 scoring_mode 는 예외가 아니라 모름 — 정상 일정이 폴백으로 강등되지 않는다(강등 코드는 남는다)" {
        response("PARTIAL", listOf("llm:c1_partial")).toDomain(now).scoring shouldBe
            ScoringSignal(null, listOf("llm:c1_partial"))
    }

    "코드 모양이 아닌 강등 항목은 공개 응답으로 나가기 전에 버린다 — 예외 문장·대문자·콜론 없음·64자 초과" {
        val tooLong = "llm:" + "a".repeat(61) // 65자
        val out = response(
            "RULE",
            listOf(
                "llm:c1_fallback",
                "agent:TimeoutError: read timed out after 15000ms",
                "agent:LLM 응답을 해석하지 못했습니다",
                "nocolon",
                "LLM:c1_fallback",
                tooLong,
                "llm:" + "a".repeat(60), // 64자 — 경계 안
                "llm:c1_fallback",       // 중복은 한 번만
            ),
        ).toDomain(now).scoring.degradations

        out shouldBe listOf("llm:c1_fallback", "llm:" + "a".repeat(60))
    }

    "강등 코드는 16개까지만 싣는다 — 계약이 바뀌어 쏟아져도 일정 행이 끝없이 커지지 않는다" {
        val many = (1..20).map { "stage:reason_$it" }
        response("RULE", many).toDomain(now).scoring.degradations shouldBe many.take(16)
    }
})
