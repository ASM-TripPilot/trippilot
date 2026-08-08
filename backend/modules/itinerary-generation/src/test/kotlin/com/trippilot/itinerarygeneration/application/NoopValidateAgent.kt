package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.RepairResult
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.Violation

/** 되돌리기 재검증용 — 위반 없음. 위반 내용 판정은 실 AI(TRIP-309) 몫이라 여기선 흐름만 본다. */
internal class NoopValidateAgent(private val violations: List<Violation> = emptyList()) : ScheduleAgentPort {
    override fun generate(input: ScheduleAgentInput): ScheduleAgentOutput = error("사용하지 않음")
    override fun validate(solution: ScheduleAgentOutput): List<Violation> = violations
    override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>) = RepairResult(solution, emptyList())
}
