package com.trippilot.itinerarygeneration.adapter.out.external

import com.trippilot.itinerarygeneration.domain.DaySchedule
import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.RepairResult
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.SlotExplanations
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
import com.trippilot.placedata.api.GroundedPlace
import org.springframework.stereotype.Component
import com.trippilot.itinerarygeneration.application.SlotKey
import java.util.UUID
import java.time.Clock
import java.time.LocalTime
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * FakeScheduleAgent — 실 HTTP AI(U5/TRIP-229) 도착 전 계약-우선 개발용 결정론 Fake.
 * 이전 스텁과 달리 **실 ACTIVE 후보(정본, CandidatePoolPort)**를 emit → poi_snapshot 동결(272)·리버스 통합을
 * 지금 E2E 검증 가능. closed-set(INV-1): 목적지 지역의 ACTIVE POI만. 실 검증·수리는 229 이후.
 * 현재 유일한 ScheduleAgentPort 빈(기본). 실 HTTP 어댑터(TRIP-229)가 붙을 때 mode 조건부로 이 빈을 대체한다.
 */
@Component
class FakeScheduleAgent(
    private val candidatePool: CandidatePoolPort,
    private val localCandidates: LocalSlotCandidateSource,
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
     * 슬롯 후보 — 공용 [LocalSlotCandidateSource] 에 위임한다. 로직이 여기 갇혀 있어서 http 모드가
     * 같은 것을 못 쓰고 503 을 내던 자리였다(DEC-U3-5).
     *
     * fake 모드는 **에이전트 전체가 대역**이라 강등이 아니다 — `degraded=false`.
     */
    override fun proposeSlotCandidates(input: SlotCandidatesInput): SlotCandidatesOutput =
        localCandidates.propose(input, degraded = false)

    /**
     * 재계획 — 잠긴 슬롯은 그대로 두고 **그 뒤만** 다시 채운다(INV-U4-04).
     * 잠금 판정은 호출측(C8)이 이미 끝냈다. 여기서는 잠긴 POI 를 후보에서 빼 중복 배치만 막는다.
     */
    override fun replan(input: ReplanInput): ScheduleAgentOutput {
        val excluded = input.excludedPoiIds.toSet() + input.lockedBlocks.map { it.poiId }
        val candidates = input.destinations
            .flatMap { candidatePool.resolve(Area.Region(it), emptySet()) }
            .distinctBy { it.poiId }
            .filter { it.poiId !in excluded }
        // 잠긴 시각 이후부터 채운다 — 지금이 오후면 오전 자리를 다시 만들지 않는다.
        val startAt = LocalTime.ofInstant(input.fromInstant, TRAVEL_ZONE).plusMinutes(REPLAN_LEAD_MIN.toLong())
        // **그 날 안에 끝나는 것만** 만든다. 늦은 시각에 기계적으로 3시간씩 더하면 자정을 넘어
        // `endAt < startAt` 인 슬롯이 나오고, 도메인 검증에 걸려 사용자에게 500 이 된다
        // (실측: 19:33 KST 에 CI 만 실패, 18:44 에 돌린 로컬은 통과 — 시각 의존 결함).
        val picks = candidates.take(PICKS_PER_DAY)
        val slots = picks.mapIndexed { i, gp -> i to gp }
            .mapNotNull { (i, gp) ->
                val s = startAt.plusHours((i * SLOT_GAP_HOURS).toLong())
                val e = s.plusHours(1)
                // 시각이 되감겼으면(자정 넘김) 그 뒤로는 오늘 자리가 없다.
                if (s < startAt || e <= s) null else VisitSlotDisplay(gp.poiId, s, e, false, null, isFixed = false)
            }
        return ScheduleAgentOutput(
            days = listOf(DaySchedule(input.targetDate, slots)),
            day1ReadyAt = clock.instant(),
            explanations = emptyMap(),
            solveMode = SolveMode.DETERMINISTIC,
            isFallback = false,
            freshness = FreshnessMeta(clock.instant(), degraded = false),
            // 기준점에서 출발해 고른 순서대로 이은 **직선 합**이다 — 실 AI 의 경로 거리가 아니다.
            // 그래도 상수나 null 보다 낫다: null 로 두면 "초안에 거리가 실린다"는 배선이
            // 기본 모드에서 한 번도 실행되지 않아, 실 연동에서야 처음 도는 코드가 된다.
            totalDistanceKm = straightLineKm(input.originLat, input.originLng, picks),
        )
    }

    /** 직선 거리 합(km). 좌표가 없으면 **모른다** — 0 으로 채우면 "이동이 없는 하루"라는 거짓이 된다. */
    private fun straightLineKm(originLat: Double?, originLng: Double?, picks: List<GroundedPlace>): Double? {
        if (picks.isEmpty()) return null
        var lat = originLat ?: return null
        var lng = originLng ?: return null
        var sum = 0.0
        picks.forEach {
            sum += haversineKm(lat, lng, it.lat, it.lng)
            lat = it.lat
            lng = it.lng
        }
        return Math.round(sum * 10) / 10.0
    }

    private fun haversineKm(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a = sin(dLat / 2).pow(2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLng / 2).pow(2)
        return 2 * EARTH_RADIUS_KM * asin(min(1.0, sqrt(a)))
    }


    companion object {
        private const val PICKS_PER_DAY = 2
        private const val SLOT_GAP_HOURS = 3
        private const val DEFAULT_DWELL_MIN = 60
        /** 지금 당장이 아니라 조금 뒤부터 — 이동 시간을 아예 0 으로 두면 화면이 비현실적으로 보인다. */
        private const val REPLAN_LEAD_MIN = 30
        private const val EARTH_RADIUS_KM = 6371.0
        private val TRAVEL_ZONE: java.time.ZoneId = java.time.ZoneId.of("Asia/Seoul")
    }
    /**
     * 결정론적 근거(TRIP-511). 실 AI 는 LLM 문장을 주지만 대역은 **슬롯마다 같은 형태**를 준다 —
     * 문장 품질이 아니라 **근거가 슬롯에 실제로 도달하는지**가 이 대역으로 재려는 것이다.
     *
     * 빈 맵으로 두면 "설명 단계가 통째로 빠져도" 테스트가 통과해, 분리한 배선을 아무도 안 지킨다.
     */
    override fun explanations(tripId: UUID, solution: ScheduleAgentOutput): SlotExplanations = SlotExplanations(
        slots = solution.days
            .flatMap { d -> d.slots.map { SlotKey.of(d.date, it.poiId) to "일정 흐름에 맞는 곳이에요" } }
            .toMap(),
        // 차선책 쪽도 같은 이유로 채운다 — 빈 맵으로 두면 그 배선이 통째로 빠져도 fake 경로 테스트가
        // 통과한다. 슬롯 근거와 **다른 축의 키**(차선책 POI)라 여기서 그 규약도 같이 지켜진다.
        alternatives = solution.days
            .flatMap { d -> d.slots.flatMap { s -> s.alternatives.map { SlotKey.of(d.date, it.poiId) to "여기도 괜찮아요" } } }
            .toMap(),
    )

}
