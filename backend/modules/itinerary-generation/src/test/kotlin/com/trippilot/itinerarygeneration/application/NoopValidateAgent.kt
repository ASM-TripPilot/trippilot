package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.RepairResult
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.Violation

/**
 * 되돌리기·편집 재검증용 — 기본은 위반 없음. 위반 내용 판정은 실 AI(TRIP-309) 몫이라 여기선 흐름만 본다.
 * [failure] 를 주면 재검증이 그 예외로 실패한다(AI 장애 재현).
 */
internal class NoopValidateAgent(
    private val violations: List<Violation> = emptyList(),
    private val failure: RuntimeException? = null,
) : StubScheduleAgent() {
    override fun generate(input: ScheduleAgentInput): ScheduleAgentOutput = error("사용하지 않음")
    override fun validate(solution: ScheduleAgentOutput): List<Violation> = failure?.let { throw it } ?: violations
    override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>) = RepairResult(solution, emptyList())
}
