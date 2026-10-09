package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.PreferenceProfile
import com.trippilot.itinerarygeneration.domain.RepairResult
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.SlotExplanations
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.UnverifiedSlot
import com.trippilot.itinerarygeneration.domain.ValidationOutcome
import com.trippilot.itinerarygeneration.domain.Violation
import java.util.UUID

/**
 * 되돌리기·편집 재검증용 — 기본은 위반 없음. 위반 내용 판정은 실 AI(TRIP-309) 몫이라 여기선 흐름만 본다.
 * [failure] 를 주면 재검증이 그 예외로 실패한다(AI 장애 재현).
 */
internal class NoopValidateAgent(
    private val violations: List<Violation> = emptyList(),
    private val failure: RuntimeException? = null,
    /** 판정 못 한 슬롯(TRIP-537) — 위반 0 인데 이것이 있으면 통과가 아니다. */
    private val unverified: List<UnverifiedSlot> = emptyList(),
) : StubScheduleAgent() {
    override fun generate(input: ScheduleAgentInput): ScheduleAgentOutput = error("사용하지 않음")
    override fun validate(solution: ScheduleAgentOutput): ValidationOutcome =
        failure?.let { throw it } ?: ValidationOutcome(violations, unverified)
    override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>) = RepairResult(solution, emptyList())
    override fun explanations(tripId: UUID, solution: ScheduleAgentOutput, preference: PreferenceProfile?, companionType: String?): SlotExplanations = SlotExplanations()
}
