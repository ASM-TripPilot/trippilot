package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.domain.FixedBlock
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.PreferenceProfile
import com.trippilot.itinerarygeneration.domain.RequestMeta
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.TimeWindow
import com.trippilot.itinerarygeneration.domain.TripContext
import com.trippilot.itinerarygeneration.domain.VisitSlot
import com.trippilot.profile.api.PreferenceFacade
import com.trippilot.profile.api.PreferenceSnapshot
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 일정 생성 오케스트레이션(C8 · US-SCHED-01).
 * 소유 여행의 날짜·목적지·동행·예산·필수방문지(must_visit)·취향(preference_snapshot 7축)을 조립해
 * ScheduleAgent를 호출하고 결과를 영속한다. 앵커(trip_base 거점 좌표)는 후속 슬라이스에서 채운다.
 */
@Service
class GenerateItineraryService(
    private val trips: TripFacade,
    private val preferences: PreferenceFacade,
    private val scheduleAgent: ScheduleAgentPort,
    private val itineraries: ItineraryRepository,
    private val clock: Clock,
) {
    fun generate(accountId: UUID, tripId: UUID, mode: GenerationMode): Itinerary {
        val ctx = trips.findGenerationContext(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        val prefs = preferences.findPreferences(accountId)                                    // 취향 7축·예산등급(계정 스코프)
        // 외부(ScheduleAgent) 호출은 트랜잭션 밖 — 영속만 원자적(replaceForTrip). BE-2 실 HTTP 어댑터가 DB 커넥션을 물지 않게.
        val output = scheduleAgent.generate(assembleInput(tripId, mode, ctx, prefs))
        return itineraries.replaceForTrip(tripId, output.toItinerary(tripId))
    }

    private fun assembleInput(
        tripId: UUID,
        mode: GenerationMode,
        ctx: TripGenerationContext,
        prefs: PreferenceSnapshot,
    ): ScheduleAgentInput =
        ScheduleAgentInput(
            tripId = tripId,
            generationMode = mode,
            // budgetLevel(등급) = preference_set.budget_tier (경계 계약; trip.budget_total 아님)
            tripContext = TripContext(ctx.destinations, ctx.startDate, ctx.endDate, ctx.companionType, prefs.budgetTier),
            anchors = emptyList(),                                                                            // 후속: 거점 좌표(trip_base)
            timeWindows = planDates(ctx.startDate, ctx.endDate).map { TimeWindow(it, DEFAULT_START, DEFAULT_END) },
            fixedBlocks = ctx.fixedVisits.map { FixedBlock(it.poiId, it.date, it.start, it.dwellMin) },       // must_visit → 고정 블록(HC3)
            preferenceProfile = prefs.toProfile(),                                                            // preference_snapshot 7축
            recommendationStrength = null,
            requestMeta = RequestMeta(UUID.randomUUID().toString(), clock.instant(), TOTAL_DEADLINE_MS),
        )

    /** 취향 스냅숏(profile.api) → ScheduleAgent 취향 프로필(7축). 미설정 축은 빈 목록/null 그대로. */
    private fun PreferenceSnapshot.toProfile(): PreferenceProfile =
        PreferenceProfile(styles, activities, foodTastes, transportModes, pace, companionTypes, petFriendly, budgetTier)

    /** 여행 날짜(체크인~체크아웃 각 날짜, 체크아웃일 포함). */
    private fun planDates(start: LocalDate, end: LocalDate): List<LocalDate> =
        generateSequence(start) { it.plusDays(1) }.takeWhile { !it.isAfter(end) }.toList()

    /** ScheduleAgentOutput → Itinerary 애그리거트. 시각·순서는 솔버 검증값만(INV-2). poi_snapshot 동결은 확정(272). */
    private fun ScheduleAgentOutput.toItinerary(tripId: UUID): Itinerary {
        val days = this.days.mapIndexed { dayIdx, d ->
            ItineraryDay.of(
                d.date, dayIdx,
                d.slots.mapIndexed { slotIdx, s -> VisitSlot.of(s.poiId, null, slotIdx, s.startAt, s.endAt, s.isFixed) },
            )
        }
        return Itinerary.create(tripId, solveMode, isFallback, days, clock.instant())
    }

    companion object {
        private val DEFAULT_START = LocalTime.of(9, 0)
        private val DEFAULT_END = LocalTime.of(21, 0)
        private const val TOTAL_DEADLINE_MS = 20_000L
    }
}
