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
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 일정 생성 오케스트레이션(C8 · US-SCHED-01) — 첫 슬라이스.
 * 소유 여행의 날짜를 기준으로 ScheduleAgent를 호출하고 결과를 영속한다.
 * 컨텍스트 조립의 앵커(trip_base)·필수방문지(must_visit)·취향(preference_snapshot 7축)은
 * TripFacade 확장 후속 슬라이스에서 채운다(현재는 날짜 기반 최소 조립).
 */
@Service
class GenerateItineraryService(
    private val trips: TripFacade,
    private val scheduleAgent: ScheduleAgentPort,
    private val itineraries: ItineraryRepository,
    private val clock: Clock,
) {
    fun generate(accountId: UUID, tripId: UUID, mode: GenerationMode): Itinerary {
        val ctx = trips.findGenerationContext(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        // 외부(ScheduleAgent) 호출은 트랜잭션 밖 — 영속만 원자적(replaceForTrip). BE-2 실 HTTP 어댑터가 DB 커넥션을 물지 않게.
        val output = scheduleAgent.generate(assembleInput(tripId, mode, ctx))
        return itineraries.replaceForTrip(tripId, output.toItinerary(tripId))
    }

    private fun assembleInput(tripId: UUID, mode: GenerationMode, ctx: TripGenerationContext): ScheduleAgentInput =
        ScheduleAgentInput(
            tripId = tripId,
            generationMode = mode,
            tripContext = TripContext(ctx.destinations, ctx.startDate, ctx.endDate, ctx.companionType, null), // budgetLevel(등급): 취향 슬라이스
            anchors = emptyList(),                                                                            // 후속: 거점 좌표(trip_base)
            timeWindows = planDates(ctx.startDate, ctx.endDate).map { TimeWindow(it, DEFAULT_START, DEFAULT_END) },
            fixedBlocks = ctx.fixedVisits.map { FixedBlock(it.poiId, it.date, it.start, it.dwellMin) },       // must_visit → 고정 블록(HC3)
            preferenceProfile = EMPTY_PREFERENCE,                                                             // 후속: preference_snapshot 7축
            recommendationStrength = null,
            requestMeta = RequestMeta(UUID.randomUUID().toString(), clock.instant(), TOTAL_DEADLINE_MS),
        )

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
        private val EMPTY_PREFERENCE =
            PreferenceProfile(emptyList(), emptyList(), emptyList(), emptyList(), null, emptyList(), false, null)
    }
}
