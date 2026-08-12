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
import com.trippilot.itinerarygeneration.domain.ReplanInput
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.Violation
import com.trippilot.itinerarygeneration.domain.VisitSlotDisplay
import com.trippilot.placedata.api.Area
import com.trippilot.placedata.api.CandidatePoolPort
import org.springframework.stereotype.Component
import java.time.Clock
import java.time.LocalTime

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

    /**
     * 재계획 — 잠긴 슬롯은 그대로 두고 **그 뒤만** 다시 채운다(INV-U4-04).
     * 잠금 판정은 호출측(C8)이 이미 끝냈다. 여기서는 잠긴 POI 를 후보에서 빼 중복 배치만 막는다.
     */
    override fun replan(input: ReplanInput): ScheduleAgentOutput {
        val lockedPois = input.lockedSlotKeys.mapNotNull { it.substringAfter('#').toUuidOrNull() }.toSet()
        val excluded = input.excludedPoiIds.toSet() + lockedPois
        val candidates = candidatePool.resolve(Area.Region(REPLAN_REGION_HINT), emptySet())
            .filter { it.poiId !in excluded }
        // 잠긴 시각 이후부터 채운다 — 지금이 오후면 오전 자리를 다시 만들지 않는다.
        val startAt = LocalTime.ofInstant(input.fromInstant, TRAVEL_ZONE).plusMinutes(REPLAN_LEAD_MIN.toLong())
        val slots = candidates.take(PICKS_PER_DAY).mapIndexed { i, gp ->
            val s = startAt.plusHours((i * SLOT_GAP_HOURS).toLong())
            VisitSlotDisplay(gp.poiId, s, s.plusHours(1), false, null, isFixed = false)
        }
        return ScheduleAgentOutput(
            days = listOf(DaySchedule(input.targetDate, slots)),
            day1ReadyAt = clock.instant(),
            explanations = emptyMap(),
            solveMode = SolveMode.DETERMINISTIC,
            isFallback = false,
            freshness = FreshnessMeta(clock.instant(), degraded = false),
        )
    }

    private fun String.toUuidOrNull() = runCatching { java.util.UUID.fromString(this) }.getOrNull()

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

        /** Fake 는 지역을 모른다 — 데모 후보풀이 제주라 그 지역으로 본다(실 판단은 AI 몫). */
        private const val REPLAN_REGION_HINT = "제주"
        /** 지금 당장이 아니라 조금 뒤부터 — 이동 시간을 아예 0 으로 두면 화면이 비현실적으로 보인다. */
        private const val REPLAN_LEAD_MIN = 30
        private val TRAVEL_ZONE: java.time.ZoneId = java.time.ZoneId.of("Asia/Seoul")
    }
}
