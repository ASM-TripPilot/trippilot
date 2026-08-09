package com.trippilot.itinerarygeneration.adapter.out.external

import com.trippilot.itinerarygeneration.domain.DaySchedule
import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.RepairResult
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.SlotCandidate
import com.trippilot.itinerarygeneration.domain.SlotCandidatesInput
import com.trippilot.itinerarygeneration.domain.SlotCandidatesOutput
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
        val excluded = input.excludedPoiIds.toSet() // day1 2단계 중복 방지(TRIP-293)
        val candidates = input.tripContext.destinations
            .flatMap { candidatePool.resolve(Area.Region(it), emptySet()) }
            .distinctBy { it.poiId }
            .filter { it.poiId !in excluded }

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

    /**
     * 슬롯 후보 — **실제 반경 조회**로 ACTIVE 정본만 돌려준다(INV-1 closed-set).
     * 후보가 0건이면 반경을 한 번 넓혀 다시 본다(h15 "반경 넓힘"을 서버가 흉내낸다) — 실 판단은 AI 몫.
     * 근거 문구는 시각·소요시간을 언급하지 않는다(BR-U2-09).
     */
    override fun proposeSlotCandidates(input: SlotCandidatesInput): SlotCandidatesOutput {
        val excluded = input.excludePoiIds.toSet()
        var radius = (input.radiusM ?: DEFAULT_RADIUS_M)
        var found = search(input, radius, excluded)
        if (found.isEmpty() && radius < WIDENED_RADIUS_M) {
            radius = WIDENED_RADIUS_M
            found = search(input, radius, excluded)
        }
        return SlotCandidatesOutput(
            candidates = found.take(MAX_CANDIDATES).map {
                SlotCandidate(
                    poiId = it.poiId,
                    distanceRange = it.distanceM?.let { m -> "약 ${"%.1f".format(java.util.Locale.ROOT, m / 1000)}km" } ?: "거리 미확인",
                    rationale = input.concept?.let { c -> "$c 컨셉에 맞는 ${it.category}" } ?: "주변 ${it.category}",
                )
            },
            radiusMUsed = radius,
            freshness = FreshnessMeta(clock.instant(), degraded = false),
        )
    }

    private fun search(input: SlotCandidatesInput, radiusM: Int, excluded: Set<java.util.UUID>) =
        candidatePool.resolve(Area.Radius(input.centerLat, input.centerLng, radiusM.toDouble()), emptySet())
            .filter { it.poiId !in excluded }
            .sortedBy { it.distanceM ?: Double.MAX_VALUE }

    companion object {
        private const val PICKS_PER_DAY = 2
        private const val SLOT_GAP_HOURS = 3
        private const val DEFAULT_DWELL_MIN = 60
        private const val DEFAULT_RADIUS_M = 3_000
        private const val WIDENED_RADIUS_M = 12_000
        private const val MAX_CANDIDATES = 5
    }
}
