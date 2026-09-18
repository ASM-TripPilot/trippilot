package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.RepairResult
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
import com.trippilot.itinerarygeneration.domain.ReplanInput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.SlotCandidatesInput
import com.trippilot.itinerarygeneration.domain.SlotCandidatesOutput
import com.trippilot.itinerarygeneration.domain.Violation
import java.util.UUID

/**
 * 테스트 더블 베이스 — **쓰지 않는 경계 메서드는 여기서 막는다.**
 *
 * 포트에 메서드가 늘 때마다 테스트 파일마다 Fake 를 고치는 일이 반복돼(안티패턴 로그) 한 곳으로 모았다.
 * 기본 구현은 **빈 값이 아니라 예외**다 — 안 쓸 줄 알았던 메서드가 실제로 호출되면 조용히 통과하는 대신
 * 그 자리에서 드러나야 한다.
 */
internal abstract class StubScheduleAgent : ScheduleAgentPort {
    override fun generate(input: ScheduleAgentInput): ScheduleAgentOutput = error("이 테스트는 generate 를 쓰지 않는다")
    // 빈 목록을 돌려주면 "위반 없음"이라는 거짓 음성이라, 안 쓰는 테스트에서도 조용히 통과하면 안 된다.
    override fun validate(solution: ScheduleAgentOutput): List<Violation> = error("이 테스트는 validate 를 쓰지 않는다")
    override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>): RepairResult =
        error("이 테스트는 repair 를 쓰지 않는다")
    override fun proposeSlotCandidates(input: SlotCandidatesInput): SlotCandidatesOutput =
        error("이 테스트는 슬롯 후보를 쓰지 않는다")

    override fun replan(input: ReplanInput): ScheduleAgentOutput =
        error("이 테스트는 재계획을 쓰지 않는다")

    /**
     * 빈 맵이 **정상 값**(근거 없음)이라 예외로 막지 않으면 "설명 단계가 통째로 빠진 것"과 구분되지
     * 않는다. 다른 경계와 달리 여기서도 예외를 던져, 쓰는 테스트가 자기 대역을 명시하게 한다.
     */
    override fun explanations(tripId: UUID, solution: ScheduleAgentOutput): Map<String, String> =
        error("이 테스트는 추천 근거 조회를 쓰지 않는다")
}
