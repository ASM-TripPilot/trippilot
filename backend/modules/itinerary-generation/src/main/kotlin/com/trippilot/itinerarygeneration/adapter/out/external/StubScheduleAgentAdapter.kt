package com.trippilot.itinerarygeneration.adapter.out.external

import com.trippilot.itinerarygeneration.domain.DaySchedule
import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.RepairResult
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.Violation
import com.trippilot.itinerarygeneration.domain.VisitSlotDisplay
import org.springframework.stereotype.Component
import java.time.Clock
import java.util.UUID

/**
 * ScheduleAgentPort 1차 스텁 — AI 서비스(U5) 미구현 동안 생성 흐름을 세우는 결정론 스텁.
 * 각 time_window 날짜에 하루를 만들고 placeholder 슬롯 1개(실 POI 후보풀은 AI 소유). 결정론(날짜 파생 id).
 * 실 HTTP 어댑터는 BE-2(TRIP-229)가 대체한다.
 */
@Component
class StubScheduleAgentAdapter(private val clock: Clock) : ScheduleAgentPort {
    override fun generate(input: ScheduleAgentInput): ScheduleAgentOutput {
        val fixedByDate = input.fixedBlocks.filter { it.date != null }.groupBy { it.date }
        val days = input.timeWindows.map { tw ->
            val fixed = fixedByDate[tw.date].orEmpty().map { fb ->
                val s = fb.start ?: tw.start
                VisitSlotDisplay(fb.poiId, s, s.plusMinutes((fb.dwellMin ?: 60).toLong()), false, "약 1km", isFixed = true)
            }
            val placeholder = VisitSlotDisplay(
                UUID.nameUUIDFromBytes("stub-${tw.date}".toByteArray()), tw.start, tw.start.plusHours(1), false, "약 1km", false,
            )
            DaySchedule(tw.date, (fixed + placeholder).sortedBy { it.startAt })
        }
        return ScheduleAgentOutput(
            days = days,
            day1ReadyAt = clock.instant(),
            explanations = emptyMap(),
            solveMode = SolveMode.DETERMINISTIC,
            isFallback = false,
            freshness = FreshnessMeta(clock.instant(), degraded = false),
        )
    }

    override fun validate(solution: ScheduleAgentOutput): List<Violation> = emptyList()

    override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>): RepairResult =
        RepairResult(solution, emptyList())
}
