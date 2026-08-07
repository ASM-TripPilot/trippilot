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
import com.trippilot.placedata.api.Area
import com.trippilot.placedata.api.CandidatePoolPort
import org.springframework.stereotype.Component
import java.time.Clock

/**
 * FakeScheduleAgent — 실 HTTP AI(U5/TRIP-229) 도착 전 계약-우선 개발용 결정론 Fake.
 * 이전 스텁과 달리 **실 ACTIVE 후보(정본, CandidatePoolPort)**를 emit → poi_snapshot 동결(272)·리버스 통합을
 * 지금 E2E 검증 가능. closed-set(INV-1): 목적지 지역의 ACTIVE POI만. 실 검증·수리는 229 이후.
 * 현재 유일한 ScheduleAgentPort 빈(기본). 실 HTTP 어댑터(TRIP-229)가 붙을 때 mode 조건부로 이 빈을 대체한다.
 */
@Component
class FakeScheduleAgent(
    private val candidatePool: CandidatePoolPort,
    private val clock: Clock,
) : ScheduleAgentPort {

    override fun generate(input: ScheduleAgentInput): ScheduleAgentOutput {
        val fixedByDate = input.fixedBlocks.filter { it.date != null }.groupBy { it.date }
        // 목적지 지역들의 ACTIVE 후보(정본) — 동결 가능한 실 poiId. closed-set(INV-1).
        val candidates = input.tripContext.destinations
            .flatMap { candidatePool.resolve(Area.Region(it), emptySet()) }
            .distinctBy { it.poiId }

        val days = input.timeWindows.mapIndexed { dayIdx, tw ->
            val fixed = fixedByDate[tw.date].orEmpty().map { fb ->
                val s = fb.start ?: tw.start
                // distanceRange=null: Fake 는 실 거리 추정 없음(픽과 동일). 실 거리는 229 이후.
                VisitSlotDisplay(fb.poiId, s, s.plusMinutes((fb.dwellMin ?: DEFAULT_DWELL_MIN).toLong()), false, null, isFixed = true)
            }
            val fixedPois = fixed.map { it.poiId }.toSet()
            val available = candidates.filter { it.poiId !in fixedPois }
            // 날짜별 결정론 선택(회전) — 고정 외 시간대에 실 후보 배치.
            val picks = if (available.isEmpty()) {
                emptyList()
            } else {
                (0 until PICKS_PER_DAY)
                    .map { available[(dayIdx * PICKS_PER_DAY + it) % available.size] }
                    .distinctBy { it.poiId }
                    .mapIndexed { i, gp ->
                        val start = tw.start.plusHours((i * SLOT_GAP_HOURS).toLong())
                        VisitSlotDisplay(gp.poiId, start, start.plusHours(1), false, gp.distanceM?.let { "약 ${it.toInt() / 1000}km" }, isFixed = false)
                    }
            }
            DaySchedule(tw.date, (fixed + picks).sortedBy { it.startAt })
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

    override fun validate(solution: ScheduleAgentOutput): List<Violation> = emptyList() // 실 검증은 229

    override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>): RepairResult =
        RepairResult(solution, emptyList())

    companion object {
        private const val PICKS_PER_DAY = 2
        private const val SLOT_GAP_HOURS = 3
        private const val DEFAULT_DWELL_MIN = 60
    }
}
